/**
 * @NApiVersion 2.1
 * @NScriptType Restlet
 * @NModuleScope SameAccount
 *
 * Flux Capture - Main API Router
 * Single RESTlet that handles all API operations for simplified deployment
 *
 * IMPORTANT: All handlers must return JSON.stringify() result, not raw objects.
 * NetSuite's automatic object serialization causes UNEXPECTED_ERROR.
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
    'N/task',
    '/SuiteApps/com.flux.capture/lib/FC_Engine',
    '/SuiteApps/com.flux.capture/suitelet/FC_FormSchemaExtractor'
], function(file, record, search, query, runtime, errorModule, log, encode, email, format, task, FC_Engine, FormSchemaExtractor) {

    const API_VERSION = '2.0.0';

    // Script IDs for task dispatching
    const SCRIPT_IDS = {
        PROCESS_DOCUMENTS_MR: 'customscript_fc_process_docs_mr',
        PROCESS_DOCUMENTS_DEPLOY: 'customdeploy_fc_process_docs_mr'
    };

    // Engine module - may be null if it failed to load
    function getEngine() {
        return FC_Engine || { FluxCaptureEngine: null };
    }

    // ==================== Status Constants ====================

    const DocStatus = Object.freeze({
        PENDING: 1,
        PROCESSING: 2,
        EXTRACTED: 3,
        NEEDS_REVIEW: 4,
        REJECTED: 5,
        COMPLETED: 6,
        ERROR: 7
    });

    const DocStatusLabels = Object.freeze({
        1: 'Pending',
        2: 'Processing',
        3: 'Extracted',
        4: 'Needs Review',
        5: 'Rejected',
        6: 'Completed',
        7: 'Error'
    });

    const BatchStatus = Object.freeze({
        PENDING: 1,
        PROCESSING: 2,
        COMPLETED: 3,
        PARTIAL_ERROR: 4,
        FAILED: 5,
        CANCELLED: 6
    });

    const BatchStatusLabels = Object.freeze({
        1: 'Pending',
        2: 'Processing',
        3: 'Completed',
        4: 'Partial Error',
        5: 'Failed',
        6: 'Cancelled'
    });

    const DocType = Object.freeze({
        INVOICE: 1,
        RECEIPT: 2,
        CREDIT_MEMO: 3,
        EXPENSE_REPORT: 4,
        PURCHASE_ORDER: 5,
        UNKNOWN: 6
    });

    const DocTypeLabels = Object.freeze({
        1: 'Invoice',
        2: 'Receipt',
        3: 'Credit Memo',
        4: 'Expense Report',
        5: 'Purchase Order',
        6: 'Unknown'
    });

    const Source = Object.freeze({
        UPLOAD: 1,
        EMAIL: 2,
        DRAG_DROP: 3,
        API: 4,
        SCANNER: 5,
        MOBILE: 6
    });

    const SourceLabels = Object.freeze({
        1: 'Manual Upload',
        2: 'Email Import',
        3: 'Drag and Drop',
        4: 'API Integration',
        5: 'Scanner',
        6: 'Mobile App'
    });

    // ==================== Response Helpers ====================

    const Response = {
        success: function(data, message) {
            return {
                success: true,
                version: API_VERSION,
                timestamp: new Date().toISOString(),
                message: message || 'Success',
                data: data
            };
        },

        error: function(code, message, details) {
            return {
                success: false,
                version: API_VERSION,
                timestamp: new Date().toISOString(),
                error: {
                    code: code,
                    message: message,
                    details: details || null
                }
            };
        },

        paginated: function(data, page, pageSize, total) {
            return {
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
            };
        }
    };

    // ==================== Main Handlers ====================
    // CRITICAL: Return JSON.stringify() to avoid NetSuite serialization bug

    function get(context) {
        var result;
        try {
            var action = context.action || 'list';

            switch (action) {
                case 'document':
                    result = getDocument(context.id);
                    break;
                case 'list':
                    result = getDocumentList(context);
                    break;
                case 'queue':
                    result = getProcessingQueue(context);
                    break;
                case 'stats':
                    result = getDashboardStats();
                    break;
                case 'anomalies':
                    result = getRecentAnomalies(context);
                    break;
                case 'vendors':
                    result = searchVendors(context.query);
                    break;
                case 'purchaseorders':
                    result = searchPurchaseOrders(context);
                    break;
                case 'batches':
                    result = getBatches(context);
                    break;
                case 'batch':
                    result = getBatchDetails(context.id);
                    break;
                case 'settings':
                    result = getSettings();
                    break;
                case 'analytics':
                    result = getAnalytics(context);
                    break;
                case 'formfields':
                    result = getTransactionFormFields(context.transactionType, context.formId);
                    break;
                case 'formschema':
                    result = getFormSchema(context.transactionType, context);
                    break;
                case 'formlayout':
                    result = getFormLayout(context.transactionType, context.formId);
                    break;
                case 'accounts':
                    result = getAccounts(context);
                    break;
                case 'items':
                    result = getItems(context);
                    break;
                case 'health':
                    result = Response.success({ status: 'healthy', version: API_VERSION });
                    break;
                default:
                    result = Response.error('INVALID_ACTION', 'Unknown action: ' + action);
            }
        } catch (e) {
            log.error('GET Error', e);
            result = Response.error('GET_FAILED', e.message);
        }
        return JSON.stringify(result);
    }

    function post(context) {
        var result;
        try {
            var action = context.action || 'upload';

            switch (action) {
                case 'upload':
                    result = uploadDocument(context);
                    break;
                case 'batch':
                    result = uploadBatch(context);
                    break;
                case 'process':
                    result = processDocument(context.documentId);
                    break;
                case 'processBatch':
                    result = processBatchDocuments(context);
                    break;
                case 'reprocess':
                    result = reprocessDocument(context.documentId);
                    break;
                case 'emailImport':
                    result = importFromEmail(context);
                    break;
                case 'checkEmails':
                    result = checkEmailInbox(context);
                    break;
                case 'learn':
                    result = submitCorrection(context);
                    break;
                default:
                    result = Response.error('INVALID_ACTION', 'Unknown action: ' + action);
            }
        } catch (e) {
            log.error('POST Error', e);
            result = Response.error('POST_FAILED', e.message);
        }
        return JSON.stringify(result);
    }

    function put(context) {
        var result;
        try {
            var action = context.action || 'update';

            switch (action) {
                case 'update':
                    result = updateDocument(context);
                    break;
                case 'approve':
                    result = approveDocument(context);
                    break;
                case 'reject':
                    result = rejectDocument(context);
                    break;
                case 'status':
                    result = updateStatus(context);
                    break;
                case 'assign':
                    result = assignDocument(context);
                    break;
                case 'settings':
                    result = updateSettings(context);
                    break;
                case 'formconfig':
                    result = updateFormSchemaConfig(context.transactionType, context.formId, context.config);
                    break;
                case 'invalidatecache':
                    result = invalidateFormSchemaCache(context.transactionType, context.formId);
                    break;
                case 'saveformlayout':
                    result = saveFormLayout(context.transactionType, context.formId, context.layout);
                    break;
                default:
                    result = Response.error('INVALID_ACTION', 'Unknown action: ' + action);
            }
        } catch (e) {
            log.error('PUT Error', e);
            result = Response.error('PUT_FAILED', e.message);
        }
        return JSON.stringify(result);
    }

    function _delete(context) {
        var result;
        try {
            // For DELETE requests, params come as URL query string object (not body)
            // NetSuite RESTlets pass query params directly to the handler
            var params = context || {};

            // If context is a string (body), try to parse it, but prefer URL params
            if (typeof context === 'string') {
                try {
                    params = JSON.parse(context);
                } catch (e) {
                    // Not JSON, might be empty string or URL encoded
                    params = {};
                }
            }

            log.debug('_delete', {
                contextType: typeof context,
                params: JSON.stringify(params),
                hasId: !!(params && params.id),
                hasDocumentId: !!(params && params.documentId)
            });

            var action = (params && params.action) || 'document';

            switch (action) {
                case 'document':
                    var docId = params && (params.id || params.documentId);
                    // Handle string numbers
                    if (docId && typeof docId === 'string') {
                        docId = parseInt(docId, 10);
                    }
                    result = deleteDocument(docId);
                    break;
                case 'batch':
                    result = deleteBatch(params && params.batchId);
                    break;
                case 'clear':
                    result = clearCompleted(params);
                    break;
                case 'clearcache':
                    // Clear form layout cache
                    var cacheType = params && params.cacheType;
                    if (cacheType === 'formlayout') {
                        result = FormSchemaExtractor.clearAllCache();
                    } else {
                        result = Response.error('INVALID_CACHE_TYPE', 'Unknown cache type: ' + cacheType);
                    }
                    break;
                default:
                    result = Response.error('INVALID_ACTION', 'Unknown action: ' + action);
            }
        } catch (e) {
            log.error('DELETE Error', e);
            result = Response.error('DELETE_FAILED', e.message);
        }
        return JSON.stringify(result);
    }

    // ==================== GET Implementations ====================

    function getDocument(documentId) {
        if (!documentId) {
            return Response.error('MISSING_PARAM', 'Document ID is required');
        }

        var docRecord = record.load({
            type: 'customrecord_dm_captured_document',
            id: documentId
        });

        var lineItems = JSON.parse(docRecord.getValue('custrecord_dm_line_items') || '[]');
        var anomalies = JSON.parse(docRecord.getValue('custrecord_dm_anomalies') || '[]');
        var status = docRecord.getValue('custrecord_dm_status');

        var document = {
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

        if (document.sourceFile) {
            try {
                var fileObj = file.load({ id: document.sourceFile });
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
        var page = parseInt(context.page) || 1;
        var pageSize = Math.min(parseInt(context.pageSize) || 25, 100);
        var status = context.status;
        var docType = context.documentType;
        var dateFrom = context.dateFrom;
        var dateTo = context.dateTo;
        var vendorId = context.vendorId;
        var batchId = context.batchId;
        var sortBy = context.sortBy || 'created';
        var sortDir = context.sortDir === 'asc' ? 'ASC' : 'DESC';

        var sql = 'SELECT id, custrecord_dm_document_id as name, custrecord_dm_status as status, custrecord_dm_document_type as documentType, ' +
            'custrecord_dm_confidence_score as confidence, custrecord_dm_vendor as vendorId, ' +
            'BUILTIN.DF(custrecord_dm_vendor) as vendorName, custrecord_dm_invoice_number as invoiceNumber, ' +
            'custrecord_dm_total_amount as totalAmount, custrecord_dm_anomalies as anomalies, ' +
            'custrecord_dm_created_date as createdDate, custrecord_dm_uploaded_by as uploadedBy, ' +
            'BUILTIN.DF(custrecord_dm_uploaded_by) as uploadedByName, custrecord_dm_source as source ' +
            'FROM customrecord_dm_captured_document WHERE 1=1';

        var params = [];

        if (status) {
            sql += ' AND custrecord_dm_status = ?';
            params.push(status);
        }
        if (docType) {
            sql += ' AND custrecord_dm_document_type = ?';
            params.push(docType);
        }
        if (vendorId) {
            sql += ' AND custrecord_dm_vendor = ?';
            params.push(vendorId);
        }
        if (batchId) {
            sql += ' AND custrecord_dm_batch_id = ?';
            params.push(batchId);
        }
        if (dateFrom) {
            sql += " AND custrecord_dm_created_date >= TO_DATE(?, 'YYYY-MM-DD')";
            params.push(dateFrom);
        }
        if (dateTo) {
            sql += " AND custrecord_dm_created_date <= TO_DATE(?, 'YYYY-MM-DD')";
            params.push(dateTo);
        }

        var countSql = sql.replace(/SELECT[\s\S]*?FROM/, 'SELECT COUNT(*) as total FROM');
        var countResult = query.runSuiteQL({ query: countSql, params: params });
        var total = countResult.results.length > 0 ? countResult.results[0].values[0] : 0;

        var sortColumns = {
            'created': 'custrecord_dm_created_date',
            'confidence': 'custrecord_dm_confidence_score',
            'vendor': 'custrecord_dm_vendor',
            'status': 'custrecord_dm_status',
            'amount': 'custrecord_dm_total_amount'
        };
        var sortColumn = sortColumns[sortBy] || 'custrecord_dm_created_date';

        sql += ' ORDER BY ' + sortColumn + ' ' + sortDir;
        sql += ' OFFSET ' + ((page - 1) * pageSize) + ' ROWS FETCH NEXT ' + pageSize + ' ROWS ONLY';

        var results = query.runSuiteQL({ query: sql, params: params });

        var documents = results.results.map(function(row) {
            var v = row.values;
            var docAnomalies = v[9] ? JSON.parse(v[9]) : [];
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
                hasAnomalies: docAnomalies.length > 0,
                anomalyCount: docAnomalies.length,
                createdDate: v[10],
                uploadedBy: v[11],
                uploadedByName: v[12],
                source: v[13]
            };
        });

        return Response.paginated(documents, page, pageSize, total);
    }

    function getProcessingQueue(context) {
        var page = parseInt(context.page) || 1;
        var pageSize = Math.min(parseInt(context.pageSize) || 50, 100);

        try {
            // Use COALESCE to handle cases where custrecord_dm_original_filename might not exist
            var sql = 'SELECT id, custrecord_dm_document_id as name, custrecord_dm_status as status, custrecord_dm_document_type as documentType, ' +
                'custrecord_dm_confidence_score as confidence, BUILTIN.DF(custrecord_dm_vendor) as vendorName, ' +
                'custrecord_dm_invoice_number as invoiceNumber, custrecord_dm_total_amount as totalAmount, ' +
                'custrecord_dm_created_date as createdDate, custrecord_dm_batch_id as batchId, ' +
                'custrecord_dm_anomalies as anomalies, custrecord_dm_error_message as errorMessage FROM customrecord_dm_captured_document ' +
                'WHERE custrecord_dm_status IN (' + DocStatus.PENDING + ', ' + DocStatus.PROCESSING + ', ' +
                DocStatus.EXTRACTED + ', ' + DocStatus.NEEDS_REVIEW + ', ' + DocStatus.ERROR + ') ' +
                'ORDER BY CASE custrecord_dm_status WHEN ' + DocStatus.ERROR + ' THEN 0 ' +
                'WHEN ' + DocStatus.NEEDS_REVIEW + ' THEN 1 ' +
                'WHEN ' + DocStatus.EXTRACTED + ' THEN 2 WHEN ' + DocStatus.PROCESSING + ' THEN 3 ' +
                'WHEN ' + DocStatus.PENDING + ' THEN 4 END, custrecord_dm_created_date ASC ' +
                'OFFSET ' + ((page - 1) * pageSize) + ' ROWS FETCH NEXT ' + pageSize + ' ROWS ONLY';

            log.debug('getProcessingQueue', 'SQL: ' + sql);
            var results = query.runSuiteQL({ query: sql });
            log.debug('getProcessingQueue', 'Results count: ' + (results.results ? results.results.length : 0));

            var queue = results.results.map(function(row) {
                var v = row.values;
                var docAnomalies = v[10] ? JSON.parse(v[10]) : [];
                return {
                    id: v[0],
                    name: v[1] || ('Document ' + v[0]),
                    status: v[2],
                    documentType: v[3],
                    confidence: v[4],
                    vendorName: v[5],
                    invoiceNumber: v[6],
                    totalAmount: v[7],
                    createdDate: v[8],
                    batchId: v[9],
                    hasAnomalies: docAnomalies.length > 0,
                    errorMessage: v[11] || ''
                };
            });

            var countSql = 'SELECT custrecord_dm_status as status, COUNT(*) as count FROM customrecord_dm_captured_document ' +
                'WHERE custrecord_dm_status IN (' + DocStatus.PENDING + ', ' + DocStatus.PROCESSING + ', ' +
                DocStatus.EXTRACTED + ', ' + DocStatus.NEEDS_REVIEW + ', ' + DocStatus.ERROR + ') GROUP BY custrecord_dm_status';

            var countResults = query.runSuiteQL({ query: countSql });
            var statusCounts = {};
            countResults.results.forEach(function(row) {
                statusCounts[row.values[0]] = row.values[1];
            });

            var totalCount = 0;
            Object.keys(statusCounts).forEach(function(key) {
                totalCount += statusCounts[key];
            });

            return Response.success({
                queue: queue,
                counts: statusCounts,
                total: totalCount
            });
        } catch (e) {
            log.error('getProcessingQueue', { message: e.message, stack: e.stack });
            return Response.error('QUEUE_ERROR', 'Failed to fetch queue: ' + e.message);
        }
    }

    function getDashboardStats() {
        try {
            var statsSql = 'SELECT COUNT(*) as total, ' +
                'SUM(CASE WHEN custrecord_dm_status = ' + DocStatus.COMPLETED + ' THEN 1 ELSE 0 END) as completed, ' +
                'SUM(CASE WHEN custrecord_dm_status = ' + DocStatus.COMPLETED + ' AND custrecord_dm_confidence_score >= 85 THEN 1 ELSE 0 END) as autoProcessed, ' +
                'SUM(CASE WHEN custrecord_dm_status IN (' + DocStatus.PENDING + ', ' + DocStatus.PROCESSING + ', ' + DocStatus.EXTRACTED + ', ' + DocStatus.NEEDS_REVIEW + ') THEN 1 ELSE 0 END) as pending, ' +
                'SUM(CASE WHEN custrecord_dm_status = ' + DocStatus.REJECTED + ' THEN 1 ELSE 0 END) as rejected, ' +
                'SUM(CASE WHEN custrecord_dm_status = ' + DocStatus.ERROR + ' THEN 1 ELSE 0 END) as errors, ' +
                'AVG(custrecord_dm_confidence_score) as avgConfidence, ' +
                'SUM(custrecord_dm_total_amount) as totalValue ' +
                'FROM customrecord_dm_captured_document WHERE custrecord_dm_created_date >= ADD_MONTHS(SYSDATE, -1)';

            var statsResult = query.runSuiteQL({ query: statsSql });
            var stats = (statsResult.results && statsResult.results[0]) ? statsResult.results[0].values : [0,0,0,0,0,0,0,0];

            var typeSql = 'SELECT custrecord_dm_document_type as docType, COUNT(*) as count FROM customrecord_dm_captured_document ' +
                'WHERE custrecord_dm_created_date >= ADD_MONTHS(SYSDATE, -1) GROUP BY custrecord_dm_document_type';

            var typeResults = query.runSuiteQL({ query: typeSql });
            var typeBreakdown = {};
            if (typeResults.results) {
                typeResults.results.forEach(function(row) {
                    typeBreakdown[row.values[0] || 'Unknown'] = row.values[1];
                });
            }

            var trendSql = "SELECT TO_CHAR(custrecord_dm_created_date, 'YYYY-MM-DD') as day, COUNT(*) as count " +
                'FROM customrecord_dm_captured_document WHERE custrecord_dm_created_date >= SYSDATE - 7 ' +
                "GROUP BY TO_CHAR(custrecord_dm_created_date, 'YYYY-MM-DD') ORDER BY day";

            var trendResults = query.runSuiteQL({ query: trendSql });
            var trend = trendResults.results ? trendResults.results.map(function(row) {
                return { date: row.values[0], count: row.values[1] };
            }) : [];

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
        } catch (e) {
            log.error('getDashboardStats Error', { message: e.message, stack: e.stack });
            return Response.success({
                summary: { totalProcessed: 0, completed: 0, autoProcessed: 0, pendingReview: 0, rejected: 0, errors: 0, avgConfidence: 0, totalValue: 0 },
                typeBreakdown: {},
                trend: [],
                autoProcessRate: 0
            });
        }
    }

    function getRecentAnomalies(context) {
        try {
            var limit = Math.min(parseInt(context.limit) || 10, 50);

            var sql = 'SELECT * FROM (SELECT id, custrecord_dm_document_id as name, BUILTIN.DF(custrecord_dm_vendor) as vendorName, ' +
                'custrecord_dm_anomalies as anomalies, custrecord_dm_created_date as createdDate, ' +
                'custrecord_dm_confidence_score as confidence FROM customrecord_dm_captured_document ' +
                "WHERE custrecord_dm_anomalies IS NOT NULL AND custrecord_dm_anomalies != '[]' " +
                'AND custrecord_dm_status NOT IN (' + DocStatus.REJECTED + ', ' + DocStatus.COMPLETED + ') ' +
                'ORDER BY custrecord_dm_created_date DESC) WHERE ROWNUM <= ' + limit;

            var results = query.runSuiteQL({ query: sql });

            var anomalies = [];
            if (results.results) {
                results.results.forEach(function(row) {
                    try {
                        var docAnomalies = JSON.parse(row.values[3] || '[]');
                        docAnomalies.forEach(function(anomaly) {
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
                    } catch (parseErr) {
                        log.debug('Anomaly parse error', parseErr.message);
                    }
                });
            }

            var severityOrder = { high: 0, medium: 1, low: 2 };
            anomalies.sort(function(a, b) {
                return (severityOrder[a.severity] || 2) - (severityOrder[b.severity] || 2);
            });

            return Response.success(anomalies.slice(0, limit));
        } catch (e) {
            log.error('getRecentAnomalies Error', { message: e.message, stack: e.stack });
            return Response.success([]);
        }
    }

    function searchVendors(queryText) {
        if (!queryText || queryText.length < 2) {
            return Response.error('INVALID_QUERY', 'Search query must be at least 2 characters');
        }

        var sql = 'SELECT * FROM (SELECT id, companyname, entityid, email, phone, BUILTIN.DF(currency) as currency FROM vendor ' +
            "WHERE isinactive = 'F' AND (LOWER(companyname) LIKE LOWER(?) OR LOWER(entityid) LIKE LOWER(?)) " +
            'ORDER BY companyname) WHERE ROWNUM <= 20';

        var searchPattern = '%' + queryText + '%';
        var results = query.runSuiteQL({ query: sql, params: [searchPattern, searchPattern] });

        var vendors = results.results.map(function(row) {
            return {
                id: row.values[0],
                companyName: row.values[1],
                entityId: row.values[2],
                email: row.values[3],
                phone: row.values[4],
                currency: row.values[5]
            };
        });

        return Response.success(vendors);
    }

    /**
     * Get expense accounts for line item dropdowns
     * Returns accounts that can be used on vendor bills (expense type)
     */
    function getAccounts(context) {
        try {
            var accountType = context.accountType || 'Expense';
            var searchQuery = context.query || '';

            // Use N/search for more reliable account lookup
            var filters = [
                ['isinactive', 'is', 'F']
            ];

            // Filter by account type if specified
            if (accountType) {
                filters.push('AND');
                filters.push(['type', 'is', accountType]);
            }

            // Search filter
            if (searchQuery && searchQuery.length >= 2) {
                filters.push('AND');
                filters.push([
                    ['name', 'contains', searchQuery],
                    'OR',
                    ['number', 'contains', searchQuery]
                ]);
            }

            var accountSearch = search.create({
                type: search.Type.ACCOUNT,
                filters: filters,
                columns: [
                    search.createColumn({ name: 'internalid' }),
                    search.createColumn({ name: 'number', sort: search.Sort.ASC }),
                    search.createColumn({ name: 'name' }),
                    search.createColumn({ name: 'type' })
                ]
            });

            var accounts = [];
            var resultSet = accountSearch.run();
            var results = resultSet.getRange({ start: 0, end: 200 });

            results.forEach(function(result) {
                var number = result.getValue('number') || '';
                var name = result.getValue('name') || '';
                accounts.push({
                    value: result.getValue('internalid'),
                    text: number ? number + ' - ' + name : name,
                    number: number,
                    name: name,
                    type: result.getText('type')
                });
            });

            return Response.success(accounts);
        } catch (e) {
            log.error('getAccounts Error', e);
            return Response.error('ACCOUNTS_ERROR', e.message);
        }
    }

    /**
     * Get items for line item dropdowns
     * Returns inventory/non-inventory items for vendor bills
     */
    function getItems(context) {
        try {
            var searchQuery = context.query || '';
            var itemType = context.itemType; // Optional: inventoryitem, noninventoryitem, etc.

            // Use N/search for more reliable item lookup
            var filters = [
                ['isinactive', 'is', 'F']
            ];

            // Filter by item type if specified
            if (itemType) {
                filters.push('AND');
                filters.push(['type', 'is', itemType]);
            }

            // Search filter
            if (searchQuery && searchQuery.length >= 2) {
                filters.push('AND');
                filters.push([
                    ['itemid', 'contains', searchQuery],
                    'OR',
                    ['displayname', 'contains', searchQuery],
                    'OR',
                    ['description', 'contains', searchQuery]
                ]);
            }

            var itemSearch = search.create({
                type: search.Type.ITEM,
                filters: filters,
                columns: [
                    search.createColumn({ name: 'internalid' }),
                    search.createColumn({ name: 'itemid', sort: search.Sort.ASC }),
                    search.createColumn({ name: 'displayname' }),
                    search.createColumn({ name: 'description' }),
                    search.createColumn({ name: 'purchaseunit' }),
                    search.createColumn({ name: 'cost' }),
                    search.createColumn({ name: 'expenseaccount' })
                ]
            });

            var items = [];
            var resultSet = itemSearch.run();
            var results = resultSet.getRange({ start: 0, end: 200 });

            results.forEach(function(result) {
                var itemId = result.getValue('itemid') || '';
                var displayName = result.getValue('displayname') || '';
                var displayText = itemId;
                if (displayName) displayText += ' - ' + displayName;

                items.push({
                    value: result.getValue('internalid'),
                    text: displayText,
                    itemId: itemId,
                    displayName: displayName,
                    description: result.getValue('description'),
                    unit: result.getText('purchaseunit'),
                    cost: result.getValue('cost'),
                    expenseAccount: result.getText('expenseaccount')
                });
            });

            return Response.success(items);
        } catch (e) {
            log.error('getItems Error', e);
            return Response.error('ITEMS_ERROR', e.message);
        }
    }

    function searchPurchaseOrders(context) {
        var poNumber = context.poNumber;
        var vendorId = context.vendorId;

        var innerSql = 'SELECT id, tranid, BUILTIN.DF(entity) as vendorName, entity as vendorId, ' +
            'trandate, total, status, BUILTIN.DF(status) as statusText FROM transaction ' +
            "WHERE type = 'PurchOrd' AND status NOT IN ('Closed', 'Cancelled')";

        var params = [];

        if (poNumber) {
            innerSql += ' AND LOWER(tranid) LIKE LOWER(?)';
            params.push('%' + poNumber + '%');
        }
        if (vendorId) {
            innerSql += ' AND entity = ?';
            params.push(vendorId);
        }

        innerSql += ' ORDER BY trandate DESC';
        var sql = 'SELECT * FROM (' + innerSql + ') WHERE ROWNUM <= 20';

        var results = query.runSuiteQL({ query: sql, params: params });

        var purchaseOrders = results.results.map(function(row) {
            return {
                id: row.values[0],
                poNumber: row.values[1],
                vendorName: row.values[2],
                vendorId: row.values[3],
                date: row.values[4],
                total: row.values[5],
                status: row.values[6],
                statusText: row.values[7]
            };
        });

        return Response.success(purchaseOrders);
    }

    function getBatches(context) {
        var page = parseInt(context.page) || 1;
        var pageSize = Math.min(parseInt(context.pageSize) || 25, 100);
        var status = context.status;

        var sql = 'SELECT id, name, custrecord_dm_batch_status as status, ' +
            'custrecord_dm_batch_document_count as documentCount, custrecord_dm_batch_processed_count as processedCount, ' +
            'custrecord_dm_batch_error_count as errorCount, custrecord_dm_batch_created_date as createdDate, ' +
            'custrecord_dm_batch_completed_date as completedDate, BUILTIN.DF(custrecord_dm_batch_created_by) as createdBy, ' +
            'custrecord_dm_batch_total_value as totalValue FROM customrecord_dm_batch WHERE 1=1';

        var params = [];
        if (status) {
            sql += ' AND custrecord_dm_batch_status = ?';
            params.push(status);
        }

        sql += ' ORDER BY custrecord_dm_batch_created_date DESC';
        sql += ' OFFSET ' + ((page - 1) * pageSize) + ' ROWS FETCH NEXT ' + pageSize + ' ROWS ONLY';

        var results = query.runSuiteQL({ query: sql, params: params });

        var batches = results.results.map(function(row) {
            return {
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
            };
        });

        return Response.success(batches);
    }

    function getBatchDetails(batchId) {
        if (!batchId) {
            return Response.error('MISSING_PARAM', 'Batch ID is required');
        }

        var batchRecord = record.load({ type: 'customrecord_dm_batch', id: batchId });
        var status = batchRecord.getValue('custrecord_dm_batch_status');

        var batch = {
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

        var docSql = 'SELECT id, custrecord_dm_document_id as name, custrecord_dm_status as status, custrecord_dm_confidence_score as confidence, ' +
            'BUILTIN.DF(custrecord_dm_vendor) as vendorName, custrecord_dm_total_amount as amount ' +
            'FROM customrecord_dm_captured_document WHERE custrecord_dm_batch_id = ? ORDER BY id';

        var docResults = query.runSuiteQL({ query: docSql, params: [batchId] });
        batch.documents = docResults.results.map(function(row) {
            return {
                id: row.values[0],
                name: row.values[1],
                status: row.values[2],
                confidence: row.values[3],
                vendorName: row.values[4],
                amount: row.values[5]
            };
        });

        return Response.success(batch);
    }

    /**
     * Get form fields for a transaction type with multiple sublists and field grouping
     * Matches NetSuite's preferred form configuration for the account
     * @param {string} transactionType - Type: 'vendorbill', 'expensereport', etc.
     * @param {number} formId - Optional specific form ID
     * @returns {Object} Form field configuration with groups and sublists
     */
    function getTransactionFormFields(transactionType, formId) {
        if (!transactionType) {
            return Response.error('MISSING_PARAM', 'Transaction type is required');
        }

        try {
            var recordType;
            var sublists = [];
            var defaultBodyFields = [];
            var fieldGroups = [];

            // Map transaction types with multiple sublists
            switch (transactionType.toLowerCase()) {
                case 'vendorbill':
                case 'vendor_bill':
                case 'bill':
                    recordType = record.Type.VENDOR_BILL;
                    // Vendor bills have TWO sublists: expense (account-based) and item (item-based)
                    sublists = [
                        {
                            id: 'expense',
                            label: 'Expenses',
                            type: 'expense',
                            defaultFields: ['account', 'amount', 'memo', 'department', 'class', 'location', 'customer', 'taxcode', 'amortizationsched', 'amortizstartdate', 'amortizationenddate']
                        },
                        {
                            id: 'item',
                            label: 'Items',
                            type: 'item',
                            defaultFields: ['item', 'description', 'quantity', 'units', 'rate', 'amount', 'taxcode', 'department', 'class', 'location', 'customer']
                        }
                    ];
                    defaultBodyFields = ['entity', 'trandate', 'duedate', 'tranid', 'memo', 'currency', 'terms', 'approvalstatus', 'subsidiary', 'department', 'class', 'location', 'account'];
                    // Standard field groups for vendor bills
                    fieldGroups = [
                        { id: 'primary', label: 'Primary Information', fields: ['entity', 'trandate', 'duedate', 'postingperiod'] },
                        { id: 'classification', label: 'Classification', fields: ['subsidiary', 'department', 'class', 'location'] },
                        { id: 'reference', label: 'Reference', fields: ['tranid', 'memo', 'externalid'] },
                        { id: 'accounting', label: 'Accounting', fields: ['terms', 'account', 'currency', 'exchangerate'] },
                        { id: 'custom', label: 'Custom Fields', fields: [] } // Will be populated with custbody fields
                    ];
                    break;
                case 'expensereport':
                case 'expense_report':
                case 'expense':
                    recordType = record.Type.EXPENSE_REPORT;
                    sublists = [
                        {
                            id: 'expense',
                            label: 'Expenses',
                            type: 'expense',
                            defaultFields: ['category', 'expensedate', 'amount', 'memo', 'currency', 'exchangerate', 'taxcode', 'department', 'class', 'location', 'customer', 'receipt']
                        }
                    ];
                    defaultBodyFields = ['entity', 'trandate', 'memo', 'approvalstatus', 'advance', 'subsidiary', 'department', 'class', 'location', 'account'];
                    fieldGroups = [
                        { id: 'primary', label: 'Primary Information', fields: ['entity', 'trandate', 'postingperiod'] },
                        { id: 'classification', label: 'Classification', fields: ['subsidiary', 'department', 'class', 'location'] },
                        { id: 'accounting', label: 'Accounting', fields: ['account', 'advance'] },
                        { id: 'custom', label: 'Custom Fields', fields: [] }
                    ];
                    break;
                case 'vendorcredit':
                case 'vendor_credit':
                    recordType = record.Type.VENDOR_CREDIT;
                    sublists = [
                        {
                            id: 'expense',
                            label: 'Expenses',
                            type: 'expense',
                            defaultFields: ['account', 'amount', 'memo', 'department', 'class', 'location']
                        },
                        {
                            id: 'item',
                            label: 'Items',
                            type: 'item',
                            defaultFields: ['item', 'description', 'quantity', 'rate', 'amount', 'taxcode', 'department', 'class', 'location']
                        }
                    ];
                    defaultBodyFields = ['entity', 'trandate', 'tranid', 'memo', 'currency', 'subsidiary', 'department', 'class', 'location', 'account'];
                    fieldGroups = [
                        { id: 'primary', label: 'Primary Information', fields: ['entity', 'trandate', 'postingperiod'] },
                        { id: 'classification', label: 'Classification', fields: ['subsidiary', 'department', 'class', 'location'] },
                        { id: 'reference', label: 'Reference', fields: ['tranid', 'memo'] },
                        { id: 'accounting', label: 'Accounting', fields: ['account', 'currency', 'exchangerate'] },
                        { id: 'custom', label: 'Custom Fields', fields: [] }
                    ];
                    break;
                case 'purchaseorder':
                case 'purchase_order':
                case 'po':
                    recordType = record.Type.PURCHASE_ORDER;
                    sublists = [
                        {
                            id: 'expense',
                            label: 'Expenses',
                            type: 'expense',
                            defaultFields: ['account', 'amount', 'memo', 'department', 'class', 'location']
                        },
                        {
                            id: 'item',
                            label: 'Items',
                            type: 'item',
                            defaultFields: ['item', 'description', 'quantity', 'units', 'rate', 'amount', 'taxcode', 'department', 'class', 'location', 'expectedreceiptdate']
                        }
                    ];
                    defaultBodyFields = ['entity', 'trandate', 'duedate', 'tranid', 'memo', 'currency', 'terms', 'subsidiary', 'department', 'class', 'location'];
                    fieldGroups = [
                        { id: 'primary', label: 'Primary Information', fields: ['entity', 'trandate', 'duedate'] },
                        { id: 'classification', label: 'Classification', fields: ['subsidiary', 'department', 'class', 'location'] },
                        { id: 'reference', label: 'Reference', fields: ['tranid', 'memo'] },
                        { id: 'accounting', label: 'Accounting', fields: ['terms', 'currency', 'exchangerate'] },
                        { id: 'custom', label: 'Custom Fields', fields: [] }
                    ];
                    break;
                default:
                    return Response.error('INVALID_TYPE', 'Unsupported transaction type: ' + transactionType);
            }

            // Create a temporary record to inspect fields
            var tempRecord;
            try {
                var createOptions = { type: recordType, isDynamic: true };
                if (formId) {
                    createOptions.defaultValues = { customform: formId };
                }
                tempRecord = record.create(createOptions);
            } catch (e) {
                log.error('getTransactionFormFields', 'Failed to create temp record: ' + e.message);
                // Return default fields if we can't create record
                return Response.success({
                    transactionType: transactionType,
                    recordType: String(recordType),
                    formId: formId || 'default',
                    bodyFields: defaultBodyFields.map(function(f) {
                        return { id: f, label: f, type: 'text', mandatory: false };
                    }),
                    sublists: sublists.map(function(sl) {
                        return {
                            id: sl.id,
                            label: sl.label,
                            type: sl.type,
                            fields: sl.defaultFields.map(function(f) {
                                return { id: f, label: f, type: 'text' };
                            })
                        };
                    }),
                    fieldGroups: fieldGroups
                });
            }

            // Get actual form ID being used (this is the preferred form)
            var actualFormId;
            try {
                actualFormId = tempRecord.getValue('customform');
            } catch (e) { /* ignore */ }

            // Get all body fields from the form
            var bodyFieldIds = tempRecord.getFields();
            var bodyFields = [];
            var customBodyFields = [];

            // Fields we want to include (comprehensive list)
            var relevantBodyFields = ['entity', 'trandate', 'duedate', 'tranid', 'memo', 'currency',
                                      'terms', 'approvalstatus', 'subsidiary', 'department', 'class',
                                      'location', 'account', 'postingperiod', 'exchangerate', 'nexus',
                                      'total', 'usertotal', 'taxtotal', 'discountitem', 'discountrate',
                                      'custform', 'customform', 'createdfrom', 'billaddress', 'billaddresslist'];

            bodyFieldIds.forEach(function(fieldId) {
                var isCustom = fieldId.indexOf('custbody') === 0;
                if (!isCustom && relevantBodyFields.indexOf(fieldId) === -1) {
                    return; // Skip non-relevant standard fields
                }

                try {
                    var field = tempRecord.getField({ fieldId: fieldId });
                    if (field) {
                        // Check if field is visible/display type
                        var isHidden = field.isDisplay === false;

                        var fieldInfo = {
                            id: fieldId,
                            label: field.label || fieldId,
                            type: field.type || 'text',
                            mandatory: field.isMandatory || false,
                            isCustom: isCustom,
                            isHidden: isHidden,
                            help: field.help || ''
                        };

                        // Get select options if it's a select field
                        if (field.type === 'select' || field.type === 'multiselect') {
                            try {
                                var options = field.getSelectOptions({ filter: null });
                                if (options && options.length < 200) { // Don't return huge lists
                                    fieldInfo.options = options.map(function(opt) {
                                        return { value: opt.value, text: opt.text };
                                    });
                                } else if (options) {
                                    fieldInfo.hasOptions = true;
                                    fieldInfo.optionCount = options.length;
                                }
                            } catch (e) { /* ignore */ }
                        }

                        if (isCustom) {
                            customBodyFields.push(fieldInfo);
                        } else {
                            bodyFields.push(fieldInfo);
                        }
                    }
                } catch (e) {
                    // Field not accessible, skip
                }
            });

            // Add custom fields to the custom group
            var customGroup = fieldGroups.find(function(g) { return g.id === 'custom'; });
            if (customGroup) {
                customGroup.fields = customBodyFields.map(function(f) { return f.id; });
            }

            // Combine body fields
            var allBodyFields = bodyFields.concat(customBodyFields);

            // Get fields for each sublist
            var enhancedSublists = [];
            sublists.forEach(function(sublistConfig) {
                var sublistId = sublistConfig.id;
                var sublistFields = [];

                try {
                    // Get actual sublist fields from form
                    var sublistFieldIds = tempRecord.getSublistFields({ sublistId: sublistId });

                    // Important sublist fields we want to include
                    var importantLineFields = ['item', 'account', 'category', 'description', 'memo',
                                              'quantity', 'units', 'rate', 'amount', 'taxcode', 'tax1amt',
                                              'department', 'class', 'location', 'customer', 'isbillable',
                                              'amortizationsched', 'amortizstartdate', 'amortizationenddate',
                                              'expensedate', 'receipt', 'exchangerate', 'grossamt'];

                    sublistFieldIds.forEach(function(fieldId) {
                        var isCustom = fieldId.indexOf('custcol') === 0;
                        if (!isCustom && importantLineFields.indexOf(fieldId) === -1) {
                            return; // Skip non-important standard fields
                        }

                        try {
                            // Add a line to get field metadata
                            tempRecord.selectNewLine({ sublistId: sublistId });
                            var field = tempRecord.getSublistField({ sublistId: sublistId, fieldId: fieldId, line: 0 });

                            if (field) {
                                var fieldInfo = {
                                    id: fieldId,
                                    label: field.label || fieldId,
                                    type: field.type || 'text',
                                    mandatory: field.isMandatory || false,
                                    isCustom: isCustom
                                };

                                // Get select options for selects
                                if (field.type === 'select') {
                                    try {
                                        var options = field.getSelectOptions({ filter: null });
                                        if (options && options.length < 200) {
                                            fieldInfo.options = options.map(function(opt) {
                                                return { value: opt.value, text: opt.text };
                                            });
                                        } else if (options) {
                                            fieldInfo.hasOptions = true;
                                            fieldInfo.optionCount = options.length;
                                        }
                                    } catch (e) { /* ignore */ }
                                }

                                sublistFields.push(fieldInfo);
                            }
                        } catch (e) {
                            // Field not accessible at line level, try without line
                            try {
                                var fieldAlt = tempRecord.getSublistField({ sublistId: sublistId, fieldId: fieldId, line: -1 });
                                if (fieldAlt) {
                                    sublistFields.push({
                                        id: fieldId,
                                        label: fieldAlt.label || fieldId,
                                        type: fieldAlt.type || 'text',
                                        mandatory: fieldAlt.isMandatory || false,
                                        isCustom: isCustom
                                    });
                                }
                            } catch (e2) { /* ignore */ }
                        }
                    });

                    // Cancel the new line selection
                    try {
                        tempRecord.cancelLine({ sublistId: sublistId });
                    } catch (e) { /* ignore */ }

                } catch (e) {
                    log.debug('getTransactionFormFields', 'Could not get sublist fields for ' + sublistId + ': ' + e.message);
                    // Use defaults
                    sublistFields = sublistConfig.defaultFields.map(function(f) {
                        return { id: f, label: f, type: 'text' };
                    });
                }

                enhancedSublists.push({
                    id: sublistConfig.id,
                    label: sublistConfig.label,
                    type: sublistConfig.type,
                    fields: sublistFields.length > 0 ? sublistFields : sublistConfig.defaultFields.map(function(f) {
                        return { id: f, label: f, type: 'text' };
                    })
                });
            });

            return Response.success({
                transactionType: transactionType,
                recordType: String(recordType),
                formId: actualFormId || formId || 'default',
                formName: getFormName(actualFormId),
                bodyFields: allBodyFields,
                sublists: enhancedSublists,
                fieldGroups: fieldGroups,
                // For backwards compatibility
                lineFields: enhancedSublists.length > 0 ? enhancedSublists[0].fields : [],
                sublistId: enhancedSublists.length > 0 ? enhancedSublists[0].id : 'expense'
            });

        } catch (e) {
            log.error('getTransactionFormFields', e);
            return Response.error('FORM_FIELDS_ERROR', e.message);
        }
    }

    /**
     * Get form name by ID
     */
    function getFormName(formId) {
        if (!formId) return null;
        try {
            var formLookup = search.lookupFields({
                type: 'customrecord_suitescript_form', // This won't work - forms aren't searchable
                id: formId,
                columns: ['name']
            });
            return formLookup.name;
        } catch (e) {
            return 'Form #' + formId;
        }
    }

    /**
     * Get comprehensive form schema with tabs, groups, fields, and sublists
     * Uses N/cache for high-performance caching
     * @param {string} transactionType - The transaction type (vendorbill, expensereport, etc.)
     * @param {Object} context - Request context with options
     * @returns {Object} Complete form schema with layout
     */
    function getFormSchema(transactionType, context) {
        if (!transactionType) {
            return Response.error('MISSING_PARAM', 'Transaction type is required');
        }

        var options = {
            forceRefresh: context.refresh === 'true' || context.refresh === true,
            formId: context.formId || null
        };

        try {
            var result = FormSchemaExtractor.extractFormSchema(transactionType, options);

            if (!result.success) {
                return Response.error(result.error, result.message);
            }

            // Transform to response format
            var schema = result.data;
            return Response.success({
                formInfo: schema.formInfo,
                bodyFields: schema.bodyFields,
                sublists: schema.sublists,
                layout: schema.layout,
                config: schema.config,
                hiddenFields: schema.hiddenFields,
                _cached: schema._cached || false
            });
        } catch (e) {
            log.error('getFormSchema', e);
            return Response.error('FORM_SCHEMA_ERROR', e.message);
        }
    }

    /**
     * Update form schema configuration
     * @param {string} transactionType - The transaction type
     * @param {string} formId - The form ID
     * @param {Object} config - Configuration updates
     * @returns {Object} Updated configuration
     */
    function updateFormSchemaConfig(transactionType, formId, config) {
        if (!transactionType) {
            return Response.error('MISSING_PARAM', 'Transaction type is required');
        }

        try {
            var result = FormSchemaExtractor.updateConfig(transactionType, formId, config);
            if (!result.success) {
                return Response.error('CONFIG_UPDATE_ERROR', result.error);
            }
            return Response.success({ config: result.config });
        } catch (e) {
            log.error('updateFormSchemaConfig', e);
            return Response.error('CONFIG_UPDATE_ERROR', e.message);
        }
    }

    /**
     * Invalidate form schema cache
     * @param {string} transactionType - The transaction type to invalidate
     * @param {string} formId - Optional form ID
     * @returns {Object} Success/failure status
     */
    function invalidateFormSchemaCache(transactionType, formId) {
        if (!transactionType) {
            return Response.error('MISSING_PARAM', 'Transaction type is required');
        }

        try {
            var result = FormSchemaExtractor.invalidateCache(transactionType, formId);
            if (!result.success) {
                return Response.error('CACHE_INVALIDATE_ERROR', result.error);
            }
            return Response.success({ message: 'Cache invalidated for ' + transactionType });
        } catch (e) {
            log.error('invalidateFormSchemaCache', e);
            return Response.error('CACHE_INVALIDATE_ERROR', e.message);
        }
    }

    /**
     * Get cached form layout (client-extracted tabs/groups/visibility)
     * @param {string} transactionType - The transaction type
     * @param {string} formId - The form ID
     * @returns {Object} Layout if exists
     */
    function getFormLayout(transactionType, formId) {
        if (!transactionType) {
            return Response.error('MISSING_PARAM', 'Transaction type is required');
        }

        try {
            var layout = FormSchemaExtractor.getCachedLayout(transactionType, formId);
            if (layout) {
                return Response.success({ layout: layout, _cached: true });
            }
            return Response.success({ layout: null, message: 'No layout cached. Extract from NetSuite form.' });
        } catch (e) {
            log.error('getFormLayout', e);
            return Response.error('LAYOUT_ERROR', e.message);
        }
    }

    /**
     * Save form layout extracted from client-side DOM
     * @param {string} transactionType - The transaction type
     * @param {string} formId - The form ID
     * @param {Object} layout - The layout data (tabs, groups, fields, visibility)
     * @returns {Object} Success/failure status
     */
    function saveFormLayout(transactionType, formId, layout) {
        if (!transactionType) {
            return Response.error('MISSING_PARAM', 'Transaction type is required');
        }
        if (!layout) {
            return Response.error('MISSING_PARAM', 'Layout data is required');
        }

        try {
            var result = FormSchemaExtractor.saveFormLayout(transactionType, formId, layout);
            if (!result.success) {
                return Response.error('LAYOUT_SAVE_ERROR', result.error || result.message);
            }
            return Response.success({ message: 'Layout saved successfully' });
        } catch (e) {
            log.error('saveFormLayout', e);
            return Response.error('LAYOUT_SAVE_ERROR', e.message);
        }
    }

    function getSettings() {
        var settings = {
            autoApproveThreshold: 85,
            defaultDocumentType: 'auto',
            emailImportEnabled: true,
            emailAddress: 'flux-' + runtime.accountId + '@netsuite.com',
            duplicateDetection: true,
            amountValidation: true,
            maxFileSize: 10485760,
            supportedFileTypes: ['pdf', 'png', 'jpg', 'jpeg', 'tiff', 'tif', 'gif', 'bmp']
        };

        return Response.success(settings);
    }

    function getAnalytics(context) {
        var period = parseInt(context.period) || 30;

        var volumeSql = "SELECT TO_CHAR(custrecord_dm_created_date, 'YYYY-MM-DD') as day, COUNT(*) as total, " +
            'SUM(CASE WHEN custrecord_dm_status = ' + DocStatus.COMPLETED + ' THEN 1 ELSE 0 END) as completed, ' +
            'AVG(custrecord_dm_confidence_score) as avgConfidence FROM customrecord_dm_captured_document ' +
            'WHERE custrecord_dm_created_date >= SYSDATE - ' + period + ' ' +
            "GROUP BY TO_CHAR(custrecord_dm_created_date, 'YYYY-MM-DD') ORDER BY day";

        var volumeResults = query.runSuiteQL({ query: volumeSql });
        var volumeTrend = volumeResults.results.map(function(row) {
            return {
                date: row.values[0],
                total: row.values[1],
                completed: row.values[2],
                avgConfidence: Math.round(row.values[3] || 0)
            };
        });

        return Response.success({ period: period, volumeTrend: volumeTrend });
    }

    // ==================== POST Implementations ====================

    function uploadDocument(context) {
        var fileContent = context.fileContent;
        var fileName = context.fileName;
        var documentType = context.documentType || 'auto';
        var folderId = context.folderId;

        // Validate required fields
        if (!fileContent) {
            return Response.error('MISSING_PARAM', 'File content is required');
        }

        if (!fileName || typeof fileName !== 'string') {
            return Response.error('MISSING_PARAM', 'File name is required');
        }

        // Clean and validate filename
        fileName = String(fileName).trim();
        if (!fileName || fileName.length === 0) {
            return Response.error('INVALID_PARAM', 'File name cannot be empty');
        }

        // Sanitize filename - remove invalid characters for NetSuite
        fileName = fileName.replace(/[<>:"/\\|?*]/g, '_');

        // Ensure filename has an extension
        var fileExtension = fileName.split('.').pop().toLowerCase();
        var supportedTypes = ['pdf', 'png', 'jpg', 'jpeg', 'tiff', 'tif'];

        if (supportedTypes.indexOf(fileExtension) < 0) {
            return Response.error('INVALID_FILE_TYPE', 'File type .' + fileExtension + ' is not supported. Supported: ' + supportedTypes.join(', '));
        }

        log.audit('uploadDocument', 'Processing file: ' + fileName + ' (type: ' + documentType + ')');

        // Get or create upload folder
        if (!folderId) {
            folderId = getUploadFolder();
        }

        // Step 1: Create file in File Cabinet
        var fileId;
        try {
            var fileObj = file.create({
                name: fileName,
                fileType: getFileType(fileExtension),
                contents: fileContent,
                encoding: file.Encoding.BASE_64,
                folder: folderId,
                isOnline: true
            });
            fileId = fileObj.save();
            log.debug('uploadDocument', 'File saved with ID: ' + fileId);
        } catch (fileError) {
            log.error('uploadDocument.fileCreate', fileError);
            return Response.error('FILE_CREATE_FAILED', 'Failed to save file: ' + fileError.message);
        }

        // Step 2: Create document record
        var documentId;
        var docId;
        try {
            docId = generateDocumentId();

            log.audit('uploadDocument.createRecord', {
                fileName: fileName,
                docId: docId
            });

            var docRecord = record.create({ type: 'customrecord_dm_captured_document' });

            // Set custom fields (no Name field - record uses includename=F)
            docRecord.setValue({ fieldId: 'custrecord_dm_document_id', value: docId });
            docRecord.setValue({ fieldId: 'custrecord_dm_original_filename', value: fileName || '' });
            docRecord.setValue({ fieldId: 'custrecord_dm_status', value: DocStatus.PENDING });
            docRecord.setValue({ fieldId: 'custrecord_dm_source_file', value: fileId });
            docRecord.setValue({ fieldId: 'custrecord_dm_source', value: Source.UPLOAD });
            docRecord.setValue({ fieldId: 'custrecord_dm_uploaded_by', value: runtime.getCurrentUser().id });
            docRecord.setValue({ fieldId: 'custrecord_dm_created_date', value: new Date() });

            // Only set document type if not 'auto'
            if (documentType && documentType !== 'auto') {
                var docTypeValue = parseInt(documentType, 10);
                if (!isNaN(docTypeValue) && docTypeValue > 0) {
                    docRecord.setValue({ fieldId: 'custrecord_dm_document_type', value: docTypeValue });
                }
            }

            documentId = docRecord.save();
            log.debug('uploadDocument', 'Document record saved with ID: ' + documentId);
        } catch (recordError) {
            log.error('uploadDocument.recordCreate', recordError);
            // Try to clean up the file we just created
            try {
                file.delete({ id: fileId });
            } catch (e) { /* ignore cleanup errors */ }
            return Response.error('RECORD_CREATE_FAILED', 'Failed to create document record: ' + recordError.message);
        }

        // Step 3: Dispatch async processing task
        var taskId = null;
        if (context.autoProcess !== false) {
            try {
                var mrTask = task.create({
                    taskType: task.TaskType.MAP_REDUCE,
                    scriptId: SCRIPT_IDS.PROCESS_DOCUMENTS_MR,
                    deploymentId: SCRIPT_IDS.PROCESS_DOCUMENTS_DEPLOY
                });
                taskId = mrTask.submit();
                log.audit('uploadDocument.taskDispatched', {
                    taskId: taskId,
                    documentId: documentId
                });
            } catch (taskError) {
                log.error('uploadDocument.taskDispatch', taskError.message);
                // Don't fail the upload - task will be picked up on next scheduled run
            }
        }

        return Response.success({
            documentId: documentId,
            documentCode: docId,
            fileId: fileId,
            fileName: fileName,
            status: DocStatus.PENDING,
            taskId: taskId
        }, 'Document uploaded - processing queued');
    }

    function uploadBatch(context) {
        var files = context.files;
        var batchName = context.batchName || 'Batch-' + new Date().toISOString().slice(0,10);

        if (!files || !Array.isArray(files) || files.length === 0) {
            return Response.error('MISSING_PARAM', 'Files array is required');
        }

        var batchRecord = record.create({ type: 'customrecord_dm_batch' });
        batchRecord.setValue('name', batchName);
        batchRecord.setValue('custrecord_dm_batch_status', BatchStatus.PENDING);
        batchRecord.setValue('custrecord_dm_batch_document_count', files.length);
        batchRecord.setValue('custrecord_dm_batch_processed_count', 0);
        batchRecord.setValue('custrecord_dm_batch_created_date', new Date());
        batchRecord.setValue('custrecord_dm_batch_created_by', runtime.getCurrentUser().id);
        batchRecord.setValue('custrecord_dm_batch_source', Source.UPLOAD);

        var batchId = batchRecord.save();

        var uploadResults = [];
        var folderId = getUploadFolder();

        files.forEach(function(fileData, index) {
            try {
                var result = uploadDocument({
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

        record.submitFields({
            type: 'customrecord_dm_batch',
            id: batchId,
            values: { 'custrecord_dm_batch_status': BatchStatus.PROCESSING }
        });

        return Response.success({
            batchId: batchId,
            batchName: batchName,
            totalFiles: files.length,
            successCount: uploadResults.filter(function(r) { return r.success; }).length,
            failedCount: uploadResults.filter(function(r) { return !r.success; }).length,
            results: uploadResults
        }, 'Batch uploaded successfully');
    }

    function processDocument(documentId) {
        if (!documentId) {
            return Response.error('MISSING_PARAM', 'Document ID is required');
        }

        record.submitFields({
            type: 'customrecord_dm_captured_document',
            id: documentId,
            values: { 'custrecord_dm_status': DocStatus.PROCESSING }
        });

        try {
            var docRecord = record.load({
                type: 'customrecord_dm_captured_document',
                id: documentId
            });

            var fileId = docRecord.getValue('custrecord_dm_source_file');
            var documentType = docRecord.getValue('custrecord_dm_document_type');

            if (!fileId) {
                throw new Error('No file attached to document');
            }

            var EngineModule = getEngine();
            if (!EngineModule.FluxCaptureEngine) {
                throw new Error('Document processing engine not available');
            }
            var engine = new EngineModule.FluxCaptureEngine();
            var startTime = Date.now();

            var result = engine.processDocument(fileId, {
                documentType: documentType,
                enableFraudDetection: true,
                enableLearning: true
            });

            var processingTime = Date.now() - startTime;

            if (result.success) {
                var extraction = result.extraction;

                var newStatus = DocStatus.NEEDS_REVIEW;
                if (extraction.confidence.overall >= 85 && extraction.anomalies.length === 0) {
                    newStatus = DocStatus.EXTRACTED;
                }

                // Helper to parse dates from various formats
                function parseExtractedDate(dateVal) {
                    if (!dateVal) return null;
                    if (dateVal instanceof Date) return dateVal;

                    var dateStr = String(dateVal).trim();
                    if (!dateStr) return null;

                    // Try various date formats
                    var parsed = null;

                    // Try "Dec 15/2025" or "Dec 15, 2025" format
                    var monthMatch = dateStr.match(/^([A-Za-z]+)\s*(\d{1,2})[\/,\s]+(\d{4})$/);
                    if (monthMatch) {
                        var months = { jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11 };
                        var monthNum = months[monthMatch[1].toLowerCase().substring(0, 3)];
                        if (monthNum !== undefined) {
                            parsed = new Date(parseInt(monthMatch[3]), monthNum, parseInt(monthMatch[2]));
                        }
                    }

                    // Try MM/DD/YYYY or MM-DD-YYYY
                    if (!parsed) {
                        var slashMatch = dateStr.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})$/);
                        if (slashMatch) {
                            parsed = new Date(parseInt(slashMatch[3]), parseInt(slashMatch[1]) - 1, parseInt(slashMatch[2]));
                        }
                    }

                    // Try YYYY-MM-DD
                    if (!parsed) {
                        var isoMatch = dateStr.match(/^(\d{4})[\/\-](\d{1,2})[\/\-](\d{1,2})$/);
                        if (isoMatch) {
                            parsed = new Date(parseInt(isoMatch[1]), parseInt(isoMatch[2]) - 1, parseInt(isoMatch[3]));
                        }
                    }

                    // Fallback to native parsing
                    if (!parsed) {
                        parsed = new Date(dateStr);
                    }

                    // Validate the date
                    if (parsed && !isNaN(parsed.getTime())) {
                        return parsed;
                    }

                    log.warn('parseExtractedDate', 'Could not parse date: ' + dateStr);
                    return null;
                }

                // Build update values, skipping currency (requires internal ID lookup)
                var updateValues = {
                    'custrecord_dm_status': newStatus,
                    'custrecord_dm_document_type': extraction.documentType || documentType,
                    'custrecord_dm_vendor': extraction.vendorMatch && extraction.vendorMatch.vendorId ? extraction.vendorMatch.vendorId : null,
                    'custrecord_dm_vendor_match_confidence': extraction.vendorMatch ? extraction.vendorMatch.confidence : 0,
                    'custrecord_dm_invoice_number': extraction.fields && extraction.fields.invoiceNumber ? extraction.fields.invoiceNumber : '',
                    'custrecord_dm_invoice_date': parseExtractedDate(extraction.fields && extraction.fields.invoiceDate),
                    'custrecord_dm_due_date': parseExtractedDate(extraction.fields && extraction.fields.dueDate),
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

                // Only set currency if it's a numeric ID (not a code like "USD")
                if (extraction.fields && extraction.fields.currency) {
                    var currencyVal = extraction.fields.currency;
                    if (typeof currencyVal === 'number' || (typeof currencyVal === 'string' && /^\d+$/.test(currencyVal))) {
                        updateValues['custrecord_dm_currency'] = parseInt(currencyVal, 10);
                    }
                    // Skip text currency codes - would need lookup to convert
                }

                record.submitFields({
                    type: 'customrecord_dm_captured_document',
                    id: documentId,
                    values: updateValues
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
        var batchId = context.batchId;
        var documentIds = context.documentIds;

        var docsToProcess = [];

        if (batchId) {
            var sql = 'SELECT id FROM customrecord_dm_captured_document WHERE custrecord_dm_batch_id = ? AND custrecord_dm_status = ' + DocStatus.PENDING;
            var results = query.runSuiteQL({ query: sql, params: [batchId] });
            docsToProcess = results.results.map(function(r) { return r.values[0]; });
        } else if (documentIds && Array.isArray(documentIds)) {
            docsToProcess = documentIds;
        } else {
            return Response.error('MISSING_PARAM', 'Batch ID or document IDs required');
        }

        var processResults = [];
        var processed = 0;
        var errors = 0;

        docsToProcess.forEach(function(docId) {
            try {
                var result = processDocument(docId);
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
        var attachments = context.attachments;
        var emailSender = context.emailSender;
        var emailSubject = context.emailSubject;

        if (!attachments || attachments.length === 0) {
            return Response.error('NO_ATTACHMENTS', 'No attachments found');
        }

        var results = [];

        attachments.forEach(function(att) {
            try {
                var result = uploadDocument({
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
            importedCount: results.filter(function(r) { return r.success; }).length,
            failedCount: results.filter(function(r) { return !r.success; }).length,
            results: results
        });
    }

    function checkEmailInbox(context) {
        return Response.success({ message: 'Email check endpoint ready' });
    }

    function submitCorrection(context) {
        var documentId = context.documentId;
        var fieldName = context.fieldName;
        var originalValue = context.originalValue;
        var correctedValue = context.correctedValue;

        if (!documentId || !fieldName) {
            return Response.error('MISSING_PARAM', 'Document ID and field name required');
        }

        try {
            var docRecord = record.load({
                type: 'customrecord_dm_captured_document',
                id: documentId
            });

            var existingCorrections = JSON.parse(docRecord.getValue('custrecord_dm_user_corrections') || '[]');

            var correction = {
                field: fieldName,
                original: String(originalValue),
                corrected: String(correctedValue),
                date: new Date().toISOString(),
                user: runtime.getCurrentUser().id
            };

            var existingIndex = -1;
            for (var i = 0; i < existingCorrections.length; i++) {
                if (existingCorrections[i].field === fieldName) {
                    existingIndex = i;
                    break;
                }
            }

            if (existingIndex >= 0) {
                existingCorrections[existingIndex] = correction;
            } else {
                existingCorrections.push(correction);
            }

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
        var documentId = context.documentId;
        var updates = context.updates;

        if (!documentId || !updates) {
            return Response.error('MISSING_PARAM', 'Document ID and updates required');
        }

        try {
            var fieldMap = {
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

            var values = { 'custrecord_dm_modified_date': new Date() };

            Object.keys(updates).forEach(function(key) {
                if (fieldMap[key]) {
                    var value = updates[key];
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
        var documentId = context.documentId;
        var createTransaction = context.createTransaction !== false;
        var transactionType = context.transactionType;

        if (!documentId) {
            return Response.error('MISSING_PARAM', 'Document ID required');
        }

        try {
            var docRecord = record.load({
                type: 'customrecord_dm_captured_document',
                id: documentId
            });

            var vendorId = docRecord.getValue('custrecord_dm_vendor');
            var documentType = docRecord.getValue('custrecord_dm_document_type');

            var transactionId = null;
            var actualTransactionType = transactionType;

            if (createTransaction && vendorId) {
                if (!actualTransactionType) {
                    if (documentType === DocType.EXPENSE_REPORT) {
                        actualTransactionType = 'expensereport';
                    } else if (documentType === DocType.CREDIT_MEMO) {
                        actualTransactionType = 'vendorcredit';
                    } else {
                        actualTransactionType = 'vendorbill';
                    }
                }

                transactionId = createTransactionFromDocument(docRecord, actualTransactionType);
            }

            record.submitFields({
                type: 'customrecord_dm_captured_document',
                id: documentId,
                values: {
                    'custrecord_dm_status': DocStatus.COMPLETED,
                    'custrecord_dm_created_transaction': transactionId ? String(transactionId) : '',
                    'custrecord_dm_modified_date': new Date()
                }
            });

            var batchId = docRecord.getValue('custrecord_dm_batch_id');
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
        var documentId = context.documentId;
        var reason = context.reason || 'Rejected by user';

        if (!documentId) {
            return Response.error('MISSING_PARAM', 'Document ID required');
        }

        try {
            var docRecord = record.load({
                type: 'customrecord_dm_captured_document',
                id: documentId
            });

            var batchId = docRecord.getValue('custrecord_dm_batch_id');

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
        var documentId = context.documentId;
        var status = context.status;

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
        var documentId = context.documentId;
        var assigneeId = context.assigneeId;

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
        return Response.success({ message: 'Settings endpoint ready' });
    }

    // ==================== DELETE Implementations ====================

    function deleteDocument(documentId) {
        if (!documentId) {
            return Response.error('MISSING_PARAM', 'Document ID required');
        }

        try {
            var docRecord = record.load({
                type: 'customrecord_dm_captured_document',
                id: documentId
            });

            var fileId = docRecord.getValue('custrecord_dm_source_file');
            var batchId = docRecord.getValue('custrecord_dm_batch_id');

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
            var docSearch = search.create({
                type: 'customrecord_dm_captured_document',
                filters: [['custrecord_dm_batch_id', 'is', batchId]],
                columns: ['internalid', 'custrecord_dm_source_file']
            });

            var deletedDocs = 0;

            docSearch.run().each(function(result) {
                var fileId = result.getValue('custrecord_dm_source_file');

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
        var olderThanDays = parseInt(context.olderThanDays) || 30;

        try {
            var docSearch = search.create({
                type: 'customrecord_dm_captured_document',
                filters: [
                    ['custrecord_dm_status', 'anyof', [DocStatus.REJECTED, DocStatus.COMPLETED]],
                    'AND',
                    ['custrecord_dm_modified_date', 'before', 'daysago' + olderThanDays]
                ],
                columns: ['internalid']
            });

            var deletedCount = 0;

            docSearch.run().each(function(result) {
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
        var folderSearch = search.create({
            type: 'folder',
            filters: [['name', 'is', 'Flux Capture Uploads']],
            columns: ['internalid']
        });

        var results = folderSearch.run().getRange({ start: 0, end: 1 });

        if (results.length > 0) {
            return results[0].id;
        }

        var folderRecord = record.create({ type: 'folder' });
        folderRecord.setValue('name', 'Flux Capture Uploads');
        folderRecord.setValue('description', 'Documents uploaded via Flux Capture');
        return folderRecord.save();
    }

    function getFileType(extension) {
        var typeMap = {
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
        var timestamp = Date.now().toString(36);
        var random = Math.random().toString(36).substring(2, 8);
        return ('FC-' + timestamp + '-' + random).toUpperCase();
    }

    function updateBatchProgress(batchId) {
        var sql = 'SELECT COUNT(*) as total, ' +
            'SUM(CASE WHEN custrecord_dm_status IN (' + DocStatus.REJECTED + ', ' + DocStatus.COMPLETED + ') THEN 1 ELSE 0 END) as processed, ' +
            'SUM(CASE WHEN custrecord_dm_status = ' + DocStatus.ERROR + ' THEN 1 ELSE 0 END) as errors ' +
            'FROM customrecord_dm_captured_document WHERE custrecord_dm_batch_id = ?';

        var results = query.runSuiteQL({ query: sql, params: [batchId] });
        var total = results.results[0].values[0] || 0;
        var processed = results.results[0].values[1] || 0;
        var errors = results.results[0].values[2] || 0;

        var updates = {
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
        var vendorId = docRecord.getValue('custrecord_dm_vendor');
        var invoiceNumber = docRecord.getValue('custrecord_dm_invoice_number');
        var invoiceDate = docRecord.getValue('custrecord_dm_invoice_date');
        var dueDate = docRecord.getValue('custrecord_dm_due_date');
        var totalAmount = docRecord.getValue('custrecord_dm_total_amount');
        var currency = docRecord.getValue('custrecord_dm_currency');
        var lineItems = JSON.parse(docRecord.getValue('custrecord_dm_line_items') || '[]');

        var txnRecord;

        if (transactionType === 'vendorbill') {
            txnRecord = record.create({ type: record.Type.VENDOR_BILL, isDynamic: true });
            txnRecord.setValue('entity', vendorId);
            if (invoiceNumber) txnRecord.setValue('tranid', invoiceNumber);
            if (invoiceDate) txnRecord.setValue('trandate', invoiceDate);
            if (dueDate) txnRecord.setValue('duedate', dueDate);
            if (currency) txnRecord.setValue('currency', currency);

            lineItems.forEach(function(line) {
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
        } else if (transactionType === 'vendorcredit') {
            txnRecord = record.create({ type: record.Type.VENDOR_CREDIT, isDynamic: true });
            txnRecord.setValue('entity', vendorId);
            if (invoiceDate) txnRecord.setValue('trandate', invoiceDate);
            if (currency) txnRecord.setValue('currency', currency);

            lineItems.forEach(function(line) {
                txnRecord.selectNewLine({ sublistId: 'expense' });
                if (line.account) txnRecord.setCurrentSublistValue({ sublistId: 'expense', fieldId: 'account', value: line.account });
                txnRecord.setCurrentSublistValue({ sublistId: 'expense', fieldId: 'amount', value: line.amount || 0 });
                txnRecord.commitLine({ sublistId: 'expense' });
            });
        } else if (transactionType === 'expensereport') {
            txnRecord = record.create({ type: record.Type.EXPENSE_REPORT, isDynamic: true });
            txnRecord.setValue('entity', runtime.getCurrentUser().id);
            if (invoiceDate) txnRecord.setValue('trandate', invoiceDate);

            lineItems.forEach(function(line) {
                txnRecord.selectNewLine({ sublistId: 'expense' });
                if (invoiceDate) txnRecord.setCurrentSublistValue({ sublistId: 'expense', fieldId: 'expensedate', value: invoiceDate });
                if (line.category) txnRecord.setCurrentSublistValue({ sublistId: 'expense', fieldId: 'category', value: line.category });
                txnRecord.setCurrentSublistValue({ sublistId: 'expense', fieldId: 'amount', value: line.amount || 0 });
                txnRecord.commitLine({ sublistId: 'expense' });
            });
        }

        return txnRecord ? txnRecord.save() : null;
    }

    function getStatusDisplayText(status) {
        return DocStatusLabels[status] || status;
    }

    function getBatchStatusDisplayText(status) {
        return BatchStatusLabels[status] || status;
    }

    function getSourceDisplayText(source) {
        return SourceLabels[source] || source;
    }

    function getDocTypeDisplayText(docType) {
        return DocTypeLabels[docType] || docType;
    }

    return {
        get: get,
        post: post,
        put: put,
        'delete': _delete
    };
});
