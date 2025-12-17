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
     * Get documents that need processing
     */
    function getInputData() {
        log.audit('FC_ProcessDocuments', 'Starting document processing job');

        return search.create({
            type: 'customrecord_dm_captured_document',
            filters: [
                ['custrecord_dm_status', 'is', DocStatus.PENDING]
            ],
            columns: [
                'internalid',
                'custrecord_dm_source_file',
                'custrecord_dm_document_type',
                'custrecord_dm_document_id'
            ]
        });
    }

    /**
     * Process each document
     */
    function map(context) {
        const searchResult = JSON.parse(context.value);
        const documentId = searchResult.id;
        const fileId = searchResult.values.custrecord_dm_source_file.value;
        const documentType = searchResult.values.custrecord_dm_document_type || 1;
        const docCode = searchResult.values.custrecord_dm_document_id;

        log.audit('FC_ProcessDocuments.map', {
            documentId: documentId,
            fileId: fileId,
            docCode: docCode
        });

        try {
            // Mark as processing
            record.submitFields({
                type: 'customrecord_dm_captured_document',
                id: documentId,
                values: {
                    'custrecord_dm_status': DocStatus.PROCESSING
                }
            });

            // Load the file
            const fileObj = file.load({ id: fileId });

            // Process with FC_Engine
            const engine = new FC_Engine.FluxCaptureEngine();
            const startTime = Date.now();

            const result = engine.processDocument(fileObj, {
                documentType: documentType,
                enableVendorMatching: true,
                enableAnomalyDetection: true,
                enableFraudDetection: true,
                enableLearning: true
            });

            const processingTime = Date.now() - startTime;

            if (result.success) {
                const extraction = result.extraction;

                let newStatus = DocStatus.NEEDS_REVIEW;
                if (extraction.confidence.overall >= 85 && extraction.anomalies.length === 0) {
                    newStatus = DocStatus.EXTRACTED;
                }

                // Parse dates
                const invoiceDate = parseExtractedDate(extraction.fields && extraction.fields.invoiceDate);
                const dueDate = parseExtractedDate(extraction.fields && extraction.fields.dueDate);

                // Update the record with extracted data
                const updateValues = {
                    'custrecord_dm_status': newStatus,
                    'custrecord_dm_document_type': extraction.documentType || documentType,
                    'custrecord_dm_vendor': extraction.vendorMatch && extraction.vendorMatch.vendorId ? extraction.vendorMatch.vendorId : null,
                    'custrecord_dm_vendor_match_confidence': extraction.vendorMatch ? extraction.vendorMatch.confidence : 0,
                    'custrecord_dm_invoice_number': extraction.fields && extraction.fields.invoiceNumber ? extraction.fields.invoiceNumber : '',
                    'custrecord_dm_invoice_date': invoiceDate,
                    'custrecord_dm_due_date': dueDate,
                    'custrecord_dm_subtotal': extraction.fields && extraction.fields.subtotal ? extraction.fields.subtotal : 0,
                    'custrecord_dm_tax_amount': extraction.fields && extraction.fields.taxAmount ? extraction.fields.taxAmount : 0,
                    'custrecord_dm_total_amount': extraction.fields && extraction.fields.totalAmount ? extraction.fields.totalAmount : 0,
                    'custrecord_dm_po_number': extraction.fields && extraction.fields.poNumber ? extraction.fields.poNumber : '',
                    'custrecord_dm_line_items': JSON.stringify(extraction.lineItems || []),
                    'custrecord_dm_anomalies': JSON.stringify(extraction.anomalies || []),
                    'custrecord_dm_confidence_score': extraction.confidence.overall,
                    'custrecord_dm_amount_validated': extraction.amountValidation ? extraction.amountValidation.valid : false,
                    'custrecord_dm_processing_time': processingTime,
                    'custrecord_dm_modified_date': new Date()
                };

                // Only set currency if it's a numeric ID
                if (extraction.fields && extraction.fields.currency) {
                    const currencyVal = extraction.fields.currency;
                    if (typeof currencyVal === 'number' || (typeof currencyVal === 'string' && /^\d+$/.test(currencyVal))) {
                        updateValues['custrecord_dm_currency'] = parseInt(currencyVal, 10);
                    }
                }

                record.submitFields({
                    type: 'customrecord_dm_captured_document',
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
                    type: 'customrecord_dm_captured_document',
                    id: documentId,
                    values: {
                        'custrecord_dm_status': DocStatus.ERROR,
                        'custrecord_dm_error_message': result.error || 'Unknown processing error'
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
                    type: 'customrecord_dm_captured_document',
                    id: documentId,
                    values: {
                        'custrecord_dm_status': DocStatus.ERROR,
                        'custrecord_dm_error_message': e.message
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

        summary.output.iterator().each(function(key, value) {
            processed++;
            const result = JSON.parse(value);
            if (result.success) {
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
