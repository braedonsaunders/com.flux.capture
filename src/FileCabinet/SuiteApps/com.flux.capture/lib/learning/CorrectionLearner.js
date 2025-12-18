/**
 * @NApiVersion 2.1
 * @NModuleScope Public
 * @module FluxCapture/Learning/CorrectionLearner
 *
 * Correction Learner
 * Learns from user corrections to improve future extractions
 * Stores learned patterns in Flux Configuration records
 */

define(['N/log', 'N/record', 'N/query', 'N/runtime', '../FC_Debug'], function(log, record, query, runtime, fcDebug) {
    'use strict';

    /**
     * Learning types stored in config records
     */
    const LearningType = Object.freeze({
        VENDOR_ALIAS: 'vendor_alias',           // OCR text -> correct vendor
        DATE_FORMAT: 'date_format',             // Vendor date format preference
        AMOUNT_FORMAT: 'amount_format',         // Vendor amount format (period/comma decimal)
        ACCOUNT_MAPPING: 'account_mapping',     // Description pattern -> GL account
        FIELD_PATTERN: 'field_pattern',         // Custom field extraction patterns
        EXTRACTION_TEMPLATE: 'extraction_template' // Vendor document layout template
    });

    /**
     * Correction Learner
     * Processes user corrections and stores learnings for future use
     */
    class CorrectionLearner {
        constructor(aliasManager) {
            this.aliasManager = aliasManager;
            this.CONFIG_RECORD_TYPE = 'customrecord_flux_config';
        }

        /**
         * Learn from a user correction
         * @param {Object} correction - Correction data
         * @param {string} correction.field - Field that was corrected
         * @param {*} correction.original - Original extracted value
         * @param {*} correction.corrected - User-corrected value
         * @param {number} correction.documentId - Document record ID
         * @param {number} correction.vendorId - Vendor ID (if known)
         * @param {Object} context - Additional context
         * @returns {Object} Learning result
         */
        learn(correction, context = {}) {
            if (!correction || !correction.field) {
                return { success: false, reason: 'Invalid correction data' };
            }

            fcDebug.debug('CorrectionLearner.learn', {
                field: correction.field,
                original: correction.original,
                corrected: correction.corrected,
                vendorId: correction.vendorId
            });

            try {
                switch (correction.field) {
                    case 'vendor':
                    case 'vendorName':
                        return this.learnVendorAlias(correction, context);

                    case 'invoiceDate':
                    case 'dueDate':
                        return this.learnDateFormat(correction, context);

                    case 'totalAmount':
                    case 'subtotal':
                    case 'taxAmount':
                        return this.learnAmountFormat(correction, context);

                    case 'lineItem.account':
                    case 'account':
                        return this.learnAccountMapping(correction, context);

                    default:
                        return this.learnFieldPattern(correction, context);
                }
            } catch (e) {
                log.error('CorrectionLearner.learn', e.message);
                return { success: false, reason: e.message };
            }
        }

        /**
         * Learn vendor alias from correction
         */
        learnVendorAlias(correction, context) {
            const originalText = String(correction.original || '').trim();
            const correctedVendorId = correction.corrected;

            if (!originalText || !correctedVendorId) {
                return { success: false, reason: 'Missing original text or vendor ID' };
            }

            // Delegate to AliasManager if available
            if (this.aliasManager) {
                return this.aliasManager.addAlias(originalText, correctedVendorId, {
                    source: 'correction',
                    documentId: correction.documentId
                });
            }

            // Fallback: store directly in config
            return this.storeConfig({
                type: LearningType.VENDOR_ALIAS,
                key: this.normalizeKey(originalText),
                data: {
                    aliasText: originalText,
                    vendorId: correctedVendorId,
                    usageCount: 1,
                    lastUsed: new Date().toISOString(),
                    createdFrom: correction.documentId
                }
            });
        }

        /**
         * Learn date format preference for vendor
         */
        learnDateFormat(correction, context) {
            const vendorId = correction.vendorId;
            if (!vendorId) {
                return { success: false, reason: 'Vendor ID required for date format learning' };
            }

            // Analyze the correction to determine format
            const originalStr = String(correction.original || '');
            const correctedDate = correction.corrected;

            if (!correctedDate || !(correctedDate instanceof Date)) {
                return { success: false, reason: 'Invalid corrected date' };
            }

            // Determine which format was intended
            const format = this.inferDateFormat(originalStr, correctedDate);
            if (!format) {
                return { success: false, reason: 'Could not infer date format' };
            }

            // Get existing or create new config
            const existing = this.getConfig(LearningType.DATE_FORMAT, `vendor_${vendorId}`);
            const data = existing?.data || {
                vendorId: vendorId,
                format: null,
                confidence: 0,
                sampleCount: 0,
                samples: []
            };

            // Update with new learning
            data.format = format;
            data.confidence = Math.min((data.confidence || 0.5) + 0.1, 0.98);
            data.sampleCount = (data.sampleCount || 0) + 1;
            data.samples = (data.samples || []).slice(-5); // Keep last 5 samples
            data.samples.push({
                original: originalStr,
                corrected: correctedDate.toISOString(),
                date: new Date().toISOString()
            });
            data.lastUpdated = new Date().toISOString();

            return this.storeConfig({
                type: LearningType.DATE_FORMAT,
                key: `vendor_${vendorId}`,
                data: data,
                existingId: existing?.id
            });
        }

        /**
         * Infer date format from original and corrected values
         */
        inferDateFormat(originalStr, correctedDate) {
            // Match common date patterns
            const match = originalStr.match(/^(\d{1,2})[\-\/\.](\d{1,2})[\-\/\.](\d{2,4})$/);
            if (!match) return null;

            const part1 = parseInt(match[1]);
            const part2 = parseInt(match[2]);
            const correctedDay = correctedDate.getDate();
            const correctedMonth = correctedDate.getMonth() + 1;

            if (part1 === correctedMonth && part2 === correctedDay) {
                return 'MDY'; // Month-Day-Year (US format)
            } else if (part1 === correctedDay && part2 === correctedMonth) {
                return 'DMY'; // Day-Month-Year (most of world)
            }

            return null;
        }

        /**
         * Learn amount format preference for vendor
         */
        learnAmountFormat(correction, context) {
            const vendorId = correction.vendorId;
            if (!vendorId) {
                return { success: false, reason: 'Vendor ID required for amount format learning' };
            }

            const originalStr = String(correction.original || '');
            const correctedAmount = parseFloat(correction.corrected);

            if (isNaN(correctedAmount)) {
                return { success: false, reason: 'Invalid corrected amount' };
            }

            // Determine format: PERIOD decimal or COMMA decimal
            const format = this.inferAmountFormat(originalStr, correctedAmount);
            if (!format) {
                return { success: false, reason: 'Could not infer amount format' };
            }

            // Get existing or create new config
            const existing = this.getConfig(LearningType.AMOUNT_FORMAT, `vendor_${vendorId}`);
            const data = existing?.data || {
                vendorId: vendorId,
                format: null,
                confidence: 0,
                sampleCount: 0
            };

            data.format = format;
            data.confidence = Math.min((data.confidence || 0.5) + 0.15, 0.98);
            data.sampleCount = (data.sampleCount || 0) + 1;
            data.lastUpdated = new Date().toISOString();

            return this.storeConfig({
                type: LearningType.AMOUNT_FORMAT,
                key: `vendor_${vendorId}`,
                data: data,
                existingId: existing?.id
            });
        }

        /**
         * Infer amount format from original and corrected values
         */
        inferAmountFormat(originalStr, correctedAmount) {
            const cleanStr = originalStr.replace(/[^0-9.,]/g, '');

            // Try parsing as period decimal
            const periodResult = parseFloat(cleanStr.replace(/,/g, ''));
            if (Math.abs(periodResult - correctedAmount) < 0.01) {
                return 'PERIOD';
            }

            // Try parsing as comma decimal
            const commaResult = parseFloat(cleanStr.replace(/\./g, '').replace(',', '.'));
            if (Math.abs(commaResult - correctedAmount) < 0.01) {
                return 'COMMA';
            }

            return null;
        }

        /**
         * Learn GL account mapping from line item correction
         */
        learnAccountMapping(correction, context) {
            const vendorId = correction.vendorId;
            const description = context.lineItemDescription || correction.lineItemDescription;
            const accountId = correction.corrected;

            if (!description || !accountId) {
                return { success: false, reason: 'Description and account ID required' };
            }

            // Extract keywords from description
            const keywords = this.extractKeywords(description);
            if (keywords.length === 0) {
                return { success: false, reason: 'No significant keywords in description' };
            }

            const key = vendorId ? `vendor_${vendorId}_${keywords[0]}` : `global_${keywords[0]}`;

            // Get existing or create new
            const existing = this.getConfig(LearningType.ACCOUNT_MAPPING, key);
            const data = existing?.data || {
                vendorId: vendorId || null,
                accountId: accountId,
                keywords: keywords,
                patterns: [],
                usageCount: 0
            };

            // Update
            data.accountId = accountId;
            data.usageCount = (data.usageCount || 0) + 1;

            // Store full description as pattern (for better matching)
            if (!data.patterns.includes(description.toLowerCase())) {
                data.patterns = data.patterns.slice(-10); // Keep last 10
                data.patterns.push(description.toLowerCase());
            }

            data.lastUpdated = new Date().toISOString();

            return this.storeConfig({
                type: LearningType.ACCOUNT_MAPPING,
                key: key,
                data: data,
                existingId: existing?.id
            });
        }

        /**
         * Learn custom field pattern
         */
        learnFieldPattern(correction, context) {
            // Generic field pattern learning
            const vendorId = correction.vendorId;
            const field = correction.field;
            const key = vendorId ? `vendor_${vendorId}_${field}` : `global_${field}`;

            const existing = this.getConfig(LearningType.FIELD_PATTERN, key);
            const data = existing?.data || {
                vendorId: vendorId || null,
                field: field,
                patterns: [],
                corrections: []
            };

            // Store this correction for potential pattern recognition
            data.corrections.push({
                original: correction.original,
                corrected: correction.corrected,
                date: new Date().toISOString()
            });

            // Keep only last 20 corrections
            data.corrections = data.corrections.slice(-20);
            data.lastUpdated = new Date().toISOString();

            return this.storeConfig({
                type: LearningType.FIELD_PATTERN,
                key: key,
                data: data,
                existingId: existing?.id
            });
        }

        /**
         * Get learned date format for vendor
         */
        getVendorDateFormat(vendorId) {
            if (!vendorId) return null;
            const config = this.getConfig(LearningType.DATE_FORMAT, `vendor_${vendorId}`);
            return config?.data || null;
        }

        /**
         * Get learned amount format for vendor
         */
        getVendorAmountFormat(vendorId) {
            if (!vendorId) return null;
            const config = this.getConfig(LearningType.AMOUNT_FORMAT, `vendor_${vendorId}`);
            return config?.data || null;
        }

        /**
         * Get suggested account for line item
         */
        getSuggestedAccount(vendorId, description) {
            if (!description) return null;

            const keywords = this.extractKeywords(description);
            if (keywords.length === 0) return null;

            // Try vendor-specific first
            if (vendorId) {
                for (const kw of keywords) {
                    const config = this.getConfig(LearningType.ACCOUNT_MAPPING, `vendor_${vendorId}_${kw}`);
                    if (config?.data?.accountId) {
                        return {
                            accountId: config.data.accountId,
                            confidence: Math.min(0.5 + (config.data.usageCount || 0) * 0.1, 0.9),
                            source: 'vendor_specific'
                        };
                    }
                }
            }

            // Try global patterns
            for (const kw of keywords) {
                const config = this.getConfig(LearningType.ACCOUNT_MAPPING, `global_${kw}`);
                if (config?.data?.accountId) {
                    return {
                        accountId: config.data.accountId,
                        confidence: Math.min(0.3 + (config.data.usageCount || 0) * 0.05, 0.7),
                        source: 'global'
                    };
                }
            }

            return null;
        }

        /**
         * Extract significant keywords from description
         */
        extractKeywords(description) {
            if (!description) return [];

            const stopWords = new Set([
                'the', 'a', 'an', 'and', 'or', 'for', 'to', 'of', 'in', 'at', 'by',
                'with', 'from', 'as', 'on', 'per', 'each', 'item', 'service', 'product'
            ]);

            return String(description)
                .toLowerCase()
                .replace(/[^a-z0-9\s]/g, ' ')
                .split(/\s+/)
                .filter(w => w.length >= 3 && !stopWords.has(w))
                .slice(0, 5); // Max 5 keywords
        }

        /**
         * Store config record
         */
        storeConfig(options) {
            const { type, key, data, existingId } = options;

            try {
                let configRecord;

                if (existingId) {
                    // Update existing
                    configRecord = record.load({
                        type: this.CONFIG_RECORD_TYPE,
                        id: existingId
                    });
                } else {
                    // Create new
                    configRecord = record.create({
                        type: this.CONFIG_RECORD_TYPE
                    });
                    configRecord.setValue('custrecord_flux_cfg_type', type);
                    configRecord.setValue('custrecord_flux_cfg_key', key);
                }

                configRecord.setValue('custrecord_flux_cfg_data', JSON.stringify(data));
                configRecord.setValue('custrecord_flux_cfg_active', true);
                configRecord.setValue('custrecord_flux_cfg_modified', new Date());
                configRecord.setValue('custrecord_flux_cfg_modified_by', runtime.getCurrentUser().id);
                configRecord.setValue('custrecord_flux_cfg_source', 'learning');

                const savedId = configRecord.save();

                fcDebug.debug('CorrectionLearner.storeConfig', {
                    type: type,
                    key: key,
                    id: savedId
                });

                return {
                    success: true,
                    configId: savedId,
                    type: type,
                    key: key
                };
            } catch (e) {
                log.error('CorrectionLearner.storeConfig', e.message);
                return { success: false, reason: e.message };
            }
        }

        /**
         * Get config record by type and key
         */
        getConfig(type, key) {
            try {
                const sql = `
                    SELECT id, custrecord_flux_cfg_data
                    FROM ${this.CONFIG_RECORD_TYPE}
                    WHERE custrecord_flux_cfg_type = ?
                    AND custrecord_flux_cfg_key = ?
                    AND custrecord_flux_cfg_active = 'T'
                    FETCH FIRST 1 ROWS ONLY
                `;

                const results = query.runSuiteQL({
                    query: sql,
                    params: [type, key]
                });

                if (results.results && results.results.length > 0) {
                    const row = results.results[0];
                    return {
                        id: row.values[0],
                        data: JSON.parse(row.values[1] || '{}')
                    };
                }
            } catch (e) {
                fcDebug.debug('CorrectionLearner.getConfig', e.message);
            }

            return null;
        }

        /**
         * Normalize key for storage
         */
        normalizeKey(text) {
            return String(text)
                .toLowerCase()
                .replace(/[^a-z0-9]/g, '_')
                .substring(0, 100);
        }

        /**
         * Get learning types enum
         */
        static get LearningType() {
            return LearningType;
        }
    }

    return {
        CorrectionLearner: CorrectionLearner,
        LearningType: LearningType
    };
});
