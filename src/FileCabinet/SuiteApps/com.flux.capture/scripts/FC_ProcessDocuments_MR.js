/**
 * @NApiVersion 2.1
 * @NScriptType MapReduceScript
 * @NModuleScope SameAccount
 *
 * Flux Capture - Document Processing Map/Reduce
 * Processes documents asynchronously using N/documentCapture
 */

define([
    'N/record',
    'N/file',
    'N/search',
    'N/query',
    'N/log',
    'N/runtime',
    '/SuiteApps/com.flux.capture/lib/FC_Engine'
], function(record, file, search, query, log, runtime, FC_Engine) {

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
     * Get documents that need processing
     */
    function getInputData() {
        log.audit('FC_ProcessDocuments', 'Starting document processing job');

        return search.create({
            type: 'customrecord_flux_document',
            filters: [
                ['custrecord_flux_status', 'is', DocStatus.PENDING]
            ],
            columns: [
                'internalid',
                'custrecord_flux_source_file',
                'custrecord_flux_document_type',
                'custrecord_flux_document_id'
            ]
        });
    }

    /**
     * Process each document
     */
    function map(context) {
        const searchResult = JSON.parse(context.value);
        const documentId = searchResult.id;
        const fileId = searchResult.values.custrecord_flux_source_file.value;
        const documentType = searchResult.values.custrecord_flux_document_type || 1;
        const docCode = searchResult.values.custrecord_flux_document_id;

        log.audit('FC_ProcessDocuments.map', {
            documentId: documentId,
            fileId: fileId,
            docCode: docCode
        });

        try {
            // CRITICAL: Check if document is still PENDING before processing
            // This prevents race conditions when multiple MapReduce tasks run concurrently
            // (each upload triggers a new task, and they may overlap)
            // Use a search with filter (same approach as getInputData) for reliable status check
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
                // Document already claimed by another task or already processed
                log.audit('FC_ProcessDocuments.map.skip', {
                    documentId: documentId,
                    docCode: docCode,
                    reason: 'Document no longer PENDING - already being processed by another task'
                });
                // Write a skip result so summarize() knows this was intentional
                context.write({
                    key: documentId,
                    value: {
                        success: true,
                        skipped: true,
                        reason: 'Already processing or processed'
                    }
                });
                return;
            }

            // Mark as processing
            record.submitFields({
                type: 'customrecord_flux_document',
                id: documentId,
                values: {
                    'custrecord_flux_status': DocStatus.PROCESSING
                }
            });

            // Load settings to get maxExtractionPages
            const settings = loadSettings();
            const maxExtractionPages = settings.maxExtractionPages || 0;

            // Process with FC_Engine (pass fileId, not file object - engine loads it internally)
            const engine = new FC_Engine.FluxCaptureEngine();
            const startTime = Date.now();

            const result = engine.processDocument(fileId, {
                documentType: documentType,
                enableVendorMatching: true,
                enableAnomalyDetection: true,
                enableFraudDetection: true,
                enableLearning: true,
                maxExtractionPages: maxExtractionPages
            });

            const processingTime = Date.now() - startTime;

            if (result.success) {
                const extraction = result.extraction;

                // Always require manual review regardless of confidence score
                let newStatus = DocStatus.NEEDS_REVIEW;

                // Parse dates
                const invoiceDate = parseExtractedDate(extraction.fields && extraction.fields.invoiceDate);
                const dueDate = parseExtractedDate(extraction.fields && extraction.fields.dueDate);

                // Update the record with extracted data
                const updateValues = {
                    'custrecord_flux_status': newStatus,
                    'custrecord_flux_document_type': extraction.documentType || documentType,
                    'custrecord_flux_vendor': extraction.vendorMatch && extraction.vendorMatch.vendorId ? extraction.vendorMatch.vendorId : null,
                    'custrecord_flux_vendor_match_confidence': extraction.vendorMatch ? extraction.vendorMatch.confidence : 0,
                    'custrecord_flux_invoice_number': extraction.fields && extraction.fields.invoiceNumber ? extraction.fields.invoiceNumber : '',
                    'custrecord_flux_invoice_date': invoiceDate,
                    'custrecord_flux_due_date': dueDate,
                    'custrecord_flux_subtotal': extraction.fields && extraction.fields.subtotal ? extraction.fields.subtotal : 0,
                    'custrecord_flux_tax_amount': extraction.fields && extraction.fields.taxAmount ? extraction.fields.taxAmount : 0,
                    'custrecord_flux_total_amount': extraction.fields && extraction.fields.totalAmount ? extraction.fields.totalAmount : 0,
                    'custrecord_flux_po_number': extraction.fields && extraction.fields.poNumber ? extraction.fields.poNumber : '',
                    'custrecord_flux_payment_terms': extraction.fields && extraction.fields.paymentTerms ? extraction.fields.paymentTerms : '',
                    'custrecord_flux_line_items': JSON.stringify(extraction.lineItems || []),
                    'custrecord_flux_anomalies': JSON.stringify(extraction.anomalies || []),
                    'custrecord_flux_confidence_score': extraction.confidence.overall,
                    'custrecord_flux_amount_validated': extraction.amountValidation ? extraction.amountValidation.valid : false,
                    'custrecord_flux_processing_time': processingTime,
                    'custrecord_flux_modified_date': new Date()
                };

                // Build and store ALL extracted data as JSON for flexible field mapping
                // This enables the extraction pool UI for mapping any extracted field to form fields
                const extractedDataObj = {};

                // Include all fields from extraction
                if (extraction.fields) {
                    Object.keys(extraction.fields).forEach(function(key) {
                        extractedDataObj[key] = extraction.fields[key];
                    });
                }

                // Include vendor info
                extractedDataObj.vendorName = extraction.vendorMatch ? extraction.vendorMatch.vendorName : '';
                extractedDataObj.vendor = extraction.vendorMatch ? extraction.vendorMatch.vendorId : '';

                // Include all raw extracted label/value pairs for flexible suggestions
                if (extraction.allExtractedFields) {
                    extractedDataObj._allExtractedFields = extraction.allExtractedFields;
                }

                // Include field confidences
                if (extraction.fieldConfidences) {
                    extractedDataObj._fieldConfidences = extraction.fieldConfidences;
                }

                // Metadata
                extractedDataObj._confidence = extraction.confidence;
                extractedDataObj._vendorMatch = extraction.vendorMatch;
                extractedDataObj._extractedAt = new Date().toISOString();

                updateValues['custrecord_flux_extracted_data'] = JSON.stringify(extractedDataObj);
                // Note: custrecord_flux_form_data is NOT set here - it's only populated when user saves form edits

                // Only set currency if it's a numeric ID
                if (extraction.fields && extraction.fields.currency) {
                    const currencyVal = extraction.fields.currency;
                    if (typeof currencyVal === 'number' || (typeof currencyVal === 'string' && /^\d+$/.test(currencyVal))) {
                        updateValues['custrecord_flux_currency'] = parseInt(currencyVal, 10);
                    }
                }

                record.submitFields({
                    type: 'customrecord_flux_document',
                    id: documentId,
                    values: updateValues
                });

                context.write({
                    key: documentId,
                    value: {
                        success: true,
                        status: newStatus,
                        confidence: extraction.confidence.overall,
                        processingTime: processingTime
                    }
                });
            } else {
                // Processing failed
                record.submitFields({
                    type: 'customrecord_flux_document',
                    id: documentId,
                    values: {
                        'custrecord_flux_status': DocStatus.ERROR,
                        'custrecord_flux_error_message': result.error || 'Unknown processing error'
                    }
                });

                context.write({
                    key: documentId,
                    value: {
                        success: false,
                        error: result.error
                    }
                });
            }

        } catch (e) {
            log.error('FC_ProcessDocuments.map', {
                documentId: documentId,
                error: e.message,
                stack: e.stack
            });

            // Mark as error
            try {
                record.submitFields({
                    type: 'customrecord_flux_document',
                    id: documentId,
                    values: {
                        'custrecord_flux_status': DocStatus.ERROR,
                        'custrecord_flux_error_message': e.message
                    }
                });
            } catch (updateErr) {
                log.error('FC_ProcessDocuments.map.updateError', updateErr);
            }

            context.write({
                key: documentId,
                value: {
                    success: false,
                    error: e.message
                }
            });
        }
    }

    /**
     * Summarize results
     */
    function summarize(summary) {
        let processed = 0;
        let succeeded = 0;
        let failed = 0;
        let skipped = 0;

        summary.output.iterator().each(function(key, value) {
            processed++;
            const result = JSON.parse(value);
            if (result.skipped) {
                skipped++;
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
