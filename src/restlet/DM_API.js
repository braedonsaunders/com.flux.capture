/**
 * @NApiVersion 2.1
 * @NScriptType Restlet
 * @NModuleScope SameAccount
 * 
 * DocuMind - Intelligent Document Capture API
 * RESTful API for document upload, processing, and management
 * 
 * Endpoints:
 * GET    - Retrieve document(s), stats, queue status
 * POST   - Upload and process documents
 * PUT    - Update document data, approve/reject
 * DELETE - Remove documents from queue
 */

define([
    'N/file',
    'N/record',
    'N/search',
    'N/query',
    'N/task',
    'N/runtime',
    'N/error',
    'N/log',
    'N/encode',
    './library/DM_DocumentIntelligenceEngine'
], function(file, record, search, query, task, runtime, error, log, encode, Engine) {

    const API_VERSION = '1.0.0';
    
    // Response builder for consistent API responses
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

    /**
     * GET Handler - Retrieve documents and statistics
     * 
     * Actions:
     * - document: Get single document by ID
     * - list: Get paginated document list
     * - queue: Get processing queue
     * - stats: Get dashboard statistics
     * - anomalies: Get recent anomalies
     * - vendors: Search vendors for matching
     * - purchaseorders: Search POs for matching
     */
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
                    
                default:
                    return Response.error('INVALID_ACTION', `Unknown action: ${action}`);
            }
        } catch (e) {
            log.error('GET Error', e);
            return Response.error('GET_FAILED', e.message);
        }
    }

    /**
     * POST Handler - Upload and process documents
     * 
     * Actions:
     * - upload: Upload single document
     * - batch: Upload multiple documents
     * - process: Process uploaded document
     * - reprocess: Re-extract document data
     * - email-import: Import from email
     */
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
                    
                case 'reprocess':
                    return reprocessDocument(context.documentId);
                    
                case 'email-import':
                    return importFromEmail(context);
                    
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

    /**
     * PUT Handler - Update documents
     * 
     * Actions:
     * - update: Update extraction data
     * - approve: Approve and create transaction
     * - reject: Reject document
     * - status: Update status
     * - assign: Assign to user for review
     */
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

    /**
     * DELETE Handler - Remove documents
     * 
     * Actions:
     * - document: Delete single document
     * - batch: Delete entire batch
     * - clear: Clear completed documents
     */
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
        
        const extractedData = JSON.parse(docRecord.getValue('custrecord_dm_extracted_data') || '{}');
        const anomalies = JSON.parse(docRecord.getValue('custrecord_dm_anomalies') || '[]');
        const lineItems = JSON.parse(docRecord.getValue('custrecord_dm_line_items') || '[]');
        
        const document = {
            id: documentId,
            name: docRecord.getValue('name'),
            status: docRecord.getValue('custrecord_dm_status'),
            documentType: docRecord.getValue('custrecord_dm_document_type'),
            fileId: docRecord.getValue('custrecord_dm_file_id'),
            fileName: docRecord.getValue('custrecord_dm_file_name'),
            fileSize: docRecord.getValue('custrecord_dm_file_size'),
            mimeType: docRecord.getValue('custrecord_dm_mime_type'),
            batchId: docRecord.getValue('custrecord_dm_batch'),
            uploadedBy: docRecord.getValue('custrecord_dm_uploaded_by'),
            uploadedDate: docRecord.getValue('custrecord_dm_uploaded_date'),
            processedDate: docRecord.getValue('custrecord_dm_processed_date'),
            confidence: docRecord.getValue('custrecord_dm_confidence'),
            extractedData: extractedData,
            lineItems: lineItems,
            anomalies: anomalies,
            vendorId: docRecord.getValue('custrecord_dm_vendor'),
            vendorName: docRecord.getText('custrecord_dm_vendor'),
            createdTransactionId: docRecord.getValue('custrecord_dm_created_transaction'),
            createdTransactionType: docRecord.getValue('custrecord_dm_transaction_type'),
            reviewedBy: docRecord.getValue('custrecord_dm_reviewed_by'),
            reviewedDate: docRecord.getValue('custrecord_dm_reviewed_date'),
            notes: docRecord.getValue('custrecord_dm_notes')
        };
        
        // Get file URL for preview
        if (document.fileId) {
            const fileObj = file.load({ id: document.fileId });
            document.fileUrl = fileObj.url;
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
        
        // Build SuiteQL query
        let sql = `
            SELECT 
                id,
                name,
                custrecord_dm_status as status,
                custrecord_dm_document_type as documentType,
                custrecord_dm_file_name as fileName,
                custrecord_dm_confidence as confidence,
                custrecord_dm_vendor as vendorId,
                BUILTIN.DF(custrecord_dm_vendor) as vendorName,
                custrecord_dm_extracted_data as extractedData,
                custrecord_dm_anomalies as anomalies,
                custrecord_dm_uploaded_date as uploadedDate,
                custrecord_dm_processed_date as processedDate,
                custrecord_dm_uploaded_by as uploadedBy,
                BUILTIN.DF(custrecord_dm_uploaded_by) as uploadedByName
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
            sql += ` AND custrecord_dm_batch = ?`;
            params.push(batchId);
        }
        
        if (dateFrom) {
            sql += ` AND custrecord_dm_uploaded_date >= TO_DATE(?, 'YYYY-MM-DD')`;
            params.push(dateFrom);
        }
        
        if (dateTo) {
            sql += ` AND custrecord_dm_uploaded_date <= TO_DATE(?, 'YYYY-MM-DD')`;
            params.push(dateTo);
        }
        
        // Get total count
        const countSql = sql.replace(/SELECT[\s\S]*?FROM/, 'SELECT COUNT(*) as total FROM');
        const countResult = query.runSuiteQL({ query: countSql, params: params });
        const total = countResult.results.length > 0 ? countResult.results[0].values[0] : 0;
        
        // Add sorting and pagination
        const sortColumn = {
            'created': 'custrecord_dm_uploaded_date',
            'processed': 'custrecord_dm_processed_date',
            'confidence': 'custrecord_dm_confidence',
            'vendor': 'custrecord_dm_vendor',
            'status': 'custrecord_dm_status'
        }[sortBy] || 'custrecord_dm_uploaded_date';
        
        sql += ` ORDER BY ${sortColumn} ${sortDir}`;
        sql += ` OFFSET ${(page - 1) * pageSize} ROWS FETCH NEXT ${pageSize} ROWS ONLY`;
        
        const results = query.runSuiteQL({ query: sql, params: params });
        
        const documents = results.results.map(row => {
            const values = row.values;
            const extractedData = values[8] ? JSON.parse(values[8]) : {};
            const anomalies = values[9] ? JSON.parse(values[9]) : [];
            
            return {
                id: values[0],
                name: values[1],
                status: values[2],
                documentType: values[3],
                fileName: values[4],
                confidence: values[5],
                vendorId: values[6],
                vendorName: values[7],
                invoiceNumber: extractedData.invoiceNumber,
                totalAmount: extractedData.totalAmount,
                currency: extractedData.currency,
                hasAnomalies: anomalies.length > 0,
                anomalyCount: anomalies.length,
                uploadedDate: values[10],
                processedDate: values[11],
                uploadedBy: values[12],
                uploadedByName: values[13]
            };
        });
        
        return Response.paginated(documents, page, pageSize, total);
    }

    function getProcessingQueue(context) {
        const statuses = ['pending', 'processing', 'needs_review'];
        const page = parseInt(context.page) || 1;
        const pageSize = Math.min(parseInt(context.pageSize) || 50, 100);
        
        const sql = `
            SELECT 
                id,
                name,
                custrecord_dm_status as status,
                custrecord_dm_document_type as documentType,
                custrecord_dm_file_name as fileName,
                custrecord_dm_confidence as confidence,
                BUILTIN.DF(custrecord_dm_vendor) as vendorName,
                custrecord_dm_uploaded_date as uploadedDate,
                custrecord_dm_batch as batchId,
                custrecord_dm_extracted_data as extractedData
            FROM customrecord_dm_captured_document
            WHERE custrecord_dm_status IN ('pending', 'processing', 'extracted', 'needs_review')
            ORDER BY 
                CASE custrecord_dm_status 
                    WHEN 'needs_review' THEN 1 
                    WHEN 'extracted' THEN 2
                    WHEN 'processing' THEN 3 
                    WHEN 'pending' THEN 4 
                END,
                custrecord_dm_uploaded_date ASC
            OFFSET ${(page - 1) * pageSize} ROWS FETCH NEXT ${pageSize} ROWS ONLY
        `;
        
        const results = query.runSuiteQL({ query: sql });
        
        const queue = results.results.map(row => {
            const values = row.values;
            const extractedData = values[9] ? JSON.parse(values[9]) : {};
            
            return {
                id: values[0],
                name: values[1],
                status: values[2],
                documentType: values[3],
                fileName: values[4],
                confidence: values[5],
                vendorName: values[6],
                uploadedDate: values[7],
                batchId: values[8],
                invoiceNumber: extractedData.invoiceNumber,
                totalAmount: extractedData.totalAmount
            };
        });
        
        // Get queue counts by status
        const countSql = `
            SELECT 
                custrecord_dm_status as status,
                COUNT(*) as count
            FROM customrecord_dm_captured_document
            WHERE custrecord_dm_status IN ('pending', 'processing', 'extracted', 'needs_review')
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
        // Get processing statistics
        const statsSql = `
            SELECT 
                COUNT(*) as total,
                SUM(CASE WHEN custrecord_dm_status = 'completed' THEN 1 ELSE 0 END) as completed,
                SUM(CASE WHEN custrecord_dm_status = 'completed' AND custrecord_dm_confidence >= 85 THEN 1 ELSE 0 END) as autoProcessed,
                SUM(CASE WHEN custrecord_dm_status IN ('pending', 'processing', 'extracted', 'needs_review') THEN 1 ELSE 0 END) as pending,
                SUM(CASE WHEN custrecord_dm_status = 'rejected' THEN 1 ELSE 0 END) as rejected,
                SUM(CASE WHEN custrecord_dm_status = 'error' THEN 1 ELSE 0 END) as errors,
                AVG(custrecord_dm_confidence) as avgConfidence
            FROM customrecord_dm_captured_document
            WHERE custrecord_dm_uploaded_date >= ADD_MONTHS(SYSDATE, -1)
        `;
        
        const statsResult = query.runSuiteQL({ query: statsSql });
        const stats = statsResult.results[0].values;
        
        // Get total value processed
        const valueSql = `
            SELECT SUM(
                CASE 
                    WHEN custrecord_dm_extracted_data IS NOT NULL 
                    THEN TO_NUMBER(
                        REGEXP_SUBSTR(custrecord_dm_extracted_data, '"totalAmount"[:\\s]*([0-9.]+)', 1, 1, NULL, 1)
                    )
                    ELSE 0 
                END
            ) as totalValue
            FROM customrecord_dm_captured_document
            WHERE custrecord_dm_status = 'completed'
            AND custrecord_dm_processed_date >= ADD_MONTHS(SYSDATE, -1)
        `;
        
        let totalValue = 0;
        try {
            const valueResult = query.runSuiteQL({ query: valueSql });
            totalValue = valueResult.results[0].values[0] || 0;
        } catch (e) {
            log.debug('Value calculation fallback', e.message);
        }
        
        // Get document type breakdown
        const typeSql = `
            SELECT 
                custrecord_dm_document_type as docType,
                COUNT(*) as count
            FROM customrecord_dm_captured_document
            WHERE custrecord_dm_uploaded_date >= ADD_MONTHS(SYSDATE, -1)
            GROUP BY custrecord_dm_document_type
        `;
        
        const typeResults = query.runSuiteQL({ query: typeSql });
        const typeBreakdown = {};
        typeResults.results.forEach(row => {
            typeBreakdown[row.values[0] || 'unknown'] = row.values[1];
        });
        
        // Get daily processing trend (last 7 days)
        const trendSql = `
            SELECT 
                TO_CHAR(custrecord_dm_processed_date, 'YYYY-MM-DD') as day,
                COUNT(*) as count,
                AVG(custrecord_dm_confidence) as avgConfidence
            FROM customrecord_dm_captured_document
            WHERE custrecord_dm_processed_date >= SYSDATE - 7
            AND custrecord_dm_status IN ('completed', 'rejected')
            GROUP BY TO_CHAR(custrecord_dm_processed_date, 'YYYY-MM-DD')
            ORDER BY day
        `;
        
        const trendResults = query.runSuiteQL({ query: trendSql });
        const trend = trendResults.results.map(row => ({
            date: row.values[0],
            count: row.values[1],
            avgConfidence: row.values[2]
        }));
        
        // Get anomaly count
        const anomalySql = `
            SELECT COUNT(*) as count
            FROM customrecord_dm_captured_document
            WHERE custrecord_dm_anomalies IS NOT NULL
            AND custrecord_dm_anomalies != '[]'
            AND custrecord_dm_status NOT IN ('completed', 'rejected')
        `;
        
        const anomalyResult = query.runSuiteQL({ query: anomalySql });
        const anomalyCount = anomalyResult.results[0].values[0] || 0;
        
        return Response.success({
            summary: {
                totalProcessed: stats[0] || 0,
                completed: stats[1] || 0,
                autoProcessed: stats[2] || 0,
                pendingReview: stats[3] || 0,
                rejected: stats[4] || 0,
                errors: stats[5] || 0,
                avgConfidence: Math.round(stats[6] || 0),
                totalValue: totalValue,
                anomalyCount: anomalyCount
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
                custrecord_dm_file_name as fileName,
                BUILTIN.DF(custrecord_dm_vendor) as vendorName,
                custrecord_dm_anomalies as anomalies,
                custrecord_dm_uploaded_date as uploadedDate,
                custrecord_dm_confidence as confidence
            FROM customrecord_dm_captured_document
            WHERE custrecord_dm_anomalies IS NOT NULL
            AND custrecord_dm_anomalies != '[]'
            AND custrecord_dm_status NOT IN ('completed', 'rejected')
            ORDER BY custrecord_dm_uploaded_date DESC
            FETCH FIRST ${limit} ROWS ONLY
        `;
        
        const results = query.runSuiteQL({ query: sql });
        
        const anomalies = [];
        results.results.forEach(row => {
            const docAnomalies = JSON.parse(row.values[3] || '[]');
            docAnomalies.forEach(anomaly => {
                anomalies.push({
                    documentId: row.values[0],
                    fileName: row.values[1],
                    vendorName: row.values[2],
                    type: anomaly.type,
                    severity: anomaly.severity,
                    message: anomaly.message,
                    details: anomaly.details,
                    uploadedDate: row.values[4],
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
            SELECT 
                id,
                companyname,
                entityid,
                email,
                phone,
                BUILTIN.DF(currency) as currency,
                balance
            FROM vendor
            WHERE isinactive = 'F'
            AND (
                LOWER(companyname) LIKE LOWER(?) 
                OR LOWER(entityid) LIKE LOWER(?)
            )
            ORDER BY companyname
            FETCH FIRST 20 ROWS ONLY
        `;
        
        const searchPattern = `%${queryText}%`;
        const results = query.runSuiteQL({ 
            query: sql, 
            params: [searchPattern, searchPattern] 
        });
        
        const vendors = results.results.map(row => ({
            id: row.values[0],
            companyName: row.values[1],
            entityId: row.values[2],
            email: row.values[3],
            phone: row.values[4],
            currency: row.values[5],
            balance: row.values[6]
        }));
        
        return Response.success(vendors);
    }

    function searchPurchaseOrders(context) {
        const poNumber = context.poNumber;
        const vendorId = context.vendorId;
        
        let sql = `
            SELECT 
                id,
                tranid,
                BUILTIN.DF(entity) as vendorName,
                entity as vendorId,
                trandate,
                total,
                status,
                BUILTIN.DF(status) as statusText
            FROM transaction
            WHERE type = 'PurchOrd'
            AND status NOT IN ('Closed', 'Cancelled')
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
                id,
                name,
                custrecord_dm_batch_status as status,
                custrecord_dm_batch_document_count as documentCount,
                custrecord_dm_batch_processed_count as processedCount,
                custrecord_dm_batch_created_date as createdDate,
                custrecord_dm_batch_completed_date as completedDate,
                BUILTIN.DF(custrecord_dm_batch_created_by) as createdBy
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
            createdDate: row.values[5],
            completedDate: row.values[6],
            createdBy: row.values[7],
            progress: row.values[3] > 0 ? Math.round((row.values[4] / row.values[3]) * 100) : 0
        }));
        
        return Response.success(batches);
    }

    function getBatchDetails(batchId) {
        if (!batchId) {
            return Response.error('MISSING_PARAM', 'Batch ID is required');
        }
        
        const batchRecord = record.load({
            type: 'customrecord_dm_batch',
            id: batchId
        });
        
        const batch = {
            id: batchId,
            name: batchRecord.getValue('name'),
            status: batchRecord.getValue('custrecord_dm_batch_status'),
            documentCount: batchRecord.getValue('custrecord_dm_batch_document_count'),
            processedCount: batchRecord.getValue('custrecord_dm_batch_processed_count'),
            createdDate: batchRecord.getValue('custrecord_dm_batch_created_date'),
            completedDate: batchRecord.getValue('custrecord_dm_batch_completed_date'),
            createdBy: batchRecord.getText('custrecord_dm_batch_created_by'),
            notes: batchRecord.getValue('custrecord_dm_batch_notes')
        };
        
        // Get documents in batch
        const docSql = `
            SELECT 
                id,
                custrecord_dm_file_name as fileName,
                custrecord_dm_status as status,
                custrecord_dm_confidence as confidence,
                BUILTIN.DF(custrecord_dm_vendor) as vendorName
            FROM customrecord_dm_captured_document
            WHERE custrecord_dm_batch = ?
            ORDER BY id
        `;
        
        const docResults = query.runSuiteQL({ query: docSql, params: [batchId] });
        
        batch.documents = docResults.results.map(row => ({
            id: row.values[0],
            fileName: row.values[1],
            status: row.values[2],
            confidence: row.values[3],
            vendorName: row.values[4]
        }));
        
        return Response.success(batch);
    }

    function getSettings() {
        // Get company preferences and DocuMind settings
        const settings = {
            autoApproveThreshold: 85,
            defaultDocumentType: 'auto',
            emailImportEnabled: true,
            emailAddress: `documind+${runtime.accountId}@netsuite.com`,
            ocrProvider: 'oracle',
            duplicateDetection: true,
            benfordAnalysis: true,
            amountValidation: true,
            maxFileSize: 10485760, // 10MB
            supportedFileTypes: ['pdf', 'png', 'jpg', 'jpeg', 'tiff', 'tif', 'gif', 'bmp'],
            defaultCurrency: runtime.getCurrentScript().getParameter('custscript_dm_default_currency') || 'USD',
            defaultExpenseCategory: runtime.getCurrentScript().getParameter('custscript_dm_default_expense_cat'),
            notifyOnAnomaly: true,
            notifyRecipients: []
        };
        
        // Try to load custom settings record if exists
        try {
            const settingsSearch = search.create({
                type: 'customrecord_dm_settings',
                filters: [],
                columns: ['internalid']
            });
            
            const settingsResults = settingsSearch.run().getRange({ start: 0, end: 1 });
            if (settingsResults.length > 0) {
                const settingsRecord = record.load({
                    type: 'customrecord_dm_settings',
                    id: settingsResults[0].id
                });
                
                settings.autoApproveThreshold = settingsRecord.getValue('custrecord_dm_auto_approve_threshold') || settings.autoApproveThreshold;
                settings.defaultDocumentType = settingsRecord.getValue('custrecord_dm_default_doc_type') || settings.defaultDocumentType;
                settings.emailImportEnabled = settingsRecord.getValue('custrecord_dm_email_import_enabled');
                settings.duplicateDetection = settingsRecord.getValue('custrecord_dm_duplicate_detection');
                settings.benfordAnalysis = settingsRecord.getValue('custrecord_dm_benford_analysis');
                settings.notifyOnAnomaly = settingsRecord.getValue('custrecord_dm_notify_anomaly');
            }
        } catch (e) {
            log.debug('Settings load fallback', e.message);
        }
        
        return Response.success(settings);
    }

    function getAnalytics(context) {
        const period = context.period || '30'; // days
        const periodDays = parseInt(period);
        
        // Processing volume over time
        const volumeSql = `
            SELECT 
                TO_CHAR(custrecord_dm_processed_date, 'YYYY-MM-DD') as day,
                COUNT(*) as total,
                SUM(CASE WHEN custrecord_dm_status = 'completed' THEN 1 ELSE 0 END) as completed,
                SUM(CASE WHEN custrecord_dm_status = 'rejected' THEN 1 ELSE 0 END) as rejected,
                AVG(custrecord_dm_confidence) as avgConfidence
            FROM customrecord_dm_captured_document
            WHERE custrecord_dm_processed_date >= SYSDATE - ${periodDays}
            GROUP BY TO_CHAR(custrecord_dm_processed_date, 'YYYY-MM-DD')
            ORDER BY day
        `;
        
        const volumeResults = query.runSuiteQL({ query: volumeSql });
        const volumeTrend = volumeResults.results.map(row => ({
            date: row.values[0],
            total: row.values[1],
            completed: row.values[2],
            rejected: row.values[3],
            avgConfidence: Math.round(row.values[4] || 0)
        }));
        
        // Vendor breakdown
        const vendorSql = `
            SELECT 
                BUILTIN.DF(custrecord_dm_vendor) as vendorName,
                COUNT(*) as count,
                AVG(custrecord_dm_confidence) as avgConfidence
            FROM customrecord_dm_captured_document
            WHERE custrecord_dm_processed_date >= SYSDATE - ${periodDays}
            AND custrecord_dm_vendor IS NOT NULL
            GROUP BY custrecord_dm_vendor, BUILTIN.DF(custrecord_dm_vendor)
            ORDER BY count DESC
            FETCH FIRST 10 ROWS ONLY
        `;
        
        const vendorResults = query.runSuiteQL({ query: vendorSql });
        const topVendors = vendorResults.results.map(row => ({
            vendorName: row.values[0],
            count: row.values[1],
            avgConfidence: Math.round(row.values[2] || 0)
        }));
        
        // Anomaly breakdown
        const anomalyTypeSql = `
            SELECT 
                custrecord_dm_anomalies as anomalies
            FROM customrecord_dm_captured_document
            WHERE custrecord_dm_anomalies IS NOT NULL
            AND custrecord_dm_anomalies != '[]'
            AND custrecord_dm_uploaded_date >= SYSDATE - ${periodDays}
        `;
        
        const anomalyResults = query.runSuiteQL({ query: anomalyTypeSql });
        const anomalyTypes = {};
        anomalyResults.results.forEach(row => {
            const anomalies = JSON.parse(row.values[0] || '[]');
            anomalies.forEach(a => {
                anomalyTypes[a.type] = (anomalyTypes[a.type] || 0) + 1;
            });
        });
        
        // Processing time analysis (if we track it)
        const efficiencySql = `
            SELECT 
                AVG(
                    (custrecord_dm_processed_date - custrecord_dm_uploaded_date) * 24 * 60
                ) as avgProcessingMinutes,
                MIN(
                    (custrecord_dm_processed_date - custrecord_dm_uploaded_date) * 24 * 60
                ) as minProcessingMinutes,
                MAX(
                    (custrecord_dm_processed_date - custrecord_dm_uploaded_date) * 24 * 60
                ) as maxProcessingMinutes
            FROM customrecord_dm_captured_document
            WHERE custrecord_dm_processed_date IS NOT NULL
            AND custrecord_dm_uploaded_date IS NOT NULL
            AND custrecord_dm_processed_date >= SYSDATE - ${periodDays}
        `;
        
        let processingTime = { avg: 0, min: 0, max: 0 };
        try {
            const efficiencyResults = query.runSuiteQL({ query: efficiencySql });
            if (efficiencyResults.results.length > 0) {
                processingTime = {
                    avg: Math.round(efficiencyResults.results[0].values[0] || 0),
                    min: Math.round(efficiencyResults.results[0].values[1] || 0),
                    max: Math.round(efficiencyResults.results[0].values[2] || 0)
                };
            }
        } catch (e) {
            log.debug('Processing time calc fallback', e.message);
        }
        
        return Response.success({
            period: periodDays,
            volumeTrend: volumeTrend,
            topVendors: topVendors,
            anomalyBreakdown: anomalyTypes,
            processingTime: processingTime
        });
    }

    // ==================== POST Implementations ====================

    function uploadDocument(context) {
        const fileContent = context.fileContent; // Base64 encoded
        const fileName = context.fileName;
        const documentType = context.documentType || 'auto';
        const folderId = context.folderId || getUploadFolder();
        
        if (!fileContent || !fileName) {
            return Response.error('MISSING_PARAM', 'File content and name are required');
        }
        
        // Decode and validate file
        const fileExtension = fileName.split('.').pop().toLowerCase();
        const supportedTypes = ['pdf', 'png', 'jpg', 'jpeg', 'tiff', 'tif', 'gif', 'bmp'];
        
        if (!supportedTypes.includes(fileExtension)) {
            return Response.error('INVALID_FILE_TYPE', `File type .${fileExtension} is not supported`);
        }
        
        // Create file in File Cabinet
        const fileType = getFileType(fileExtension);
        const decodedContent = encode.convert({
            string: fileContent,
            inputEncoding: encode.Encoding.BASE_64,
            outputEncoding: encode.Encoding.UTF_8
        });
        
        const fileObj = file.create({
            name: fileName,
            fileType: fileType,
            contents: fileContent,
            encoding: file.Encoding.BASE_64,
            folder: folderId,
            isOnline: false
        });
        
        const fileId = fileObj.save();
        const savedFile = file.load({ id: fileId });
        
        // Create captured document record
        const docRecord = record.create({
            type: 'customrecord_dm_captured_document'
        });
        
        docRecord.setValue('name', `DM-${Date.now()}`);
        docRecord.setValue('custrecord_dm_status', 'pending');
        docRecord.setValue('custrecord_dm_document_type', documentType);
        docRecord.setValue('custrecord_dm_file_id', fileId);
        docRecord.setValue('custrecord_dm_file_name', fileName);
        docRecord.setValue('custrecord_dm_file_size', savedFile.size);
        docRecord.setValue('custrecord_dm_mime_type', getMimeType(fileExtension));
        docRecord.setValue('custrecord_dm_uploaded_by', runtime.getCurrentUser().id);
        docRecord.setValue('custrecord_dm_uploaded_date', new Date());
        
        const documentId = docRecord.save();
        
        // Start processing if auto-process is enabled
        if (context.autoProcess !== false) {
            try {
                processDocument(documentId);
            } catch (e) {
                log.error('Auto-process failed', e);
            }
        }
        
        return Response.success({
            documentId: documentId,
            fileId: fileId,
            fileName: fileName,
            status: 'pending'
        }, 'Document uploaded successfully');
    }

    function uploadBatch(context) {
        const files = context.files; // Array of { fileContent, fileName }
        const batchName = context.batchName || `Batch-${new Date().toISOString().slice(0,10)}`;
        
        if (!files || !Array.isArray(files) || files.length === 0) {
            return Response.error('MISSING_PARAM', 'Files array is required');
        }
        
        // Create batch record
        const batchRecord = record.create({
            type: 'customrecord_dm_batch'
        });
        
        batchRecord.setValue('name', batchName);
        batchRecord.setValue('custrecord_dm_batch_status', 'pending');
        batchRecord.setValue('custrecord_dm_batch_document_count', files.length);
        batchRecord.setValue('custrecord_dm_batch_processed_count', 0);
        batchRecord.setValue('custrecord_dm_batch_created_date', new Date());
        batchRecord.setValue('custrecord_dm_batch_created_by', runtime.getCurrentUser().id);
        
        const batchId = batchRecord.save();
        
        const uploadResults = [];
        const folderId = getUploadFolder();
        
        // Upload each file
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
                    // Update document with batch reference
                    record.submitFields({
                        type: 'customrecord_dm_captured_document',
                        id: result.data.documentId,
                        values: {
                            'custrecord_dm_batch': batchId
                        }
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
        
        // Start batch processing via Map/Reduce
        try {
            const mrTask = task.create({
                taskType: task.TaskType.MAP_REDUCE,
                scriptId: 'customscript_dm_batch_processor',
                deploymentId: 'customdeploy_dm_batch_processor',
                params: {
                    'custscript_dm_batch_id': batchId
                }
            });
            
            mrTask.submit();
            
            // Update batch status
            record.submitFields({
                type: 'customrecord_dm_batch',
                id: batchId,
                values: {
                    'custrecord_dm_batch_status': 'processing'
                }
            });
        } catch (e) {
            log.error('Batch processing start failed', e);
        }
        
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
            values: {
                'custrecord_dm_status': 'processing'
            }
        });
        
        try {
            // Load document record
            const docRecord = record.load({
                type: 'customrecord_dm_captured_document',
                id: documentId
            });
            
            const fileId = docRecord.getValue('custrecord_dm_file_id');
            const documentType = docRecord.getValue('custrecord_dm_document_type');
            
            // Initialize engine and process
            const engine = new Engine.DocumentCaptureEngine();
            
            // Process synchronously for single documents
            const result = engine.processDocument(fileId, {
                mode: 'sync',
                documentType: documentType
            });
            
            if (result.success) {
                const extraction = result.extraction;
                
                // Determine status based on confidence
                let newStatus = 'needs_review';
                if (extraction.confidence.overall >= 85 && extraction.anomalies.length === 0) {
                    newStatus = 'extracted'; // Ready for auto-approval
                }
                
                // Update document record with extraction
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
                        'custrecord_dm_vendor': extraction.vendorMatch?.vendorId || null,
                        'custrecord_dm_processed_date': new Date()
                    }
                });
                
                return Response.success({
                    documentId: documentId,
                    status: newStatus,
                    confidence: extraction.confidence.overall,
                    extraction: extraction,
                    anomalyCount: extraction.anomalies.length
                }, 'Document processed successfully');
            } else {
                // Processing failed
                record.submitFields({
                    type: 'customrecord_dm_captured_document',
                    id: documentId,
                    values: {
                        'custrecord_dm_status': 'error',
                        'custrecord_dm_notes': result.error
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
                    'custrecord_dm_status': 'error',
                    'custrecord_dm_notes': e.message
                }
            });
            
            return Response.error('PROCESSING_ERROR', e.message);
        }
    }

    function reprocessDocument(documentId) {
        if (!documentId) {
            return Response.error('MISSING_PARAM', 'Document ID is required');
        }
        
        // Reset status and clear previous extraction
        record.submitFields({
            type: 'customrecord_dm_captured_document',
            id: documentId,
            values: {
                'custrecord_dm_status': 'pending',
                'custrecord_dm_extracted_data': null,
                'custrecord_dm_line_items': null,
                'custrecord_dm_anomalies': null,
                'custrecord_dm_confidence': null,
                'custrecord_dm_notes': null
            }
        });
        
        return processDocument(documentId);
    }

    function importFromEmail(context) {
        // This would be called by a scheduled script that monitors the email inbox
        const emailId = context.emailId;
        const attachments = context.attachments; // Array of file IDs
        
        if (!attachments || attachments.length === 0) {
            return Response.error('NO_ATTACHMENTS', 'No attachments found in email');
        }
        
        const results = [];
        
        attachments.forEach(fileId => {
            try {
                // Create document record for each attachment
                const fileObj = file.load({ id: fileId });
                
                const docRecord = record.create({
                    type: 'customrecord_dm_captured_document'
                });
                
                docRecord.setValue('name', `DM-EMAIL-${Date.now()}`);
                docRecord.setValue('custrecord_dm_status', 'pending');
                docRecord.setValue('custrecord_dm_document_type', 'auto');
                docRecord.setValue('custrecord_dm_file_id', fileId);
                docRecord.setValue('custrecord_dm_file_name', fileObj.name);
                docRecord.setValue('custrecord_dm_file_size', fileObj.size);
                docRecord.setValue('custrecord_dm_uploaded_date', new Date());
                docRecord.setValue('custrecord_dm_notes', `Imported from email: ${emailId}`);
                
                const documentId = docRecord.save();
                
                results.push({
                    success: true,
                    fileId: fileId,
                    documentId: documentId
                });
            } catch (e) {
                results.push({
                    success: false,
                    fileId: fileId,
                    error: e.message
                });
            }
        });
        
        return Response.success({
            emailId: emailId,
            importedCount: results.filter(r => r.success).length,
            failedCount: results.filter(r => !r.success).length,
            results: results
        });
    }

    function submitCorrection(context) {
        const documentId = context.documentId;
        const fieldName = context.fieldName;
        const originalValue = context.originalValue;
        const correctedValue = context.correctedValue;
        const vendorId = context.vendorId;
        
        if (!documentId || !fieldName) {
            return Response.error('MISSING_PARAM', 'Document ID and field name are required');
        }
        
        try {
            // Create correction record for learning
            const correctionRecord = record.create({
                type: 'customrecord_dm_correction'
            });
            
            correctionRecord.setValue('name', `Correction-${documentId}-${fieldName}`);
            correctionRecord.setValue('custrecord_dm_corr_document', documentId);
            correctionRecord.setValue('custrecord_dm_corr_field', fieldName);
            correctionRecord.setValue('custrecord_dm_corr_original', originalValue);
            correctionRecord.setValue('custrecord_dm_corr_corrected', correctedValue);
            correctionRecord.setValue('custrecord_dm_corr_vendor', vendorId);
            correctionRecord.setValue('custrecord_dm_corr_user', runtime.getCurrentUser().id);
            correctionRecord.setValue('custrecord_dm_corr_date', new Date());
            
            const correctionId = correctionRecord.save();
            
            // Apply learning via engine
            const engine = new Engine.DocumentCaptureEngine();
            engine.learningEngine.recordCorrection({
                documentId: documentId,
                fieldName: fieldName,
                originalValue: originalValue,
                correctedValue: correctedValue,
                vendorId: vendorId
            });
            
            return Response.success({
                correctionId: correctionId,
                message: 'Correction recorded for learning'
            });
        } catch (e) {
            return Response.error('CORRECTION_FAILED', e.message);
        }
    }

    // ==================== PUT Implementations ====================

    function updateDocument(context) {
        const documentId = context.documentId;
        const updates = context.updates;
        
        if (!documentId || !updates) {
            return Response.error('MISSING_PARAM', 'Document ID and updates are required');
        }
        
        try {
            const docRecord = record.load({
                type: 'customrecord_dm_captured_document',
                id: documentId
            });
            
            // Update extracted data
            if (updates.extractedData) {
                const currentData = JSON.parse(docRecord.getValue('custrecord_dm_extracted_data') || '{}');
                const mergedData = { ...currentData, ...updates.extractedData };
                docRecord.setValue('custrecord_dm_extracted_data', JSON.stringify(mergedData));
            }
            
            // Update line items
            if (updates.lineItems) {
                docRecord.setValue('custrecord_dm_line_items', JSON.stringify(updates.lineItems));
            }
            
            // Update vendor
            if (updates.vendorId) {
                docRecord.setValue('custrecord_dm_vendor', updates.vendorId);
            }
            
            // Update document type
            if (updates.documentType) {
                docRecord.setValue('custrecord_dm_document_type', updates.documentType);
            }
            
            // Update notes
            if (updates.notes !== undefined) {
                docRecord.setValue('custrecord_dm_notes', updates.notes);
            }
            
            docRecord.save();
            
            return Response.success({ documentId: documentId }, 'Document updated successfully');
        } catch (e) {
            return Response.error('UPDATE_FAILED', e.message);
        }
    }

    function approveDocument(context) {
        const documentId = context.documentId;
        const createTransaction = context.createTransaction !== false;
        const transactionType = context.transactionType; // vendorbill, expensereport, vendorcredit
        const overrides = context.overrides || {};
        
        if (!documentId) {
            return Response.error('MISSING_PARAM', 'Document ID is required');
        }
        
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
            
            let transactionId = null;
            let actualTransactionType = transactionType;
            
            if (createTransaction) {
                // Determine transaction type if not specified
                if (!actualTransactionType) {
                    switch (documentType) {
                        case 'invoice':
                            actualTransactionType = 'vendorbill';
                            break;
                        case 'expense':
                        case 'receipt':
                            actualTransactionType = 'expensereport';
                            break;
                        case 'credit_memo':
                            actualTransactionType = 'vendorcredit';
                            break;
                        default:
                            actualTransactionType = 'vendorbill';
                    }
                }
                
                const engine = new Engine.DocumentCaptureEngine();
                const transactionCreator = new Engine.TransactionCreator();
                
                // Merge extracted data with overrides
                const finalData = { ...extractedData, ...overrides };
                
                // Create transaction
                let result;
                switch (actualTransactionType) {
                    case 'vendorbill':
                        result = transactionCreator.createVendorBill({
                            vendorId: vendorId,
                            invoiceNumber: finalData.invoiceNumber,
                            invoiceDate: finalData.invoiceDate,
                            dueDate: finalData.dueDate,
                            currency: finalData.currency,
                            lineItems: lineItems,
                            memo: `DocuMind Import - ${docRecord.getValue('custrecord_dm_file_name')}`,
                            attachFileId: fileId
                        });
                        break;
                        
                    case 'expensereport':
                        result = transactionCreator.createExpenseReport({
                            employeeId: runtime.getCurrentUser().id,
                            expenseDate: finalData.invoiceDate || new Date(),
                            lineItems: lineItems,
                            memo: finalData.invoiceNumber || 'DocuMind Import',
                            attachFileId: fileId
                        });
                        break;
                        
                    case 'vendorcredit':
                        result = transactionCreator.createVendorCredit({
                            vendorId: vendorId,
                            creditNumber: finalData.invoiceNumber,
                            creditDate: finalData.invoiceDate,
                            currency: finalData.currency,
                            lineItems: lineItems,
                            memo: `DocuMind Import - ${docRecord.getValue('custrecord_dm_file_name')}`,
                            attachFileId: fileId
                        });
                        break;
                }
                
                if (result && result.success) {
                    transactionId = result.transactionId;
                } else {
                    return Response.error('TRANSACTION_FAILED', result?.error || 'Failed to create transaction');
                }
            }
            
            // Update document status
            record.submitFields({
                type: 'customrecord_dm_captured_document',
                id: documentId,
                values: {
                    'custrecord_dm_status': 'completed',
                    'custrecord_dm_created_transaction': transactionId,
                    'custrecord_dm_transaction_type': actualTransactionType,
                    'custrecord_dm_reviewed_by': runtime.getCurrentUser().id,
                    'custrecord_dm_reviewed_date': new Date()
                }
            });
            
            // Update batch progress if applicable
            const batchId = docRecord.getValue('custrecord_dm_batch');
            if (batchId) {
                updateBatchProgress(batchId);
            }
            
            return Response.success({
                documentId: documentId,
                transactionId: transactionId,
                transactionType: actualTransactionType,
                status: 'completed'
            }, 'Document approved successfully');
        } catch (e) {
            log.error('Approve error', e);
            return Response.error('APPROVE_FAILED', e.message);
        }
    }

    function rejectDocument(context) {
        const documentId = context.documentId;
        const reason = context.reason || 'Rejected by user';
        
        if (!documentId) {
            return Response.error('MISSING_PARAM', 'Document ID is required');
        }
        
        try {
            const docRecord = record.load({
                type: 'customrecord_dm_captured_document',
                id: documentId
            });
            
            const batchId = docRecord.getValue('custrecord_dm_batch');
            
            record.submitFields({
                type: 'customrecord_dm_captured_document',
                id: documentId,
                values: {
                    'custrecord_dm_status': 'rejected',
                    'custrecord_dm_notes': reason,
                    'custrecord_dm_reviewed_by': runtime.getCurrentUser().id,
                    'custrecord_dm_reviewed_date': new Date()
                }
            });
            
            // Update batch progress if applicable
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
            return Response.error('MISSING_PARAM', 'Document ID and status are required');
        }
        
        const validStatuses = ['pending', 'processing', 'extracted', 'needs_review', 'approved', 'rejected', 'completed', 'error'];
        if (!validStatuses.includes(status)) {
            return Response.error('INVALID_STATUS', `Invalid status: ${status}`);
        }
        
        record.submitFields({
            type: 'customrecord_dm_captured_document',
            id: documentId,
            values: {
                'custrecord_dm_status': status
            }
        });
        
        return Response.success({ documentId: documentId, status: status });
    }

    function assignDocument(context) {
        const documentId = context.documentId;
        const assigneeId = context.assigneeId;
        
        if (!documentId) {
            return Response.error('MISSING_PARAM', 'Document ID is required');
        }
        
        record.submitFields({
            type: 'customrecord_dm_captured_document',
            id: documentId,
            values: {
                'custrecord_dm_assigned_to': assigneeId,
                'custrecord_dm_assigned_date': assigneeId ? new Date() : null
            }
        });
        
        return Response.success({
            documentId: documentId,
            assigneeId: assigneeId
        }, assigneeId ? 'Document assigned' : 'Document unassigned');
    }

    function updateSettings(context) {
        const settings = context.settings;
        
        if (!settings) {
            return Response.error('MISSING_PARAM', 'Settings object is required');
        }
        
        try {
            // Find or create settings record
            let settingsId = null;
            const settingsSearch = search.create({
                type: 'customrecord_dm_settings',
                filters: [],
                columns: ['internalid']
            });
            
            const results = settingsSearch.run().getRange({ start: 0, end: 1 });
            
            let settingsRecord;
            if (results.length > 0) {
                settingsRecord = record.load({
                    type: 'customrecord_dm_settings',
                    id: results[0].id
                });
            } else {
                settingsRecord = record.create({
                    type: 'customrecord_dm_settings'
                });
                settingsRecord.setValue('name', 'DocuMind Settings');
            }
            
            // Update settings
            if (settings.autoApproveThreshold !== undefined) {
                settingsRecord.setValue('custrecord_dm_auto_approve_threshold', settings.autoApproveThreshold);
            }
            if (settings.defaultDocumentType !== undefined) {
                settingsRecord.setValue('custrecord_dm_default_doc_type', settings.defaultDocumentType);
            }
            if (settings.emailImportEnabled !== undefined) {
                settingsRecord.setValue('custrecord_dm_email_import_enabled', settings.emailImportEnabled);
            }
            if (settings.duplicateDetection !== undefined) {
                settingsRecord.setValue('custrecord_dm_duplicate_detection', settings.duplicateDetection);
            }
            if (settings.benfordAnalysis !== undefined) {
                settingsRecord.setValue('custrecord_dm_benford_analysis', settings.benfordAnalysis);
            }
            if (settings.notifyOnAnomaly !== undefined) {
                settingsRecord.setValue('custrecord_dm_notify_anomaly', settings.notifyOnAnomaly);
            }
            
            settingsId = settingsRecord.save();
            
            return Response.success({ settingsId: settingsId }, 'Settings updated successfully');
        } catch (e) {
            return Response.error('SETTINGS_UPDATE_FAILED', e.message);
        }
    }

    // ==================== DELETE Implementations ====================

    function deleteDocument(documentId) {
        if (!documentId) {
            return Response.error('MISSING_PARAM', 'Document ID is required');
        }
        
        try {
            // Load to get file ID
            const docRecord = record.load({
                type: 'customrecord_dm_captured_document',
                id: documentId
            });
            
            const fileId = docRecord.getValue('custrecord_dm_file_id');
            const batchId = docRecord.getValue('custrecord_dm_batch');
            
            // Delete document record
            record.delete({
                type: 'customrecord_dm_captured_document',
                id: documentId
            });
            
            // Optionally delete file
            if (fileId) {
                try {
                    file.delete({ id: fileId });
                } catch (e) {
                    log.debug('File delete skipped', e.message);
                }
            }
            
            // Update batch count if applicable
            if (batchId) {
                const currentCount = search.lookupFields({
                    type: 'customrecord_dm_batch',
                    id: batchId,
                    columns: ['custrecord_dm_batch_document_count']
                }).custrecord_dm_batch_document_count;
                
                record.submitFields({
                    type: 'customrecord_dm_batch',
                    id: batchId,
                    values: {
                        'custrecord_dm_batch_document_count': Math.max(0, currentCount - 1)
                    }
                });
            }
            
            return Response.success({ documentId: documentId }, 'Document deleted');
        } catch (e) {
            return Response.error('DELETE_FAILED', e.message);
        }
    }

    function deleteBatch(batchId) {
        if (!batchId) {
            return Response.error('MISSING_PARAM', 'Batch ID is required');
        }
        
        try {
            // Find all documents in batch
            const docSearch = search.create({
                type: 'customrecord_dm_captured_document',
                filters: [
                    ['custrecord_dm_batch', 'is', batchId]
                ],
                columns: ['internalid', 'custrecord_dm_file_id']
            });
            
            const deleteCount = { documents: 0, files: 0 };
            
            docSearch.run().each(result => {
                const docId = result.id;
                const fileId = result.getValue('custrecord_dm_file_id');
                
                // Delete document
                record.delete({
                    type: 'customrecord_dm_captured_document',
                    id: docId
                });
                deleteCount.documents++;
                
                // Delete file
                if (fileId) {
                    try {
                        file.delete({ id: fileId });
                        deleteCount.files++;
                    } catch (e) {
                        log.debug('File delete skipped', e.message);
                    }
                }
                
                return true;
            });
            
            // Delete batch record
            record.delete({
                type: 'customrecord_dm_batch',
                id: batchId
            });
            
            return Response.success({
                batchId: batchId,
                deletedDocuments: deleteCount.documents,
                deletedFiles: deleteCount.files
            }, 'Batch deleted');
        } catch (e) {
            return Response.error('BATCH_DELETE_FAILED', e.message);
        }
    }

    function clearCompleted(context) {
        const olderThanDays = parseInt(context.olderThanDays) || 30;
        const deleteFiles = context.deleteFiles !== false;
        
        try {
            const cutoffDate = new Date();
            cutoffDate.setDate(cutoffDate.getDate() - olderThanDays);
            
            const docSearch = search.create({
                type: 'customrecord_dm_captured_document',
                filters: [
                    ['custrecord_dm_status', 'anyof', ['completed', 'rejected']],
                    'AND',
                    ['custrecord_dm_reviewed_date', 'before', cutoffDate]
                ],
                columns: ['internalid', 'custrecord_dm_file_id']
            });
            
            const deleteCount = { documents: 0, files: 0 };
            
            docSearch.run().each(result => {
                const docId = result.id;
                const fileId = result.getValue('custrecord_dm_file_id');
                
                record.delete({
                    type: 'customrecord_dm_captured_document',
                    id: docId
                });
                deleteCount.documents++;
                
                if (deleteFiles && fileId) {
                    try {
                        file.delete({ id: fileId });
                        deleteCount.files++;
                    } catch (e) {
                        log.debug('File delete skipped', e.message);
                    }
                }
                
                return true;
            });
            
            return Response.success({
                deletedDocuments: deleteCount.documents,
                deletedFiles: deleteCount.files,
                olderThanDays: olderThanDays
            }, 'Completed documents cleared');
        } catch (e) {
            return Response.error('CLEAR_FAILED', e.message);
        }
    }

    // ==================== Helper Functions ====================

    function getUploadFolder() {
        // Find or create DocuMind upload folder
        const folderSearch = search.create({
            type: 'folder',
            filters: [
                ['name', 'is', 'DocuMind Uploads']
            ],
            columns: ['internalid']
        });
        
        const results = folderSearch.run().getRange({ start: 0, end: 1 });
        
        if (results.length > 0) {
            return results[0].id;
        }
        
        // Create folder
        const folderRecord = record.create({
            type: 'folder'
        });
        folderRecord.setValue('name', 'DocuMind Uploads');
        folderRecord.setValue('description', 'Uploaded documents for DocuMind processing');
        
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
        return typeMap[extension.toLowerCase()] || file.Type.PLAINTEXT;
    }

    function getMimeType(extension) {
        const mimeMap = {
            'pdf': 'application/pdf',
            'png': 'image/png',
            'jpg': 'image/jpeg',
            'jpeg': 'image/jpeg',
            'tiff': 'image/tiff',
            'tif': 'image/tiff',
            'gif': 'image/gif',
            'bmp': 'image/bmp'
        };
        return mimeMap[extension.toLowerCase()] || 'application/octet-stream';
    }

    function updateBatchProgress(batchId) {
        // Count completed documents in batch
        const sql = `
            SELECT 
                COUNT(*) as total,
                SUM(CASE WHEN custrecord_dm_status IN ('completed', 'rejected') THEN 1 ELSE 0 END) as processed
            FROM customrecord_dm_captured_document
            WHERE custrecord_dm_batch = ?
        `;
        
        const results = query.runSuiteQL({ query: sql, params: [batchId] });
        const total = results.results[0].values[0] || 0;
        const processed = results.results[0].values[1] || 0;
        
        const updates = {
            'custrecord_dm_batch_processed_count': processed
        };
        
        // Update status if all done
        if (processed >= total && total > 0) {
            updates['custrecord_dm_batch_status'] = 'completed';
            updates['custrecord_dm_batch_completed_date'] = new Date();
        }
        
        record.submitFields({
            type: 'customrecord_dm_batch',
            id: batchId,
            values: updates
        });
    }

    return {
        get: get,
        post: post,
        put: put,
        delete: _delete
    };
});
