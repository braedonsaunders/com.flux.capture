/**
 * Flux Capture - Email Capture Plug-in
 *
 * Receives inbound emails and processes PDF/image attachments through Flux Capture.
 * When vendors send invoices to the designated email address, this plugin automatically
 * extracts attachments and creates Flux Document records for AI processing.
 *
 * IMPORTANT: Email Capture Plug-ins use SuiteScript 1.0 syntax.
 * This is a NetSuite platform requirement - SuiteScript 2.x is not supported.
 */

/**
 * Validate license via API (SuiteScript 1.0 compatible)
 * @returns {boolean} True if license is valid
 */
function _validateLicense() {
    try {
        var accountId = nlapiGetContext().getCompany();
        var url = 'https://flux-com.vercel.app/api/v1/license-check';

        var headers = {
            'Content-Type': 'application/json',
            'Accept': 'application/json',
            'X-Flux-Client': 'capture-email-plugin'
        };

        var body = JSON.stringify({
            account: accountId,
            product: 'capture',
            client_version: '1.0.0'
        });

        var response = nlapiRequestURL(url, body, headers, 'POST');

        if (response.getCode() !== 200) {
            nlapiLogExecution('ERROR', 'Flux License', 'API returned: ' + response.getCode());
            return false;
        }

        var result = JSON.parse(response.getBody());
        return result && result.valid === true;

    } catch (e) {
        nlapiLogExecution('ERROR', 'Flux License', 'Validation error: ' + e.toString());
        // Allow offline grace - check for cached valid state
        return _getOfflineFallback();
    }
}

/**
 * Check for offline fallback (cached license)
 */
function _getOfflineFallback() {
    try {
        var filters = [
            ['custrecord_flux_cfg_type', 'is', 'license'],
            'AND',
            ['custrecord_flux_cfg_key', 'is', 'cache'],
            'AND',
            ['custrecord_flux_cfg_active', 'is', 'T']
        ];
        var columns = [new nlobjSearchColumn('custrecord_flux_cfg_data')];
        var results = nlapiSearchRecord('customrecord_flux_config', null, filters, columns);

        if (results && results.length > 0) {
            var data = JSON.parse(results[0].getValue('custrecord_flux_cfg_data'));
            // Allow 24 hour grace period
            if (data && data.valid && data._expires && data._expires > new Date().getTime()) {
                return true;
            }
        }
    } catch (e) {
        // Fallback failed
    }
    return false;
}

/**
 * Main entry point for Email Capture Plug-in
 * Called by NetSuite when an email is received at the plug-in's email address
 *
 * @param {nlobjEmailObject} email - The email object provided by NetSuite
 */
