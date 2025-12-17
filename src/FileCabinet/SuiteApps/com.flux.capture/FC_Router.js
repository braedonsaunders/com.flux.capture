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
                case 'getView':
                    return getViewContent(context);
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

        const document = {
            id: documentId,
            name: docRecord.getValue('name'),
            status: docRecord.getValue('custrecord_dm_status'),
            statusText: docRecord.getText('custrecord_dm_status'),
            documentType: docRecord.getValue('custrecord_dm_document_type'),
            documentTypeText: docRecord.getText('custrecord_dm_document_type'),
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
            sourceText: docRecord.getText('custrecord_dm_source'),
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
            WHERE custrecord_dm_status IN (1, 2, 3, 4)
            ORDER BY
                CASE custrecord_dm_status
                    WHEN 4 THEN 1 WHEN 3 THEN 2 WHEN 2 THEN 3 WHEN 1 THEN 4
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
            WHERE custrecord_dm_status IN (1, 2, 3, 4)
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
                SUM(CASE WHEN custrecord_dm_status = 6 THEN 1 ELSE 0 END) as completed,
                SUM(CASE WHEN custrecord_dm_status = 6 AND custrecord_dm_confidence_score >= 85 THEN 1 ELSE 0 END) as autoProcessed,
                SUM(CASE WHEN custrecord_dm_status IN (1, 2, 3, 4) THEN 1 ELSE 0 END) as pending,
                SUM(CASE WHEN custrecord_dm_status = 5 THEN 1 ELSE 0 END) as rejected,
                SUM(CASE WHEN custrecord_dm_status = 7 THEN 1 ELSE 0 END) as errors,
                AVG(custrecord_dm_confidence_score) as avgConfidence,
                SUM(custrecord_dm_total_amount) as totalValue
            FROM customrecord_dm_captured_document
            WHERE custrecord_dm_created_date >= ADD_MONTHS(SYSDATE, -1)
        `;

        const statsResult = query.runSuiteQL({ query: statsSql });
        const stats = statsResult.results[0].values;

        // Get document type breakdown
        const typeSql = `
            SELECT BUILTIN.DF(custrecord_dm_document_type) as docType, COUNT(*) as count
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
            AND custrecord_dm_status NOT IN (5, 6)
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

        const batch = {
            id: batchId,
            name: batchRecord.getValue('name'),
            status: batchRecord.getValue('custrecord_dm_batch_status'),
            statusText: batchRecord.getText('custrecord_dm_batch_status'),
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
                SUM(CASE WHEN custrecord_dm_status = 6 THEN 1 ELSE 0 END) as completed,
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

    /**
     * Get View Content for SPA Navigation
     * Returns HTML content for the requested view
     */
    function getViewContent(context) {
        const view = context.view || 'dashboard';
        const docId = context.docId;
        const page = parseInt(context.page) || 1;
        const status = context.status || '';

        let html = '';
        let data = {};

        try {
            switch (view) {
                case 'dashboard':
                    data = {
                        stats: getDashboardStatsData(),
                        recentDocs: getRecentDocumentsData(8),
                        anomalies: getAnomaliesData(5)
                    };
                    html = renderDashboardHTML(data);
                    break;

                case 'upload':
                    html = renderUploadHTML();
                    break;

                case 'queue':
                    data = {
                        queue: getQueueData(page, 25, status),
                        page: page,
                        statusFilter: status
                    };
                    html = renderQueueHTML(data);
                    break;

                case 'review':
                    if (docId) {
                        data = { document: getDocumentData(docId) };
                    }
                    html = renderReviewHTML(data, docId);
                    break;

                case 'batch':
                    data = { batches: getBatchesData(10) };
                    html = renderBatchHTML(data);
                    break;

                case 'settings':
                    html = renderSettingsHTML();
                    break;

                default:
                    html = '<div class="empty-state"><p>View not found</p></div>';
            }

            return Response.success({ html: html, view: view });
        } catch (e) {
            log.error('getViewContent', e);
            return Response.error('VIEW_ERROR', e.message);
        }
    }

    // View Data Functions
    function getDashboardStatsData() {
        try {
            const sql = 'SELECT COUNT(*) as total, ' +
                'SUM(CASE WHEN custrecord_dm_status IN (1,2,3,4) THEN 1 ELSE 0 END) as pending, ' +
                'SUM(CASE WHEN custrecord_dm_status = 6 THEN 1 ELSE 0 END) as completed, ' +
                'SUM(CASE WHEN custrecord_dm_status = 6 AND custrecord_dm_confidence_score >= 85 THEN 1 ELSE 0 END) as autoProcessed, ' +
                'SUM(custrecord_dm_total_amount) as totalValue ' +
                'FROM customrecord_dm_captured_document ' +
                'WHERE custrecord_dm_created_date >= ADD_MONTHS(SYSDATE, -1)';
            const result = query.runSuiteQL({ query: sql });
            const row = result.results && result.results[0] ? result.results[0] : null;
            const vals = row && row.values ? row.values : [0, 0, 0, 0, 0];
            return {
                total: vals[0] || 0,
                pending: vals[1] || 0,
                completed: vals[2] || 0,
                autoProcessed: vals[3] || 0,
                totalValue: vals[4] || 0,
                autoRate: vals[0] > 0 ? Math.round((vals[3] / vals[0]) * 100) : 0
            };
        } catch (e) { log.error('getDashboardStatsData', e); return { total: 0, pending: 0, completed: 0, autoProcessed: 0, totalValue: 0, autoRate: 0 }; }
    }

    function getRecentDocumentsData(limit) {
        try {
            const sql = 'SELECT id, name, custrecord_dm_status, BUILTIN.DF(custrecord_dm_status) as statusText, ' +
                'BUILTIN.DF(custrecord_dm_vendor) as vendorName, custrecord_dm_invoice_number, ' +
                'custrecord_dm_total_amount, TO_CHAR(custrecord_dm_created_date, \'Mon DD\') as createdDate ' +
                'FROM customrecord_dm_captured_document ' +
                'ORDER BY custrecord_dm_created_date DESC ' +
                'FETCH FIRST ' + limit + ' ROWS ONLY';
            const result = query.runSuiteQL({ query: sql });
            return result.results.map(function(r) {
                return {
                    id: r.values[0], name: r.values[1], status: r.values[2], statusText: r.values[3],
                    vendorName: r.values[4], invoiceNumber: r.values[5], amount: r.values[6] || 0, date: r.values[7]
                };
            });
        } catch (e) { log.error('getRecentDocumentsData', e); return []; }
    }

    function getAnomaliesData(limit) {
        try {
            const sql = 'SELECT id, custrecord_dm_anomalies, BUILTIN.DF(custrecord_dm_vendor) as vendorName ' +
                'FROM customrecord_dm_captured_document ' +
                'WHERE custrecord_dm_anomalies IS NOT NULL AND custrecord_dm_anomalies != \'[]\' ' +
                'AND custrecord_dm_status NOT IN (5, 6) ' +
                'ORDER BY custrecord_dm_created_date DESC ' +
                'FETCH FIRST ' + (limit * 2) + ' ROWS ONLY';
            const result = query.runSuiteQL({ query: sql });
            const anomalies = [];
            result.results.forEach(function(r) {
                try {
                    const docAnomalies = JSON.parse(r.values[1] || '[]');
                    docAnomalies.forEach(function(a) {
                        anomalies.push({
                            documentId: r.values[0],
                            vendorName: r.values[2],
                            type: a.type || '',
                            message: a.message || '',
                            severity: a.severity || ''
                        });
                    });
                } catch (parseErr) { /* skip invalid JSON */ }
            });
            return anomalies.slice(0, limit);
        } catch (e) { log.error('getAnomaliesData', e); return []; }
    }

    function getQueueData(page, pageSize, statusFilter) {
        try {
            var sql = 'SELECT id, name, custrecord_dm_status, BUILTIN.DF(custrecord_dm_status) as statusText, ' +
                'BUILTIN.DF(custrecord_dm_vendor) as vendorName, custrecord_dm_invoice_number, ' +
                'custrecord_dm_total_amount, custrecord_dm_confidence_score, custrecord_dm_anomalies, ' +
                'TO_CHAR(custrecord_dm_created_date, \'Mon DD HH24:MI\') as createdDate ' +
                'FROM customrecord_dm_captured_document WHERE 1=1';
            var statusMap = { 'pending': '1', 'processing': '2', 'review': '4', 'completed': '6' };
            if (statusFilter && statusMap[statusFilter]) sql += ' AND custrecord_dm_status = ' + statusMap[statusFilter];
            sql += ' ORDER BY custrecord_dm_created_date DESC OFFSET ' + ((page - 1) * pageSize) + ' ROWS FETCH NEXT ' + pageSize + ' ROWS ONLY';

            const result = query.runSuiteQL({ query: sql });
            const countResult = query.runSuiteQL({ query: 'SELECT COUNT(*) FROM customrecord_dm_captured_document WHERE 1=1' });
            const countRow = countResult.results && countResult.results[0] ? countResult.results[0] : null;
            const total = countRow && countRow.values ? (countRow.values[0] || 0) : 0;

            return {
                documents: result.results.map(function(r) {
                    return {
                        id: r.values[0], name: r.values[1], status: r.values[2], statusText: r.values[3],
                        vendorName: r.values[4], invoiceNumber: r.values[5], amount: r.values[6] || 0,
                        confidence: r.values[7] || 0, hasAnomalies: r.values[8] && r.values[8] !== '[]', date: r.values[9]
                    };
                }),
                total: total, totalPages: Math.ceil(total / pageSize)
            };
        } catch (e) { log.error('getQueueData', e); return { documents: [], total: 0, totalPages: 0 }; }
    }

    function getDocumentData(docId) {
        try {
            const docRecord = record.load({ type: 'customrecord_dm_captured_document', id: docId });
            const fileId = docRecord.getValue('custrecord_dm_source_file');
            let fileUrl = '';
            if (fileId) { try { fileUrl = file.load({ id: fileId }).url; } catch (e) {} }

            const vendorId = docRecord.getValue('custrecord_dm_vendor');
            const vendorSuggestions = [];
            if (vendorId) {
                try {
                    const vendor = search.lookupFields({ type: 'vendor', id: vendorId, columns: ['companyname'] });
                    vendorSuggestions.push({ id: vendorId, name: vendor.companyname });
                } catch (e) {}
            }

            const confidence = docRecord.getValue('custrecord_dm_confidence_score') || 0;
            return {
                id: docId, name: docRecord.getValue('name'), status: docRecord.getValue('custrecord_dm_status'),
                vendorId: vendorId, vendorName: docRecord.getText('custrecord_dm_vendor'), vendorSuggestions: vendorSuggestions,
                invoiceNumber: docRecord.getValue('custrecord_dm_invoice_number'),
                invoiceDate: docRecord.getValue('custrecord_dm_invoice_date'),
                dueDate: docRecord.getValue('custrecord_dm_due_date'),
                poNumber: docRecord.getValue('custrecord_dm_po_number'),
                subtotal: docRecord.getValue('custrecord_dm_subtotal') || 0,
                taxAmount: docRecord.getValue('custrecord_dm_tax_amount') || 0,
                totalAmount: docRecord.getValue('custrecord_dm_total_amount') || 0,
                currency: docRecord.getValue('custrecord_dm_currency'),
                confidence: confidence,
                confidenceLevel: confidence >= 85 ? 'HIGH' : confidence >= 60 ? 'MEDIUM' : 'LOW',
                lineItems: JSON.parse(docRecord.getValue('custrecord_dm_line_items') || '[]'),
                anomalies: JSON.parse(docRecord.getValue('custrecord_dm_anomalies') || '[]'),
                fileId: fileId, fileUrl: fileUrl
            };
        } catch (e) { return null; }
    }

    function getBatchesData(limit) {
        try {
            var sql = 'SELECT id, name, custrecord_dm_batch_status, BUILTIN.DF(custrecord_dm_batch_status) as statusText, ' +
                'custrecord_dm_batch_document_count, custrecord_dm_batch_processed_count, ' +
                'TO_CHAR(custrecord_dm_batch_created_date, \'Mon DD\') as createdDate ' +
                'FROM customrecord_dm_batch ORDER BY custrecord_dm_batch_created_date DESC ' +
                'FETCH FIRST ' + limit + ' ROWS ONLY';
            var result = query.runSuiteQL({ query: sql });
            return result.results.map(function(r) {
                return {
                    id: r.values[0], name: r.values[1], status: r.values[2], statusText: r.values[3],
                    total: r.values[4] || 0, processed: r.values[5] || 0,
                    progress: r.values[4] > 0 ? Math.round((r.values[5] / r.values[4]) * 100) : 0, date: r.values[6]
                };
            });
        } catch (e) { log.error('getBatchesData', e); return []; }
    }

    // Helper functions for view rendering
    function escapeHtml(str) {
        if (!str) return '';
        return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#039;');
    }

    function formatNum(num) {
        return (num || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    }

    function formatDateIn(date) {
        if (!date) return '';
        return new Date(date).toISOString().split('T')[0];
    }

    function getStatClass(status) {
        const c = { 1: 'pending', 2: 'processing', 3: 'extracted', 4: 'review', 5: 'rejected', 6: 'completed', 7: 'error' };
        return c[status] || 'pending';
    }

    function getConfClass(conf) {
        return conf >= 85 ? 'high' : conf >= 60 ? 'medium' : 'low';
    }

    // HTML Render Functions
    function renderDashboardHTML(data) {
        const stats = data.stats || {};
        const docs = data.recentDocs || [];
        const anomalies = data.anomalies || [];

        return `
            <header class="page-header">
                <div class="page-header-content">
                    <h1><i class="fas fa-th-large"></i> Dashboard</h1>
                    <p class="page-header-subtitle">AI-Powered Document Intelligence</p>
                </div>
                <div class="page-header-actions">
                    <button class="action-btn primary" onclick="FluxApp.navigate('upload')"><i class="fas fa-cloud-upload-alt"></i> Upload Documents</button>
                </div>
            </header>
            <div class="page-body">
                <div class="quick-actions">
                    <button class="action-btn primary" onclick="FluxApp.navigate('upload')"><i class="fas fa-cloud-upload-alt"></i> Upload Documents</button>
                    <button class="action-btn" onclick="FluxApp.navigate('queue')"><i class="fas fa-inbox"></i> Processing Queue${stats.pending > 0 ? ' <span class="badge">' + stats.pending + '</span>' : ''}</button>
                </div>
                <div class="stats-grid">
                    <div class="stat-card blue"><div class="stat-header"><div class="stat-icon blue"><i class="fas fa-file-invoice"></i></div></div><div class="stat-content"><span class="stat-value">${stats.total}</span><span class="stat-label">Documents Processed</span></div></div>
                    <div class="stat-card green"><div class="stat-header"><div class="stat-icon green"><i class="fas fa-check-circle"></i></div><span class="stat-trend up"><i class="fas fa-arrow-up"></i> ${stats.autoRate}%</span></div><div class="stat-content"><span class="stat-value">${stats.completed}</span><span class="stat-label">Completed</span></div><div class="stat-footer"><span class="stat-link">${stats.autoRate}% auto-processed</span></div></div>
                    <div class="stat-card orange"><div class="stat-header"><div class="stat-icon orange"><i class="fas fa-clock"></i></div></div><div class="stat-content"><span class="stat-value">${stats.pending}</span><span class="stat-label">Pending Review</span></div><div class="stat-footer"><a href="#" onclick="FluxApp.navigate('queue'); return false;" class="stat-link">Review Now <i class="fas fa-arrow-right"></i></a></div></div>
                    <div class="stat-card purple"><div class="stat-header"><div class="stat-icon purple"><i class="fas fa-dollar-sign"></i></div></div><div class="stat-content"><span class="stat-value">$${formatNum(stats.totalValue)}</span><span class="stat-label">Total Value (30d)</span></div></div>
                </div>
                <div class="content-grid">
                    <div class="card"><div class="card-header"><h3 class="card-title"><i class="fas fa-history"></i> Recent Documents</h3><a href="#" onclick="FluxApp.navigate('queue'); return false;">View All</a></div><div class="card-body">${docs.length > 0 ? '<div class="doc-list">' + docs.map(d => '<div class="doc-item" onclick="FluxApp.reviewDoc(' + d.id + ')"><div class="doc-icon ' + getStatClass(d.status) + '"><i class="fas fa-file-invoice"></i></div><div class="doc-info"><span class="doc-name">' + escapeHtml(d.vendorName || 'Unknown') + '</span><span class="doc-meta">' + escapeHtml(d.invoiceNumber || '-') + ' &bull; ' + escapeHtml(d.date) + '</span></div><div class="doc-amount">$' + formatNum(d.amount) + '</div><span class="status-badge ' + getStatClass(d.status) + '">' + escapeHtml(d.statusText) + '</span></div>').join('') + '</div>' : '<div class="empty-state"><div class="empty-state-icon"><i class="fas fa-inbox"></i></div><h4 class="empty-state-title">No documents yet</h4></div>'}</div></div>
                    <div class="card"><div class="card-header"><h3 class="card-title"><i class="fas fa-exclamation-triangle"></i> Anomaly Alerts</h3><span class="alert-count ${anomalies.length > 0 ? 'has-alerts' : ''}">${anomalies.length}</span></div><div class="card-body">${anomalies.length > 0 ? '<div class="anomaly-list">' + anomalies.map(a => '<div class="anomaly-item ' + (a.severity || '') + '"><i class="fas fa-exclamation-circle"></i><div class="anomaly-info"><span class="anomaly-title">' + escapeHtml(a.message) + '</span><span class="anomaly-meta">' + escapeHtml(a.vendorName || 'Document') + ' &bull; ' + escapeHtml(a.type) + '</span></div><button class="btn-sm" onclick="FluxApp.reviewDoc(' + a.documentId + ')">Review</button></div>').join('') + '</div>' : '<div class="empty-state"><div class="empty-state-icon"><i class="fas fa-shield-alt"></i></div><h4 class="empty-state-title">All Clear</h4></div>'}</div></div>
                </div>
            </div>`;
    }

    function renderUploadHTML() {
        return `<header class="page-header"><div class="page-header-content"><h1><i class="fas fa-cloud-upload-alt"></i> Upload Documents</h1><p class="page-header-subtitle">Drag & drop or click to upload</p></div></header><div class="page-body"><div class="upload-container"><div class="type-selector"><label class="type-option active" data-type="auto"><input type="radio" name="docType" value="auto" checked><i class="fas fa-magic"></i><span>Auto-Detect</span></label><label class="type-option" data-type="INVOICE"><input type="radio" name="docType" value="INVOICE"><i class="fas fa-file-invoice-dollar"></i><span>Invoice</span></label><label class="type-option" data-type="RECEIPT"><input type="radio" name="docType" value="RECEIPT"><i class="fas fa-receipt"></i><span>Receipt</span></label><label class="type-option" data-type="EXPENSE_REPORT"><input type="radio" name="docType" value="EXPENSE_REPORT"><i class="fas fa-wallet"></i><span>Expense</span></label></div><div class="upload-zone" id="uploadZone"><div class="upload-content"><i class="fas fa-cloud-upload-alt upload-icon"></i><h2>Drag & Drop Documents Here</h2><p>or click to browse</p><div class="supported-formats"><span>Supported:</span><span class="format-badge">PDF</span><span class="format-badge">PNG</span><span class="format-badge">JPG</span><span class="format-badge">TIFF</span></div></div><input type="file" id="fileInput" multiple accept=".pdf,.png,.jpg,.jpeg,.tiff,.tif" hidden></div><div class="upload-queue" id="uploadQueue" hidden><div class="queue-header"><h3><i class="fas fa-list"></i> Upload Queue</h3><button class="btn-text" onclick="FluxApp.clearQueue()">Clear All</button></div><div class="queue-list" id="queueList"></div><div class="queue-actions"><button class="btn" onclick="document.getElementById('fileInput').click()"><i class="fas fa-plus"></i> Add More</button><button class="btn primary" onclick="FluxApp.processQueue()"><i class="fas fa-play"></i> Process All (<span id="fileCount">0</span>)</button></div></div><div class="upload-progress" id="uploadProgress" hidden><div class="progress-content"><div class="spinner"></div><h3 id="progressTitle">Uploading...</h3><p id="progressText">Preparing...</p><div class="progress-bar"><div class="progress-fill" id="progressFill"></div></div></div></div></div></div>`;
    }

    function renderQueueHTML(data) {
        const q = data.queue || { documents: [], total: 0, totalPages: 0 };
        const page = data.page || 1;
        const sf = data.statusFilter || '';

        return `<header class="page-header"><div class="page-header-content"><h1><i class="fas fa-inbox"></i> Processing Queue</h1><p class="page-header-subtitle">${q.total} documents</p></div><div class="page-header-actions"><button class="btn" onclick="FluxApp.navigate('upload')"><i class="fas fa-plus"></i> Upload</button></div></header><div class="page-body"><div class="queue-filters"><div class="filter-tabs"><button class="filter-tab ${!sf ? 'active' : ''}" data-status="" onclick="FluxApp.filterQueue('')">All</button><button class="filter-tab ${sf === 'pending' ? 'active' : ''}" data-status="pending" onclick="FluxApp.filterQueue('pending')">Pending</button><button class="filter-tab ${sf === 'processing' ? 'active' : ''}" data-status="processing" onclick="FluxApp.filterQueue('processing')">Processing</button><button class="filter-tab ${sf === 'review' ? 'active' : ''}" data-status="review" onclick="FluxApp.filterQueue('review')">Needs Review</button><button class="filter-tab ${sf === 'completed' ? 'active' : ''}" data-status="completed" onclick="FluxApp.filterQueue('completed')">Completed</button></div></div><div class="queue-table"><table><thead><tr><th style="width:40px;"><input type="checkbox" id="selectAll" onchange="FluxApp.toggleSelectAll()"></th><th>Document</th><th>Vendor</th><th>Invoice #</th><th>Amount</th><th>Confidence</th><th>Status</th><th>Date</th><th style="width:100px;">Actions</th></tr></thead><tbody>${q.documents.length > 0 ? q.documents.map(d => '<tr class="' + (d.hasAnomalies ? 'has-anomaly' : '') + '"><td><input type="checkbox" class="doc-select" value="' + d.id + '"></td><td class="doc-name-cell">' + escapeHtml(d.name) + '</td><td>' + escapeHtml(d.vendorName || '-') + '</td><td>' + escapeHtml(d.invoiceNumber || '-') + '</td><td><strong>$' + formatNum(d.amount) + '</strong></td><td><div class="confidence-bar ' + getConfClass(d.confidence) + '"><div class="confidence-fill" style="width:' + d.confidence + '%"></div><span>' + d.confidence + '%</span></div></td><td><span class="status-badge ' + getStatClass(d.status) + '">' + escapeHtml(d.statusText) + '</span></td><td>' + escapeHtml(d.date) + '</td><td><button class="btn-icon" onclick="FluxApp.reviewDoc(' + d.id + ')" title="Review"><i class="fas fa-eye"></i></button><button class="btn-icon" onclick="FluxApp.deleteDoc(' + d.id + ')" title="Delete"><i class="fas fa-trash"></i></button></td></tr>').join('') : '<tr><td colspan="9" style="text-align:center;padding:60px;"><div class="empty-state"><div class="empty-state-icon"><i class="fas fa-inbox"></i></div><h4 class="empty-state-title">No documents found</h4></div></td></tr>'}</tbody></table></div>${q.totalPages > 1 ? '<div class="pagination"><button ' + (page <= 1 ? 'disabled' : '') + ' onclick="FluxApp.goToPage(' + (page - 1) + ')"><i class="fas fa-chevron-left"></i></button><span>Page ' + page + ' of ' + q.totalPages + '</span><button ' + (page >= q.totalPages ? 'disabled' : '') + ' onclick="FluxApp.goToPage(' + (page + 1) + ')"><i class="fas fa-chevron-right"></i></button></div>' : ''}</div>`;
    }

    function renderReviewHTML(data, docId) {
        const doc = data.document || {};
        if (!doc.id) return '<div class="page-body"><div class="empty-state"><div class="empty-state-icon"><i class="fas fa-file-alt"></i></div><h4 class="empty-state-title">Document not found</h4><button class="btn primary" onclick="FluxApp.navigate(\'queue\')">Back to Queue</button></div></div>';

        const confLevel = (doc.confidenceLevel || 'low').toLowerCase();
        return `<div class="review-mode"><div class="review-header"><button class="btn-back" onclick="FluxApp.navigate('queue')"><i class="fas fa-arrow-left"></i> Back to Queue</button><div class="review-actions"><button class="btn danger" onclick="FluxApp.rejectDocument(${doc.id})"><i class="fas fa-times"></i> Reject</button><button class="btn success" onclick="FluxApp.approveDocument(${doc.id})"><i class="fas fa-check"></i> Approve & Create</button></div></div><div class="review-container"><div class="document-preview"><div class="preview-toolbar"><button class="tool-btn" onclick="FluxApp.zoomIn()"><i class="fas fa-search-plus"></i></button><button class="tool-btn" onclick="FluxApp.zoomOut()"><i class="fas fa-search-minus"></i></button><button class="tool-btn" onclick="FluxApp.downloadFile(${doc.fileId})"><i class="fas fa-download"></i></button></div><div class="preview-frame">${doc.fileUrl ? '<iframe src="' + doc.fileUrl + '" id="docPreview"></iframe>' : '<p style="padding:40px;text-align:center;color:#666;">No preview</p>'}</div></div><div class="extraction-panel"><div class="confidence-banner ${confLevel}"><div class="confidence-score"><div class="score-circle"><svg viewBox="0 0 36 36"><path class="score-bg" d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831"/><path class="score-fill" stroke-dasharray="${doc.confidence || 0}, 100" d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831"/><text x="18" y="21" class="score-text">${doc.confidence || 0}%</text></svg></div><span class="score-label">${doc.confidenceLevel || 'Low'} Confidence</span></div></div>${(doc.anomalies || []).length > 0 ? '<div class="anomaly-warnings">' + doc.anomalies.map(a => '<div class="warning-item ' + (a.severity || '') + '"><i class="fas fa-exclamation-triangle"></i><span>' + escapeHtml(a.message) + '</span></div>').join('') + '</div>' : ''}<div class="extracted-fields"><h3>Extracted Information</h3><div class="field-group"><label>Vendor</label><select id="vendor" onchange="FluxApp.trackChange('vendor', this.value)"><option value="">-- Select Vendor --</option>${(doc.vendorSuggestions || []).map(v => '<option value="' + v.id + '"' + (v.id == doc.vendorId ? ' selected' : '') + '>' + escapeHtml(v.name) + '</option>').join('')}</select></div><div class="field-row"><div class="field-group"><label>Invoice Number</label><input type="text" id="invoiceNumber" value="${escapeHtml(doc.invoiceNumber || '')}" onchange="FluxApp.trackChange('invoiceNumber', this.value)"></div><div class="field-group"><label>Invoice Date</label><input type="date" id="invoiceDate" value="${formatDateIn(doc.invoiceDate)}" onchange="FluxApp.trackChange('invoiceDate', this.value)"></div></div><div class="field-row"><div class="field-group"><label>Due Date</label><input type="date" id="dueDate" value="${formatDateIn(doc.dueDate)}" onchange="FluxApp.trackChange('dueDate', this.value)"></div><div class="field-group"><label>PO Number</label><input type="text" id="poNumber" value="${escapeHtml(doc.poNumber || '')}" onchange="FluxApp.trackChange('poNumber', this.value)"></div></div></div><div class="amount-fields"><h3>Amounts</h3><div class="amount-grid"><div class="amount-field"><label>Subtotal</label><input type="number" step="0.01" id="subtotal" value="${doc.subtotal || 0}" onchange="FluxApp.trackChange('subtotal', this.value); FluxApp.calculateTotal()"></div><div class="amount-field"><label>Tax</label><input type="number" step="0.01" id="taxAmount" value="${doc.taxAmount || 0}" onchange="FluxApp.trackChange('taxAmount', this.value); FluxApp.calculateTotal()"></div><div class="amount-field total"><label>Total</label><input type="number" step="0.01" id="totalAmount" value="${doc.totalAmount || 0}" onchange="FluxApp.trackChange('totalAmount', this.value)"></div></div></div>${(doc.lineItems || []).length > 0 ? '<div class="line-items"><h3>Line Items (' + doc.lineItems.length + ')</h3><table class="line-items-table"><thead><tr><th>Description</th><th style="width:60px;">Qty</th><th style="width:80px;">Price</th><th style="width:80px;">Amount</th></tr></thead><tbody>' + doc.lineItems.map(item => '<tr><td><input type="text" value="' + escapeHtml(item.description || '') + '"></td><td><input type="number" value="' + (item.quantity || 0) + '"></td><td><input type="number" step="0.01" value="' + (item.unitPrice || 0) + '"></td><td><input type="number" step="0.01" value="' + (item.amount || 0) + '"></td></tr>').join('') + '</tbody></table></div>' : ''}</div></div></div>`;
    }

    function renderBatchHTML(data) {
        const batches = data.batches || [];
        return `<header class="page-header"><div class="page-header-content"><h1><i class="fas fa-layer-group"></i> Batch Processing</h1><p class="page-header-subtitle">Process multiple documents at once</p></div></header><div class="page-body"><div class="batch-upload"><div class="upload-zone" id="batchZone" onclick="document.getElementById('batchInput').click()"><div class="upload-content"><i class="fas fa-layer-group upload-icon"></i><h2>Upload Batch</h2><p>Drop multiple files here</p></div><input type="file" id="batchInput" multiple accept=".pdf,.png,.jpg,.jpeg,.tiff" hidden></div></div><div class="batch-list"><h3>Recent Batches</h3><table><thead><tr><th>Batch Name</th><th>Documents</th><th>Progress</th><th>Status</th><th>Created</th><th style="width:80px;">Actions</th></tr></thead><tbody>${batches.length > 0 ? batches.map(b => '<tr><td><strong>' + escapeHtml(b.name) + '</strong></td><td>' + b.processed + '/' + b.total + '</td><td><div class="progress-bar" style="width:120px;display:inline-block;"><div class="progress-fill" style="width:' + b.progress + '%"></div></div></td><td><span class="status-badge ' + b.status + '">' + escapeHtml(b.statusText) + '</span></td><td>' + escapeHtml(b.date) + '</td><td><button class="btn-icon"><i class="fas fa-eye"></i></button></td></tr>').join('') : '<tr><td colspan="6" style="text-align:center;padding:40px;"><div class="empty-state"><div class="empty-state-icon"><i class="fas fa-layer-group"></i></div><h4 class="empty-state-title">No batches yet</h4></div></td></tr>'}</tbody></table></div></div>`;
    }

    function renderSettingsHTML() {
        return `<header class="page-header"><div class="page-header-content"><h1><i class="fas fa-cog"></i> Settings</h1><p class="page-header-subtitle">Configure Flux Capture</p></div></header><div class="page-body"><div class="settings-grid"><div class="settings-section"><h3><i class="fas fa-robot"></i> Processing</h3><div class="setting-item"><label>Auto-approve Threshold</label><div style="display:flex;align-items:center;gap:12px;"><input type="range" min="70" max="100" value="85" id="autoThreshold" oninput="document.getElementById('thresholdValue').textContent=this.value+'%'"><span id="thresholdValue" style="min-width:45px;">85%</span></div></div><div class="setting-item"><label>Default Document Type</label><select id="defaultType"><option value="auto">Auto-Detect</option><option value="INVOICE">Invoice</option><option value="RECEIPT">Receipt</option></select></div></div><div class="settings-section"><h3><i class="fas fa-envelope"></i> Email Import</h3><div class="setting-item"><label>Enable Email Import</label><label class="toggle-switch"><input type="checkbox" id="emailEnabled" checked><span class="toggle-slider"></span></label></div><div class="setting-item"><label>Import Address</label><input type="text" value="flux@netsuite.com" readonly style="width:250px;"></div></div><div class="settings-section"><h3><i class="fas fa-shield-alt"></i> Fraud Detection</h3><div class="setting-item"><label>Duplicate Detection</label><label class="toggle-switch"><input type="checkbox" id="duplicateDetection" checked><span class="toggle-slider"></span></label></div><div class="setting-item"><label>Amount Validation</label><label class="toggle-switch"><input type="checkbox" id="amountValidation" checked><span class="toggle-slider"></span></label></div></div><div class="settings-section"><h3><i class="fas fa-bell"></i> Notifications</h3><div class="setting-item"><label>Email Notifications</label><label class="toggle-switch"><input type="checkbox" id="emailNotifications" checked><span class="toggle-slider"></span></label></div><div class="setting-item"><label>Anomaly Alerts</label><label class="toggle-switch"><input type="checkbox" id="anomalyAlerts" checked><span class="toggle-slider"></span></label></div></div></div><div class="settings-actions"><button class="btn primary" onclick="alert('Settings saved!')"><i class="fas fa-save"></i> Save Settings</button></div></div>`;
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
        docRecord.setValue('custrecord_dm_status', 1); // Pending
        docRecord.setValue('custrecord_dm_document_type', documentType === 'auto' ? '' : documentType);
        docRecord.setValue('custrecord_dm_source_file', fileId);
        docRecord.setValue('custrecord_dm_source', 1); // Manual Upload
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
            status: 'pending'
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
        batchRecord.setValue('custrecord_dm_batch_status', 1); // Pending
        batchRecord.setValue('custrecord_dm_batch_document_count', files.length);
        batchRecord.setValue('custrecord_dm_batch_processed_count', 0);
        batchRecord.setValue('custrecord_dm_batch_created_date', new Date());
        batchRecord.setValue('custrecord_dm_batch_created_by', runtime.getCurrentUser().id);
        batchRecord.setValue('custrecord_dm_batch_source', 1); // Manual

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
            values: { 'custrecord_dm_batch_status': 2 } // Processing
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
            values: { 'custrecord_dm_status': 2 } // Processing
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
                let newStatus = 4; // Needs Review
                if (extraction.confidence.overall >= 85 && extraction.anomalies.length === 0) {
                    newStatus = 3; // Extracted (ready for approval)
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
                    status: newStatus === 3 ? 'extracted' : 'needs_review',
                    confidence: extraction.confidence.overall,
                    anomalyCount: extraction.anomalies.length,
                    processingTime: processingTime
                }, 'Document processed successfully');
            } else {
                record.submitFields({
                    type: 'customrecord_dm_captured_document',
                    id: documentId,
                    values: {
                        'custrecord_dm_status': 7, // Error
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
                    'custrecord_dm_status': 7, // Error
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
                WHERE custrecord_dm_batch_id = ? AND custrecord_dm_status = 1
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
                'custrecord_dm_status': 1, // Pending
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
                            'custrecord_dm_source': 2, // Email
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
            const learningRecord = record.create({ type: 'customrecord_dm_learning' });
            learningRecord.setValue('name', `Correction-${documentId}-${fieldName}`);
            learningRecord.setValue('custrecord_dm_learn_document', documentId);
            learningRecord.setValue('custrecord_dm_learn_field', fieldName);
            learningRecord.setValue('custrecord_dm_learn_original', String(originalValue));
            learningRecord.setValue('custrecord_dm_learn_corrected', String(correctedValue));
            learningRecord.setValue('custrecord_dm_learn_user', runtime.getCurrentUser().id);
            learningRecord.setValue('custrecord_dm_learn_date', new Date());
            learningRecord.setValue('custrecord_dm_learn_count', 1);

            const correctionId = learningRecord.save();

            return Response.success({ correctionId: correctionId }, 'Correction recorded');
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
                    'custrecord_dm_status': 6, // Completed
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
                status: 'completed'
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
                    'custrecord_dm_status': 5, // Rejected
                    'custrecord_dm_rejection_reason': reason,
                    'custrecord_dm_modified_date': new Date()
                }
            });

            if (batchId) {
                updateBatchProgress(batchId);
            }

            return Response.success({
                documentId: documentId,
                status: 'rejected',
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
                    ['custrecord_dm_status', 'anyof', [5, 6]], // Rejected or Completed
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
                SUM(CASE WHEN custrecord_dm_status IN (5, 6) THEN 1 ELSE 0 END) as processed,
                SUM(CASE WHEN custrecord_dm_status = 7 THEN 1 ELSE 0 END) as errors
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
            updates['custrecord_dm_batch_status'] = 3; // Completed
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

    return {
        get: get,
        post: post,
        put: put,
        delete: _delete
    };
});
