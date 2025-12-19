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
 * Main entry point for Email Capture Plug-in
 * Called by NetSuite when an email is received at the plug-in's email address
 *
 * @param {nlobjEmailObject} email - The email object provided by NetSuite
 */
function process(email) {
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
            '. Processing will be triggered automatically by User Event script.');

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

// Note: Document processing is now triggered automatically by the User Event script
// (FC_Document_UE.js) which fires afterSubmit on customrecord_flux_document creation.
// This ensures consistent processing for all document sources (email, UI, API).
