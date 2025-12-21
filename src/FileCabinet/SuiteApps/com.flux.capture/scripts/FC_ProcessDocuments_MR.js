/**
 * @NApiVersion 2.1
 * @NScriptType MapReduceScript
 * @NModuleScope SameAccount
 *
 * Flux Capture - Document Processing Map/Reduce
 * Processes documents asynchronously with self-chaining for long-running extractions.
 *
 * v4.2: Implements async polling architecture to handle batch uploads without
 * exceeding governance limits. Documents are processed in phases:
 * 1. PENDING → Submit to Azure, poll with limit, save state if still running
 * 2. PROCESSING (with operation URL) → Continue polling from saved state
 * 3. When complete → Process with FC_Engine, set to NEEDS_REVIEW
 * 4. summarize() chains another MR run if any docs still need polling
 */

define([
    'N/record',
    'N/file',
    'N/search',
    'N/log',
    'N/runtime',
    'N/task',
    '/SuiteApps/com.flux.capture/lib/FC_Engine',
    '/SuiteApps/com.flux.capture/lib/utils/PDFUtils'
], function(record, file, search, log, runtime, task, FC_Engine, PDFUtils) {

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

    // Configuration for async polling
    const POLLING_CONFIG = {
        MAX_ATTEMPTS_PER_RUN: 15,      // Max poll attempts per MR run per document
        MAX_TOTAL_ATTEMPTS: 300,        // Absolute max attempts before timeout
        CHAIN_DELAY_SECONDS: 30         // Delay before chaining next MR run
    };

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
     * Get documents that need processing.
     * Includes both new PENDING docs and PROCESSING docs that need continued polling.
     */
    function getInputData() {
        log.audit('FC_ProcessDocuments', 'Starting document processing job');

        // Search for:
        // 1. PENDING documents (new, need Azure submission)
        // 2. PROCESSING documents with operation URL (need continued polling)
        return search.create({
            type: 'customrecord_flux_document',
            filters: [
                [
                    ['custrecord_flux_status', 'is', DocStatus.PENDING],
                    'OR',
                    [
                        ['custrecord_flux_status', 'is', DocStatus.PROCESSING],
                        'AND',
                        ['custrecord_flux_operation_url', 'isnotempty', '']
                    ]
                ]
            ],
            columns: [
                'internalid',
                'custrecord_flux_source_file',
                'custrecord_flux_document_type',
                'custrecord_flux_document_id',
                'custrecord_flux_status',
                'custrecord_flux_operation_url',
                'custrecord_flux_poll_count'
            ]
        });
    }

    /**
     * Process each document - either submit new or continue polling
     */
    function map(context) {
        const searchResult = JSON.parse(context.value);
        const documentId = searchResult.id;
        const fileId = searchResult.values.custrecord_flux_source_file?.value || searchResult.values.custrecord_flux_source_file;
        const documentType = searchResult.values.custrecord_flux_document_type || 1;
        const docCode = searchResult.values.custrecord_flux_document_id;
        const currentStatus = parseInt(searchResult.values.custrecord_flux_status, 10);
        const operationUrl = searchResult.values.custrecord_flux_operation_url || '';
        const pollCount = parseInt(searchResult.values.custrecord_flux_poll_count, 10) || 0;

        const isNewDocument = currentStatus === DocStatus.PENDING;
        const isContinuation = currentStatus === DocStatus.PROCESSING && operationUrl;

        log.audit('FC_ProcessDocuments.map', {
            documentId: documentId,
            fileId: fileId,
            docCode: docCode,
            isNewDocument: isNewDocument,
            isContinuation: isContinuation,
            pollCount: pollCount
        });

        try {
            // For new documents, verify still PENDING (race condition check)
            if (isNewDocument) {
                const stillPending = search.create({
                    type: 'customrecord_flux_document',
                    filters: [
                        ['internalid', 'is', documentId],
                        'AND',
                        ['custrecord_flux_status', 'is', DocStatus.PENDING]
                    ],
                    columns: ['internalid']
                }).run().getRange({ start: 0, end: 1 });

                if (stillPending.length === 0) {
                    log.audit('FC_ProcessDocuments.map.skip', {
                        documentId: documentId,
                        reason: 'Document no longer PENDING'
                    });
                    context.write({
                        key: documentId,
                        value: { success: true, skipped: true, reason: 'Already processing' }
                    });
                    return;
                }
            }

            // Load settings for processing options
            const settings = loadSettings();
            const maxExtractionPages = settings.maxExtractionPages || 0;

            // Initialize engine with anomaly detection settings
            const engine = new FC_Engine.FluxCaptureEngine({
                anomalyDetection: settings.anomalyDetection || {}
            });
            const provider = engine.getExtractionProvider();

            // Check if provider supports async polling (Azure) or is synchronous (Mindee, OCI)
            const supportsAsyncPolling = typeof provider.submitForAnalysis === 'function' &&
                                         typeof provider.pollWithLimit === 'function';

            // For synchronous providers (Mindee, OCI), use the traditional flow
            if (!supportsAsyncPolling) {
                log.audit('FC_ProcessDocuments.map.sync', {
                    documentId: documentId,
                    provider: provider.getProviderName ? provider.getProviderName() : 'unknown'
                });

                // Mark as processing
                record.submitFields({
                    type: 'customrecord_flux_document',
                    id: documentId,
                    values: {
                        'custrecord_flux_status': DocStatus.PROCESSING
                    }
                });

                const startTime = Date.now();

                // Use traditional synchronous processing
                const result = engine.processDocument(fileId, {
                    documentType: documentType,
                    enableVendorMatching: true,
                    enableLearning: true,
                    maxExtractionPages: maxExtractionPages
                });

                const processingTime = Date.now() - startTime;

                if (result.success) {
                    const extraction = result.extraction;
                    const updateValues = buildUpdateValues(extraction, documentType, processingTime);

                    record.submitFields({
                        type: 'customrecord_flux_document',
                        id: documentId,
                        values: updateValues
                    });

                    context.write({
                        key: documentId,
                        value: {
                            success: true,
                            status: DocStatus.NEEDS_REVIEW,
                            confidence: extraction.confidence.overall,
                            processingTime: processingTime
                        }
                    });
                } else {
                    record.submitFields({
                        type: 'customrecord_flux_document',
                        id: documentId,
                        values: {
                            'custrecord_flux_status': DocStatus.ERROR,
                            'custrecord_flux_error_message': result.error || 'Processing failed'
                        }
                    });

                    context.write({
                        key: documentId,
                        value: { success: false, error: result.error }
                    });
                }
                return; // Exit early for sync providers
            }

            // =====================================================
            // ASYNC POLLING FLOW (Azure Form Recognizer)
            // =====================================================

            let currentOperationUrl = operationUrl;
            let currentPollCount = pollCount;

            // Phase 1: Submit to Azure (for new documents only)
            if (isNewDocument) {
                // Mark as processing
                record.submitFields({
                    type: 'customrecord_flux_document',
                    id: documentId,
                    values: {
                        'custrecord_flux_status': DocStatus.PROCESSING
                    }
                });

                // Load file and submit to Azure
                const fileObj = file.load({ id: fileId });
                const fileName = fileObj.name.toLowerCase();
                const isPDF = fileName.endsWith('.pdf');

                log.audit('FC_ProcessDocuments.map.submit', {
                    documentId: documentId,
                    fileName: fileObj.name,
                    isPDF: isPDF,
                    maxExtractionPages: maxExtractionPages
                });

                // For PDFs with page limit, chunk before sending to Azure
                let contentToSubmit = null;
                let wasChunked = false;
                let originalPageCount = 0;

                if (isPDF && maxExtractionPages > 0) {
                    const fileContent = fileObj.getContents();

                    // Check if it's actually a PDF and count pages
                    if (PDFUtils.isPDF(fileContent)) {
                        const pageCount = PDFUtils.countPages(fileContent);

                        log.audit('FC_ProcessDocuments.map.pdfAnalysis', {
                            documentId: documentId,
                            pageCount: pageCount,
                            maxExtractionPages: maxExtractionPages
                        });

                        if (pageCount > maxExtractionPages) {
                            // Chunk the PDF to first N pages
                            const chunkResult = PDFUtils.extractFirstPages(fileContent, maxExtractionPages);

                            if (chunkResult.success && chunkResult.wasChunked) {
                                contentToSubmit = chunkResult.content;
                                wasChunked = true;
                                originalPageCount = chunkResult.originalPageCount;

                                log.audit('FC_ProcessDocuments.map.pdfChunked', {
                                    documentId: documentId,
                                    originalPages: originalPageCount,
                                    chunkedTo: maxExtractionPages
                                });
                            } else if (!chunkResult.success) {
                                log.error('FC_ProcessDocuments.map.chunkError', {
                                    documentId: documentId,
                                    error: chunkResult.error
                                });
                                // Fall through to submit original file
                            }
                        }
                    }
                }

                // Submit to Azure (with chunked content if available)
                const submitOptions = {
                    documentType: documentType
                };

                if (contentToSubmit) {
                    submitOptions.base64Content = contentToSubmit;
                    submitOptions.fileName = fileObj.name;
                    submitOptions.wasChunked = wasChunked;
                    submitOptions.originalPageCount = originalPageCount;
                }

                const submitResult = provider.submitForAnalysis(
                    contentToSubmit ? null : fileObj,
                    submitOptions
                );

                currentOperationUrl = submitResult.operationUrl;
                currentPollCount = 0;

                // Save operation URL immediately (and chunking info for reference)
                const updateValues = {
                    'custrecord_flux_operation_url': currentOperationUrl,
                    'custrecord_flux_poll_count': 0
                };

                record.submitFields({
                    type: 'customrecord_flux_document',
                    id: documentId,
                    values: updateValues
                });
            }

            // Phase 2: Poll for results (with limited attempts)
            // Guard: If operation URL is empty (possible race condition where another
            // MR execution completed this document), skip polling and let it be picked up
            // on next scheduled run or mark as needing attention
            if (!currentOperationUrl || currentOperationUrl.trim() === '') {
                log.error('FC_ProcessDocuments.map.poll', {
                    documentId: documentId,
                    error: 'Operation URL is empty - possible race condition or document already processed',
                    isNewDocument: isNewDocument,
                    isContinuation: isContinuation
                });

                // Re-check document status from database
                const currentDoc = record.load({ type: 'customrecord_flux_document', id: documentId });
                const currentDocStatus = parseInt(currentDoc.getValue('custrecord_flux_status'), 10);

                if (currentDocStatus === DocStatus.NEEDS_REVIEW || currentDocStatus === DocStatus.COMPLETED) {
                    // Already processed by another execution - skip
                    log.audit('FC_ProcessDocuments.map.poll', 'Document already processed, skipping');
                    return;
                }

                // Still in processing but URL is gone - mark as error
                record.submitFields({
                    type: 'customrecord_flux_document',
                    id: documentId,
                    values: {
                        'custrecord_flux_status': DocStatus.ERROR,
                        'custrecord_flux_error_message': 'Processing interrupted - operation URL lost',
                        'custrecord_flux_operation_url': '',
                        'custrecord_flux_poll_count': 0
                    }
                });
                return;
            }

            log.audit('FC_ProcessDocuments.map.poll', {
                documentId: documentId,
                operationUrl: currentOperationUrl.substring(0, 50) + '...',
                startPollCount: currentPollCount
            });

            const pollResult = provider.pollWithLimit(currentOperationUrl, {
                maxAttempts: POLLING_CONFIG.MAX_ATTEMPTS_PER_RUN,
                startAttempt: currentPollCount,
                maxTotalAttempts: POLLING_CONFIG.MAX_TOTAL_ATTEMPTS
            });

            // Update poll count
            const newPollCount = pollResult.totalAttempts;

            if (pollResult.status === 'succeeded') {
                // Phase 3: Process the extraction result
                log.audit('FC_ProcessDocuments.map.succeeded', {
                    documentId: documentId,
                    totalAttempts: newPollCount
                });

                const startTime = Date.now();

                // Use FC_Engine to process the raw result
                const result = engine.processWithRawResult(pollResult.result, {
                    documentType: documentType,
                    enableVendorMatching: true,
                    maxExtractionPages: maxExtractionPages
                });

                const processingTime = Date.now() - startTime;

                if (result.success) {
                    const extraction = result.extraction;

                    // Update document with extracted data
                    const updateValues = buildUpdateValues(extraction, documentType, processingTime);

                    // Clear operation URL and poll count (no longer needed)
                    updateValues['custrecord_flux_operation_url'] = '';
                    updateValues['custrecord_flux_poll_count'] = 0;

                    record.submitFields({
                        type: 'customrecord_flux_document',
                        id: documentId,
                        values: updateValues
                    });

                    context.write({
                        key: documentId,
                        value: {
                            success: true,
                            status: DocStatus.NEEDS_REVIEW,
                            confidence: extraction.confidence.overall,
                            processingTime: processingTime,
                            totalPollAttempts: newPollCount
                        }
                    });
                } else {
                    // FC_Engine processing failed
                    record.submitFields({
                        type: 'customrecord_flux_document',
                        id: documentId,
                        values: {
                            'custrecord_flux_status': DocStatus.ERROR,
                            'custrecord_flux_error_message': result.error || 'Processing failed',
                            'custrecord_flux_operation_url': '',
                            'custrecord_flux_poll_count': 0
                        }
                    });

                    context.write({
                        key: documentId,
                        value: { success: false, error: result.error }
                    });
                }

            } else if (pollResult.status === 'running') {
                // Still running - save state for next MR run
                log.audit('FC_ProcessDocuments.map.stillRunning', {
                    documentId: documentId,
                    pollCount: newPollCount,
                    needsContinuation: true
                });

                record.submitFields({
                    type: 'customrecord_flux_document',
                    id: documentId,
                    values: {
                        'custrecord_flux_poll_count': newPollCount
                    }
                });

                context.write({
                    key: documentId,
                    value: {
                        success: true,
                        needsContinuation: true,
                        pollCount: newPollCount
                    }
                });

            } else {
                // Failed (timeout or error)
                log.error('FC_ProcessDocuments.map.failed', {
                    documentId: documentId,
                    error: pollResult.error,
                    totalAttempts: newPollCount
                });

                record.submitFields({
                    type: 'customrecord_flux_document',
                    id: documentId,
                    values: {
                        'custrecord_flux_status': DocStatus.ERROR,
                        'custrecord_flux_error_message': pollResult.error || 'Azure extraction failed',
                        'custrecord_flux_operation_url': '',
                        'custrecord_flux_poll_count': 0
                    }
                });

                context.write({
                    key: documentId,
                    value: { success: false, error: pollResult.error }
                });
            }

        } catch (e) {
            log.error('FC_ProcessDocuments.map.exception', {
                documentId: documentId,
                error: e.message,
                stack: e.stack
            });

            try {
                record.submitFields({
                    type: 'customrecord_flux_document',
                    id: documentId,
                    values: {
                        'custrecord_flux_status': DocStatus.ERROR,
                        'custrecord_flux_error_message': e.message,
                        'custrecord_flux_operation_url': '',
                        'custrecord_flux_poll_count': 0
                    }
                });
            } catch (updateErr) {
                log.error('FC_ProcessDocuments.map.updateError', updateErr);
            }

            context.write({
                key: documentId,
                value: { success: false, error: e.message }
            });
        }
    }

    /**
     * Build update values object from extraction result
     */
    function buildUpdateValues(extraction, documentType, processingTime) {
        const invoiceDate = parseExtractedDate(extraction.fields?.invoiceDate);
        const dueDate = parseExtractedDate(extraction.fields?.dueDate);

        const updateValues = {
            'custrecord_flux_status': DocStatus.NEEDS_REVIEW,
            'custrecord_flux_document_type': extraction.documentType || documentType,
            'custrecord_flux_vendor': extraction.vendorMatch?.vendorId || null,
            'custrecord_flux_vendor_match_confidence': extraction.vendorMatch?.confidence || 0,
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
            'custrecord_flux_processing_time': processingTime,
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
        extractedDataObj._confidence = extraction.confidence;
        extractedDataObj._vendorMatch = extraction.vendorMatch;
        extractedDataObj._extractedAt = new Date().toISOString();

        // Include AI verification data if present
        if (extraction.aiVerification) {
            extractedDataObj.aiVerification = extraction.aiVerification;
        }

        updateValues['custrecord_flux_extracted_data'] = JSON.stringify(extractedDataObj);

        // Currency
        if (extraction.fields?.currency) {
            const currencyVal = extraction.fields.currency;
            if (typeof currencyVal === 'number' || (typeof currencyVal === 'string' && /^\d+$/.test(currencyVal))) {
                updateValues['custrecord_flux_currency'] = parseInt(currencyVal, 10);
            }
        }

        return updateValues;
    }

    /**
     * Summarize results and chain another MR run if needed
     */
    function summarize(summary) {
        let processed = 0;
        let succeeded = 0;
        let failed = 0;
        let skipped = 0;
        let needsContinuation = 0;

        summary.output.iterator().each(function(key, value) {
            processed++;
            const result = JSON.parse(value);
            if (result.skipped) {
                skipped++;
            } else if (result.needsContinuation) {
                needsContinuation++;
            } else if (result.success) {
                succeeded++;
            } else {
                failed++;
            }
            return true;
        });

        log.audit('FC_ProcessDocuments.summarize', {
            totalProcessed: processed,
            succeeded: succeeded,
            failed: failed,
            skipped: skipped,
            needsContinuation: needsContinuation,
            totalTime: summary.seconds + 's'
        });

        // Log any errors
        summary.mapSummary.errors.iterator().each(function(key, error) {
            log.error('FC_ProcessDocuments.mapError', {
                documentId: key,
                error: error
            });
            return true;
        });

        // Chain to Scheduled Script if any documents need continued polling
        // Using SS instead of self-chaining avoids "no idle deployment" errors
        if (needsContinuation > 0) {
            log.audit('FC_ProcessDocuments.summarize.triggerSS', {
                needsContinuation: needsContinuation,
                triggeringScheduledScript: true
            });

            try {
                // Create a task for the continuation polling Scheduled Script
                // This is a DIFFERENT script, so no deployment conflict
                const ssTask = task.create({
                    taskType: task.TaskType.SCHEDULED_SCRIPT,
                    scriptId: 'customscript_fc_continue_polling',
                    deploymentId: 'customdeploy_fc_continue_polling'
                });

                const taskId = ssTask.submit();

                log.audit('FC_ProcessDocuments.summarize.ssTriggered', {
                    taskId: taskId,
                    forDocuments: needsContinuation
                });

            } catch (chainErr) {
                // If we can't trigger SS (e.g., task already queued), that's OK
                // The SS can be triggered again later or manually
                log.error('FC_ProcessDocuments.summarize.ssError', {
                    message: chainErr.message,
                    note: 'Continuation polling will resume when SS is next triggered'
                });
            }
        }

        // Check for new PENDING documents that arrived while we were processing
        // This handles the race condition where uploads complete after getInputData runs
        const pendingCount = checkForNewPendingDocuments();
        if (pendingCount > 0) {
            log.audit('FC_ProcessDocuments.summarize.newPending', {
                pendingDocuments: pendingCount,
                triggeringAnotherMRRun: true
            });

            try {
                const mrTask = task.create({
                    taskType: task.TaskType.MAP_REDUCE,
                    scriptId: runtime.getCurrentScript().id,
                    deploymentId: runtime.getCurrentScript().deploymentId
                });

                const taskId = mrTask.submit();

                log.audit('FC_ProcessDocuments.summarize.mrChained', {
                    taskId: taskId,
                    forPendingDocuments: pendingCount
                });

            } catch (chainErr) {
                // Expected if MR deployment is queued - that's fine, docs will be picked up
                log.debug('FC_ProcessDocuments.summarize.mrChainSkipped', {
                    message: chainErr.message,
                    note: 'MR already queued or will be triggered by next upload'
                });
            }
        }
    }

    /**
     * Check if there are new PENDING documents that need processing
     */
    function checkForNewPendingDocuments() {
        const pendingSearch = search.create({
            type: 'customrecord_flux_document',
            filters: [
                ['custrecord_flux_status', 'is', DocStatus.PENDING]
            ],
            columns: ['internalid']
        });

        let count = 0;
        pendingSearch.run().each(function() {
            count++;
            return count < 100; // Cap at 100 for performance
        });

        return count;
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

    return {
        getInputData: getInputData,
        map: map,
        summarize: summarize
    };

});
