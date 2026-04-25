/**
 * @NApiVersion 2.1
 * @NScriptType ScheduledScript
 * @NModuleScope SameAccount
 *
 * Flux Capture - Continue Polling Scheduled Script
 *
 * Handles continuation polling for documents that didn't complete in the initial
 * Map/Reduce processing. This script is triggered on-demand via task.create()
 * from the MR summarize() function when documents need more polling time.
 *
 * Architecture:
 * - MR handles batch submission and initial polling (parallel processing)
 * - This SS handles continuation polling (can run longer, different deployment)
 * - SS can chain to itself if needed (no "busy deployment" conflict)
 */

define([
    'N/record',
    'N/search',
    'N/log',
    'N/runtime',
    'N/task',
    'N/https',
    '/SuiteScripts/com.flux.capture/lib/FC_Engine',
    '/SuiteScripts/com.flux.capture/suitelet/FC_FormSchemaExtractor'
], function(record, search, log, runtime, task, https, FC_Engine, FormSchemaExtractor) {

    'use strict';

    const DocStatus = Object.freeze({
        PENDING: 1,
        PROCESSING: 2,
        EXTRACTED: 3,
        NEEDS_REVIEW: 4,
        REJECTED: 5,
        COMPLETED: 6,
        ERROR: 7
    });

    // Polling configuration for continuation
    const POLLING_CONFIG = {
        MAX_ATTEMPTS_PER_DOC: 200,      // Max poll attempts per document in this run
        MAX_TOTAL_ATTEMPTS: 500,         // Absolute max before giving up
        GOVERNANCE_THRESHOLD: 500        // Stop if remaining units below this
    };

    function getTransactionTypeForDocumentType(documentType) {
        const docType = parseInt(documentType, 10);
        if (docType === 4) return 'expensereport';
        if (docType === 3) return 'vendorcredit';
        if (docType === 5) return 'purchaseorder';
        return 'vendorbill';
    }

    function loadProcessingFormSchema(documentType) {
        try {
            if (!FormSchemaExtractor || !FormSchemaExtractor.extractFormSchema) return null;
            const transactionType = getTransactionTypeForDocumentType(documentType);
            const schemaResult = FormSchemaExtractor.extractFormSchema(transactionType, {});
            if (schemaResult && schemaResult.success && schemaResult.data) {
                return schemaResult.data;
            }
        } catch (e) {
            log.debug('loadProcessingFormSchema', e.message);
        }
        return null;
    }

    /**
     * Load general settings from config record
     */
    function loadSettings() {
        try {
            var configSearch = search.create({
                type: 'customrecord_flux_config',
                filters: [
                    ['custrecord_flux_cfg_type', 'is', 'settings'],
                    'AND',
                    ['custrecord_flux_cfg_key', 'is', 'general'],
                    'AND',
                    ['custrecord_flux_cfg_active', 'is', 'T']
                ],
                columns: ['custrecord_flux_cfg_data']
            });
            var results = configSearch.run().getRange({ start: 0, end: 1 });
            if (results.length > 0) {
                var dataStr = results[0].getValue('custrecord_flux_cfg_data');
                if (dataStr) {
                    return JSON.parse(dataStr);
                }
            }
        } catch (e) {
            log.debug('loadSettings', 'No saved settings found: ' + e.message);
        }
        return {};
    }

    /**
     * Load provider configuration
     */
    function loadProviderConfig() {
        try {
            var configSearch = search.create({
                type: 'customrecord_flux_config',
                filters: [
                    ['custrecord_flux_cfg_type', 'is', 'provider'],
                    'AND',
                    ['custrecord_flux_cfg_active', 'is', 'T']
                ],
                columns: ['custrecord_flux_cfg_key', 'custrecord_flux_cfg_data']
            });

            var config = {};
            configSearch.run().each(function(result) {
                var key = result.getValue('custrecord_flux_cfg_key');
                var dataStr = result.getValue('custrecord_flux_cfg_data');
                if (key && dataStr) {
                    config[key] = JSON.parse(dataStr);
                }
                return true;
            });
            return config;
        } catch (e) {
            log.error('loadProviderConfig', e.message);
            return {};
        }
    }

    /**
     * Main execution function
     */
    function execute(context) {
        log.audit('FC_ContinuePolling', 'Starting continuation polling');

        const settings = loadSettings();
        const providerConfig = loadProviderConfig();
        const maxExtractionPages = settings.maxExtractionPages || 0;

        // Find all PROCESSING documents with operation URLs that need polling
        const docsToProcess = findProcessingDocuments();

        if (docsToProcess.length === 0) {
            log.audit('FC_ContinuePolling', 'No documents need continuation polling');
            return;
        }

        log.audit('FC_ContinuePolling', {
            documentsFound: docsToProcess.length
        });

        // Initialize engine for processing results with anomaly detection settings
        const engine = new FC_Engine.FluxCaptureEngine({
            anomalyDetection: settings.anomalyDetection || {}
        });
        const provider = engine.getExtractionProvider();

        let processedCount = 0;
        let completedCount = 0;
        let stillRunningCount = 0;
        let errorCount = 0;

        // Process each document
        for (const doc of docsToProcess) {
            // Check governance
            const remainingUnits = runtime.getCurrentScript().getRemainingUsage();
            if (remainingUnits < POLLING_CONFIG.GOVERNANCE_THRESHOLD) {
                log.audit('FC_ContinuePolling', {
                    message: 'Governance threshold reached, stopping',
                    remainingUnits: remainingUnits,
                    processedSoFar: processedCount
                });
                break;
            }

            processedCount++;

            try {
                const result = pollDocument(doc, provider, engine, settings);

                if (result.completed) {
                    completedCount++;
                } else if (result.error) {
                    errorCount++;
                } else {
                    stillRunningCount++;
                }

            } catch (e) {
                log.error('FC_ContinuePolling.processDoc', {
                    documentId: doc.id,
                    error: e.message
                });
                errorCount++;

                // Mark document as error
                try {
                    record.submitFields({
                        type: 'customrecord_flux_document',
                        id: doc.id,
                        values: {
                            'custrecord_flux_status': DocStatus.ERROR,
                            'custrecord_flux_error_message': e.message,
                            'custrecord_flux_operation_url': '',
                            'custrecord_flux_poll_count': 0
                        }
                    });
                } catch (updateErr) {
                    log.error('FC_ContinuePolling.updateError', updateErr.message);
                }
            }
        }

        log.audit('FC_ContinuePolling.summary', {
            processed: processedCount,
            completed: completedCount,
            stillRunning: stillRunningCount,
            errors: errorCount
        });

        // If there are still documents running, chain another run
        if (stillRunningCount > 0) {
            chainNextRun(stillRunningCount);
        }
    }

    /**
     * Find all documents that need continuation polling
     */
    function findProcessingDocuments() {
        const docs = [];

        const docSearch = search.create({
            type: 'customrecord_flux_document',
            filters: [
                ['custrecord_flux_status', 'is', DocStatus.PROCESSING],
                'AND',
                ['custrecord_flux_operation_url', 'isnotempty', '']
            ],
            columns: [
                'internalid',
                'custrecord_flux_operation_url',
                'custrecord_flux_poll_count',
                'custrecord_flux_document_type'
            ]
        });

        docSearch.run().each(function(result) {
            docs.push({
                id: result.id,
                operationUrl: result.getValue('custrecord_flux_operation_url'),
                pollCount: parseInt(result.getValue('custrecord_flux_poll_count'), 10) || 0,
                documentType: result.getValue('custrecord_flux_document_type') || 1
            });
            return true;
        });

        return docs;
    }

    /**
     * Poll a single document until complete or max attempts
     */
    function pollDocument(doc, provider, engine, settings) {
        const maxExtractionPages = settings.maxExtractionPages || 0;
        let pollCount = doc.pollCount;
        let attempts = 0;

        log.debug('FC_ContinuePolling.pollDocument', {
            documentId: doc.id,
            startPollCount: pollCount,
            operationUrl: doc.operationUrl.substring(0, 50) + '...'
        });

        // Get API key from provider
        const apiKey = provider.apiKey;

        while (attempts < POLLING_CONFIG.MAX_ATTEMPTS_PER_DOC &&
               pollCount < POLLING_CONFIG.MAX_TOTAL_ATTEMPTS) {

            attempts++;
            pollCount++;

            try {
                const response = https.get({
                    url: doc.operationUrl,
                    headers: {
                        'Ocp-Apim-Subscription-Key': apiKey
                    }
                });

                if (response.code !== 200) {
                    log.error('FC_ContinuePolling.pollError', {
                        documentId: doc.id,
                        code: response.code
                    });
                    continue;
                }

                const result = JSON.parse(response.body);

                if (result.status === 'succeeded') {
                    log.audit('FC_ContinuePolling.succeeded', {
                        documentId: doc.id,
                        totalAttempts: pollCount
                    });

                    // Process the result
                    const normalizedResult = provider._normalizeResult(result, {
                        maxPages: maxExtractionPages
                    });
                    const formSchema = loadProcessingFormSchema(doc.documentType);

                    const processed = engine.processWithRawResult(normalizedResult, {
                        documentType: doc.documentType,
                        enableVendorMatching: true,
                        maxExtractionPages: maxExtractionPages,
                        documentId: doc.id,
                        formSchema: formSchema
                    });

                    if (processed.success) {
                        // Update document with results
                        const updateValues = buildUpdateValues(processed.extraction, doc.documentType);
                        updateValues['custrecord_flux_operation_url'] = '';
                        updateValues['custrecord_flux_poll_count'] = 0;

                        log.debug('FC_ContinuePolling.updateValues', {
                            documentId: doc.id,
                            status: updateValues['custrecord_flux_status'],
                            vendor: updateValues['custrecord_flux_vendor'],
                            invoiceNumber: updateValues['custrecord_flux_invoice_number']
                        });

                        try {
                            const updatedId = record.submitFields({
                                type: 'customrecord_flux_document',
                                id: doc.id,
                                values: updateValues
                            });
                            log.audit('FC_ContinuePolling.updated', {
                                documentId: doc.id,
                                updatedId: updatedId,
                                newStatus: updateValues['custrecord_flux_status']
                            });
                        } catch (updateErr) {
                            log.error('FC_ContinuePolling.updateFailed', {
                                documentId: doc.id,
                                error: updateErr.message,
                                values: JSON.stringify(updateValues).substring(0, 500)
                            });
                            // Re-throw to be caught by outer handler
                            throw updateErr;
                        }

                        return { completed: true };
                    } else {
                        // Processing failed
                        record.submitFields({
                            type: 'customrecord_flux_document',
                            id: doc.id,
                            values: {
                                'custrecord_flux_status': DocStatus.ERROR,
                                'custrecord_flux_error_message': processed.error || 'Processing failed',
                                'custrecord_flux_operation_url': '',
                                'custrecord_flux_poll_count': 0
                            }
                        });

                        return { completed: false, error: true };
                    }
                }

                if (result.status === 'failed') {
                    const errorMsg = result.error?.message || 'Azure analysis failed';
                    log.error('FC_ContinuePolling.failed', {
                        documentId: doc.id,
                        error: errorMsg
                    });

                    record.submitFields({
                        type: 'customrecord_flux_document',
                        id: doc.id,
                        values: {
                            'custrecord_flux_status': DocStatus.ERROR,
                            'custrecord_flux_error_message': errorMsg,
                            'custrecord_flux_operation_url': '',
                            'custrecord_flux_poll_count': 0
                        }
                    });

                    return { completed: false, error: true };
                }

                // Still running - continue polling
                // HTTP latency provides natural spacing

            } catch (e) {
                log.debug('FC_ContinuePolling.pollException', {
                    documentId: doc.id,
                    attempt: attempts,
                    error: e.message
                });
                // Continue on transient errors
            }
        }

        // Reached max attempts for this run or total
        if (pollCount >= POLLING_CONFIG.MAX_TOTAL_ATTEMPTS) {
            // Total timeout - mark as error
            log.error('FC_ContinuePolling.timeout', {
                documentId: doc.id,
                totalAttempts: pollCount
            });

            record.submitFields({
                type: 'customrecord_flux_document',
                id: doc.id,
                values: {
                    'custrecord_flux_status': DocStatus.ERROR,
                    'custrecord_flux_error_message': 'Azure analysis timed out after ' + pollCount + ' attempts',
                    'custrecord_flux_operation_url': '',
                    'custrecord_flux_poll_count': 0
                }
            });

            return { completed: false, error: true };
        }

        // Still running but hit per-run limit - save state for next run
        log.debug('FC_ContinuePolling.stillRunning', {
            documentId: doc.id,
            pollCount: pollCount
        });

        record.submitFields({
            type: 'customrecord_flux_document',
            id: doc.id,
            values: {
                'custrecord_flux_poll_count': pollCount
            }
        });

        return { completed: false, stillRunning: true };
    }

    /**
     * Build update values from extraction result
     */
    function buildUpdateValues(extraction, documentType) {
        const invoiceDate = parseExtractedDate(extraction.fields?.invoiceDate);
        const dueDate = parseExtractedDate(extraction.fields?.dueDate);

        const updateValues = {
            'custrecord_flux_status': DocStatus.NEEDS_REVIEW,
            'custrecord_flux_document_type': extraction.documentType || documentType,
            'custrecord_flux_vendor': extraction.vendorMatch?.vendorId || null,
            'custrecord_flux_vendor_match_conf': extraction.vendorMatch?.confidence || 0,
            'custrecord_flux_invoice_number': extraction.fields?.invoiceNumber || '',
            'custrecord_flux_invoice_date': invoiceDate,
            'custrecord_flux_due_date': dueDate,
            'custrecord_flux_subtotal': extraction.fields?.subtotal || 0,
            'custrecord_flux_tax_amount': extraction.fields?.taxAmount || 0,
            'custrecord_flux_total_amount': extraction.fields?.totalAmount || 0,
            'custrecord_flux_po_number': extraction.fields?.poNumber || '',
            'custrecord_flux_payment_terms': extraction.fields?.paymentTerms || '',
            'custrecord_flux_line_items': JSON.stringify(extraction.lineItems || []),
            'custrecord_flux_anomalies': JSON.stringify(extraction.anomalies || []),
            'custrecord_flux_confidence_score': extraction.confidence?.overall || 0,
            'custrecord_flux_amount_validated': extraction.amountValidation?.valid || false,
            'custrecord_flux_modified_date': new Date()
        };

        // Build extracted data JSON
        const extractedDataObj = {};
        if (extraction.fields) {
            Object.keys(extraction.fields).forEach(function(key) {
                extractedDataObj[key] = extraction.fields[key];
            });
        }
        extractedDataObj.vendorName = extraction.vendorMatch?.vendorName || '';
        extractedDataObj.vendor = extraction.vendorMatch?.vendorId || '';
        if (extraction.allExtractedFields) {
            extractedDataObj._allExtractedFields = extraction.allExtractedFields;
        }
        if (extraction.fieldConfidences) {
            extractedDataObj._fieldConfidences = extraction.fieldConfidences;
        }
        if (extraction.customFieldMatches) {
            extractedDataObj._customFieldMatches = extraction.customFieldMatches;
        }
        extractedDataObj._confidence = extraction.confidence;
        extractedDataObj._vendorMatch = extraction.vendorMatch;
        extractedDataObj._extractedAt = new Date().toISOString();

        updateValues['custrecord_flux_extracted_data'] = JSON.stringify(extractedDataObj);

        // Currency
        if (extraction.fields?.currency) {
            const currencyVal = extraction.fields.currency;
            if (typeof currencyVal === 'number' || (typeof currencyVal === 'string' && /^\d+$/.test(currencyVal))) {
                updateValues['custrecord_flux_currency'] = parseInt(currencyVal, 10);
            } else {
                updateValues['custrecord_flux_currency'] = String(currencyVal);
            }
        }

        return updateValues;
    }

    /**
     * Parse dates from various formats
     */
    function parseExtractedDate(dateVal) {
        if (!dateVal) return null;
        if (dateVal instanceof Date) return dateVal;

        const dateStr = String(dateVal).trim();
        if (!dateStr) return null;

        let parsed = null;

        // Try "Dec 15/2025" or "Dec 15, 2025" format
        const monthMatch = dateStr.match(/^([A-Za-z]+)\s*(\d{1,2})[\/,\s]+(\d{4})$/);
        if (monthMatch) {
            const months = { jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11 };
            const monthNum = months[monthMatch[1].toLowerCase().substring(0, 3)];
            if (monthNum !== undefined) {
                parsed = new Date(parseInt(monthMatch[3]), monthNum, parseInt(monthMatch[2]));
            }
        }

        // Try MM/DD/YYYY or MM-DD-YYYY
        if (!parsed) {
            const slashMatch = dateStr.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})$/);
            if (slashMatch) {
                parsed = new Date(parseInt(slashMatch[3]), parseInt(slashMatch[1]) - 1, parseInt(slashMatch[2]));
            }
        }

        // Try YYYY-MM-DD
        if (!parsed) {
            const isoMatch = dateStr.match(/^(\d{4})[\/\-](\d{1,2})[\/\-](\d{1,2})$/);
            if (isoMatch) {
                parsed = new Date(parseInt(isoMatch[1]), parseInt(isoMatch[2]) - 1, parseInt(isoMatch[3]));
            }
        }

        // Fallback to native parsing
        if (!parsed) {
            parsed = new Date(dateStr);
        }

        // Validate
        if (parsed && !isNaN(parsed.getTime())) {
            return parsed;
        }

        return null;
    }

    /**
     * Chain another run of this script
     */
    function chainNextRun(pendingCount) {
        log.audit('FC_ContinuePolling.chain', {
            pendingDocuments: pendingCount,
            schedulingNextRun: true
        });

        try {
            const ssTask = task.create({
                taskType: task.TaskType.SCHEDULED_SCRIPT,
                scriptId: 'customscript_fc_continue_polling',
                deploymentId: 'customdeploy_fc_continue_polling'
            });

            const taskId = ssTask.submit();

            log.audit('FC_ContinuePolling.chained', {
                taskId: taskId,
                forDocuments: pendingCount
            });

        } catch (chainErr) {
            // If we can't chain (e.g., task already queued), log it
            // Documents will be picked up on next trigger
            log.error('FC_ContinuePolling.chainError', {
                message: chainErr.message,
                note: 'Documents will be processed when next triggered'
            });
        }
    }

    return {
        execute: execute
    };

});
