/**
 * @NApiVersion 2.1
 * @NScriptType MapReduceScript
 * @NModuleScope SameAccount
 * 
 * Flux Capture - Batch Document Processor
 * High-performance parallel processing of document batches
 * 
 * Features:
 * - Parallel OCR extraction across multiple documents
 * - Intelligent workload distribution
 * - Progress tracking and resumability
 * - Error handling and retry logic
 * - Auto-approval for high-confidence extractions
 */

define([
    'N/record',
    'N/search',
    'N/query',
    'N/file',
    'N/task',
    'N/runtime',
    'N/email',
    'N/log',
    './library/DM_DocumentIntelligenceEngine'
], function(record, search, query, file, task, runtime, email, log, Engine) {

    const BATCH_SIZE = 50; // Documents per map phase
    const MAX_RETRIES = 3;
    const AUTO_APPROVE_THRESHOLD = 85;

    /**
     * Get Input Data - Retrieves documents to process
     * 
     * If a batch ID is provided, processes that batch
     * Otherwise, processes all pending documents
     */
    function getInputData(context) {
        const script = runtime.getCurrentScript();
        const batchId = script.getParameter('custscript_dm_batch_id');
        const processAll = script.getParameter('custscript_dm_process_all');
        const documentIds = script.getParameter('custscript_dm_document_ids');
        
        log.audit('GetInputData', {
            batchId: batchId,
            processAll: processAll,
            documentIds: documentIds
        });
        
        // If specific document IDs provided
        if (documentIds) {
            const ids = JSON.parse(documentIds);
            return ids.map(id => ({ documentId: id }));
        }
        
        // Build search for documents to process
        const filters = [
            ['custrecord_dm_status', 'anyof', ['pending']]
        ];
        
        if (batchId) {
            filters.push('AND');
            filters.push(['custrecord_dm_batch', 'is', batchId]);
        }
        
        // Use search to get documents
        return search.create({
            type: 'customrecord_dm_captured_document',
            filters: filters,
            columns: [
                'internalid',
                'custrecord_dm_file_id',
                'custrecord_dm_file_name',
                'custrecord_dm_document_type',
                'custrecord_dm_batch',
                'custrecord_dm_retry_count'
            ]
        });
    }

    /**
     * Map Phase - Process individual documents
     * 
     * Each document is processed in parallel:
     * 1. Load file from File Cabinet
     * 2. Run OCR extraction
     * 3. Perform fraud detection
     * 4. Calculate confidence
     * 5. Update document record
     */
    function map(context) {
        const searchResult = JSON.parse(context.value);
        const documentId = searchResult.id;
        
        log.debug('Map - Processing Document', documentId);
        
        try {
            // Mark as processing
            record.submitFields({
                type: 'customrecord_dm_captured_document',
                id: documentId,
                values: {
                    'custrecord_dm_status': 'processing',
                    'custrecord_dm_processing_started': new Date()
                }
            });
            
            // Load document details
            const docRecord = record.load({
                type: 'customrecord_dm_captured_document',
                id: documentId
            });
            
            const fileId = docRecord.getValue('custrecord_dm_file_id');
            const fileName = docRecord.getValue('custrecord_dm_file_name');
            const documentType = docRecord.getValue('custrecord_dm_document_type') || 'auto';
            const batchId = docRecord.getValue('custrecord_dm_batch');
            const retryCount = parseInt(docRecord.getValue('custrecord_dm_retry_count')) || 0;
            
            if (!fileId) {
                throw new Error('No file attached to document');
            }
            
            // Initialize processing engine
            const engine = new Engine.DocumentCaptureEngine();
            
            // Process document
            const result = engine.processDocument(fileId, {
                mode: 'sync',
                documentType: documentType,
                enableFraudDetection: true,
                enableLearning: true
            });
            
            if (result.success) {
                const extraction = result.extraction;
                
                // Determine status based on confidence and anomalies
                let newStatus = 'needs_review';
                let autoApproved = false;
                
                if (extraction.confidence.overall >= AUTO_APPROVE_THRESHOLD && 
                    extraction.anomalies.length === 0 &&
                    extraction.vendorMatch?.confidence >= 0.8) {
                    newStatus = 'extracted';
                    autoApproved = true;
                }
                
                // Update document record
                record.submitFields({
                    type: 'customrecord_dm_captured_document',
                    id: documentId,
                    values: {
                        'custrecord_dm_status': newStatus,
                        'custrecord_dm_document_type': extraction.documentType,
                        'custrecord_dm_extracted_data': JSON.stringify(extraction.fields),
                        'custrecord_dm_line_items': JSON.stringify(extraction.lineItems),
                        'custrecord_dm_anomalies': JSON.stringify(extraction.anomalies),
                        'custrecord_dm_confidence': extraction.confidence.overall,
                        'custrecord_dm_confidence_details': JSON.stringify(extraction.confidence),
                        'custrecord_dm_vendor': extraction.vendorMatch?.vendorId || null,
                        'custrecord_dm_vendor_suggestions': JSON.stringify(extraction.vendorMatch?.suggestions || []),
                        'custrecord_dm_po_matches': JSON.stringify(extraction.poMatches || []),
                        'custrecord_dm_processed_date': new Date(),
                        'custrecord_dm_processing_time': calculateProcessingTime(docRecord)
                    }
                });
                
                // Write result for reduce phase
                context.write({
                    key: batchId || 'no-batch',
                    value: {
                        documentId: documentId,
                        success: true,
                        status: newStatus,
                        confidence: extraction.confidence.overall,
                        autoApproved: autoApproved,
                        anomalyCount: extraction.anomalies.length,
                        vendorId: extraction.vendorMatch?.vendorId,
                        totalAmount: extraction.fields?.totalAmount
                    }
                });
                
            } else {
                throw new Error(result.error || 'Extraction failed');
            }
            
        } catch (e) {
            log.error('Map - Document Processing Error', {
                documentId: documentId,
                error: e.message,
                stack: e.stack
            });
            
            // Check retry count
            const docRecord = record.load({
                type: 'customrecord_dm_captured_document',
                id: documentId
            });
            
            const currentRetries = parseInt(docRecord.getValue('custrecord_dm_retry_count')) || 0;
            const batchId = docRecord.getValue('custrecord_dm_batch');
            
            if (currentRetries < MAX_RETRIES) {
                // Mark for retry
                record.submitFields({
                    type: 'customrecord_dm_captured_document',
                    id: documentId,
                    values: {
                        'custrecord_dm_status': 'pending',
                        'custrecord_dm_retry_count': currentRetries + 1,
                        'custrecord_dm_last_error': e.message
                    }
                });
            } else {
                // Max retries reached - mark as error
                record.submitFields({
                    type: 'customrecord_dm_captured_document',
                    id: documentId,
                    values: {
                        'custrecord_dm_status': 'error',
                        'custrecord_dm_last_error': `Failed after ${MAX_RETRIES} retries: ${e.message}`
                    }
                });
            }
            
            // Write failure for reduce phase
            context.write({
                key: batchId || 'no-batch',
                value: {
                    documentId: documentId,
                    success: false,
                    error: e.message,
                    retryable: currentRetries < MAX_RETRIES
                }
            });
        }
    }

    /**
     * Reduce Phase - Aggregate batch results
     * 
     * Groups results by batch and:
     * 1. Updates batch progress
     * 2. Calculates batch statistics
     * 3. Triggers notifications if needed
     * 4. Auto-approves high-confidence documents
     */
    function reduce(context) {
        const batchId = context.key;
        const results = context.values.map(v => JSON.parse(v));
        
        log.debug('Reduce - Aggregating Results', {
            batchId: batchId,
            documentCount: results.length
        });
        
        // Calculate statistics
        const stats = {
            total: results.length,
            successful: results.filter(r => r.success).length,
            failed: results.filter(r => !r.success).length,
            autoApproved: results.filter(r => r.autoApproved).length,
            needsReview: results.filter(r => r.success && !r.autoApproved).length,
            withAnomalies: results.filter(r => r.anomalyCount > 0).length,
            totalValue: results.reduce((sum, r) => sum + (parseFloat(r.totalAmount) || 0), 0),
            avgConfidence: 0
        };
        
        const confidences = results.filter(r => r.confidence).map(r => r.confidence);
        if (confidences.length > 0) {
            stats.avgConfidence = Math.round(confidences.reduce((a, b) => a + b, 0) / confidences.length);
        }
        
        // Update batch record if applicable
        if (batchId && batchId !== 'no-batch') {
            try {
                const batchRecord = record.load({
                    type: 'customrecord_dm_batch',
                    id: batchId
                });
                
                const currentProcessed = parseInt(batchRecord.getValue('custrecord_dm_batch_processed_count')) || 0;
                const totalDocs = parseInt(batchRecord.getValue('custrecord_dm_batch_document_count')) || 0;
                const newProcessed = currentProcessed + stats.total;
                
                const updates = {
                    'custrecord_dm_batch_processed_count': newProcessed,
                    'custrecord_dm_batch_successful_count': stats.successful,
                    'custrecord_dm_batch_failed_count': stats.failed,
                    'custrecord_dm_batch_avg_confidence': stats.avgConfidence,
                    'custrecord_dm_batch_total_value': stats.totalValue
                };
                
                // Check if batch is complete
                if (newProcessed >= totalDocs) {
                    updates['custrecord_dm_batch_status'] = 'completed';
                    updates['custrecord_dm_batch_completed_date'] = new Date();
                }
                
                record.submitFields({
                    type: 'customrecord_dm_batch',
                    id: batchId,
                    values: updates
                });
                
            } catch (e) {
                log.error('Reduce - Batch Update Error', e);
            }
        }
        
        // Auto-approve high-confidence documents
        const autoApproveIds = results
            .filter(r => r.autoApproved && r.vendorId)
            .map(r => r.documentId);
        
        if (autoApproveIds.length > 0) {
            autoApproveDocuments(autoApproveIds);
        }
        
        // Write final statistics
        context.write({
            key: 'stats',
            value: {
                batchId: batchId,
                stats: stats
            }
        });
    }

    /**
     * Summarize Phase - Final processing and notifications
     */
    function summarize(context) {
        log.audit('Summarize - Processing Complete', {
            dateCreated: context.dateCreated,
            seconds: context.seconds,
            usage: context.usage
        });
        
        // Log any errors
        context.mapSummary.errors.iterator().each((key, error) => {
            log.error('Map Error', { key: key, error: error });
            return true;
        });
        
        context.reduceSummary.errors.iterator().each((key, error) => {
            log.error('Reduce Error', { key: key, error: error });
            return true;
        });
        
        // Collect final statistics
        const finalStats = {
            totalProcessed: 0,
            successful: 0,
            failed: 0,
            autoApproved: 0,
            batches: []
        };
        
        context.output.iterator().each((key, value) => {
            if (key === 'stats') {
                const data = JSON.parse(value);
                finalStats.totalProcessed += data.stats.total;
                finalStats.successful += data.stats.successful;
                finalStats.failed += data.stats.failed;
                finalStats.autoApproved += data.stats.autoApproved;
                if (data.batchId && data.batchId !== 'no-batch') {
                    finalStats.batches.push({
                        batchId: data.batchId,
                        stats: data.stats
                    });
                }
            }
            return true;
        });
        
        log.audit('Final Statistics', finalStats);
        
        // Send notification email if configured
        sendCompletionNotification(finalStats);
        
        // Check if there are more pending documents and reschedule if needed
        checkAndReschedule();
    }

    /**
     * Auto-approve high-confidence documents and create transactions
     */
    function autoApproveDocuments(documentIds) {
        const engine = new Engine.DocumentCaptureEngine();
        const transactionCreator = new Engine.TransactionCreator();
        
        documentIds.forEach(documentId => {
            try {
                const docRecord = record.load({
                    type: 'customrecord_dm_captured_document',
                    id: documentId
                });
                
                const extractedData = JSON.parse(docRecord.getValue('custrecord_dm_extracted_data') || '{}');
                const lineItems = JSON.parse(docRecord.getValue('custrecord_dm_line_items') || '[]');
                const documentType = docRecord.getValue('custrecord_dm_document_type');
                const vendorId = docRecord.getValue('custrecord_dm_vendor');
                const fileId = docRecord.getValue('custrecord_dm_file_id');
                
                // Determine transaction type
                let transactionType = 'vendorbill';
                if (documentType === 'expense' || documentType === 'receipt') {
                    transactionType = 'expensereport';
                } else if (documentType === 'credit_memo') {
                    transactionType = 'vendorcredit';
                }
                
                // Create transaction
                let result;
                switch (transactionType) {
                    case 'vendorbill':
                        result = transactionCreator.createVendorBill({
                            vendorId: vendorId,
                            invoiceNumber: extractedData.invoiceNumber,
                            invoiceDate: extractedData.invoiceDate,
                            dueDate: extractedData.dueDate,
                            currency: extractedData.currency,
                            lineItems: lineItems,
                            memo: `Flux Capture Auto-Import - ${docRecord.getValue('custrecord_dm_file_name')}`,
                            attachFileId: fileId
                        });
                        break;
                        
                    case 'expensereport':
                        result = transactionCreator.createExpenseReport({
                            employeeId: runtime.getCurrentUser().id,
                            expenseDate: extractedData.invoiceDate || new Date(),
                            lineItems: lineItems,
                            memo: extractedData.invoiceNumber || 'Flux Capture Auto-Import',
                            attachFileId: fileId
                        });
                        break;
                        
                    case 'vendorcredit':
                        result = transactionCreator.createVendorCredit({
                            vendorId: vendorId,
                            creditNumber: extractedData.invoiceNumber,
                            creditDate: extractedData.invoiceDate,
                            currency: extractedData.currency,
                            lineItems: lineItems,
                            memo: `Flux Capture Auto-Import - ${docRecord.getValue('custrecord_dm_file_name')}`,
                            attachFileId: fileId
                        });
                        break;
                }
                
                if (result && result.success) {
                    // Update document as completed
                    record.submitFields({
                        type: 'customrecord_dm_captured_document',
                        id: documentId,
                        values: {
                            'custrecord_dm_status': 'completed',
                            'custrecord_dm_created_transaction': result.transactionId,
                            'custrecord_dm_transaction_type': transactionType,
                            'custrecord_dm_auto_approved': true,
                            'custrecord_dm_reviewed_date': new Date()
                        }
                    });
                    
                    log.audit('Auto-Approved Document', {
                        documentId: documentId,
                        transactionId: result.transactionId,
                        transactionType: transactionType
                    });
                } else {
                    // Transaction creation failed - mark for review
                    record.submitFields({
                        type: 'customrecord_dm_captured_document',
                        id: documentId,
                        values: {
                            'custrecord_dm_status': 'needs_review',
                            'custrecord_dm_last_error': result?.error || 'Transaction creation failed'
                        }
                    });
                }
                
            } catch (e) {
                log.error('Auto-Approve Error', {
                    documentId: documentId,
                    error: e.message
                });
                
                record.submitFields({
                    type: 'customrecord_dm_captured_document',
                    id: documentId,
                    values: {
                        'custrecord_dm_status': 'needs_review',
                        'custrecord_dm_last_error': e.message
                    }
                });
            }
        });
    }

    /**
     * Send completion notification email
     */
    function sendCompletionNotification(stats) {
        try {
            // Check if notifications are enabled
            const settingsSearch = search.create({
                type: 'customrecord_dm_settings',
                filters: [],
                columns: [
                    'custrecord_dm_notify_complete',
                    'custrecord_dm_notify_recipients'
                ]
            });
            
            const settingsResults = settingsSearch.run().getRange({ start: 0, end: 1 });
            
            if (settingsResults.length === 0) return;
            
            const notifyEnabled = settingsResults[0].getValue('custrecord_dm_notify_complete');
            const recipientsStr = settingsResults[0].getValue('custrecord_dm_notify_recipients');
            
            if (!notifyEnabled || !recipientsStr) return;
            
            const recipients = recipientsStr.split(',').map(r => r.trim());
            
            // Build email content
            const subject = `Flux Capture Batch Processing Complete - ${stats.totalProcessed} Documents`;
            
            let body = `<h2>Flux Capture Batch Processing Summary</h2>`;
            body += `<table border="1" cellpadding="8" cellspacing="0" style="border-collapse: collapse;">`;
            body += `<tr><td><strong>Total Processed</strong></td><td>${stats.totalProcessed}</td></tr>`;
            body += `<tr><td><strong>Successful</strong></td><td style="color: green;">${stats.successful}</td></tr>`;
            body += `<tr><td><strong>Failed</strong></td><td style="color: red;">${stats.failed}</td></tr>`;
            body += `<tr><td><strong>Auto-Approved</strong></td><td>${stats.autoApproved}</td></tr>`;
            body += `<tr><td><strong>Needs Review</strong></td><td>${stats.successful - stats.autoApproved}</td></tr>`;
            body += `</table>`;
            
            if (stats.batches.length > 0) {
                body += `<h3>Batch Details</h3>`;
                stats.batches.forEach(batch => {
                    body += `<p><strong>Batch ${batch.batchId}:</strong> `;
                    body += `${batch.stats.successful} successful, `;
                    body += `${batch.stats.avgConfidence}% avg confidence</p>`;
                });
            }
            
            body += `<p><a href="/app/site/hosting/scriptlet.nl?script=customscript_dm_main&deploy=customdeploy_dm_main">View Flux Capture Dashboard</a></p>`;
            
            email.send({
                author: runtime.getCurrentUser().id,
                recipients: recipients,
                subject: subject,
                body: body
            });
            
        } catch (e) {
            log.debug('Notification send failed', e.message);
        }
    }

    /**
     * Check for more pending documents and reschedule if needed
     */
    function checkAndReschedule() {
        try {
            const pendingSearch = search.create({
                type: 'customrecord_dm_captured_document',
                filters: [
                    ['custrecord_dm_status', 'is', 'pending']
                ],
                columns: [search.createColumn({ name: 'internalid', summary: search.Summary.COUNT })]
            });
            
            const results = pendingSearch.run().getRange({ start: 0, end: 1 });
            const pendingCount = results.length > 0 ? parseInt(results[0].getValue({ name: 'internalid', summary: search.Summary.COUNT })) : 0;
            
            if (pendingCount > 0) {
                log.audit('Rescheduling', `${pendingCount} documents still pending`);
                
                // Schedule another run
                const mrTask = task.create({
                    taskType: task.TaskType.MAP_REDUCE,
                    scriptId: runtime.getCurrentScript().id,
                    deploymentId: runtime.getCurrentScript().deploymentId
                });
                
                mrTask.submit();
            }
        } catch (e) {
            log.debug('Reschedule check failed', e.message);
        }
    }

    /**
     * Calculate processing time in seconds
     */
    function calculateProcessingTime(docRecord) {
        const startTime = docRecord.getValue('custrecord_dm_processing_started');
        if (!startTime) return 0;
        
        const start = new Date(startTime);
        const end = new Date();
        return Math.round((end - start) / 1000);
    }

    return {
        getInputData: getInputData,
        map: map,
        reduce: reduce,
        summarize: summarize
    };
});
