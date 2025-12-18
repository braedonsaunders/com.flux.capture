/**
 * @NApiVersion 2.1
 * @NModuleScope Public
 * @module FluxCapture/Extraction/DateParser
 *
 * Smart Date Parser - Locale-aware, context-validated date parsing
 * Handles regional format ambiguity (MM/DD vs DD/MM) using vendor locale and cross-validation
 */

define(['N/log', 'N/format'], function(log, format) {
    'use strict';

    /**
     * Smart Date Parser
     * Resolves date format ambiguity using vendor locale and contextual validation
     */
    class DateParser {
        constructor() {
            this.initializePatterns();
        }

        initializePatterns() {
            // Country to date format mapping
            this.LOCALE_FORMATS = {
                // MM/DD/YYYY countries
                'US': 'MDY', 'USA': 'MDY',
                'PH': 'MDY', 'Philippines': 'MDY',

                // DD/MM/YYYY countries (most of the world)
                'GB': 'DMY', 'UK': 'DMY', 'United Kingdom': 'DMY',
                'AU': 'DMY', 'Australia': 'DMY',
                'NZ': 'DMY', 'New Zealand': 'DMY',
                'DE': 'DMY', 'Germany': 'DMY',
                'FR': 'DMY', 'France': 'DMY',
                'IT': 'DMY', 'Italy': 'DMY',
                'ES': 'DMY', 'Spain': 'DMY',
                'NL': 'DMY', 'Netherlands': 'DMY',
                'BE': 'DMY', 'Belgium': 'DMY',
                'AT': 'DMY', 'Austria': 'DMY',
                'CH': 'DMY', 'Switzerland': 'DMY',
                'IE': 'DMY', 'Ireland': 'DMY',
                'IN': 'DMY', 'India': 'DMY',
                'BR': 'DMY', 'Brazil': 'DMY',
                'MX': 'DMY', 'Mexico': 'DMY',
                'AR': 'DMY', 'Argentina': 'DMY',

                // YYYY-MM-DD countries (ISO standard)
                'CN': 'YMD', 'China': 'YMD',
                'JP': 'YMD', 'Japan': 'YMD',
                'KR': 'YMD', 'Korea': 'YMD', 'South Korea': 'YMD',
                'TW': 'YMD', 'Taiwan': 'YMD',
                'HU': 'YMD', 'Hungary': 'YMD',
                'LT': 'YMD', 'Lithuania': 'YMD',
                'SE': 'YMD', 'Sweden': 'YMD',

                // Default
                'DEFAULT': 'MDY' // NetSuite default
            };

            // Regex patterns for date extraction
            this.DATE_PATTERNS = [
                // ISO format: YYYY-MM-DD or YYYY/MM/DD
                {
                    regex: /^(\d{4})[\-\/\.](\d{1,2})[\-\/\.](\d{1,2})$/,
                    format: 'YMD',
                    confidence: 0.95
                },
                // Numeric: could be MM/DD/YYYY or DD/MM/YYYY or DD.MM.YYYY
                {
                    regex: /^(\d{1,2})[\-\/\.](\d{1,2})[\-\/\.](\d{4})$/,
                    format: 'AMBIGUOUS_FULL',
                    confidence: 0.70
                },
                // Numeric with 2-digit year: MM/DD/YY or DD/MM/YY
                {
                    regex: /^(\d{1,2})[\-\/\.](\d{1,2})[\-\/\.](\d{2})$/,
                    format: 'AMBIGUOUS_SHORT',
                    confidence: 0.60
                },
                // Month name: January 15, 2024 or 15 January 2024
                {
                    regex: /^([A-Za-z]+)\s+(\d{1,2}),?\s+(\d{4})$/,
                    format: 'MONTH_FIRST',
                    confidence: 0.90
                },
                {
                    regex: /^(\d{1,2})\s+([A-Za-z]+),?\s+(\d{4})$/,
                    format: 'DAY_FIRST',
                    confidence: 0.90
                },
                // Short month: Jan 15, 2024 or 15-Jan-2024
                {
                    regex: /^([A-Za-z]{3})\s*[\-\/]?\s*(\d{1,2}),?\s*[\-\/]?\s*(\d{4})$/i,
                    format: 'SHORT_MONTH_FIRST',
                    confidence: 0.88
                },
                {
                    regex: /^(\d{1,2})[\-\/\s]([A-Za-z]{3})[\-\/\s](\d{4})$/i,
                    format: 'SHORT_DAY_FIRST',
                    confidence: 0.88
                },
                // Ordinal: 1st January 2024, January 1st 2024
                {
                    regex: /^(\d{1,2})(st|nd|rd|th)\s+([A-Za-z]+),?\s+(\d{4})$/i,
                    format: 'ORDINAL_DAY_FIRST',
                    confidence: 0.85
                },
                {
                    regex: /^([A-Za-z]+)\s+(\d{1,2})(st|nd|rd|th),?\s+(\d{4})$/i,
                    format: 'ORDINAL_MONTH_FIRST',
                    confidence: 0.85
                }
            ];

            // Month name mappings
            this.MONTH_NAMES = {
                'january': 1, 'jan': 1,
                'february': 2, 'feb': 2,
                'march': 3, 'mar': 3,
                'april': 4, 'apr': 4,
                'may': 5,
                'june': 6, 'jun': 6,
                'july': 7, 'jul': 7,
                'august': 8, 'aug': 8,
                'september': 9, 'sep': 9, 'sept': 9,
                'october': 10, 'oct': 10,
                'november': 11, 'nov': 11,
                'december': 12, 'dec': 12
            };
        }

        /**
         * Parse a date string with locale awareness and context validation
         * @param {string} value - The date string to parse
         * @param {Object} context - Context for parsing
         * @param {string} context.vendorCountry - Vendor's country for format hint
         * @param {string} context.fieldType - 'invoiceDate' or 'dueDate'
         * @param {Date} context.invoiceDate - Reference invoice date (for due date validation)
         * @param {Array} context.otherDates - Other dates on document for consistency check
         * @returns {Object} { date: Date|null, confidence: number, format: string }
         */
        parse(value, context = {}) {
            if (!value) {
                return { date: null, confidence: 0, format: null };
            }

            const cleanValue = this.cleanDateString(value);
            log.debug('DateParser.parse', `Input: "${value}" -> cleaned: "${cleanValue}"`);

            // Try NetSuite format.parse first (respects account settings)
            try {
                const nsDate = format.parse({ value: cleanValue, type: format.Type.DATE });
                if (nsDate && !isNaN(nsDate.getTime())) {
                    return {
                        date: nsDate,
                        confidence: 0.85,
                        format: 'NETSUITE_NATIVE'
                    };
                }
            } catch (e) {
                // Continue with custom parsing
            }

            // Try each pattern
            for (const patternDef of this.DATE_PATTERNS) {
                const match = cleanValue.match(patternDef.regex);
                if (match) {
                    const result = this.parseMatch(match, patternDef, context);
                    if (result.date) {
                        // Validate the parsed date
                        const validation = this.validateDate(result.date, context);
                        if (validation.valid) {
                            result.confidence = Math.min(result.confidence * validation.factor, 1.0);
                            log.debug('DateParser.parse', `Success: ${result.date.toISOString()} (conf: ${result.confidence.toFixed(2)})`);
                            return result;
                        } else if (validation.alternateDate) {
                            // Try alternate interpretation
                            log.debug('DateParser.parse', `Using alternate: ${validation.alternateDate.toISOString()}`);
                            return {
                                date: validation.alternateDate,
                                confidence: result.confidence * 0.8,
                                format: result.format + '_ALTERNATE'
                            };
                        }
                    }
                }
            }

            // Fallback: try JavaScript Date constructor
            try {
                const jsDate = new Date(cleanValue);
                if (!isNaN(jsDate.getTime())) {
                    return {
                        date: jsDate,
                        confidence: 0.50,
                        format: 'JS_FALLBACK'
                    };
                }
            } catch (e) {
                // Ignore
            }

            log.debug('DateParser.parse', `Failed to parse: "${value}"`);
            return { date: null, confidence: 0, format: null };
        }

        /**
         * Parse a regex match based on pattern format
         */
        parseMatch(match, patternDef, context) {
            let year, month, day;
            const localeFormat = this.getLocaleFormat(context.vendorCountry);

            switch (patternDef.format) {
                case 'YMD':
                    year = parseInt(match[1]);
                    month = parseInt(match[2]);
                    day = parseInt(match[3]);
                    break;

                case 'AMBIGUOUS_FULL':
                case 'AMBIGUOUS_SHORT':
                    // This is where locale matters
                    const part1 = parseInt(match[1]);
                    const part2 = parseInt(match[2]);
                    let yearPart = parseInt(match[3]);

                    // Handle 2-digit years
                    if (yearPart < 100) {
                        yearPart = yearPart > 50 ? 1900 + yearPart : 2000 + yearPart;
                    }

                    // Determine which part is month vs day
                    const interpretation = this.resolveAmbiguity(part1, part2, localeFormat, context);
                    month = interpretation.month;
                    day = interpretation.day;
                    year = yearPart;
                    break;

                case 'MONTH_FIRST':
                case 'SHORT_MONTH_FIRST':
                    month = this.parseMonthName(match[1]);
                    day = parseInt(match[2]);
                    year = parseInt(match[3]);
                    break;

                case 'DAY_FIRST':
                case 'SHORT_DAY_FIRST':
                    day = parseInt(match[1]);
                    month = this.parseMonthName(match[2]);
                    year = parseInt(match[3]);
                    break;

                case 'ORDINAL_DAY_FIRST':
                    day = parseInt(match[1]);
                    month = this.parseMonthName(match[3]);
                    year = parseInt(match[4]);
                    break;

                case 'ORDINAL_MONTH_FIRST':
                    month = this.parseMonthName(match[1]);
                    day = parseInt(match[2]);
                    year = parseInt(match[4]);
                    break;

                default:
                    return { date: null, confidence: 0, format: patternDef.format };
            }

            // Validate components
            if (!this.isValidDateComponents(year, month, day)) {
                return { date: null, confidence: 0, format: patternDef.format };
            }

            const date = new Date(year, month - 1, day);

            return {
                date: date,
                confidence: patternDef.confidence,
                format: patternDef.format
            };
        }

        /**
         * Resolve ambiguous date format (MM/DD vs DD/MM)
         */
        resolveAmbiguity(part1, part2, localeFormat, context) {
            // If one part is > 12, it must be the day
            if (part1 > 12 && part2 <= 12) {
                return { day: part1, month: part2 };
            }
            if (part2 > 12 && part1 <= 12) {
                return { day: part2, month: part1 };
            }

            // Both could be month or day - use locale
            if (localeFormat === 'MDY') {
                // Month first (US)
                return { month: part1, day: part2 };
            } else {
                // Day first (most of world)
                return { day: part1, month: part2 };
            }
        }

        /**
         * Validate a parsed date against context
         */
        validateDate(date, context) {
            const result = { valid: true, factor: 1.0, alternateDate: null };
            const now = new Date();
            now.setHours(23, 59, 59, 999);

            // Check for reasonable date range (not too old, not too far in future)
            const fiveYearsAgo = new Date(now.getFullYear() - 5, 0, 1);
            const oneYearFuture = new Date(now.getFullYear() + 1, 11, 31);

            if (date < fiveYearsAgo || date > oneYearFuture) {
                result.factor *= 0.5;
            }

            // Field-specific validation
            if (context.fieldType === 'invoiceDate') {
                // Invoice date should not be in the future (more than a few days)
                const nearFuture = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
                if (date > nearFuture) {
                    result.factor *= 0.6;
                    // Try swapping month/day for alternate interpretation
                    result.alternateDate = this.swapMonthDay(date);
                    if (result.alternateDate && result.alternateDate <= nearFuture) {
                        result.valid = false; // Signal to use alternate
                    }
                }
            }

            if (context.fieldType === 'dueDate' && context.invoiceDate) {
                // Due date should be >= invoice date
                if (date < context.invoiceDate) {
                    result.factor *= 0.5;
                    // Try swapping month/day
                    result.alternateDate = this.swapMonthDay(date);
                    if (result.alternateDate && result.alternateDate >= context.invoiceDate) {
                        result.valid = false;
                    }
                }

                // Due date typically within 120 days of invoice
                const maxDue = new Date(context.invoiceDate.getTime() + 120 * 24 * 60 * 60 * 1000);
                if (date > maxDue) {
                    result.factor *= 0.8;
                }
            }

            return result;
        }

        /**
         * Swap month and day in a date (for alternate interpretation)
         */
        swapMonthDay(date) {
            const day = date.getDate();
            const month = date.getMonth() + 1;

            // Can only swap if day <= 12
            if (day > 12) return null;

            // Create new date with swapped values
            const swapped = new Date(date.getFullYear(), day - 1, month);

            // Validate the swap makes sense
            if (swapped.getDate() !== month) return null; // Invalid date

            return swapped;
        }

        /**
         * Get locale-based date format for a country
         */
        getLocaleFormat(country) {
            if (!country) return this.LOCALE_FORMATS['DEFAULT'];

            const normalized = country.toUpperCase().trim();
            return this.LOCALE_FORMATS[normalized] || this.LOCALE_FORMATS['DEFAULT'];
        }

        /**
         * Parse month name to number
         */
        parseMonthName(name) {
            if (!name) return null;
            const normalized = name.toLowerCase().trim();
            return this.MONTH_NAMES[normalized] || null;
        }

        /**
         * Check if date components are valid
         */
        isValidDateComponents(year, month, day) {
            if (year < 1900 || year > 2100) return false;
            if (month < 1 || month > 12) return false;
            if (day < 1 || day > 31) return false;

            // Check days in month
            const daysInMonth = new Date(year, month, 0).getDate();
            if (day > daysInMonth) return false;

            return true;
        }

        /**
         * Clean date string for parsing
         */
        cleanDateString(value) {
            return String(value)
                .trim()
                .replace(/\s+/g, ' ')           // Normalize whitespace
                .replace(/[,]/g, '')            // Remove commas
                .replace(/\.$/, '');            // Remove trailing period
        }

        /**
         * Parse relative date terms like "Net 30"
         */
        parseRelativeDate(value, baseDate) {
            if (!baseDate) return null;

            const match = String(value).match(/net\s*(\d+)/i);
            if (match) {
                const days = parseInt(match[1]);
                const dueDate = new Date(baseDate.getTime() + days * 24 * 60 * 60 * 1000);
                return {
                    date: dueDate,
                    confidence: 0.90,
                    format: 'NET_TERMS',
                    terms: `Net ${days}`
                };
            }

            return null;
        }

        /**
         * Learn date format from a correction
         * @param {string} original - Original parsed date string
         * @param {Date} corrected - User-corrected date
         * @returns {Object} Learned format information
         */
        learnFormat(original, corrected) {
            // Determine what format the original was in
            // and what the correct interpretation should have been
            const cleanOriginal = this.cleanDateString(original);

            for (const patternDef of this.DATE_PATTERNS) {
                const match = cleanOriginal.match(patternDef.regex);
                if (match && patternDef.format.includes('AMBIGUOUS')) {
                    const part1 = parseInt(match[1]);
                    const part2 = parseInt(match[2]);

                    const correctedDay = corrected.getDate();
                    const correctedMonth = corrected.getMonth() + 1;

                    // Determine if this vendor uses MDY or DMY
                    if (part1 === correctedMonth && part2 === correctedDay) {
                        return { format: 'MDY', confidence: 0.95 };
                    } else if (part1 === correctedDay && part2 === correctedMonth) {
                        return { format: 'DMY', confidence: 0.95 };
                    }
                }
            }

            return null;
        }
    }

    return {
        DateParser: DateParser
    };
});
