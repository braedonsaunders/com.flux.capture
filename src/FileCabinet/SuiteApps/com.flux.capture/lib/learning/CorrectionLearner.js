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
        DEPARTMENT_MAPPING: 'department_mapping', // Vendor/description -> department
        CLASS_MAPPING: 'class_mapping',         // Vendor/description -> class
        LOCATION_MAPPING: 'location_mapping',   // Vendor/description -> location
        VENDOR_DEFAULTS: 'vendor_defaults',     // Vendor -> default header values
        FIELD_PATTERN: 'field_pattern',         // Custom field extraction patterns
        EXTRACTION_TEMPLATE: 'extraction_template', // Vendor document layout template
        ITEM_MAPPING: 'item_mapping',           // OCR line item text -> NetSuite item ID
        CUSTOM_FIELD_MAPPING: 'custom_field_mapping' // OCR label -> custom field ID
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
         * v2.0: Enhanced logging and type tracking for transparency
         *
         * @param {Object} correction - Correction data
         * @param {string} correction.field - Field that was corrected
         * @param {*} correction.original - Original extracted value
         * @param {*} correction.corrected - User-corrected value
         * @param {number} correction.documentId - Document record ID
         * @param {number} correction.vendorId - Vendor ID (if known)
         * @param {Object} context - Additional context
         * @returns {Object} Learning result with type indicator
         */
        learn(correction, context = {}) {
            if (!correction || !correction.field) {
                log.error('CorrectionLearner.learn', 'Invalid correction data - missing field');
                return { success: false, reason: 'Invalid correction data', type: null };
            }

            log.audit('CorrectionLearner.learn', {
                field: correction.field,
                original: typeof correction.original === 'object' ? JSON.stringify(correction.original) : correction.original,
                corrected: typeof correction.corrected === 'object' ? JSON.stringify(correction.corrected) : correction.corrected,
                vendorId: correction.vendorId,
                documentId: correction.documentId
            });

            try {
                let result;
                let learningType;

                switch (correction.field) {
                    case 'vendor':
                    case 'vendorName':
                        learningType = LearningType.VENDOR_ALIAS;
                        result = this.learnVendorAlias(correction, context);
                        break;

                    case 'invoiceDate':
                    case 'dueDate':
                        learningType = LearningType.DATE_FORMAT;
                        result = this.learnDateFormat(correction, context);
                        break;

                    case 'totalAmount':
                    case 'subtotal':
                    case 'taxAmount':
                        learningType = LearningType.AMOUNT_FORMAT;
                        result = this.learnAmountFormat(correction, context);
                        break;

                    case 'lineItem.account':
                    case 'account':
                        learningType = LearningType.ACCOUNT_MAPPING;
                        result = this.learnAccountMapping(correction, context);
                        break;

                    case 'lineItem.item':
                    case 'item':
                        // Learn item mapping: OCR text -> NetSuite item ID
                        learningType = LearningType.ITEM_MAPPING;
                        result = this.learnItemMapping(correction, context);
                        break;

                    case 'customField':
                        // Learn custom field assignment: OCR label -> form field ID
                        learningType = LearningType.CUSTOM_FIELD_MAPPING;
                        result = this.learnCustomFieldMapping(correction, context);
                        break;

                    case 'department':
                    case 'lineItem.department':
                        learningType = LearningType.DEPARTMENT_MAPPING;
                        result = this.learnSegmentMapping(correction, context, LearningType.DEPARTMENT_MAPPING);
                        break;

                    case 'class':
                    case 'lineItem.class':
                        learningType = LearningType.CLASS_MAPPING;
                        result = this.learnSegmentMapping(correction, context, LearningType.CLASS_MAPPING);
                        break;

                    case 'location':
                    case 'lineItem.location':
                        learningType = LearningType.LOCATION_MAPPING;
                        result = this.learnSegmentMapping(correction, context, LearningType.LOCATION_MAPPING);
                        break;

                    default:
                        learningType = LearningType.FIELD_PATTERN;
                        result = this.learnFieldPattern(correction, context);
                }

                // Add type to result for tracking
                result.type = learningType;

                if (result.success) {
                    log.audit('CorrectionLearner.learn', `Successfully learned ${learningType} pattern`);
                } else {
                    log.debug('CorrectionLearner.learn', `Learning ${learningType} failed: ${result.reason}`);
                }

                return result;
            } catch (e) {
                log.error('CorrectionLearner.learn', { message: e.message, stack: e.stack });
                return { success: false, reason: e.message, type: null };
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
         * v2.0: More robust - handles string dates, optional vendorId
         */
        learnDateFormat(correction, context) {
            const vendorId = correction.vendorId;

            // Analyze the correction to determine format
            const originalStr = String(correction.original || '');
            let correctedDate = correction.corrected;

            // Convert string to Date if needed
            if (typeof correctedDate === 'string') {
                try {
                    correctedDate = new Date(correctedDate);
                } catch (e) {
                    fcDebug.debug('CorrectionLearner.learnDateFormat', `Failed to parse date string: ${correctedDate}`);
                }
            }

            if (!correctedDate || !(correctedDate instanceof Date) || isNaN(correctedDate.getTime())) {
                fcDebug.debug('CorrectionLearner.learnDateFormat', 'Invalid corrected date');
                return { success: false, reason: 'Invalid corrected date' };
            }

            // Determine which format was intended
            const format = this.inferDateFormat(originalStr, correctedDate);
            if (!format) {
                fcDebug.debug('CorrectionLearner.learnDateFormat', `Could not infer format from: original="${originalStr}", corrected="${correctedDate}"`);
                return { success: false, reason: 'Could not infer date format' };
            }

            // Use 'global' if no vendorId (can still learn patterns)
            const configKey = vendorId ? `vendor_${vendorId}` : 'global_date_format';

            // Get existing or create new config
            const existing = this.getConfig(LearningType.DATE_FORMAT, configKey);
            const data = existing?.data || {
                vendorId: vendorId || null,
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

            log.audit('CorrectionLearner.learnDateFormat', {
                format: format,
                vendorId: vendorId,
                configKey: configKey,
                sampleCount: data.sampleCount
            });

            return this.storeConfig({
                type: LearningType.DATE_FORMAT,
                key: configKey,
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
         * v2.0: More robust - optional vendorId, better logging
         */
        learnAmountFormat(correction, context) {
            const vendorId = correction.vendorId;

            const originalStr = String(correction.original || '');
            const correctedAmount = parseFloat(correction.corrected);

            if (isNaN(correctedAmount)) {
                fcDebug.debug('CorrectionLearner.learnAmountFormat', 'Invalid corrected amount');
                return { success: false, reason: 'Invalid corrected amount' };
            }

            // Determine format: PERIOD decimal or COMMA decimal
            const format = this.inferAmountFormat(originalStr, correctedAmount);
            if (!format) {
                fcDebug.debug('CorrectionLearner.learnAmountFormat', `Could not infer format from: original="${originalStr}", corrected=${correctedAmount}`);
                return { success: false, reason: 'Could not infer amount format' };
            }

            // Use 'global' if no vendorId
            const configKey = vendorId ? `vendor_${vendorId}` : 'global_amount_format';

            // Get existing or create new config
            const existing = this.getConfig(LearningType.AMOUNT_FORMAT, configKey);
            const data = existing?.data || {
                vendorId: vendorId || null,
                format: null,
                confidence: 0,
                sampleCount: 0
            };

            data.format = format;
            data.confidence = Math.min((data.confidence || 0.5) + 0.15, 0.98);
            data.sampleCount = (data.sampleCount || 0) + 1;
            data.lastUpdated = new Date().toISOString();

            log.audit('CorrectionLearner.learnAmountFormat', {
                format: format,
                vendorId: vendorId,
                configKey: configKey,
                sampleCount: data.sampleCount
            });

            return this.storeConfig({
                type: LearningType.AMOUNT_FORMAT,
                key: configKey,
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
         * Learn item mapping: OCR line item text -> NetSuite item ID
         * When user selects an item for a line item, remember it for this vendor
         */
        learnItemMapping(correction, context) {
            const vendorId = correction.vendorId;
            const ocrText = String(correction.original || context.lineItemDescription || '').trim();
            const itemId = correction.corrected;

            if (!ocrText || !itemId) {
                return { success: false, reason: 'Missing OCR text or item ID' };
            }

            // Normalize the OCR text for matching
            const normalizedText = ocrText.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').trim();

            // Key: vendor-specific or global
            const key = vendorId ? `vendor_${vendorId}` : 'global';

            // Get existing mappings for this vendor
            const existing = this.getConfig(LearningType.ITEM_MAPPING, key);
            const data = existing?.data || {
                vendorId: vendorId || null,
                mappings: []
            };

            // Check if we already have a mapping for this text
            const existingMapping = data.mappings.find(m =>
                m.normalizedText === normalizedText
            );

            if (existingMapping) {
                // Update existing mapping
                existingMapping.itemId = itemId;
                existingMapping.usageCount = (existingMapping.usageCount || 0) + 1;
                existingMapping.lastUsed = new Date().toISOString();
                existingMapping.confidence = Math.min(0.5 + existingMapping.usageCount * 0.1, 0.95);
            } else {
                // Add new mapping
                data.mappings.push({
                    ocrText: ocrText,
                    normalizedText: normalizedText,
                    itemId: itemId,
                    usageCount: 1,
                    confidence: 0.6,
                    createdAt: new Date().toISOString(),
                    lastUsed: new Date().toISOString()
                });
            }

            // Keep only last 100 mappings per vendor
            data.mappings = data.mappings
                .sort((a, b) => new Date(b.lastUsed) - new Date(a.lastUsed))
                .slice(0, 100);

            data.lastUpdated = new Date().toISOString();

            log.audit('CorrectionLearner.learnItemMapping', {
                vendorId: vendorId,
                ocrText: ocrText.substring(0, 50),
                itemId: itemId,
                mappingCount: data.mappings.length
            });

            return this.storeConfig({
                type: LearningType.ITEM_MAPPING,
                key: key,
                data: data,
                existingId: existing?.id
            });
        }

        /**
         * Learn custom field mapping: OCR label -> form custom field ID
         * When user assigns an extracted field to a custom field, remember it
         */
        learnCustomFieldMapping(correction, context) {
            const vendorId = correction.vendorId;
            const sourceLabel = String(correction.original || context.sourceLabel || '').trim();
            const targetFieldId = correction.corrected;

            if (!sourceLabel || !targetFieldId) {
                return { success: false, reason: 'Missing source label or target field ID' };
            }

            // Normalize the label for matching
            const normalizedLabel = sourceLabel.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').trim();

            // Key: vendor-specific or global
            const key = vendorId ? `vendor_${vendorId}` : 'global';

            // Get existing mappings
            const existing = this.getConfig(LearningType.CUSTOM_FIELD_MAPPING, key);
            const data = existing?.data || {
                vendorId: vendorId || null,
                mappings: []
            };

            // Check if we already have a mapping for this label
            const existingMapping = data.mappings.find(m =>
                m.normalizedLabel === normalizedLabel
            );

            if (existingMapping) {
                // Update existing mapping
                existingMapping.targetFieldId = targetFieldId;
                existingMapping.usageCount = (existingMapping.usageCount || 0) + 1;
                existingMapping.lastUsed = new Date().toISOString();
                existingMapping.confidence = Math.min(0.6 + existingMapping.usageCount * 0.1, 0.98);
            } else {
                // Add new mapping
                data.mappings.push({
                    sourceLabel: sourceLabel,
                    normalizedLabel: normalizedLabel,
                    targetFieldId: targetFieldId,
                    usageCount: 1,
                    confidence: 0.7,
                    createdAt: new Date().toISOString(),
                    lastUsed: new Date().toISOString()
                });
            }

            // Keep only last 50 mappings per vendor
            data.mappings = data.mappings
                .sort((a, b) => new Date(b.lastUsed) - new Date(a.lastUsed))
                .slice(0, 50);

            data.lastUpdated = new Date().toISOString();

            log.audit('CorrectionLearner.learnCustomFieldMapping', {
                vendorId: vendorId,
                sourceLabel: sourceLabel,
                targetFieldId: targetFieldId,
                mappingCount: data.mappings.length
            });

            return this.storeConfig({
                type: LearningType.CUSTOM_FIELD_MAPPING,
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
         * Get suggested item for line item description
         * Matches OCR text against learned item mappings
         */
        getSuggestedItem(vendorId, ocrText) {
            if (!ocrText) return null;

            const normalizedText = ocrText.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').trim();

            // Try vendor-specific first
            if (vendorId) {
                const vendorConfig = this.getConfig(LearningType.ITEM_MAPPING, `vendor_${vendorId}`);
                if (vendorConfig?.data?.mappings) {
                    // Exact match first
                    const exactMatch = vendorConfig.data.mappings.find(m =>
                        m.normalizedText === normalizedText
                    );
                    if (exactMatch) {
                        return {
                            itemId: exactMatch.itemId,
                            confidence: exactMatch.confidence || 0.8,
                            source: 'vendor_specific',
                            matchType: 'exact'
                        };
                    }

                    // Contains match
                    const containsMatch = vendorConfig.data.mappings.find(m =>
                        normalizedText.includes(m.normalizedText) ||
                        m.normalizedText.includes(normalizedText)
                    );
                    if (containsMatch) {
                        return {
                            itemId: containsMatch.itemId,
                            confidence: (containsMatch.confidence || 0.6) * 0.8,
                            source: 'vendor_specific',
                            matchType: 'partial'
                        };
                    }
                }
            }

            // Try global mappings
            const globalConfig = this.getConfig(LearningType.ITEM_MAPPING, 'global');
            if (globalConfig?.data?.mappings) {
                const match = globalConfig.data.mappings.find(m =>
                    m.normalizedText === normalizedText
                );
                if (match) {
                    return {
                        itemId: match.itemId,
                        confidence: (match.confidence || 0.5) * 0.7,
                        source: 'global',
                        matchType: 'exact'
                    };
                }
            }

            return null;
        }

        /**
         * Get suggested custom field for OCR label
         * Matches OCR label against learned custom field mappings
         */
        getSuggestedCustomField(vendorId, sourceLabel) {
            if (!sourceLabel) return null;

            const normalizedLabel = sourceLabel.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').trim();

            // Try vendor-specific first
            if (vendorId) {
                const vendorConfig = this.getConfig(LearningType.CUSTOM_FIELD_MAPPING, `vendor_${vendorId}`);
                if (vendorConfig?.data?.mappings) {
                    const match = vendorConfig.data.mappings.find(m =>
                        m.normalizedLabel === normalizedLabel
                    );
                    if (match) {
                        return {
                            fieldId: match.targetFieldId,
                            confidence: match.confidence || 0.8,
                            source: 'vendor_specific'
                        };
                    }
                }
            }

            // Try global mappings
            const globalConfig = this.getConfig(LearningType.CUSTOM_FIELD_MAPPING, 'global');
            if (globalConfig?.data?.mappings) {
                const match = globalConfig.data.mappings.find(m =>
                    m.normalizedLabel === normalizedLabel
                );
                if (match) {
                    return {
                        fieldId: match.targetFieldId,
                        confidence: (match.confidence || 0.6) * 0.8,
                        source: 'global'
                    };
                }
            }

            return null;
        }

        /**
         * Get all item mappings for a vendor (for bulk processing)
         */
        getVendorItemMappings(vendorId) {
            if (!vendorId) return [];

            const config = this.getConfig(LearningType.ITEM_MAPPING, `vendor_${vendorId}`);
            return config?.data?.mappings || [];
        }

        /**
         * Get all custom field mappings for a vendor
         */
        getVendorCustomFieldMappings(vendorId) {
            if (!vendorId) return [];

            const config = this.getConfig(LearningType.CUSTOM_FIELD_MAPPING, `vendor_${vendorId}`);
            return config?.data?.mappings || [];
        }

        /**
         * Learn segment mapping (department, class, or location)
         * Generic method for learning classification fields
         */
        learnSegmentMapping(correction, context, segmentType) {
            const vendorId = correction.vendorId;
            const segmentId = correction.corrected;
            const description = context.lineItemDescription || correction.lineItemDescription || '';

            if (!segmentId) {
                return { success: false, reason: 'Missing segment ID' };
            }

            // Key: vendor-specific or use description keywords
            const keywords = this.extractKeywords(description);
            const key = vendorId
                ? `vendor_${vendorId}`
                : (keywords.length > 0 ? `global_${keywords[0]}` : 'global_default');

            const existing = this.getConfig(segmentType, key);
            const data = existing?.data || {
                vendorId: vendorId || null,
                segmentId: segmentId,
                keywords: keywords,
                patterns: [],
                usageCount: 0
            };

            // Update
            data.segmentId = segmentId;
            data.usageCount = (data.usageCount || 0) + 1;

            // Store description pattern for matching
            if (description && !data.patterns.includes(description.toLowerCase())) {
                data.patterns = data.patterns.slice(-10);
                data.patterns.push(description.toLowerCase());
            }

            data.lastUpdated = new Date().toISOString();

            log.audit('CorrectionLearner.learnSegmentMapping', {
                segmentType: segmentType,
                vendorId: vendorId,
                segmentId: segmentId,
                usageCount: data.usageCount
            });

            return this.storeConfig({
                type: segmentType,
                key: key,
                data: data,
                existingId: existing?.id
            });
        }

        /**
         * Learn from an approved transaction
         * Captures all coding data for future auto-suggestions
         * @param {Object} approvalData - Data from the approved transaction
         * @param {number} approvalData.vendorId - Vendor ID
         * @param {Object} approvalData.headerFields - Header field values (department, class, location, etc.)
         * @param {Array} approvalData.lineItems - Line items with account, department, class, location
         * @returns {Object} Learning results summary
         */
        learnFromApproval(approvalData) {
            if (!approvalData || !approvalData.vendorId) {
                return { success: false, reason: 'Missing vendor ID' };
            }

            const vendorId = approvalData.vendorId;
            const results = {
                vendorDefaults: null,
                lineItemLearnings: [],
                success: true
            };

            try {
                // 1. Learn vendor defaults from header fields
                const headerFields = approvalData.headerFields || {};
                const vendorDefaultsResult = this.learnVendorDefaults(vendorId, headerFields);
                results.vendorDefaults = vendorDefaultsResult;

                // 2. Learn from each line item
                const lineItems = approvalData.lineItems || [];
                for (let i = 0; i < lineItems.length; i++) {
                    const line = lineItems[i];
                    const description = line.description || line.memo || '';

                    if (!description) continue;

                    const lineLearnings = {};

                    // Learn account mapping
                    if (line.account) {
                        const accountResult = this.learnAccountMapping({
                            vendorId: vendorId,
                            corrected: line.account,
                            lineItemDescription: description
                        }, { lineItemDescription: description });
                        lineLearnings.account = accountResult.success;
                    }

                    // Learn department mapping
                    if (line.department) {
                        const deptResult = this.learnSegmentMapping({
                            vendorId: vendorId,
                            corrected: line.department
                        }, { lineItemDescription: description }, LearningType.DEPARTMENT_MAPPING);
                        lineLearnings.department = deptResult.success;
                    }

                    // Learn class mapping
                    if (line.class) {
                        const classResult = this.learnSegmentMapping({
                            vendorId: vendorId,
                            corrected: line.class
                        }, { lineItemDescription: description }, LearningType.CLASS_MAPPING);
                        lineLearnings.class = classResult.success;
                    }

                    // Learn location mapping
                    if (line.location) {
                        const locResult = this.learnSegmentMapping({
                            vendorId: vendorId,
                            corrected: line.location
                        }, { lineItemDescription: description }, LearningType.LOCATION_MAPPING);
                        lineLearnings.location = locResult.success;
                    }

                    // Learn item mapping if item ID present
                    if (line.item && description) {
                        const itemResult = this.learnItemMapping({
                            vendorId: vendorId,
                            original: description,
                            corrected: line.item
                        }, { lineItemDescription: description });
                        lineLearnings.item = itemResult.success;
                    }

                    results.lineItemLearnings.push({
                        index: i,
                        description: description.substring(0, 50),
                        learnings: lineLearnings
                    });
                }

                log.audit('CorrectionLearner.learnFromApproval', {
                    vendorId: vendorId,
                    headerLearned: results.vendorDefaults?.success,
                    linesLearned: results.lineItemLearnings.length
                });

                return results;
            } catch (e) {
                log.error('CorrectionLearner.learnFromApproval', e.message);
                return { success: false, reason: e.message };
            }
        }

        /**
         * Learn vendor defaults from header fields
         * Stores default department, class, location, payment terms for this vendor
         */
        learnVendorDefaults(vendorId, headerFields) {
            if (!vendorId) {
                return { success: false, reason: 'Missing vendor ID' };
            }

            const key = `vendor_${vendorId}`;
            const existing = this.getConfig(LearningType.VENDOR_DEFAULTS, key);
            const data = existing?.data || {
                vendorId: vendorId,
                defaults: {},
                usageCount: 0
            };

            // Update defaults from header fields
            const fieldsToLearn = ['department', 'class', 'location', 'terms', 'account'];
            for (const field of fieldsToLearn) {
                if (headerFields[field]) {
                    if (!data.defaults[field]) {
                        data.defaults[field] = { value: headerFields[field], count: 1 };
                    } else if (data.defaults[field].value === headerFields[field]) {
                        data.defaults[field].count++;
                    } else {
                        // Different value - update if new value is more common or recent
                        data.defaults[field] = { value: headerFields[field], count: 1 };
                    }
                }
            }

            data.usageCount = (data.usageCount || 0) + 1;
            data.lastUpdated = new Date().toISOString();

            return this.storeConfig({
                type: LearningType.VENDOR_DEFAULTS,
                key: key,
                data: data,
                existingId: existing?.id
            });
        }

        /**
         * Get vendor defaults (department, class, location, etc.)
         */
        getVendorDefaults(vendorId) {
            if (!vendorId) return null;

            const config = this.getConfig(LearningType.VENDOR_DEFAULTS, `vendor_${vendorId}`);
            if (!config?.data?.defaults) return null;

            // Convert stored defaults to suggestion format
            const suggestions = {};
            const defaults = config.data.defaults;
            const usageCount = config.data.usageCount || 1;

            for (const [field, info] of Object.entries(defaults)) {
                suggestions[field] = {
                    value: info.value,
                    confidence: Math.min(0.5 + (info.count / usageCount) * 0.4, 0.95),
                    source: 'vendor_defaults',
                    usageCount: info.count
                };
            }

            return suggestions;
        }

        /**
         * Get suggested segment (department, class, or location)
         */
        getSuggestedSegment(vendorId, description, segmentType) {
            // Try vendor-specific first
            if (vendorId) {
                const vendorConfig = this.getConfig(segmentType, `vendor_${vendorId}`);
                if (vendorConfig?.data?.segmentId) {
                    return {
                        id: vendorConfig.data.segmentId,
                        confidence: Math.min(0.6 + (vendorConfig.data.usageCount || 0) * 0.05, 0.92),
                        source: 'vendor_specific'
                    };
                }
            }

            // Try keyword-based global patterns
            if (description) {
                const keywords = this.extractKeywords(description);
                for (const kw of keywords) {
                    const globalConfig = this.getConfig(segmentType, `global_${kw}`);
                    if (globalConfig?.data?.segmentId) {
                        return {
                            id: globalConfig.data.segmentId,
                            confidence: Math.min(0.4 + (globalConfig.data.usageCount || 0) * 0.03, 0.75),
                            source: 'global_keyword'
                        };
                    }
                }
            }

            return null;
        }

        /**
         * Get all coding suggestions for a document
         * Returns header defaults and line item suggestions in one call
         * @param {number} vendorId - Vendor ID
         * @param {Array} lineItems - Array of line items with descriptions
         * @returns {Object} All suggestions organized by header and line items
         */
        getSuggestedCoding(vendorId, lineItems = []) {
            const result = {
                headerDefaults: {},
                lineItemSuggestions: [],
                meta: {
                    vendorId: vendorId,
                    timestamp: new Date().toISOString(),
                    hasLearning: false
                }
            };

            try {
                // 1. Get vendor defaults for header
                const vendorDefaults = this.getVendorDefaults(vendorId);
                if (vendorDefaults) {
                    result.headerDefaults = vendorDefaults;
                    result.meta.hasLearning = true;
                }

                // 2. Get suggestions for each line item
                for (let i = 0; i < lineItems.length; i++) {
                    const line = lineItems[i];
                    const description = line.description || line.memo || '';

                    const lineSuggestions = {
                        index: i,
                        description: description.substring(0, 100)
                    };

                    // Account suggestion
                    const accountSuggestion = this.getSuggestedAccount(vendorId, description);
                    if (accountSuggestion) {
                        lineSuggestions.account = accountSuggestion;
                        result.meta.hasLearning = true;
                    }

                    // Department suggestion
                    const deptSuggestion = this.getSuggestedSegment(vendorId, description, LearningType.DEPARTMENT_MAPPING);
                    if (deptSuggestion) {
                        lineSuggestions.department = deptSuggestion;
                        result.meta.hasLearning = true;
                    }

                    // Class suggestion
                    const classSuggestion = this.getSuggestedSegment(vendorId, description, LearningType.CLASS_MAPPING);
                    if (classSuggestion) {
                        lineSuggestions.class = classSuggestion;
                        result.meta.hasLearning = true;
                    }

                    // Location suggestion
                    const locSuggestion = this.getSuggestedSegment(vendorId, description, LearningType.LOCATION_MAPPING);
                    if (locSuggestion) {
                        lineSuggestions.location = locSuggestion;
                        result.meta.hasLearning = true;
                    }

                    // Item suggestion
                    const itemSuggestion = this.getSuggestedItem(vendorId, description);
                    if (itemSuggestion) {
                        lineSuggestions.item = itemSuggestion;
                        result.meta.hasLearning = true;
                    }

                    result.lineItemSuggestions.push(lineSuggestions);
                }

                return result;
            } catch (e) {
                log.error('CorrectionLearner.getSuggestedCoding', e.message);
                result.error = e.message;
                return result;
            }
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
