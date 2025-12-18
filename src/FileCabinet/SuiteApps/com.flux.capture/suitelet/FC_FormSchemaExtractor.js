/**
 * @NApiVersion 2.1
 * @NModuleScope Public
 * @module FC_FormSchemaExtractor
 *
 * Form Schema Extractor - Dynamically extracts NetSuite form metadata
 *
 * Strategy:
 * 1. Server-side: Extract ALL fields and sublists from N/record dynamically
 * 2. Client-side: DOM extraction captures actual form layout (tabs, groups, order, visibility)
 * 3. Storage: All data persisted to customrecord_flux_config (NOT N/cache)
 *
 * Config Types:
 * - form_schema: Server-extracted field metadata (types, labels, options)
 * - form_layout: Client-extracted DOM layout (tabs, groups, visibility, order)
 * - form_config: User-customized form definition (from XML upload or manual)
 *
 * NO HARDCODED LAYOUTS - Everything is extracted dynamically or user-configured
 */

define(['N/record', 'N/search', 'N/log', 'N/query', 'N/runtime'],
function(record, search, log, query, runtime) {

    // Schema version for migrations (bump to invalidate old configs)
    var SCHEMA_VERSION = 6;

    // Config record type
    var CONFIG_RECORD_TYPE = 'customrecord_flux_config';

    // Config types
    var CONFIG_TYPE = {
        SCHEMA: 'form_schema',
        LAYOUT: 'form_layout',
        CONFIG: 'form_config'  // User customized
    };

    // Source types
    var SOURCE_TYPE = {
        SERVER_EXTRACT: 'server_extract',
        CLIENT_CAPTURE: 'client_capture',
        XML_UPLOAD: 'xml_upload',
        MANUAL: 'manual'
    };

    // Known sublists by record type (these exist on the record, not form-specific)
    var RECORD_SUBLISTS = {
        'vendorbill': ['expense', 'item', 'landedcost'],
        'expensereport': ['expense'],
        'vendorcredit': ['expense', 'item'],
        'purchaseorder': ['expense', 'item'],
        'invoice': ['item'],
        'salesorder': ['item'],
        'journalentry': ['line']
    };

    // Fields to skip (internal/system fields)
    var SKIP_FIELDS = ['ntype', 'recordtype', 'nsapiCT', 'sys_id', 'sys_parentid'];

    // ==========================================
    // RECORD TYPE UTILITIES
    // ==========================================

    /**
     * Get record type enum from string
     */
    function getRecordType(transactionType) {
        var typeMap = {
            'vendorbill': record.Type.VENDOR_BILL,
            'vendor_bill': record.Type.VENDOR_BILL,
            'bill': record.Type.VENDOR_BILL,
            'expensereport': record.Type.EXPENSE_REPORT,
            'expense_report': record.Type.EXPENSE_REPORT,
            'vendorcredit': record.Type.VENDOR_CREDIT,
            'vendor_credit': record.Type.VENDOR_CREDIT,
            'purchaseorder': record.Type.PURCHASE_ORDER,
            'purchase_order': record.Type.PURCHASE_ORDER,
            'invoice': record.Type.INVOICE,
            'salesorder': record.Type.SALES_ORDER,
            'journalentry': record.Type.JOURNAL_ENTRY
        };
        return typeMap[transactionType.toLowerCase()] || null;
    }

    /**
     * Normalize record type string
     */
    function normalizeRecordType(transactionType) {
        var normalMap = {
            'vendorbill': 'vendorbill',
            'vendor_bill': 'vendorbill',
            'bill': 'vendorbill',
            'expensereport': 'expensereport',
            'expense_report': 'expensereport',
            'vendorcredit': 'vendorcredit',
            'vendor_credit': 'vendorcredit',
            'purchaseorder': 'purchaseorder',
            'purchase_order': 'purchaseorder',
            'invoice': 'invoice',
            'salesorder': 'salesorder',
            'journalentry': 'journalentry'
        };
        return normalMap[transactionType.toLowerCase()] || transactionType.toLowerCase();
    }

    // ==========================================
    // CONFIG RECORD STORAGE (Replaces N/cache)
    // ==========================================

    /**
     * Find config record by type, key, and optionally form ID
     * @returns {number|null} Internal ID of config record or null
     */
    function findConfigRecord(configType, recordType, formId) {
        try {
            var sql = "SELECT id FROM " + CONFIG_RECORD_TYPE + " WHERE " +
                "custrecord_flux_cfg_type = ? AND custrecord_flux_cfg_key = ?";
            var params = [configType, recordType];

            if (formId) {
                sql += " AND custrecord_flux_cfg_form_id = ?";
                params.push(String(formId));
            } else {
                sql += " AND (custrecord_flux_cfg_form_id IS NULL OR custrecord_flux_cfg_form_id = '')";
            }

            sql += " AND custrecord_flux_cfg_active = 'T' ORDER BY id DESC";

            var results = query.runSuiteQL({ query: sql, params: params }).asMappedResults();
            return results.length > 0 ? results[0].id : null;
        } catch (e) {
            log.debug('findConfigRecord', 'Not found: ' + e.message);
            return null;
        }
    }

    /**
     * Load config data from record
     * @returns {Object|null} Parsed JSON data or null
     */
    function loadConfigData(configType, recordType, formId) {
        try {
            var recordId = findConfigRecord(configType, recordType, formId);
            if (!recordId) return null;

            var configRec = record.load({
                type: CONFIG_RECORD_TYPE,
                id: recordId
            });

            var dataJson = configRec.getValue('custrecord_flux_cfg_data');
            if (!dataJson) return null;

            var data = JSON.parse(dataJson);
            data._configId = recordId;
            data._version = configRec.getValue('custrecord_flux_cfg_version');
            data._source = configRec.getValue('custrecord_flux_cfg_source');
            data._modified = configRec.getValue('custrecord_flux_cfg_modified');

            return data;
        } catch (e) {
            log.debug('loadConfigData', 'Error loading ' + configType + '/' + recordType + ': ' + e.message);
            return null;
        }
    }

    /**
     * Save config data to record (create or update)
     */
    function saveConfigData(configType, recordType, formId, data, source) {
        try {
            var existingId = findConfigRecord(configType, recordType, formId);
            var configRec;

            // Generate a descriptive name for the record
            var recordName = configType + '_' + recordType + (formId ? '_' + formId : '');

            if (existingId) {
                configRec = record.load({
                    type: CONFIG_RECORD_TYPE,
                    id: existingId
                });
            } else {
                configRec = record.create({
                    type: CONFIG_RECORD_TYPE
                });
                // Set the required Name field
                configRec.setValue('name', recordName);
                configRec.setValue('custrecord_flux_cfg_type', configType);
                configRec.setValue('custrecord_flux_cfg_key', recordType);
                if (formId) {
                    configRec.setValue('custrecord_flux_cfg_form_id', String(formId));
                }
            }

            // Clean data before saving (remove internal fields)
            var dataToSave = JSON.parse(JSON.stringify(data));
            delete dataToSave._configId;
            delete dataToSave._version;
            delete dataToSave._source;
            delete dataToSave._modified;
            delete dataToSave._cached;

            configRec.setValue('custrecord_flux_cfg_data', JSON.stringify(dataToSave));
            configRec.setValue('custrecord_flux_cfg_version', SCHEMA_VERSION);
            configRec.setValue('custrecord_flux_cfg_source', source || SOURCE_TYPE.SERVER_EXTRACT);
            configRec.setValue('custrecord_flux_cfg_active', true);
            configRec.setValue('custrecord_flux_cfg_modified', new Date());

            try {
                var userId = runtime.getCurrentUser().id;
                if (userId) {
                    configRec.setValue('custrecord_flux_cfg_modified_by', userId);
                }
            } catch (e) { /* ignore */ }

            var savedId = configRec.save();
            log.audit('saveConfigData', 'Saved ' + configType + ' for ' + recordType + ' (ID: ' + savedId + ')');

            return { success: true, id: savedId };
        } catch (e) {
            log.error('saveConfigData', e.message);
            return { success: false, error: e.message };
        }
    }

    /**
     * Delete config record
     */
    function deleteConfigRecord(configType, recordType, formId) {
        try {
            var recordId = findConfigRecord(configType, recordType, formId);
            if (recordId) {
                record.delete({ type: CONFIG_RECORD_TYPE, id: recordId });
                return { success: true };
            }
            return { success: true, message: 'No record to delete' };
        } catch (e) {
            return { success: false, error: e.message };
        }
    }

    // ==========================================
    // SCHEMA FUNCTIONS (Server-extracted metadata)
    // ==========================================

    /**
     * Get cached schema from config record
     */
    function getCachedSchema(recordType, formId) {
        var normalizedType = normalizeRecordType(recordType);
        var data = loadConfigData(CONFIG_TYPE.SCHEMA, normalizedType, formId);
        if (data) {
            data._cached = true;
        }
        return data;
    }

    /**
     * Save schema to config record
     */
    function saveSchemaToConfig(recordType, formId, schema) {
        var normalizedType = normalizeRecordType(recordType);
        return saveConfigData(CONFIG_TYPE.SCHEMA, normalizedType, formId, schema, SOURCE_TYPE.SERVER_EXTRACT);
    }

    // ==========================================
    // LAYOUT FUNCTIONS (Client-extracted DOM layout)
    // ==========================================

    /**
     * Get cached layout from config record
     */
    function getCachedLayout(recordType, formId) {
        var normalizedType = normalizeRecordType(recordType);
        return loadConfigData(CONFIG_TYPE.LAYOUT, normalizedType, formId);
    }

    /**
     * Save layout to config record
     */
    function saveLayoutToConfig(recordType, formId, layout) {
        var normalizedType = normalizeRecordType(recordType);
        return saveConfigData(CONFIG_TYPE.LAYOUT, normalizedType, formId, layout, SOURCE_TYPE.CLIENT_CAPTURE);
    }

    // ==========================================
    // USER CONFIG FUNCTIONS (XML upload / Manual)
    // ==========================================

    /**
     * Get user-customized form config
     */
    function getUserFormConfig(recordType, formId) {
        var normalizedType = normalizeRecordType(recordType);
        return loadConfigData(CONFIG_TYPE.CONFIG, normalizedType, formId);
    }

    /**
     * Save user-customized form config
     * @param {string} source - 'xml_upload' or 'manual'
     */
    function saveUserFormConfig(recordType, formId, config, source) {
        var normalizedType = normalizeRecordType(recordType);
        return saveConfigData(CONFIG_TYPE.CONFIG, normalizedType, formId, config, source);
    }

    // ==========================================
    // FIELD EXTRACTION
    // ==========================================

    /**
     * Extract field metadata from record
     */
    function extractFieldMetadata(tempRecord, fieldId, displayOrder) {
        var fieldInfo = {
            id: fieldId,
            label: fieldId,
            type: 'text',
            mandatory: false,
            isDisplay: true,
            isCustom: fieldId.indexOf('custbody') === 0 || fieldId.indexOf('custcol') === 0,
            displayOrder: displayOrder
        };

        try {
            var field = tempRecord.getField({ fieldId: fieldId });
            if (field) {
                fieldInfo.label = field.label || fieldId;
                fieldInfo.type = field.type || 'text';
                fieldInfo.mandatory = field.isMandatory || false;
                fieldInfo.isDisplay = field.isDisplay !== false;
                fieldInfo.isDisabled = field.isDisabled || false;
                fieldInfo.help = field.help || '';

                // Get select options
                if (field.type === 'select' || field.type === 'multiselect') {
                    try {
                        var options = field.getSelectOptions({ filter: null });
                        if (options && options.length > 0 && options.length <= 200) {
                            fieldInfo.options = options.map(function(opt) {
                                return { value: opt.value, text: opt.text };
                            });
                        } else if (options) {
                            fieldInfo.hasOptions = true;
                            fieldInfo.optionCount = options.length;
                            fieldInfo.lookupRequired = options.length > 200;
                        }
                    } catch (e) { /* ignore */ }
                }
            }
        } catch (e) {
            log.debug('extractFieldMetadata', 'Error for ' + fieldId + ': ' + e.message);
        }

        return fieldInfo;
    }

    /**
     * Extract sublist field metadata
     */
    function extractSublistFieldMetadata(tempRecord, sublistId, fieldId, displayOrder) {
        var fieldInfo = {
            id: fieldId,
            label: fieldId,
            type: 'text',
            mandatory: false,
            isDisplay: true,
            isCustom: fieldId.indexOf('custcol') === 0,
            displayOrder: displayOrder
        };

        try {
            tempRecord.selectNewLine({ sublistId: sublistId });
            var field = tempRecord.getCurrentSublistField({
                sublistId: sublistId,
                fieldId: fieldId
            });

            if (field) {
                fieldInfo.label = field.label || fieldId;
                fieldInfo.type = field.type || 'text';
                fieldInfo.mandatory = field.isMandatory || false;
                fieldInfo.isDisplay = field.isDisplay !== false;

                // Get select options
                if (field.type === 'select') {
                    try {
                        var options = field.getSelectOptions({ filter: null });
                        if (options && options.length > 0 && options.length <= 200) {
                            fieldInfo.options = options.map(function(opt) {
                                return { value: opt.value, text: opt.text };
                            });
                        } else if (options) {
                            fieldInfo.hasOptions = true;
                            fieldInfo.optionCount = options.length;
                            fieldInfo.lookupRequired = options.length > 200;
                        }
                    } catch (e) { /* ignore */ }
                }
            }
        } catch (e) {
            log.debug('extractSublistFieldMetadata', 'Error for ' + sublistId + '.' + fieldId + ': ' + e.message);
        } finally {
            try {
                tempRecord.cancelLine({ sublistId: sublistId });
            } catch (e) { /* ignore */ }
        }

        return fieldInfo;
    }

    // ==========================================
    // MAIN EXTRACTION FUNCTION
    // ==========================================

    /**
     * Extract complete form schema dynamically
     * Returns ALL fields and sublists from the record
     *
     * Priority:
     * 1. User config (form_config) - if user customized via XML or manual
     * 2. Client layout (form_layout) - DOM-extracted tabs/groups
     * 3. Server schema (form_schema) - Field metadata from N/record
     */
    function extractFormSchema(transactionType, options) {
        options = options || {};
        var forceRefresh = options.forceRefresh || false;
        var formId = options.formId || null;

        var normalizedType = normalizeRecordType(transactionType);
        var recordTypeEnum = getRecordType(transactionType);

        if (!recordTypeEnum) {
            return {
                success: false,
                error: 'INVALID_TYPE',
                message: 'Unsupported transaction type: ' + transactionType
            };
        }

        // Check for user-customized config first (highest priority)
        var userConfig = getUserFormConfig(normalizedType, formId);
        if (userConfig && !forceRefresh) {
            log.debug('extractFormSchema', 'Using user config for ' + normalizedType);
            // Merge with cached layout if available
            var layout = getCachedLayout(normalizedType, formId);
            if (layout) {
                userConfig.layout = layout;
            }
            userConfig.source = userConfig._source || 'user_config';
            return { success: true, data: userConfig };
        }

        // Check cached schema
        if (!forceRefresh) {
            var cached = getCachedSchema(normalizedType, formId);
            if (cached) {
                // Also attach any cached layout
                cached.layout = getCachedLayout(normalizedType, formId);
                cached.source = 'cached';
                return { success: true, data: cached };
            }
        }

        log.debug('extractFormSchema', 'Extracting fresh schema for ' + normalizedType);

        try {
            // Create temp record
            var createOptions = { type: recordTypeEnum, isDynamic: true };
            if (formId) {
                createOptions.defaultValues = { customform: formId };
            }

            var tempRecord = record.create(createOptions);

            // Get actual form ID
            var actualFormId = null;
            try {
                actualFormId = tempRecord.getValue('customform');
            } catch (e) { /* ignore */ }

            // Extract ALL body fields
            var bodyFieldIds = tempRecord.getFields();
            var bodyFields = [];
            var displayOrder = 0;

            log.debug('extractFormSchema', 'Found ' + bodyFieldIds.length + ' body field IDs');

            bodyFieldIds.forEach(function(fieldId) {
                if (SKIP_FIELDS.indexOf(fieldId) !== -1) return;

                var fieldInfo = extractFieldMetadata(tempRecord, fieldId, displayOrder++);
                bodyFields.push(fieldInfo);
            });

            // Extract ALL sublists and their fields
            var sublistIds = RECORD_SUBLISTS[normalizedType] || [];
            var sublists = [];

            sublistIds.forEach(function(sublistId) {
                try {
                    var sublistFieldIds = tempRecord.getSublistFields({ sublistId: sublistId });
                    if (!sublistFieldIds || sublistFieldIds.length === 0) return;

                    var sublistFields = [];
                    var sublistDisplayOrder = 0;

                    sublistFieldIds.forEach(function(fieldId) {
                        var fieldInfo = extractSublistFieldMetadata(tempRecord, sublistId, fieldId, sublistDisplayOrder++);
                        sublistFields.push(fieldInfo);
                    });

                    // Get sublist label if available
                    var sublistLabel = sublistId.charAt(0).toUpperCase() + sublistId.slice(1);

                    sublists.push({
                        id: sublistId,
                        label: sublistLabel,
                        fields: sublistFields,
                        fieldCount: sublistFields.length
                    });

                    log.debug('extractFormSchema', 'Sublist ' + sublistId + ': ' + sublistFields.length + ' fields');
                } catch (e) {
                    log.debug('extractFormSchema', 'Could not extract sublist ' + sublistId + ': ' + e.message);
                }
            });

            // Build schema
            var schema = {
                formInfo: {
                    id: actualFormId,
                    type: normalizedType,
                    recordType: String(recordTypeEnum),
                    extractedAt: new Date().toISOString(),
                    schemaVersion: SCHEMA_VERSION
                },
                bodyFields: bodyFields,
                sublists: sublists,
                layout: getCachedLayout(normalizedType, actualFormId),
                source: 'server_extract',
                config: {
                    sublistColumnLimit: 10
                }
            };

            log.debug('extractFormSchema', 'Extracted ' + bodyFields.length + ' body fields, ' + sublists.length + ' sublists');

            // Save to config record
            saveSchemaToConfig(normalizedType, actualFormId, schema);

            return { success: true, data: schema };

        } catch (e) {
            log.error('extractFormSchema', e.message + '\n' + e.stack);
            return {
                success: false,
                error: 'EXTRACTION_ERROR',
                message: e.message
            };
        }
    }

    /**
     * Save form layout extracted from client-side DOM
     * This captures the actual tabs, groups, field order, and visibility
     */
    function saveFormLayout(recordType, formId, layout) {
        try {
            var normalizedType = normalizeRecordType(recordType);

            // Validate layout structure
            if (!layout || !layout.tabs) {
                return {
                    success: false,
                    error: 'INVALID_LAYOUT',
                    message: 'Layout must contain tabs array'
                };
            }

            // Add metadata
            layout.capturedAt = new Date().toISOString();

            // Save to config record
            var result = saveLayoutToConfig(normalizedType, formId, layout);

            if (result.success) {
                return { success: true, message: 'Layout saved to config record', id: result.id };
            } else {
                return { success: false, error: result.error };
            }
        } catch (e) {
            log.error('saveFormLayout', e.message);
            return { success: false, error: e.message };
        }
    }

    /**
     * Save user-customized form configuration (from XML upload or manual edit)
     */
    function saveUserConfig(recordType, formId, config, source) {
        try {
            var normalizedType = normalizeRecordType(recordType);

            // Validate config structure
            if (!config) {
                return {
                    success: false,
                    error: 'INVALID_CONFIG',
                    message: 'Config is required'
                };
            }

            // Add metadata
            config.savedAt = new Date().toISOString();

            // Determine source
            var sourceType = SOURCE_TYPE.MANUAL;
            if (source === 'xml_upload' || source === 'xml') {
                sourceType = SOURCE_TYPE.XML_UPLOAD;
            } else if (source === 'client_capture') {
                sourceType = SOURCE_TYPE.CLIENT_CAPTURE;
            }

            // Save to config record
            var result = saveUserFormConfig(normalizedType, formId, config, sourceType);

            if (result.success) {
                return { success: true, message: 'User config saved', id: result.id, source: sourceType };
            } else {
                return { success: false, error: result.error };
            }
        } catch (e) {
            log.error('saveUserConfig', e.message);
            return { success: false, error: e.message };
        }
    }

    /**
     * Invalidate/delete config for a record type
     */
    function invalidateCache(recordType, formId) {
        try {
            var normalizedType = normalizeRecordType(recordType);

            // Delete schema
            deleteConfigRecord(CONFIG_TYPE.SCHEMA, normalizedType, formId);

            // Delete layout
            deleteConfigRecord(CONFIG_TYPE.LAYOUT, normalizedType, formId);

            // Note: We don't delete user config (form_config) - that's intentional

            return { success: true };
        } catch (e) {
            return { success: false, error: e.message };
        }
    }

    /**
     * Clear all form layout and schema configs
     * Used when user wants to force re-extraction of all forms
     */
    function clearAllCache() {
        try {
            var recordTypes = Object.keys(RECORD_SUBLISTS);
            var deleted = 0;

            recordTypes.forEach(function(recordType) {
                // Delete schema configs
                var schemaResult = deleteConfigRecord(CONFIG_TYPE.SCHEMA, recordType, null);
                if (schemaResult.success) deleted++;

                // Delete layout configs
                var layoutResult = deleteConfigRecord(CONFIG_TYPE.LAYOUT, recordType, null);
                if (layoutResult.success) deleted++;
            });

            log.audit('clearAllCache', 'Deleted ' + deleted + ' config records');
            return { success: true, deleted: deleted };
        } catch (e) {
            log.error('clearAllCache', e.message);
            return { success: false, error: e.message };
        }
    }

    /**
     * Clear all configs of a specific type
     */
    function clearConfigsByType(configType) {
        try {
            var sql = "SELECT id FROM " + CONFIG_RECORD_TYPE + " WHERE custrecord_flux_cfg_type = ?";
            var results = query.runSuiteQL({ query: sql, params: [configType] }).asMappedResults();

            var deleted = 0;
            results.forEach(function(row) {
                try {
                    record.delete({ type: CONFIG_RECORD_TYPE, id: row.id });
                    deleted++;
                } catch (e) {
                    log.debug('clearConfigsByType', 'Could not delete ' + row.id + ': ' + e.message);
                }
            });

            return { success: true, deleted: deleted };
        } catch (e) {
            return { success: false, error: e.message };
        }
    }

    /**
     * Update configuration options
     */
    function updateConfig(recordType, formId, newConfig) {
        try {
            var normalizedType = normalizeRecordType(recordType);
            var cached = getCachedSchema(normalizedType, formId);

            if (!cached) {
                var result = extractFormSchema(normalizedType, { formId: formId });
                if (!result.success) return result;
                cached = result.data;
            }

            cached.config = Object.assign({}, cached.config || {}, newConfig);
            saveSchemaToConfig(normalizedType, formId, cached);

            return { success: true, config: cached.config };
        } catch (e) {
            return { success: false, error: e.message };
        }
    }

    /**
     * List all stored configs (for debugging/admin)
     */
    function listConfigs(configType) {
        try {
            var sql = "SELECT id, custrecord_flux_cfg_type as type, custrecord_flux_cfg_key as key, " +
                "custrecord_flux_cfg_form_id as formId, custrecord_flux_cfg_source as source, " +
                "custrecord_flux_cfg_version as version, custrecord_flux_cfg_modified as modified " +
                "FROM " + CONFIG_RECORD_TYPE + " WHERE custrecord_flux_cfg_active = 'T'";

            if (configType) {
                sql += " AND custrecord_flux_cfg_type = '" + configType + "'";
            }

            sql += " ORDER BY custrecord_flux_cfg_type, custrecord_flux_cfg_key";

            var results = query.runSuiteQL({ query: sql }).asMappedResults();
            return { success: true, data: results };
        } catch (e) {
            return { success: false, error: e.message };
        }
    }

    return {
        // Main functions
        extractFormSchema: extractFormSchema,
        saveFormLayout: saveFormLayout,
        saveUserConfig: saveUserConfig,

        // Cache/config management
        invalidateCache: invalidateCache,
        clearAllCache: clearAllCache,
        clearConfigsByType: clearConfigsByType,
        updateConfig: updateConfig,

        // Direct access (for advanced use)
        getCachedSchema: getCachedSchema,
        getCachedLayout: getCachedLayout,
        getUserFormConfig: getUserFormConfig,
        listConfigs: listConfigs,

        // Constants
        SCHEMA_VERSION: SCHEMA_VERSION,
        CONFIG_TYPE: CONFIG_TYPE,
        SOURCE_TYPE: SOURCE_TYPE
    };
});
