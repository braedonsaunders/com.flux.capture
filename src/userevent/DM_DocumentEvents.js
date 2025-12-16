/**
 * @NApiVersion 2.1
 * @NScriptType UserEventScript
 * @NModuleScope SameAccount
 * 
 * DocuMind - Document Events
 * User Event script for automating document capture workflows
 * Handles events on captured documents and related transactions
 */

define(['N/record', 'N/search', 'N/runtime', 'N/email', 'N/render', 'N/file', 'N/task', 'N/log', 'N/format'],
    function(record, search, runtime, email, render, file, task, log, format) {

    /**
     * Document status constants
     */
    const DocumentStatus = {
        PENDING: 'pending',
        PROCESSING: 'processing',
        EXTRACTED: 'extracted',
        NEEDS_REVIEW: 'needs_review',
        APPROVED: 'approved',
        REJECTED: 'rejected',
        COMPLETED: 'completed',
        ERROR: 'error'
    };

    /**
     * Notification types
     */
    const NotificationType = {
        DOCUMENT_READY: 'document_ready',
        REVIEW_REQUIRED: 'review_required',
        ANOMALY_DETECTED: 'anomaly_detected',
        BATCH_COMPLETE: 'batch_complete',
        ERROR_OCCURRED: 'error_occurred'
    };

    /**
     * Before Load - Prepare document for viewing/editing
     * @param {Object} context - Script context
     */
    function beforeLoad(context) {
        const newRecord = context.newRecord;
        const form = context.form;
        
        try {
            if (context.type === context.UserEventType.VIEW) {
                // Add custom buttons for document actions
                addDocumentActionButtons(form, newRecord);
                
                // Add confidence visualization
                addConfidenceDisplay(form, newRecord);
                
                // Add anomaly warnings
                addAnomalyWarnings(form, newRecord);
            }
            
            if (context.type === context.UserEventType.EDIT) {
                // Lock certain fields based on status
                lockFieldsBasedOnStatus(form, newRecord);
            }
            
            if (context.type === context.UserEventType.CREATE) {
                // Set default values
                setDefaultValues(newRecord);
            }
        } catch (e) {
            log.error({
                title: 'DocuMind - beforeLoad Error',
                details: e.message
            });
        }
    }

    /**
     * Before Submit - Validate and prepare document for save
     * @param {Object} context - Script context
     */
    function beforeSubmit(context) {
        const newRecord = context.newRecord;
        const oldRecord = context.oldRecord;
        
        try {
            if (context.type === context.UserEventType.CREATE) {
                // Validate file attachment
                validateFileAttachment(newRecord);
                
                // Set initial timestamps
                newRecord.setValue({
                    fieldId: 'custrecord_dm_created_date',
                    value: new Date()
                });
                
                // Generate unique document ID
                const docId = generateDocumentId();
                newRecord.setValue({
                    fieldId: 'custrecord_dm_document_id',
                    value: docId
                });
            }
            
            if (context.type === context.UserEventType.EDIT) {
                // Track status changes
                trackStatusChange(newRecord, oldRecord);
                
                // Update modification timestamp
                newRecord.setValue({
                    fieldId: 'custrecord_dm_modified_date',
                    value: new Date()
                });
                
                // Validate status transitions
                validateStatusTransition(newRecord, oldRecord);
            }
            
            // Calculate and update confidence score
            updateConfidenceScore(newRecord);
            
            // Validate extracted data
            validateExtractedData(newRecord);
            
        } catch (e) {
            log.error({
                title: 'DocuMind - beforeSubmit Error',
                details: e.message
            });
            throw e;
        }
    }

    /**
     * After Submit - Trigger workflows and notifications
     * @param {Object} context - Script context
     */
    function afterSubmit(context) {
        const newRecord = context.newRecord;
        const oldRecord = context.oldRecord;
        
        try {
            if (context.type === context.UserEventType.CREATE) {
                // Auto-start processing if configured
                if (shouldAutoProcess()) {
                    triggerDocumentProcessing(newRecord.id);
                }
                
                // Send upload confirmation
                sendNotification(newRecord, NotificationType.DOCUMENT_READY);
            }
            
            if (context.type === context.UserEventType.EDIT) {
                const oldStatus = oldRecord ? oldRecord.getValue('custrecord_dm_status') : null;
                const newStatus = newRecord.getValue('custrecord_dm_status');
                
                // Handle status change workflows
                if (oldStatus !== newStatus) {
                    handleStatusChange(newRecord, oldStatus, newStatus);
                }
                
                // Check for anomalies and notify
                checkAndNotifyAnomalies(newRecord);
                
                // Handle approval workflow
                if (newStatus === DocumentStatus.APPROVED) {
                    handleApproval(newRecord);
                }
                
                // Handle rejection workflow
                if (newStatus === DocumentStatus.REJECTED) {
                    handleRejection(newRecord);
                }
            }
            
            // Update batch status if part of batch
            updateBatchStatus(newRecord);
            
            // Record for learning engine
            recordForLearning(newRecord, context.type);
            
        } catch (e) {
            log.error({
                title: 'DocuMind - afterSubmit Error',
                details: e.message
            });
        }
    }

    // ==================== Helper Functions ====================

    /**
     * Add custom action buttons to document form
     */
    function addDocumentActionButtons(form, rec) {
        const status = rec.getValue('custrecord_dm_status');
        
        // Add Process button for pending documents
        if (status === DocumentStatus.PENDING) {
            form.addButton({
                id: 'custpage_dm_process',
                label: 'Process Document',
                functionName: 'dmProcessDocument'
            });
        }
        
        // Add Review button for extracted documents
        if (status === DocumentStatus.EXTRACTED || status === DocumentStatus.NEEDS_REVIEW) {
            form.addButton({
                id: 'custpage_dm_review',
                label: 'Review & Approve',
                functionName: 'dmReviewDocument'
            });
        }
        
        // Add Reprocess button for error documents
        if (status === DocumentStatus.ERROR) {
            form.addButton({
                id: 'custpage_dm_reprocess',
                label: 'Reprocess',
                functionName: 'dmReprocessDocument'
            });
        }
        
        // Add View Transaction button for completed documents
        if (status === DocumentStatus.COMPLETED) {
            form.addButton({
                id: 'custpage_dm_view_transaction',
                label: 'View Transaction',
                functionName: 'dmViewTransaction'
            });
        }
    }

    /**
     * Add confidence score visualization to form
     */
    function addConfidenceDisplay(form, rec) {
        const confidence = rec.getValue('custrecord_dm_confidence_score') || 0;
        const confidenceLevel = getConfidenceLevel(confidence);
        
        // Add inline HTML field for confidence display
        const confidenceField = form.addField({
            id: 'custpage_dm_confidence_display',
            type: 'inlinehtml',
            label: 'Confidence Score'
        });
        
        const color = confidenceLevel === 'HIGH' ? '#22c55e' : 
                      confidenceLevel === 'MEDIUM' ? '#f59e0b' : '#ef4444';
        
        confidenceField.defaultValue = `
            <div style="display: flex; align-items: center; gap: 12px; padding: 12px; background: #f8fafc; border-radius: 8px; margin-bottom: 16px;">
                <div style="width: 60px; height: 60px; border-radius: 50%; background: conic-gradient(${color} ${confidence}%, #e2e8f0 0); display: flex; align-items: center; justify-content: center;">
                    <div style="width: 48px; height: 48px; border-radius: 50%; background: white; display: flex; align-items: center; justify-content: center; font-weight: 600; color: ${color};">
                        ${confidence}%
                    </div>
                </div>
                <div>
                    <div style="font-weight: 600; color: #1e293b;">Extraction Confidence</div>
                    <div style="color: ${color}; font-size: 14px;">${confidenceLevel}</div>
                </div>
            </div>
        `;
    }

    /**
     * Add anomaly warnings to form
     */
    function addAnomalyWarnings(form, rec) {
        const anomalies = JSON.parse(rec.getValue('custrecord_dm_anomalies') || '[]');
        
        if (anomalies.length === 0) return;
        
        const warningField = form.addField({
            id: 'custpage_dm_anomaly_warnings',
            type: 'inlinehtml',
            label: 'Anomaly Warnings'
        });
        
        let warningsHtml = `
            <div style="background: #fef2f2; border: 1px solid #fecaca; border-radius: 8px; padding: 16px; margin-bottom: 16px;">
                <div style="display: flex; align-items: center; gap: 8px; margin-bottom: 12px;">
                    <svg style="width: 20px; height: 20px; color: #ef4444;" fill="currentColor" viewBox="0 0 20 20">
                        <path fill-rule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clip-rule="evenodd"/>
                    </svg>
                    <span style="font-weight: 600; color: #dc2626;">Anomalies Detected (${anomalies.length})</span>
                </div>
                <ul style="margin: 0; padding-left: 20px; color: #7f1d1d;">
        `;
        
        anomalies.forEach(anomaly => {
            const severityColor = anomaly.severity === 'high' ? '#dc2626' : 
                                  anomaly.severity === 'medium' ? '#d97706' : '#6b7280';
            warningsHtml += `
                <li style="margin-bottom: 8px;">
                    <span style="color: ${severityColor}; font-weight: 500;">[${anomaly.severity.toUpperCase()}]</span>
                    ${anomaly.type}: ${anomaly.message}
                </li>
            `;
        });
        
        warningsHtml += '</ul></div>';
        warningField.defaultValue = warningsHtml;
    }

    /**
     * Lock fields based on document status
     */
    function lockFieldsBasedOnStatus(form, rec) {
        const status = rec.getValue('custrecord_dm_status');
        const lockedStatuses = [DocumentStatus.COMPLETED, DocumentStatus.REJECTED];
        
        if (lockedStatuses.includes(status)) {
            // Lock all extraction fields
            const fieldsToLock = [
                'custrecord_dm_vendor',
                'custrecord_dm_invoice_number',
                'custrecord_dm_invoice_date',
                'custrecord_dm_due_date',
                'custrecord_dm_total_amount',
                'custrecord_dm_currency',
                'custrecord_dm_po_number'
            ];
            
            fieldsToLock.forEach(fieldId => {
                const field = form.getField({ id: fieldId });
                if (field) {
                    field.updateDisplayType({ displayType: 'disabled' });
                }
            });
        }
    }

    /**
     * Set default values for new documents
     */
    function setDefaultValues(rec) {
        rec.setValue({
            fieldId: 'custrecord_dm_status',
            value: DocumentStatus.PENDING
        });
        
        rec.setValue({
            fieldId: 'custrecord_dm_confidence_score',
            value: 0
        });
        
        rec.setValue({
            fieldId: 'custrecord_dm_uploaded_by',
            value: runtime.getCurrentUser().id
        });
    }

    /**
     * Validate file attachment exists
     */
    function validateFileAttachment(rec) {
        const fileId = rec.getValue('custrecord_dm_source_file');
        
        if (!fileId) {
            throw new Error('A source file must be attached to the document.');
        }
        
        // Validate file type
        const sourceFile = file.load({ id: fileId });
        const allowedTypes = ['PDF', 'PNGIMAGE', 'JPGIMAGE', 'TIFFIMAGE', 'GIFIMAGE', 'BMPIMAGE'];
        
        if (!allowedTypes.includes(sourceFile.fileType)) {
            throw new Error('Invalid file type. Supported types: PDF, PNG, JPG, TIFF, GIF, BMP');
        }
        
        // Validate file size (10MB limit)
        if (sourceFile.size > 10485760) {
            throw new Error('File size exceeds 10MB limit.');
        }
    }

    /**
     * Generate unique document ID
     */
    function generateDocumentId() {
        const timestamp = Date.now().toString(36);
        const random = Math.random().toString(36).substring(2, 8);
        return `DM-${timestamp}-${random}`.toUpperCase();
    }

    /**
     * Track status changes for audit trail
     */
    function trackStatusChange(newRec, oldRec) {
        if (!oldRec) return;
        
        const oldStatus = oldRec.getValue('custrecord_dm_status');
        const newStatus = newRec.getValue('custrecord_dm_status');
        
        if (oldStatus !== newStatus) {
            const history = JSON.parse(newRec.getValue('custrecord_dm_status_history') || '[]');
            
            history.push({
                from: oldStatus,
                to: newStatus,
                timestamp: new Date().toISOString(),
                user: runtime.getCurrentUser().id
            });
            
            newRec.setValue({
                fieldId: 'custrecord_dm_status_history',
                value: JSON.stringify(history)
            });
        }
    }

    /**
     * Validate status transitions
     */
    function validateStatusTransition(newRec, oldRec) {
        if (!oldRec) return;
        
        const oldStatus = oldRec.getValue('custrecord_dm_status');
        const newStatus = newRec.getValue('custrecord_dm_status');
        
        if (oldStatus === newStatus) return;
        
        // Define valid transitions
        const validTransitions = {
            [DocumentStatus.PENDING]: [DocumentStatus.PROCESSING, DocumentStatus.ERROR],
            [DocumentStatus.PROCESSING]: [DocumentStatus.EXTRACTED, DocumentStatus.NEEDS_REVIEW, DocumentStatus.ERROR],
            [DocumentStatus.EXTRACTED]: [DocumentStatus.NEEDS_REVIEW, DocumentStatus.APPROVED, DocumentStatus.REJECTED],
            [DocumentStatus.NEEDS_REVIEW]: [DocumentStatus.APPROVED, DocumentStatus.REJECTED, DocumentStatus.PROCESSING],
            [DocumentStatus.APPROVED]: [DocumentStatus.COMPLETED, DocumentStatus.ERROR],
            [DocumentStatus.REJECTED]: [DocumentStatus.PENDING], // Allow resubmission
            [DocumentStatus.ERROR]: [DocumentStatus.PENDING, DocumentStatus.PROCESSING]
        };
        
        const allowed = validTransitions[oldStatus] || [];
        
        if (!allowed.includes(newStatus)) {
            throw new Error(`Invalid status transition from "${oldStatus}" to "${newStatus}".`);
        }
    }

    /**
     * Update confidence score based on extracted data
     */
    function updateConfidenceScore(rec) {
        const weights = {
            vendor: 0.20,
            invoiceNumber: 0.15,
            invoiceDate: 0.10,
            totalAmount: 0.20,
            lineItems: 0.15,
            vendorMatch: 0.10,
            amountValidation: 0.10
        };
        
        let totalScore = 0;
        
        // Check vendor
        if (rec.getValue('custrecord_dm_vendor')) {
            totalScore += weights.vendor * 100;
        }
        
        // Check invoice number
        if (rec.getValue('custrecord_dm_invoice_number')) {
            totalScore += weights.invoiceNumber * 100;
        }
        
        // Check invoice date
        if (rec.getValue('custrecord_dm_invoice_date')) {
            totalScore += weights.invoiceDate * 100;
        }
        
        // Check total amount
        if (rec.getValue('custrecord_dm_total_amount')) {
            totalScore += weights.totalAmount * 100;
        }
        
        // Check line items
        const lineItems = JSON.parse(rec.getValue('custrecord_dm_line_items') || '[]');
        if (lineItems.length > 0) {
            totalScore += weights.lineItems * 100;
        }
        
        // Check vendor match confidence
        const vendorMatchConfidence = rec.getValue('custrecord_dm_vendor_match_confidence') || 0;
        totalScore += weights.vendorMatch * vendorMatchConfidence;
        
        // Check amount validation
        const amountValidated = rec.getValue('custrecord_dm_amount_validated');
        if (amountValidated) {
            totalScore += weights.amountValidation * 100;
        }
        
        // Apply anomaly penalties
        const anomalies = JSON.parse(rec.getValue('custrecord_dm_anomalies') || '[]');
        anomalies.forEach(anomaly => {
            if (anomaly.severity === 'high') totalScore -= 15;
            else if (anomaly.severity === 'medium') totalScore -= 8;
            else totalScore -= 3;
        });
        
        totalScore = Math.max(0, Math.min(100, Math.round(totalScore)));
        
        rec.setValue({
            fieldId: 'custrecord_dm_confidence_score',
            value: totalScore
        });
    }

    /**
     * Validate extracted data
     */
    function validateExtractedData(rec) {
        const status = rec.getValue('custrecord_dm_status');
        
        // Only validate for approval
        if (status !== DocumentStatus.APPROVED) return;
        
        const requiredFields = [
            { id: 'custrecord_dm_vendor', name: 'Vendor' },
            { id: 'custrecord_dm_invoice_number', name: 'Invoice Number' },
            { id: 'custrecord_dm_invoice_date', name: 'Invoice Date' },
            { id: 'custrecord_dm_total_amount', name: 'Total Amount' }
        ];
        
        const missing = [];
        requiredFields.forEach(field => {
            if (!rec.getValue(field.id)) {
                missing.push(field.name);
            }
        });
        
        if (missing.length > 0) {
            throw new Error(`Cannot approve document. Missing required fields: ${missing.join(', ')}`);
        }
    }

    /**
     * Check if auto-processing is enabled
     */
    function shouldAutoProcess() {
        // Check script parameter or custom preference
        const scriptObj = runtime.getCurrentScript();
        return scriptObj.getParameter({ name: 'custscript_dm_auto_process' }) === true;
    }

    /**
     * Trigger document processing via Map/Reduce
     */
    function triggerDocumentProcessing(documentId) {
        try {
            const mrTask = task.create({
                taskType: task.TaskType.MAP_REDUCE,
                scriptId: 'customscript_dm_batch_processor',
                deploymentId: 'customdeploy_dm_batch_processor',
                params: {
                    custscript_dm_doc_ids: JSON.stringify([documentId])
                }
            });
            
            mrTask.submit();
            
            log.audit({
                title: 'DocuMind - Processing Triggered',
                details: `Document ${documentId} queued for processing`
            });
        } catch (e) {
            log.error({
                title: 'DocuMind - Processing Trigger Failed',
                details: e.message
            });
        }
    }

    /**
     * Send notification based on type
     */
    function sendNotification(rec, type) {
        try {
            const userId = rec.getValue('custrecord_dm_uploaded_by') || runtime.getCurrentUser().id;
            const documentId = rec.getValue('custrecord_dm_document_id');
            
            let subject, body;
            
            switch (type) {
                case NotificationType.DOCUMENT_READY:
                    subject = `DocuMind: Document ${documentId} Uploaded`;
                    body = `Your document has been uploaded and is ready for processing.`;
                    break;
                    
                case NotificationType.REVIEW_REQUIRED:
                    subject = `DocuMind: Document ${documentId} Needs Review`;
                    body = `A document requires your review. Please review and approve or reject.`;
                    break;
                    
                case NotificationType.ANOMALY_DETECTED:
                    const anomalies = JSON.parse(rec.getValue('custrecord_dm_anomalies') || '[]');
                    subject = `DocuMind: Anomalies Detected in ${documentId}`;
                    body = `${anomalies.length} anomalies were detected in this document. Please review carefully.`;
                    break;
                    
                case NotificationType.ERROR_OCCURRED:
                    const errorMsg = rec.getValue('custrecord_dm_error_message');
                    subject = `DocuMind: Error Processing ${documentId}`;
                    body = `An error occurred: ${errorMsg}`;
                    break;
                    
                default:
                    return;
            }
            
            // Check notification preferences
            if (shouldSendNotification(userId, type)) {
                email.send({
                    author: runtime.getCurrentUser().id,
                    recipients: userId,
                    subject: subject,
                    body: body
                });
            }
        } catch (e) {
            log.error({
                title: 'DocuMind - Notification Error',
                details: e.message
            });
        }
    }

    /**
     * Check if notification should be sent
     */
    function shouldSendNotification(userId, type) {
        // Could check user preferences here
        // For now, send all notifications
        return true;
    }

    /**
     * Handle status changes
     */
    function handleStatusChange(rec, oldStatus, newStatus) {
        log.audit({
            title: 'DocuMind - Status Change',
            details: `Document ${rec.id}: ${oldStatus} -> ${newStatus}`
        });
        
        if (newStatus === DocumentStatus.NEEDS_REVIEW) {
            sendNotification(rec, NotificationType.REVIEW_REQUIRED);
        }
        
        if (newStatus === DocumentStatus.ERROR) {
            sendNotification(rec, NotificationType.ERROR_OCCURRED);
        }
    }

    /**
     * Check for anomalies and notify
     */
    function checkAndNotifyAnomalies(rec) {
        const anomalies = JSON.parse(rec.getValue('custrecord_dm_anomalies') || '[]');
        const highSeverity = anomalies.filter(a => a.severity === 'high');
        
        if (highSeverity.length > 0) {
            sendNotification(rec, NotificationType.ANOMALY_DETECTED);
        }
    }

    /**
     * Handle document approval
     */
    function handleApproval(rec) {
        try {
            const docType = rec.getValue('custrecord_dm_document_type');
            const createTransaction = rec.getValue('custrecord_dm_create_transaction');
            
            if (!createTransaction) return;
            
            // Create appropriate transaction based on document type
            let transactionId;
            
            switch (docType) {
                case 'invoice':
                case 'INVOICE':
                    transactionId = createVendorBill(rec);
                    break;
                    
                case 'expense':
                case 'EXPENSE_REPORT':
                    transactionId = createExpenseReport(rec);
                    break;
                    
                case 'credit_memo':
                case 'CREDIT_MEMO':
                    transactionId = createVendorCredit(rec);
                    break;
            }
            
            if (transactionId) {
                // Update document with transaction reference
                record.submitFields({
                    type: 'customrecord_dm_captured_document',
                    id: rec.id,
                    values: {
                        custrecord_dm_created_transaction: transactionId,
                        custrecord_dm_status: DocumentStatus.COMPLETED
                    }
                });
                
                log.audit({
                    title: 'DocuMind - Transaction Created',
                    details: `Created transaction ${transactionId} from document ${rec.id}`
                });
            }
        } catch (e) {
            log.error({
                title: 'DocuMind - Transaction Creation Error',
                details: e.message
            });
            
            record.submitFields({
                type: 'customrecord_dm_captured_document',
                id: rec.id,
                values: {
                    custrecord_dm_status: DocumentStatus.ERROR,
                    custrecord_dm_error_message: e.message
                }
            });
        }
    }

    /**
     * Create Vendor Bill from document
     */
    function createVendorBill(rec) {
        const vendorBill = record.create({
            type: record.Type.VENDOR_BILL,
            isDynamic: true
        });
        
        // Set header fields
        vendorBill.setValue({ fieldId: 'entity', value: rec.getValue('custrecord_dm_vendor') });
        vendorBill.setValue({ fieldId: 'tranid', value: rec.getValue('custrecord_dm_invoice_number') });
        vendorBill.setValue({ fieldId: 'trandate', value: rec.getValue('custrecord_dm_invoice_date') });
        
        const dueDate = rec.getValue('custrecord_dm_due_date');
        if (dueDate) {
            vendorBill.setValue({ fieldId: 'duedate', value: dueDate });
        }
        
        const currency = rec.getValue('custrecord_dm_currency');
        if (currency) {
            vendorBill.setValue({ fieldId: 'currency', value: currency });
        }
        
        const poNumber = rec.getValue('custrecord_dm_po_number');
        if (poNumber) {
            vendorBill.setValue({ fieldId: 'custbody_dm_po_reference', value: poNumber });
        }
        
        // Add line items
        const lineItems = JSON.parse(rec.getValue('custrecord_dm_line_items') || '[]');
        
        lineItems.forEach(line => {
            vendorBill.selectNewLine({ sublistId: 'expense' });
            
            if (line.account) {
                vendorBill.setCurrentSublistValue({
                    sublistId: 'expense',
                    fieldId: 'account',
                    value: line.account
                });
            }
            
            vendorBill.setCurrentSublistValue({
                sublistId: 'expense',
                fieldId: 'amount',
                value: line.amount || 0
            });
            
            if (line.description) {
                vendorBill.setCurrentSublistValue({
                    sublistId: 'expense',
                    fieldId: 'memo',
                    value: line.description
                });
            }
            
            vendorBill.commitLine({ sublistId: 'expense' });
        });
        
        // Attach source document
        const sourceFileId = rec.getValue('custrecord_dm_source_file');
        if (sourceFileId) {
            // File attachment would be handled separately
        }
        
        const billId = vendorBill.save();
        return billId;
    }

    /**
     * Create Expense Report from document
     */
    function createExpenseReport(rec) {
        const expenseReport = record.create({
            type: record.Type.EXPENSE_REPORT,
            isDynamic: true
        });
        
        const uploadedBy = rec.getValue('custrecord_dm_uploaded_by');
        expenseReport.setValue({ fieldId: 'entity', value: uploadedBy });
        expenseReport.setValue({ fieldId: 'trandate', value: rec.getValue('custrecord_dm_invoice_date') });
        
        // Add expense lines
        const lineItems = JSON.parse(rec.getValue('custrecord_dm_line_items') || '[]');
        
        lineItems.forEach(line => {
            expenseReport.selectNewLine({ sublistId: 'expense' });
            
            expenseReport.setCurrentSublistValue({
                sublistId: 'expense',
                fieldId: 'expensedate',
                value: rec.getValue('custrecord_dm_invoice_date')
            });
            
            if (line.category) {
                expenseReport.setCurrentSublistValue({
                    sublistId: 'expense',
                    fieldId: 'category',
                    value: line.category
                });
            }
            
            expenseReport.setCurrentSublistValue({
                sublistId: 'expense',
                fieldId: 'amount',
                value: line.amount || 0
            });
            
            if (line.description) {
                expenseReport.setCurrentSublistValue({
                    sublistId: 'expense',
                    fieldId: 'memo',
                    value: line.description
                });
            }
            
            expenseReport.commitLine({ sublistId: 'expense' });
        });
        
        const reportId = expenseReport.save();
        return reportId;
    }

    /**
     * Create Vendor Credit from document
     */
    function createVendorCredit(rec) {
        const vendorCredit = record.create({
            type: record.Type.VENDOR_CREDIT,
            isDynamic: true
        });
        
        vendorCredit.setValue({ fieldId: 'entity', value: rec.getValue('custrecord_dm_vendor') });
        vendorCredit.setValue({ fieldId: 'trandate', value: rec.getValue('custrecord_dm_invoice_date') });
        
        const lineItems = JSON.parse(rec.getValue('custrecord_dm_line_items') || '[]');
        
        lineItems.forEach(line => {
            vendorCredit.selectNewLine({ sublistId: 'expense' });
            
            if (line.account) {
                vendorCredit.setCurrentSublistValue({
                    sublistId: 'expense',
                    fieldId: 'account',
                    value: line.account
                });
            }
            
            vendorCredit.setCurrentSublistValue({
                sublistId: 'expense',
                fieldId: 'amount',
                value: line.amount || 0
            });
            
            vendorCredit.commitLine({ sublistId: 'expense' });
        });
        
        const creditId = vendorCredit.save();
        return creditId;
    }

    /**
     * Handle document rejection
     */
    function handleRejection(rec) {
        log.audit({
            title: 'DocuMind - Document Rejected',
            details: `Document ${rec.id} was rejected. Reason: ${rec.getValue('custrecord_dm_rejection_reason') || 'Not specified'}`
        });
    }

    /**
     * Update batch status
     */
    function updateBatchStatus(rec) {
        const batchId = rec.getValue('custrecord_dm_batch_id');
        if (!batchId) return;
        
        try {
            // Count documents in batch by status
            const statusCounts = {};
            
            search.create({
                type: 'customrecord_dm_captured_document',
                filters: [
                    ['custrecord_dm_batch_id', 'is', batchId]
                ],
                columns: ['custrecord_dm_status']
            }).run().each(result => {
                const status = result.getValue('custrecord_dm_status');
                statusCounts[status] = (statusCounts[status] || 0) + 1;
                return true;
            });
            
            // Determine batch status
            let batchStatus = 'processing';
            const total = Object.values(statusCounts).reduce((a, b) => a + b, 0);
            const completed = (statusCounts[DocumentStatus.COMPLETED] || 0) + 
                             (statusCounts[DocumentStatus.REJECTED] || 0);
            
            if (completed === total) {
                batchStatus = 'completed';
                sendBatchCompleteNotification(batchId);
            } else if (statusCounts[DocumentStatus.ERROR] > 0) {
                batchStatus = 'partial_error';
            }
            
            record.submitFields({
                type: 'customrecord_dm_batch',
                id: batchId,
                values: {
                    custrecord_dm_batch_status: batchStatus,
                    custrecord_dm_batch_progress: JSON.stringify(statusCounts)
                }
            });
        } catch (e) {
            log.error({
                title: 'DocuMind - Batch Status Update Error',
                details: e.message
            });
        }
    }

    /**
     * Send batch completion notification
     */
    function sendBatchCompleteNotification(batchId) {
        // Implementation for batch completion email
    }

    /**
     * Record interaction for learning engine
     */
    function recordForLearning(rec, eventType) {
        if (eventType !== 'edit') return;
        
        try {
            // Check if user made corrections
            const corrections = rec.getValue('custrecord_dm_user_corrections');
            if (!corrections) return;
            
            const correctionData = JSON.parse(corrections);
            const vendor = rec.getValue('custrecord_dm_vendor');
            
            // Create learning record
            const learningRecord = record.create({
                type: 'customrecord_dm_learning',
                isDynamic: true
            });
            
            learningRecord.setValue({ fieldId: 'custrecord_dm_learn_vendor', value: vendor });
            learningRecord.setValue({ fieldId: 'custrecord_dm_learn_corrections', value: corrections });
            learningRecord.setValue({ fieldId: 'custrecord_dm_learn_document', value: rec.id });
            learningRecord.setValue({ fieldId: 'custrecord_dm_learn_date', value: new Date() });
            
            learningRecord.save();
        } catch (e) {
            log.error({
                title: 'DocuMind - Learning Record Error',
                details: e.message
            });
        }
    }

    /**
     * Get confidence level label
     */
    function getConfidenceLevel(score) {
        if (score >= 85) return 'HIGH';
        if (score >= 60) return 'MEDIUM';
        return 'LOW';
    }

    return {
        beforeLoad: beforeLoad,
        beforeSubmit: beforeSubmit,
        afterSubmit: afterSubmit
    };
});
