/**
 * @NApiVersion 2.1
 * @NModuleScope SameAccount
 *
 * Flux Capture - Line Item Matcher
 * Fuzzy matching algorithm for comparing invoice line items to PO line items
 */

define(['N/log'], function(log) {

    'use strict';

    // ==================== Matching Thresholds ====================

    const THRESHOLDS = {
        DESCRIPTION_SIMILARITY: 0.6,  // Minimum similarity for description match
        ITEM_CODE_SIMILARITY: 0.8,    // Higher threshold for item codes
        QUANTITY_VARIANCE: 0.05,      // 5% quantity variance tolerance
        PRICE_VARIANCE: 0.02          // 2% price variance tolerance
    };

    // ==================== Line Item Matcher ====================

    var LineItemMatcher = {

        /**
         * Match invoice line items to PO line items
         * @param {Array} invoiceLines - Invoice line items
         * @param {Array} poLines - PO line items
         * @returns {Object} Match result with detailed line-by-line comparison
         */
        matchLineItems: function(invoiceLines, poLines) {
            if (!invoiceLines || invoiceLines.length === 0) {
                return this._createEmptyResult('No invoice lines');
            }

            if (!poLines || poLines.length === 0) {
                return this._createEmptyResult('No PO lines', invoiceLines.length);
            }

            var matches = [];
            var unmatchedInvoice = [];
            var unmatchedPO = poLines.map(function(line, idx) {
                return { line: line, index: idx, matched: false };
            });

            var totalQuantityVariance = 0;
            var totalPriceVariance = 0;
            var hasQuantityVariance = false;
            var hasPriceVariance = false;

            // Try to match each invoice line to a PO line
            invoiceLines.forEach(function(invLine, invIdx) {
                var bestMatch = this._findBestMatch(invLine, unmatchedPO);

                if (bestMatch) {
                    // Mark PO line as matched
                    unmatchedPO[bestMatch.poIndex].matched = true;

                    // Calculate variances
                    var qtyVar = this._calculateQuantityVariance(invLine, bestMatch.poLine);
                    var priceVar = this._calculatePriceVariance(invLine, bestMatch.poLine);

                    if (Math.abs(qtyVar.variancePercent) > THRESHOLDS.QUANTITY_VARIANCE * 100) {
                        hasQuantityVariance = true;
                    }
                    if (Math.abs(priceVar.variancePercent) > THRESHOLDS.PRICE_VARIANCE * 100) {
                        hasPriceVariance = true;
                    }

                    totalQuantityVariance += Math.abs(qtyVar.variance);
                    totalPriceVariance += Math.abs(priceVar.variance);

                    matches.push({
                        invoiceLine: invIdx + 1,
                        poLine: bestMatch.poLine.lineNumber,
                        matchScore: bestMatch.score,
                        matchMethod: bestMatch.method,
                        invoiceDescription: invLine.description,
                        poDescription: bestMatch.poLine.description || bestMatch.poLine.itemText,
                        quantityVariance: qtyVar,
                        priceVariance: priceVar,
                        amountVariance: this._calculateAmountVariance(invLine, bestMatch.poLine)
                    });
                } else {
                    unmatchedInvoice.push({
                        lineNumber: invIdx + 1,
                        description: invLine.description,
                        quantity: invLine.quantity,
                        amount: invLine.amount,
                        reason: 'No matching PO line found'
                    });
                }
            }, this);

            // Get unmatched PO lines
            var unmatchedPOLines = unmatchedPO
                .filter(function(item) { return !item.matched; })
                .map(function(item) {
                    return {
                        lineNumber: item.line.lineNumber,
                        description: item.line.description || item.line.itemText,
                        quantity: item.line.quantity,
                        quantityBilled: item.line.quantityBilled || 0,
                        remaining: item.line.quantity - (item.line.quantityBilled || 0)
                    };
                });

            // Calculate overall match score
            var matchedCount = matches.length;
            var totalInvoiceLines = invoiceLines.length;
            var overallMatchScore = totalInvoiceLines > 0 ?
                Math.round((matchedCount / totalInvoiceLines) * 100) : 0;

            return {
                success: true,
                matches: matches,
                unmatchedInvoiceLines: unmatchedInvoice.length,
                unmatchedInvoiceDetails: unmatchedInvoice,
                unmatchedPOLines: unmatchedPOLines.length,
                unmatchedPODetails: unmatchedPOLines,
                totalQuantityVariance: totalQuantityVariance,
                totalPriceVariance: totalPriceVariance,
                hasQuantityVariance: hasQuantityVariance,
                hasPriceVariance: hasPriceVariance,
                matchedCount: matchedCount,
                totalInvoiceLines: totalInvoiceLines,
                totalPOLines: poLines.length,
                overallMatchScore: overallMatchScore
            };
        },

        /**
         * Find the best matching PO line for an invoice line
         */
        _findBestMatch: function(invLine, availablePOLines) {
            var bestMatch = null;
            var bestScore = 0;

            availablePOLines.forEach(function(poItem, idx) {
                if (poItem.matched) return;

                var score = this._calculateMatchScore(invLine, poItem.line);

                if (score.total > bestScore && score.total >= 30) { // Minimum threshold
                    bestScore = score.total;
                    bestMatch = {
                        poLine: poItem.line,
                        poIndex: idx,
                        score: score.total,
                        method: score.primaryMethod,
                        details: score
                    };
                }
            }, this);

            return bestMatch;
        },

        /**
         * Calculate match score between invoice and PO line
         */
        _calculateMatchScore: function(invLine, poLine) {
            var score = 0;
            var details = {};
            var primaryMethod = 'none';

            // Method 1: Item code match (if both have item IDs)
            if (invLine.item && poLine.item) {
                if (invLine.item == poLine.item) {
                    score += 50;
                    details.itemMatch = true;
                    primaryMethod = 'item_code';
                }
            }

            // Method 2: Description similarity
            var descSimilarity = this._calculateSimilarity(
                invLine.description || '',
                poLine.description || poLine.itemText || ''
            );

            if (descSimilarity >= THRESHOLDS.DESCRIPTION_SIMILARITY) {
                var descScore = Math.round(descSimilarity * 30);
                score += descScore;
                details.descriptionSimilarity = descSimilarity;
                details.descriptionScore = descScore;
                if (primaryMethod === 'none') {
                    primaryMethod = 'description';
                }
            }

            // Method 3: Quantity match
            var invQty = parseFloat(invLine.quantity) || 0;
            var poQty = parseFloat(poLine.quantity) || 0;

            if (invQty > 0 && poQty > 0) {
                var qtyRatio = Math.min(invQty, poQty) / Math.max(invQty, poQty);
                if (qtyRatio >= 0.9) {
                    score += 10;
                    details.quantityMatch = true;
                } else if (qtyRatio >= 0.5) {
                    score += 5;
                    details.quantityClose = true;
                }
            }

            // Method 4: Amount match
            var invAmount = parseFloat(invLine.amount) || 0;
            var poAmount = parseFloat(poLine.amount) || 0;

            if (invAmount > 0 && poAmount > 0) {
                var amountRatio = Math.min(invAmount, poAmount) / Math.max(invAmount, poAmount);
                if (amountRatio >= 0.98) {
                    score += 10;
                    details.amountMatch = true;
                } else if (amountRatio >= 0.9) {
                    score += 5;
                    details.amountClose = true;
                }
            }

            return {
                total: score,
                primaryMethod: primaryMethod,
                details: details
            };
        },

        /**
         * Calculate string similarity using Levenshtein-based algorithm
         */
        _calculateSimilarity: function(str1, str2) {
            if (!str1 || !str2) return 0;

            // Normalize strings
            str1 = String(str1).toLowerCase().trim();
            str2 = String(str2).toLowerCase().trim();

            if (str1 === str2) return 1;
            if (str1.length === 0 || str2.length === 0) return 0;

            // Check for containment
            if (str1.indexOf(str2) !== -1 || str2.indexOf(str1) !== -1) {
                return 0.8;
            }

            // Token-based similarity (for descriptions with multiple words)
            var tokens1 = this._tokenize(str1);
            var tokens2 = this._tokenize(str2);

            if (tokens1.length > 1 || tokens2.length > 1) {
                return this._jaccardSimilarity(tokens1, tokens2);
            }

            // Levenshtein for single tokens
            return this._levenshteinSimilarity(str1, str2);
        },

        /**
         * Tokenize a string into words
         */
        _tokenize: function(str) {
            return str.split(/[\s,.\-_]+/)
                .filter(function(t) { return t.length > 2; })
                .map(function(t) { return t.toLowerCase(); });
        },

        /**
         * Jaccard similarity for token sets
         */
        _jaccardSimilarity: function(tokens1, tokens2) {
            var set1 = {};
            var set2 = {};

            tokens1.forEach(function(t) { set1[t] = true; });
            tokens2.forEach(function(t) { set2[t] = true; });

            var intersection = 0;
            var union = Object.keys(set1).length;

            Object.keys(set2).forEach(function(t) {
                if (set1[t]) {
                    intersection++;
                } else {
                    union++;
                }
            });

            return union > 0 ? intersection / union : 0;
        },

        /**
         * Levenshtein similarity (1 - normalized distance)
         */
        _levenshteinSimilarity: function(str1, str2) {
            var len1 = str1.length;
            var len2 = str2.length;

            if (len1 === 0) return len2 === 0 ? 1 : 0;
            if (len2 === 0) return 0;

            // Optimization: if lengths differ too much, low similarity
            if (Math.abs(len1 - len2) > Math.max(len1, len2) * 0.5) {
                return 0;
            }

            var matrix = [];
            for (var i = 0; i <= len1; i++) {
                matrix[i] = [i];
            }
            for (var j = 0; j <= len2; j++) {
                matrix[0][j] = j;
            }

            for (i = 1; i <= len1; i++) {
                for (j = 1; j <= len2; j++) {
                    var cost = str1[i - 1] === str2[j - 1] ? 0 : 1;
                    matrix[i][j] = Math.min(
                        matrix[i - 1][j] + 1,
                        matrix[i][j - 1] + 1,
                        matrix[i - 1][j - 1] + cost
                    );
                }
            }

            var distance = matrix[len1][len2];
            var maxLen = Math.max(len1, len2);

            return 1 - (distance / maxLen);
        },

        /**
         * Calculate quantity variance
         */
        _calculateQuantityVariance: function(invLine, poLine) {
            var invQty = parseFloat(invLine.quantity) || 0;
            var poQty = parseFloat(poLine.quantity) || 0;
            var variance = invQty - poQty;
            var variancePercent = poQty > 0 ? (variance / poQty * 100) : 0;

            return {
                invoiceQty: invQty,
                poQty: poQty,
                variance: variance,
                variancePercent: parseFloat(variancePercent.toFixed(2)),
                isOver: variance > 0,
                isUnder: variance < 0,
                withinTolerance: Math.abs(variancePercent) <= THRESHOLDS.QUANTITY_VARIANCE * 100
            };
        },

        /**
         * Calculate price variance (unit price)
         */
        _calculatePriceVariance: function(invLine, poLine) {
            var invRate = parseFloat(invLine.rate || invLine.unitPrice) || 0;
            var poRate = parseFloat(poLine.rate) || 0;

            // If no rate on invoice, try to calculate from amount/qty
            if (invRate === 0 && invLine.amount && invLine.quantity) {
                invRate = parseFloat(invLine.amount) / parseFloat(invLine.quantity);
            }

            var variance = invRate - poRate;
            var variancePercent = poRate > 0 ? (variance / poRate * 100) : 0;

            return {
                invoiceRate: invRate,
                poRate: poRate,
                variance: variance,
                variancePercent: parseFloat(variancePercent.toFixed(2)),
                isOver: variance > 0,
                isUnder: variance < 0,
                withinTolerance: Math.abs(variancePercent) <= THRESHOLDS.PRICE_VARIANCE * 100
            };
        },

        /**
         * Calculate amount variance (extended amount)
         */
        _calculateAmountVariance: function(invLine, poLine) {
            var invAmount = parseFloat(invLine.amount) || 0;
            var poAmount = parseFloat(poLine.amount) || 0;
            var variance = invAmount - poAmount;
            var variancePercent = poAmount > 0 ? (variance / poAmount * 100) : 0;

            return {
                invoiceAmount: invAmount,
                poAmount: poAmount,
                variance: variance,
                variancePercent: parseFloat(variancePercent.toFixed(2)),
                isOver: variance > 0,
                isUnder: variance < 0
            };
        },

        /**
         * Create empty result
         */
        _createEmptyResult: function(reason, unmatchedInvoiceCount) {
            return {
                success: true,
                matches: [],
                unmatchedInvoiceLines: unmatchedInvoiceCount || 0,
                unmatchedInvoiceDetails: [],
                unmatchedPOLines: 0,
                unmatchedPODetails: [],
                totalQuantityVariance: 0,
                totalPriceVariance: 0,
                hasQuantityVariance: false,
                hasPriceVariance: false,
                matchedCount: 0,
                totalInvoiceLines: unmatchedInvoiceCount || 0,
                totalPOLines: 0,
                overallMatchScore: 0,
                note: reason
            };
        },

        // Export thresholds for configuration
        THRESHOLDS: THRESHOLDS
    };

    return LineItemMatcher;
});
