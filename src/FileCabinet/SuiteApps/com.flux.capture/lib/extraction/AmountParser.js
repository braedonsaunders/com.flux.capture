/**
 * @NApiVersion 2.1
 * @NModuleScope Public
 * @module FluxCapture/Extraction/AmountParser
 *
 * Currency-Aware Amount Parser
 * Handles regional number formats, currency detection, and negative amounts
 */

define(['N/log', '../FC_Debug'], function(log, fcDebug) {
    'use strict';

    /**
     * Smart Amount Parser
     * Parses monetary amounts with locale awareness and currency extraction
     */
    class AmountParser {
        constructor() {
            this.initializeMappings();
        }

        initializeMappings() {
            // Currency symbol to code mapping
            this.CURRENCY_SYMBOLS = {
                '$': ['USD', 'CAD', 'AUD', 'NZD', 'HKD', 'SGD', 'MXN'],
                '€': ['EUR'],
                '£': ['GBP'],
                '¥': ['JPY', 'CNY'],
                '₹': ['INR'],
                'R$': ['BRL'],
                'kr': ['SEK', 'NOK', 'DKK'],
                'CHF': ['CHF'],
                'Fr': ['CHF'],
                'zł': ['PLN'],
                '₽': ['RUB'],
                '₩': ['KRW'],
                'R': ['ZAR']
            };

            // Locale to number format mapping
            // 'PERIOD' = period decimal, comma thousands (1,234.56)
            // 'COMMA' = comma decimal, period/space thousands (1.234,56 or 1 234,56)
            this.LOCALE_FORMATS = {
                // Period decimal countries
                'US': 'PERIOD', 'USA': 'PERIOD',
                'GB': 'PERIOD', 'UK': 'PERIOD',
                'AU': 'PERIOD',
                'NZ': 'PERIOD',
                'CA': 'PERIOD',
                'JP': 'PERIOD',
                'CN': 'PERIOD',
                'IN': 'PERIOD',
                'MX': 'PERIOD',
                'KR': 'PERIOD',
                'TW': 'PERIOD',

                // Comma decimal countries
                'DE': 'COMMA', 'Germany': 'COMMA',
                'FR': 'COMMA', 'France': 'COMMA',
                'IT': 'COMMA', 'Italy': 'COMMA',
                'ES': 'COMMA', 'Spain': 'COMMA',
                'NL': 'COMMA', 'Netherlands': 'COMMA',
                'BE': 'COMMA', 'Belgium': 'COMMA',
                'AT': 'COMMA', 'Austria': 'COMMA',
                'CH': 'COMMA', 'Switzerland': 'COMMA',
                'BR': 'COMMA', 'Brazil': 'COMMA',
                'AR': 'COMMA', 'Argentina': 'COMMA',
                'PT': 'COMMA', 'Portugal': 'COMMA',
                'PL': 'COMMA', 'Poland': 'COMMA',
                'SE': 'COMMA', 'Sweden': 'COMMA',
                'NO': 'COMMA', 'Norway': 'COMMA',
                'DK': 'COMMA', 'Denmark': 'COMMA',
                'FI': 'COMMA', 'Finland': 'COMMA',
                'RU': 'COMMA', 'Russia': 'COMMA',

                'DEFAULT': 'PERIOD'
            };

            // Currency code to default format
            this.CURRENCY_FORMATS = {
                'USD': 'PERIOD',
                'GBP': 'PERIOD',
                'AUD': 'PERIOD',
                'CAD': 'PERIOD',
                'JPY': 'PERIOD',
                'CNY': 'PERIOD',
                'INR': 'PERIOD',
                'EUR': 'COMMA',
                'CHF': 'COMMA',
                'BRL': 'COMMA',
                'SEK': 'COMMA',
                'NOK': 'COMMA',
                'DKK': 'COMMA',
                'PLN': 'COMMA',
                'RUB': 'COMMA'
            };
        }

        /**
         * Parse an amount string with context awareness
         * @param {string} value - The amount string to parse
         * @param {Object} context - Context for parsing
         * @param {string} context.currency - Known currency code
         * @param {string} context.vendorCountry - Vendor country for format hint
         * @param {string} context.vendorLocale - Vendor locale for format hint
         * @returns {Object} { amount: number, currency: string|null, confidence: number, negative: boolean }
         */
        parse(value, context = {}) {
            if (!value && value !== 0) {
                return { amount: 0, currency: null, confidence: 0, negative: false };
            }

            const strValue = String(value).trim();
            fcDebug.debug('AmountParser.parse', `Input: "${strValue}"`);

            // Extract currency symbol/code
            const currencyInfo = this.extractCurrency(strValue);

            // Detect if negative
            const negativeInfo = this.detectNegative(strValue);

            // Clean the amount string
            let cleanValue = this.cleanAmountString(strValue);

            // Determine number format to use
            const numberFormat = this.determineFormat(cleanValue, currencyInfo.currency, context);

            // Parse based on detected format
            const amount = this.parseNumber(cleanValue, numberFormat);

            // Apply negative if detected
            const finalAmount = negativeInfo.negative ? -Math.abs(amount) : Math.abs(amount);

            // Calculate confidence
            const confidence = this.calculateConfidence(strValue, amount, currencyInfo, numberFormat);

            const result = {
                amount: finalAmount,
                currency: currencyInfo.currency || context.currency || null,
                confidence: confidence,
                negative: negativeInfo.negative,
                format: numberFormat
            };

            fcDebug.debug('AmountParser.parse', `Result: ${result.amount} ${result.currency || ''} (conf: ${result.confidence.toFixed(2)})`);

            return result;
        }

        /**
         * Extract currency from amount string
         */
        extractCurrency(value) {
            // Check for currency code prefix/suffix (USD, EUR, etc.)
            const codeMatch = value.match(/\b([A-Z]{3})\b/);
            if (codeMatch) {
                return {
                    currency: codeMatch[1],
                    confidence: 0.95
                };
            }

            // Check for currency symbols
            for (const [symbol, codes] of Object.entries(this.CURRENCY_SYMBOLS)) {
                if (value.includes(symbol)) {
                    return {
                        currency: codes[0], // Default to first currency for symbol
                        confidence: codes.length === 1 ? 0.95 : 0.70, // Lower if ambiguous
                        symbol: symbol
                    };
                }
            }

            return { currency: null, confidence: 0 };
        }

        /**
         * Detect if amount is negative
         */
        detectNegative(value) {
            // Leading minus sign
            if (/^\s*-/.test(value)) {
                return { negative: true, format: 'MINUS_PREFIX' };
            }

            // Trailing minus sign
            if (/-\s*$/.test(value)) {
                return { negative: true, format: 'MINUS_SUFFIX' };
            }

            // Parentheses (accounting format)
            if (/^\s*\(.*\)\s*$/.test(value)) {
                return { negative: true, format: 'PARENTHESES' };
            }

            // CR suffix (credit)
            if (/\s*CR\s*$/i.test(value)) {
                return { negative: true, format: 'CR_SUFFIX' };
            }

            // DR suffix typically means debit (positive), but in some contexts credit
            // Default to positive for DR

            return { negative: false, format: null };
        }

        /**
         * Clean amount string for parsing
         */
        cleanAmountString(value) {
            return value
                .replace(/[A-Z]{3}/g, '')           // Remove currency codes
                .replace(/[\$€£¥₹₽₩R$krzłFr]/g, '') // Remove currency symbols
                .replace(/[()]/g, '')               // Remove parentheses
                .replace(/^\s*-\s*/, '')            // Remove leading minus
                .replace(/\s*-\s*$/, '')            // Remove trailing minus
                .replace(/\s*(CR|DR)\s*$/i, '')     // Remove CR/DR
                .replace(/\s/g, '')                 // Remove spaces
                .trim();
        }

        /**
         * Determine the number format based on the value pattern and context
         */
        determineFormat(cleanValue, detectedCurrency, context) {
            // First, check if we can determine from the value itself
            const inferredFormat = this.inferFormatFromValue(cleanValue);
            if (inferredFormat) {
                return inferredFormat;
            }

            // Use currency-based format
            if (detectedCurrency && this.CURRENCY_FORMATS[detectedCurrency]) {
                return this.CURRENCY_FORMATS[detectedCurrency];
            }

            // Use vendor locale
            if (context.vendorCountry) {
                const localeFormat = this.LOCALE_FORMATS[context.vendorCountry.toUpperCase()];
                if (localeFormat) return localeFormat;
            }

            // Default to period decimal
            return 'PERIOD';
        }

        /**
         * Infer number format from the value pattern
         */
        inferFormatFromValue(value) {
            // Count occurrences of periods and commas
            const periods = (value.match(/\./g) || []).length;
            const commas = (value.match(/,/g) || []).length;

            // If only one separator and it's followed by exactly 2 digits at the end
            // That separator is the decimal
            if (periods === 1 && commas === 0) {
                if (/\.\d{2}$/.test(value)) {
                    return 'PERIOD'; // 1234.56
                }
            }

            if (commas === 1 && periods === 0) {
                if (/,\d{2}$/.test(value)) {
                    return 'COMMA'; // 1234,56
                }
            }

            // Multiple commas with period at end = US format (1,234,567.89)
            if (commas >= 1 && periods === 1 && /\.\d{2}$/.test(value)) {
                return 'PERIOD';
            }

            // Multiple periods with comma at end = European format (1.234.567,89)
            if (periods >= 1 && commas === 1 && /,\d{2}$/.test(value)) {
                return 'COMMA';
            }

            // Pattern like 1.234 (no decimal visible) - could be European 1234 or US 1.234
            // Check if period is followed by 3 digits (thousands separator)
            if (periods === 1 && /\.\d{3}(?!\d)/.test(value)) {
                return 'COMMA'; // Period is thousands separator
            }

            // Pattern like 1,234 (no decimal visible)
            // Check if comma is followed by 3 digits (thousands separator)
            if (commas === 1 && /,\d{3}(?!\d)/.test(value)) {
                return 'PERIOD'; // Comma is thousands separator
            }

            return null; // Can't determine
        }

        /**
         * Parse number string based on format
         */
        parseNumber(value, format) {
            if (!value) return 0;

            let normalized;

            if (format === 'COMMA') {
                // European format: period = thousands, comma = decimal
                normalized = value
                    .replace(/\./g, '')    // Remove thousands separators
                    .replace(/,/, '.');    // Convert decimal comma to period
            } else {
                // US/UK format: comma = thousands, period = decimal
                normalized = value
                    .replace(/,/g, '');    // Remove thousands separators
            }

            const amount = parseFloat(normalized);
            return isNaN(amount) ? 0 : Math.round(amount * 100) / 100;
        }

        /**
         * Calculate parsing confidence
         */
        calculateConfidence(originalValue, parsedAmount, currencyInfo, format) {
            let confidence = 0.8;

            // Boost if currency was clearly detected
            if (currencyInfo.currency && currencyInfo.confidence > 0.9) {
                confidence += 0.1;
            }

            // Boost if format was unambiguous
            if (format !== null) {
                confidence += 0.05;
            }

            // Reduce if amount is 0 (might be parsing error)
            if (parsedAmount === 0 && !/^[0\.,]+$/.test(originalValue.replace(/[^0-9.,]/g, ''))) {
                confidence -= 0.3;
            }

            // Reduce for very large amounts (might be parsing error)
            if (Math.abs(parsedAmount) > 10000000) {
                confidence -= 0.1;
            }

            return Math.max(0, Math.min(confidence, 1.0));
        }

        /**
         * Format an amount for display
         */
        format(amount, currency = 'USD', locale = 'en-US') {
            try {
                return new Intl.NumberFormat(locale, {
                    style: 'currency',
                    currency: currency
                }).format(amount);
            } catch (e) {
                // Fallback
                return `${currency} ${amount.toFixed(2)}`;
            }
        }

        /**
         * Parse multiple amounts from text and identify the most likely total
         */
        findTotalAmount(amounts, context = {}) {
            if (!amounts || amounts.length === 0) return null;
            if (amounts.length === 1) return amounts[0];

            // Sort by value descending
            const sorted = [...amounts].sort((a, b) => b.value - a.value);

            // The total is usually:
            // 1. The largest amount
            // 2. In the bottom portion of the document
            // 3. Associated with "Total" label

            // Simple heuristic: largest amount that isn't dramatically larger than others
            const largest = sorted[0];
            const secondLargest = sorted[1] || { value: 0 };

            // If largest is more than 10x the second, it might be an error
            if (largest.value > secondLargest.value * 10 && secondLargest.value > 100) {
                // Check if second largest is more reasonable
                return secondLargest;
            }

            return largest;
        }

        /**
         * Validate amount relationships (subtotal + tax = total)
         */
        validateAmounts(subtotal, taxAmount, total, tolerance = 0.02) {
            if (!total) return { valid: false, reason: 'No total amount' };

            const calculated = (subtotal || 0) + (taxAmount || 0);

            if (calculated === 0) {
                return { valid: true, reason: 'No components to validate' };
            }

            const diff = Math.abs(total - calculated);
            const diffPercent = diff / total;

            if (diff <= 0.01) {
                return { valid: true, diff: 0, reason: 'Exact match' };
            }

            if (diffPercent <= tolerance) {
                return {
                    valid: true,
                    diff: diff,
                    diffPercent: diffPercent * 100,
                    reason: 'Within tolerance'
                };
            }

            return {
                valid: false,
                diff: diff,
                diffPercent: diffPercent * 100,
                calculated: calculated,
                reason: `Mismatch: ${subtotal} + ${taxAmount} = ${calculated}, but total is ${total}`
            };
        }

        /**
         * Learn number format from a correction
         */
        learnFormat(original, correctedAmount) {
            const cleanValue = this.cleanAmountString(original);

            // Try both formats
            const periodResult = this.parseNumber(cleanValue, 'PERIOD');
            const commaResult = this.parseNumber(cleanValue, 'COMMA');

            // See which one matches the corrected value
            if (Math.abs(periodResult - correctedAmount) < 0.01) {
                return { format: 'PERIOD', confidence: 0.95 };
            }
            if (Math.abs(commaResult - correctedAmount) < 0.01) {
                return { format: 'COMMA', confidence: 0.95 };
            }

            return null;
        }
    }

    return {
        AmountParser: AmountParser
    };
});
