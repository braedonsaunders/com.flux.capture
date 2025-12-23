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
    '/SuiteApps/com.flux.capture/suitelet/FC_FormSchemaExtractor',
    '/SuiteApps/com.flux.capture/lib/llm/GeminiVerifier',
    '/SuiteApps/com.flux.capture/lib/matching/POMatchingEngine'
], function(file, record, search, query, runtime, errorModule, log, encode, email, format, task, FC_Engine, fcDebug, FormSchemaExtractor, GeminiVerifierModule, POMatchingEngine) {

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
                case 'learnings':
                    result = getLearnings(context);
                    break;
                case 'learning':
                    result = getLearning(context.id);
                    break;
                case 'suggestedAccount':
                    result = getSuggestedAccount(context.vendorId, context.description);
                    break;
                case 'codingSuggestions':
                    result = getCodingSuggestions(context.vendorId, context.lineItems);
                    break;
                case 'providerconfig':
                    result = getProviderConfig();
                    break;
                case 'providers':
                    result = getAvailableProviders();
                    break;
                case 'llmconfig':
                    result = getLLMConfig();
                    break;
                case 'emailInboxStatus':
                    result = getEmailInboxStatus();
                    break;
                case 'recentEmailImports':
                    result = getRecentEmailImports();
                    break;
                case 'dashboardPrefs':
                    result = getDashboardPrefs(context.userId);
                    break;
                case 'pomatch':
                    result = getPOMatchResult(context.docId || context.id);
                    break;
                case 'podetails':
                    result = getPODetails(context.poId);
                    break;
                case 'pocandidates':
                    result = getPOCandidates(context.docId || context.id);
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
                case 'learn':
                    result = submitCorrection(context);
                    break;
                case 'createLearning':
                    result = createLearning(context);
                    break;
                case 'testprovider':
                    result = testProviderConnection(context.providerType, context.config);
                    break;
                case 'testllm':
                    result = testLLMConnection(context.apiKey, context.useSavedKey);
                    break;
                case 'triggerProcessing':
                    // Deprecated - User Event script now triggers processing automatically
                    result = Response.success({ message: 'Processing is now triggered automatically via User Event' });
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
                case 'formconfig':
                    // Save user-customized form config (from XML upload or manual)
                    result = saveUserFormConfig(context.transactionType, context.formId, context.config, context.source);
                    break;
                case 'invalidatecache':
                    result = invalidateFormSchemaCache(context.transactionType, context.formId);
                    break;
                case 'providerconfig':
                    result = saveProviderConfig(context);
                    break;
                case 'emailInboxConfig':
                    result = saveEmailInboxConfig(context);
                    break;
                case 'settings':
                    result = saveSettings(context);
                    break;
                case 'llmconfig':
                    result = saveLLMConfig(context);
                    break;
                case 'dashboardPrefs':
                    result = saveDashboardPrefs(context);
                    break;
                case 'saveLearning':
                    result = saveLearning(context);
                    break;
                case 'confirmmatch':
                    result = confirmPOMatch(context);
                    break;
                case 'rematch':
                    result = rematchPO(context);
                    break;
                case 'clearmatch':
                    result = clearPOMatch(context);
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
                case 'learning':
                    var learningId = params && (params.id || params.learningId);
                    if (learningId && typeof learningId === 'string') {
                        learningId = parseInt(learningId, 10);
                    }
                    result = deleteLearning(learningId);
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

        // Parse formData with error handling for legacy data (field may contain old raw text)
        var formData = null;
        var formDataRaw = docRecord.getValue('custrecord_flux_form_data');
        if (formDataRaw) {
            try {
                formData = JSON.parse(formDataRaw);
                // Validate it's actually our formData structure (has bodyFields or sublists)
                if (formData && typeof formData === 'object' && (formData.bodyFields || formData.sublists)) {
                    // Valid formData
                } else {
                    formData = null; // Not valid formData structure, treat as empty
                }
            } catch (e) {
                // Field contains non-JSON data (legacy raw text), ignore it
                formData = null;
            }
        }

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
            // Extract aiVerification from extractedData for easy access by Review UI
            aiVerification: extractedData.aiVerification || null,
            amountValidated: docRecord.getValue('custrecord_flux_amount_validated'),
            createdTransaction: docRecord.getValue('custrecord_flux_created_transaction'),
            source: docRecord.getValue('custrecord_flux_source'),
            sourceText: getSourceDisplayText(docRecord.getValue('custrecord_flux_source')),
            emailSender: docRecord.getValue('custrecord_flux_email_sender'),
            emailSubject: docRecord.getValue('custrecord_flux_email_subject'),
            rejectionReason: docRecord.getValue('custrecord_flux_rejection_reason'),
            errorMessage: docRecord.getValue('custrecord_flux_error_message'),
            processingTime: docRecord.getValue('custrecord_flux_processing_time'),
            // PO Matching fields
            matchedPO: docRecord.getValue('custrecord_flux_matched_po'),
            matchedPONumber: docRecord.getText('custrecord_flux_matched_po'),
            poMatchStatus: docRecord.getValue('custrecord_flux_po_match_status'),
            poMatchScore: docRecord.getValue('custrecord_flux_po_match_score'),
            poMatchDetails: JSON.parse(docRecord.getValue('custrecord_flux_po_match_details') || 'null'),
            poVariance: docRecord.getValue('custrecord_flux_po_variance'),
            poCandidates: JSON.parse(docRecord.getValue('custrecord_flux_po_candidates') || '[]')
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
        log.audit('getDocumentList', 'Called with context: ' + JSON.stringify({
            page: context.page, pageSize: context.pageSize, status: context.status,
            documentType: context.documentType, sortBy: context.sortBy, sortDir: context.sortDir
        }));

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
            'COALESCE(custrecord_flux_created_date, custrecord_flux_email_received, created) as createdDate, custrecord_flux_uploaded_by as uploadedBy, ' +
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
            sql += " AND COALESCE(custrecord_flux_created_date, custrecord_flux_email_received, created) >= TO_DATE(?, 'YYYY-MM-DD')";
            params.push(dateFrom);
        }
        if (dateTo) {
            sql += " AND COALESCE(custrecord_flux_created_date, custrecord_flux_email_received, created) <= TO_DATE(?, 'YYYY-MM-DD')";
            params.push(dateTo);
        }

        var countSql = sql.replace(/SELECT[\s\S]*?FROM/, 'SELECT COUNT(*) as total FROM');
        var countResult = query.runSuiteQL({ query: countSql, params: params });
        var total = countResult.results.length > 0 ? countResult.results[0].values[0] : 0;

        var sortColumns = {
            'created': 'COALESCE(custrecord_flux_created_date, custrecord_flux_email_received, created)',
            'confidence': 'custrecord_flux_confidence_score',
            'vendor': 'custrecord_flux_vendor',
            'status': 'custrecord_flux_status',
            'amount': 'custrecord_flux_total_amount'
        };
        var sortColumn = sortColumns[sortBy] || 'COALESCE(custrecord_flux_created_date, custrecord_flux_email_received, created)';

        sql += ' ORDER BY ' + sortColumn + ' ' + sortDir + ' NULLS LAST';

        log.audit('getDocumentList', 'SQL: ' + sql + ' | Params: ' + JSON.stringify(params));

        var results = query.runSuiteQL({ query: sql, params: params });

        log.audit('getDocumentList', 'Query returned ' + (results.results ? results.results.length : 0) + ' total results, count query returned: ' + total);

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
                'COALESCE(custrecord_flux_created_date, custrecord_flux_email_received, created) as createdDate, ' +
                'custrecord_flux_anomalies as anomalies, custrecord_flux_error_message as errorMessage, custrecord_flux_original_filename as originalFilename FROM customrecord_flux_document ' +
                'WHERE custrecord_flux_status IN (' + DocStatus.PENDING + ', ' + DocStatus.PROCESSING + ', ' +
                DocStatus.EXTRACTED + ', ' + DocStatus.NEEDS_REVIEW + ', ' + DocStatus.ERROR + ') ' +
                'ORDER BY ' + sortColumn + ' ' + sortDir + ' NULLS LAST';

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
                // Use originalFilename as fallback for name
                var docName = v[1] || v[11] || ('Document ' + v[0]);
                return {
                    id: v[0],
                    name: docName,
                    status: v[2],
                    documentType: v[3],
                    confidence: confidence,
                    vendorName: v[5],
                    invoiceNumber: v[6],
                    totalAmount: v[7],
                    createdDate: v[8],
                    hasAnomalies: docAnomalies.length > 0,
                    errorMessage: v[10] || '',
                    originalFilename: v[11]
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
     * Get customers AND jobs/projects for customer field dropdowns
     * In NetSuite, jobs are children of customers and often selected in the same field
     */
    function getCustomersAndProjects(context) {
        try {
            var searchQuery = context.query || '';
            var limit = Math.min(parseInt(context.limit) || 200, 500);
            var halfLimit = Math.floor(limit / 2);

            var options = [];

            // Search customers
            var customerFilters = [['isinactive', 'is', 'F']];
            if (searchQuery && searchQuery.length >= 1) {
                customerFilters.push('AND');
                customerFilters.push([
                    ['entityid', 'contains', searchQuery],
                    'OR',
                    ['companyname', 'contains', searchQuery]
                ]);
            }

            var customerSearch = search.create({
                type: search.Type.CUSTOMER,
                filters: customerFilters,
                columns: [
                    search.createColumn({ name: 'internalid' }),
                    search.createColumn({ name: 'entityid', sort: search.Sort.ASC }),
                    search.createColumn({ name: 'companyname' })
                ]
            });

            var customerResults = customerSearch.run().getRange({ start: 0, end: halfLimit });
            customerResults.forEach(function(result) {
                var entityId = result.getValue('entityid') || '';
                var companyName = result.getValue('companyname') || '';
                options.push({
                    value: result.getValue('internalid'),
                    text: entityId ? entityId + ' - ' + companyName : companyName,
                    type: 'customer'
                });
            });

            // Search jobs/projects (companyname not valid for JOB, use entityid only)
            var jobFilters = [['isinactive', 'is', 'F']];
            if (searchQuery && searchQuery.length >= 1) {
                jobFilters.push('AND');
                jobFilters.push(['entityid', 'contains', searchQuery]);
            }

            var jobSearch = search.create({
                type: search.Type.JOB,
                filters: jobFilters,
                columns: [
                    search.createColumn({ name: 'internalid' }),
                    search.createColumn({ name: 'entityid', sort: search.Sort.ASC }),
                    search.createColumn({ name: 'customer' })
                ]
            });

            var jobResults = jobSearch.run().getRange({ start: 0, end: halfLimit });
            jobResults.forEach(function(result) {
                var entityId = result.getValue('entityid') || '';
                options.push({
                    value: result.getValue('internalid'),
                    text: entityId,
                    type: 'project'
                });
            });

            // Sort combined results by text
            options.sort(function(a, b) {
                return (a.text || '').localeCompare(b.text || '');
            });

            return Response.success(options);
        } catch (e) {
            log.error('getCustomersAndProjects Error', e);
            return Response.error('CUSTOMERS_ERROR', e.message);
        }
    }

    /**
     * Get employees for employee/nextapprover field dropdowns
     * Returns employee data including email, title, department, and supervisor
     */
    function getEmployees(context) {
        try {
            var searchQuery = context.query || '';
            var limit = Math.min(parseInt(context.limit) || 20, 100);

            var filters = [['isinactive', 'is', 'F']];

            // Search filter - search by name or email
            if (searchQuery && searchQuery.length >= 1) {
                filters.push('AND');
                filters.push([
                    ['entityid', 'contains', searchQuery],
                    'OR',
                    ['firstname', 'contains', searchQuery],
                    'OR',
                    ['lastname', 'contains', searchQuery],
                    'OR',
                    ['email', 'contains', searchQuery]
                ]);
            }

            var employeeSearch = search.create({
                type: search.Type.EMPLOYEE,
                filters: filters,
                columns: [
                    search.createColumn({ name: 'internalid' }),
                    search.createColumn({ name: 'entityid' }),
                    search.createColumn({ name: 'firstname', sort: search.Sort.ASC }),
                    search.createColumn({ name: 'lastname' }),
                    search.createColumn({ name: 'email' }),
                    search.createColumn({ name: 'title' }),
                    search.createColumn({ name: 'department' }),
                    search.createColumn({ name: 'supervisor' })
                ]
            });

            var options = [];
            var results = employeeSearch.run().getRange({ start: 0, end: limit });

            results.forEach(function(result) {
                var firstName = result.getValue('firstname') || '';
                var lastName = result.getValue('lastname') || '';
                var fullName = (firstName + ' ' + lastName).trim();

                options.push({
                    value: result.getValue('internalid'),
                    text: fullName || result.getValue('entityid'),
                    employeeData: {
                        entityId: result.getValue('entityid'),
                        firstName: firstName,
                        lastName: lastName,
                        email: result.getValue('email') || '',
                        title: result.getValue('title') || '',
                        department: result.getText('department') || '',
                        departmentId: result.getValue('department') || '',
                        supervisor: result.getText('supervisor') || '',
                        supervisorId: result.getValue('supervisor') || ''
                    }
                });
            });

            return Response.success(options);
        } catch (e) {
            log.error('getEmployees Error', e);
            return Response.error('EMPLOYEES_ERROR', e.message);
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

    // ==================== PO Matching Functions ====================

    /**
     * Get PO match result for a document
     * Performs matching if not already done
     */
    function getPOMatchResult(docId) {
        if (!docId) {
            return Response.error('MISSING_PARAM', 'Document ID is required');
        }

        try {
            // Load document
            var docRecord = record.load({
                type: 'customrecord_flux_document',
                id: docId
            });

            // Check if matching already done
            var existingMatchDetails = docRecord.getValue('custrecord_flux_po_match_details');
            if (existingMatchDetails) {
                var matchDetails = JSON.parse(existingMatchDetails);
                return Response.success({
                    cached: true,
                    matchStatus: docRecord.getValue('custrecord_flux_po_match_status'),
                    matchScore: docRecord.getValue('custrecord_flux_po_match_score'),
                    matchedPO: docRecord.getValue('custrecord_flux_matched_po'),
                    matchedPONumber: docRecord.getText('custrecord_flux_matched_po'),
                    poVariance: docRecord.getValue('custrecord_flux_po_variance'),
                    details: matchDetails,
                    candidates: JSON.parse(docRecord.getValue('custrecord_flux_po_candidates') || '[]')
                });
            }

            // Perform matching
            var invoiceData = {
                vendorId: docRecord.getValue('custrecord_flux_vendor'),
                poNumber: docRecord.getValue('custrecord_flux_po_number'),
                totalAmount: docRecord.getValue('custrecord_flux_total_amount'),
                subtotal: docRecord.getValue('custrecord_flux_subtotal'),
                invoiceDate: docRecord.getValue('custrecord_flux_invoice_date'),
                currency: docRecord.getValue('custrecord_flux_currency'),
                lineItems: JSON.parse(docRecord.getValue('custrecord_flux_line_items') || '[]')
            };

            var matchResult = POMatchingEngine.findMatches(invoiceData);

            // Save match results to document
            if (matchResult.success) {
                record.submitFields({
                    type: 'customrecord_flux_document',
                    id: docId,
                    values: {
                        'custrecord_flux_po_match_status': matchResult.matchStatus,
                        'custrecord_flux_po_match_score': matchResult.topMatch ? matchResult.topMatch.score / 100 : 0,
                        'custrecord_flux_matched_po': matchResult.recommendation && matchResult.recommendation.poId ? matchResult.recommendation.poId : '',
                        'custrecord_flux_po_variance': matchResult.topMatch ? matchResult.topMatch.amountVariance : null,
                        'custrecord_flux_po_match_details': JSON.stringify(matchResult),
                        'custrecord_flux_po_candidates': JSON.stringify(matchResult.candidates || [])
                    }
                });
            }

            return Response.success({
                cached: false,
                ...matchResult
            });
        } catch (e) {
            log.error('getPOMatchResult Error', e);
            return Response.error('MATCH_ERROR', e.message);
        }
    }

    /**
     * Get detailed PO information including line items
     */
    function getPODetails(poId) {
        if (!poId) {
            return Response.error('MISSING_PARAM', 'PO ID is required');
        }

        try {
            var poRec = record.load({
                type: record.Type.PURCHASE_ORDER,
                id: poId
            });

            var lineItems = [];
            var lineCount = poRec.getLineCount({ sublistId: 'item' });

            for (var i = 0; i < lineCount; i++) {
                lineItems.push({
                    lineNumber: i + 1,
                    item: poRec.getSublistValue({ sublistId: 'item', fieldId: 'item', line: i }),
                    itemText: poRec.getSublistText({ sublistId: 'item', fieldId: 'item', line: i }),
                    description: poRec.getSublistValue({ sublistId: 'item', fieldId: 'description', line: i }),
                    quantity: parseFloat(poRec.getSublistValue({ sublistId: 'item', fieldId: 'quantity', line: i })) || 0,
                    rate: parseFloat(poRec.getSublistValue({ sublistId: 'item', fieldId: 'rate', line: i })) || 0,
                    amount: parseFloat(poRec.getSublistValue({ sublistId: 'item', fieldId: 'amount', line: i })) || 0,
                    quantityReceived: parseFloat(poRec.getSublistValue({ sublistId: 'item', fieldId: 'quantityreceived', line: i })) || 0,
                    quantityBilled: parseFloat(poRec.getSublistValue({ sublistId: 'item', fieldId: 'quantitybilled', line: i })) || 0
                });
            }

            return Response.success({
                id: poId,
                poNumber: poRec.getValue('tranid'),
                poDate: poRec.getValue('trandate'),
                vendor: poRec.getValue('entity'),
                vendorName: poRec.getText('entity'),
                total: parseFloat(poRec.getValue('total')) || 0,
                subtotal: parseFloat(poRec.getValue('subtotal')) || 0,
                status: poRec.getValue('status'),
                statusText: poRec.getText('status'),
                currency: poRec.getValue('currency'),
                currencyText: poRec.getText('currency'),
                memo: poRec.getValue('memo'),
                lineItems: lineItems
            });
        } catch (e) {
            log.error('getPODetails Error', e);
            return Response.error('PO_LOAD_ERROR', e.message);
        }
    }

    /**
     * Get PO candidates for manual selection
     */
    function getPOCandidates(docId) {
        if (!docId) {
            return Response.error('MISSING_PARAM', 'Document ID is required');
        }

        try {
            var docRecord = record.load({
                type: 'customrecord_flux_document',
                id: docId
            });

            // Check for cached candidates
            var cachedCandidates = docRecord.getValue('custrecord_flux_po_candidates');
            if (cachedCandidates) {
                return Response.success(JSON.parse(cachedCandidates));
            }

            // Perform fresh matching to get candidates
            var invoiceData = {
                vendorId: docRecord.getValue('custrecord_flux_vendor'),
                poNumber: docRecord.getValue('custrecord_flux_po_number'),
                totalAmount: docRecord.getValue('custrecord_flux_total_amount'),
                invoiceDate: docRecord.getValue('custrecord_flux_invoice_date'),
                currency: docRecord.getValue('custrecord_flux_currency'),
                lineItems: JSON.parse(docRecord.getValue('custrecord_flux_line_items') || '[]')
            };

            var matchResult = POMatchingEngine.findMatches(invoiceData, { maxCandidates: 10 });

            return Response.success(matchResult.candidates || []);
        } catch (e) {
            log.error('getPOCandidates Error', e);
            return Response.error('CANDIDATES_ERROR', e.message);
        }
    }

    /**
     * Confirm/update PO match for a document
     */
    function confirmPOMatch(context) {
        var docId = context.docId || context.id;
        var poId = context.poId;

        if (!docId) {
            return Response.error('MISSING_PARAM', 'Document ID is required');
        }
        if (!poId) {
            return Response.error('MISSING_PARAM', 'PO ID is required');
        }

        try {
            // Load document to get invoice data
            var docRecord = record.load({
                type: 'customrecord_flux_document',
                id: docId
            });

            var invoiceData = {
                vendorId: docRecord.getValue('custrecord_flux_vendor'),
                totalAmount: docRecord.getValue('custrecord_flux_total_amount'),
                lineItems: JSON.parse(docRecord.getValue('custrecord_flux_line_items') || '[]')
            };

            // Perform 2-way match to get detailed variance info
            var twoWayResult = POMatchingEngine.performTwoWayMatch(invoiceData, poId);

            // Update document with confirmed match
            var updateValues = {
                'custrecord_flux_matched_po': poId,
                'custrecord_flux_po_match_status': POMatchingEngine.MATCH_STATUS.MANUAL,
                'custrecord_flux_po_match_score': 1, // 100% for manual confirmation
                'custrecord_flux_po_match_details': JSON.stringify(twoWayResult)
            };

            if (twoWayResult.success && twoWayResult.headerVariances) {
                updateValues['custrecord_flux_po_variance'] = twoWayResult.headerVariances.totalVariance;
            }

            record.submitFields({
                type: 'customrecord_flux_document',
                id: docId,
                values: updateValues
            });

            return Response.success({
                confirmed: true,
                poId: poId,
                twoWayResult: twoWayResult
            });
        } catch (e) {
            log.error('confirmPOMatch Error', e);
            return Response.error('CONFIRM_ERROR', e.message);
        }
    }

    /**
     * Re-run PO matching for a document
     */
    function rematchPO(context) {
        var docId = context.docId || context.id;

        if (!docId) {
            return Response.error('MISSING_PARAM', 'Document ID is required');
        }

        try {
            // Clear existing match data first
            record.submitFields({
                type: 'customrecord_flux_document',
                id: docId,
                values: {
                    'custrecord_flux_matched_po': '',
                    'custrecord_flux_po_match_status': '',
                    'custrecord_flux_po_match_score': '',
                    'custrecord_flux_po_match_details': '',
                    'custrecord_flux_po_variance': '',
                    'custrecord_flux_po_candidates': ''
                }
            });

            // Perform fresh match
            return getPOMatchResult(docId);
        } catch (e) {
            log.error('rematchPO Error', e);
            return Response.error('REMATCH_ERROR', e.message);
        }
    }

    /**
     * Clear PO match for a document
     */
    function clearPOMatch(context) {
        var docId = context.docId || context.id;

        if (!docId) {
            return Response.error('MISSING_PARAM', 'Document ID is required');
        }

        try {
            record.submitFields({
                type: 'customrecord_flux_document',
                id: docId,
                values: {
                    'custrecord_flux_matched_po': '',
                    'custrecord_flux_po_match_status': POMatchingEngine.MATCH_STATUS.NO_PO,
                    'custrecord_flux_po_match_score': '',
                    'custrecord_flux_po_match_details': '',
                    'custrecord_flux_po_variance': '',
                    'custrecord_flux_po_candidates': ''
                }
            });

            return Response.success({ cleared: true });
        } catch (e) {
            log.error('clearPOMatch Error', e);
            return Response.error('CLEAR_ERROR', e.message);
        }
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
                    // Search both customers and jobs/projects (combined result)
                    return getCustomersAndProjects(context);
                    break;
                case 'employees':
                case 'employee':
                    // Use dedicated function to include employee data
                    return getEmployees(context);
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

    function getSettings() {
        // Try to load saved settings from config record
        var savedSettings = {};
        try {
            var configSearch = search.create({
                type: 'customrecord_flux_config',
                filters: [
                    ['custrecord_flux_cfg_type', 'is', 'settings'],
                    'AND',
                    ['custrecord_flux_cfg_key', 'is', 'general'],
                    'AND',
                    ['custrecord_flux_cfg_active', 'is', 'T']
                ],
                columns: ['custrecord_flux_cfg_data']
            });
            var results = configSearch.run().getRange({ start: 0, end: 1 });
            if (results.length > 0) {
                var dataStr = results[0].getValue('custrecord_flux_cfg_data');
                if (dataStr) {
                    savedSettings = JSON.parse(dataStr);
                }
            }
        } catch (e) {
            log.debug('getSettings', 'No saved settings found, using defaults');
        }

        // Build anomaly detection settings with defaults (all on except detectRoundAmounts)
        var savedAnomaly = savedSettings.anomalyDetection || {};
        var anomalyDefaults = {
            // Duplicate Detection
            detectDuplicateInvoice: savedAnomaly.detectDuplicateInvoice !== false,
            detectDuplicatePayment: savedAnomaly.detectDuplicatePayment !== false,
            // Amount Validation
            validateLineItemsTotal: savedAnomaly.validateLineItemsTotal !== false,
            validateSubtotalTax: savedAnomaly.validateSubtotalTax !== false,
            validatePositiveAmounts: savedAnomaly.validatePositiveAmounts !== false,
            detectRoundAmounts: savedAnomaly.detectRoundAmounts === true, // Default OFF
            detectAmountOutlier: savedAnomaly.detectAmountOutlier !== false,
            // Date Validation
            validateFutureDate: savedAnomaly.validateFutureDate !== false,
            validateDueDateSequence: savedAnomaly.validateDueDateSequence !== false,
            validateStaleDate: savedAnomaly.validateStaleDate !== false,
            detectUnusualTerms: savedAnomaly.detectUnusualTerms !== false,
            // Vendor Validation
            detectVendorNotFound: savedAnomaly.detectVendorNotFound !== false,
            detectLowVendorConfidence: savedAnomaly.detectLowVendorConfidence !== false,
            detectInvoiceFormatChange: savedAnomaly.detectInvoiceFormatChange !== false,
            // Required Fields
            requireInvoiceNumber: savedAnomaly.requireInvoiceNumber !== false,
            requireTotalAmount: savedAnomaly.requireTotalAmount !== false
        };

        var settings = {
            defaultDocumentType: savedSettings.defaultDocumentType || 'auto',
            emailImportEnabled: true,
            emailAddress: 'flux-' + runtime.accountId + '@netsuite.com',
            defaultLineSublist: savedSettings.defaultLineSublist || 'auto',
            maxExtractionPages: savedSettings.maxExtractionPages || 0,
            maxFileSize: 10485760,
            supportedFileTypes: ['pdf', 'png', 'jpg', 'jpeg', 'tiff', 'tif', 'gif', 'bmp'],
            // Company locale settings - critical for reliable currency detection
            companyCountry: savedSettings.companyCountry || 'CA', // Default to Canada
            companyCurrency: savedSettings.companyCurrency || 'CAD', // Default to CAD
            anomalyDetection: anomalyDefaults,
            // Transaction creation settings
            attachFileToTransaction: savedSettings.attachFileToTransaction === true, // Default OFF
            deleteDocumentOnSuccess: savedSettings.deleteDocumentOnSuccess !== false // Default ON
        };

        return Response.success(settings);
    }

    function saveSettings(context) {
        try {
            var anomaly = context.anomalyDetection || {};
            var settingsData = {
                defaultDocumentType: context.defaultDocumentType || 'auto',
                defaultLineSublist: context.defaultLineSublist || 'auto',
                maxExtractionPages: parseInt(context.maxExtractionPages, 10) || 0,
                // Company locale settings
                companyCountry: context.companyCountry || 'CA',
                companyCurrency: context.companyCurrency || 'CAD',
                // Transaction creation settings
                attachFileToTransaction: context.attachFileToTransaction === true,
                deleteDocumentOnSuccess: context.deleteDocumentOnSuccess !== false,
                anomalyDetection: {
                    // Duplicate Detection
                    detectDuplicateInvoice: anomaly.detectDuplicateInvoice !== false,
                    detectDuplicatePayment: anomaly.detectDuplicatePayment !== false,
                    // Amount Validation
                    validateLineItemsTotal: anomaly.validateLineItemsTotal !== false,
                    validateSubtotalTax: anomaly.validateSubtotalTax !== false,
                    validatePositiveAmounts: anomaly.validatePositiveAmounts !== false,
                    detectRoundAmounts: anomaly.detectRoundAmounts === true,
                    detectAmountOutlier: anomaly.detectAmountOutlier !== false,
                    // Date Validation
                    validateFutureDate: anomaly.validateFutureDate !== false,
                    validateDueDateSequence: anomaly.validateDueDateSequence !== false,
                    validateStaleDate: anomaly.validateStaleDate !== false,
                    detectUnusualTerms: anomaly.detectUnusualTerms !== false,
                    // Vendor Validation
                    detectVendorNotFound: anomaly.detectVendorNotFound !== false,
                    detectLowVendorConfidence: anomaly.detectLowVendorConfidence !== false,
                    detectInvoiceFormatChange: anomaly.detectInvoiceFormatChange !== false,
                    // Required Fields
                    requireInvoiceNumber: anomaly.requireInvoiceNumber !== false,
                    requireTotalAmount: anomaly.requireTotalAmount !== false
                }
            };

            // Find existing config record or create new one
            var configSearch = search.create({
                type: 'customrecord_flux_config',
                filters: [
                    ['custrecord_flux_cfg_type', 'is', 'settings'],
                    'AND',
                    ['custrecord_flux_cfg_key', 'is', 'general']
                ],
                columns: ['internalid']
            });
            var results = configSearch.run().getRange({ start: 0, end: 1 });

            var configId;
            if (results.length > 0) {
                // Update existing record
                configId = results[0].id;
                record.submitFields({
                    type: 'customrecord_flux_config',
                    id: configId,
                    values: {
                        'custrecord_flux_cfg_data': JSON.stringify(settingsData),
                        'custrecord_flux_cfg_active': true
                    }
                });
            } else {
                // Create new record
                var configRec = record.create({ type: 'customrecord_flux_config' });
                configRec.setValue({ fieldId: 'name', value: 'settings_general' });
                configRec.setValue({ fieldId: 'custrecord_flux_cfg_type', value: 'settings' });
                configRec.setValue({ fieldId: 'custrecord_flux_cfg_key', value: 'general' });
                configRec.setValue({ fieldId: 'custrecord_flux_cfg_data', value: JSON.stringify(settingsData) });
                configRec.setValue({ fieldId: 'custrecord_flux_cfg_active', value: true });
                configId = configRec.save();
            }

            log.audit('saveSettings', 'Settings saved: ' + JSON.stringify(settingsData));
            return Response.success({ saved: true, configId: configId });
        } catch (e) {
            log.error('saveSettings', e);
            return Response.error('SAVE_SETTINGS_ERROR', e.message);
        }
    }

    // ==================== LLM Configuration ====================

    /**
     * Get LLM (Gemini) configuration for UI
     * Returns config with masked API key
     */
    function getLLMConfig() {
        try {
            if (!GeminiVerifierModule || !GeminiVerifierModule.getConfigForUI) {
                return Response.success({
                    enabled: false,
                    _available: false,
                    _message: 'LLM module not available'
                });
            }

            var config = GeminiVerifierModule.getConfigForUI();
            config._available = true;

            return Response.success(config);
        } catch (e) {
            log.error('getLLMConfig', e);
            return Response.error('LLM_CONFIG_ERROR', e.message);
        }
    }

    /**
     * Save LLM (Gemini) configuration
     */
    function saveLLMConfig(context) {
        try {
            if (!GeminiVerifierModule || !GeminiVerifierModule.saveConfig) {
                return Response.error('LLM_NOT_AVAILABLE', 'LLM module not available');
            }

            var config = {
                enabled: context.enabled === true || context.enabled === 'true',
                model: context.model || GeminiVerifierModule.DEFAULT_MODEL,
                triggerMode: context.triggerMode || 'smart',
                smartThreshold: parseFloat(context.smartThreshold) || 0.70,
                maxPages: parseInt(context.maxPages, 10) || 20,
                skipFileSizeMB: parseInt(context.skipFileSizeMB, 10) || 25,
                // Line item enhancement options
                enhanceLineItems: context.enhanceLineItems === true || context.enhanceLineItems === 'true',
                guessAccounts: context.guessAccounts === true || context.guessAccounts === 'true',
                guessDepartments: context.guessDepartments === true || context.guessDepartments === 'true',
                guessClasses: context.guessClasses === true || context.guessClasses === 'true',
                guessLocations: context.guessLocations === true || context.guessLocations === 'true'
            };

            // Only update API key if a new one was provided (not masked)
            if (context.apiKey && !context.apiKey.startsWith('••••')) {
                config.apiKey = context.apiKey;
            } else if (context._preserveApiKey) {
                // Load existing API key if preserving
                var existingConfig = GeminiVerifierModule.loadConfig();
                config.apiKey = existingConfig.apiKey;
            }

            var result = GeminiVerifierModule.saveConfig(config);

            if (result.success) {
                log.audit('saveLLMConfig', 'LLM config saved, enabled: ' + config.enabled);
                return Response.success({ saved: true, message: result.message });
            } else {
                return Response.error('LLM_SAVE_ERROR', result.message);
            }
        } catch (e) {
            log.error('saveLLMConfig', e);
            return Response.error('LLM_SAVE_ERROR', e.message);
        }
    }

    /**
     * Get dashboard preferences for a user
     * Stores per-user settings like skipped documents, layout preferences, etc.
     */
    function getDashboardPrefs(userId) {
        try {
            // If no userId provided, try to get current user
            var effectiveUserId = userId || runtime.getCurrentUser().id;
            var key = 'user_' + effectiveUserId;

            var configSearch = search.create({
                type: 'customrecord_flux_config',
                filters: [
                    ['custrecord_flux_cfg_type', 'is', 'dashboard_prefs'],
                    'AND',
                    ['custrecord_flux_cfg_key', 'is', key],
                    'AND',
                    ['custrecord_flux_cfg_active', 'is', 'T']
                ],
                columns: ['custrecord_flux_cfg_data', 'custrecord_flux_cfg_modified']
            });

            var results = configSearch.run().getRange({ start: 0, end: 1 });

            if (results.length > 0) {
                var dataStr = results[0].getValue('custrecord_flux_cfg_data');
                var prefs = dataStr ? JSON.parse(dataStr) : {};
                return Response.success({
                    userId: effectiveUserId,
                    prefs: prefs,
                    lastModified: results[0].getValue('custrecord_flux_cfg_modified')
                });
            }

            // Return default preferences if none saved
            return Response.success({
                userId: effectiveUserId,
                prefs: {
                    skippedDocIds: [],
                    defaultFilter: 'all',
                    showKeyboardHints: true
                },
                lastModified: null
            });
        } catch (e) {
            log.error('getDashboardPrefs', e);
            return Response.error('PREFS_LOAD_ERROR', e.message);
        }
    }

    /**
     * Save dashboard preferences for a user
     */
    function saveDashboardPrefs(context) {
        try {
            var userId = context.userId || runtime.getCurrentUser().id;
            var key = 'user_' + userId;
            var prefs = context.prefs || {};

            // Find existing config record
            var configSearch = search.create({
                type: 'customrecord_flux_config',
                filters: [
                    ['custrecord_flux_cfg_type', 'is', 'dashboard_prefs'],
                    'AND',
                    ['custrecord_flux_cfg_key', 'is', key]
                ],
                columns: ['internalid']
            });

            var results = configSearch.run().getRange({ start: 0, end: 1 });
            var recordId;

            if (results.length > 0) {
                // Update existing
                recordId = results[0].id;
                record.submitFields({
                    type: 'customrecord_flux_config',
                    id: recordId,
                    values: {
                        'custrecord_flux_cfg_data': JSON.stringify(prefs),
                        'custrecord_flux_cfg_active': true,
                        'custrecord_flux_cfg_modified': new Date(),
                        'custrecord_flux_cfg_modified_by': userId
                    }
                });
            } else {
                // Create new
                var configRec = record.create({
                    type: 'customrecord_flux_config'
                });
                configRec.setValue('custrecord_flux_cfg_type', 'dashboard_prefs');
                configRec.setValue('custrecord_flux_cfg_key', key);
                configRec.setValue('custrecord_flux_cfg_data', JSON.stringify(prefs));
                configRec.setValue('custrecord_flux_cfg_active', true);
                configRec.setValue('custrecord_flux_cfg_modified', new Date());
                configRec.setValue('custrecord_flux_cfg_modified_by', userId);
                recordId = configRec.save();
            }

            log.audit('saveDashboardPrefs', 'Saved prefs for user ' + userId);
            return Response.success({ saved: true, recordId: recordId });
        } catch (e) {
            log.error('saveDashboardPrefs', e);
            return Response.error('PREFS_SAVE_ERROR', e.message);
        }
    }

    /**
     * Test LLM (Gemini) connection
     */
    function testLLMConnection(apiKey, useSavedKey) {
        try {
            if (!GeminiVerifierModule || !GeminiVerifierModule.testConnection) {
                return Response.error('LLM_NOT_AVAILABLE', 'LLM module not available');
            }

            var keyToTest = apiKey;

            // If no API key provided and useSavedKey is true, load from config
            if (!keyToTest && useSavedKey) {
                var savedConfig = GeminiVerifierModule.loadConfig();
                if (savedConfig && savedConfig.apiKey) {
                    keyToTest = savedConfig.apiKey;
                }
            }

            if (!keyToTest) {
                return Response.error('MISSING_API_KEY', 'API key is required');
            }

            var result = GeminiVerifierModule.testConnection(keyToTest);

            if (result.success) {
                return Response.success({
                    connected: true,
                    message: result.message,
                    availableModels: result.availableModels,
                    models: result.models
                });
            } else {
                return Response.error('LLM_CONNECTION_FAILED', result.message);
            }
        } catch (e) {
            log.error('testLLMConnection', e);
            return Response.error('LLM_TEST_ERROR', e.message);
        }
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

        // Processing is triggered automatically by User Event script (FC_Document_UE.js)
        // which fires afterSubmit on all flux_document creates (email, UI, API)

        return Response.success({
            documentId: documentId,
            documentCode: docId,
            fileId: fileId,
            fileName: fileName,
            status: DocStatus.PENDING
        }, 'Document uploaded - processing queued');
    }

    // Note: triggerDocumentProcessing function removed - User Event script (FC_Document_UE.js)
    // now handles MapReduce triggering for all document sources automatically

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

            // Load settings for anomaly detection options
            var settingsResult = getSettings();
            var settings = settingsResult.success ? settingsResult.data : {};

            var engine = new EngineModule.FluxCaptureEngine({
                anomalyDetection: settings.anomalyDetection || {}
            });
            var startTime = Date.now();

            var result = engine.processDocument(fileId, {
                documentType: documentType,
                enableLearning: true
            });

            var processingTime = Date.now() - startTime;

            if (result.success) {
                var extraction = result.extraction;

                // Always require manual review regardless of confidence score
                var newStatus = DocStatus.NEEDS_REVIEW;

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

                // Resolve currency - accepts both numeric IDs and text codes (USD, CAD, etc.)
                if (extraction.fields && extraction.fields.currency) {
                    var resolvedCurrency = resolveCurrencyId(extraction.fields.currency);
                    if (resolvedCurrency) {
                        updateValues['custrecord_flux_currency'] = resolvedCurrency;
                    }
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

    /**
     * Get Email Inbox Status
     * Returns the email capture plugin status and email address
     */
    function getEmailInboxStatus() {
        try {
            var accountId = runtime.accountId;
            var emailAddress = null;
            var pluginEnabled = false;
            var pluginExists = false;
            var scriptInternalId = null;

            // Method 1: Query script table and try to get email address from various sources
            try {
                var scriptQuery = query.runSuiteQL({
                    query: "SELECT id, name, isinactive FROM script WHERE scriptid = 'customscript_fc_email_capture'"
                });

                if (scriptQuery && scriptQuery.results && scriptQuery.results.length > 0) {
                    pluginExists = true;
                    scriptInternalId = scriptQuery.results[0].values[0];
                    pluginEnabled = scriptQuery.results[0].values[2] === 'F';
                    log.audit('Email plugin found', 'ID: ' + scriptInternalId + ', enabled: ' + pluginEnabled);

                    // Try to load the email capture plugin record to get email address
                    try {
                        var pluginRec = record.load({
                            type: 'emailcaptureplugin',
                            id: scriptInternalId
                        });
                        // Try various field names that might contain the email
                        var possibleFields = ['emailaddress', 'email', 'custscript_email', 'address'];
                        for (var i = 0; i < possibleFields.length; i++) {
                            try {
                                var val = pluginRec.getValue({ fieldId: possibleFields[i] });
                                if (val && val.indexOf('@') > -1) {
                                    emailAddress = val;
                                    log.audit('Email found on record', 'Field: ' + possibleFields[i] + ', Value: ' + val);
                                    break;
                                }
                            } catch (fieldErr) {
                                // Field doesn't exist, try next
                            }
                        }

                        // Also try getting all fields to find email
                        if (!emailAddress) {
                            var fields = pluginRec.getFields();
                            log.debug('emailcaptureplugin fields', JSON.stringify(fields));
                        }
                    } catch (loadErr) {
                        log.debug('Could not load emailcaptureplugin record', loadErr.message);
                    }
                }
            } catch (scriptErr) {
                log.debug('Script query failed', scriptErr.message);
            }

            // Method 2: Try querying script deployment for email-related info
            if (!emailAddress && scriptInternalId) {
                try {
                    var deployQuery = query.runSuiteQL({
                        query: "SELECT * FROM scriptdeployment WHERE script = " + scriptInternalId
                    });
                    if (deployQuery && deployQuery.results && deployQuery.results.length > 0) {
                        log.debug('Script deployment data', JSON.stringify(deployQuery.results[0].values));
                    }
                } catch (deployErr) {
                    log.debug('Deployment query failed', deployErr.message);
                }
            }

            // Method 3: Check saved config for email address
            if (!emailAddress) {
                try {
                    var configQuery = query.runSuiteQL({
                        query: "SELECT custrecord_flux_cfg_data FROM customrecord_flux_config " +
                               "WHERE custrecord_flux_cfg_type = 'email_capture' " +
                               "AND custrecord_flux_cfg_key = 'inbox_address' " +
                               "AND custrecord_flux_cfg_active = 'T'"
                    });

                    if (configQuery && configQuery.results && configQuery.results.length > 0) {
                        var configData = configQuery.results[0].values[0];
                        if (configData) {
                            try {
                                var parsed = JSON.parse(configData);
                                emailAddress = parsed.emailAddress;
                            } catch (parseErr) {
                                emailAddress = configData;
                            }
                        }
                    }
                } catch (configErr) {
                    log.debug('Config query error', configErr.message);
                }
            }

            // Get document stats from persistent flux_config
            var documentsToday = 0;
            var documentsTotal = 0;
            var today = format.format({ value: new Date(), type: format.Type.DATE });

            try {
                var statsConfigQuery = query.runSuiteQL({
                    query: "SELECT custrecord_flux_cfg_data FROM customrecord_flux_config " +
                           "WHERE custrecord_flux_cfg_type = 'email_capture' " +
                           "AND custrecord_flux_cfg_key = 'stats' " +
                           "AND custrecord_flux_cfg_active = 'T'"
                });

                if (statsConfigQuery && statsConfigQuery.results && statsConfigQuery.results.length > 0) {
                    var statsData = statsConfigQuery.results[0].values[0];
                    if (statsData) {
                        try {
                            var stats = JSON.parse(statsData);
                            documentsTotal = parseInt(stats.documentsTotal) || 0;
                            // Only show today's count if the date matches
                            if (stats.lastDate === today) {
                                documentsToday = parseInt(stats.documentsToday) || 0;
                            }
                        } catch (parseErr) {
                            log.debug('Stats parse error', parseErr);
                        }
                    }
                }
            } catch (statsErr) {
                log.debug('Stats query error', statsErr);
            }

            var isEnabled = !!emailAddress && pluginEnabled;

            return Response.success({
                enabled: isEnabled,
                pluginExists: pluginExists,
                pluginEnabled: pluginEnabled,
                emailAddress: emailAddress || '',
                accountId: accountId,
                scriptInternalId: scriptInternalId,
                documentsToday: documentsToday,
                documentsTotal: documentsTotal,
                needsConfiguration: pluginExists && !emailAddress
            });
        } catch (e) {
            log.error('getEmailInboxStatus Error', e);
            return Response.success({
                enabled: false,
                pluginExists: false,
                emailAddress: '',
                accountId: runtime.accountId,
                documentsToday: 0,
                documentsTotal: 0,
                error: e.message
            });
        }
    }

    /**
     * Save Email Inbox Configuration
     */
    function saveEmailInboxConfig(context) {
        try {
            var emailAddress = context.emailAddress;

            if (!emailAddress) {
                return Response.error('MISSING_PARAM', 'Email address is required');
            }

            // Validate email format (should be from netsuite.com)
            if (emailAddress.indexOf('@') === -1 || emailAddress.indexOf('netsuite.com') === -1) {
                return Response.error('INVALID_EMAIL', 'Please enter a valid NetSuite email capture address');
            }

            // Check for existing config record
            var existingSearch = search.create({
                type: 'customrecord_flux_config',
                filters: [
                    ['custrecord_flux_cfg_type', 'is', 'email_capture'],
                    'AND',
                    ['custrecord_flux_cfg_key', 'is', 'inbox_address']
                ],
                columns: ['internalid']
            });

            var existingResults = existingSearch.run().getRange({ start: 0, end: 1 });
            var configRecord;

            if (existingResults && existingResults.length > 0) {
                // Update existing
                configRecord = record.load({
                    type: 'customrecord_flux_config',
                    id: existingResults[0].id
                });
            } else {
                // Create new
                configRecord = record.create({
                    type: 'customrecord_flux_config'
                });
                configRecord.setValue('name', 'Email Inbox Address');
                configRecord.setValue('custrecord_flux_cfg_type', 'email_capture');
                configRecord.setValue('custrecord_flux_cfg_key', 'inbox_address');
            }

            configRecord.setValue('custrecord_flux_cfg_data', JSON.stringify({ emailAddress: emailAddress }));
            configRecord.setValue('custrecord_flux_cfg_active', true);
            configRecord.setValue('custrecord_flux_cfg_modified', new Date());

            var savedId = configRecord.save();

            return Response.success({
                configId: savedId,
                emailAddress: emailAddress
            });
        } catch (e) {
            log.error('saveEmailInboxConfig Error', e);
            return Response.error('SAVE_FAILED', e.message);
        }
    }

    /**
     * Get Recent Email Imports
     * Returns the most recent documents imported via email
     */
    function getRecentEmailImports() {
        try {
            var docSearch = search.create({
                type: 'customrecord_flux_document',
                filters: [
                    ['custrecord_flux_source', 'is', '2'] // Source.EMAIL = 2
                ],
                columns: [
                    search.createColumn({ name: 'custrecord_flux_original_filename' }),
                    search.createColumn({ name: 'custrecord_flux_email_sender' }),
                    search.createColumn({ name: 'custrecord_flux_email_subject' }),
                    search.createColumn({ name: 'custrecord_flux_email_received', sort: search.Sort.DESC }),
                    search.createColumn({ name: 'custrecord_flux_status' }),
                    search.createColumn({ name: 'created' })
                ]
            });

            var results = [];
            var searchResults = docSearch.run().getRange({ start: 0, end: 10 });

            searchResults.forEach(function(result) {
                var received = result.getValue('custrecord_flux_email_received') ||
                               result.getValue('created');
                var timeAgo = received ? getTimeAgo(new Date(received)) : '';

                results.push({
                    id: result.id,
                    filename: result.getValue('custrecord_flux_original_filename') || 'Unknown',
                    sender: result.getValue('custrecord_flux_email_sender') || '',
                    subject: result.getValue('custrecord_flux_email_subject') || '',
                    status: result.getValue('custrecord_flux_status'),
                    received: received,
                    timeAgo: timeAgo
                });
            });

            return Response.success(results);
        } catch (e) {
            log.error('getRecentEmailImports Error', e);
            return Response.success([]);
        }
    }

    /**
     * Helper function to format relative time
     */
    function getTimeAgo(date) {
        if (!date) return '';

        var now = new Date();
        var diffMs = now - date;
        var diffMins = Math.floor(diffMs / 60000);
        var diffHours = Math.floor(diffMs / 3600000);
        var diffDays = Math.floor(diffMs / 86400000);

        if (diffMins < 1) return 'just now';
        if (diffMins < 60) return diffMins + 'm ago';
        if (diffHours < 24) return diffHours + 'h ago';
        if (diffDays < 7) return diffDays + 'd ago';

        return format.format({ value: date, type: format.Type.DATE });
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
     * Get all learning records with optional filtering
     * @param {Object} context - Filter parameters
     * @param {string} context.type - Filter by learning type
     * @param {string} context.vendorId - Filter by vendor ID
     * @param {string} context.search - Search in key/data
     * @param {number} context.page - Page number (1-based)
     * @param {number} context.limit - Records per page (default 50)
     */
    function getLearnings(context) {
        try {
            var filterType = context.type || '';
            var filterVendorId = context.vendorId || '';
            var searchQuery = context.search || '';
            var page = parseInt(context.page, 10) || 1;
            var limit = parseInt(context.limit, 10) || 50;
            var offset = (page - 1) * limit;

            // Build WHERE conditions
            var conditions = ["custrecord_flux_cfg_active = 'T'"];
            var params = [];

            // Only include learning-related types (exclude settings, form_definition, etc.)
            var learningTypes = [
                'vendor_alias', 'date_format', 'amount_format', 'account_mapping',
                'department_mapping', 'class_mapping', 'location_mapping',
                'vendor_defaults', 'field_pattern', 'item_mapping', 'custom_field_mapping'
            ];

            if (filterType) {
                conditions.push("custrecord_flux_cfg_type = ?");
                params.push(filterType);
            } else {
                conditions.push("custrecord_flux_cfg_type IN ('" + learningTypes.join("','") + "')");
            }

            if (searchQuery) {
                conditions.push("(LOWER(custrecord_flux_cfg_key) LIKE ? OR LOWER(custrecord_flux_cfg_data) LIKE ?)");
                var searchPattern = '%' + searchQuery.toLowerCase() + '%';
                params.push(searchPattern);
                params.push(searchPattern);
            }

            // Count total records
            var countSql = "SELECT COUNT(*) as total FROM customrecord_flux_config WHERE " + conditions.join(' AND ');
            var countResult = query.runSuiteQL({ query: countSql, params: params });
            var total = countResult.results && countResult.results.length > 0 ? countResult.results[0].values[0] : 0;

            // Get paginated records
            var dataSql = "SELECT id, custrecord_flux_cfg_type, custrecord_flux_cfg_key, " +
                          "custrecord_flux_cfg_data, custrecord_flux_cfg_modified, custrecord_flux_cfg_source " +
                          "FROM customrecord_flux_config " +
                          "WHERE " + conditions.join(' AND ') + " " +
                          "ORDER BY custrecord_flux_cfg_modified DESC NULLS LAST " +
                          "OFFSET " + offset + " ROWS FETCH NEXT " + limit + " ROWS ONLY";

            var results = query.runSuiteQL({ query: dataSql, params: params });
            var learnings = [];

            if (results.results) {
                results.results.forEach(function(row) {
                    var data = {};
                    try {
                        data = JSON.parse(row.values[3] || '{}');
                    } catch (e) {
                        data = { raw: row.values[3] };
                    }

                    // Extract display values based on type
                    var type = row.values[1];
                    var displayInfo = extractLearningDisplayInfo(type, row.values[2], data);

                    learnings.push({
                        id: row.values[0],
                        type: type,
                        key: row.values[2],
                        data: data,
                        modified: row.values[4],
                        source: row.values[5],
                        displayKey: displayInfo.key,
                        displayValue: displayInfo.value,
                        vendorId: data.vendorId || null,
                        vendorName: data.vendorName || null,
                        usageCount: data.usageCount || 0,
                        confidence: data.confidence || null
                    });
                });
            }

            // Filter by vendorId if specified (post-filter since vendorId is in JSON)
            if (filterVendorId) {
                var vendorIdInt = parseInt(filterVendorId, 10);
                learnings = learnings.filter(function(l) {
                    return l.vendorId === vendorIdInt;
                });
                total = learnings.length;
            }

            return Response.success({
                learnings: learnings,
                pagination: {
                    page: page,
                    limit: limit,
                    total: total,
                    totalPages: Math.ceil(total / limit)
                }
            });
        } catch (e) {
            log.error('getLearnings', e.message);
            return Response.error('GET_LEARNINGS_FAILED', e.message);
        }
    }

    /**
     * Extract display-friendly info from learning data
     */
    function extractLearningDisplayInfo(type, key, data) {
        var displayKey = key;
        var displayValue = '';

        switch (type) {
            case 'vendor_alias':
                displayKey = data.aliases ? data.aliases.join(', ') : key;
                displayValue = data.vendorName || ('Vendor ID: ' + data.vendorId);
                break;
            case 'account_mapping':
                displayKey = data.keywords ? data.keywords.join(', ') : key;
                displayValue = 'Account ID: ' + (data.accountId || 'N/A');
                break;
            case 'department_mapping':
            case 'class_mapping':
            case 'location_mapping':
                displayKey = data.keywords ? data.keywords.join(', ') : key;
                displayValue = 'Segment ID: ' + (data.segmentId || 'N/A');
                break;
            case 'vendor_defaults':
                displayKey = 'Vendor: ' + (data.vendorId || 'N/A');
                var defaults = [];
                if (data.defaults) {
                    Object.keys(data.defaults).forEach(function(k) {
                        defaults.push(k + ': ' + data.defaults[k].value);
                    });
                }
                displayValue = defaults.join(', ') || 'No defaults';
                break;
            case 'item_mapping':
                var mappingCount = data.mappings ? data.mappings.length : 0;
                displayKey = 'Vendor: ' + (data.vendorId || 'Global');
                displayValue = mappingCount + ' item mapping(s)';
                break;
            case 'date_format':
                displayKey = 'Vendor: ' + (data.vendorId || 'Global');
                displayValue = 'Format: ' + (data.format || 'N/A');
                break;
            case 'amount_format':
                displayKey = 'Vendor: ' + (data.vendorId || 'Global');
                displayValue = 'Decimal: ' + (data.format === 'PERIOD' ? 'Period (1,234.56)' : 'Comma (1.234,56)');
                break;
            case 'custom_field_mapping':
                var cfMappingCount = data.mappings ? data.mappings.length : 0;
                displayKey = 'Vendor: ' + (data.vendorId || 'Global');
                displayValue = cfMappingCount + ' field mapping(s)';
                break;
            default:
                displayValue = JSON.stringify(data).substring(0, 100);
        }

        return { key: displayKey, value: displayValue };
    }

    /**
     * Get a single learning record by ID
     */
    function getLearning(learningId) {
        if (!learningId) {
            return Response.error('MISSING_PARAM', 'Learning ID is required');
        }

        try {
            var rec = record.load({
                type: 'customrecord_flux_config',
                id: learningId
            });

            var data = {};
            try {
                data = JSON.parse(rec.getValue('custrecord_flux_cfg_data') || '{}');
            } catch (e) {
                data = {};
            }

            return Response.success({
                id: learningId,
                type: rec.getValue('custrecord_flux_cfg_type'),
                key: rec.getValue('custrecord_flux_cfg_key'),
                data: data,
                active: rec.getValue('custrecord_flux_cfg_active'),
                source: rec.getValue('custrecord_flux_cfg_source'),
                modified: rec.getValue('custrecord_flux_cfg_modified')
            });
        } catch (e) {
            return Response.error('GET_LEARNING_FAILED', e.message);
        }
    }

    /**
     * Create a new learning record
     */
    function createLearning(context) {
        var learningType = context.learningType;
        var learningData = context.learningData;

        if (!learningType) {
            return Response.error('MISSING_PARAM', 'Learning type is required');
        }

        if (!learningData) {
            return Response.error('MISSING_PARAM', 'Learning data is required');
        }

        try {
            // Parse data if it's a string
            var data = typeof learningData === 'string' ? JSON.parse(learningData) : learningData;

            // Generate key based on type
            var configKey = generateLearningKey(learningType, data);

            // Check if record with same type+key already exists
            var existingSearch = query.runSuiteQL({
                query: "SELECT id FROM customrecord_flux_config WHERE custrecord_flux_cfg_type = ? AND custrecord_flux_cfg_key = ?",
                params: [learningType, configKey]
            });

            if (existingSearch.results && existingSearch.results.length > 0) {
                return Response.error('DUPLICATE_KEY', 'A learning with this type and key already exists. Use update instead.');
            }

            // Create new record
            var rec = record.create({ type: 'customrecord_flux_config' });
            rec.setValue('name', learningType + '_' + configKey.substring(0, 30));
            rec.setValue('custrecord_flux_cfg_type', learningType);
            rec.setValue('custrecord_flux_cfg_key', configKey);
            rec.setValue('custrecord_flux_cfg_data', JSON.stringify(data));
            rec.setValue('custrecord_flux_cfg_active', true);
            rec.setValue('custrecord_flux_cfg_modified', new Date());
            rec.setValue('custrecord_flux_cfg_modified_by', runtime.getCurrentUser().id);
            rec.setValue('custrecord_flux_cfg_source', 'manual');

            var savedId = rec.save();

            log.audit('createLearning', {
                id: savedId,
                type: learningType,
                key: configKey
            });

            return Response.success({
                id: savedId,
                type: learningType,
                key: configKey,
                message: 'Learning created successfully'
            });
        } catch (e) {
            log.error('createLearning', e.message);
            return Response.error('CREATE_LEARNING_FAILED', e.message);
        }
    }

    /**
     * Generate a key for a learning record based on its type and data
     */
    function generateLearningKey(type, data) {
        switch (type) {
            case 'vendor_alias':
                var aliasText = (data.aliases && data.aliases[0]) || data.aliasText || '';
                return 'alias_' + hashString(aliasText.toLowerCase());
            case 'account_mapping':
                var keyword = (data.keywords && data.keywords[0]) || 'unknown';
                return data.vendorId ? 'vendor_' + data.vendorId + '_' + keyword : 'global_' + keyword;
            case 'department_mapping':
            case 'class_mapping':
            case 'location_mapping':
                return data.vendorId ? 'vendor_' + data.vendorId : 'global_default';
            case 'vendor_defaults':
                return 'vendor_' + (data.vendorId || 'unknown');
            case 'item_mapping':
            case 'custom_field_mapping':
                return data.vendorId ? 'vendor_' + data.vendorId : 'global';
            case 'date_format':
            case 'amount_format':
                return data.vendorId ? 'vendor_' + data.vendorId : 'global_' + type;
            default:
                return 'manual_' + Date.now();
        }
    }

    /**
     * Simple string hash for generating keys
     */
    function hashString(str) {
        var hash = 0;
        for (var i = 0; i < str.length; i++) {
            var char = str.charCodeAt(i);
            hash = ((hash << 5) - hash) + char;
            hash = hash & hash;
        }
        return Math.abs(hash).toString(36);
    }

    /**
     * Update an existing learning record
     */
    function saveLearning(context) {
        var learningId = context.id || context.learningId;
        var learningData = context.learningData;

        if (!learningId) {
            return Response.error('MISSING_PARAM', 'Learning ID is required');
        }

        if (!learningData) {
            return Response.error('MISSING_PARAM', 'Learning data is required');
        }

        try {
            var data = typeof learningData === 'string' ? JSON.parse(learningData) : learningData;

            var rec = record.load({
                type: 'customrecord_flux_config',
                id: learningId
            });

            // Optionally update the key if type-specific data changed
            var currentType = rec.getValue('custrecord_flux_cfg_type');
            var newKey = context.newKey || generateLearningKey(currentType, data);

            rec.setValue('custrecord_flux_cfg_key', newKey);
            rec.setValue('custrecord_flux_cfg_data', JSON.stringify(data));
            rec.setValue('custrecord_flux_cfg_modified', new Date());
            rec.setValue('custrecord_flux_cfg_modified_by', runtime.getCurrentUser().id);

            rec.save();

            log.audit('saveLearning', {
                id: learningId,
                type: currentType,
                key: newKey
            });

            return Response.success({
                id: learningId,
                type: currentType,
                key: newKey,
                message: 'Learning updated successfully'
            });
        } catch (e) {
            log.error('saveLearning', e.message);
            return Response.error('SAVE_LEARNING_FAILED', e.message);
        }
    }

    /**
     * Delete a learning record
     */
    function deleteLearning(learningId) {
        if (!learningId) {
            return Response.error('MISSING_PARAM', 'Learning ID is required');
        }

        try {
            // Load first to log what we're deleting
            var rec = record.load({
                type: 'customrecord_flux_config',
                id: learningId
            });

            var type = rec.getValue('custrecord_flux_cfg_type');
            var key = rec.getValue('custrecord_flux_cfg_key');

            // Delete the record
            record.delete({
                type: 'customrecord_flux_config',
                id: learningId
            });

            log.audit('deleteLearning', {
                id: learningId,
                type: type,
                key: key
            });

            return Response.success({
                id: learningId,
                message: 'Learning deleted successfully'
            });
        } catch (e) {
            log.error('deleteLearning', e.message);
            return Response.error('DELETE_LEARNING_FAILED', e.message);
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

    /**
     * Get all coding suggestions for a document
     * Returns header defaults and line item suggestions based on learned patterns
     * @param {string|number} vendorId - Vendor ID
     * @param {string|Array} lineItems - JSON string or array of line items with descriptions
     */
    function getCodingSuggestions(vendorId, lineItems) {
        if (!vendorId) {
            return Response.success({
                headerDefaults: {},
                lineItemSuggestions: [],
                meta: { hasLearning: false, reason: 'No vendor specified' }
            });
        }

        try {
            // Parse lineItems if it's a JSON string
            var parsedLineItems = [];
            if (lineItems) {
                if (typeof lineItems === 'string') {
                    try {
                        parsedLineItems = JSON.parse(lineItems);
                    } catch (parseErr) {
                        fcDebug.debug('getCodingSuggestions', 'Failed to parse lineItems: ' + parseErr.message);
                    }
                } else if (Array.isArray(lineItems)) {
                    parsedLineItems = lineItems;
                }
            }

            var engine = new FC_Engine.FluxCaptureEngine({ enableLearning: true });
            var suggestions = engine.getSuggestedCoding(parseInt(vendorId), parsedLineItems);

            return Response.success(suggestions);
        } catch (e) {
            log.error('getCodingSuggestions', e.message);
            return Response.error('SUGGESTIONS_FAILED', e.message);
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

    /**
     * Helper to parse date strings from various formats into Date objects
     * Handles ISO 8601, MM/DD/YYYY, YYYY-MM-DD formats
     */
    function parseDateValue(dateVal) {
        if (!dateVal) return null;
        if (dateVal instanceof Date) return dateVal;

        var dateStr = String(dateVal).trim();
        if (!dateStr) return null;

        var parsed = null;

        // Try ISO 8601 format (e.g., 2025-03-12T07:00:00.000Z)
        if (dateStr.indexOf('T') > -1) {
            parsed = new Date(dateStr);
        }
        // Try YYYY-MM-DD format
        else if (/^\d{4}[-\/]\d{1,2}[-\/]\d{1,2}$/.test(dateStr)) {
            var parts = dateStr.split(/[-\/]/);
            parsed = new Date(parseInt(parts[0]), parseInt(parts[1]) - 1, parseInt(parts[2]));
        }
        // Try MM/DD/YYYY format
        else if (/^\d{1,2}[-\/]\d{1,2}[-\/]\d{4}$/.test(dateStr)) {
            var parts = dateStr.split(/[-\/]/);
            parsed = new Date(parseInt(parts[2]), parseInt(parts[0]) - 1, parseInt(parts[1]));
        }
        // Fallback to native parsing
        else {
            parsed = new Date(dateStr);
        }

        // Validate the parsed date
        if (parsed && !isNaN(parsed.getTime())) {
            return parsed;
        }

        log.warn('parseDateValue', 'Could not parse date: ' + dateStr);
        return null;
    }

    /**
     * Currency lookup cache - maps currency codes to internal IDs
     * Populated on first lookup to avoid repeated searches
     */
    var currencyCache = null;

    /**
     * Helper to resolve currency value to NetSuite internal ID
     * Accepts either a numeric ID (passed through) or a currency code (USD, CAD, etc.)
     * @param {string|number} currencyVal - Currency ID or code
     * @returns {number|null} - NetSuite internal ID or null if not found
     */
    function resolveCurrencyId(currencyVal) {
        if (!currencyVal) return null;

        // If already a numeric ID, return it
        if (typeof currencyVal === 'number') {
            return currencyVal;
        }

        var currencyStr = String(currencyVal).trim();
        if (!currencyStr) return null;

        // If it's a numeric string, parse and return
        if (/^\d+$/.test(currencyStr)) {
            return parseInt(currencyStr, 10);
        }

        // It's a currency code (like USD, CAD) - need to look up
        var codeUpper = currencyStr.toUpperCase();

        // Build cache if not already built
        if (!currencyCache) {
            currencyCache = {};
            try {
                var currencySearch = search.create({
                    type: search.Type.CURRENCY,
                    columns: ['internalid', 'symbol', 'name']
                });

                currencySearch.run().each(function(result) {
                    var id = result.getValue('internalid');
                    var symbol = result.getValue('symbol');
                    var name = result.getValue('name');

                    if (symbol) {
                        currencyCache[symbol.toUpperCase()] = parseInt(id, 10);
                    }
                    if (name) {
                        currencyCache[name.toUpperCase()] = parseInt(id, 10);
                    }
                    return true;
                });
            } catch (e) {
                // Search failed - reset cache to allow retry
                currencyCache = {};
            }
        }

        // Return from cache or null if not found
        return currencyCache[codeUpper] || null;
    }

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
                var parsedTrandate = parseDateValue(bodyFields.trandate);
                if (parsedTrandate) {
                    values['custrecord_flux_invoice_date'] = parsedTrandate;
                }
            }
            if (bodyFields.duedate) {
                var parsedDuedate = parseDateValue(bodyFields.duedate);
                if (parsedDuedate) {
                    values['custrecord_flux_due_date'] = parsedDuedate;
                }
            }
            if (bodyFields.total !== undefined) {
                values['custrecord_flux_total_amount'] = bodyFields.total;
            }
            // Resolve currency - accepts both numeric IDs and text codes (USD, CAD, etc.)
            if (bodyFields.currency) {
                var resolvedCurrency = resolveCurrencyId(bodyFields.currency);
                if (resolvedCurrency) {
                    values['custrecord_flux_currency'] = resolvedCurrency;
                }
            }
            // Update document type if changed
            if (bodyFields.documentType) {
                var docTypeValue = parseInt(bodyFields.documentType, 10);
                if (!isNaN(docTypeValue) && docTypeValue > 0) {
                    values['custrecord_flux_document_type'] = docTypeValue;
                }
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
            // Load settings for transaction creation options
            var settingsResult = getSettings();
            var settings = (settingsResult && settingsResult.data) ? settingsResult.data : {};

            var docRecord = record.load({
                type: 'customrecord_flux_document',
                id: documentId
            });

            var vendorId = docRecord.getValue('custrecord_flux_vendor');
            var documentType = docRecord.getValue('custrecord_flux_document_type');
            var fileId = docRecord.getValue('custrecord_flux_source_file');
            var originalFilename = docRecord.getValue('custrecord_flux_original_filename');

            var transactionId = null;
            var actualTransactionType = transactionType;
            var fileAttached = false;
            var documentDeleted = false;
            var warnings = [];

            // Determine transaction type
            if (!actualTransactionType) {
                if (documentType === DocType.EXPENSE_REPORT) {
                    actualTransactionType = 'expensereport';
                } else if (documentType === DocType.CREDIT_MEMO) {
                    actualTransactionType = 'vendorcredit';
                } else if (documentType === DocType.PURCHASE_ORDER) {
                    actualTransactionType = 'purchaseorder';
                } else {
                    actualTransactionType = 'vendorbill';
                }
            }

            // Load form data for validation and transaction creation
            var formData = JSON.parse(docRecord.getValue('custrecord_flux_form_data') || 'null');

            // Fallback to legacy fields if no formData
            if (!formData) {
                formData = {
                    bodyFields: {
                        entity: vendorId,
                        tranid: docRecord.getValue('custrecord_flux_invoice_number'),
                        trandate: docRecord.getValue('custrecord_flux_invoice_date'),
                        duedate: docRecord.getValue('custrecord_flux_due_date'),
                        total: docRecord.getValue('custrecord_flux_total_amount'),
                        currency: docRecord.getValue('custrecord_flux_currency')
                    },
                    sublists: {
                        expense: JSON.parse(docRecord.getValue('custrecord_flux_line_items') || '[]')
                    }
                };
            }

            // ===== VALIDATION =====
            var validation = validateForTransaction(formData, actualTransactionType);
            if (!validation.valid) {
                return Response.error('VALIDATION_FAILED', 'Document failed validation', {
                    errors: validation.errors,
                    warnings: validation.warnings
                });
            }
            warnings = validation.warnings;

            // ===== CREATE TRANSACTION =====
            if (createTransaction && (vendorId || actualTransactionType === 'expensereport')) {
                transactionId = createTransactionFromDocument(docRecord, actualTransactionType);

                // ===== FILE ATTACHMENT (if enabled) =====
                if (transactionId && settings.attachFileToTransaction && fileId) {
                    try {
                        moveAndAttachFile(fileId, originalFilename, actualTransactionType, transactionId);
                        fileAttached = true;
                        fileId = null; // File has been moved, don't delete again later
                    } catch (attachErr) {
                        log.error('approveDocument.fileAttachment', attachErr);
                        warnings.push({ field: 'file', message: 'Could not attach file: ' + attachErr.message });
                    }
                }
            }

            // ===== LEARNING (before potential deletion) =====
            var learningResult = null;
            if (vendorId && formData) {
                try {
                    var engine = new FC_Engine.FluxCaptureEngine({ enableLearning: true });

                    // Extract header fields for learning
                    var headerFields = {};
                    var bodyFields = formData.bodyFields || {};
                    if (bodyFields.department) headerFields.department = bodyFields.department;
                    if (bodyFields.class) headerFields.class = bodyFields.class;
                    if (bodyFields.location) headerFields.location = bodyFields.location;
                    if (bodyFields.terms) headerFields.terms = bodyFields.terms;

                    // Extract line items for learning
                    var lineItems = [];
                    var sublists = formData.sublists || {};
                    var expenseLines = sublists.expense || sublists.item || [];
                    for (var i = 0; i < expenseLines.length; i++) {
                        var line = expenseLines[i];
                        lineItems.push({
                            description: line.memo || line.description || '',
                            account: line.account || line.expenseaccount || '',
                            department: line.department || '',
                            class: line.class || '',
                            location: line.location || '',
                            item: line.item || ''
                        });
                    }

                    // Learn from this approval
                    learningResult = engine.learnFromApproval({
                        vendorId: parseInt(vendorId),
                        headerFields: headerFields,
                        lineItems: lineItems
                    });

                    log.audit('FluxCapture.ApprovalLearning', {
                        vendorId: vendorId,
                        documentId: documentId,
                        headerFieldsLearned: Object.keys(headerFields).length,
                        lineItemsLearned: lineItems.length,
                        success: learningResult ? learningResult.success : false
                    });
                } catch (learnErr) {
                    // Don't fail the approval if learning fails
                    log.error('FluxCapture.ApprovalLearning', learnErr.message);
                }
            }

            // ===== CLEANUP OR UPDATE STATUS =====
            if (transactionId && settings.deleteDocumentOnSuccess) {
                // Delete the flux document record
                record.delete({ type: 'customrecord_flux_document', id: documentId });
                documentDeleted = true;

                // Delete source file if not already moved during attachment
                if (fileId) {
                    try {
                        file.delete({ id: fileId });
                    } catch (delErr) {
                        log.debug('approveDocument.fileCleanup', 'Could not delete file: ' + delErr.message);
                    }
                }

                log.audit('FluxCapture.DocumentCleanup', {
                    documentId: documentId,
                    transactionId: transactionId,
                    fileDeleted: !!fileId
                });
            } else {
                // Just update status to completed
                record.submitFields({
                    type: 'customrecord_flux_document',
                    id: documentId,
                    values: {
                        'custrecord_flux_status': DocStatus.COMPLETED,
                        'custrecord_flux_created_transaction': transactionId ? String(transactionId) : '',
                        'custrecord_flux_modified_date': new Date()
                    }
                });
            }

            return Response.success({
                documentId: documentId,
                transactionId: transactionId,
                transactionType: actualTransactionType,
                status: DocStatus.COMPLETED,
                learned: learningResult ? learningResult.success : false,
                fileAttached: fileAttached,
                documentDeleted: documentDeleted,
                warnings: warnings
            }, 'Document approved');
        } catch (e) {
            log.error('Approve error', { name: e.name, message: e.message, stack: e.stack, id: e.id });
            // Check for validation error type
            if (e.type === 'VALIDATION_ERROR') {
                return Response.error('VALIDATION_FAILED', e.message, {
                    errors: e.errors || [],
                    warnings: e.warnings || []
                });
            }
            // Include more error details for debugging
            var errorMessage = e.message || 'Unknown error';
            if (e.name && e.name !== 'Error') {
                errorMessage = e.name + ': ' + errorMessage;
            }
            return Response.error('APPROVE_FAILED', errorMessage, {
                errors: [{ field: null, message: errorMessage }],
                errorType: e.name,
                errorId: e.id || null
            });
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
        try {
            var settingsData = {
                defaultDocumentType: context.defaultDocumentType || 'auto',
                duplicateDetection: context.duplicateDetection !== false,
                amountValidation: context.amountValidation !== false,
                defaultLineSublist: context.defaultLineSublist || 'auto'
            };

            // Find existing settings record or create new one
            var existingId = null;
            var configSearch = search.create({
                type: 'customrecord_flux_config',
                filters: [
                    ['custrecord_flux_cfg_type', 'is', 'settings'],
                    'AND',
                    ['custrecord_flux_cfg_key', 'is', 'general']
                ],
                columns: ['internalid']
            });
            var results = configSearch.run().getRange({ start: 0, end: 1 });
            if (results.length > 0) {
                existingId = results[0].id;
            }

            var configRecord;
            if (existingId) {
                configRecord = record.load({
                    type: 'customrecord_flux_config',
                    id: existingId
                });
            } else {
                configRecord = record.create({
                    type: 'customrecord_flux_config'
                });
                configRecord.setValue('custrecord_flux_cfg_type', 'settings');
                configRecord.setValue('custrecord_flux_cfg_key', 'general');
            }

            configRecord.setValue('custrecord_flux_cfg_data', JSON.stringify(settingsData));
            configRecord.setValue('custrecord_flux_cfg_active', true);
            configRecord.setValue('custrecord_flux_cfg_modified', new Date());
            configRecord.setValue('custrecord_flux_cfg_modified_by', runtime.getCurrentUser().id);

            var savedId = configRecord.save();
            log.audit('updateSettings', 'Settings saved to config record: ' + savedId);

            return Response.success({ message: 'Settings saved', id: savedId });
        } catch (e) {
            log.error('updateSettings', e);
            return Response.error('SETTINGS_SAVE_ERROR', e.message);
        }
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
                columns: ['internalid', 'custrecord_flux_source_file']
            });

            var deletedCount = 0;
            var deletedFiles = 0;

            docSearch.run().each(function(result) {
                var fileId = result.getValue('custrecord_flux_source_file');

                // Delete the document record
                record.delete({ type: 'customrecord_flux_document', id: result.id });
                deletedCount++;

                // Delete the associated cabinet file
                if (fileId) {
                    try {
                        file.delete({ id: fileId });
                        deletedFiles++;
                    } catch (e) {
                        fcDebug.debug('File delete skipped during clear', e.message);
                    }
                }

                return true;
            });

            return Response.success({
                deletedDocuments: deletedCount,
                deletedFiles: deletedFiles,
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

    // ==================== Transaction Creation Helpers ====================

    /**
     * Validate form data before transaction creation
     * Uses form schema to check all mandatory fields
     * @param {Object} formData - The form data to validate
     * @param {string} transactionType - Type of transaction to create
     * @returns {Object} Validation result with valid, errors, and warnings arrays
     */
    function validateForTransaction(formData, transactionType) {
        var errors = [];
        var warnings = [];
        var bodyFields = formData.bodyFields || {};
        var sublists = formData.sublists || {};

        // Load form schema to get mandatory field definitions
        var FormSchemaModule = null;
        try {
            FormSchemaModule = require('./FC_FormSchemaExtractor');
        } catch (e) {
            log.debug('validateForTransaction', 'Could not load FormSchemaExtractor: ' + e.message);
        }

        var schema = null;
        if (FormSchemaModule && FormSchemaModule.getSchema) {
            try {
                schema = FormSchemaModule.getSchema(transactionType);
            } catch (e) {
                log.debug('validateForTransaction', 'Could not get schema: ' + e.message);
            }
        }

        // ===== SCHEMA-BASED MANDATORY FIELD VALIDATION =====
        if (schema && schema.bodyFields) {
            schema.bodyFields.forEach(function(fieldDef) {
                if (fieldDef.mandatory && fieldDef.id) {
                    var value = bodyFields[fieldDef.id];
                    // Check if value is empty
                    if (value === undefined || value === null || value === '') {
                        errors.push({
                            field: fieldDef.id,
                            message: (fieldDef.label || fieldDef.id) + ' is required'
                        });
                    }
                }
            });
        }

        // ===== FALLBACK CORE FIELD VALIDATION (if no schema) =====
        if (!schema) {
            // Entity is always required
            if (!bodyFields.entity) {
                var entityLabel = transactionType === 'expensereport' ? 'Employee' : 'Vendor';
                errors.push({ field: 'entity', message: entityLabel + ' is required' });
            }

            // Date is required
            if (!bodyFields.trandate) {
                errors.push({ field: 'trandate', message: 'Transaction date is required' });
            }
        }

        // Total amount validation (always check)
        var total = parseFloat(bodyFields.total) || parseFloat(bodyFields.usertotal) || 0;
        if (total <= 0) {
            errors.push({ field: 'total', message: 'Total amount must be greater than zero' });
        }

        // ===== LINE ITEM VALIDATION =====
        var expenseLines = sublists.expense || [];
        var itemLines = sublists.item || [];
        var hasLines = expenseLines.length > 0 || itemLines.length > 0;

        if (!hasLines) {
            // No lines - will use fallback single line with total
            warnings.push({ field: 'sublists', message: 'No line items - will create single expense line with total amount' });
        } else {
            // Get sublist field definitions from schema
            var expenseFieldDefs = [];
            var itemFieldDefs = [];
            if (schema && schema.sublists) {
                schema.sublists.forEach(function(sl) {
                    if (sl.id === 'expense' && sl.fields) {
                        expenseFieldDefs = sl.fields;
                    } else if (sl.id === 'item' && sl.fields) {
                        itemFieldDefs = sl.fields;
                    }
                });
            }

            // Validate each expense line
            expenseLines.forEach(function(line, idx) {
                // Check mandatory fields from schema
                expenseFieldDefs.forEach(function(fieldDef) {
                    if (fieldDef.mandatory && fieldDef.id) {
                        var value = line[fieldDef.id];
                        if (value === undefined || value === null || value === '') {
                            errors.push({
                                field: 'expense[' + idx + '].' + fieldDef.id,
                                message: 'Expense line ' + (idx + 1) + ': ' + (fieldDef.label || fieldDef.id) + ' is required'
                            });
                        }
                    }
                });
                // Fallback: ensure account or category
                if (expenseFieldDefs.length === 0) {
                    if (!line.account && !line.category) {
                        errors.push({
                            field: 'expense[' + idx + '].account',
                            message: 'Expense line ' + (idx + 1) + ' requires an account or category'
                        });
                    }
                }
                // Amount validation
                var lineAmount = parseFloat(line.amount) || 0;
                if (lineAmount <= 0) {
                    errors.push({
                        field: 'expense[' + idx + '].amount',
                        message: 'Expense line ' + (idx + 1) + ' requires a positive amount'
                    });
                }
            });

            // Validate each item line
            itemLines.forEach(function(line, idx) {
                // Check mandatory fields from schema
                itemFieldDefs.forEach(function(fieldDef) {
                    if (fieldDef.mandatory && fieldDef.id) {
                        var value = line[fieldDef.id];
                        if (value === undefined || value === null || value === '') {
                            errors.push({
                                field: 'item[' + idx + '].' + fieldDef.id,
                                message: 'Item line ' + (idx + 1) + ': ' + (fieldDef.label || fieldDef.id) + ' is required'
                            });
                        }
                    }
                });
                // Fallback: ensure item is set
                if (itemFieldDefs.length === 0) {
                    if (!line.item) {
                        errors.push({
                            field: 'item[' + idx + '].item',
                            message: 'Item line ' + (idx + 1) + ' requires an item'
                        });
                    }
                }
            });

            // ===== TOTAL RECONCILIATION (warning only) =====
            var lineTotal = 0;
            expenseLines.forEach(function(line) { lineTotal += parseFloat(line.amount) || 0; });
            itemLines.forEach(function(line) { lineTotal += parseFloat(line.amount) || 0; });

            if (Math.abs(lineTotal - total) > 0.01) {
                warnings.push({
                    field: 'total',
                    message: 'Line items total (' + lineTotal.toFixed(2) + ') differs from header total (' + total.toFixed(2) + ')'
                });
            }
        }

        // ===== DATE VALIDATION =====

        if (bodyFields.trandate) {
            var tranDate = new Date(bodyFields.trandate);
            var today = new Date();
            today.setHours(23, 59, 59, 999); // End of today

            // Future date warning
            if (tranDate > today) {
                warnings.push({ field: 'trandate', message: 'Transaction date is in the future' });
            }

            // Due date before transaction date
            if (bodyFields.duedate) {
                var dueDate = new Date(bodyFields.duedate);
                if (dueDate < tranDate) {
                    errors.push({ field: 'duedate', message: 'Due date cannot be before transaction date' });
                }
            }
        }

        return {
            valid: errors.length === 0,
            errors: errors,
            warnings: warnings
        };
    }

    /**
     * Get or create the Transaction Attachments folder
     * @returns {number} Folder internal ID
     */
    function getTransactionAttachmentFolder() {
        // Look for existing folder
        var folderSearch = search.create({
            type: 'folder',
            filters: [['name', 'is', 'Transaction Attachments']],
            columns: ['internalid']
        });

        var results = folderSearch.run().getRange({ start: 0, end: 1 });
        if (results.length > 0) {
            return results[0].id;
        }

        // Create folder
        var folderRecord = record.create({ type: 'folder' });
        folderRecord.setValue('name', 'Transaction Attachments');
        folderRecord.setValue('description', 'Source documents attached to transactions via Flux Capture');
        return folderRecord.save();
    }

    /**
     * Move file to Transaction Attachments folder and attach to transaction
     * @param {number} fileId - Original file ID
     * @param {string} originalFilename - Original filename
     * @param {string} transactionType - Type of transaction (vendorbill, etc.)
     * @param {number} transactionId - Transaction internal ID
     * @returns {number} New file ID in target folder
     */
    function moveAndAttachFile(fileId, originalFilename, transactionType, transactionId) {
        try {
            // Get the target folder
            var targetFolderId = getTransactionAttachmentFolder();

            // Load original file
            var originalFile = file.load({ id: fileId });
            var fileContents = originalFile.getContents();
            var fileType = originalFile.fileType;

            // Create new file in target folder with descriptive name
            var typePrefix = (transactionType || 'TXN').toUpperCase();
            var newFileName = typePrefix + '_' + transactionId + '_' + (originalFilename || 'attachment.pdf');

            var newFile = file.create({
                name: newFileName,
                fileType: fileType,
                contents: fileContents,
                folder: targetFolderId,
                isOnline: true
            });
            var newFileId = newFile.save();

            // Attach to transaction
            // Map transaction type to record type
            var recordTypeMap = {
                'vendorbill': record.Type.VENDOR_BILL,
                'vendorcredit': record.Type.VENDOR_CREDIT,
                'expensereport': record.Type.EXPENSE_REPORT,
                'purchaseorder': record.Type.PURCHASE_ORDER
            };
            var recordType = recordTypeMap[transactionType] || transactionType;

            record.attach({
                record: { type: 'file', id: newFileId },
                to: { type: recordType, id: transactionId }
            });

            // Delete original file from Flux uploads folder
            try {
                file.delete({ id: fileId });
            } catch (delErr) {
                log.debug('moveAndAttachFile', 'Could not delete original file ' + fileId + ': ' + delErr.message);
            }

            log.audit('moveAndAttachFile', {
                originalFileId: fileId,
                newFileId: newFileId,
                transactionType: transactionType,
                transactionId: transactionId
            });

            return newFileId;
        } catch (e) {
            log.error('moveAndAttachFile', e);
            throw e;
        }
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

        // Known date fields that need conversion
        var dateFields = ['trandate', 'duedate', 'postingperiod', 'startdate', 'enddate', 'expensedate', 'expectedreceiptdate'];

        // Helper to check if a field is a date field
        function isDateField(fieldId) {
            if (!fieldId) return false;
            var lowerFieldId = fieldId.toLowerCase();
            // Check known date fields or fields ending in 'date'
            return dateFields.indexOf(lowerFieldId) !== -1 || lowerFieldId.match(/date$/);
        }

        // Helper to set body field value safely
        function setBodyField(txn, fieldId, value) {
            if (!fieldId || value === undefined || value === null || value === '') return;
            if (shouldSkipField(fieldId)) return;

            try {
                var valueToSet = value;
                // Convert date fields to proper Date objects
                if (isDateField(fieldId) && !(value instanceof Date)) {
                    valueToSet = parseDateValue(value);
                    if (!valueToSet) {
                        log.debug('setBodyField', 'Could not parse date for ' + fieldId + ': ' + value);
                        return;
                    }
                }
                txn.setValue({ fieldId: fieldId, value: valueToSet });
            } catch (e) {
                log.debug('setBodyField', 'Could not set ' + fieldId + ': ' + e.message);
            }
        }

        // Helper to set sublist field value safely
        function setSublistField(txn, sublistId, fieldId, value) {
            if (!fieldId || value === undefined || value === null || value === '') return;
            if (shouldSkipField(fieldId)) return;

            try {
                var valueToSet = value;
                // Convert date fields to proper Date objects
                if (isDateField(fieldId) && !(value instanceof Date)) {
                    valueToSet = parseDateValue(value);
                    if (!valueToSet) {
                        log.debug('setSublistField', 'Could not parse date for ' + sublistId + '.' + fieldId + ': ' + value);
                        return;
                    }
                }
                txn.setCurrentSublistValue({ sublistId: sublistId, fieldId: fieldId, value: valueToSet });
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

            // Set all body fields from formData (entity can be any employee)
            Object.keys(bodyFields).forEach(function(fieldId) {
                setBodyField(txnRecord, fieldId, bodyFields[fieldId]);
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

        if (!txnRecord) {
            return null;
        }

        // Validate required fields before save
        var validationErrors = [];

        // Check for line items
        var expenseCount = txnRecord.getLineCount({ sublistId: 'expense' });
        var itemCount = 0;
        try { itemCount = txnRecord.getLineCount({ sublistId: 'item' }); } catch (e) { /* item sublist may not exist */ }

        if (expenseCount === 0 && itemCount === 0) {
            validationErrors.push({ field: 'sublists', message: 'At least one expense or item line is required' });
        }

        // Check expense lines have account
        for (var i = 0; i < expenseCount; i++) {
            var account = txnRecord.getSublistValue({ sublistId: 'expense', fieldId: 'account', line: i });
            if (!account) {
                validationErrors.push({ field: 'expense[' + i + '].account', message: 'Account is required for expense line ' + (i + 1) });
            }
        }

        // Check item lines have item
        for (var j = 0; j < itemCount; j++) {
            var item = txnRecord.getSublistValue({ sublistId: 'item', fieldId: 'item', line: j });
            if (!item) {
                validationErrors.push({ field: 'item[' + j + '].item', message: 'Item is required for item line ' + (j + 1) });
            }
        }

        if (validationErrors.length > 0) {
            var validationError = error.create({
                name: 'VALIDATION_ERROR',
                message: 'Transaction validation failed'
            });
            validationError.type = 'VALIDATION_ERROR';
            validationError.errors = validationErrors;
            throw validationError;
        }

        // Try to save and capture detailed error
        try {
            return txnRecord.save();
        } catch (saveError) {
            log.error('Transaction save failed', {
                name: saveError.name,
                message: saveError.message,
                id: saveError.id,
                stack: saveError.stack
            });
            throw saveError;
        }
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
