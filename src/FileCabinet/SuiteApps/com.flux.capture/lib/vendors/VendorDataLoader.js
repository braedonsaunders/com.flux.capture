/**
 * @NApiVersion 2.1
 * @NModuleScope Public
 * @module FluxCapture/Vendors/VendorDataLoader
 *
 * Vendor Data Loader
 * Loads vendor data LIVE from NetSuite - no storage needed
 * Returns all useful data for auto-populating invoice fields
 *
 * Philosophy: Never store what you can query live from the source of truth
 */

define(['N/record', 'N/search', 'N/log', '../FC_Debug'], function(record, search, log, fcDebug) {
    'use strict';

    /**
     * Vendor Data Loader
     * Loads vendor defaults directly from NetSuite vendor record
     */
    class VendorDataLoader {

        constructor() {
            // Cache for short-term reuse (within same processing)
            this._cache = new Map();
            this._cacheMaxAge = 60000; // 1 minute cache
        }

        /**
         * Load all useful data from vendor record - LIVE, no persistent storage
         *
         * @param {number} vendorId - Internal ID of vendor
         * @returns {Object|null} Vendor data for auto-population
         */
        loadVendorData(vendorId) {
            if (!vendorId) return null;

            // Check short-term cache
            const cached = this._getFromCache(vendorId);
            if (cached) {
                fcDebug.debug('VendorDataLoader', `Using cached data for vendor ${vendorId}`);
                return cached;
            }

            try {
                const vendorRecord = record.load({
                    type: record.Type.VENDOR,
                    id: vendorId
                });

                const data = {
                    // Core identification
                    id: vendorId,
                    entityId: vendorRecord.getValue('entityid'),
                    companyName: vendorRecord.getValue('companyname'),
                    legalName: vendorRecord.getValue('legalname'),

                    // Classification - these auto-populate on bill
                    subsidiary: vendorRecord.getValue('subsidiary'),
                    currency: vendorRecord.getValue('currency'),
                    terms: vendorRecord.getValue('terms'),
                    category: vendorRecord.getValue('category'),

                    // Default accounts
                    expenseAccount: vendorRecord.getValue('expenseaccount'),
                    payablesAccount: vendorRecord.getValue('payablesaccount'),

                    // Tax info
                    taxItem: vendorRecord.getValue('taxitem'),
                    taxId: vendorRecord.getValue('taxidnum') || vendorRecord.getValue('vatregnumber'),

                    // Purchasing defaults
                    defaultTaxCode: vendorRecord.getValue('taxcode'),
                    incoterm: vendorRecord.getValue('incoterm'),

                    // Location/classification defaults
                    defaultLocation: null, // Will check custom fields
                    defaultDepartment: null,
                    defaultClass: null,

                    // Address for validation
                    defaultAddress: vendorRecord.getValue('defaultaddress'),
                    billAddress: this._getAddress(vendorRecord, 'billaddr'),

                    // Contact info (for extraction validation)
                    email: vendorRecord.getValue('email'),
                    phone: vendorRecord.getValue('phone'),

                    // Custom fields on vendor that might have defaults
                    customFields: this._loadCustomFields(vendorRecord),

                    // Metadata
                    _loadedAt: new Date().toISOString(),
                    _vendorId: vendorId
                };

                // Cache for reuse
                this._addToCache(vendorId, data);

                fcDebug.debug('VendorDataLoader.load', {
                    vendorId: vendorId,
                    subsidiary: data.subsidiary,
                    currency: data.currency,
                    terms: data.terms,
                    customFieldCount: Object.keys(data.customFields).length
                });

                return data;

            } catch (e) {
                log.error('VendorDataLoader', `Failed to load vendor ${vendorId}: ${e.message}`);
                return null;
            }
        }

        /**
         * Load multiple vendors efficiently using search
         *
         * @param {Array} vendorIds - Array of vendor IDs
         * @returns {Object} Map of vendorId -> vendor data
         */
        loadMultipleVendors(vendorIds) {
            const result = {};

            if (!vendorIds || vendorIds.length === 0) {
                return result;
            }

            // Check cache first
            const uncached = [];
            for (const id of vendorIds) {
                const cached = this._getFromCache(id);
                if (cached) {
                    result[id] = cached;
                } else {
                    uncached.push(id);
                }
            }

            if (uncached.length === 0) {
                return result;
            }

            try {
                // Use search for batch loading
                const vendorSearch = search.create({
                    type: search.Type.VENDOR,
                    filters: [
                        ['internalid', 'anyof', uncached]
                    ],
                    columns: [
                        'internalid',
                        'entityid',
                        'companyname',
                        'subsidiary',
                        'currency',
                        'terms',
                        'category',
                        'expenseaccount',
                        'email',
                        'phone',
                        'taxidnum'
                    ]
                });

                vendorSearch.run().each(function(searchResult) {
                    const id = searchResult.getValue('internalid');
                    result[id] = {
                        id: id,
                        entityId: searchResult.getValue('entityid'),
                        companyName: searchResult.getValue('companyname'),
                        subsidiary: searchResult.getValue('subsidiary'),
                        currency: searchResult.getValue('currency'),
                        terms: searchResult.getValue('terms'),
                        category: searchResult.getValue('category'),
                        expenseAccount: searchResult.getValue('expenseaccount'),
                        email: searchResult.getValue('email'),
                        phone: searchResult.getValue('phone'),
                        taxId: searchResult.getValue('taxidnum'),
                        customFields: {}, // Not available from search
                        _loadedAt: new Date().toISOString(),
                        _fromSearch: true
                    };
                    return true;
                });

            } catch (e) {
                log.error('VendorDataLoader.loadMultiple', e.message);
            }

            return result;
        }

        /**
         * Get vendor defaults specifically for bill/invoice population
         *
         * @param {number} vendorId - Vendor ID
         * @returns {Object} Defaults ready to apply to transaction
         */
        getVendorDefaults(vendorId) {
            const data = this.loadVendorData(vendorId);
            if (!data) return null;

            return {
                // Core transaction defaults
                subsidiary: data.subsidiary,
                currency: data.currency,
                terms: data.terms,

                // Account defaults
                expenseAccount: data.expenseAccount,
                payablesAccount: data.payablesAccount,

                // Tax
                taxCode: data.defaultTaxCode,
                taxItem: data.taxItem,

                // Classification (from custom fields if available)
                department: data.customFields.custentity_default_department || null,
                class: data.customFields.custentity_default_class || null,
                location: data.customFields.custentity_default_location || null,

                // For validation
                taxId: data.taxId,
                companyName: data.companyName
            };
        }

        /**
         * Load custom entity fields from vendor record
         * @private
         */
        _loadCustomFields(vendorRecord) {
            const customFields = {};

            try {
                const fields = vendorRecord.getFields();

                for (const fieldId of fields) {
                    if (fieldId.startsWith('custentity_')) {
                        const value = vendorRecord.getValue(fieldId);
                        if (value !== null && value !== '' && value !== undefined) {
                            customFields[fieldId] = value;
                        }
                    }
                }
            } catch (e) {
                fcDebug.debug('VendorDataLoader._loadCustomFields', e.message);
            }

            return customFields;
        }

        /**
         * Get address from vendor record
         * @private
         */
        _getAddress(vendorRecord, addressField) {
            try {
                const subrecord = vendorRecord.getSubrecord({ fieldId: addressField });
                if (subrecord) {
                    return {
                        addr1: subrecord.getValue('addr1'),
                        addr2: subrecord.getValue('addr2'),
                        city: subrecord.getValue('city'),
                        state: subrecord.getValue('state'),
                        zip: subrecord.getValue('zip'),
                        country: subrecord.getValue('country')
                    };
                }
            } catch (e) {
                // Address might not exist
            }
            return null;
        }

        /**
         * Get item from cache
         * @private
         */
        _getFromCache(vendorId) {
            const cached = this._cache.get(String(vendorId));
            if (cached && (Date.now() - cached.timestamp) < this._cacheMaxAge) {
                return cached.data;
            }
            return null;
        }

        /**
         * Add item to cache
         * @private
         */
        _addToCache(vendorId, data) {
            // Limit cache size
            if (this._cache.size > 100) {
                // Remove oldest entries
                const keys = [...this._cache.keys()];
                for (let i = 0; i < 20; i++) {
                    this._cache.delete(keys[i]);
                }
            }

            this._cache.set(String(vendorId), {
                data: data,
                timestamp: Date.now()
            });
        }

        /**
         * Clear cache (for testing)
         */
        clearCache() {
            this._cache.clear();
        }
    }

    return {
        VendorDataLoader: VendorDataLoader
    };
});
