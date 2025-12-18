/**
 * @NApiVersion 2.1
 * @NModuleScope Public
 * @module FluxCapture/Extraction/FieldMatcher
 *
 * Semantic Field Matcher - Context-aware field extraction with specificity scoring
 * Replaces naive substring matching with intelligent pattern-based matching
 */

define(['N/log'], function(log) {
    'use strict';

    /**
     * Semantic Field Matcher
     * Uses weighted patterns with specificity scores to accurately match OCR labels to fields
     */
    class FieldMatcher {
        constructor() {
            this.initializePatterns();
        }

        /**
         * Initialize field patterns with specificity scores
         * Higher scores = more specific/confident matches
         */
        initializePatterns() {
            // Patterns ordered by specificity (highest first within each field)
            this.FIELD_PATTERNS = {
                totalAmount: [
                    { pattern: /^grand\s*total$/i, score: 1.0, zone: 'TOTALS' },
                    { pattern: /^total\s*(amount\s*)?(due|owed|payable|to\s*pay)$/i, score: 0.98, zone: 'TOTALS' },
                    { pattern: /^amount\s*(due|owed|payable)$/i, score: 0.96, zone: 'TOTALS' },
                    { pattern: /^balance\s*(due|owed|outstanding)$/i, score: 0.95, zone: 'TOTALS' },
                    { pattern: /^invoice\s*total$/i, score: 0.94, zone: 'TOTALS' },
                    { pattern: /^net\s*payable$/i, score: 0.93, zone: 'TOTALS' },
                    { pattern: /^total\s*due$/i, score: 0.92, zone: 'TOTALS' },
                    { pattern: /^pay\s*this\s*amount$/i, score: 0.91, zone: 'TOTALS' },
                    { pattern: /^amount$/i, score: 0.5, zone: 'TOTALS' },  // Ambiguous - needs context
                    { pattern: /^total$/i, score: 0.45, zone: 'TOTALS' }   // Very ambiguous
                ],

                subtotal: [
                    { pattern: /^sub[\s\-]*total$/i, score: 1.0, zone: 'TOTALS' },
                    { pattern: /^net\s*(amount|total)$/i, score: 0.95, zone: 'TOTALS' },
                    { pattern: /^(amount\s*)?before\s*tax$/i, score: 0.93, zone: 'TOTALS' },
                    { pattern: /^pre[\s\-]*tax\s*(total|amount)?$/i, score: 0.92, zone: 'TOTALS' },
                    { pattern: /^merchandise\s*total$/i, score: 0.90, zone: 'TOTALS' },
                    { pattern: /^goods\s*total$/i, score: 0.88, zone: 'TOTALS' }
                ],

                taxAmount: [
                    { pattern: /^(sales\s*)?tax\s*(amount|total)?$/i, score: 1.0, zone: 'TOTALS' },
                    { pattern: /^vat\s*(amount)?$/i, score: 0.98, zone: 'TOTALS' },
                    { pattern: /^gst\s*(amount)?$/i, score: 0.97, zone: 'TOTALS' },
                    { pattern: /^hst\s*(amount)?$/i, score: 0.96, zone: 'TOTALS' },
                    { pattern: /^pst\s*(amount)?$/i, score: 0.95, zone: 'TOTALS' },
                    { pattern: /^total\s*tax$/i, score: 0.94, zone: 'TOTALS' },
                    { pattern: /^tax$/i, score: 0.85, zone: 'TOTALS' }
                ],

                invoiceNumber: [
                    { pattern: /^invoice\s*(number|no\.?|#|id)$/i, score: 1.0, zone: 'HEADER' },
                    { pattern: /^inv[\.\s]*(no\.?|#|number)?$/i, score: 0.98, zone: 'HEADER' },
                    { pattern: /^bill\s*(number|no\.?|#)$/i, score: 0.95, zone: 'HEADER' },
                    { pattern: /^document\s*(number|no\.?|#|id)$/i, score: 0.90, zone: 'HEADER' },
                    { pattern: /^reference\s*(number|no\.?|#)?$/i, score: 0.85, zone: 'HEADER' },
                    { pattern: /^ref\.?\s*(no\.?|#)?$/i, score: 0.80, zone: 'HEADER' },
                    { pattern: /^receipt\s*(number|no\.?|#)$/i, score: 0.88, zone: 'HEADER' },
                    { pattern: /^transaction\s*(id|number|no\.?)$/i, score: 0.82, zone: 'HEADER' },
                    { pattern: /^order\s*(id|number|no\.?)$/i, score: 0.70, zone: 'HEADER' }, // Could be PO
                    { pattern: /^invoice$/i, score: 0.60, zone: 'HEADER' } // Needs value context
                ],

                invoiceDate: [
                    { pattern: /^invoice\s*date$/i, score: 1.0, zone: 'HEADER' },
                    { pattern: /^inv\.?\s*date$/i, score: 0.98, zone: 'HEADER' },
                    { pattern: /^bill\s*date$/i, score: 0.95, zone: 'HEADER' },
                    { pattern: /^document\s*date$/i, score: 0.93, zone: 'HEADER' },
                    { pattern: /^issue\s*date$/i, score: 0.92, zone: 'HEADER' },
                    { pattern: /^date\s*issued$/i, score: 0.91, zone: 'HEADER' },
                    { pattern: /^transaction\s*date$/i, score: 0.88, zone: 'HEADER' },
                    { pattern: /^dated?$/i, score: 0.50, zone: 'HEADER' } // Very ambiguous
                ],

                dueDate: [
                    { pattern: /^(payment\s*)?due\s*date$/i, score: 1.0, zone: 'HEADER' },
                    { pattern: /^pay(ment)?\s*by$/i, score: 0.95, zone: 'HEADER' },
                    { pattern: /^due\s*by$/i, score: 0.93, zone: 'HEADER' },
                    { pattern: /^payment\s*due$/i, score: 0.92, zone: 'HEADER' },
                    { pattern: /^due$/i, score: 0.70, zone: 'HEADER' },
                    { pattern: /^net\s*\d+$/i, score: 0.60, zone: 'HEADER' } // Net 30, Net 60 etc
                ],

                poNumber: [
                    { pattern: /^(purchase\s*)?order\s*(number|no\.?|#)$/i, score: 1.0, zone: 'HEADER' },
                    { pattern: /^p\.?o\.?\s*(number|no\.?|#)?$/i, score: 0.98, zone: 'HEADER' },
                    { pattern: /^po#?$/i, score: 0.95, zone: 'HEADER' },
                    { pattern: /^customer\s*(order|po)\s*(no\.?|#)?$/i, score: 0.90, zone: 'HEADER' },
                    { pattern: /^your\s*order\s*(no\.?|#)?$/i, score: 0.85, zone: 'HEADER' },
                    { pattern: /^job\s*(number|no\.?|#)$/i, score: 0.75, zone: 'HEADER' }
                ],

                vendorName: [
                    // OCI Document Understanding labels (highest priority)
                    { pattern: /^vendor\s*name$/i, score: 1.0, zone: 'HEADER' },
                    { pattern: /^vendor\s*name\s*logo$/i, score: 0.98, zone: 'HEADER' },
                    { pattern: /^vendor\s*address\s*recipient$/i, score: 0.95, zone: 'HEADER' },
                    { pattern: /^supplier\s*name$/i, score: 0.97, zone: 'HEADER' },
                    // Traditional label patterns
                    { pattern: /^(from|bill\s*from|sold\s*by|vendor|supplier)$/i, score: 0.90, zone: 'HEADER' },
                    { pattern: /^company\s*name$/i, score: 0.85, zone: 'HEADER' },
                    { pattern: /^merchant$/i, score: 0.80, zone: 'HEADER' },
                    { pattern: /^payee$/i, score: 0.75, zone: 'HEADER' }
                    // Note: Vendor name often has no label - extracted from position/logo area
                ],

                vendorAddress: [
                    { pattern: /^(vendor|supplier|company|bill\s*from)\s*address$/i, score: 1.0, zone: 'HEADER' },
                    { pattern: /^address$/i, score: 0.60, zone: 'HEADER' }, // Could be ship-to
                    { pattern: /^from\s*address$/i, score: 0.90, zone: 'HEADER' }
                ],

                currency: [
                    { pattern: /^currency(\s*code)?$/i, score: 1.0, zone: 'HEADER' },
                    { pattern: /^curr\.?$/i, score: 0.85, zone: 'HEADER' }
                ],

                // Shipping/Freight - separate from line items
                shippingAmount: [
                    { pattern: /^(shipping|freight|delivery)\s*(charge|cost|amount|fee)?$/i, score: 1.0, zone: 'TOTALS' },
                    { pattern: /^s[&\/]h$/i, score: 0.90, zone: 'TOTALS' },
                    { pattern: /^postage$/i, score: 0.85, zone: 'TOTALS' }
                ],

                discountAmount: [
                    { pattern: /^discount\s*(amount)?$/i, score: 1.0, zone: 'TOTALS' },
                    { pattern: /^less\s*discount$/i, score: 0.95, zone: 'TOTALS' },
                    { pattern: /^early\s*pay(ment)?\s*discount$/i, score: 0.93, zone: 'TOTALS' }
                ]
            };

            // Negative patterns - labels that should NOT match certain fields
            this.NEGATIVE_PATTERNS = {
                totalAmount: [
                    /line\s*total/i,
                    /item\s*total/i,
                    /extended/i,
                    /ext\.?\s*price/i,
                    /unit\s*total/i
                ],
                subtotal: [
                    /line/i,
                    /item/i
                ],
                invoiceDate: [
                    /due/i,
                    /ship/i,
                    /delivery/i,
                    /order/i
                ]
            };

            // Zone boost factors - fields in expected zones get confidence boost
            this.ZONE_BOOST = {
                'HEADER': { invoiceNumber: 1.2, invoiceDate: 1.2, vendorName: 1.3, poNumber: 1.1 },
                'TOTALS': { totalAmount: 1.3, subtotal: 1.2, taxAmount: 1.2 },
                'LINE_ITEMS': {} // Line item amounts handled separately
            };
        }

        /**
         * Match a label to the best field with confidence score
         * @param {string} label - The OCR label text
         * @param {Object} context - Context including zone, nearby labels, document structure
         * @returns {Object|null} { field, score, originalLabel } or null if no match
         */
        match(label, context = {}) {
            if (!label) return null;

            const normalizedLabel = this.normalizeLabel(label);
            const candidates = [];

            // Test against all field patterns
            for (const [fieldName, patterns] of Object.entries(this.FIELD_PATTERNS)) {
                // Check negative patterns first
                if (this.matchesNegativePattern(normalizedLabel, fieldName)) {
                    continue;
                }

                for (const patternDef of patterns) {
                    if (patternDef.pattern.test(normalizedLabel)) {
                        let score = patternDef.score;

                        // Apply zone boost if field is in expected zone
                        if (context.zone && this.ZONE_BOOST[context.zone]?.[fieldName]) {
                            score = Math.min(score * this.ZONE_BOOST[context.zone][fieldName], 1.0);
                        }

                        // Apply zone penalty if field is in wrong zone
                        if (context.zone && patternDef.zone && context.zone !== patternDef.zone) {
                            score *= 0.7; // 30% penalty for wrong zone
                        }

                        // Context boost from nearby labels
                        score = this.applyContextBoost(score, fieldName, context);

                        candidates.push({
                            field: fieldName,
                            score: score,
                            originalLabel: label,
                            pattern: patternDef.pattern.source
                        });
                        break; // Use first (highest specificity) match for this field
                    }
                }
            }

            if (candidates.length === 0) return null;

            // Return highest scoring candidate
            candidates.sort((a, b) => b.score - a.score);

            log.debug('FieldMatcher.match', `"${label}" -> ${candidates[0].field} (score: ${candidates[0].score.toFixed(3)})`);

            return candidates[0];
        }

        /**
         * Match multiple candidates for a field and return best one
         * @param {string} fieldName - Target field name
         * @param {Array} candidates - Array of { label, value, confidence, zone, position }
         * @returns {Object|null} Best candidate or null
         */
        resolveMultipleCandidates(fieldName, candidates) {
            if (!candidates || candidates.length === 0) return null;
            if (candidates.length === 1) return candidates[0];

            const scored = candidates.map(candidate => {
                const match = this.match(candidate.label, {
                    zone: candidate.zone,
                    position: candidate.position
                });

                return {
                    ...candidate,
                    matchScore: match?.score || 0,
                    combinedScore: this.calculateCombinedScore(candidate, match)
                };
            });

            scored.sort((a, b) => b.combinedScore - a.combinedScore);

            log.debug('FieldMatcher.resolveMultiple',
                `${fieldName}: ${scored.length} candidates, best: "${scored[0].label}" (${scored[0].combinedScore.toFixed(3)})`);

            return scored[0];
        }

        /**
         * Calculate combined score from match score and OCR confidence
         */
        calculateCombinedScore(candidate, match) {
            const matchScore = match?.score || 0;
            const ocrConfidence = candidate.confidence || 0.5;

            // Weighted combination: 60% pattern match, 40% OCR confidence
            return (matchScore * 0.6) + (ocrConfidence * 0.4);
        }

        /**
         * Apply context boost based on nearby labels
         */
        applyContextBoost(score, fieldName, context) {
            if (!context.nearbyLabels) return score;

            const nearbyText = context.nearbyLabels.join(' ').toLowerCase();

            // Boost totalAmount if near payment-related labels
            if (fieldName === 'totalAmount') {
                if (/pay|remit|amount\s*enclosed/i.test(nearbyText)) {
                    score = Math.min(score * 1.15, 1.0);
                }
            }

            // Boost subtotal if "before tax" or "net" nearby
            if (fieldName === 'subtotal') {
                if (/before\s*tax|excluding\s*tax|net/i.test(nearbyText)) {
                    score = Math.min(score * 1.1, 1.0);
                }
            }

            // Boost taxAmount if percentage nearby
            if (fieldName === 'taxAmount') {
                if (/\d+\.?\d*\s*%/.test(nearbyText)) {
                    score = Math.min(score * 1.1, 1.0);
                }
            }

            return score;
        }

        /**
         * Check if label matches negative patterns for a field
         */
        matchesNegativePattern(label, fieldName) {
            const negatives = this.NEGATIVE_PATTERNS[fieldName];
            if (!negatives) return false;

            return negatives.some(pattern => pattern.test(label));
        }

        /**
         * Normalize label for matching
         */
        normalizeLabel(label) {
            return String(label)
                .toLowerCase()
                .trim()
                .replace(/[:\-_]/g, ' ')  // Replace common separators with space
                .replace(/\s+/g, ' ')      // Normalize whitespace
                .trim();
        }

        /**
         * Get all field names this matcher supports
         */
        getSupportedFields() {
            return Object.keys(this.FIELD_PATTERNS);
        }

        /**
         * Check if a value looks like it belongs to a specific field type
         * Used for additional validation when label is ambiguous
         */
        validateValueForField(fieldName, value) {
            if (!value) return false;

            const strValue = String(value).trim();

            switch (fieldName) {
                case 'invoiceNumber':
                    // Invoice numbers: alphanumeric, may have dashes
                    return /^[A-Z0-9\-\/]{2,30}$/i.test(strValue);

                case 'invoiceDate':
                case 'dueDate':
                    // Date patterns
                    return /\d{1,4}[\-\/\.]\d{1,2}[\-\/\.]\d{1,4}/.test(strValue) ||
                           /\w+\s+\d{1,2},?\s+\d{4}/.test(strValue);

                case 'totalAmount':
                case 'subtotal':
                case 'taxAmount':
                case 'shippingAmount':
                case 'discountAmount':
                    // Currency amounts
                    return /^[\$€£¥]?\s*[\d,]+\.?\d*$/.test(strValue.replace(/\s/g, ''));

                case 'poNumber':
                    // PO numbers: similar to invoice numbers
                    return /^[A-Z0-9\-\/]{2,25}$/i.test(strValue);

                case 'currency':
                    // Currency codes
                    return /^[A-Z]{3}$/.test(strValue) || /^[\$€£¥]$/.test(strValue);

                default:
                    return true;
            }
        }
    }

    return {
        FieldMatcher: FieldMatcher
    };
});
