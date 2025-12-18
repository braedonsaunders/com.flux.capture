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
    '/SuiteApps/com.flux.capture/lib/FC_Debug',
    '/SuiteApps/com.flux.capture/suitelet/FC_FormSchemaExtractor'
], function(file, record, search, query, runtime, errorModule, log, encode, email, format, task, FC_Engine, fcDebug, FormSchemaExtractor) {

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
                case 'datasource':
                    result = getDatasource(context);
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
                case 'vendorSuggestions':
                    result = getVendorSuggestions(context.vendorName);
                    break;
                case 'learningStats':
                    result = getLearningStats();
                    break;
                case 'suggestedAccount':
                    result = getSuggestedAccount(context.vendorId, context.description);
                    break;
                case 'scriptstatus':
                    result = getScriptDeploymentStatus(context.deploymentId);
                    break;
                case 'providerconfig':
                    result = getProviderConfig();
                    break;
                case 'providers':
                    result = getAvailableProviders();
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
                case 'process':
                    result = processDocument(context.documentId);
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
                case 'testprovider':
                    result = testProviderConnection(context.providerType, context.config);
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
                    // Save user-customized form config (from XML upload or manual)
                    result = saveUserFormConfig(context.transactionType, context.formId, context.config, context.source);
                    break;
                case 'invalidatecache':
                    result = invalidateFormSchemaCache(context.transactionType, context.formId);
                    break;
                case 'saveformlayout':
                    result = saveFormLayout(context.transactionType, context.formId, context.layout);
                    break;
                case 'scriptstatus':
                    result = updateScriptDeploymentStatus(context.deploymentId, context.enabled);
                    break;
                case 'providerconfig':
                    result = saveProviderConfig(context);
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

            fcDebug.debug('_delete', {
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
                case 'clear':
                    result = clearCompleted(params);
                    break;
                case 'clearcache':
                    // Clear form layout or datasource cache
                    var cacheType = params && params.cacheType;
                    if (cacheType === 'formlayout') {
                        // Clear form layouts and schemas (not user configs)
                        result = FormSchemaExtractor.clearAllCache();
                    } else if (cacheType === 'datasource') {
                        // Clear datasource configs
                        result = FormSchemaExtractor.clearConfigsByType('datasource_cache');
                    } else if (cacheType === 'all') {
                        // Clear everything except user configs
                        var layoutResult = FormSchemaExtractor.clearAllCache();
                        var dsResult = FormSchemaExtractor.clearConfigsByType('datasource_cache');
                        result = Response.success({
                            layoutsDeleted: layoutResult.deleted || 0,
                            datasourcesDeleted: dsResult.deleted || 0
                        });
                    } else {
                        result = Response.error('INVALID_CACHE_TYPE', 'Unknown cache type: ' + cacheType + '. Use: formlayout, datasource, or all');
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
            type: 'customrecord_flux_document',
            id: documentId
        });

        var lineItems = JSON.parse(docRecord.getValue('custrecord_flux_line_items') || '[]');
        var anomalies = JSON.parse(docRecord.getValue('custrecord_flux_anomalies') || '[]');
        var extractedData = JSON.parse(docRecord.getValue('custrecord_flux_extracted_data') || '{}');
        var formData = JSON.parse(docRecord.getValue('custrecord_flux_form_data') || 'null');
        var status = docRecord.getValue('custrecord_flux_status');

        var document = {
            id: documentId,
            name: docRecord.getValue('name'),
            status: status,
            statusText: getStatusDisplayText(status),
            documentType: docRecord.getValue('custrecord_flux_document_type'),
            documentTypeText: getDocTypeDisplayText(docRecord.getValue('custrecord_flux_document_type')),
            sourceFile: docRecord.getValue('custrecord_flux_source_file'),
            documentId: docRecord.getValue('custrecord_flux_document_id'),
            uploadedBy: docRecord.getValue('custrecord_flux_uploaded_by'),
            uploadedByName: docRecord.getText('custrecord_flux_uploaded_by'),
            createdDate: docRecord.getValue('custrecord_flux_created_date'),
            modifiedDate: docRecord.getValue('custrecord_flux_modified_date'),
            confidence: docRecord.getValue('custrecord_flux_confidence_score') || 0,
            vendor: docRecord.getValue('custrecord_flux_vendor'),
            vendorName: docRecord.getText('custrecord_flux_vendor'),
            vendorMatchConfidence: docRecord.getValue('custrecord_flux_vendor_match_confidence'),
            invoiceNumber: docRecord.getValue('custrecord_flux_invoice_number'),
            invoiceDate: docRecord.getValue('custrecord_flux_invoice_date'),
            dueDate: docRecord.getValue('custrecord_flux_due_date'),
            poNumber: docRecord.getValue('custrecord_flux_po_number'),
            subtotal: docRecord.getValue('custrecord_flux_subtotal'),
            taxAmount: docRecord.getValue('custrecord_flux_tax_amount'),
            totalAmount: docRecord.getValue('custrecord_flux_total_amount'),
            currency: docRecord.getValue('custrecord_flux_currency'),
            currencyText: docRecord.getText('custrecord_flux_currency'),
            paymentTerms: docRecord.getValue('custrecord_flux_payment_terms'),
            lineItems: lineItems,
            anomalies: anomalies,
            extractedData: extractedData,
            formData: formData,
            amountValidated: docRecord.getValue('custrecord_flux_amount_validated'),
            createdTransaction: docRecord.getValue('custrecord_flux_created_transaction'),
            source: docRecord.getValue('custrecord_flux_source'),
            sourceText: getSourceDisplayText(docRecord.getValue('custrecord_flux_source')),
            emailSender: docRecord.getValue('custrecord_flux_email_sender'),
            emailSubject: docRecord.getValue('custrecord_flux_email_subject'),
            rejectionReason: docRecord.getValue('custrecord_flux_rejection_reason'),
            errorMessage: docRecord.getValue('custrecord_flux_error_message'),
            processingTime: docRecord.getValue('custrecord_flux_processing_time')
        };

        if (document.sourceFile) {
            try {
                var fileObj = file.load({ id: document.sourceFile });
                document.fileUrl = fileObj.url;
                document.fileName = fileObj.name;
                document.fileSize = fileObj.size;
                document.fileType = fileObj.fileType;
            } catch (e) {
                fcDebug.debug('File load error', e.message);
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
        var ids = context.ids;
        var sortBy = context.sortBy || 'created';
        var sortDir = context.sortDir === 'asc' ? 'ASC' : 'DESC';

        var sql = 'SELECT id, custrecord_flux_document_id as name, custrecord_flux_status as status, custrecord_flux_document_type as documentType, ' +
            'custrecord_flux_confidence_score as confidence, custrecord_flux_vendor as vendorId, ' +
            'BUILTIN.DF(custrecord_flux_vendor) as vendorName, custrecord_flux_invoice_number as invoiceNumber, ' +
            'custrecord_flux_total_amount as totalAmount, custrecord_flux_anomalies as anomalies, ' +
            'custrecord_flux_created_date as createdDate, custrecord_flux_uploaded_by as uploadedBy, ' +
            'BUILTIN.DF(custrecord_flux_uploaded_by) as uploadedByName, custrecord_flux_source as source ' +
            'FROM customrecord_flux_document WHERE 1=1';

        var params = [];

        // Handle filtering by specific IDs (used by upload rail to check processing status)
        if (ids) {
            var idList = ids.split(',').map(function(id) { return id.trim(); }).filter(function(id) { return id; });
            if (idList.length > 0) {
                var placeholders = idList.map(function() { return '?'; }).join(',');
                sql += ' AND id IN (' + placeholders + ')';
                idList.forEach(function(id) { params.push(id); });
            }
        }

        if (status) {
            sql += ' AND custrecord_flux_status = ?';
            params.push(status);
        }
        if (docType) {
            sql += ' AND custrecord_flux_document_type = ?';
            params.push(docType);
        }
        if (vendorId) {
            sql += ' AND custrecord_flux_vendor = ?';
            params.push(vendorId);
        }
        if (dateFrom) {
            sql += " AND custrecord_flux_created_date >= TO_DATE(?, 'YYYY-MM-DD')";
            params.push(dateFrom);
        }
        if (dateTo) {
            sql += " AND custrecord_flux_created_date <= TO_DATE(?, 'YYYY-MM-DD')";
            params.push(dateTo);
        }

        var countSql = sql.replace(/SELECT[\s\S]*?FROM/, 'SELECT COUNT(*) as total FROM');
        var countResult = query.runSuiteQL({ query: countSql, params: params });
        var total = countResult.results.length > 0 ? countResult.results[0].values[0] : 0;

        var sortColumns = {
            'created': 'custrecord_flux_created_date',
            'confidence': 'custrecord_flux_confidence_score',
            'vendor': 'custrecord_flux_vendor',
            'status': 'custrecord_flux_status',
            'amount': 'custrecord_flux_total_amount'
        };
        var sortColumn = sortColumns[sortBy] || 'custrecord_flux_created_date';

        sql += ' ORDER BY ' + sortColumn + ' ' + sortDir;

        var results = query.runSuiteQL({ query: sql, params: params });

        // Manual pagination since SuiteQL doesn't support OFFSET/FETCH
        var startIndex = (page - 1) * pageSize;
        var endIndex = startIndex + pageSize;
        var paginatedResults = results.results.slice(startIndex, endIndex);

        var documents = paginatedResults.map(function(row) {
            var v = row.values;
            var docAnomalies = v[9] ? JSON.parse(v[9]) : [];
            // PERCENT fields return decimals (0.85 for 85%), convert to integer percentage
            var confidenceRaw = v[4];
            var confidence = confidenceRaw != null ? Math.round(confidenceRaw * 100) : 0;
            return {
                id: v[0],
                name: v[1],
                status: v[2],
                documentType: v[3],
                confidence: confidence,
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
        var sortBy = context.sortBy || 'created';
        var sortDir = (context.sortDir || 'desc').toUpperCase() === 'ASC' ? 'ASC' : 'DESC';

        // Map sort columns to database fields
        var sortColumns = {
            'created': 'custrecord_flux_created_date',
            'date': 'custrecord_flux_created_date',
            'confidence': 'custrecord_flux_confidence_score',
            'vendor': 'vendorName',
            'status': 'custrecord_flux_status',
            'amount': 'custrecord_flux_total_amount',
            'invoice': 'custrecord_flux_invoice_number'
        };
        var sortColumn = sortColumns[sortBy] || 'custrecord_flux_created_date';

        try {
            // Use COALESCE to handle cases where custrecord_flux_original_filename might not exist
            var sql = 'SELECT id, custrecord_flux_document_id as name, custrecord_flux_status as status, custrecord_flux_document_type as documentType, ' +
                'custrecord_flux_confidence_score as confidence, BUILTIN.DF(custrecord_flux_vendor) as vendorName, ' +
                'custrecord_flux_invoice_number as invoiceNumber, custrecord_flux_total_amount as totalAmount, ' +
                'custrecord_flux_created_date as createdDate, ' +
                'custrecord_flux_anomalies as anomalies, custrecord_flux_error_message as errorMessage FROM customrecord_flux_document ' +
                'WHERE custrecord_flux_status IN (' + DocStatus.PENDING + ', ' + DocStatus.PROCESSING + ', ' +
                DocStatus.EXTRACTED + ', ' + DocStatus.NEEDS_REVIEW + ', ' + DocStatus.ERROR + ') ' +
                'ORDER BY ' + sortColumn + ' ' + sortDir;

            fcDebug.debug('getProcessingQueue', 'SQL: ' + sql);
            var results = query.runSuiteQL({ query: sql });
            fcDebug.debug('getProcessingQueue', 'Results count: ' + (results.results ? results.results.length : 0));

            // Manual pagination since SuiteQL doesn't support OFFSET/FETCH
            var startIndex = (page - 1) * pageSize;
            var endIndex = startIndex + pageSize;
            var paginatedResults = results.results.slice(startIndex, endIndex);

            var queue = paginatedResults.map(function(row) {
                var v = row.values;
                var docAnomalies = v[9] ? JSON.parse(v[9]) : [];
                // PERCENT fields return decimals (0.85 for 85%), convert to integer percentage
                var confidenceRaw = v[4];
                var confidence = confidenceRaw != null ? Math.round(confidenceRaw * 100) : 0;
                return {
                    id: v[0],
                    name: v[1] || ('Document ' + v[0]),
                    status: v[2],
                    documentType: v[3],
                    confidence: confidence,
                    vendorName: v[5],
                    invoiceNumber: v[6],
                    totalAmount: v[7],
                    createdDate: v[8],
                    hasAnomalies: docAnomalies.length > 0,
                    errorMessage: v[10] || ''
                };
            });

            var countSql = 'SELECT custrecord_flux_status as status, COUNT(*) as count FROM customrecord_flux_document ' +
                'WHERE custrecord_flux_status IN (' + DocStatus.PENDING + ', ' + DocStatus.PROCESSING + ', ' +
                DocStatus.EXTRACTED + ', ' + DocStatus.NEEDS_REVIEW + ', ' + DocStatus.ERROR + ') GROUP BY custrecord_flux_status';

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
                'SUM(CASE WHEN custrecord_flux_status = ' + DocStatus.COMPLETED + ' THEN 1 ELSE 0 END) as completed, ' +
                'SUM(CASE WHEN custrecord_flux_status = ' + DocStatus.COMPLETED + ' AND custrecord_flux_confidence_score >= 0.85 THEN 1 ELSE 0 END) as autoProcessed, ' +
                'SUM(CASE WHEN custrecord_flux_status IN (' + DocStatus.PENDING + ', ' + DocStatus.PROCESSING + ', ' + DocStatus.EXTRACTED + ', ' + DocStatus.NEEDS_REVIEW + ') THEN 1 ELSE 0 END) as pending, ' +
                'SUM(CASE WHEN custrecord_flux_status = ' + DocStatus.REJECTED + ' THEN 1 ELSE 0 END) as rejected, ' +
                'SUM(CASE WHEN custrecord_flux_status = ' + DocStatus.ERROR + ' THEN 1 ELSE 0 END) as errors, ' +
                'AVG(custrecord_flux_confidence_score) as avgConfidence, ' +
                'SUM(custrecord_flux_total_amount) as totalValue ' +
                'FROM customrecord_flux_document WHERE custrecord_flux_created_date >= ADD_MONTHS(SYSDATE, -1)';

            var statsResult = query.runSuiteQL({ query: statsSql });
            var stats = (statsResult.results && statsResult.results[0]) ? statsResult.results[0].values : [0,0,0,0,0,0,0,0];

            var typeSql = 'SELECT custrecord_flux_document_type as docType, COUNT(*) as count FROM customrecord_flux_document ' +
                'WHERE custrecord_flux_created_date >= ADD_MONTHS(SYSDATE, -1) GROUP BY custrecord_flux_document_type';

            var typeResults = query.runSuiteQL({ query: typeSql });
            var typeBreakdown = {};
            if (typeResults.results) {
                typeResults.results.forEach(function(row) {
                    typeBreakdown[row.values[0] || 'Unknown'] = row.values[1];
                });
            }

            var trendSql = "SELECT TO_CHAR(custrecord_flux_created_date, 'YYYY-MM-DD') as day, COUNT(*) as count " +
                'FROM customrecord_flux_document WHERE custrecord_flux_created_date >= SYSDATE - 7 ' +
                "GROUP BY TO_CHAR(custrecord_flux_created_date, 'YYYY-MM-DD') ORDER BY day";

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
                    avgConfidence: Math.round((stats[6] || 0) * 100),
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

            var sql = 'SELECT * FROM (SELECT id, custrecord_flux_document_id as name, BUILTIN.DF(custrecord_flux_vendor) as vendorName, ' +
                'custrecord_flux_anomalies as anomalies, custrecord_flux_created_date as createdDate, ' +
                'custrecord_flux_confidence_score as confidence FROM customrecord_flux_document ' +
                "WHERE custrecord_flux_anomalies IS NOT NULL AND custrecord_flux_anomalies != '[]' " +
                'AND custrecord_flux_status NOT IN (' + DocStatus.REJECTED + ', ' + DocStatus.COMPLETED + ') ' +
                'ORDER BY custrecord_flux_created_date DESC) WHERE ROWNUM <= ' + limit;

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
                                confidence: row.values[5] != null ? Math.round(row.values[5] * 100) : 0
                            });
                        });
                    } catch (parseErr) {
                        fcDebug.debug('Anomaly parse error', parseErr.message);
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
     * Get accounting periods for posting period dropdown
     * Defaults to current open period
     */
    function getAccountingPeriods(context) {
        try {
            var searchQuery = context.query || '';
            var includeDefault = context.includeDefault !== false;

            var filters = [
                ['isinactive', 'is', 'F'],
                'AND',
                ['isquarter', 'is', 'F'],
                'AND',
                ['isyear', 'is', 'F']
            ];

            if (searchQuery && searchQuery.length >= 1) {
                filters.push('AND');
                filters.push(['periodname', 'contains', searchQuery]);
            }

            var periodSearch = search.create({
                type: search.Type.ACCOUNTING_PERIOD,
                filters: filters,
                columns: [
                    search.createColumn({ name: 'internalid' }),
                    search.createColumn({ name: 'periodname', sort: search.Sort.DESC }),
                    search.createColumn({ name: 'startdate' }),
                    search.createColumn({ name: 'enddate' }),
                    search.createColumn({ name: 'closed' }),
                    search.createColumn({ name: 'aplocked' })
                ]
            });

            var periods = [];
            var currentPeriod = null;
            var today = new Date();

            var results = periodSearch.run().getRange({ start: 0, end: 100 });
            results.forEach(function(result) {
                var startDate = result.getValue('startdate');
                var endDate = result.getValue('enddate');
                var isClosed = result.getValue('closed') === 'T';
                var isApLocked = result.getValue('aplocked') === 'T';
                var periodName = result.getValue('periodname');
                var periodId = result.getValue('internalid');

                // Parse dates for comparison
                var start = startDate ? new Date(startDate) : null;
                var end = endDate ? new Date(endDate) : null;

                // Determine if this is the current period
                var isCurrent = start && end && today >= start && today <= end;
                if (isCurrent && !isClosed && !isApLocked && !currentPeriod) {
                    currentPeriod = {
                        value: periodId,
                        text: periodName
                    };
                }

                periods.push({
                    value: periodId,
                    text: periodName,
                    startDate: startDate,
                    endDate: endDate,
                    isClosed: isClosed,
                    isApLocked: isApLocked,
                    isCurrent: isCurrent
                });
            });

            // Return options with currentPeriod for smart defaults
            return Response.success({
                options: periods,
                currentPeriod: currentPeriod
            });
        } catch (e) {
            log.error('getAccountingPeriods Error', e);
            return Response.error('PERIODS_ERROR', e.message);
        }
    }

    /**
     * Get subsidiaries for dropdown
     * Returns defaultValue if only one subsidiary exists
     */
    function getSubsidiaries(context) {
        try {
            var searchQuery = context.query || '';

            var filters = [['isinactive', 'is', 'F']];
            if (searchQuery && searchQuery.length >= 1) {
                filters.push('AND');
                filters.push(['name', 'contains', searchQuery]);
            }

            var subSearch = search.create({
                type: search.Type.SUBSIDIARY,
                filters: filters,
                columns: [
                    search.createColumn({ name: 'internalid' }),
                    search.createColumn({ name: 'name', sort: search.Sort.ASC })
                ]
            });

            var subsidiaries = [];
            var results = subSearch.run().getRange({ start: 0, end: 100 });

            results.forEach(function(result) {
                subsidiaries.push({
                    value: result.getValue('internalid'),
                    text: result.getValue('name')
                });
            });

            // If only one subsidiary, set it as default
            var defaultValue = subsidiaries.length === 1 ? subsidiaries[0].value : null;

            return Response.success({
                options: subsidiaries,
                defaultValue: defaultValue
            });
        } catch (e) {
            log.error('getSubsidiaries Error', e);
            return Response.error('SUBSIDIARY_ERROR', e.message);
        }
    }

    /**
     * Get approval statuses for approval status dropdown
     */
    function getApprovalStatuses() {
        try {
            // Standard NetSuite approval statuses for vendor bills
            var statuses = [
                { value: '1', text: 'Pending Approval' },
                { value: '2', text: 'Approved' }
            ];

            return Response.success(statuses);
        } catch (e) {
            log.error('getApprovalStatuses Error', e);
            return Response.error('STATUS_ERROR', e.message);
        }
    }

    /**
     * Get expense accounts for line item dropdowns
     * Returns accounts that can be used on vendor bills (expense type)
     */
    function getAccounts(context) {
        try {
            var accountType = context.accountType;
            var searchQuery = context.query || '';

            // Use N/search for more reliable account lookup
            var filters = [
                ['isinactive', 'is', 'F']
            ];

            // Filter by account type if specified (skip if 'all' or not provided for full list)
            if (accountType && accountType !== 'all') {
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

    /**
     * Get datasource options for select fields
     * Supports departments, classes, locations, taxcodes, subsidiaries, currencies, terms, etc.
     */
    function getDatasource(context) {
        try {
            var dsType = context.type || context.datasource;
            var searchQuery = context.query || '';
            var limit = Math.min(parseInt(context.limit) || 200, 1000);

            if (!dsType) {
                return Response.error('MISSING_PARAM', 'Datasource type is required');
            }

            var searchType;
            var columns = [];
            var filters = [['isinactive', 'is', 'F']];
            var displayFormat = 'name'; // 'name', 'number-name', 'id-name'

            switch (dsType.toLowerCase()) {
                case 'departments':
                case 'department':
                    searchType = search.Type.DEPARTMENT;
                    columns = ['internalid', 'name'];
                    break;
                case 'classes':
                case 'class':
                    searchType = search.Type.CLASSIFICATION;
                    columns = ['internalid', 'name'];
                    break;
                case 'locations':
                case 'location':
                    searchType = search.Type.LOCATION;
                    columns = ['internalid', 'name'];
                    break;
                case 'subsidiaries':
                case 'subsidiary':
                    return getSubsidiaries(context);
                case 'currencies':
                case 'currency':
                    searchType = search.Type.CURRENCY;
                    columns = ['internalid', 'name', 'symbol'];
                    break;
                case 'terms':
                    searchType = search.Type.TERM;
                    columns = ['internalid', 'name'];
                    break;
                case 'taxcodes':
                case 'taxcode':
                    searchType = 'salestaxitem';
                    columns = ['internalid', 'itemid', 'rate'];
                    displayFormat = 'id-name';
                    break;
                case 'expensecategories':
                case 'expensecategory':
                case 'category':
                    searchType = 'expensecategory';
                    columns = ['internalid', 'name'];
                    break;
                case 'customers':
                case 'customer':
                    searchType = search.Type.CUSTOMER;
                    columns = ['internalid', 'entityid', 'companyname'];
                    displayFormat = 'id-name';
                    break;
                case 'employees':
                case 'employee':
                    searchType = search.Type.EMPLOYEE;
                    columns = ['internalid', 'entityid', 'firstname', 'lastname'];
                    displayFormat = 'employee-name'; // Special format for employees
                    break;
                case 'vendors':
                case 'vendor':
                    searchType = search.Type.VENDOR;
                    columns = ['internalid', 'entityid', 'companyname'];
                    displayFormat = 'id-name';
                    break;
                case 'projects':
                case 'project':
                case 'jobs':
                case 'job':
                    searchType = search.Type.JOB;
                    columns = ['internalid', 'entityid', 'companyname', 'customer'];
                    displayFormat = 'id-name';
                    break;
                case 'accountingperiods':
                case 'accountingperiod':
                case 'postingperiod':
                    return getAccountingPeriods(context);
                case 'approvalstatuses':
                case 'approvalstatus':
                    return getApprovalStatuses();
                case 'accounts':
                case 'account':
                    return getAccounts(context);
                case 'items':
                case 'item':
                    return getItems(context);
                default:
                    return Response.error('INVALID_DATASOURCE', 'Unknown datasource type: ' + dsType);
            }

            // Add search filter if query provided
            if (searchQuery && searchQuery.length >= 1) {
                var searchCol = columns[1] || 'name';
                filters.push('AND');
                filters.push([searchCol, 'contains', searchQuery]);
            }

            var dsSearch = search.create({
                type: searchType,
                filters: filters,
                columns: columns.map(function(col) {
                    // Only add sort for primary display column
                    if (col === 'name' || col === 'entityid') {
                        return search.createColumn({ name: col, sort: search.Sort.ASC });
                    }
                    return search.createColumn({ name: col });
                })
            });

            var options = [];
            var resultSet = dsSearch.run();
            var results = resultSet.getRange({ start: 0, end: limit });

            results.forEach(function(result) {
                var value = result.getValue(columns[0]);
                var text = '';

                if (displayFormat === 'name') {
                    text = result.getValue(columns[1]) || '';
                } else if (displayFormat === 'number-name') {
                    var num = result.getValue(columns[1]) || '';
                    var name = result.getValue(columns[2]) || '';
                    text = num ? num + ' - ' + name : name;
                } else if (displayFormat === 'employee-name') {
                    // Employee: just show "Firstname Lastname"
                    var firstName = result.getValue(columns[2]) || '';
                    var lastName = result.getValue(columns[3]) || '';
                    text = (firstName + ' ' + lastName).trim();
                } else if (displayFormat === 'id-name') {
                    var id = result.getValue(columns[1]) || '';
                    var nm = result.getValue(columns[2]) || '';
                    if (columns.length > 3) {
                        nm = (result.getValue(columns[2]) || '') + ' ' + (result.getValue(columns[3]) || '');
                    }
                    text = id ? id + ' - ' + nm.trim() : nm.trim();
                }

                options.push({
                    value: value,
                    text: text || value
                });
            });

            return Response.success(options);
        } catch (e) {
            log.error('getDatasource Error', e);
            return Response.error('DATASOURCE_ERROR', e.message);
        }
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
                    fcDebug.debug('getTransactionFormFields', 'Could not get sublist fields for ' + sublistId + ': ' + e.message);
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
                tabs: schema.tabs,  // Include tabs from user config (XML upload)
                layout: schema.layout,
                config: schema.config,
                hiddenFields: schema.hiddenFields,
                capturedAt: schema.capturedAt,
                savedAt: schema.savedAt,
                source: schema.source,
                _cached: schema._cached || false
            });
        } catch (e) {
            log.error('getFormSchema', e);
            return Response.error('FORM_SCHEMA_ERROR', e.message);
        }
    }

    /**
     * Save user-customized form configuration
     * Used when user uploads XML or manually configures form layout
     * @param {string} transactionType - The transaction type (vendorbill, expensereport)
     * @param {string} formId - The form ID (optional)
     * @param {Object} config - The form configuration (tabs, fields, sublists)
     * @param {string} source - Source type: 'xml_upload' or 'manual'
     * @returns {Object} Success/failure with config ID
     */
    function saveUserFormConfig(transactionType, formId, config, source) {
        if (!transactionType) {
            return Response.error('MISSING_PARAM', 'Transaction type is required');
        }
        if (!config) {
            return Response.error('MISSING_PARAM', 'Config is required');
        }

        try {
            var result = FormSchemaExtractor.saveUserConfig(transactionType, formId, config, source);
            if (!result.success) {
                return Response.error('CONFIG_SAVE_ERROR', result.error);
            }
            return Response.success({
                message: 'Form configuration saved',
                id: result.id,
                source: result.source
            });
        } catch (e) {
            log.error('saveUserFormConfig', e);
            return Response.error('CONFIG_SAVE_ERROR', e.message);
        }
    }

    /**
     * Update form schema configuration options (not full replacement)
     * @param {string} transactionType - The transaction type
     * @param {string} formId - The form ID
     * @param {Object} config - Configuration updates to merge
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

    /**
     * Get script deployment status (enabled/disabled)
     * @param {string} deploymentId - The deployment script ID (e.g., 'customdeploy_fc_formlayout_vendorbill')
     * @returns {Object} { enabled: boolean, deploymentId: string }
     */
    function getScriptDeploymentStatus(deploymentId) {
        if (!deploymentId) {
            return Response.error('MISSING_PARAM', 'Deployment ID is required');
        }

        try {
            // Search for script deployment by deployment scriptid
            var deploymentSearch = search.create({
                type: search.Type.SCRIPT_DEPLOYMENT,
                filters: [
                    ['scriptid', 'is', deploymentId]
                ],
                columns: [
                    search.createColumn({ name: 'internalid' }),
                    search.createColumn({ name: 'scriptid' }),
                    search.createColumn({ name: 'status' }),
                    search.createColumn({ name: 'isdeployed' })
                ]
            });

            var deploymentResult = deploymentSearch.run().getRange({ start: 0, end: 1 });

            if (!deploymentResult || deploymentResult.length === 0) {
                return Response.success({
                    enabled: false,
                    found: false,
                    message: 'Script deployment not found: ' + deploymentId
                });
            }

            var deployment = deploymentResult[0];
            var isDeployed = deployment.getValue('isdeployed');

            // Use isdeployed field directly for client scripts
            var enabled = isDeployed === true || isDeployed === 'T';

            return Response.success({
                enabled: enabled,
                found: true,
                internalId: deployment.getValue('internalid'),
                deploymentId: deployment.getValue('scriptid'),
                isDeployed: isDeployed
            });
        } catch (e) {
            log.error('getScriptDeploymentStatus', e);
            return Response.error('SCRIPT_STATUS_ERROR', e.message);
        }
    }

    /**
     * Update script deployment status (enable/disable)
     * @param {string} deploymentId - The deployment script ID (e.g., 'customdeploy_fc_formlayout_vendorbill')
     * @param {boolean} enabled - Whether to enable or disable
     * @returns {Object} Success/failure status
     */
    function updateScriptDeploymentStatus(deploymentId, enabled) {
        if (!deploymentId) {
            return Response.error('MISSING_PARAM', 'Deployment ID is required');
        }

        try {
            // Find the deployment by scriptid
            var deploymentSearch = search.create({
                type: search.Type.SCRIPT_DEPLOYMENT,
                filters: [
                    ['scriptid', 'is', deploymentId]
                ],
                columns: [
                    search.createColumn({ name: 'internalid' })
                ]
            });

            var deploymentResult = deploymentSearch.run().getRange({ start: 0, end: 1 });

            if (!deploymentResult || deploymentResult.length === 0) {
                return Response.error('DEPLOYMENT_NOT_FOUND', 'Script deployment not found: ' + deploymentId);
            }

            var internalId = deploymentResult[0].getValue('internalid');

            // Update the deployment status
            var deploymentRec = record.load({
                type: record.Type.SCRIPT_DEPLOYMENT,
                id: internalId
            });

            // Set isdeployed field directly (client scripts don't use status values)
            deploymentRec.setValue({
                fieldId: 'isdeployed',
                value: enabled
            });

            deploymentRec.save();

            log.audit('updateScriptDeploymentStatus', 'Deployment ' + deploymentId + ' ' + (enabled ? 'enabled' : 'disabled'));

            return Response.success({
                enabled: enabled,
                message: 'Script deployment ' + (enabled ? 'enabled' : 'disabled') + ' successfully'
            });
        } catch (e) {
            log.error('updateScriptDeploymentStatus', e);
            return Response.error('SCRIPT_UPDATE_ERROR', e.message);
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

        var volumeSql = "SELECT TO_CHAR(custrecord_flux_created_date, 'YYYY-MM-DD') as day, COUNT(*) as total, " +
            'SUM(CASE WHEN custrecord_flux_status = ' + DocStatus.COMPLETED + ' THEN 1 ELSE 0 END) as completed, ' +
            'AVG(custrecord_flux_confidence_score) as avgConfidence FROM customrecord_flux_document ' +
            'WHERE custrecord_flux_created_date >= SYSDATE - ' + period + ' ' +
            "GROUP BY TO_CHAR(custrecord_flux_created_date, 'YYYY-MM-DD') ORDER BY day";

        var volumeResults = query.runSuiteQL({ query: volumeSql });
        var volumeTrend = volumeResults.results.map(function(row) {
            return {
                date: row.values[0],
                total: row.values[1],
                completed: row.values[2],
                avgConfidence: Math.round((row.values[3] || 0) * 100)
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
            fcDebug.debug('uploadDocument', 'File saved with ID: ' + fileId);
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

            var docRecord = record.create({ type: 'customrecord_flux_document' });

            // Set custom fields (no Name field - record uses includename=F)
            docRecord.setValue({ fieldId: 'custrecord_flux_document_id', value: docId });
            docRecord.setValue({ fieldId: 'custrecord_flux_original_filename', value: fileName || '' });
            docRecord.setValue({ fieldId: 'custrecord_flux_status', value: DocStatus.PENDING });
            docRecord.setValue({ fieldId: 'custrecord_flux_source_file', value: fileId });
            docRecord.setValue({ fieldId: 'custrecord_flux_source', value: Source.UPLOAD });
            docRecord.setValue({ fieldId: 'custrecord_flux_uploaded_by', value: runtime.getCurrentUser().id });
            docRecord.setValue({ fieldId: 'custrecord_flux_created_date', value: new Date() });

            // Only set document type if not 'auto'
            if (documentType && documentType !== 'auto') {
                var docTypeValue = parseInt(documentType, 10);
                if (!isNaN(docTypeValue) && docTypeValue > 0) {
                    docRecord.setValue({ fieldId: 'custrecord_flux_document_type', value: docTypeValue });
                }
            }

            documentId = docRecord.save();
            fcDebug.debug('uploadDocument', 'Document record saved with ID: ' + documentId);
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

    function processDocument(documentId) {
        if (!documentId) {
            return Response.error('MISSING_PARAM', 'Document ID is required');
        }

        record.submitFields({
            type: 'customrecord_flux_document',
            id: documentId,
            values: { 'custrecord_flux_status': DocStatus.PROCESSING }
        });

        try {
            var docRecord = record.load({
                type: 'customrecord_flux_document',
                id: documentId
            });

            var fileId = docRecord.getValue('custrecord_flux_source_file');
            var documentType = docRecord.getValue('custrecord_flux_document_type');

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
                    'custrecord_flux_status': newStatus,
                    'custrecord_flux_document_type': extraction.documentType || documentType,
                    'custrecord_flux_vendor': extraction.vendorMatch && extraction.vendorMatch.vendorId ? extraction.vendorMatch.vendorId : null,
                    'custrecord_flux_vendor_match_confidence': extraction.vendorMatch ? extraction.vendorMatch.confidence : 0,
                    'custrecord_flux_invoice_number': extraction.fields && extraction.fields.invoiceNumber ? extraction.fields.invoiceNumber : '',
                    'custrecord_flux_invoice_date': parseExtractedDate(extraction.fields && extraction.fields.invoiceDate),
                    'custrecord_flux_due_date': parseExtractedDate(extraction.fields && extraction.fields.dueDate),
                    'custrecord_flux_subtotal': extraction.fields && extraction.fields.subtotal ? extraction.fields.subtotal : 0,
                    'custrecord_flux_tax_amount': extraction.fields && extraction.fields.taxAmount ? extraction.fields.taxAmount : 0,
                    'custrecord_flux_total_amount': extraction.fields && extraction.fields.totalAmount ? extraction.fields.totalAmount : 0,
                    'custrecord_flux_po_number': extraction.fields && extraction.fields.poNumber ? extraction.fields.poNumber : '',
                    'custrecord_flux_payment_terms': extraction.fields && extraction.fields.paymentTerms ? extraction.fields.paymentTerms : '',
                    'custrecord_flux_line_items': JSON.stringify(extraction.lineItems || []),
                    'custrecord_flux_anomalies': JSON.stringify(extraction.anomalies || []),
                    'custrecord_flux_confidence_score': extraction.confidence.overall,
                    'custrecord_flux_amount_validated': extraction.amountValidation ? extraction.amountValidation.valid : false,
                    'custrecord_flux_processing_time': processingTime,
                    'custrecord_flux_modified_date': new Date()
                };

                // Only set currency if it's a numeric ID (not a code like "USD")
                if (extraction.fields && extraction.fields.currency) {
                    var currencyVal = extraction.fields.currency;
                    if (typeof currencyVal === 'number' || (typeof currencyVal === 'string' && /^\d+$/.test(currencyVal))) {
                        updateValues['custrecord_flux_currency'] = parseInt(currencyVal, 10);
                    }
                    // Skip text currency codes - would need lookup to convert
                }

                // Store ALL extracted data as JSON for flexible field mapping
                // This allows mapping to any NetSuite field configured in form layout
                var extractedDataObj = {};

                // Start with all extracted fields (includes custom fields from AI)
                if (extraction.fields) {
                    Object.keys(extraction.fields).forEach(function(key) {
                        extractedDataObj[key] = extraction.fields[key];
                    });
                }

                // Core fields (also stored in dedicated columns for reporting)
                extractedDataObj.vendorName = extraction.vendorMatch ? extraction.vendorMatch.vendorName : '';
                extractedDataObj.vendor = extraction.vendorMatch ? extraction.vendorMatch.vendorId : '';

                // Include ALL raw extracted label/value pairs for flexible suggestions
                // These can be matched to any form field by label similarity
                if (extraction.allExtractedFields) {
                    extractedDataObj._allExtractedFields = extraction.allExtractedFields;
                }

                // Include field confidences for showing suggestion quality
                if (extraction.fieldConfidences) {
                    extractedDataObj._fieldConfidences = extraction.fieldConfidences;
                }

                // Additional metadata
                extractedDataObj._confidence = extraction.confidence;
                extractedDataObj._vendorMatch = extraction.vendorMatch;
                extractedDataObj._extractedAt = new Date().toISOString();

                updateValues['custrecord_flux_extracted_data'] = JSON.stringify(extractedDataObj);
                // Note: custrecord_flux_form_data is NOT set here - it's only populated when user saves form edits

                record.submitFields({
                    type: 'customrecord_flux_document',
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
                    type: 'customrecord_flux_document',
                    id: documentId,
                    values: {
                        'custrecord_flux_status': DocStatus.ERROR,
                        'custrecord_flux_error_message': result.error
                    }
                });

                return Response.error('PROCESSING_FAILED', result.error);
            }
        } catch (e) {
            log.error('Document processing error', e);

            record.submitFields({
                type: 'customrecord_flux_document',
                id: documentId,
                values: {
                    'custrecord_flux_status': DocStatus.ERROR,
                    'custrecord_flux_error_message': e.message
                }
            });

            return Response.error('PROCESSING_ERROR', e.message);
        }
    }

    function reprocessDocument(documentId) {
        if (!documentId) {
            return Response.error('MISSING_PARAM', 'Document ID is required');
        }

        record.submitFields({
            type: 'customrecord_flux_document',
            id: documentId,
            values: {
                'custrecord_flux_status': DocStatus.PENDING,
                'custrecord_flux_line_items': '[]',
                'custrecord_flux_anomalies': '[]',
                'custrecord_flux_confidence_score': 0,
                'custrecord_flux_error_message': ''
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
                        type: 'customrecord_flux_document',
                        id: result.data.documentId,
                        values: {
                            'custrecord_flux_source': Source.EMAIL,
                            'custrecord_flux_email_sender': emailSender,
                            'custrecord_flux_email_subject': emailSubject,
                            'custrecord_flux_email_received': new Date()
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

    /**
     * Get vendor suggestions based on extracted vendor name
     * Uses learned aliases and fuzzy matching
     */
    function getVendorSuggestions(vendorName) {
        if (!vendorName) {
            return Response.error('MISSING_PARAM', 'Vendor name required');
        }

        try {
            var engine = new FC_Engine.FluxCaptureEngine({ enableLearning: true });
            var suggestions = engine.getVendorSuggestions(vendorName);

            return Response.success({
                vendorName: vendorName,
                suggestions: suggestions
            });
        } catch (e) {
            return Response.error('SUGGESTION_FAILED', e.message);
        }
    }

    /**
     * Get learning system statistics
     * Shows alias counts, correction history, etc.
     */
    function getLearningStats() {
        try {
            var engine = new FC_Engine.FluxCaptureEngine({ enableLearning: true });
            var aliasStats = engine.getAliasStats();

            // Query additional stats from config records
            var sql = "SELECT custrecord_flux_cfg_type, COUNT(*) as cnt " +
                      "FROM customrecord_flux_config " +
                      "WHERE custrecord_flux_cfg_active = 'T' " +
                      "AND custrecord_flux_cfg_source = 'learning' " +
                      "GROUP BY custrecord_flux_cfg_type";

            var configStats = {};
            try {
                var results = query.runSuiteQL({ query: sql });
                if (results.results) {
                    results.results.forEach(function(row) {
                        configStats[row.values[0]] = row.values[1];
                    });
                }
            } catch (queryErr) {
                fcDebug.debug('getLearningStats', 'Config query failed: ' + queryErr.message);
            }

            return Response.success({
                aliases: aliasStats,
                learnedPatterns: {
                    vendorAliases: configStats['vendor_alias'] || 0,
                    dateFormats: configStats['date_format'] || 0,
                    amountFormats: configStats['amount_format'] || 0,
                    accountMappings: configStats['account_mapping'] || 0,
                    fieldPatterns: configStats['field_pattern'] || 0
                },
                lastUpdated: new Date().toISOString()
            });
        } catch (e) {
            return Response.error('STATS_FAILED', e.message);
        }
    }

    /**
     * Get suggested GL account for a line item description
     * Uses learned account mappings from past corrections
     */
    function getSuggestedAccount(vendorId, description) {
        if (!description) {
            return Response.success({ suggestion: null });
        }

        try {
            var engine = new FC_Engine.FluxCaptureEngine({ enableLearning: true });
            var suggestion = engine.getSuggestedAccount(vendorId ? parseInt(vendorId) : null, description);

            return Response.success({
                description: description,
                vendorId: vendorId,
                suggestion: suggestion
            });
        } catch (e) {
            return Response.error('SUGGESTION_FAILED', e.message);
        }
    }

    function submitCorrection(context) {
        var documentId = context.documentId;
        var fieldName = context.fieldName;
        var originalValue = context.originalValue;
        var correctedValue = context.correctedValue;
        var lineItemDescription = context.lineItemDescription; // For account mapping

        if (!documentId || !fieldName) {
            return Response.error('MISSING_PARAM', 'Document ID and field name required');
        }

        try {
            var docRecord = record.load({
                type: 'customrecord_flux_document',
                id: documentId
            });

            // Get vendor ID for learning context
            var vendorId = docRecord.getValue('custrecord_flux_vendor');

            var existingCorrections = JSON.parse(docRecord.getValue('custrecord_flux_user_corrections') || '[]');

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
                type: 'customrecord_flux_document',
                id: documentId,
                values: {
                    'custrecord_flux_user_corrections': JSON.stringify(existingCorrections),
                    'custrecord_flux_modified_date': new Date()
                }
            });

            // ACTIVE LEARNING: Learn from this correction for future extractions
            var learningResult = null;
            try {
                var engine = new FC_Engine.FluxCaptureEngine({ enableLearning: true });
                learningResult = engine.learnFromCorrection({
                    field: fieldName,
                    original: originalValue,
                    corrected: correctedValue,
                    documentId: documentId,
                    vendorId: vendorId,
                    lineItemDescription: lineItemDescription
                });
                log.audit('FluxCapture.Learning', {
                    field: fieldName,
                    success: learningResult.success,
                    type: learningResult.type
                });
            } catch (learnErr) {
                log.error('FluxCapture.Learning', learnErr.message);
                // Don't fail the correction just because learning failed
            }

            return Response.success({
                documentId: documentId,
                corrections: existingCorrections,
                learned: learningResult ? learningResult.success : false,
                learningType: learningResult ? learningResult.type : null
            }, 'Correction recorded and learned');
        } catch (e) {
            return Response.error('CORRECTION_FAILED', e.message);
        }
    }

    // ==================== PUT Implementations ====================

    function updateDocument(context) {
        var documentId = context.documentId;
        var formData = context.formData;

        if (!documentId) {
            return Response.error('MISSING_PARAM', 'Document ID is required');
        }

        if (!formData) {
            return Response.error('MISSING_PARAM', 'Form data is required');
        }

        try {
            // Add metadata to formData
            formData._meta = formData._meta || {};
            formData._meta.lastSaved = new Date().toISOString();
            formData._meta.savedBy = runtime.getCurrentUser().id;

            var values = {
                'custrecord_flux_modified_date': new Date(),
                'custrecord_flux_form_data': JSON.stringify(formData)
            };

            // Also update key indexed fields for search/filtering purposes
            // These are derived from formData but stored separately for queries
            var bodyFields = formData.bodyFields || {};

            if (bodyFields.entity) {
                values['custrecord_flux_vendor'] = bodyFields.entity;
            }
            if (bodyFields.tranid) {
                values['custrecord_flux_invoice_number'] = bodyFields.tranid;
            }
            if (bodyFields.trandate) {
                values['custrecord_flux_invoice_date'] = bodyFields.trandate;
            }
            if (bodyFields.duedate) {
                values['custrecord_flux_due_date'] = bodyFields.duedate;
            }
            if (bodyFields.total !== undefined) {
                values['custrecord_flux_total_amount'] = bodyFields.total;
            }
            if (bodyFields.currency) {
                values['custrecord_flux_currency'] = bodyFields.currency;
            }

            record.submitFields({
                type: 'customrecord_flux_document',
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
                type: 'customrecord_flux_document',
                id: documentId
            });

            var vendorId = docRecord.getValue('custrecord_flux_vendor');
            var documentType = docRecord.getValue('custrecord_flux_document_type');

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
                type: 'customrecord_flux_document',
                id: documentId,
                values: {
                    'custrecord_flux_status': DocStatus.COMPLETED,
                    'custrecord_flux_created_transaction': transactionId ? String(transactionId) : '',
                    'custrecord_flux_modified_date': new Date()
                }
            });

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
            record.submitFields({
                type: 'customrecord_flux_document',
                id: documentId,
                values: {
                    'custrecord_flux_status': DocStatus.REJECTED,
                    'custrecord_flux_rejection_reason': reason,
                    'custrecord_flux_modified_date': new Date()
                }
            });

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
            type: 'customrecord_flux_document',
            id: documentId,
            values: {
                'custrecord_flux_status': status,
                'custrecord_flux_modified_date': new Date()
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
            type: 'customrecord_flux_document',
            id: documentId,
            values: { 'custrecord_flux_uploaded_by': assigneeId }
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
                type: 'customrecord_flux_document',
                id: documentId
            });

            var fileId = docRecord.getValue('custrecord_flux_source_file');

            record.delete({ type: 'customrecord_flux_document', id: documentId });

            if (fileId) {
                try {
                    file.delete({ id: fileId });
                } catch (e) {
                    fcDebug.debug('File delete skipped', e.message);
                }
            }

            return Response.success({ documentId: documentId }, 'Document deleted');
        } catch (e) {
            return Response.error('DELETE_FAILED', e.message);
        }
    }

    function clearCompleted(context) {
        var olderThanDays = parseInt(context.olderThanDays) || 30;

        try {
            var docSearch = search.create({
                type: 'customrecord_flux_document',
                filters: [
                    ['custrecord_flux_status', 'anyof', [DocStatus.REJECTED, DocStatus.COMPLETED]],
                    'AND',
                    ['custrecord_flux_modified_date', 'before', 'daysago' + olderThanDays]
                ],
                columns: ['internalid']
            });

            var deletedCount = 0;

            docSearch.run().each(function(result) {
                record.delete({ type: 'customrecord_flux_document', id: result.id });
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

    function createTransactionFromDocument(docRecord, transactionType) {
        // Load form data - this is the source of truth for transaction creation
        var formData = JSON.parse(docRecord.getValue('custrecord_flux_form_data') || 'null');

        // Fallback to legacy fixed fields if formData doesn't exist (for backwards compatibility)
        if (!formData) {
            formData = {
                bodyFields: {
                    entity: docRecord.getValue('custrecord_flux_vendor'),
                    tranid: docRecord.getValue('custrecord_flux_invoice_number'),
                    trandate: docRecord.getValue('custrecord_flux_invoice_date'),
                    duedate: docRecord.getValue('custrecord_flux_due_date'),
                    currency: docRecord.getValue('custrecord_flux_currency')
                },
                sublists: {
                    expense: JSON.parse(docRecord.getValue('custrecord_flux_line_items') || '[]')
                }
            };
        }

        var bodyFields = formData.bodyFields || {};
        var sublists = formData.sublists || {};
        var txnRecord;

        // Fields to skip when setting body fields (handled specially or not applicable)
        var skipFields = ['_display', 'customform'];

        // Helper to check if a field should be skipped
        function shouldSkipField(fieldId) {
            if (!fieldId) return true;
            var lowerFieldId = fieldId.toLowerCase();
            return skipFields.some(function(skip) {
                return lowerFieldId.indexOf(skip) !== -1;
            });
        }

        // Helper to set body field value safely
        function setBodyField(txn, fieldId, value) {
            if (!fieldId || value === undefined || value === null || value === '') return;
            if (shouldSkipField(fieldId)) return;

            try {
                txn.setValue({ fieldId: fieldId, value: value });
            } catch (e) {
                log.debug('setBodyField', 'Could not set ' + fieldId + ': ' + e.message);
            }
        }

        // Helper to set sublist field value safely
        function setSublistField(txn, sublistId, fieldId, value) {
            if (!fieldId || value === undefined || value === null || value === '') return;
            if (shouldSkipField(fieldId)) return;

            try {
                txn.setCurrentSublistValue({ sublistId: sublistId, fieldId: fieldId, value: value });
            } catch (e) {
                log.debug('setSublistField', 'Could not set ' + sublistId + '.' + fieldId + ': ' + e.message);
            }
        }

        // Helper to add sublist lines
        function addSublistLines(txn, sublistId, lines) {
            if (!lines || !Array.isArray(lines) || lines.length === 0) return;

            lines.forEach(function(line) {
                txn.selectNewLine({ sublistId: sublistId });

                Object.keys(line).forEach(function(fieldId) {
                    // Skip display fields (e.g., account_display)
                    if (fieldId.indexOf('_display') !== -1) return;
                    setSublistField(txn, sublistId, fieldId, line[fieldId]);
                });

                txn.commitLine({ sublistId: sublistId });
            });
        }

        if (transactionType === 'vendorbill') {
            txnRecord = record.create({ type: record.Type.VENDOR_BILL, isDynamic: true });

            // Set all body fields from formData
            Object.keys(bodyFields).forEach(function(fieldId) {
                setBodyField(txnRecord, fieldId, bodyFields[fieldId]);
            });

            // Add expense lines
            if (sublists.expense && sublists.expense.length > 0) {
                addSublistLines(txnRecord, 'expense', sublists.expense);
            }
            // Add item lines
            if (sublists.item && sublists.item.length > 0) {
                addSublistLines(txnRecord, 'item', sublists.item);
            }

            // Fallback: if no lines, create single expense line with total
            var totalAmount = bodyFields.total || bodyFields.usertotal;
            if ((!sublists.expense || sublists.expense.length === 0) &&
                (!sublists.item || sublists.item.length === 0) &&
                totalAmount) {
                txnRecord.selectNewLine({ sublistId: 'expense' });
                txnRecord.setCurrentSublistValue({ sublistId: 'expense', fieldId: 'amount', value: totalAmount });
                txnRecord.setCurrentSublistValue({ sublistId: 'expense', fieldId: 'memo', value: 'Flux Capture Import' });
                txnRecord.commitLine({ sublistId: 'expense' });
            }

        } else if (transactionType === 'vendorcredit') {
            txnRecord = record.create({ type: record.Type.VENDOR_CREDIT, isDynamic: true });

            Object.keys(bodyFields).forEach(function(fieldId) {
                setBodyField(txnRecord, fieldId, bodyFields[fieldId]);
            });

            if (sublists.expense && sublists.expense.length > 0) {
                addSublistLines(txnRecord, 'expense', sublists.expense);
            }
            if (sublists.item && sublists.item.length > 0) {
                addSublistLines(txnRecord, 'item', sublists.item);
            }

        } else if (transactionType === 'expensereport') {
            txnRecord = record.create({ type: record.Type.EXPENSE_REPORT, isDynamic: true });

            // Expense reports use current user as entity
            txnRecord.setValue('entity', runtime.getCurrentUser().id);

            // Set other body fields
            Object.keys(bodyFields).forEach(function(fieldId) {
                if (fieldId !== 'entity') { // Don't override entity
                    setBodyField(txnRecord, fieldId, bodyFields[fieldId]);
                }
            });

            if (sublists.expense && sublists.expense.length > 0) {
                addSublistLines(txnRecord, 'expense', sublists.expense);
            }

        } else if (transactionType === 'purchaseorder') {
            txnRecord = record.create({ type: record.Type.PURCHASE_ORDER, isDynamic: true });

            Object.keys(bodyFields).forEach(function(fieldId) {
                setBodyField(txnRecord, fieldId, bodyFields[fieldId]);
            });

            if (sublists.item && sublists.item.length > 0) {
                addSublistLines(txnRecord, 'item', sublists.item);
            }
            if (sublists.expense && sublists.expense.length > 0) {
                addSublistLines(txnRecord, 'expense', sublists.expense);
            }
        }

        return txnRecord ? txnRecord.save() : null;
    }

    // ==================== Provider Configuration Handlers ====================

    /**
     * Get provider configuration for UI (with masked sensitive data)
     */
    function getProviderConfig() {
        try {
            var EngineModule = getEngine();
            if (!EngineModule || !EngineModule.getProviderConfig) {
                return Response.error('MODULE_NOT_AVAILABLE', 'Provider configuration module not available');
            }

            var config = EngineModule.getProviderConfig();
            return Response.success(config, 'Provider configuration retrieved');
        } catch (e) {
            log.error('getProviderConfig', e);
            return Response.error('GET_PROVIDER_CONFIG_FAILED', e.message);
        }
    }

    /**
     * Get list of available providers
     */
    function getAvailableProviders() {
        try {
            var EngineModule = getEngine();
            if (!EngineModule || !EngineModule.getAvailableProviders) {
                return Response.error('MODULE_NOT_AVAILABLE', 'Provider module not available');
            }

            var providers = EngineModule.getAvailableProviders();
            return Response.success(providers, 'Available providers retrieved');
        } catch (e) {
            log.error('getAvailableProviders', e);
            return Response.error('GET_PROVIDERS_FAILED', e.message);
        }
    }

    /**
     * Save provider configuration
     */
    function saveProviderConfig(context) {
        try {
            var EngineModule = getEngine();
            if (!EngineModule || !EngineModule.saveProviderConfig) {
                return Response.error('MODULE_NOT_AVAILABLE', 'Provider configuration module not available');
            }

            // Load existing config to preserve settings when switching providers
            var existingConfig = null;
            if (EngineModule.getProviderConfigForUI) {
                existingConfig = EngineModule.getProviderConfigForUI();
            }

            // Build config from context
            var config = {
                providerType: context.providerType || 'oci'
            };

            // Include OCI config if present (or preserve existing)
            if (context.oci) {
                config.oci = context.oci;
            } else if (existingConfig && existingConfig.oci) {
                config.oci = existingConfig.oci;
            }

            // Include Azure config if present
            if (context.azure) {
                config.azure = {
                    endpoint: context.azure.endpoint || '',
                    defaultModel: context.azure.defaultModel || 'prebuilt-invoice'
                };
                // Only include API key if a new one was provided
                if (context.azure.apiKey) {
                    config.azure.apiKey = context.azure.apiKey;
                }
                // Preserve existing encrypted API key flag
                config.azure._preserveExistingApiKey = !context.azure.apiKey;
            } else if (existingConfig && existingConfig.azure) {
                // Preserve existing Azure config when switching to OCI
                config.azure = {
                    endpoint: existingConfig.azure.endpoint || '',
                    defaultModel: existingConfig.azure.defaultModel || 'prebuilt-invoice',
                    _preserveExistingApiKey: true
                };
                if (existingConfig.azure._hasApiKey) {
                    config.azure._hasApiKey = true;
                }
            }

            var result = EngineModule.saveProviderConfig(config);

            if (result.success) {
                return Response.success(null, result.message || 'Provider configuration saved');
            } else {
                return Response.error('SAVE_FAILED', result.message || 'Failed to save provider configuration');
            }
        } catch (e) {
            log.error('saveProviderConfig', e);
            return Response.error('SAVE_PROVIDER_CONFIG_FAILED', e.message);
        }
    }

    /**
     * Test provider connection
     */
    function testProviderConnection(providerType, config) {
        try {
            var EngineModule = getEngine();
            if (!EngineModule || !EngineModule.testProviderConnection) {
                return Response.error('MODULE_NOT_AVAILABLE', 'Provider module not available');
            }

            // Load existing saved config to merge with test config
            var savedConfig = null;
            if (EngineModule.getProviderConfigForUI) {
                savedConfig = EngineModule.getProviderConfigForUI();
            }

            // Build test config, using saved values for missing fields
            var testConfig = {};
            if (config) {
                testConfig = {
                    endpoint: config.endpoint || (savedConfig && savedConfig.azure ? savedConfig.azure.endpoint : '') || '',
                    defaultModel: config.defaultModel || (savedConfig && savedConfig.azure ? savedConfig.azure.defaultModel : 'prebuilt-invoice')
                };

                // If apiKey is provided, use it; otherwise use saved encrypted key
                if (config.apiKey) {
                    testConfig.apiKey = config.apiKey;
                } else if (savedConfig && savedConfig.azure && savedConfig.azure._hasApiKey) {
                    // Signal to use the saved encrypted key
                    testConfig._useSavedApiKey = true;
                }
            }

            var result = EngineModule.testProviderConnection(providerType, testConfig);

            if (result.success) {
                return Response.success({ tested: providerType }, result.message || 'Connection test successful');
            } else {
                return Response.error('TEST_FAILED', result.message || 'Connection test failed');
            }
        } catch (e) {
            log.error('testProviderConnection', e);
            return Response.error('TEST_PROVIDER_FAILED', e.message);
        }
    }

    function getStatusDisplayText(status) {
        return DocStatusLabels[status] || status;
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