function process(email) {
    // LICENSE CHECK - Block if unlicensed
    if (!_validateLicense()) {
        nlapiLogExecution('ERROR', 'Flux License', 'License validation failed - email processing blocked');
        return;
    }

    try {
        var subject = email.getSubject() || '(No Subject)';
        var sender = email.getFrom();
        var senderEmail = sender ? sender.getEmail() : '';
        var senderName = sender ? sender.getName() : '';

        nlapiLogExecution('AUDIT', 'Flux Capture: Email Received',
            'From: ' + senderEmail + ', Subject: ' + subject);

        var attachments = email.getAttachments();

        if (!attachments || attachments.length === 0) {
            nlapiLogExecution('AUDIT', 'Flux Capture: No Attachments',
                'Email from ' + senderEmail + ' had no attachments');
            return;
        }

        // Supported file extensions and MIME types
        var supportedExtensions = ['pdf', 'png', 'jpg', 'jpeg', 'tiff', 'tif'];

        var importedCount = 0;
        var skippedCount = 0;

        for (var i = 0; i < attachments.length; i++) {
            var attachment = attachments[i];
            var fileName = attachment.getName() || 'attachment_' + i;
            var fileContent = attachment.getValue();

            // Get file extension
            var ext = fileName.toLowerCase().split('.').pop();

            // Check if supported
            var isSupported = false;
            for (var j = 0; j < supportedExtensions.length; j++) {
                if (ext === supportedExtensions[j]) {
                    isSupported = true;
                    break;
                }
            }

            if (!isSupported) {
                nlapiLogExecution('DEBUG', 'Flux Capture: Skipped',
                    'File ' + fileName + ' is not a supported type');
                skippedCount++;
                continue;
            }

            try {
                // Create file in File Cabinet
                var fileObj = createFile(fileName, fileContent, ext);

                if (fileObj) {
                    // Create Flux Document record
                    var docId = createFluxDocument(fileObj, fileName, senderEmail, subject);

                    if (docId) {
                        importedCount++;
                        nlapiLogExecution('AUDIT', 'Flux Capture: Document Created',
                            'Document ID: ' + docId + ', File: ' + fileName);
                    }
                }
            } catch (fileError) {
                nlapiLogExecution('ERROR', 'Flux Capture: File Error',
                    'Error processing ' + fileName + ': ' + fileError.toString());
            }
        }

        nlapiLogExecution('AUDIT', 'Flux Capture: Import Complete',
            'Imported: ' + importedCount + ', Skipped: ' + skippedCount +
            '. Processing triggered automatically via User Event.');

        // Update persistent email stats in flux_config
        if (importedCount > 0) {
            updateEmailStats(importedCount);
        }

    } catch (e) {
        nlapiLogExecution('ERROR', 'Flux Capture: Plugin Error', e.toString());
    }
}

/**
 * Create a file in the NetSuite File Cabinet
 * @param {string} fileName - Original file name
 * @param {string} content - File content (base64 or raw)
 * @param {string} ext - File extension
 * @returns {nlobjFile} The created file object
 */
function createFile(fileName, content, ext) {
    // Determine file type
    var fileType;
    switch (ext) {
        case 'pdf':
            fileType = 'PDF';
            break;
        case 'png':
            fileType = 'PNGIMAGE';
            break;
        case 'jpg':
        case 'jpeg':
            fileType = 'JPGIMAGE';
            break;
        case 'tiff':
        case 'tif':
            fileType = 'TIFFIMAGE';
            break;
        default:
            fileType = 'PDF';
    }

    // Create unique filename with timestamp
    var timestamp = new Date().getTime();
    var uniqueName = 'email_' + timestamp + '_' + fileName;

    // Create the file
    var file = nlapiCreateFile(uniqueName, fileType, content);

    // Set folder - use SuiteApps folder or create dedicated folder
    var folderId = getOrCreateFolder();
    file.setFolder(folderId);

    // Save and get internal ID
    var fileId = nlapiSubmitFile(file);

    return {
        id: fileId,
        name: uniqueName,
        originalName: fileName
    };
}

/**
 * Get or create the Flux Capture upload folder
 * @returns {number} Folder internal ID
 */
function getOrCreateFolder() {
    // Search for existing folder
    var filters = [
        ['name', 'is', 'Flux Capture Uploads']
    ];
    var results = nlapiSearchRecord('folder', null, filters);

    if (results && results.length > 0) {
        return results[0].getId();
    }

    // Create folder if it doesn't exist
    var folder = nlapiCreateRecord('folder');
    folder.setFieldValue('name', 'Flux Capture Uploads');
    folder.setFieldValue('description', 'Documents uploaded via email for Flux Capture processing');

    return nlapiSubmitRecord(folder);
}

/**
 * Create a Flux Document custom record
 * @param {Object} fileObj - File object with id, name, originalName
 * @param {string} originalFileName - Original file name from email
 * @param {string} senderEmail - Email sender address
 * @param {string} subject - Email subject
 * @returns {number} Document record internal ID
 */
