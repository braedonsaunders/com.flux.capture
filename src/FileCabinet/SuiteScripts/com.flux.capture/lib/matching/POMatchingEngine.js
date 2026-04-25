/**
 * @NApiVersion 2.1
 * @NModuleScope SameAccount
 *
 * Flux Capture - PO Matching Engine
 * Intelligent purchase order matching with multi-signal scoring
 * and fuzzy line item comparison
 */

define([
    'N/search',
    'N/query',
    'N/record',
    'N/log',
    '/SuiteScripts/com.flux.capture/lib/matching/LineItemMatcher'
], function(search, query, record, log, LineItemMatcher) {

    'use strict';

    // ==================== Constants ====================

    const MATCH_STATUS = Object.freeze({
        PENDING: 1,
        MATCHED: 2,
        PARTIAL: 3,
        EXCEPTION: 4,
        NO_PO: 5,
        MANUAL: 6
    });

    const MATCH_STATUS_LABELS = Object.freeze({
        1: 'Pending Match',
        2: 'Matched',
        3: 'Partial Match',
        4: 'Exception',
        5: 'No PO Required',
        6: 'Manual Match'
    });

    // Signal weights for multi-signal matching algorithm
    const MATCH_WEIGHTS = {
        PO_NUMBER_EXACT: 45,      // Extracted PO number matches exactly
        PO_NUMBER_PARTIAL: 25,    // Extracted PO number partial match
        VENDOR_MATCH: 20,         // Same vendor
        AMOUNT_EXACT: 10,         // Amount matches within 1%
        AMOUNT_CLOSE: 5,          // Amount within 5%
        LINE_ITEMS: 20,           // Line item fuzzy matching bonus
        DATE_RANGE: 5,            // PO date is before invoice date
        CURRENCY_MATCH: 5         // Same currency
    };

    // Tolerance thresholds (configurable per vendor in future)
    const DEFAULT_TOLERANCES = {
        priceVariance: { percent: 2, absolute: 50 },
        quantityVariance: { percent: 5, absolute: 2 },
        totalVariance: { percent: 3, absolute: 100 },
        autoApproveThreshold: 95,  // Auto-match if score >= 95%
        suggestThreshold: 50       // Suggest match if score >= 50%
    };

    // ==================== PO Matching Engine ====================

    var POMatchingEngine = {

        /**
         * Find matching purchase orders for an invoice document
         * @param {Object} invoiceData - Invoice data from Flux Document
         * @param {Object} options - Matching options
         * @returns {Object} Match result with candidates and recommendation
         */
        findMatches: function(invoiceData, options) {
            options = options || {};
            var tolerances = Object.assign({}, DEFAULT_TOLERANCES, options.tolerances || {});

            log.debug('POMatchingEngine.findMatches', 'Starting match for invoice: ' + JSON.stringify({
                poNumber: invoiceData.poNumber,
                vendorId: invoiceData.vendorId,
                total: invoiceData.totalAmount
            }));

            // If no vendor, we can't match
            if (!invoiceData.vendorId) {
                return this._createNoMatchResult('No vendor identified on invoice');
            }

            // Step 1: Find candidate POs
            var candidates = this._findCandidatePOs(invoiceData, options);

            if (candidates.length === 0) {
                // Check if PO number was extracted but no matching PO found
                if (invoiceData.poNumber) {
                    return this._createNoMatchResult('PO ' + invoiceData.poNumber + ' not found in system', 'po_not_found');
                }
                return this._createNoMatchResult('No open POs found for vendor');
            }

            // Step 2: Score each candidate
            var scoredCandidates = candidates.map(function(po) {
                return this._scorePOMatch(invoiceData, po, tolerances);
            }, this);

            // Step 3: Sort by score descending
            scoredCandidates.sort(function(a, b) {
                return b.score - a.score;
            });

            // Step 4: Determine recommendation
            var topMatch = scoredCandidates[0];
            var recommendation = this._determineRecommendation(topMatch, scoredCandidates, tolerances);

            return {
                success: true,
                hasMatches: true,
                matchStatus: recommendation.status,
                matchStatusText: MATCH_STATUS_LABELS[recommendation.status],
                recommendation: recommendation,
                topMatch: topMatch,
                candidates: scoredCandidates.slice(0, 5), // Top 5 candidates
                totalCandidates: scoredCandidates.length,
                tolerances: tolerances
            };
        },

        /**
         * Perform 2-way match: PO to Invoice
         * @param {Object} invoiceData - Invoice data
         * @param {number} poId - Purchase Order internal ID
         * @returns {Object} Detailed match result with variances
         */
        performTwoWayMatch: function(invoiceData, poId) {
            try {
                // Load full PO details
                var poData = this._loadPODetails(poId);
                if (!poData) {
                    return { success: false, error: 'PO not found' };
                }

                // Perform line-level matching
                var lineMatch = LineItemMatcher.matchLineItems(
                    invoiceData.lineItems || [],
                    poData.lineItems || []
                );

                // Calculate header-level variances
                var headerVariances = this._calculateHeaderVariances(invoiceData, poData);

                // Calculate overall match quality
                var matchQuality = this._calculateMatchQuality(headerVariances, lineMatch);

                return {
                    success: true,
                    poData: poData,
                    headerVariances: headerVariances,
                    lineMatch: lineMatch,
                    matchQuality: matchQuality,
                    isWithinTolerance: matchQuality.withinTolerance,
                    recommendation: matchQuality.recommendation,
                    variances: {
                        total: headerVariances.totalVariance,
                        quantity: lineMatch.totalQuantityVariance,
                        price: lineMatch.totalPriceVariance,
                        unmatchedInvoiceLines: lineMatch.unmatchedInvoiceLines,
                        unmatchedPOLines: lineMatch.unmatchedPOLines
                    }
                };
            } catch (e) {
                log.error('performTwoWayMatch Error', e);
                return { success: false, error: e.message };
            }
        },

        /**
         * Auto-match invoice to PO if confidence is high enough
         * @param {Object} invoiceData - Invoice data
         * @param {Object} options - Auto-match options
         * @returns {Object} Auto-match result
         */
        autoMatch: function(invoiceData, options) {
            var matchResult = this.findMatches(invoiceData, options);

            if (!matchResult.success || !matchResult.hasMatches) {
                return {
                    autoMatched: false,
                    reason: matchResult.message || 'No matches found'
                };
            }

            var tolerances = matchResult.tolerances;
            var topMatch = matchResult.topMatch;

            // Only auto-match if score exceeds threshold
            if (topMatch.score >= tolerances.autoApproveThreshold) {
                // Verify with 2-way match
                var twoWayResult = this.performTwoWayMatch(invoiceData, topMatch.id);

                if (twoWayResult.success && twoWayResult.isWithinTolerance) {
                    return {
                        autoMatched: true,
                        matchedPO: topMatch,
                        twoWayResult: twoWayResult,
                        confidence: topMatch.score
                    };
                }
            }

            return {
                autoMatched: false,
                reason: 'Score below auto-match threshold',
                topMatch: topMatch,
                suggestion: topMatch.score >= tolerances.suggestThreshold
            };
        },

        // ==================== Private Methods ====================

        /**
         * Find candidate POs for matching
         */
        _findCandidatePOs: function(invoiceData, options) {
            var candidates = [];
            var maxResults = options.maxCandidates || 20;

            // Build query to find open POs for the vendor
            // Note: Use foreigntotal instead of total (total is not exposed for SuiteQL search)
            var sql = `
                SELECT
                    t.id,
                    t.tranid as poNumber,
                    t.trandate as poDate,
                    t.foreigntotal,
                    t.entity as vendorId,
                    BUILTIN.DF(t.entity) as vendorName,
                    t.status,
                    BUILTIN.DF(t.status) as statusText,
                    t.currency,
                    BUILTIN.DF(t.currency) as currencyName,
                    t.memo
                FROM transaction t
                WHERE t.type = 'PurchOrd'
                AND t.entity = ?
                AND t.status NOT IN ('Closed', 'Cancelled', 'Fully Billed')
                ORDER BY
                    CASE WHEN LOWER(t.tranid) LIKE LOWER(?) THEN 0 ELSE 1 END,
                    t.trandate DESC
            `;

            // Prioritize POs matching the extracted PO number
            var poPattern = invoiceData.poNumber ? '%' + invoiceData.poNumber + '%' : '%';

            try {
                var results = query.runSuiteQL({
                    query: sql,
                    params: [invoiceData.vendorId, poPattern]
                });

                results.results.forEach(function(row) {
                    candidates.push({
                        id: row.values[0],
                        poNumber: row.values[1],
                        poDate: row.values[2],
                        total: parseFloat(row.values[3]) || 0,
                        vendorId: row.values[4],
                        vendorName: row.values[5],
                        status: row.values[6],
                        statusText: row.values[7],
                        currency: row.values[8],
                        currencyName: row.values[9],
                        memo: row.values[10]
                    });
                });
            } catch (e) {
                log.error('_findCandidatePOs Error', e);
            }

            return candidates.slice(0, maxResults);
        },

        /**
         * Score a PO match using multi-signal algorithm
         */
        _scorePOMatch: function(invoiceData, poData, tolerances) {
            var score = 0;
            var signals = [];

            // Signal 1: PO Number Match (highest weight)
            if (invoiceData.poNumber) {
                var extractedPO = String(invoiceData.poNumber).toLowerCase().trim();
                var actualPO = String(poData.poNumber).toLowerCase().trim();

                if (extractedPO === actualPO) {
                    score += MATCH_WEIGHTS.PO_NUMBER_EXACT;
                    signals.push({ signal: 'po_number_exact', weight: MATCH_WEIGHTS.PO_NUMBER_EXACT });
                } else if (actualPO.indexOf(extractedPO) !== -1 || extractedPO.indexOf(actualPO) !== -1) {
                    score += MATCH_WEIGHTS.PO_NUMBER_PARTIAL;
                    signals.push({ signal: 'po_number_partial', weight: MATCH_WEIGHTS.PO_NUMBER_PARTIAL });
                }
            }

            // Signal 2: Vendor Match (should always match due to query filter, but validate)
            if (invoiceData.vendorId && invoiceData.vendorId == poData.vendorId) {
                score += MATCH_WEIGHTS.VENDOR_MATCH;
                signals.push({ signal: 'vendor_match', weight: MATCH_WEIGHTS.VENDOR_MATCH });
            }

            // Signal 3: Amount Match
            if (invoiceData.totalAmount && poData.total) {
                var invoiceTotal = parseFloat(invoiceData.totalAmount);
                var poTotal = parseFloat(poData.total);
                var amountVariance = Math.abs(invoiceTotal - poTotal) / poTotal;

                if (amountVariance <= 0.01) {
                    score += MATCH_WEIGHTS.AMOUNT_EXACT;
                    signals.push({ signal: 'amount_exact', weight: MATCH_WEIGHTS.AMOUNT_EXACT, variance: amountVariance });
                } else if (amountVariance <= 0.05) {
                    score += MATCH_WEIGHTS.AMOUNT_CLOSE;
                    signals.push({ signal: 'amount_close', weight: MATCH_WEIGHTS.AMOUNT_CLOSE, variance: amountVariance });
                }
            }

            // Signal 4: Currency Match
            if (invoiceData.currency && poData.currency) {
                if (invoiceData.currency == poData.currency) {
                    score += MATCH_WEIGHTS.CURRENCY_MATCH;
                    signals.push({ signal: 'currency_match', weight: MATCH_WEIGHTS.CURRENCY_MATCH });
                }
            }

            // Signal 5: Date Range (PO date should be before invoice date)
            if (invoiceData.invoiceDate && poData.poDate) {
                var invDate = new Date(invoiceData.invoiceDate);
                var poDate = new Date(poData.poDate);
                if (poDate <= invDate) {
                    score += MATCH_WEIGHTS.DATE_RANGE;
                    signals.push({ signal: 'date_valid', weight: MATCH_WEIGHTS.DATE_RANGE });
                }
            }

            // Normalize score to 0-100
            var maxPossibleScore = MATCH_WEIGHTS.PO_NUMBER_EXACT + MATCH_WEIGHTS.VENDOR_MATCH +
                MATCH_WEIGHTS.AMOUNT_EXACT + MATCH_WEIGHTS.CURRENCY_MATCH + MATCH_WEIGHTS.DATE_RANGE;
            var normalizedScore = Math.round((score / maxPossibleScore) * 100);

            return {
                id: poData.id,
                poNumber: poData.poNumber,
                poDate: poData.poDate,
                total: poData.total,
                vendorName: poData.vendorName,
                status: poData.status,
                statusText: poData.statusText,
                currency: poData.currency,
                currencyName: poData.currencyName,
                score: normalizedScore,
                rawScore: score,
                signals: signals,
                amountVariance: invoiceData.totalAmount && poData.total ?
                    (parseFloat(invoiceData.totalAmount) - poData.total) : null,
                amountVariancePercent: invoiceData.totalAmount && poData.total ?
                    ((parseFloat(invoiceData.totalAmount) - poData.total) / poData.total * 100).toFixed(2) : null
            };
        },

        /**
         * Load full PO details including line items
         */
        _loadPODetails: function(poId) {
            try {
                var poRec = record.load({
                    type: record.Type.PURCHASE_ORDER,
                    id: poId
                });

                var lineItems = [];
                var lineCount = poRec.getLineCount({ sublistId: 'item' });

                for (var i = 0; i < lineCount; i++) {
                    lineItems.push({
                        lineNumber: i + 1,
                        item: poRec.getSublistValue({ sublistId: 'item', fieldId: 'item', line: i }),
                        itemText: poRec.getSublistText({ sublistId: 'item', fieldId: 'item', line: i }),
                        description: poRec.getSublistValue({ sublistId: 'item', fieldId: 'description', line: i }),
                        quantity: parseFloat(poRec.getSublistValue({ sublistId: 'item', fieldId: 'quantity', line: i })) || 0,
                        rate: parseFloat(poRec.getSublistValue({ sublistId: 'item', fieldId: 'rate', line: i })) || 0,
                        amount: parseFloat(poRec.getSublistValue({ sublistId: 'item', fieldId: 'amount', line: i })) || 0,
                        quantityReceived: parseFloat(poRec.getSublistValue({ sublistId: 'item', fieldId: 'quantityreceived', line: i })) || 0,
                        quantityBilled: parseFloat(poRec.getSublistValue({ sublistId: 'item', fieldId: 'quantitybilled', line: i })) || 0
                    });
                }

                return {
                    id: poId,
                    poNumber: poRec.getValue('tranid'),
                    poDate: poRec.getValue('trandate'),
                    vendor: poRec.getValue('entity'),
                    vendorName: poRec.getText('entity'),
                    total: parseFloat(poRec.getValue('total')) || 0,
                    subtotal: parseFloat(poRec.getValue('subtotal')) || 0,
                    taxTotal: parseFloat(poRec.getValue('taxtotal')) || 0,
                    currency: poRec.getValue('currency'),
                    currencyText: poRec.getText('currency'),
                    status: poRec.getValue('status'),
                    memo: poRec.getValue('memo'),
                    lineItems: lineItems
                };
            } catch (e) {
                log.error('_loadPODetails Error', e);
                return null;
            }
        },

        /**
         * Calculate header-level variances between invoice and PO
         */
        _calculateHeaderVariances: function(invoiceData, poData) {
            var invoiceTotal = parseFloat(invoiceData.totalAmount) || 0;
            var poTotal = poData.total || 0;

            var totalVariance = invoiceTotal - poTotal;
            var totalVariancePercent = poTotal > 0 ? (totalVariance / poTotal * 100) : 0;

            return {
                invoiceTotal: invoiceTotal,
                poTotal: poTotal,
                totalVariance: totalVariance,
                totalVariancePercent: parseFloat(totalVariancePercent.toFixed(2)),
                totalVarianceAbs: Math.abs(totalVariance),
                isOverInvoice: totalVariance > 0,
                isUnderInvoice: totalVariance < 0
            };
        },

        /**
         * Calculate overall match quality
         */
        _calculateMatchQuality: function(headerVariances, lineMatch, tolerances) {
            tolerances = tolerances || DEFAULT_TOLERANCES;

            var issues = [];
            var withinTolerance = true;

            // Check total variance
            var totalVarPct = Math.abs(headerVariances.totalVariancePercent);
            var totalVarAbs = headerVariances.totalVarianceAbs;

            if (totalVarPct > tolerances.totalVariance.percent && totalVarAbs > tolerances.totalVariance.absolute) {
                withinTolerance = false;
                issues.push({
                    type: 'total_variance',
                    severity: totalVarPct > 10 ? 'high' : 'medium',
                    message: 'Total variance: ' + headerVariances.totalVariancePercent.toFixed(1) + '% ($' + totalVarAbs.toFixed(2) + ')'
                });
            }

            // Check unmatched lines
            if (lineMatch.unmatchedInvoiceLines > 0) {
                issues.push({
                    type: 'unmatched_invoice_lines',
                    severity: 'medium',
                    message: lineMatch.unmatchedInvoiceLines + ' invoice line(s) not on PO'
                });
            }

            if (lineMatch.unmatchedPOLines > 0) {
                issues.push({
                    type: 'unmatched_po_lines',
                    severity: 'low',
                    message: lineMatch.unmatchedPOLines + ' PO line(s) not invoiced'
                });
            }

            // Check line-level variances
            if (lineMatch.hasQuantityVariance) {
                issues.push({
                    type: 'quantity_variance',
                    severity: 'medium',
                    message: 'Quantity variances detected'
                });
            }

            if (lineMatch.hasPriceVariance) {
                issues.push({
                    type: 'price_variance',
                    severity: 'medium',
                    message: 'Price variances detected'
                });
            }

            // Determine recommendation
            var recommendation;
            if (issues.length === 0) {
                recommendation = 'approve';
            } else if (issues.some(function(i) { return i.severity === 'high'; })) {
                recommendation = 'review';
            } else {
                recommendation = withinTolerance ? 'approve_with_variance' : 'review';
            }

            return {
                withinTolerance: withinTolerance,
                issues: issues,
                issueCount: issues.length,
                hasHighSeverity: issues.some(function(i) { return i.severity === 'high'; }),
                recommendation: recommendation,
                matchScore: lineMatch.overallMatchScore || 0
            };
        },

        /**
         * Determine overall recommendation based on match results
         */
        _determineRecommendation: function(topMatch, allCandidates, tolerances) {
            if (!topMatch) {
                return {
                    status: MATCH_STATUS.EXCEPTION,
                    action: 'manual_review',
                    reason: 'No matching POs found'
                };
            }

            // High confidence auto-match
            if (topMatch.score >= tolerances.autoApproveThreshold) {
                return {
                    status: MATCH_STATUS.MATCHED,
                    action: 'auto_match',
                    reason: 'High confidence match (' + topMatch.score + '%)',
                    poId: topMatch.id,
                    poNumber: topMatch.poNumber
                };
            }

            // Medium confidence - suggest match
            if (topMatch.score >= tolerances.suggestThreshold) {
                // Check if there are multiple close candidates
                var closeMatches = allCandidates.filter(function(c) {
                    return c.score >= tolerances.suggestThreshold;
                });

                if (closeMatches.length > 1 && closeMatches[1].score >= topMatch.score - 10) {
                    return {
                        status: MATCH_STATUS.PARTIAL,
                        action: 'select_match',
                        reason: 'Multiple possible matches',
                        candidates: closeMatches.length
                    };
                }

                return {
                    status: MATCH_STATUS.PARTIAL,
                    action: 'confirm_match',
                    reason: 'Likely match - confirm (' + topMatch.score + '%)',
                    poId: topMatch.id,
                    poNumber: topMatch.poNumber
                };
            }

            // Low confidence - exception
            return {
                status: MATCH_STATUS.EXCEPTION,
                action: 'manual_review',
                reason: 'No strong matches found',
                bestScore: topMatch.score
            };
        },

        /**
         * Create a no-match result
         */
        _createNoMatchResult: function(message, code) {
            return {
                success: true,
                hasMatches: false,
                matchStatus: MATCH_STATUS.NO_PO,
                matchStatusText: MATCH_STATUS_LABELS[MATCH_STATUS.NO_PO],
                message: message,
                code: code || 'no_po',
                candidates: [],
                totalCandidates: 0
            };
        },

        // ==================== Public Constants ====================
        MATCH_STATUS: MATCH_STATUS,
        MATCH_STATUS_LABELS: MATCH_STATUS_LABELS,
        DEFAULT_TOLERANCES: DEFAULT_TOLERANCES
    };

    return POMatchingEngine;
});
