/**
 * @NApiVersion 2.1
 * @NModuleScope Public
 * @module FluxCapture/Resolution/TaxIdExtractor
 *
 * Tax ID Extractor
 * Extracts and validates tax identification numbers (EIN, VAT, ABN, etc.) from documents
 */

define(['N/log', '../FC_Debug'], function(log, fcDebug) {
    'use strict';

    /**
     * Tax ID Types
     */
    const TaxIdType = Object.freeze({
        US_EIN: 'US_EIN',           // Federal Employer Identification Number
        US_SSN: 'US_SSN',           // Social Security Number (should skip)
        UK_VAT: 'UK_VAT',           // UK VAT Number
        EU_VAT: 'EU_VAT',           // EU VAT Number (various countries)
        CA_BN: 'CA_BN',             // Canadian Business Number
        CA_GST: 'CA_GST',           // Canadian GST/HST Number
        AU_ABN: 'AU_ABN',           // Australian Business Number
        AU_ACN: 'AU_ACN',           // Australian Company Number
        NZ_IRD: 'NZ_IRD',           // New Zealand IRD Number
        IN_GSTIN: 'IN_GSTIN',       // Indian GSTIN
        IN_PAN: 'IN_PAN',           // Indian PAN
        UNKNOWN: 'UNKNOWN'
    });

    /**
     * Tax ID Extractor
     */
    class TaxIdExtractor {
        constructor() {
            this.initializePatterns();
        }

        /**
         * Initialize extraction patterns
         */
        initializePatterns() {
            // Patterns with context keywords
            this.PATTERNS = {
                [TaxIdType.US_EIN]: {
                    // EIN format: XX-XXXXXXX (2 digits, hyphen, 7 digits)
                    pattern: /\b(\d{2})-?(\d{7})\b/g,
                    contextKeywords: [
                        'ein', 'employer identification', 'federal id', 'fein',
                        'tax id', 'tax identification', 'fed id', 'federal tax'
                    ],
                    validate: (match) => this.validateEIN(match),
                    format: (match) => `${match.slice(0, 2)}-${match.slice(2)}`
                },

                [TaxIdType.US_SSN]: {
                    // SSN format: XXX-XX-XXXX (should be ignored - sensitive)
                    pattern: /\b(\d{3})-?(\d{2})-?(\d{4})\b/g,
                    contextKeywords: ['ssn', 'social security'],
                    validate: (match) => this.validateSSN(match),
                    skip: true // Don't extract SSNs
                },

                [TaxIdType.UK_VAT]: {
                    // UK VAT: GB followed by 9 or 12 digits
                    pattern: /\bGB\s?(\d{3}\s?\d{4}\s?\d{2}|\d{9}|\d{12})\b/gi,
                    contextKeywords: ['vat', 'vat no', 'vat number', 'vat registration'],
                    validate: (match) => this.validateUKVAT(match),
                    format: (match) => 'GB' + match.replace(/\s/g, '')
                },

                [TaxIdType.EU_VAT]: {
                    // EU VAT: 2 letter country code + 8-12 chars that MUST contain digits
                    // The pattern requires at least one digit to avoid matching words like DESCRIPTION
                    pattern: /\b([A-Z]{2})([A-Z0-9]*\d[A-Z0-9]*)\b/g,
                    contextKeywords: ['vat', 'vat no', 'vat number', 'tax number', 'mwst', 'iva', 'tva', 'btw'],
                    validate: (match) => this.validateEUVAT(match),
                    format: (match) => match.toUpperCase()
                },

                [TaxIdType.CA_BN]: {
                    // Canadian Business Number: 9 digits + 2 letters + 4 digits
                    pattern: /\b(\d{9}[A-Z]{2}\d{4})\b/gi,
                    contextKeywords: ['bn', 'business number', 'gst/hst', 'gst', 'hst'],
                    validate: (match) => this.validateCABN(match),
                    format: (match) => match.toUpperCase()
                },

                [TaxIdType.AU_ABN]: {
                    // Australian Business Number: 11 digits (can have spaces)
                    pattern: /\b(\d{2}\s?\d{3}\s?\d{3}\s?\d{3})\b/g,
                    contextKeywords: ['abn', 'australian business number'],
                    validate: (match) => this.validateABN(match),
                    format: (match) => match.replace(/\s/g, '')
                },

                [TaxIdType.AU_ACN]: {
                    // Australian Company Number: 9 digits
                    pattern: /\b(\d{3}\s?\d{3}\s?\d{3})\b/g,
                    contextKeywords: ['acn', 'australian company number'],
                    validate: (match) => this.validateACN(match),
                    format: (match) => match.replace(/\s/g, '')
                },

                [TaxIdType.IN_GSTIN]: {
                    // Indian GSTIN: 2 digits + 10 char PAN + 1 digit + Z + 1 check
                    pattern: /\b(\d{2}[A-Z]{5}\d{4}[A-Z]\d[A-Z\d][A-Z])\b/gi,
                    contextKeywords: ['gstin', 'gst', 'gst no', 'gst number'],
                    validate: (match) => this.validateGSTIN(match),
                    format: (match) => match.toUpperCase()
                },

                [TaxIdType.IN_PAN]: {
                    // Indian PAN: 5 letters + 4 digits + 1 letter
                    pattern: /\b([A-Z]{5}\d{4}[A-Z])\b/gi,
                    contextKeywords: ['pan', 'pan no', 'pan number'],
                    validate: (match) => true, // PAN is just format validation
                    format: (match) => match.toUpperCase()
                }
            };

            // Universal context keywords that indicate tax ID presence
            this.UNIVERSAL_KEYWORDS = [
                'tax id', 'tax identification', 'tax no', 'tax number',
                'registration', 'registered', 'license', 'permit'
            ];
        }

        /**
         * Extract tax IDs from document text
         * @param {string} text - Raw document text
         * @param {Object} context - Extraction context
         * @returns {Array} Array of extracted tax IDs with types and confidence
         */
        extract(text, context = {}) {
            if (!text) return [];

            const results = [];
            const textLower = text.toLowerCase();

            // Track what we've found to avoid duplicates
            const foundIds = new Set();

            for (const [type, config] of Object.entries(this.PATTERNS)) {
                if (config.skip) continue;

                // Check if context keywords are present
                const hasContext = config.contextKeywords.some(kw =>
                    textLower.includes(kw)
                ) || this.UNIVERSAL_KEYWORDS.some(kw =>
                    textLower.includes(kw)
                );

                // Find all matches
                const pattern = new RegExp(config.pattern.source, config.pattern.flags);
                let match;

                while ((match = pattern.exec(text)) !== null) {
                    const rawMatch = match[0];
                    const cleanMatch = rawMatch.replace(/[\s\-]/g, '');

                    // Skip if already found
                    if (foundIds.has(cleanMatch)) continue;

                    // Validate
                    if (!config.validate(cleanMatch)) continue;

                    // Calculate confidence
                    let confidence = 0.6; // Base confidence for pattern match

                    // Boost for context keywords
                    if (hasContext) {
                        confidence += 0.25;
                    }

                    // Boost for keywords near the match
                    const nearbyText = this.getNearbyText(text, match.index, 50);
                    if (config.contextKeywords.some(kw => nearbyText.toLowerCase().includes(kw))) {
                        confidence += 0.15;
                    }

                    results.push({
                        type: type,
                        value: config.format ? config.format(cleanMatch) : cleanMatch,
                        rawValue: rawMatch,
                        confidence: Math.min(confidence, 0.98),
                        position: match.index
                    });

                    foundIds.add(cleanMatch);
                }
            }

            // Sort by confidence and position (prefer higher confidence, earlier position)
            results.sort((a, b) => {
                if (Math.abs(a.confidence - b.confidence) > 0.1) {
                    return b.confidence - a.confidence;
                }
                return a.position - b.position;
            });

            fcDebug.debug('TaxIdExtractor.extract', {
                found: results.length,
                types: results.map(r => r.type)
            });

            return results;
        }

        /**
         * Extract the best/primary tax ID from document
         * @param {string} text - Raw document text
         * @param {Object} context - Extraction context
         * @returns {Object|null} Best tax ID match or null
         */
        extractPrimary(text, context = {}) {
            const results = this.extract(text, context);

            // Prefer EIN for US documents, VAT for European
            if (context.vendorCountry) {
                const country = context.vendorCountry.toUpperCase();

                if (['US', 'USA'].includes(country)) {
                    const ein = results.find(r => r.type === TaxIdType.US_EIN);
                    if (ein) return ein;
                }

                if (['GB', 'UK'].includes(country)) {
                    const ukVat = results.find(r => r.type === TaxIdType.UK_VAT);
                    if (ukVat) return ukVat;
                }

                if (['AU', 'AUS'].includes(country)) {
                    const abn = results.find(r => r.type === TaxIdType.AU_ABN);
                    if (abn) return abn;
                }

                // EU countries
                const euCountries = ['DE', 'FR', 'IT', 'ES', 'NL', 'BE', 'AT', 'PT', 'IE', 'PL'];
                if (euCountries.includes(country)) {
                    const euVat = results.find(r => r.type === TaxIdType.EU_VAT);
                    if (euVat) return euVat;
                }
            }

            // Return highest confidence result
            return results[0] || null;
        }

        /**
         * Get text surrounding a position
         */
        getNearbyText(text, position, radius) {
            const start = Math.max(0, position - radius);
            const end = Math.min(text.length, position + radius);
            return text.substring(start, end);
        }

        /**
         * Validate US EIN
         */
        validateEIN(ein) {
            const digits = ein.replace(/\D/g, '');
            if (digits.length !== 9) return false;

            // EIN first two digits must be valid campus code
            const validPrefixes = [
                '01', '02', '03', '04', '05', '06', '10', '11', '12', '13', '14', '15', '16',
                '20', '21', '22', '23', '24', '25', '26', '27',
                '30', '31', '32', '33', '34', '35', '36', '37', '38', '39',
                '40', '41', '42', '43', '44', '45', '46', '47', '48',
                '50', '51', '52', '53', '54', '55', '56', '57', '58', '59',
                '60', '61', '62', '63', '64', '65', '66', '67', '68', '71', '72', '73', '74',
                '75', '76', '77', '80', '81', '82', '83', '84', '85', '86', '87', '88',
                '90', '91', '92', '93', '94', '95', '98', '99'
            ];

            const prefix = digits.slice(0, 2);
            return validPrefixes.includes(prefix);
        }

        /**
         * Validate US SSN (for skipping)
         */
        validateSSN(ssn) {
            const digits = ssn.replace(/\D/g, '');
            if (digits.length !== 9) return false;

            // Check for invalid area numbers
            const area = digits.slice(0, 3);
            if (area === '000' || area === '666' || area.startsWith('9')) {
                return false;
            }

            return true;
        }

        /**
         * Validate UK VAT number
         */
        validateUKVAT(vat) {
            const digits = vat.replace(/\D/g, '');
            return digits.length === 9 || digits.length === 12;
        }

        /**
         * Validate EU VAT number (basic validation)
         */
        validateEUVAT(vat) {
            // Basic format check - country code + 8-12 alphanumeric
            const match = vat.match(/^([A-Z]{2})(.+)$/i);
            if (!match) return false;

            const countryCode = match[1].toUpperCase();
            const body = match[2];

            // Body must be 8-12 characters
            if (body.length < 8 || body.length > 12) return false;

            // Body must contain at least one digit (to avoid words like DESCRIPTION)
            if (!/\d/.test(body)) return false;

            // Validate country code
            const validCountries = [
                'AT', 'BE', 'BG', 'CY', 'CZ', 'DE', 'DK', 'EE', 'EL', 'ES',
                'FI', 'FR', 'HR', 'HU', 'IE', 'IT', 'LT', 'LU', 'LV', 'MT',
                'NL', 'PL', 'PT', 'RO', 'SE', 'SI', 'SK', 'XI' // XI = Northern Ireland
            ];

            return validCountries.includes(countryCode);
        }

        /**
         * Validate Canadian Business Number
         */
        validateCABN(bn) {
            const match = bn.toUpperCase().match(/^(\d{9})([A-Z]{2})(\d{4})$/);
            if (!match) return false;

            // Program identifier should be RT, RC, RP, etc.
            const programId = match[2];
            const validPrograms = ['RT', 'RC', 'RP', 'RR', 'RZ', 'RN', 'RM'];

            return validPrograms.includes(programId);
        }

        /**
         * Validate Australian Business Number (ABN)
         */
        validateABN(abn) {
            const digits = abn.replace(/\D/g, '');
            if (digits.length !== 11) return false;

            // ABN checksum validation
            const weights = [10, 1, 3, 5, 7, 9, 11, 13, 15, 17, 19];
            let sum = 0;

            for (let i = 0; i < 11; i++) {
                let digit = parseInt(digits[i]);
                if (i === 0) digit -= 1; // Subtract 1 from first digit
                sum += digit * weights[i];
            }

            return sum % 89 === 0;
        }

        /**
         * Validate Australian Company Number (ACN)
         */
        validateACN(acn) {
            const digits = acn.replace(/\D/g, '');
            if (digits.length !== 9) return false;

            // ACN checksum validation
            const weights = [8, 7, 6, 5, 4, 3, 2, 1];
            let sum = 0;

            for (let i = 0; i < 8; i++) {
                sum += parseInt(digits[i]) * weights[i];
            }

            const remainder = sum % 10;
            const check = remainder === 0 ? 0 : 10 - remainder;

            return check === parseInt(digits[8]);
        }

        /**
         * Validate Indian GSTIN
         */
        validateGSTIN(gstin) {
            const upper = gstin.toUpperCase();
            if (upper.length !== 15) return false;

            // State code (first 2 digits) should be 01-37 or 97-99
            const stateCode = parseInt(upper.slice(0, 2));
            if (stateCode < 1 || (stateCode > 37 && stateCode < 97) || stateCode > 99) {
                return false;
            }

            // Check 13th character is always 'Z'
            // (Actually can be 1-9 for multiple registrations, but Z is most common)

            return true;
        }

        /**
         * Get tax ID types enum
         */
        static get TaxIdType() {
            return TaxIdType;
        }
    }

    return {
        TaxIdExtractor: TaxIdExtractor,
        TaxIdType: TaxIdType
    };
});