function createFluxDocument(fileObj, originalFileName, senderEmail, subject) {
    var doc = nlapiCreateRecord('customrecord_flux_document');

    // Core fields
    doc.setFieldValue('custrecord_flux_original_filename', originalFileName);
    doc.setFieldValue('custrecord_flux_source_file', fileObj.id);
    doc.setFieldValue('custrecord_flux_status', '1'); // 1 = Pending
    doc.setFieldValue('custrecord_flux_source', '2'); // 2 = Email
    doc.setFieldValue('custrecord_flux_document_type', '6'); // 6 = Unknown (auto-detect)

    // Set created date for proper sorting in queue
    doc.setFieldValue('custrecord_flux_created_date', nlapiDateToString(new Date(), 'datetimetz'));

    // Email metadata
    doc.setFieldValue('custrecord_flux_email_sender', senderEmail);
    doc.setFieldValue('custrecord_flux_email_subject', subject);
    doc.setFieldValue('custrecord_flux_email_received', nlapiDateToString(new Date(), 'datetimetz'));

    // Initialize JSON fields
    doc.setFieldValue('custrecord_flux_line_items', '[]');
    doc.setFieldValue('custrecord_flux_anomalies', '[]');
    doc.setFieldValue('custrecord_flux_confidence_score', '0');

    // Only set uploaded_by if we have a valid (positive) user ID
    // System users like -4 are not valid employee references
    var userId = nlapiGetContext().getUser();
    if (userId && parseInt(userId) > 0) {
        doc.setFieldValue('custrecord_flux_uploaded_by', userId);
    }

    return nlapiSubmitRecord(doc);
}

/**
 * Update email statistics in flux_config
 * Increments documentsTotal and documentsToday counters
 * @param {number} count - Number of documents imported
 */
function updateEmailStats(count) {
    try {
        var today = nlapiDateToString(new Date(), 'date');
        var configId = null;
        var currentStats = {
            documentsTotal: 0,
            documentsToday: 0,
            lastDate: ''
        };

        // Search for existing stats config
        var filters = [
            ['custrecord_flux_cfg_type', 'is', 'email_capture'],
            'AND',
            ['custrecord_flux_cfg_key', 'is', 'stats']
        ];
        var columns = ['internalid', 'custrecord_flux_cfg_data'];
        var results = nlapiSearchRecord('customrecord_flux_config', null, filters, columns);

        if (results && results.length > 0) {
            configId = results[0].getId();
            var dataStr = results[0].getValue('custrecord_flux_cfg_data');
            if (dataStr) {
                try {
                    currentStats = JSON.parse(dataStr);
                } catch (parseErr) {
                    // Use defaults if parse fails
                }
            }
        }

        // Reset documentsToday if it's a new day
        if (currentStats.lastDate !== today) {
            currentStats.documentsToday = 0;
            currentStats.lastDate = today;
        }

        // Increment counters
        currentStats.documentsTotal = (parseInt(currentStats.documentsTotal) || 0) + count;
        currentStats.documentsToday = (parseInt(currentStats.documentsToday) || 0) + count;

        // Save to flux_config
        var configRecord;
        if (configId) {
            configRecord = nlapiLoadRecord('customrecord_flux_config', configId);
        } else {
            configRecord = nlapiCreateRecord('customrecord_flux_config');
            configRecord.setFieldValue('name', 'Email Statistics');
            configRecord.setFieldValue('custrecord_flux_cfg_type', 'email_capture');
            configRecord.setFieldValue('custrecord_flux_cfg_key', 'stats');
        }

        configRecord.setFieldValue('custrecord_flux_cfg_data', JSON.stringify(currentStats));
        configRecord.setFieldValue('custrecord_flux_cfg_active', 'T');
        nlapiSubmitRecord(configRecord);

        nlapiLogExecution('DEBUG', 'Flux Capture: Stats Updated',
            'Today: ' + currentStats.documentsToday + ', Total: ' + currentStats.documentsTotal);

    } catch (statsErr) {
        nlapiLogExecution('ERROR', 'Flux Capture: Stats Error', statsErr.toString());
        // Don't throw - stats update failure shouldn't break email processing
    }
}

// Note: Document processing is triggered automatically by the User Event script
// (FC_Document_UE.js) which fires afterSubmit when flux_document records are created.
// This ensures processing works for all sources: email, UI upload, and API.
