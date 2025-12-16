/**
 * @NApiVersion 2.1
 * @NScriptType Restlet
 * @NModuleScope SameAccount
 *
 * Flux Capture - Main API Router
 * Single RESTlet that handles all API operations for simplified deployment
 *
 * Endpoints:
 * GET    - Retrieve documents, stats, queue status, vendors, POs
 * POST   - Upload, process, batch operations, email import
 * PUT    - Update, approve, reject, settings
 * DELETE - Remove documents, batches, clear completed
 */

define([
    'N/file',
    'N/record',
    'N/search',
    'N/query',
    'N/runtime',
    'N/error',
    'N/log',
    'N/encode',
    'N/email',
    'N/format',
    './FC_Engine'
], function(file, record, search, query, runtime, error, log, encode, email, format, Engine) {

    const API_VERSION = '2.0.0';

    // ==================== Status Constants ====================

    const DocStatus = Object.freeze({
        PENDING: 'pending',
        PROCESSING: 'processing',
        EXTRACTED: 'extracted',
        NEEDS_REVIEW: 'needs_review',
        APPROVED: 'approved',
        REJECTED: 'rejected',
        COMPLETED: 'completed',
        ERROR: 'error'
    });

    const BatchStatus = Object.freeze({
        PENDING: 'pending',
        PROCESSING: 'processing',
        COMPLETED: 'completed',
        PARTIAL_ERROR: 'partial_error',
        FAILED: 'failed',
        CANCELLED: 'cancelled'
    });

    const Source = Object.freeze({
        UPLOAD: 'upload',
        EMAIL: 'email',
        DRAG_DROP: 'drag_drop',
        API: 'api',
        SCANNER: 'scanner',
        MOBILE: 'mobile'
    });

    // ==================== Response Helpers ====================

    const Response = {
        success: (data, message = 'Success') => ({
            success: true,
            version: API_VERSION,
            timestamp: new Date().toISOString(),
            message: message,
            data: data
        }),

        error: (code, message, details = null) => ({
            success: false,
            version: API_VERSION,
            timestamp: new Date().toISOString(),
            error: {
                code: code,
                message: message,
                details: details
            }
        }),

        paginated: (data, page, pageSize, total) => ({
            success: true,
            version: API_VERSION,
            timestamp: new Date().toISOString(),
            data: data,
            pagination: {
                page: page,
                pageSize: pageSize,
                total: total,
                totalPages: Math.ceil(total / pageSize),
                hasMore: (page * pageSize) < total
            }
        })
    };

    // ==================== GET Handler ====================

    function get(context) {
        try {
            const action = context.action || 'list';

            switch (action) {
                case 'document':
                    return getDocument(context.id);
                case 'list':
                    return getDocumentList(context);
                case 'queue':
                    return getProcessingQueue(context);
                case 'stats':
                    return getDashboardStats();
                case 'anomalies':
                    return getRecentAnomalies(context);
                case 'vendors':
                    return searchVendors(context.query);
                case 'purchaseorders':
                    return searchPurchaseOrders(context);
                case 'batches':
                    return getBatches(context);
                case 'batch':
                    return getBatchDetails(context.id);
                case 'settings':
                    return getSettings();
                case 'analytics':
                    return getAnalytics(context);
                case 'health':
                    return Response.success({ status: 'healthy', version: API_VERSION });
                default:
                    return Response.error('INVALID_ACTION', `Unknown action: ${action}`);
            }
        } catch (e) {
            log.error('GET Error', e);
            return Response.error('GET_FAILED', e.message);
        }
    }

    // ==================== POST Handler ====================

    function post(context) {
        try {
            const action = context.action || 'upload';

            switch (action) {
                case 'upload':
                    return uploadDocument(context);
                case 'batch':
                    return uploadBatch(context);
                case 'process':
                    return processDocument(context.documentId);
                case 'processBatch':
                    return processBatchDocuments(context);
                case 'reprocess':
                    return reprocessDocument(context.documentId);
                case 'emailImport':
                    return importFromEmail(context);
                case 'checkEmails':
                    return checkEmailInbox(context);
                case 'learn':
                    return submitCorrection(context);
                default:
                    return Response.error('INVALID_ACTION', `Unknown action: ${action}`);
            }
        } catch (e) {
            log.error('POST Error', e);
            return Response.error('POST_FAILED', e.message);
        }
    }

    // ==================== PUT Handler ====================

    function put(context) {
        try {
            const action = context.action || 'update';

            switch (action) {
                case 'update':
                    return updateDocument(context);
                case 'approve':
                    return approveDocument(context);
                case 'reject':
                    return rejectDocument(context);
                case 'status':
                    return updateStatus(context);
                case 'assign':
                    return assignDocument(context);
                case 'settings':
                    return updateSettings(context);
                default:
                    return Response.error('INVALID_ACTION', `Unknown action: ${action}`);
            }
        } catch (e) {
            log.error('PUT Error', e);
            return Response.error('PUT_FAILED', e.message);
        }
    }

    // ==================== DELETE Handler ====================

    function _delete(context) {
        try {
            const action = context.action || 'document';

            switch (action) {
                case 'document':
                    return deleteDocument(context.id);
                case 'batch':
                    return deleteBatch(context.batchId);
                case 'clear':
                    return clearCompleted(context);
                default:
                    return Response.error('INVALID_ACTION', `Unknown action: ${action}`);
            }
        } catch (e) {
            log.error('DELETE Error', e);
            return Response.error('DELETE_FAILED', e.message);
        }
    }

    // ==================== GET Implementations ====================

    function getDocument(documentId) {
        if (!documentId) {
            return Response.error('MISSING_PARAM', 'Document ID is required');
        }

        const docRecord = record.load({
            type: 'customrecord_dm_captured_document',
            id: documentId
        });

        const lineItems = JSON.parse(docRecord.getValue('custrecord_dm_line_items') || '[]');
        const anomalies = JSON.parse(docRecord.getValue('custrecord_dm_anomalies') || '[]');
        const status = docRecord.getValue('custrecord_dm_status');

        const document = {
            id: documentId,
            name: docRecord.getValue('name'),
            status: status,
            statusText: getStatusDisplayText(status),
            documentType: docRecord.getValue('custrecord_dm_document_type'),
            documentTypeText: getDocTypeDisplayText(docRecord.getValue('custrecord_dm_document_type')),
            sourceFile: docRecord.getValue('custrecord_dm_source_file'),
            documentId: docRecord.getValue('custrecord_dm_document_id'),
            batchId: docRecord.getValue('custrecord_dm_batch_id'),
            uploadedBy: docRecord.getValue('custrecord_dm_uploaded_by'),
            uploadedByName: docRecord.getText('custrecord_dm_uploaded_by'),
            createdDate: docRecord.getValue('custrecord_dm_created_date'),
            modifiedDate: docRecord.getValue('custrecord_dm_modified_date'),
            confidence: docRecord.getValue('custrecord_dm_confidence_score'),
            vendor: docRecord.getValue('custrecord_dm_vendor'),
            vendorName: docRecord.getText('custrecord_dm_vendor'),
            vendorMatchConfidence: docRecord.getValue('custrecord_dm_vendor_match_confidence'),
            invoiceNumber: docRecord.getValue('custrecord_dm_invoice_number'),
            invoiceDate: docRecord.getValue('custrecord_dm_invoice_date'),
            dueDate: docRecord.getValue('custrecord_dm_due_date'),
            poNumber: docRecord.getValue('custrecord_dm_po_number'),
            subtotal: docRecord.getValue('custrecord_dm_subtotal'),
            taxAmount: docRecord.getValue('custrecord_dm_tax_amount'),
            totalAmount: docRecord.getValue('custrecord_dm_total_amount'),
            currency: docRecord.getValue('custrecord_dm_currency'),
            currencyText: docRecord.getText('custrecord_dm_currency'),
            paymentTerms: docRecord.getValue('custrecord_dm_payment_terms'),
            lineItems: lineItems,
            anomalies: anomalies,
            amountValidated: docRecord.getValue('custrecord_dm_amount_validated'),
            createdTransaction: docRecord.getValue('custrecord_dm_created_transaction'),
            source: docRecord.getValue('custrecord_dm_source'),
            sourceText: getSourceDisplayText(docRecord.getValue('custrecord_dm_source')),
            emailSender: docRecord.getValue('custrecord_dm_email_sender'),
            emailSubject: docRecord.getValue('custrecord_dm_email_subject'),
            rejectionReason: docRecord.getValue('custrecord_dm_rejection_reason'),
            errorMessage: docRecord.getValue('custrecord_dm_error_message'),
            processingTime: docRecord.getValue('custrecord_dm_processing_time')
        };

        // Get file URL for preview
        if (document.sourceFile) {
            try {
                const fileObj = file.load({ id: document.sourceFile });
                document.fileUrl = fileObj.url;
                document.fileName = fileObj.name;
                document.fileSize = fileObj.size;
                document.fileType = fileObj.fileType;
            } catch (e) {
                log.debug('File load error', e.message);
            }
        }

        return Response.success(document);
    }

    function getDocumentList(context) {
        const page = parseInt(context.page) || 1;
        const pageSize = Math.min(parseInt(context.pageSize) || 25, 100);
        const status = context.status;
        const docType = context.documentType;
        const dateFrom = context.dateFrom;
        const dateTo = context.dateTo;
        const vendorId = context.vendorId;
        const batchId = context.batchId;
        const sortBy = context.sortBy || 'created';
        const sortDir = context.sortDir === 'asc' ? 'ASC' : 'DESC';

        let sql = `
            SELECT
                id, name,
                custrecord_dm_status as status,
                custrecord_dm_document_type as documentType,
                custrecord_dm_confidence_score as confidence,
                custrecord_dm_vendor as vendorId,
                BUILTIN.DF(custrecord_dm_vendor) as vendorName,
                custrecord_dm_invoice_number as invoiceNumber,
                custrecord_dm_total_amount as totalAmount,
                custrecord_dm_anomalies as anomalies,
                custrecord_dm_created_date as createdDate,
                custrecord_dm_uploaded_by as uploadedBy,
                BUILTIN.DF(custrecord_dm_uploaded_by) as uploadedByName,
                custrecord_dm_source as source
            FROM customrecord_dm_captured_document
            WHERE 1=1
        `;

        const params = [];

        if (status) {
            sql += ` AND custrecord_dm_status = ?`;
            params.push(status);
        }
        if (docType) {
            sql += ` AND custrecord_dm_document_type = ?`;
            params.push(docType);
        }
        if (vendorId) {
            sql += ` AND custrecord_dm_vendor = ?`;
            params.push(vendorId);
        }
        if (batchId) {
            sql += ` AND custrecord_dm_batch_id = ?`;
            params.push(batchId);
        }
        if (dateFrom) {
            sql += ` AND custrecord_dm_created_date >= TO_DATE(?, 'YYYY-MM-DD')`;
            params.push(dateFrom);
        }
        if (dateTo) {
            sql += ` AND custrecord_dm_created_date <= TO_DATE(?, 'YYYY-MM-DD')`;
            params.push(dateTo);
        }

        // Get total count
        const countSql = sql.replace(/SELECT[\s\S]*?FROM/, 'SELECT COUNT(*) as total FROM');
        const countResult = query.runSuiteQL({ query: countSql, params: params });
        const total = countResult.results.length > 0 ? countResult.results[0].values[0] : 0;

        // Add sorting and pagination
        const sortColumn = {
            'created': 'custrecord_dm_created_date',
            'confidence': 'custrecord_dm_confidence_score',
            'vendor': 'custrecord_dm_vendor',
            'status': 'custrecord_dm_status',
            'amount': 'custrecord_dm_total_amount'
        }[sortBy] || 'custrecord_dm_created_date';

        sql += ` ORDER BY ${sortColumn} ${sortDir}`;
        sql += ` OFFSET ${(page - 1) * pageSize} ROWS FETCH NEXT ${pageSize} ROWS ONLY`;

        const results = query.runSuiteQL({ query: sql, params: params });

        const documents = results.results.map(row => {
            const v = row.values;
            const anomalies = v[9] ? JSON.parse(v[9]) : [];
            return {
                id: v[0],
                name: v[1],
                status: v[2],
                documentType: v[3],
                confidence: v[4],
                vendorId: v[5],
                vendorName: v[6],
                invoiceNumber: v[7],
                totalAmount: v[8],
                hasAnomalies: anomalies.length > 0,
                anomalyCount: anomalies.length,
                createdDate: v[10],
                uploadedBy: v[11],
                uploadedByName: v[12],
                source: v[13]
            };
        });

        return Response.paginated(documents, page, pageSize, total);
    }

    function getProcessingQueue(context) {
        const page = parseInt(context.page) || 1;
        const pageSize = Math.min(parseInt(context.pageSize) || 50, 100);

        const sql = `
            SELECT
                id, name,
                custrecord_dm_status as status,
                custrecord_dm_document_type as documentType,
                custrecord_dm_confidence_score as confidence,
                BUILTIN.DF(custrecord_dm_vendor) as vendorName,
                custrecord_dm_invoice_number as invoiceNumber,
                custrecord_dm_total_amount as totalAmount,
                custrecord_dm_created_date as createdDate,
                custrecord_dm_batch_id as batchId,
                custrecord_dm_anomalies as anomalies
            FROM customrecord_dm_captured_document
            WHERE custrecord_dm_status IN ('${DocStatus.PENDING}', '${DocStatus.PROCESSING}', '${DocStatus.EXTRACTED}', '${DocStatus.NEEDS_REVIEW}')
            ORDER BY
                CASE custrecord_dm_status
                    WHEN '${DocStatus.NEEDS_REVIEW}' THEN 1
                    WHEN '${DocStatus.EXTRACTED}' THEN 2
                    WHEN '${DocStatus.PROCESSING}' THEN 3
                    WHEN '${DocStatus.PENDING}' THEN 4
                END,
                custrecord_dm_created_date ASC
            OFFSET ${(page - 1) * pageSize} ROWS FETCH NEXT ${pageSize} ROWS ONLY
        `;

        const results = query.runSuiteQL({ query: sql });

        const queue = results.results.map(row => {
            const v = row.values;
            const anomalies = v[10] ? JSON.parse(v[10]) : [];
            return {
                id: v[0],
                name: v[1],
                status: v[2],
                documentType: v[3],
                confidence: v[4],
                vendorName: v[5],
                invoiceNumber: v[6],
                totalAmount: v[7],
                createdDate: v[8],
                batchId: v[9],
                hasAnomalies: anomalies.length > 0
            };
        });

        // Get queue counts by status
        const countSql = `
            SELECT custrecord_dm_status as status, COUNT(*) as count
            FROM customrecord_dm_captured_document
            WHERE custrecord_dm_status IN ('${DocStatus.PENDING}', '${DocStatus.PROCESSING}', '${DocStatus.EXTRACTED}', '${DocStatus.NEEDS_REVIEW}')
            GROUP BY custrecord_dm_status
        `;

        const countResults = query.runSuiteQL({ query: countSql });
        const statusCounts = {};
        countResults.results.forEach(row => {
            statusCounts[row.values[0]] = row.values[1];
        });

        return Response.success({
            queue: queue,
            counts: statusCounts,
            total: Object.values(statusCounts).reduce((a, b) => a + b, 0)
        });
    }

    function getDashboardStats() {
        const statsSql = `
            SELECT
                COUNT(*) as total,
                SUM(CASE WHEN custrecord_dm_status = '${DocStatus.COMPLETED}' THEN 1 ELSE 0 END) as completed,
                SUM(CASE WHEN custrecord_dm_status = '${DocStatus.COMPLETED}' AND custrecord_dm_confidence_score >= 85 THEN 1 ELSE 0 END) as autoProcessed,
                SUM(CASE WHEN custrecord_dm_status IN ('${DocStatus.PENDING}', '${DocStatus.PROCESSING}', '${DocStatus.EXTRACTED}', '${DocStatus.NEEDS_REVIEW}') THEN 1 ELSE 0 END) as pending,
                SUM(CASE WHEN custrecord_dm_status = '${DocStatus.REJECTED}' THEN 1 ELSE 0 END) as rejected,
                SUM(CASE WHEN custrecord_dm_status = '${DocStatus.ERROR}' THEN 1 ELSE 0 END) as errors,
                AVG(custrecord_dm_confidence_score) as avgConfidence,
                SUM(custrecord_dm_total_amount) as totalValue
            FROM customrecord_dm_captured_document
            WHERE custrecord_dm_created_date >= ADD_MONTHS(SYSDATE, -1)
        `;

        const statsResult = query.runSuiteQL({ query: statsSql });
        const stats = statsResult.results[0].values;

        // Get document type breakdown
        const typeSql = `
            SELECT custrecord_dm_document_type as docType, COUNT(*) as count
            FROM customrecord_dm_captured_document
            WHERE custrecord_dm_created_date >= ADD_MONTHS(SYSDATE, -1)
            GROUP BY custrecord_dm_document_type
        `;

        const typeResults = query.runSuiteQL({ query: typeSql });
        const typeBreakdown = {};
        typeResults.results.forEach(row => {
            typeBreakdown[row.values[0] || 'Unknown'] = row.values[1];
        });

        // Get daily trend (last 7 days)
        const trendSql = `
            SELECT TO_CHAR(custrecord_dm_created_date, 'YYYY-MM-DD') as day, COUNT(*) as count
            FROM customrecord_dm_captured_document
            WHERE custrecord_dm_created_date >= SYSDATE - 7
            GROUP BY TO_CHAR(custrecord_dm_created_date, 'YYYY-MM-DD')
            ORDER BY day
        `;

        const trendResults = query.runSuiteQL({ query: trendSql });
        const trend = trendResults.results.map(row => ({
            date: row.values[0],
            count: row.values[1]
        }));

        return Response.success({
            summary: {
                totalProcessed: stats[0] || 0,
                completed: stats[1] || 0,
                autoProcessed: stats[2] || 0,
                pendingReview: stats[3] || 0,
                rejected: stats[4] || 0,
                errors: stats[5] || 0,
                avgConfidence: Math.round(stats[6] || 0),
                totalValue: stats[7] || 0
            },
            typeBreakdown: typeBreakdown,
            trend: trend,
            autoProcessRate: stats[0] > 0 ? Math.round((stats[2] / stats[0]) * 100) : 0
        });
    }

    function getRecentAnomalies(context) {
        const limit = Math.min(parseInt(context.limit) || 10, 50);

        const sql = `
            SELECT
                id,
                name,
                BUILTIN.DF(custrecord_dm_vendor) as vendorName,
                custrecord_dm_anomalies as anomalies,
                custrecord_dm_created_date as createdDate,
                custrecord_dm_confidence_score as confidence
            FROM customrecord_dm_captured_document
            WHERE custrecord_dm_anomalies IS NOT NULL
            AND custrecord_dm_anomalies != '[]'
            AND custrecord_dm_status NOT IN ('${DocStatus.REJECTED}', '${DocStatus.COMPLETED}')
            ORDER BY custrecord_dm_created_date DESC
            FETCH FIRST ${limit} ROWS ONLY
        `;

        const results = query.runSuiteQL({ query: sql });

        const anomalies = [];
        results.results.forEach(row => {
            const docAnomalies = JSON.parse(row.values[3] || '[]');
            docAnomalies.forEach(anomaly => {
                anomalies.push({
                    documentId: row.values[0],
                    documentName: row.values[1],
                    vendorName: row.values[2],
                    type: anomaly.type,
                    severity: anomaly.severity,
                    message: anomaly.message,
                    createdDate: row.values[4],
                    confidence: row.values[5]
                });
            });
        });

        // Sort by severity
        const severityOrder = { high: 0, medium: 1, low: 2 };
        anomalies.sort((a, b) => severityOrder[a.severity] - severityOrder[b.severity]);

        return Response.success(anomalies.slice(0, limit));
    }

    function searchVendors(queryText) {
        if (!queryText || queryText.length < 2) {
            return Response.error('INVALID_QUERY', 'Search query must be at least 2 characters');
        }

        const sql = `
            SELECT id, companyname, entityid, email, phone, BUILTIN.DF(currency) as currency
            FROM vendor
            WHERE isinactive = 'F'
            AND (LOWER(companyname) LIKE LOWER(?) OR LOWER(entityid) LIKE LOWER(?))
            ORDER BY companyname
            FETCH FIRST 20 ROWS ONLY
        `;

        const searchPattern = `%${queryText}%`;
        const results = query.runSuiteQL({ query: sql, params: [searchPattern, searchPattern] });

        const vendors = results.results.map(row => ({
            id: row.values[0],
            companyName: row.values[1],
            entityId: row.values[2],
            email: row.values[3],
            phone: row.values[4],
            currency: row.values[5]
        }));

        return Response.success(vendors);
    }

    function searchPurchaseOrders(context) {
        const poNumber = context.poNumber;
        const vendorId = context.vendorId;

        let sql = `
            SELECT id, tranid, BUILTIN.DF(entity) as vendorName, entity as vendorId,
                trandate, total, status, BUILTIN.DF(status) as statusText
            FROM transaction
            WHERE type = 'PurchOrd' AND status NOT IN ('Closed', 'Cancelled')
        `;

        const params = [];

        if (poNumber) {
            sql += ` AND LOWER(tranid) LIKE LOWER(?)`;
            params.push(`%${poNumber}%`);
        }
        if (vendorId) {
            sql += ` AND entity = ?`;
            params.push(vendorId);
        }

        sql += ` ORDER BY trandate DESC FETCH FIRST 20 ROWS ONLY`;

        const results = query.runSuiteQL({ query: sql, params: params });

        const purchaseOrders = results.results.map(row => ({
            id: row.values[0],
            poNumber: row.values[1],
            vendorName: row.values[2],
            vendorId: row.values[3],
            date: row.values[4],
            total: row.values[5],
            status: row.values[6],
            statusText: row.values[7]
        }));

        return Response.success(purchaseOrders);
    }

    function getBatches(context) {
        const page = parseInt(context.page) || 1;
        const pageSize = Math.min(parseInt(context.pageSize) || 25, 100);
        const status = context.status;

        let sql = `
            SELECT
                id, name,
                custrecord_dm_batch_status as status,
                custrecord_dm_batch_document_count as documentCount,
                custrecord_dm_batch_processed_count as processedCount,
                custrecord_dm_batch_error_count as errorCount,
                custrecord_dm_batch_created_date as createdDate,
                custrecord_dm_batch_completed_date as completedDate,
                BUILTIN.DF(custrecord_dm_batch_created_by) as createdBy,
                custrecord_dm_batch_total_value as totalValue
            FROM customrecord_dm_batch
            WHERE 1=1
        `;

        const params = [];
        if (status) {
            sql += ` AND custrecord_dm_batch_status = ?`;
            params.push(status);
        }

        sql += ` ORDER BY custrecord_dm_batch_created_date DESC`;
        sql += ` OFFSET ${(page - 1) * pageSize} ROWS FETCH NEXT ${pageSize} ROWS ONLY`;

        const results = query.runSuiteQL({ query: sql, params: params });

        const batches = results.results.map(row => ({
            id: row.values[0],
            name: row.values[1],
            status: row.values[2],
            documentCount: row.values[3],
            processedCount: row.values[4],
            errorCount: row.values[5],
            createdDate: row.values[6],
            completedDate: row.values[7],
            createdBy: row.values[8],
            totalValue: row.values[9],
            progress: row.values[3] > 0 ? Math.round((row.values[4] / row.values[3]) * 100) : 0
        }));

        return Response.success(batches);
    }

    function getBatchDetails(batchId) {
        if (!batchId) {
            return Response.error('MISSING_PARAM', 'Batch ID is required');
        }

        const batchRecord = record.load({ type: 'customrecord_dm_batch', id: batchId });
        const status = batchRecord.getValue('custrecord_dm_batch_status');

        const batch = {
            id: batchId,
            name: batchRecord.getValue('name'),
            status: status,
            statusText: getBatchStatusDisplayText(status),
            documentCount: batchRecord.getValue('custrecord_dm_batch_document_count'),
            processedCount: batchRecord.getValue('custrecord_dm_batch_processed_count'),
            errorCount: batchRecord.getValue('custrecord_dm_batch_error_count'),
            createdDate: batchRecord.getValue('custrecord_dm_batch_created_date'),
            completedDate: batchRecord.getValue('custrecord_dm_batch_completed_date'),
            createdBy: batchRecord.getText('custrecord_dm_batch_created_by'),
            totalValue: batchRecord.getValue('custrecord_dm_batch_total_value'),
            avgConfidence: batchRecord.getValue('custrecord_dm_batch_avg_confidence')
        };

        // Get documents in batch
        const docSql = `
            SELECT id, name, custrecord_dm_status as status, custrecord_dm_confidence_score as confidence,
                BUILTIN.DF(custrecord_dm_vendor) as vendorName, custrecord_dm_total_amount as amount
            FROM customrecord_dm_captured_document
            WHERE custrecord_dm_batch_id = ?
            ORDER BY id
        `;

        const docResults = query.runSuiteQL({ query: docSql, params: [batchId] });
        batch.documents = docResults.results.map(row => ({
            id: row.values[0],
            name: row.values[1],
            status: row.values[2],
            confidence: row.values[3],
            vendorName: row.values[4],
            amount: row.values[5]
        }));

        return Response.success(batch);
    }

    function getSettings() {
        const settings = {
            autoApproveThreshold: 85,
            defaultDocumentType: 'auto',
            emailImportEnabled: true,
            emailAddress: `flux-${runtime.accountId}@netsuite.com`,
            duplicateDetection: true,
            amountValidation: true,
            maxFileSize: 10485760,
            supportedFileTypes: ['pdf', 'png', 'jpg', 'jpeg', 'tiff', 'tif', 'gif', 'bmp']
        };

        return Response.success(settings);
    }

    function getAnalytics(context) {
        const period = parseInt(context.period) || 30;

        const volumeSql = `
            SELECT TO_CHAR(custrecord_dm_created_date, 'YYYY-MM-DD') as day,
                COUNT(*) as total,
                SUM(CASE WHEN custrecord_dm_status = '${DocStatus.COMPLETED}' THEN 1 ELSE 0 END) as completed,
                AVG(custrecord_dm_confidence_score) as avgConfidence
            FROM customrecord_dm_captured_document
            WHERE custrecord_dm_created_date >= SYSDATE - ${period}
            GROUP BY TO_CHAR(custrecord_dm_created_date, 'YYYY-MM-DD')
            ORDER BY day
        `;

        const volumeResults = query.runSuiteQL({ query: volumeSql });
        const volumeTrend = volumeResults.results.map(row => ({
            date: row.values[0],
            total: row.values[1],
            completed: row.values[2],
            avgConfidence: Math.round(row.values[3] || 0)
        }));

        return Response.success({ period: period, volumeTrend: volumeTrend });
    }

    // ==================== POST Implementations ====================

    function uploadDocument(context) {
        const fileContent = context.fileContent;
        const fileName = context.fileName;
        const documentType = context.documentType || 'auto';
        const folderId = context.folderId || getUploadFolder();

        if (!fileContent || !fileName) {
            return Response.error('MISSING_PARAM', 'File content and name are required');
        }

        const fileExtension = fileName.split('.').pop().toLowerCase();
        const supportedTypes = ['pdf', 'png', 'jpg', 'jpeg', 'tiff', 'tif', 'gif', 'bmp'];

        if (!supportedTypes.includes(fileExtension)) {
            return Response.error('INVALID_FILE_TYPE', `File type .${fileExtension} is not supported`);
        }

        // Create file in File Cabinet
        const fileObj = file.create({
            name: fileName,
            fileType: getFileType(fileExtension),
            contents: fileContent,
            encoding: file.Encoding.BASE_64,
            folder: folderId,
            isOnline: true
        });

        const fileId = fileObj.save();
        const savedFile = file.load({ id: fileId });

        // Create captured document record
        const docRecord = record.create({ type: 'customrecord_dm_captured_document' });

        const docId = generateDocumentId();
        docRecord.setValue('name', fileName);
        docRecord.setValue('custrecord_dm_document_id', docId);
        docRecord.setValue('custrecord_dm_status', DocStatus.PENDING);
        docRecord.setValue('custrecord_dm_document_type', documentType === 'auto' ? '' : documentType);
        docRecord.setValue('custrecord_dm_source_file', fileId);
        docRecord.setValue('custrecord_dm_source', Source.UPLOAD);
        docRecord.setValue('custrecord_dm_uploaded_by', runtime.getCurrentUser().id);
        docRecord.setValue('custrecord_dm_created_date', new Date());

        const documentId = docRecord.save();

        // Auto-process if requested
        if (context.autoProcess !== false) {
            try {
                processDocument(documentId);
            } catch (e) {
                log.error('Auto-process failed', e);
            }
        }

        return Response.success({
            documentId: documentId,
            documentCode: docId,
            fileId: fileId,
            fileName: fileName,
            status: DocStatus.PENDING
        }, 'Document uploaded successfully');
    }

    function uploadBatch(context) {
        const files = context.files;
        const batchName = context.batchName || `Batch-${new Date().toISOString().slice(0,10)}`;

        if (!files || !Array.isArray(files) || files.length === 0) {
            return Response.error('MISSING_PARAM', 'Files array is required');
        }

        // Create batch record
        const batchRecord = record.create({ type: 'customrecord_dm_batch' });
        batchRecord.setValue('name', batchName);
        batchRecord.setValue('custrecord_dm_batch_status', BatchStatus.PENDING);
        batchRecord.setValue('custrecord_dm_batch_document_count', files.length);
        batchRecord.setValue('custrecord_dm_batch_processed_count', 0);
        batchRecord.setValue('custrecord_dm_batch_created_date', new Date());
        batchRecord.setValue('custrecord_dm_batch_created_by', runtime.getCurrentUser().id);
        batchRecord.setValue('custrecord_dm_batch_source', Source.UPLOAD);

        const batchId = batchRecord.save();

        const uploadResults = [];
        const folderId = getUploadFolder();

        files.forEach((fileData, index) => {
            try {
                const result = uploadDocument({
                    fileContent: fileData.fileContent,
                    fileName: fileData.fileName,
                    documentType: fileData.documentType || 'auto',
                    folderId: folderId,
                    autoProcess: false
                });

                if (result.success) {
                    record.submitFields({
                        type: 'customrecord_dm_captured_document',
                        id: result.data.documentId,
                        values: { 'custrecord_dm_batch_id': batchId }
                    });

                    uploadResults.push({
                        success: true,
                        index: index,
                        documentId: result.data.documentId,
                        fileName: fileData.fileName
                    });
                } else {
                    uploadResults.push({
                        success: false,
                        index: index,
                        fileName: fileData.fileName,
                        error: result.error.message
                    });
                }
            } catch (e) {
                uploadResults.push({
                    success: false,
                    index: index,
                    fileName: fileData.fileName,
                    error: e.message
                });
            }
        });

        // Update batch status to processing
        record.submitFields({
            type: 'customrecord_dm_batch',
            id: batchId,
            values: { 'custrecord_dm_batch_status': BatchStatus.PROCESSING }
        });

        return Response.success({
            batchId: batchId,
            batchName: batchName,
            totalFiles: files.length,
            successCount: uploadResults.filter(r => r.success).length,
            failedCount: uploadResults.filter(r => !r.success).length,
            results: uploadResults
        }, 'Batch uploaded successfully');
    }

    function processDocument(documentId) {
        if (!documentId) {
            return Response.error('MISSING_PARAM', 'Document ID is required');
        }

        // Update status to processing
        record.submitFields({
            type: 'customrecord_dm_captured_document',
            id: documentId,
            values: { 'custrecord_dm_status': DocStatus.PROCESSING }
        });

        try {
            const docRecord = record.load({
                type: 'customrecord_dm_captured_document',
                id: documentId
            });

            const fileId = docRecord.getValue('custrecord_dm_source_file');
            const documentType = docRecord.getValue('custrecord_dm_document_type');

            if (!fileId) {
                throw new Error('No file attached to document');
            }

            // Initialize engine and process
            const engine = new Engine.FluxCaptureEngine();
            const startTime = Date.now();

            const result = engine.processDocument(fileId, {
                documentType: documentType,
                enableFraudDetection: true,
                enableLearning: true
            });

            const processingTime = Date.now() - startTime;

            if (result.success) {
                const extraction = result.extraction;

                // Determine status based on confidence
                let newStatus = DocStatus.NEEDS_REVIEW;
                if (extraction.confidence.overall >= 85 && extraction.anomalies.length === 0) {
                    newStatus = DocStatus.EXTRACTED;
                }

                // Update document record
                record.submitFields({
                    type: 'customrecord_dm_captured_document',
                    id: documentId,
                    values: {
                        'custrecord_dm_status': newStatus,
                        'custrecord_dm_document_type': extraction.documentType || documentType,
                        'custrecord_dm_vendor': extraction.vendorMatch?.vendorId || null,
                        'custrecord_dm_vendor_match_confidence': extraction.vendorMatch?.confidence || 0,
                        'custrecord_dm_invoice_number': extraction.fields?.invoiceNumber || '',
                        'custrecord_dm_invoice_date': extraction.fields?.invoiceDate || null,
                        'custrecord_dm_due_date': extraction.fields?.dueDate || null,
                        'custrecord_dm_subtotal': extraction.fields?.subtotal || 0,
                        'custrecord_dm_tax_amount': extraction.fields?.taxAmount || 0,
                        'custrecord_dm_total_amount': extraction.fields?.totalAmount || 0,
                        'custrecord_dm_currency': extraction.fields?.currency || null,
                        'custrecord_dm_po_number': extraction.fields?.poNumber || '',
                        'custrecord_dm_line_items': JSON.stringify(extraction.lineItems || []),
                        'custrecord_dm_anomalies': JSON.stringify(extraction.anomalies || []),
                        'custrecord_dm_confidence_score': extraction.confidence.overall,
                        'custrecord_dm_amount_validated': extraction.amountValidation?.valid || false,
                        'custrecord_dm_processing_time': processingTime,
                        'custrecord_dm_modified_date': new Date()
                    }
                });

                return Response.success({
                    documentId: documentId,
                    status: newStatus === DocStatus.EXTRACTED ? 'extracted' : 'needs_review',
                    confidence: extraction.confidence.overall,
                    anomalyCount: extraction.anomalies.length,
                    processingTime: processingTime
                }, 'Document processed successfully');
            } else {
                record.submitFields({
                    type: 'customrecord_dm_captured_document',
                    id: documentId,
                    values: {
                        'custrecord_dm_status': DocStatus.ERROR,
                        'custrecord_dm_error_message': result.error
                    }
                });

                return Response.error('PROCESSING_FAILED', result.error);
            }
        } catch (e) {
            log.error('Document processing error', e);

            record.submitFields({
                type: 'customrecord_dm_captured_document',
                id: documentId,
                values: {
                    'custrecord_dm_status': DocStatus.ERROR,
                    'custrecord_dm_error_message': e.message
                }
            });

            return Response.error('PROCESSING_ERROR', e.message);
        }
    }

    function processBatchDocuments(context) {
        const batchId = context.batchId;
        const documentIds = context.documentIds;

        let docsToProcess = [];

        if (batchId) {
            // Get all pending docs in batch
            const sql = `
                SELECT id FROM customrecord_dm_captured_document
                WHERE custrecord_dm_batch_id = ? AND custrecord_dm_status = '${DocStatus.PENDING}'
            `;
            const results = query.runSuiteQL({ query: sql, params: [batchId] });
            docsToProcess = results.results.map(r => r.values[0]);
        } else if (documentIds && Array.isArray(documentIds)) {
            docsToProcess = documentIds;
        } else {
            return Response.error('MISSING_PARAM', 'Batch ID or document IDs required');
        }

        const processResults = [];
        let processed = 0;
        let errors = 0;

        docsToProcess.forEach(docId => {
            try {
                const result = processDocument(docId);
                if (result.success) {
                    processed++;
                    processResults.push({ documentId: docId, success: true });
                } else {
                    errors++;
                    processResults.push({ documentId: docId, success: false, error: result.error.message });
                }
            } catch (e) {
                errors++;
                processResults.push({ documentId: docId, success: false, error: e.message });
            }
        });

        // Update batch status
        if (batchId) {
            updateBatchProgress(batchId);
        }

        return Response.success({
            total: docsToProcess.length,
            processed: processed,
            errors: errors,
            results: processResults
        }, 'Batch processing complete');
    }

    function reprocessDocument(documentId) {
        if (!documentId) {
            return Response.error('MISSING_PARAM', 'Document ID is required');
        }

        // Reset document
        record.submitFields({
            type: 'customrecord_dm_captured_document',
            id: documentId,
            values: {
                'custrecord_dm_status': DocStatus.PENDING,
                'custrecord_dm_line_items': '[]',
                'custrecord_dm_anomalies': '[]',
                'custrecord_dm_confidence_score': 0,
                'custrecord_dm_error_message': ''
            }
        });

        return processDocument(documentId);
    }

    function importFromEmail(context) {
        const attachments = context.attachments;
        const emailSender = context.emailSender;
        const emailSubject = context.emailSubject;

        if (!attachments || attachments.length === 0) {
            return Response.error('NO_ATTACHMENTS', 'No attachments found');
        }

        const results = [];

        attachments.forEach(att => {
            try {
                const result = uploadDocument({
                    fileContent: att.content,
                    fileName: att.name,
                    documentType: 'auto',
                    autoProcess: true
                });

                if (result.success) {
                    record.submitFields({
                        type: 'customrecord_dm_captured_document',
                        id: result.data.documentId,
                        values: {
                            'custrecord_dm_source': Source.EMAIL,
                            'custrecord_dm_email_sender': emailSender,
                            'custrecord_dm_email_subject': emailSubject,
                            'custrecord_dm_email_received': new Date()
                        }
                    });

                    results.push({ success: true, documentId: result.data.documentId });
                } else {
                    results.push({ success: false, error: result.error.message });
                }
            } catch (e) {
                results.push({ success: false, error: e.message });
            }
        });

        return Response.success({
            importedCount: results.filter(r => r.success).length,
            failedCount: results.filter(r => !r.success).length,
            results: results
        });
    }

    function checkEmailInbox(context) {
        // Placeholder for external email integration
        // This would be called by an external service/cron
        return Response.success({ message: 'Email check endpoint ready' });
    }

    function submitCorrection(context) {
        const documentId = context.documentId;
        const fieldName = context.fieldName;
        const originalValue = context.originalValue;
        const correctedValue = context.correctedValue;

        if (!documentId || !fieldName) {
            return Response.error('MISSING_PARAM', 'Document ID and field name required');
        }

        try {
            // Load existing corrections from document
            const docRecord = record.load({
                type: 'customrecord_dm_captured_document',
                id: documentId
            });

            const existingCorrections = JSON.parse(docRecord.getValue('custrecord_dm_user_corrections') || '[]');

            // Add new correction
            const correction = {
                field: fieldName,
                original: String(originalValue),
                corrected: String(correctedValue),
                date: new Date().toISOString(),
                user: runtime.getCurrentUser().id
            };

            // Check if correction for this field already exists
            const existingIndex = existingCorrections.findIndex(c => c.field === fieldName);
            if (existingIndex >= 0) {
                existingCorrections[existingIndex] = correction;
            } else {
                existingCorrections.push(correction);
            }

            // Save corrections back to document
            record.submitFields({
                type: 'customrecord_dm_captured_document',
                id: documentId,
                values: {
                    'custrecord_dm_user_corrections': JSON.stringify(existingCorrections),
                    'custrecord_dm_modified_date': new Date()
                }
            });

            return Response.success({ documentId: documentId, corrections: existingCorrections }, 'Correction recorded');
        } catch (e) {
            return Response.error('CORRECTION_FAILED', e.message);
        }
    }

    // ==================== PUT Implementations ====================

    function updateDocument(context) {
        const documentId = context.documentId;
        const updates = context.updates;

        if (!documentId || !updates) {
            return Response.error('MISSING_PARAM', 'Document ID and updates required');
        }

        try {
            const fieldMap = {
                'vendor': 'custrecord_dm_vendor',
                'invoiceNumber': 'custrecord_dm_invoice_number',
                'invoiceDate': 'custrecord_dm_invoice_date',
                'dueDate': 'custrecord_dm_due_date',
                'subtotal': 'custrecord_dm_subtotal',
                'taxAmount': 'custrecord_dm_tax_amount',
                'totalAmount': 'custrecord_dm_total_amount',
                'currency': 'custrecord_dm_currency',
                'poNumber': 'custrecord_dm_po_number',
                'documentType': 'custrecord_dm_document_type',
                'lineItems': 'custrecord_dm_line_items'
            };

            const values = { 'custrecord_dm_modified_date': new Date() };

            Object.keys(updates).forEach(key => {
                if (fieldMap[key]) {
                    let value = updates[key];
                    if (key === 'lineItems' && typeof value === 'object') {
                        value = JSON.stringify(value);
                    }
                    values[fieldMap[key]] = value;
                }
            });

            record.submitFields({
                type: 'customrecord_dm_captured_document',
                id: documentId,
                values: values
            });

            return Response.success({ documentId: documentId }, 'Document updated');
        } catch (e) {
            return Response.error('UPDATE_FAILED', e.message);
        }
    }

    function approveDocument(context) {
        const documentId = context.documentId;
        const createTransaction = context.createTransaction !== false;
        const transactionType = context.transactionType;

        if (!documentId) {
            return Response.error('MISSING_PARAM', 'Document ID required');
        }

        try {
            const docRecord = record.load({
                type: 'customrecord_dm_captured_document',
                id: documentId
            });

            const vendorId = docRecord.getValue('custrecord_dm_vendor');
            const documentType = docRecord.getValue('custrecord_dm_document_type');
            const lineItems = JSON.parse(docRecord.getValue('custrecord_dm_line_items') || '[]');
            const fileId = docRecord.getValue('custrecord_dm_source_file');

            let transactionId = null;
            let actualTransactionType = transactionType;

            if (createTransaction && vendorId) {
                // Determine transaction type
                if (!actualTransactionType) {
                    actualTransactionType = documentType === 'EXPENSE_REPORT' ? 'expensereport' :
                                          documentType === 'CREDIT_MEMO' ? 'vendorcredit' : 'vendorbill';
                }

                transactionId = createTransactionFromDocument(docRecord, actualTransactionType);
            }

            // Update document status
            record.submitFields({
                type: 'customrecord_dm_captured_document',
                id: documentId,
                values: {
                    'custrecord_dm_status': DocStatus.COMPLETED,
                    'custrecord_dm_created_transaction': transactionId ? String(transactionId) : '',
                    'custrecord_dm_modified_date': new Date()
                }
            });

            // Update batch progress
            const batchId = docRecord.getValue('custrecord_dm_batch_id');
            if (batchId) {
                updateBatchProgress(batchId);
            }

            return Response.success({
                documentId: documentId,
                transactionId: transactionId,
                transactionType: actualTransactionType,
                status: DocStatus.COMPLETED
            }, 'Document approved');
        } catch (e) {
            log.error('Approve error', e);
            return Response.error('APPROVE_FAILED', e.message);
        }
    }

    function rejectDocument(context) {
        const documentId = context.documentId;
        const reason = context.reason || 'Rejected by user';

        if (!documentId) {
            return Response.error('MISSING_PARAM', 'Document ID required');
        }

        try {
            const docRecord = record.load({
                type: 'customrecord_dm_captured_document',
                id: documentId
            });

            const batchId = docRecord.getValue('custrecord_dm_batch_id');

            record.submitFields({
                type: 'customrecord_dm_captured_document',
                id: documentId,
                values: {
                    'custrecord_dm_status': DocStatus.REJECTED,
                    'custrecord_dm_rejection_reason': reason,
                    'custrecord_dm_modified_date': new Date()
                }
            });

            if (batchId) {
                updateBatchProgress(batchId);
            }

            return Response.success({
                documentId: documentId,
                status: DocStatus.REJECTED,
                reason: reason
            }, 'Document rejected');
        } catch (e) {
            return Response.error('REJECT_FAILED', e.message);
        }
    }

    function updateStatus(context) {
        const documentId = context.documentId;
        const status = context.status;

        if (!documentId || !status) {
            return Response.error('MISSING_PARAM', 'Document ID and status required');
        }

        record.submitFields({
            type: 'customrecord_dm_captured_document',
            id: documentId,
            values: {
                'custrecord_dm_status': status,
                'custrecord_dm_modified_date': new Date()
            }
        });

        return Response.success({ documentId: documentId, status: status });
    }

    function assignDocument(context) {
        const documentId = context.documentId;
        const assigneeId = context.assigneeId;

        if (!documentId) {
            return Response.error('MISSING_PARAM', 'Document ID required');
        }

        record.submitFields({
            type: 'customrecord_dm_captured_document',
            id: documentId,
            values: { 'custrecord_dm_uploaded_by': assigneeId }
        });

        return Response.success({ documentId: documentId, assigneeId: assigneeId });
    }

    function updateSettings(context) {
        // Settings would be stored in a custom record if needed
        return Response.success({ message: 'Settings endpoint ready' });
    }

    // ==================== DELETE Implementations ====================

    function deleteDocument(documentId) {
        if (!documentId) {
            return Response.error('MISSING_PARAM', 'Document ID required');
        }

        try {
            const docRecord = record.load({
                type: 'customrecord_dm_captured_document',
                id: documentId
            });

            const fileId = docRecord.getValue('custrecord_dm_source_file');
            const batchId = docRecord.getValue('custrecord_dm_batch_id');

            record.delete({ type: 'customrecord_dm_captured_document', id: documentId });

            if (fileId) {
                try {
                    file.delete({ id: fileId });
                } catch (e) {
                    log.debug('File delete skipped', e.message);
                }
            }

            if (batchId) {
                updateBatchProgress(batchId);
            }

            return Response.success({ documentId: documentId }, 'Document deleted');
        } catch (e) {
            return Response.error('DELETE_FAILED', e.message);
        }
    }

    function deleteBatch(batchId) {
        if (!batchId) {
            return Response.error('MISSING_PARAM', 'Batch ID required');
        }

        try {
            // Delete all documents in batch
            const docSearch = search.create({
                type: 'customrecord_dm_captured_document',
                filters: [['custrecord_dm_batch_id', 'is', batchId]],
                columns: ['internalid', 'custrecord_dm_source_file']
            });

            let deletedDocs = 0;

            docSearch.run().each(result => {
                const fileId = result.getValue('custrecord_dm_source_file');

                record.delete({ type: 'customrecord_dm_captured_document', id: result.id });
                deletedDocs++;

                if (fileId) {
                    try { file.delete({ id: fileId }); } catch (e) { }
                }

                return true;
            });

            record.delete({ type: 'customrecord_dm_batch', id: batchId });

            return Response.success({
                batchId: batchId,
                deletedDocuments: deletedDocs
            }, 'Batch deleted');
        } catch (e) {
            return Response.error('BATCH_DELETE_FAILED', e.message);
        }
    }

    function clearCompleted(context) {
        const olderThanDays = parseInt(context.olderThanDays) || 30;

        try {
            const docSearch = search.create({
                type: 'customrecord_dm_captured_document',
                filters: [
                    ['custrecord_dm_status', 'anyof', [DocStatus.REJECTED, DocStatus.COMPLETED]],
                    'AND',
                    ['custrecord_dm_modified_date', 'before', `daysago${olderThanDays}`]
                ],
                columns: ['internalid']
            });

            let deletedCount = 0;

            docSearch.run().each(result => {
                record.delete({ type: 'customrecord_dm_captured_document', id: result.id });
                deletedCount++;
                return true;
            });

            return Response.success({
                deletedDocuments: deletedCount,
                olderThanDays: olderThanDays
            }, 'Completed documents cleared');
        } catch (e) {
            return Response.error('CLEAR_FAILED', e.message);
        }
    }

    // ==================== Helper Functions ====================

    function getUploadFolder() {
        const folderSearch = search.create({
            type: 'folder',
            filters: [['name', 'is', 'Flux Capture Uploads']],
            columns: ['internalid']
        });

        const results = folderSearch.run().getRange({ start: 0, end: 1 });

        if (results.length > 0) {
            return results[0].id;
        }

        const folderRecord = record.create({ type: 'folder' });
        folderRecord.setValue('name', 'Flux Capture Uploads');
        folderRecord.setValue('description', 'Documents uploaded via Flux Capture');
        return folderRecord.save();
    }

    function getFileType(extension) {
        const typeMap = {
            'pdf': file.Type.PDF,
            'png': file.Type.PNGIMAGE,
            'jpg': file.Type.JPGIMAGE,
            'jpeg': file.Type.JPGIMAGE,
            'tiff': file.Type.TIFFIMAGE,
            'tif': file.Type.TIFFIMAGE,
            'gif': file.Type.GIFIMAGE,
            'bmp': file.Type.BMPIMAGE
        };
        return typeMap[extension.toLowerCase()] || file.Type.PDF;
    }

    function generateDocumentId() {
        const timestamp = Date.now().toString(36);
        const random = Math.random().toString(36).substring(2, 8);
        return `FC-${timestamp}-${random}`.toUpperCase();
    }

    function updateBatchProgress(batchId) {
        const sql = `
            SELECT COUNT(*) as total,
                SUM(CASE WHEN custrecord_dm_status IN ('${DocStatus.REJECTED}', '${DocStatus.COMPLETED}') THEN 1 ELSE 0 END) as processed,
                SUM(CASE WHEN custrecord_dm_status = '${DocStatus.ERROR}' THEN 1 ELSE 0 END) as errors
            FROM customrecord_dm_captured_document
            WHERE custrecord_dm_batch_id = ?
        `;

        const results = query.runSuiteQL({ query: sql, params: [batchId] });
        const total = results.results[0].values[0] || 0;
        const processed = results.results[0].values[1] || 0;
        const errors = results.results[0].values[2] || 0;

        const updates = {
            'custrecord_dm_batch_processed_count': processed,
            'custrecord_dm_batch_error_count': errors
        };

        if (processed >= total && total > 0) {
            updates['custrecord_dm_batch_status'] = BatchStatus.COMPLETED;
            updates['custrecord_dm_batch_completed_date'] = new Date();
        }

        record.submitFields({
            type: 'customrecord_dm_batch',
            id: batchId,
            values: updates
        });
    }

    function createTransactionFromDocument(docRecord, transactionType) {
        const vendorId = docRecord.getValue('custrecord_dm_vendor');
        const invoiceNumber = docRecord.getValue('custrecord_dm_invoice_number');
        const invoiceDate = docRecord.getValue('custrecord_dm_invoice_date');
        const dueDate = docRecord.getValue('custrecord_dm_due_date');
        const totalAmount = docRecord.getValue('custrecord_dm_total_amount');
        const currency = docRecord.getValue('custrecord_dm_currency');
        const lineItems = JSON.parse(docRecord.getValue('custrecord_dm_line_items') || '[]');

        let txnRecord;

        switch (transactionType) {
            case 'vendorbill':
                txnRecord = record.create({ type: record.Type.VENDOR_BILL, isDynamic: true });
                txnRecord.setValue('entity', vendorId);
                if (invoiceNumber) txnRecord.setValue('tranid', invoiceNumber);
                if (invoiceDate) txnRecord.setValue('trandate', invoiceDate);
                if (dueDate) txnRecord.setValue('duedate', dueDate);
                if (currency) txnRecord.setValue('currency', currency);

                lineItems.forEach(line => {
                    txnRecord.selectNewLine({ sublistId: 'expense' });
                    if (line.account) txnRecord.setCurrentSublistValue({ sublistId: 'expense', fieldId: 'account', value: line.account });
                    txnRecord.setCurrentSublistValue({ sublistId: 'expense', fieldId: 'amount', value: line.amount || 0 });
                    if (line.description) txnRecord.setCurrentSublistValue({ sublistId: 'expense', fieldId: 'memo', value: line.description });
                    txnRecord.commitLine({ sublistId: 'expense' });
                });

                if (lineItems.length === 0 && totalAmount) {
                    txnRecord.selectNewLine({ sublistId: 'expense' });
                    txnRecord.setCurrentSublistValue({ sublistId: 'expense', fieldId: 'amount', value: totalAmount });
                    txnRecord.setCurrentSublistValue({ sublistId: 'expense', fieldId: 'memo', value: 'Flux Capture Import' });
                    txnRecord.commitLine({ sublistId: 'expense' });
                }
                break;

            case 'vendorcredit':
                txnRecord = record.create({ type: record.Type.VENDOR_CREDIT, isDynamic: true });
                txnRecord.setValue('entity', vendorId);
                if (invoiceDate) txnRecord.setValue('trandate', invoiceDate);
                if (currency) txnRecord.setValue('currency', currency);

                lineItems.forEach(line => {
                    txnRecord.selectNewLine({ sublistId: 'expense' });
                    if (line.account) txnRecord.setCurrentSublistValue({ sublistId: 'expense', fieldId: 'account', value: line.account });
                    txnRecord.setCurrentSublistValue({ sublistId: 'expense', fieldId: 'amount', value: line.amount || 0 });
                    txnRecord.commitLine({ sublistId: 'expense' });
                });
                break;

            case 'expensereport':
                txnRecord = record.create({ type: record.Type.EXPENSE_REPORT, isDynamic: true });
                txnRecord.setValue('entity', runtime.getCurrentUser().id);
                if (invoiceDate) txnRecord.setValue('trandate', invoiceDate);

                lineItems.forEach(line => {
                    txnRecord.selectNewLine({ sublistId: 'expense' });
                    if (invoiceDate) txnRecord.setCurrentSublistValue({ sublistId: 'expense', fieldId: 'expensedate', value: invoiceDate });
                    if (line.category) txnRecord.setCurrentSublistValue({ sublistId: 'expense', fieldId: 'category', value: line.category });
                    txnRecord.setCurrentSublistValue({ sublistId: 'expense', fieldId: 'amount', value: line.amount || 0 });
                    txnRecord.commitLine({ sublistId: 'expense' });
                });
                break;
        }

        return txnRecord ? txnRecord.save() : null;
    }

    // Display text helper functions
    function getStatusDisplayText(status) {
        const map = {
            [DocStatus.PENDING]: 'Pending',
            [DocStatus.PROCESSING]: 'Processing',
            [DocStatus.EXTRACTED]: 'Extracted',
            [DocStatus.NEEDS_REVIEW]: 'Needs Review',
            [DocStatus.APPROVED]: 'Approved',
            [DocStatus.REJECTED]: 'Rejected',
            [DocStatus.COMPLETED]: 'Completed',
            [DocStatus.ERROR]: 'Error'
        };
        return map[status] || status;
    }

    function getBatchStatusDisplayText(status) {
        const map = {
            [BatchStatus.PENDING]: 'Pending',
            [BatchStatus.PROCESSING]: 'Processing',
            [BatchStatus.COMPLETED]: 'Completed',
            [BatchStatus.PARTIAL_ERROR]: 'Partial Error',
            [BatchStatus.FAILED]: 'Failed',
            [BatchStatus.CANCELLED]: 'Cancelled'
        };
        return map[status] || status;
    }

    function getSourceDisplayText(source) {
        const map = {
            [Source.UPLOAD]: 'Manual Upload',
            [Source.EMAIL]: 'Email Import',
            [Source.DRAG_DROP]: 'Drag and Drop',
            [Source.API]: 'API Integration',
            [Source.SCANNER]: 'Scanner',
            [Source.MOBILE]: 'Mobile App'
        };
        return map[source] || source;
    }

    function getDocTypeDisplayText(docType) {
        const map = {
            'INVOICE': 'Invoice',
            'RECEIPT': 'Receipt',
            'CREDIT_MEMO': 'Credit Memo',
            'EXPENSE_REPORT': 'Expense Report',
            'UNKNOWN': 'Unknown'
        };
        return map[docType] || docType;
    }

    return {
        get: get,
        post: post,
        put: put,
        delete: _delete
    };
});
