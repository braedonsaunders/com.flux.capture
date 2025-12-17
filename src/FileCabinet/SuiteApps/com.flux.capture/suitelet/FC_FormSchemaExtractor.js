/**
 * @NApiVersion 2.1
 * @NModuleScope Public
 * @module FC_FormSchemaExtractor
 *
 * Form Schema Extractor - Extracts and caches NetSuite form metadata
 * Implements the "Metadata Proxy Pattern" for accurate form structure extraction
 * Uses N/cache for high-performance caching
 *
 * Features:
 * - Dynamic field extraction via N/record
 * - Layout inference based on field metadata and NetSuite patterns
 * - N/cache for efficient in-memory caching with TTL
 * - Support for tabs, field groups, sublists with column visibility
 * - Custom field placement in configured groups
 */

define(['N/record', 'N/search', 'N/log', 'N/cache'],
function(record, search, log, cache) {

    // Schema version for migrations (bump to invalidate cache)
    var SCHEMA_VERSION = 3;

    // Cache configuration
    var CACHE_NAME = 'FC_FORM_SCHEMA';
    var CACHE_SCOPE = cache.Scope.PUBLIC; // Shared across all users
    var CACHE_TTL_SECONDS = 86400; // 24 hours

    /**
     * Standard NetSuite form layout definitions by record type
     * These define the expected tab and field group structure
     */
    var STANDARD_LAYOUTS = {
        vendorbill: {
            tabs: [
                {
                    id: 'main',
                    label: 'Main',
                    displayOrder: 0,
                    fieldGroups: [
                        {
                            id: 'primary',
                            label: 'Primary Information',
                            displayOrder: 0,
                            fields: ['entity', 'trandate', 'duedate', 'postingperiod', 'tranid']
                        },
                        {
                            id: 'classification',
                            label: 'Classification',
                            displayOrder: 1,
                            fields: ['subsidiary', 'department', 'class', 'location', 'nextapprover']
                        },
                        {
                            id: 'accounting',
                            label: 'Accounting',
                            displayOrder: 2,
                            fields: ['terms', 'account', 'currency', 'exchangerate', 'approvalstatus']
                        }
                    ],
                    sublists: ['expense', 'item']
                },
                {
                    id: 'address',
                    label: 'Address',
                    displayOrder: 1,
                    fieldGroups: [
                        {
                            id: 'billing',
                            label: 'Billing Address',
                            displayOrder: 0,
                            fields: ['billaddresslist', 'billaddress']
                        }
                    ],
                    sublists: []
                },
                {
                    id: 'communication',
                    label: 'Communication',
                    displayOrder: 2,
                    fieldGroups: [],
                    sublists: []
                },
                {
                    id: 'relatedrecords',
                    label: 'Related Records',
                    displayOrder: 3,
                    fieldGroups: [],
                    sublists: []
                },
                {
                    id: 'systeminformation',
                    label: 'System Information',
                    displayOrder: 4,
                    fieldGroups: [
                        {
                            id: 'systemnotes',
                            label: 'System Notes',
                            displayOrder: 0,
                            fields: ['createddate', 'lastmodifieddate', 'externalid']
                        }
                    ],
                    sublists: []
                }
            ],
            sublists: [
                {
                    id: 'expense',
                    label: 'Expenses',
                    type: 'expense',
                    tab: 'main',
                    defaultColumns: ['account', 'amount', 'memo', 'department', 'class', 'location', 'customer', 'taxcode'],
                    allColumns: ['account', 'amount', 'memo', 'department', 'class', 'location', 'customer', 'taxcode',
                                'amortizationsched', 'amortizstartdate', 'amortizationenddate', 'isbillable', 'taxrate', 'tax1amt', 'grossamt', 'line']
                },
                {
                    id: 'item',
                    label: 'Items',
                    type: 'item',
                    tab: 'main',
                    defaultColumns: ['item', 'description', 'quantity', 'units', 'rate', 'amount', 'taxcode', 'department', 'class', 'location'],
                    allColumns: ['item', 'description', 'quantity', 'units', 'rate', 'amount', 'taxcode', 'department',
                                'class', 'location', 'customer', 'isbillable', 'taxrate', 'tax1amt', 'grossamt', 'expectedreceiptdate', 'line']
                }
            ]
        },
        expensereport: {
            tabs: [
                {
                    id: 'main',
                    label: 'Main',
                    displayOrder: 0,
                    fieldGroups: [
                        {
                            id: 'primary',
                            label: 'Primary Information',
                            displayOrder: 0,
                            fields: ['entity', 'trandate', 'postingperiod', 'tranid']
                        },
                        {
                            id: 'classification',
                            label: 'Classification',
                            displayOrder: 1,
                            fields: ['subsidiary', 'department', 'class', 'location']
                        },
                        {
                            id: 'accounting',
                            label: 'Accounting',
                            displayOrder: 2,
                            fields: ['account', 'advance', 'approvalstatus']
                        }
                    ],
                    sublists: ['expense']
                }
            ],
            sublists: [
                {
                    id: 'expense',
                    label: 'Expenses',
                    type: 'expense',
                    tab: 'main',
                    defaultColumns: ['category', 'expensedate', 'amount', 'memo', 'currency', 'taxcode', 'department', 'class', 'location'],
                    allColumns: ['category', 'expensedate', 'amount', 'memo', 'currency', 'exchangerate', 'taxcode',
                                'department', 'class', 'location', 'customer', 'receipt', 'refnumber', 'taxrate', 'tax1amt', 'grossamt', 'line']
                }
            ]
        },
        vendorcredit: {
            tabs: [
                {
                    id: 'main',
                    label: 'Main',
                    displayOrder: 0,
                    fieldGroups: [
                        {
                            id: 'primary',
                            label: 'Primary Information',
                            displayOrder: 0,
                            fields: ['entity', 'trandate', 'postingperiod', 'tranid']
                        },
                        {
                            id: 'classification',
                            label: 'Classification',
                            displayOrder: 1,
                            fields: ['subsidiary', 'department', 'class', 'location']
                        },
                        {
                            id: 'accounting',
                            label: 'Accounting',
                            displayOrder: 2,
                            fields: ['account', 'currency', 'exchangerate']
                        }
                    ],
                    sublists: ['expense', 'item']
                }
            ],
            sublists: [
                {
                    id: 'expense',
                    label: 'Expenses',
                    type: 'expense',
                    tab: 'main',
                    defaultColumns: ['account', 'amount', 'memo', 'department', 'class', 'location'],
                    allColumns: ['account', 'amount', 'memo', 'department', 'class', 'location', 'customer', 'taxcode', 'taxrate', 'tax1amt', 'grossamt', 'line']
                },
                {
                    id: 'item',
                    label: 'Items',
                    type: 'item',
                    tab: 'main',
                    defaultColumns: ['item', 'description', 'quantity', 'rate', 'amount', 'taxcode', 'department', 'class', 'location'],
                    allColumns: ['item', 'description', 'quantity', 'units', 'rate', 'amount', 'taxcode', 'department',
                                'class', 'location', 'customer', 'taxrate', 'tax1amt', 'grossamt', 'line']
                }
            ]
        },
        purchaseorder: {
            tabs: [
                {
                    id: 'main',
                    label: 'Main',
                    displayOrder: 0,
                    fieldGroups: [
                        {
                            id: 'primary',
                            label: 'Primary Information',
                            displayOrder: 0,
                            fields: ['entity', 'trandate', 'duedate', 'tranid']
                        },
                        {
                            id: 'classification',
                            label: 'Classification',
                            displayOrder: 1,
                            fields: ['subsidiary', 'department', 'class', 'location']
                        },
                        {
                            id: 'shipping',
                            label: 'Shipping',
                            displayOrder: 2,
                            fields: ['shipaddress', 'shipmethod', 'shipdate']
                        },
                        {
                            id: 'accounting',
                            label: 'Accounting',
                            displayOrder: 3,
                            fields: ['terms', 'currency', 'exchangerate', 'approvalstatus']
                        }
                    ],
                    sublists: ['expense', 'item']
                }
            ],
            sublists: [
                {
                    id: 'expense',
                    label: 'Expenses',
                    type: 'expense',
                    tab: 'main',
                    defaultColumns: ['account', 'amount', 'memo', 'department', 'class', 'location'],
                    allColumns: ['account', 'amount', 'memo', 'department', 'class', 'location', 'customer', 'taxcode', 'line']
                },
                {
                    id: 'item',
                    label: 'Items',
                    type: 'item',
                    tab: 'main',
                    defaultColumns: ['item', 'description', 'quantity', 'units', 'rate', 'amount', 'taxcode', 'department', 'class', 'location'],
                    allColumns: ['item', 'description', 'quantity', 'units', 'rate', 'amount', 'taxcode', 'department',
                                'class', 'location', 'customer', 'expectedreceiptdate', 'taxrate', 'tax1amt', 'grossamt', 'line']
                }
            ]
        }
    };

    /**
     * Field categorization for intelligent grouping
     */
    var FIELD_CATEGORIES = {
        primary: ['entity', 'trandate', 'duedate', 'postingperiod', 'tranid', 'otherrefnum'],
        classification: ['subsidiary', 'department', 'class', 'location', 'nexus'],
        accounting: ['terms', 'account', 'currency', 'exchangerate', 'approvalstatus', 'total', 'taxtotal', 'discountitem', 'discountrate', 'advance'],
        address: ['billaddress', 'billaddresslist', 'shipaddress', 'shipaddresslist'],
        reference: ['memo', 'externalid', 'createdfrom'],
        system: ['createddate', 'lastmodifieddate', 'customform']
    };

    /**
     * Get or create the schema cache
     */
    function getSchemaCache() {
        return cache.getCache({
            name: CACHE_NAME,
            scope: CACHE_SCOPE
        });
    }

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
            'expense': record.Type.EXPENSE_REPORT,
            'vendorcredit': record.Type.VENDOR_CREDIT,
            'vendor_credit': record.Type.VENDOR_CREDIT,
            'purchaseorder': record.Type.PURCHASE_ORDER,
            'purchase_order': record.Type.PURCHASE_ORDER,
            'po': record.Type.PURCHASE_ORDER
        };
        return typeMap[transactionType.toLowerCase()] || null;
    }

    /**
     * Normalize transaction type string
     */
    function normalizeRecordType(transactionType) {
        var normalMap = {
            'vendorbill': 'vendorbill',
            'vendor_bill': 'vendorbill',
            'bill': 'vendorbill',
            'expensereport': 'expensereport',
            'expense_report': 'expensereport',
            'expense': 'expensereport',
            'vendorcredit': 'vendorcredit',
            'vendor_credit': 'vendorcredit',
            'purchaseorder': 'purchaseorder',
            'purchase_order': 'purchaseorder',
            'po': 'purchaseorder'
        };
        return normalMap[transactionType.toLowerCase()] || transactionType.toLowerCase();
    }

    /**
     * Get cache key including schema version
     */
    function getCacheKey(recordType) {
        return 'schema_v' + SCHEMA_VERSION + '_' + recordType;
    }

    /**
     * Get cached schema from N/cache
     */
    function getCachedSchema(recordType) {
        try {
            var schemaCache = getSchemaCache();
            var cacheKey = getCacheKey(recordType);
            var cached = schemaCache.get({ key: cacheKey });

            if (cached) {
                var schema = JSON.parse(cached);
                schema._cached = true;
                schema._cacheKey = cacheKey;
                return schema;
            }
            return null;
        } catch (e) {
            log.debug('getCachedSchema', 'Cache miss or error: ' + e.message);
            return null;
        }
    }

    /**
     * Save schema to N/cache
     */
    function saveSchemaToCache(recordType, schema) {
        try {
            var schemaCache = getSchemaCache();
            var cacheKey = getCacheKey(recordType);

            // Remove cache metadata before saving
            var schemaToCache = JSON.parse(JSON.stringify(schema));
            delete schemaToCache._cached;
            delete schemaToCache._cacheKey;

            schemaCache.put({
                key: cacheKey,
                value: JSON.stringify(schemaToCache),
                ttl: CACHE_TTL_SECONDS
            });

            log.audit('saveSchemaToCache', 'Cached schema for ' + recordType);
            return true;
        } catch (e) {
            log.error('saveSchemaToCache', 'Error saving cache: ' + e.message);
            return false;
        }
    }

    /**
     * Standard field labels for common fields
     */
    var STANDARD_FIELD_LABELS = {
        entity: 'Vendor',
        trandate: 'Date',
        duedate: 'Due Date',
        tranid: 'Reference No.',
        memo: 'Memo',
        currency: 'Currency',
        terms: 'Terms',
        approvalstatus: 'Approval Status',
        subsidiary: 'Subsidiary',
        department: 'Department',
        class: 'Class',
        location: 'Location',
        account: 'Account',
        postingperiod: 'Posting Period',
        exchangerate: 'Exchange Rate',
        nexus: 'Nexus',
        total: 'Total',
        usertotal: 'Amount',
        taxtotal: 'Tax Total',
        discountitem: 'Discount Item',
        discountrate: 'Discount Rate',
        createdfrom: 'Created From',
        billaddress: 'Billing Address',
        billaddresslist: 'Billing Address List',
        externalid: 'External ID',
        createddate: 'Created Date',
        lastmodifieddate: 'Last Modified',
        nextapprover: 'Next Approver',
        advance: 'Advance',
        shipaddress: 'Ship Address',
        shipmethod: 'Ship Method',
        shipdate: 'Ship Date',
        otherrefnum: 'PO/Check Number'
    };

    /**
     * Standard field types for common fields
     */
    var STANDARD_FIELD_TYPES = {
        entity: 'select',
        trandate: 'date',
        duedate: 'date',
        tranid: 'text',
        memo: 'textarea',
        currency: 'select',
        terms: 'select',
        approvalstatus: 'select',
        subsidiary: 'select',
        department: 'select',
        class: 'select',
        location: 'select',
        account: 'select',
        postingperiod: 'select',
        exchangerate: 'currency',
        nexus: 'select',
        total: 'currency',
        usertotal: 'currency',
        taxtotal: 'currency',
        discountitem: 'select',
        discountrate: 'percent',
        createdfrom: 'select',
        billaddress: 'textarea',
        billaddresslist: 'select',
        externalid: 'text',
        createddate: 'datetime',
        lastmodifieddate: 'datetime',
        nextapprover: 'select',
        advance: 'currency',
        shipaddress: 'textarea',
        shipmethod: 'select',
        shipdate: 'date',
        otherrefnum: 'text'
    };

    /**
     * Extract field metadata from a temporary record
     * Falls back to standard definitions if getField() fails
     */
    function extractFieldMetadata(tempRecord, fieldId, displayOrder) {
        var fieldInfo = {
            id: fieldId,
            label: STANDARD_FIELD_LABELS[fieldId] || fieldId,
            type: STANDARD_FIELD_TYPES[fieldId] || 'text',
            mandatory: false,
            isDisplay: true,
            isDisabled: false,
            isCustom: fieldId.indexOf('custbody') === 0,
            help: '',
            displayOrder: displayOrder
        };

        try {
            var field = tempRecord.getField({ fieldId: fieldId });
            if (field) {
                // Override with actual metadata if available
                fieldInfo.label = field.label || fieldInfo.label;
                fieldInfo.type = field.type || fieldInfo.type;
                fieldInfo.mandatory = field.isMandatory || false;
                fieldInfo.isDisplay = field.isDisplay !== false;
                fieldInfo.isDisabled = field.isDisabled || false;
                fieldInfo.help = field.help || '';

                // Get select options for select/multiselect fields
                if (field.type === 'select' || field.type === 'multiselect') {
                    try {
                        var options = field.getSelectOptions({ filter: null });
                        if (options && options.length > 0 && options.length < 200) {
                            fieldInfo.options = options.map(function(opt) {
                                return { value: opt.value, text: opt.text };
                            });
                        } else if (options) {
                            fieldInfo.hasOptions = true;
                            fieldInfo.optionCount = options.length;
                            fieldInfo.lookupRequired = options.length >= 200;
                        }
                    } catch (e) { /* ignore options error */ }
                }
            }
        } catch (e) {
            // Use default fieldInfo if getField fails
            log.debug('extractFieldMetadata', 'Using fallback for field ' + fieldId + ': ' + e.message);
        }

        return fieldInfo;
    }

    /**
     * Extract sublist field metadata
     */
    function extractSublistFieldMetadata(tempRecord, sublistId, fieldId, displayOrder) {
        try {
            var field = null;

            // Try to get field with a new line selected
            try {
                tempRecord.selectNewLine({ sublistId: sublistId });
                field = tempRecord.getSublistField({
                    sublistId: sublistId,
                    fieldId: fieldId,
                    line: 0
                });
            } catch (e) {
                // Try current line
                field = tempRecord.getCurrentSublistField({
                    sublistId: sublistId,
                    fieldId: fieldId
                });
            }

            if (!field) return null;

            var fieldInfo = {
                id: fieldId,
                label: field.label || fieldId,
                type: field.type || 'text',
                mandatory: field.isMandatory || false,
                isDisplay: field.isDisplay !== false,
                isCustom: fieldId.indexOf('custcol') === 0,
                displayOrder: displayOrder
            };

            // Get select options
            if (field.type === 'select') {
                try {
                    var options = field.getSelectOptions({ filter: null });
                    if (options && options.length > 0 && options.length < 200) {
                        fieldInfo.options = options.map(function(opt) {
                            return { value: opt.value, text: opt.text };
                        });
                    } else if (options) {
                        fieldInfo.hasOptions = true;
                        fieldInfo.optionCount = options.length;
                        fieldInfo.lookupRequired = options.length >= 200;
                    }
                } catch (e) { /* ignore */ }
            }

            return fieldInfo;
        } catch (e) {
            return null;
        } finally {
            try {
                tempRecord.cancelLine({ sublistId: sublistId });
            } catch (e) { /* ignore */ }
        }
    }

    /**
     * Determine which field group a field belongs to
     */
    function categorizeField(fieldId) {
        for (var category in FIELD_CATEGORIES) {
            if (FIELD_CATEGORIES[category].indexOf(fieldId) !== -1) {
                return category;
            }
        }
        if (fieldId.indexOf('custbody') === 0) {
            return 'custom';
        }
        return 'other';
    }

    /**
     * Build layout with intelligent field placement
     */
    function buildLayout(recordType, bodyFields, customFields) {
        var standardLayout = STANDARD_LAYOUTS[recordType];
        if (!standardLayout) {
            return buildGenericLayout(bodyFields, customFields);
        }

        // Deep clone the standard layout
        var layout = JSON.parse(JSON.stringify(standardLayout));

        // Track which fields have been placed
        var placedFields = {};

        // First pass: place fields in their defined groups
        layout.tabs.forEach(function(tab) {
            tab.fieldGroups.forEach(function(group) {
                var validFields = [];
                group.fields.forEach(function(fieldId) {
                    var fieldInfo = bodyFields.find(function(f) { return f.id === fieldId; });
                    if (fieldInfo && fieldInfo.isDisplay) {
                        validFields.push(fieldId);
                        placedFields[fieldId] = true;
                    }
                });
                group.fields = validFields;
            });

            // Remove empty groups
            tab.fieldGroups = tab.fieldGroups.filter(function(g) {
                return g.fields.length > 0;
            });
        });

        // Second pass: place custom fields
        var mainTab = layout.tabs.find(function(t) { return t.id === 'main'; });
        if (mainTab && customFields.length > 0) {
            var visibleCustomFields = customFields.filter(function(cf) {
                return cf.isDisplay && !placedFields[cf.id];
            });

            if (visibleCustomFields.length > 0) {
                var customGroup = mainTab.fieldGroups.find(function(g) { return g.id === 'custom'; });
                if (!customGroup) {
                    customGroup = {
                        id: 'custom',
                        label: 'Custom Fields',
                        displayOrder: mainTab.fieldGroups.length,
                        fields: []
                    };
                    mainTab.fieldGroups.push(customGroup);
                }

                visibleCustomFields.forEach(function(cf) {
                    customGroup.fields.push(cf.id);
                    placedFields[cf.id] = true;
                });
            }
        }

        // Third pass: find unplaced visible fields
        bodyFields.forEach(function(field) {
            if (!placedFields[field.id] && field.isDisplay && !field.isCustom) {
                var category = categorizeField(field.id);

                if (mainTab) {
                    var targetGroup = mainTab.fieldGroups.find(function(g) {
                        return g.id === category;
                    });

                    if (!targetGroup) {
                        targetGroup = mainTab.fieldGroups.find(function(g) { return g.id === 'other'; });
                        if (!targetGroup) {
                            targetGroup = {
                                id: 'other',
                                label: 'Additional Information',
                                displayOrder: mainTab.fieldGroups.length,
                                fields: []
                            };
                            mainTab.fieldGroups.push(targetGroup);
                        }
                    }

                    targetGroup.fields.push(field.id);
                    placedFields[field.id] = true;
                }
            }
        });

        // Remove tabs with no visible content (but keep main tab)
        layout.tabs = layout.tabs.filter(function(tab) {
            if (tab.id === 'main') return true;
            var hasGroups = tab.fieldGroups && tab.fieldGroups.length > 0;
            var hasSublists = tab.sublists && tab.sublists.length > 0;
            return hasGroups || hasSublists;
        });

        return layout;
    }

    /**
     * Build generic layout for unknown record types
     */
    function buildGenericLayout(bodyFields, customFields) {
        var groups = {
            primary: { id: 'primary', label: 'Primary Information', displayOrder: 0, fields: [] },
            classification: { id: 'classification', label: 'Classification', displayOrder: 1, fields: [] },
            accounting: { id: 'accounting', label: 'Accounting', displayOrder: 2, fields: [] },
            reference: { id: 'reference', label: 'Reference', displayOrder: 3, fields: [] },
            custom: { id: 'custom', label: 'Custom Fields', displayOrder: 4, fields: [] },
            other: { id: 'other', label: 'Other', displayOrder: 5, fields: [] }
        };

        bodyFields.forEach(function(field) {
            if (!field.isDisplay) return;
            var category = categorizeField(field.id);
            if (groups[category]) {
                groups[category].fields.push(field.id);
            } else {
                groups.other.fields.push(field.id);
            }
        });

        customFields.forEach(function(field) {
            if (field.isDisplay) {
                groups.custom.fields.push(field.id);
            }
        });

        var fieldGroups = Object.keys(groups)
            .map(function(k) { return groups[k]; })
            .filter(function(g) { return g.fields.length > 0; });

        return {
            tabs: [{
                id: 'main',
                label: 'Main',
                displayOrder: 0,
                fieldGroups: fieldGroups,
                sublists: []
            }]
        };
    }

    /**
     * Extract complete form schema
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

        // Check cache first (unless force refresh)
        if (!forceRefresh) {
            var cached = getCachedSchema(normalizedType);
            if (cached) {
                log.debug('extractFormSchema', 'Returning cached schema for ' + normalizedType);
                return {
                    success: true,
                    data: cached
                };
            }
        }

        log.debug('extractFormSchema', 'Extracting fresh schema for ' + normalizedType);

        try {
            // Create temporary record in dynamic mode
            var createOptions = { type: recordTypeEnum, isDynamic: true };
            if (formId) {
                createOptions.defaultValues = { customform: formId };
            }

            var tempRecord = record.create(createOptions);

            // Get the actual form ID (preferred form)
            var actualFormId = null;
            try {
                actualFormId = tempRecord.getValue('customform');
            } catch (e) { /* ignore */ }

            // Extract body fields - get ALL fields, let layout determine display
            var bodyFieldIds = tempRecord.getFields();
            var bodyFields = [];
            var customFields = [];
            var displayOrder = 0;

            // Fields to always skip (system/internal fields)
            var skipFields = ['customform', 'ntype', 'recordtype', 'id', 'type'];

            log.debug('extractFormSchema', 'Found ' + bodyFieldIds.length + ' body fields for ' + normalizedType);

            bodyFieldIds.forEach(function(fieldId) {
                // Skip system fields
                if (skipFields.indexOf(fieldId) !== -1) {
                    return;
                }

                var isCustom = fieldId.indexOf('custbody') === 0;

                var fieldInfo = extractFieldMetadata(tempRecord, fieldId, displayOrder++);
                if (fieldInfo) {
                    if (isCustom) {
                        customFields.push(fieldInfo);
                    } else {
                        bodyFields.push(fieldInfo);
                    }
                }
            });

            log.debug('extractFormSchema', 'Extracted ' + bodyFields.length + ' body fields, ' + customFields.length + ' custom fields');

            // Extract sublists
            var standardLayout = STANDARD_LAYOUTS[normalizedType] || { sublists: [] };
            var sublists = [];

            standardLayout.sublists.forEach(function(sublistDef) {
                var sublistId = sublistDef.id;
                var sublistFieldsMap = {}; // Store fields by ID for easy lookup
                var customSublistFields = []; // Custom fields not in standard layout

                try {
                    var sublistFieldIds = tempRecord.getSublistFields({ sublistId: sublistId });

                    sublistFieldIds.forEach(function(fieldId) {
                        var isCustom = fieldId.indexOf('custcol') === 0;

                        if (!isCustom && sublistDef.allColumns.indexOf(fieldId) === -1) {
                            return;
                        }

                        var fieldInfo = extractSublistFieldMetadata(
                            tempRecord, sublistId, fieldId, 0 // displayOrder set later
                        );

                        if (fieldInfo) {
                            if (isCustom) {
                                customSublistFields.push(fieldInfo);
                            } else {
                                sublistFieldsMap[fieldId] = fieldInfo;
                            }
                        }
                    });

                } catch (e) {
                    log.debug('extractFormSchema', 'Could not extract sublist ' + sublistId + ': ' + e.message);
                    // Create minimal field info for default columns
                    sublistDef.defaultColumns.forEach(function(fieldId) {
                        sublistFieldsMap[fieldId] = {
                            id: fieldId,
                            label: fieldId,
                            type: 'text',
                            isDisplay: true,
                            isCustom: false
                        };
                    });
                }

                // Build ordered field list: defaultColumns first, then other standard, then custom
                var sublistFields = [];
                var displayOrder = 0;

                // First: Add fields from defaultColumns in preferred order
                sublistDef.defaultColumns.forEach(function(fieldId) {
                    if (sublistFieldsMap[fieldId]) {
                        sublistFieldsMap[fieldId].displayOrder = displayOrder++;
                        sublistFields.push(sublistFieldsMap[fieldId]);
                        delete sublistFieldsMap[fieldId]; // Mark as added
                    }
                });

                // Second: Add remaining standard fields from allColumns
                sublistDef.allColumns.forEach(function(fieldId) {
                    if (sublistFieldsMap[fieldId]) {
                        sublistFieldsMap[fieldId].displayOrder = displayOrder++;
                        sublistFields.push(sublistFieldsMap[fieldId]);
                        delete sublistFieldsMap[fieldId];
                    }
                });

                // Third: Add any remaining standard fields (shouldn't happen, but safety)
                Object.keys(sublistFieldsMap).forEach(function(fieldId) {
                    sublistFieldsMap[fieldId].displayOrder = displayOrder++;
                    sublistFields.push(sublistFieldsMap[fieldId]);
                });

                // Fourth: Add custom fields at the end
                customSublistFields.forEach(function(fieldInfo) {
                    fieldInfo.displayOrder = displayOrder++;
                    sublistFields.push(fieldInfo);
                });

                // Build visible columns list (defaultColumns that exist + custom visible fields)
                var visibleColumns = [];
                sublistDef.defaultColumns.forEach(function(fieldId) {
                    var field = sublistFields.find(function(f) { return f.id === fieldId; });
                    if (field && field.isDisplay) {
                        visibleColumns.push(fieldId);
                    }
                });

                // Add visible custom columns
                customSublistFields.forEach(function(fieldInfo) {
                    if (fieldInfo.isDisplay) {
                        visibleColumns.push(fieldInfo.id);
                    }
                });

                sublists.push({
                    id: sublistId,
                    label: sublistDef.label,
                    type: sublistDef.type,
                    tab: sublistDef.tab,
                    fields: sublistFields,
                    visibleColumns: visibleColumns,
                    columnOrder: visibleColumns.slice(),
                    allColumns: sublistDef.allColumns
                });
            });

            // Build the layout
            var layout = buildLayout(normalizedType, bodyFields, customFields);

            // Attach sublists to tabs
            layout.tabs.forEach(function(tab) {
                tab.sublists = sublists
                    .filter(function(sl) { return sl.tab === tab.id; })
                    .map(function(sl) { return sl.id; });
            });

            // Build complete schema
            var schema = {
                formInfo: {
                    id: actualFormId,
                    type: normalizedType,
                    recordType: String(recordTypeEnum),
                    extractedAt: new Date().toISOString(),
                    schemaVersion: SCHEMA_VERSION
                },
                bodyFields: bodyFields.concat(customFields),
                sublists: sublists,
                layout: layout,
                config: {
                    sublistColumnLimit: 10,
                    collapsedGroups: [],
                    showHiddenFields: false
                },
                hiddenFields: bodyFields.concat(customFields)
                    .filter(function(f) { return !f.isDisplay; })
                    .map(function(f) { return f.id; })
            };

            // Save to cache
            saveSchemaToCache(normalizedType, schema);

            return {
                success: true,
                data: schema
            };

        } catch (e) {
            log.error('extractFormSchema', 'Error extracting schema: ' + e.message + '\n' + e.stack);
            return {
                success: false,
                error: 'EXTRACTION_ERROR',
                message: e.message
            };
        }
    }

    /**
     * Update layout from DOM extraction results
     */
    function updateLayoutFromDOM(recordType, domLayout) {
        try {
            var normalizedType = normalizeRecordType(recordType);
            var result = extractFormSchema(normalizedType, { forceRefresh: false });

            if (!result.success) {
                return result;
            }

            var schema = result.data;

            if (domLayout.tabs) {
                schema.layout.tabs = domLayout.tabs;
            }

            if (domLayout.sublistColumns) {
                domLayout.sublistColumns.forEach(function(slConfig) {
                    var sublist = schema.sublists.find(function(sl) { return sl.id === slConfig.id; });
                    if (sublist) {
                        sublist.visibleColumns = slConfig.visibleColumns;
                        sublist.columnOrder = slConfig.columnOrder;
                    }
                });
            }

            delete schema._cached;
            delete schema._cacheKey;

            saveSchemaToCache(normalizedType, schema);

            return {
                success: true,
                data: schema
            };

        } catch (e) {
            log.error('updateLayoutFromDOM', 'Error updating layout: ' + e.message);
            return {
                success: false,
                error: 'UPDATE_ERROR',
                message: e.message
            };
        }
    }

    /**
     * Invalidate cache for a record type
     */
    function invalidateCache(recordType) {
        try {
            var normalizedType = normalizeRecordType(recordType);
            var schemaCache = getSchemaCache();
            schemaCache.remove({ key: getCacheKey(normalizedType) });
            return { success: true };
        } catch (e) {
            return { success: false, error: e.message };
        }
    }

    /**
     * Update configuration
     */
    function updateConfig(recordType, newConfig) {
        try {
            var normalizedType = normalizeRecordType(recordType);
            var cached = getCachedSchema(normalizedType);

            if (!cached) {
                var result = extractFormSchema(normalizedType);
                if (!result.success) return result;
                cached = result.data;
            }

            cached.config = Object.assign({}, cached.config || {}, newConfig);
            delete cached._cached;
            delete cached._cacheKey;

            saveSchemaToCache(normalizedType, cached);

            return { success: true, config: cached.config };
        } catch (e) {
            return { success: false, error: e.message };
        }
    }

    return {
        extractFormSchema: extractFormSchema,
        updateLayoutFromDOM: updateLayoutFromDOM,
        invalidateCache: invalidateCache,
        updateConfig: updateConfig,
        getCachedSchema: getCachedSchema,
        SCHEMA_VERSION: SCHEMA_VERSION
    };
});
