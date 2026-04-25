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
         * @returns {Object} Custom body values and line-field mappings
         */
        matchCustomFields(allExtractedFields, formSchema, alreadyMatchedFields = {}, lineItems = []) {
            const customFieldMatches = {
                bodyFields: {},
                lineFields: {},
                summary: {
                    bodyCount: 0,
                    lineFieldCount: 0
                }
            };

            if (!allExtractedFields || !formSchema) {
                return customFieldMatches;
            }

            // Get custom fields from form schema
            const customFields = this.getCustomFieldsFromSchema(formSchema);
            const bodyCustomFields = customFields.bodyFields || [];
            const lineCustomFields = customFields.lineFields || {};

            if (bodyCustomFields.length === 0 && Object.keys(lineCustomFields).length === 0) {
                fcDebug.debug('DynamicFieldMatcher', 'No custom fields in form schema');
                return customFieldMatches;
            }

            fcDebug.debug('DynamicFieldMatcher', `Matching against ${bodyCustomFields.length} body custom fields and ${Object.keys(lineCustomFields).length} custom line-field groups`);

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
                if (this.isStandardField(extraction.label)) continue;
                if (matchedKeys.has(extractedKey)) continue;

                // Skip if no value
                if (!extraction.value || String(extraction.value).trim() === '') continue;

                // Try to find a matching custom field
                const match = this.findBestCustomFieldMatch(
                    extraction.label,
                    bodyCustomFields
                );

                if (match && match.confidence >= this.MIN_CONFIDENCE) {
                    // Don't override if we already matched this custom field
                    if (!customFieldMatches.bodyFields[match.fieldId] ||
                        customFieldMatches.bodyFields[match.fieldId].confidence < match.confidence) {

                        const matchData = {
                            value: extraction.value,
                            confidence: match.confidence,
                            sourceLabel: extraction.label,
                            matchedLabel: match.fieldLabel,
                            position: extraction.position,
                            fieldType: match.fieldType || 'text'
                        };
                        customFieldMatches.bodyFields[match.fieldId] = matchData;
                        // Backward-compatible flat access for older consumers.
                        customFieldMatches[match.fieldId] = matchData;

                        fcDebug.debug('DynamicFieldMatcher.match', {
                            sourceLabel: extraction.label,
                            matchedField: match.fieldId,
                            matchedLabel: match.fieldLabel,
                            confidence: match.confidence.toFixed(2)
                        });
                    }
                }
            }

            customFieldMatches.lineFields = this.matchLineCustomFields(lineItems, lineCustomFields);
            customFieldMatches.summary.bodyCount = Object.keys(customFieldMatches.bodyFields).length;
            customFieldMatches.summary.lineFieldCount = Object.keys(customFieldMatches.lineFields).reduce((count, sublistId) => {
                return count + Object.keys(customFieldMatches.lineFields[sublistId] || {}).length;
            }, 0);

            log.audit('DynamicFieldMatcher', `Matched ${customFieldMatches.summary.bodyCount} body custom fields and ${customFieldMatches.summary.lineFieldCount} line custom fields`);
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
                        confidence: 1.0,
                        fieldType: field.type || 'text'
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
                        confidence: containsScore,
                        fieldType: field.type || 'text'
                    };
                }

                // 3. Word overlap (Jaccard similarity)
                const overlapScore = this.wordOverlapScore(normalizedExtracted, normalizedLabel);
                if (overlapScore > bestScore) {
                    bestScore = overlapScore;
                    bestMatch = {
                        fieldId: field.id,
                        fieldLabel: field.label,
                        confidence: overlapScore,
                        fieldType: field.type || 'text'
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
                            confidence: prefixScore,
                            fieldType: field.type || 'text'
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
            return String(text)
                .replace(/([a-z])([A-Z])/g, '$1 $2')
                .toLowerCase()
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
         * @returns {Object} { bodyFields: Array, lineFields: Object }
         */
        getCustomFieldsFromSchema(formSchema) {
            const bodyFields = [];
            const lineFields = {};

            const addBodyField = (field) => {
                if (!field || !field.id) return;
                const id = this.getScriptId(field.id);
                if (!id || !id.startsWith('custbody_')) return;
                if (!bodyFields.some(f => f.id === id)) {
                    bodyFields.push({
                        id: id,
                        label: field.label || id,
                        type: field.type || 'text'
                    });
                }
            };

            const addLineField = (sublistId, field) => {
                if (!field || !field.id || !sublistId) return;
                const id = this.getScriptId(field.id);
                if (!id || !id.startsWith('custcol_')) return;
                const normalizedSublistId = String(sublistId).toLowerCase();
                lineFields[normalizedSublistId] = lineFields[normalizedSublistId] || [];
                if (!lineFields[normalizedSublistId].some(f => f.id === id)) {
                    lineFields[normalizedSublistId].push({
                        id: id,
                        label: field.label || id,
                        type: field.type || 'text'
                    });
                }
            };

            // Body fields
            if (formSchema.bodyFields && Array.isArray(formSchema.bodyFields)) {
                for (const field of formSchema.bodyFields) {
                    addBodyField(field);
                }
            }

            // Fields from field groups
            if (formSchema.fieldGroups && Array.isArray(formSchema.fieldGroups)) {
                for (const group of formSchema.fieldGroups) {
                    if (group.fields && Array.isArray(group.fields)) {
                        for (const field of group.fields) {
                            addBodyField(field);
                        }
                    }
                }
            }

            // Also check for fields in tabs structure
            if (formSchema.tabs && Array.isArray(formSchema.tabs)) {
                for (const tab of formSchema.tabs) {
                    if (tab.fields && Array.isArray(tab.fields)) {
                        for (const field of tab.fields) {
                            addBodyField(field);
                        }
                    }
                    if (tab.fieldGroups && Array.isArray(tab.fieldGroups)) {
                        for (const group of tab.fieldGroups) {
                            if (!group.fields || !Array.isArray(group.fields)) continue;
                            for (const field of group.fields) {
                                addBodyField(field);
                            }
                        }
                    }
                }
            }

            if (formSchema.sublists && Array.isArray(formSchema.sublists)) {
                for (const sublist of formSchema.sublists) {
                    const sublistId = sublist.id || sublist.type;
                    const fields = sublist.fields || sublist.columns || [];
                    for (const field of fields) {
                        addLineField(sublistId, field);
                    }
                }
            }

            return {
                bodyFields: bodyFields,
                lineFields: lineFields
            };
        }

        getScriptId(fieldId) {
            if (!fieldId) return '';
            let cleaned = String(fieldId).trim();
            if (cleaned.charAt(0) === '[' && cleaned.charAt(cleaned.length - 1) === ']') {
                const inner = cleaned.slice(1, -1);
                const match = inner.match(/scriptid\s*=\s*([^,\]]+)/i) ||
                    inner.match(/id\s*=\s*([^,\]]+)/i);
                if (match && match[1]) {
                    cleaned = match[1];
                } else if (inner.indexOf('=') === -1) {
                    cleaned = inner;
                }
            }
            return cleaned.replace(/^['"]|['"]$/g, '');
        }

        matchLineCustomFields(lineItems, lineCustomFields) {
            const lineFieldMatches = {};
            if (!Array.isArray(lineItems) || lineItems.length === 0 || !lineCustomFields) {
                return lineFieldMatches;
            }

            Object.keys(lineCustomFields).forEach(sublistId => {
                const fields = lineCustomFields[sublistId] || [];
                const matchesForSublist = {};
                if (fields.length === 0) return;

                lineItems.forEach(line => {
                    if (!line || typeof line !== 'object') return;

                    Object.keys(line).forEach(sourceKey => {
                        if (!sourceKey || sourceKey.charAt(0) === '_') return;
                        const value = line[sourceKey];
                        if (value === undefined || value === null || value === '') return;
                        if (sourceKey.toLowerCase().endsWith('_display')) return;
                        if (this.isStandardField(sourceKey)) return;

                        const sourceLabel = this.labelFromKey(sourceKey);
                        const match = this.findBestCustomFieldMatch(sourceLabel, fields);
                        if (match && match.confidence >= this.MIN_CONFIDENCE) {
                            const existing = matchesForSublist[match.fieldId];
                            if (!existing || existing.confidence < match.confidence) {
                                matchesForSublist[match.fieldId] = {
                                    sourceKey: sourceKey,
                                    sourceLabel: sourceLabel,
                                    matchedLabel: match.fieldLabel,
                                    confidence: match.confidence,
                                    fieldType: match.fieldType || 'text'
                                };
                            }
                        }
                    });
                });

                if (Object.keys(matchesForSublist).length > 0) {
                    lineFieldMatches[sublistId] = matchesForSublist;
                }
            });

            return lineFieldMatches;
        }

        labelFromKey(key) {
            if (!key) return '';
            return String(key)
                .replace(/([a-z])([A-Z])/g, '$1 $2')
                .replace(/[_\-]+/g, ' ')
                .trim();
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
