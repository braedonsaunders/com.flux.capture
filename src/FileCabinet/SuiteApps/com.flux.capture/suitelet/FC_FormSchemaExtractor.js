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
 * 3. Cache: Store extracted layout per form ID for reuse
 *
 * NO HARDCODED LAYOUTS - Everything is extracted dynamically
 */

define(['N/record', 'N/search', 'N/log', 'N/cache'],
function(record, search, log, cache) {

    // Schema version for migrations (bump to invalidate cache)
    var SCHEMA_VERSION = 5;

    // Cache configuration
    var CACHE_NAME = 'FC_FORM_SCHEMA';
    var CACHE_SCOPE = cache.Scope.PUBLIC;
    var CACHE_TTL_SECONDS = 2592000; // 30 days (form layouts rarely change)

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

    /**
     * Get schema cache
     */
    function getSchemaCache() {
        return cache.getCache({
            name: CACHE_NAME,
            scope: CACHE_SCOPE
        });
    }

    /**
     * Get cache key for schema (field metadata)
     */
    function getSchemaKey(recordType, formId) {
        return 'schema_v' + SCHEMA_VERSION + '_' + recordType + (formId ? '_' + formId : '');
    }

    /**
     * Get cache key for layout (client-extracted tabs/groups/order)
     */
    function getLayoutKey(recordType, formId) {
        return 'layout_v' + SCHEMA_VERSION + '_' + recordType + (formId ? '_' + formId : '');
    }

    /**
     * Get cached schema
     */
    function getCachedSchema(recordType, formId) {
        try {
            var schemaCache = getSchemaCache();
            var cacheKey = getSchemaKey(recordType, formId);
            var cached = schemaCache.get({ key: cacheKey });
            if (cached) {
                var schema = JSON.parse(cached);
                schema._cached = true;
                return schema;
            }
        } catch (e) {
            log.debug('getCachedSchema', 'Cache miss: ' + e.message);
        }
        return null;
    }

    /**
     * Save schema to cache
     */
    function saveSchemaToCache(recordType, formId, schema) {
        try {
            var schemaCache = getSchemaCache();
            var cacheKey = getSchemaKey(recordType, formId);
            var schemaToCache = JSON.parse(JSON.stringify(schema));
            delete schemaToCache._cached;
            schemaCache.put({
                key: cacheKey,
                value: JSON.stringify(schemaToCache),
                ttl: CACHE_TTL_SECONDS
            });
            return true;
        } catch (e) {
            log.error('saveSchemaToCache', e.message);
            return false;
        }
    }

    /**
     * Get cached layout (client-extracted)
     */
    function getCachedLayout(recordType, formId) {
        try {
            var schemaCache = getSchemaCache();
            var cacheKey = getLayoutKey(recordType, formId);
            var cached = schemaCache.get({ key: cacheKey });
            if (cached) {
                return JSON.parse(cached);
            }
        } catch (e) {
            log.debug('getCachedLayout', 'No cached layout: ' + e.message);
        }
        return null;
    }

    /**
     * Save client-extracted layout to cache
     */
    function saveLayoutToCache(recordType, formId, layout) {
        try {
            var schemaCache = getSchemaCache();
            var cacheKey = getLayoutKey(recordType, formId);
            schemaCache.put({
                key: cacheKey,
                value: JSON.stringify(layout),
                ttl: CACHE_TTL_SECONDS
            });
            log.audit('saveLayoutToCache', 'Saved layout for ' + recordType + ' form ' + formId);
            return true;
        } catch (e) {
            log.error('saveLayoutToCache', e.message);
            return false;
        }
    }

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

    /**
     * Extract complete form schema dynamically
     * Returns ALL fields and sublists from the record
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

        // Check cache first
        if (!forceRefresh) {
            var cached = getCachedSchema(normalizedType, formId);
            if (cached) {
                // Also attach any cached layout
                cached.layout = getCachedLayout(normalizedType, formId);
                return { success: true, data: cached };
            }
        }

        log.debug('extractFormSchema', 'Extracting schema for ' + normalizedType);

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

            // Build schema (no hardcoded layout - just the raw data)
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
                // Layout will be populated from client-side extraction
                layout: getCachedLayout(normalizedType, actualFormId),
                config: {
                    sublistColumnLimit: 10
                }
            };

            log.debug('extractFormSchema', 'Extracted ' + bodyFields.length + ' body fields, ' + sublists.length + ' sublists');

            // Cache the schema
            saveSchemaToCache(normalizedType, actualFormId, schema);

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

            // Save to cache
            saveLayoutToCache(normalizedType, formId, layout);

            return { success: true, message: 'Layout saved' };
        } catch (e) {
            log.error('saveFormLayout', e.message);
            return { success: false, error: e.message };
        }
    }

    /**
     * Invalidate cache for a record type
     */
    function invalidateCache(recordType, formId) {
        try {
            var normalizedType = normalizeRecordType(recordType);
            var schemaCache = getSchemaCache();

            // Remove schema cache
            schemaCache.remove({ key: getSchemaKey(normalizedType, formId) });

            // Remove layout cache
            schemaCache.remove({ key: getLayoutKey(normalizedType, formId) });

            return { success: true };
        } catch (e) {
            return { success: false, error: e.message };
        }
    }

    /**
     * Clear all form layout and schema caches
     * Used when user wants to force re-extraction of all forms
     */
    function clearAllCache() {
        try {
            var schemaCache = getSchemaCache();
            var recordTypes = Object.keys(RECORD_SUBLISTS);
            var cleared = 0;

            recordTypes.forEach(function(recordType) {
                try {
                    // Clear schema cache (no form ID)
                    schemaCache.remove({ key: getSchemaKey(recordType, null) });
                    cleared++;

                    // Clear layout cache (no form ID)
                    schemaCache.remove({ key: getLayoutKey(recordType, null) });
                    cleared++;
                } catch (e) {
                    // Ignore errors for individual keys (might not exist)
                }
            });

            log.debug('clearAllCache', 'Cleared ' + cleared + ' cache entries');
            return { success: true, cleared: cleared };
        } catch (e) {
            log.error('clearAllCache', e.message);
            return { success: false, error: e.message };
        }
    }

    /**
     * Update configuration
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
            saveSchemaToCache(normalizedType, formId, cached);

            return { success: true, config: cached.config };
        } catch (e) {
            return { success: false, error: e.message };
        }
    }

    return {
        extractFormSchema: extractFormSchema,
        saveFormLayout: saveFormLayout,
        invalidateCache: invalidateCache,
        clearAllCache: clearAllCache,
        updateConfig: updateConfig,
        getCachedSchema: getCachedSchema,
        getCachedLayout: getCachedLayout,
        SCHEMA_VERSION: SCHEMA_VERSION
    };
});
