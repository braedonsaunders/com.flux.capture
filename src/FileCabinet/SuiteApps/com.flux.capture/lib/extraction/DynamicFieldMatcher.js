/**
 * @NApiVersion 2.1
 * @NModuleScope Public
 * @module FluxCapture/Extraction/DynamicFieldMatcher
 *
 * Dynamic Field Matcher
 * Matches unmatched OCR extractions against form custom fields
 * Provider-agnostic - works with any extraction provider's normalized output
 *
 * This module answers the question: "If the invoice has a field labeled 'Project Code'
 * and my form has a custom field labeled 'Project Code', should they be matched?"
 */

define(['N/log', '../FC_Debug'], function(log, fcDebug) {
    'use strict';

    /**
     * Dynamic Field Matcher
     * Matches extracted fields to form schema custom fields by label similarity
     */
    class DynamicFieldMatcher {

        constructor() {
            // Fields that are already handled by standard extraction
            this.STANDARD_FIELDS = new Set([
                'vendorname', 'vendor', 'entity',
                'invoicenumber', 'invoiceno', 'invoiceid', 'tranid',
                'invoicedate', 'trandate', 'date',
                'duedate', 'paymentdue',
                'ponumber', 'purchaseorder', 'po',
                'totalamount', 'total', 'grandtotal', 'amountdue',
                'subtotal', 'taxamount', 'tax',
                'memo', 'description', 'notes',
                'paymentterms', 'terms', 'currency'
            ]);

            // Minimum confidence for auto-matching
            this.MIN_CONFIDENCE = 0.7;
        }

        /**
         * Match unmatched extractions against form custom fields
         *
         * @param {Object} allExtractedFields - All OCR-extracted label/value pairs
         * @param {Object} formSchema - Form definition with custom fields
         * @param {Object} alreadyMatchedFields - Fields already matched to standard fields
         * @returns {Object} Map of fieldId -> { value, confidence, sourceLabel, matchedLabel }
         */
        matchCustomFields(allExtractedFields, formSchema, alreadyMatchedFields = {}) {
            const customFieldMatches = {};

            if (!allExtractedFields || !formSchema) {
                return customFieldMatches;
            }

            // Get custom fields from form schema
            const customFields = this.getCustomFieldsFromSchema(formSchema);

            if (customFields.length === 0) {
                fcDebug.debug('DynamicFieldMatcher', 'No custom fields in form schema');
                return customFieldMatches;
            }

            fcDebug.debug('DynamicFieldMatcher', `Matching against ${customFields.length} custom fields`);

            // Get set of already matched extraction keys
            const matchedKeys = new Set(
                Object.values(alreadyMatchedFields)
                    .filter(v => v)
                    .map(v => this.normalize(String(v)))
            );

            // Try to match each unmatched extraction
            for (const [extractedKey, extraction] of Object.entries(allExtractedFields)) {
                // Skip if this extraction was already matched to a standard field
                if (this.isStandardField(extractedKey)) continue;
                if (matchedKeys.has(extractedKey)) continue;

                // Skip if no value
                if (!extraction.value || String(extraction.value).trim() === '') continue;

                // Try to find a matching custom field
                const match = this.findBestCustomFieldMatch(
                    extraction.label,
                    customFields
                );

                if (match && match.confidence >= this.MIN_CONFIDENCE) {
                    // Don't override if we already matched this custom field
                    if (!customFieldMatches[match.fieldId] ||
                        customFieldMatches[match.fieldId].confidence < match.confidence) {

                        customFieldMatches[match.fieldId] = {
                            value: extraction.value,
                            confidence: match.confidence,
                            sourceLabel: extraction.label,
                            matchedLabel: match.fieldLabel,
                            position: extraction.position
                        };

                        fcDebug.debug('DynamicFieldMatcher.match', {
                            sourceLabel: extraction.label,
                            matchedField: match.fieldId,
                            matchedLabel: match.fieldLabel,
                            confidence: match.confidence.toFixed(2)
                        });
                    }
                }
            }

            log.audit('DynamicFieldMatcher', `Matched ${Object.keys(customFieldMatches).length} custom fields`);
            return customFieldMatches;
        }

        /**
         * Find the best matching custom field for an extracted label
         *
         * @param {string} extractedLabel - Label from OCR extraction
         * @param {Array} customFields - Array of { id, label, type }
         * @returns {Object|null} { fieldId, fieldLabel, confidence } or null
         */
        findBestCustomFieldMatch(extractedLabel, customFields) {
            if (!extractedLabel) return null;

            const normalizedExtracted = this.normalize(extractedLabel);
            let bestMatch = null;
            let bestScore = 0;

            for (const field of customFields) {
                const normalizedLabel = this.normalize(field.label);

                // 1. Exact match
                if (normalizedExtracted === normalizedLabel) {
                    return {
                        fieldId: field.id,
                        fieldLabel: field.label,
                        confidence: 1.0
                    };
                }

                // 2. Contains match (one contains the other)
                let containsScore = 0;
                if (normalizedExtracted.includes(normalizedLabel)) {
                    // Extracted "Project Code Number" contains field "Project Code"
                    containsScore = normalizedLabel.length / normalizedExtracted.length * 0.9;
                } else if (normalizedLabel.includes(normalizedExtracted)) {
                    // Field "Project Code Field" contains extracted "Project Code"
                    containsScore = normalizedExtracted.length / normalizedLabel.length * 0.85;
                }

                if (containsScore > bestScore) {
                    bestScore = containsScore;
                    bestMatch = {
                        fieldId: field.id,
                        fieldLabel: field.label,
                        confidence: containsScore
                    };
                }

                // 3. Word overlap (Jaccard similarity)
                const overlapScore = this.wordOverlapScore(normalizedExtracted, normalizedLabel);
                if (overlapScore > bestScore) {
                    bestScore = overlapScore;
                    bestMatch = {
                        fieldId: field.id,
                        fieldLabel: field.label,
                        confidence: overlapScore
                    };
                }

                // 4. Prefix/suffix match
                if (normalizedExtracted.startsWith(normalizedLabel) ||
                    normalizedLabel.startsWith(normalizedExtracted)) {
                    const prefixScore = 0.8;
                    if (prefixScore > bestScore) {
                        bestScore = prefixScore;
                        bestMatch = {
                            fieldId: field.id,
                            fieldLabel: field.label,
                            confidence: prefixScore
                        };
                    }
                }
            }

            return bestMatch;
        }

        /**
         * Calculate word overlap score (Jaccard similarity)
         */
        wordOverlapScore(text1, text2) {
            const words1 = new Set(text1.split(/\s+/).filter(w => w.length > 1));
            const words2 = new Set(text2.split(/\s+/).filter(w => w.length > 1));

            if (words1.size === 0 || words2.size === 0) return 0;

            const intersection = [...words1].filter(w => words2.has(w)).length;
            const union = new Set([...words1, ...words2]).size;

            // Boost score if significant words match
            const significantWords = [...words1].filter(w => w.length >= 4 && words2.has(w));
            const significantBoost = significantWords.length * 0.1;

            return Math.min((intersection / union) + significantBoost, 1.0);
        }

        /**
         * Normalize text for comparison
         */
        normalize(text) {
            if (!text) return '';
            return text.toLowerCase()
                .replace(/[^a-z0-9\s]/g, ' ')
                .replace(/\s+/g, ' ')
                .trim();
        }

        /**
         * Check if a field key is a standard field (already handled)
         */
        isStandardField(key) {
            const normalized = this.normalize(key);
            return this.STANDARD_FIELDS.has(normalized);
        }

        /**
         * Extract custom fields from form schema
         *
         * @param {Object} formSchema - Form schema from FC_FormSchemaExtractor
         * @returns {Array} Array of { id, label, type }
         */
        getCustomFieldsFromSchema(formSchema) {
            const customFields = [];

            // Body fields
            if (formSchema.bodyFields && Array.isArray(formSchema.bodyFields)) {
                for (const field of formSchema.bodyFields) {
                    if (field.id && field.id.startsWith('custbody_')) {
                        customFields.push({
                            id: field.id,
                            label: field.label || field.id,
                            type: field.type || 'text'
                        });
                    }
                }
            }

            // Fields from field groups
            if (formSchema.fieldGroups && Array.isArray(formSchema.fieldGroups)) {
                for (const group of formSchema.fieldGroups) {
                    if (group.fields && Array.isArray(group.fields)) {
                        for (const field of group.fields) {
                            if (field.id && field.id.startsWith('custbody_')) {
                                // Avoid duplicates
                                if (!customFields.some(f => f.id === field.id)) {
                                    customFields.push({
                                        id: field.id,
                                        label: field.label || field.id,
                                        type: field.type || 'text'
                                    });
                                }
                            }
                        }
                    }
                }
            }

            // Also check for fields in tabs structure
            if (formSchema.tabs && Array.isArray(formSchema.tabs)) {
                for (const tab of formSchema.tabs) {
                    if (tab.fields && Array.isArray(tab.fields)) {
                        for (const field of tab.fields) {
                            if (field.id && field.id.startsWith('custbody_')) {
                                if (!customFields.some(f => f.id === field.id)) {
                                    customFields.push({
                                        id: field.id,
                                        label: field.label || field.id,
                                        type: field.type || 'text'
                                    });
                                }
                            }
                        }
                    }
                }
            }

            return customFields;
        }

        /**
         * Get suggested matches for UI (returns all potential matches above threshold)
         *
         * @param {string} extractedLabel - Label from extraction
         * @param {Array} customFields - Custom fields to match against
         * @param {number} threshold - Minimum confidence (default 0.5)
         * @returns {Array} Array of { fieldId, fieldLabel, confidence } sorted by confidence
         */
        getSuggestedMatches(extractedLabel, customFields, threshold = 0.5) {
            const suggestions = [];

            if (!extractedLabel) return suggestions;

            const normalizedExtracted = this.normalize(extractedLabel);

            for (const field of customFields) {
                const normalizedLabel = this.normalize(field.label);

                // Calculate best score using all methods
                let score = 0;

                // Exact match
                if (normalizedExtracted === normalizedLabel) {
                    score = 1.0;
                } else {
                    // Word overlap
                    score = Math.max(score, this.wordOverlapScore(normalizedExtracted, normalizedLabel));

                    // Contains match
                    if (normalizedExtracted.includes(normalizedLabel)) {
                        score = Math.max(score, normalizedLabel.length / normalizedExtracted.length * 0.9);
                    } else if (normalizedLabel.includes(normalizedExtracted)) {
                        score = Math.max(score, normalizedExtracted.length / normalizedLabel.length * 0.85);
                    }
                }

                if (score >= threshold) {
                    suggestions.push({
                        fieldId: field.id,
                        fieldLabel: field.label,
                        confidence: score
                    });
                }
            }

            // Sort by confidence descending
            return suggestions.sort((a, b) => b.confidence - a.confidence);
        }
    }

    return {
        DynamicFieldMatcher: DynamicFieldMatcher
    };
});
