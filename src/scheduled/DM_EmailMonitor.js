/**
 * @NApiVersion 2.1
 * @NScriptType ScheduledScript
 * @NModuleScope SameAccount
 * 
 * Flux Capture - Email Monitor
 * Scheduled script to monitor email inbox and auto-import attached documents
 * Runs every 15 minutes to check for new document submissions via email
 */

define(['N/email', 'N/record', 'N/search', 'N/file', 'N/runtime', 'N/task', 'N/log', 'N/format', 'N/encode'],
    function(email, record, search, file, runtime, task, log, format, encode) {

    /**
     * Supported file extensions
     */
    const SUPPORTED_EXTENSIONS = ['pdf', 'png', 'jpg', 'jpeg', 'tiff', 'tif', 'gif', 'bmp'];
    
    /**
     * Email subjects that indicate document submission
     */
    const TRIGGER_SUBJECTS = [
        'invoice',
        'bill',
        'receipt',
        'expense',
        'payment',
        'flux',
        'document',
        'ap submission',
        'vendor bill'
    ];

    /**
     * Main execution function
     * @param {Object} context - Script context
     */
    function execute(context) {
        const scriptObj = runtime.getCurrentScript();
        
        log.audit({
            title: 'Flux Capture Email Monitor',
            details: 'Starting email scan...'
        });
        
        try {
            // Get configuration
            const config = getConfiguration();
            
            if (!config.enabled) {
                log.audit({
                    title: 'Flux Capture Email Monitor',
                    details: 'Email monitoring is disabled in settings'
                });
                return;
            }
            
            // Get the inbox folder
            const inboxFolderId = config.inboxFolderId;
            const processedFolderId = config.processedFolderId;
            const errorFolderId = config.errorFolderId;
            
            // Search for unprocessed emails
            const emails = searchUnprocessedEmails(config);
            
            log.audit({
                title: 'Flux Capture Email Monitor',
                details: `Found ${emails.length} unprocessed emails`
            });
            
            let processed = 0;
            let errors = 0;
            
            // Process each email
            emails.forEach(emailData => {
                // Check governance
                if (scriptObj.getRemainingUsage() < 500) {
                    log.audit({
                        title: 'Flux Capture Email Monitor',
                        details: 'Approaching governance limit, stopping...'
                    });
                    return;
                }
                
                try {
                    const result = processEmail(emailData, config);
                    
                    if (result.success) {
                        processed++;
                        markEmailProcessed(emailData.id, processedFolderId);
                    } else {
                        errors++;
                        markEmailError(emailData.id, errorFolderId, result.error);
                    }
                } catch (e) {
                    errors++;
                    log.error({
                        title: 'Flux Capture Email Monitor - Processing Error',
                        details: `Email ${emailData.id}: ${e.message}`
                    });
                    markEmailError(emailData.id, errorFolderId, e.message);
                }
            });
            
            // Log summary
            log.audit({
                title: 'Flux Capture Email Monitor - Complete',
                details: `Processed: ${processed}, Errors: ${errors}`
            });
            
            // Send summary notification if configured
            if (config.notifyOnComplete && (processed > 0 || errors > 0)) {
                sendSummaryNotification(config, processed, errors);
            }
            
        } catch (e) {
            log.error({
                title: 'Flux Capture Email Monitor - Fatal Error',
                details: e.message
            });
        }
    }

    /**
     * Get configuration settings
     */
    function getConfiguration() {
        // Try to load from custom record or script parameters
        const scriptObj = runtime.getCurrentScript();
        
        return {
            enabled: scriptObj.getParameter({ name: 'custscript_dm_email_enabled' }) !== false,
            inboxFolderId: scriptObj.getParameter({ name: 'custscript_dm_inbox_folder' }) || getDefaultInboxFolder(),
            processedFolderId: scriptObj.getParameter({ name: 'custscript_dm_processed_folder' }) || createFolder('Flux Capture Processed'),
            errorFolderId: scriptObj.getParameter({ name: 'custscript_dm_error_folder' }) || createFolder('Flux Capture Errors'),
            autoProcess: scriptObj.getParameter({ name: 'custscript_dm_auto_process' }) !== false,
            defaultDocType: scriptObj.getParameter({ name: 'custscript_dm_default_doc_type' }) || 'invoice',
            notifyOnComplete: scriptObj.getParameter({ name: 'custscript_dm_notify_complete' }) === true,
            notificationRecipient: scriptObj.getParameter({ name: 'custscript_dm_notify_recipient' }),
            maxAttachmentSize: scriptObj.getParameter({ name: 'custscript_dm_max_attachment_size' }) || 10485760, // 10MB
            trustedSenders: getTrustedSenders(),
            emailAddress: getFlux CaptureEmailAddress()
        };
    }

    /**
     * Get default inbox folder
     */
    function getDefaultInboxFolder() {
        // Search for existing Flux Capture inbox folder
        const folderSearch = search.create({
            type: 'folder',
            filters: [
                ['name', 'is', 'Flux Capture Inbox']
            ],
            columns: ['internalid']
        });
        
        const results = folderSearch.run().getRange({ start: 0, end: 1 });
        
        if (results.length > 0) {
            return results[0].id;
        }
        
        return createFolder('Flux Capture Inbox');
    }

    /**
     * Create a file cabinet folder
     */
    function createFolder(folderName) {
        try {
            const folder = record.create({
                type: record.Type.FOLDER
            });
            
            folder.setValue({ fieldId: 'name', value: folderName });
            folder.setValue({ fieldId: 'description', value: 'Created by Flux Capture for email monitoring' });
            
            return folder.save();
        } catch (e) {
            log.error({
                title: 'Flux Capture - Folder Creation Error',
                details: e.message
            });
            return null;
        }
    }

    /**
     * Get trusted sender list
     */
    function getTrustedSenders() {
        const senders = [];
        
        // Search for trusted sender custom records
        try {
            search.create({
                type: 'customrecord_dm_trusted_sender',
                filters: [
                    ['isinactive', 'is', 'F']
                ],
                columns: ['custrecord_dm_sender_email', 'custrecord_dm_sender_domain']
            }).run().each(result => {
                const email = result.getValue('custrecord_dm_sender_email');
                const domain = result.getValue('custrecord_dm_sender_domain');
                
                if (email) senders.push({ type: 'email', value: email.toLowerCase() });
                if (domain) senders.push({ type: 'domain', value: domain.toLowerCase() });
                
                return true;
            });
        } catch (e) {
            // Custom record might not exist yet
            log.debug({
                title: 'Flux Capture - Trusted Senders',
                details: 'No trusted sender records found, accepting all senders'
            });
        }
        
        return senders;
    }

    /**
     * Get Flux Capture email address
     */
    function getFlux CaptureEmailAddress() {
        const companyInfo = search.lookupFields({
            type: search.Type.COMPANY_INFORMATION,
            id: 1,
            columns: ['companyid']
        });
        
        const accountId = companyInfo.companyid || runtime.accountId;
        
        // Format: flux-{accountId}@netsuite.com
        return `flux-${accountId}@netsuite.com`;
    }

    /**
     * Search for unprocessed emails
     */
    function searchUnprocessedEmails(config) {
        const emails = [];
        
        // Search messages table for unprocessed emails
        // Note: This is a simplified approach - actual implementation would use
        // NetSuite's email capture or a custom email integration
        
        try {
            // Search for files in inbox folder that haven't been processed
            search.create({
                type: 'file',
                filters: [
                    ['folder', 'is', config.inboxFolderId],
                    'AND',
                    ['custrecord_dm_email_processed', 'is', 'F']
                ],
                columns: [
                    'name',
                    'filetype',
                    'created',
                    'custrecord_dm_email_sender',
                    'custrecord_dm_email_subject',
                    'custrecord_dm_email_body'
                ]
            }).run().each(result => {
                emails.push({
                    id: result.id,
                    name: result.getValue('name'),
                    fileType: result.getValue('filetype'),
                    created: result.getValue('created'),
                    sender: result.getValue('custrecord_dm_email_sender'),
                    subject: result.getValue('custrecord_dm_email_subject'),
                    body: result.getValue('custrecord_dm_email_body')
                });
                
                return true;
            });
        } catch (e) {
            log.error({
                title: 'Flux Capture - Email Search Error',
                details: e.message
            });
        }
        
        // Alternative: Search custom email log records
        try {
            search.create({
                type: 'customrecord_dm_email_log',
                filters: [
                    ['custrecord_dm_email_status', 'is', 'pending']
                ],
                columns: [
                    'custrecord_dm_email_sender',
                    'custrecord_dm_email_subject',
                    'custrecord_dm_email_received',
                    'custrecord_dm_email_attachments',
                    'custrecord_dm_email_body'
                ]
            }).run().each(result => {
                emails.push({
                    id: result.id,
                    type: 'email_log',
                    sender: result.getValue('custrecord_dm_email_sender'),
                    subject: result.getValue('custrecord_dm_email_subject'),
                    received: result.getValue('custrecord_dm_email_received'),
                    attachments: result.getValue('custrecord_dm_email_attachments'),
                    body: result.getValue('custrecord_dm_email_body')
                });
                
                return true;
            });
        } catch (e) {
            // Custom record might not exist
        }
        
        return emails;
    }

    /**
     * Process a single email
     */
    function processEmail(emailData, config) {
        log.debug({
            title: 'Flux Capture - Processing Email',
            details: `From: ${emailData.sender}, Subject: ${emailData.subject}`
        });
        
        // Validate sender
        if (!validateSender(emailData.sender, config.trustedSenders)) {
            return {
                success: false,
                error: 'Sender not in trusted list'
            };
        }
        
        // Check if subject indicates document submission
        if (!isDocumentSubmission(emailData.subject)) {
            return {
                success: false,
                error: 'Subject does not indicate document submission'
            };
        }
        
        // Get attachments
        const attachments = getEmailAttachments(emailData);
        
        if (attachments.length === 0) {
            return {
                success: false,
                error: 'No valid attachments found'
            };
        }
        
        // Determine document type from subject/body
        const docType = determineDocumentType(emailData.subject, emailData.body);
        
        // Create batch for multiple attachments
        let batchId = null;
        if (attachments.length > 1) {
            batchId = createBatch(emailData, attachments.length);
        }
        
        // Process each attachment
        const documentIds = [];
        
        attachments.forEach(attachment => {
            try {
                // Validate attachment
                if (attachment.size > config.maxAttachmentSize) {
                    log.warning({
                        title: 'Flux Capture - Attachment Too Large',
                        details: `${attachment.name}: ${attachment.size} bytes exceeds limit`
                    });
                    return;
                }
                
                // Save attachment to file cabinet
                const fileId = saveAttachment(attachment, config.inboxFolderId);
                
                if (!fileId) {
                    log.error({
                        title: 'Flux Capture - File Save Error',
                        details: `Failed to save ${attachment.name}`
                    });
                    return;
                }
                
                // Create captured document record
                const documentId = createCapturedDocument({
                    fileId: fileId,
                    fileName: attachment.name,
                    docType: docType,
                    batchId: batchId,
                    emailSender: emailData.sender,
                    emailSubject: emailData.subject,
                    emailReceived: emailData.received || new Date()
                });
                
                if (documentId) {
                    documentIds.push(documentId);
                }
            } catch (e) {
                log.error({
                    title: 'Flux Capture - Attachment Processing Error',
                    details: e.message
                });
            }
        });
        
        if (documentIds.length === 0) {
            return {
                success: false,
                error: 'Failed to create any document records'
            };
        }
        
        // Trigger processing if auto-process is enabled
        if (config.autoProcess) {
            triggerBatchProcessing(documentIds);
        }
        
        // Send confirmation email to sender
        sendConfirmationEmail(emailData.sender, documentIds.length);
        
        return {
            success: true,
            documentIds: documentIds,
            batchId: batchId
        };
    }

    /**
     * Validate sender against trusted list
     */
    function validateSender(sender, trustedSenders) {
        // If no trusted senders configured, accept all
        if (trustedSenders.length === 0) {
            return true;
        }
        
        const senderLower = sender.toLowerCase();
        const senderDomain = senderLower.split('@')[1];
        
        return trustedSenders.some(trusted => {
            if (trusted.type === 'email') {
                return senderLower === trusted.value;
            }
            if (trusted.type === 'domain') {
                return senderDomain === trusted.value;
            }
            return false;
        });
    }

    /**
     * Check if subject indicates document submission
     */
    function isDocumentSubmission(subject) {
        if (!subject) return false;
        
        const subjectLower = subject.toLowerCase();
        
        return TRIGGER_SUBJECTS.some(trigger => subjectLower.includes(trigger));
    }

    /**
     * Get attachments from email
     */
    function getEmailAttachments(emailData) {
        const attachments = [];
        
        if (emailData.type === 'email_log') {
            // Parse attachments JSON
            try {
                const attachmentData = JSON.parse(emailData.attachments || '[]');
                
                attachmentData.forEach(att => {
                    const ext = getFileExtension(att.name);
                    if (SUPPORTED_EXTENSIONS.includes(ext)) {
                        attachments.push({
                            name: att.name,
                            content: att.content,
                            size: att.size,
                            mimeType: att.mimeType
                        });
                    }
                });
            } catch (e) {
                log.error({
                    title: 'Flux Capture - Attachment Parse Error',
                    details: e.message
                });
            }
        } else {
            // Direct file reference
            const ext = getFileExtension(emailData.name);
            if (SUPPORTED_EXTENSIONS.includes(ext)) {
                attachments.push({
                    id: emailData.id,
                    name: emailData.name,
                    fileType: emailData.fileType
                });
            }
        }
        
        return attachments;
    }

    /**
     * Get file extension
     */
    function getFileExtension(filename) {
        if (!filename) return '';
        const parts = filename.split('.');
        return parts.length > 1 ? parts.pop().toLowerCase() : '';
    }

    /**
     * Determine document type from email content
     */
    function determineDocumentType(subject, body) {
        const content = ((subject || '') + ' ' + (body || '')).toLowerCase();
        
        if (content.includes('expense') || content.includes('receipt')) {
            return 'EXPENSE_REPORT';
        }
        
        if (content.includes('credit') || content.includes('refund')) {
            return 'CREDIT_MEMO';
        }
        
        if (content.includes('purchase order') || content.includes('po ')) {
            return 'PURCHASE_ORDER';
        }
        
        // Default to invoice
        return 'INVOICE';
    }

    /**
     * Create batch record for multiple documents
     */
    function createBatch(emailData, documentCount) {
        try {
            const batchRecord = record.create({
                type: 'customrecord_dm_batch',
                isDynamic: true
            });
            
            batchRecord.setValue({
                fieldId: 'name',
                value: `Email Import - ${new Date().toISOString()}`
            });
            
            batchRecord.setValue({
                fieldId: 'custrecord_dm_batch_source',
                value: 'email'
            });
            
            batchRecord.setValue({
                fieldId: 'custrecord_dm_batch_document_count',
                value: documentCount
            });
            
            batchRecord.setValue({
                fieldId: 'custrecord_dm_batch_status',
                value: 'pending'
            });
            
            batchRecord.setValue({
                fieldId: 'custrecord_dm_batch_email_sender',
                value: emailData.sender
            });
            
            return batchRecord.save();
        } catch (e) {
            log.error({
                title: 'Flux Capture - Batch Creation Error',
                details: e.message
            });
            return null;
        }
    }

    /**
     * Save attachment to file cabinet
     */
    function saveAttachment(attachment, folderId) {
        try {
            const fileRecord = file.create({
                name: attachment.name,
                fileType: getNetSuiteFileType(attachment.mimeType || attachment.name),
                contents: attachment.content,
                folder: folderId,
                isOnline: true
            });
            
            return fileRecord.save();
        } catch (e) {
            log.error({
                title: 'Flux Capture - File Save Error',
                details: e.message
            });
            return null;
        }
    }

    /**
     * Get NetSuite file type from MIME type or filename
     */
    function getNetSuiteFileType(mimeTypeOrName) {
        const mimeMap = {
            'application/pdf': file.Type.PDF,
            'image/png': file.Type.PNGIMAGE,
            'image/jpeg': file.Type.JPGIMAGE,
            'image/jpg': file.Type.JPGIMAGE,
            'image/tiff': file.Type.TIFFIMAGE,
            'image/gif': file.Type.GIFIMAGE,
            'image/bmp': file.Type.BMPIMAGE
        };
        
        if (mimeMap[mimeTypeOrName]) {
            return mimeMap[mimeTypeOrName];
        }
        
        // Try to determine from extension
        const ext = getFileExtension(mimeTypeOrName);
        const extMap = {
            'pdf': file.Type.PDF,
            'png': file.Type.PNGIMAGE,
            'jpg': file.Type.JPGIMAGE,
            'jpeg': file.Type.JPGIMAGE,
            'tiff': file.Type.TIFFIMAGE,
            'tif': file.Type.TIFFIMAGE,
            'gif': file.Type.GIFIMAGE,
            'bmp': file.Type.BMPIMAGE
        };
        
        return extMap[ext] || file.Type.PDF;
    }

    /**
     * Create captured document record
     */
    function createCapturedDocument(data) {
        try {
            const docRecord = record.create({
                type: 'customrecord_dm_captured_document',
                isDynamic: true
            });
            
            docRecord.setValue({
                fieldId: 'custrecord_dm_source_file',
                value: data.fileId
            });
            
            docRecord.setValue({
                fieldId: 'name',
                value: data.fileName
            });
            
            docRecord.setValue({
                fieldId: 'custrecord_dm_document_type',
                value: data.docType
            });
            
            docRecord.setValue({
                fieldId: 'custrecord_dm_status',
                value: 'pending'
            });
            
            docRecord.setValue({
                fieldId: 'custrecord_dm_source',
                value: 'email'
            });
            
            if (data.batchId) {
                docRecord.setValue({
                    fieldId: 'custrecord_dm_batch_id',
                    value: data.batchId
                });
            }
            
            docRecord.setValue({
                fieldId: 'custrecord_dm_email_sender',
                value: data.emailSender
            });
            
            docRecord.setValue({
                fieldId: 'custrecord_dm_email_subject',
                value: data.emailSubject
            });
            
            docRecord.setValue({
                fieldId: 'custrecord_dm_email_received',
                value: data.emailReceived
            });
            
            docRecord.setValue({
                fieldId: 'custrecord_dm_created_date',
                value: new Date()
            });
            
            docRecord.setValue({
                fieldId: 'custrecord_dm_uploaded_by',
                value: runtime.getCurrentUser().id
            });
            
            return docRecord.save();
        } catch (e) {
            log.error({
                title: 'Flux Capture - Document Creation Error',
                details: e.message
            });
            return null;
        }
    }

    /**
     * Trigger batch processing via Map/Reduce
     */
    function triggerBatchProcessing(documentIds) {
        try {
            const mrTask = task.create({
                taskType: task.TaskType.MAP_REDUCE,
                scriptId: 'customscript_dm_batch_processor',
                deploymentId: 'customdeploy_dm_batch_processor',
                params: {
                    custscript_dm_doc_ids: JSON.stringify(documentIds)
                }
            });
            
            mrTask.submit();
            
            log.audit({
                title: 'Flux Capture - Processing Triggered',
                details: `Submitted ${documentIds.length} documents for processing`
            });
        } catch (e) {
            log.error({
                title: 'Flux Capture - Processing Trigger Error',
                details: e.message
            });
        }
    }

    /**
     * Send confirmation email to sender
     */
    function sendConfirmationEmail(recipient, documentCount) {
        try {
            email.send({
                author: runtime.getCurrentUser().id,
                recipients: recipient,
                subject: 'Flux Capture: Documents Received',
                body: `
                    <html>
                    <body style="font-family: Arial, sans-serif; color: #333;">
                        <div style="max-width: 600px; margin: 0 auto; padding: 20px;">
                            <div style="background: linear-gradient(135deg, #6366f1, #8b5cf6); padding: 20px; border-radius: 8px 8px 0 0;">
                                <h1 style="color: white; margin: 0;">Flux Capture</h1>
                                <p style="color: rgba(255,255,255,0.8); margin: 5px 0 0 0;">Intelligent Document Capture</p>
                            </div>
                            <div style="background: #f8fafc; padding: 20px; border: 1px solid #e2e8f0; border-top: none; border-radius: 0 0 8px 8px;">
                                <h2 style="color: #1e293b; margin-top: 0;">Documents Received</h2>
                                <p>We have received <strong>${documentCount}</strong> document(s) from your email submission.</p>
                                <p>Your documents are now being processed by our AI extraction engine. You will receive another notification when processing is complete and your documents are ready for review.</p>
                                <div style="background: #dbeafe; padding: 12px; border-radius: 6px; margin: 20px 0;">
                                    <p style="margin: 0; color: #1e40af;">
                                        <strong>What happens next?</strong><br>
                                        1. AI extracts vendor, invoice details, and line items<br>
                                        2. Smart matching finds the vendor in your system<br>
                                        3. Fraud detection checks for anomalies<br>
                                        4. Documents are queued for your review
                                    </p>
                                </div>
                                <p style="color: #64748b; font-size: 12px; margin-bottom: 0;">
                                    This is an automated message from Flux Capture. Please do not reply to this email.
                                </p>
                            </div>
                        </div>
                    </body>
                    </html>
                `
            });
        } catch (e) {
            log.error({
                title: 'Flux Capture - Confirmation Email Error',
                details: e.message
            });
        }
    }

    /**
     * Mark email as processed
     */
    function markEmailProcessed(emailId, processedFolderId) {
        try {
            // Move file to processed folder if applicable
            if (processedFolderId) {
                record.submitFields({
                    type: 'file',
                    id: emailId,
                    values: {
                        folder: processedFolderId
                    }
                });
            }
            
            // Or update custom record status
            record.submitFields({
                type: 'customrecord_dm_email_log',
                id: emailId,
                values: {
                    custrecord_dm_email_status: 'processed',
                    custrecord_dm_email_processed_date: new Date()
                }
            });
        } catch (e) {
            // Ignore - record type might not match
        }
    }

    /**
     * Mark email as error
     */
    function markEmailError(emailId, errorFolderId, errorMessage) {
        try {
            // Move file to error folder if applicable
            if (errorFolderId) {
                record.submitFields({
                    type: 'file',
                    id: emailId,
                    values: {
                        folder: errorFolderId
                    }
                });
            }
            
            // Or update custom record status
            record.submitFields({
                type: 'customrecord_dm_email_log',
                id: emailId,
                values: {
                    custrecord_dm_email_status: 'error',
                    custrecord_dm_email_error: errorMessage
                }
            });
        } catch (e) {
            // Ignore - record type might not match
        }
    }

    /**
     * Send summary notification
     */
    function sendSummaryNotification(config, processed, errors) {
        if (!config.notificationRecipient) return;
        
        try {
            email.send({
                author: runtime.getCurrentUser().id,
                recipients: config.notificationRecipient,
                subject: `Flux Capture: Email Monitor Summary - ${processed} Processed, ${errors} Errors`,
                body: `
                    <html>
                    <body style="font-family: Arial, sans-serif;">
                        <h2>Flux Capture Email Monitor Summary</h2>
                        <p><strong>Run Time:</strong> ${new Date().toISOString()}</p>
                        <p><strong>Documents Processed:</strong> ${processed}</p>
                        <p><strong>Errors:</strong> ${errors}</p>
                        ${errors > 0 ? '<p style="color: #dc2626;">Please review error logs for details.</p>' : ''}
                    </body>
                    </html>
                `
            });
        } catch (e) {
            log.error({
                title: 'Flux Capture - Summary Notification Error',
                details: e.message
            });
        }
    }

    return {
        execute: execute
    };
});
