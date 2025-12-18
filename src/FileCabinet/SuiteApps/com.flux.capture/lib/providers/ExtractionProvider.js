/**
 * @NApiVersion 2.1
 * @NModuleScope Public
 * @module FluxCapture/Providers/ExtractionProvider
 *
 * Base class for document extraction providers.
 * Defines the contract that all extraction providers must implement.
 */

define(['N/log'], function(log) {
    'use strict';

    /**
     * Normalized extraction result format
     * All providers must return data in this format
     * @typedef {Object} NormalizedExtractionResult
     * @property {Array<Object>} pages - Raw page data from provider
     * @property {Array<NormalizedField>} rawFields - Extracted fields
     * @property {Array<NormalizedTable>} rawTables - Extracted tables
     * @property {string} rawText - Full text content
     * @property {number} pageCount - Number of pages
     * @property {string|null} mimeType - Document MIME type
     */

    /**
     * Normalized field format
     * @typedef {Object} NormalizedField
     * @property {number} page - Page index (0-based)
     * @property {string} label - Field label/name
     * @property {number} labelConfidence - Confidence in label extraction (0-1)
     * @property {string} value - Field value
     * @property {number} valueConfidence - Confidence in value extraction (0-1)
     * @property {Object|null} position - Bounding box position {x, y, width, height}
     */

    /**
     * Normalized table format
     * @typedef {Object} NormalizedTable
     * @property {number} page - Page index (0-based)
     * @property {number} index - Table index on page
     * @property {Array<Array>} headerRows - Header row cells
     * @property {Array<Array>} bodyRows - Body row cells
     * @property {Array<Array>} footerRows - Footer row cells
     * @property {number} confidence - Table extraction confidence (0-1)
     */

    /**
     * Provider types enum
     */
    const ProviderType = Object.freeze({
        OCI: 'oci',
        AZURE: 'azure',
        // Future providers can be added here
        // GOOGLE: 'google',
        // AWS_TEXTRACT: 'aws_textract'
    });

    /**
     * Document types supported by providers
     */
    const DocumentType = Object.freeze({
        INVOICE: 'invoice',
        RECEIPT: 'receipt',
        GENERAL: 'general'
    });

    /**
     * Base ExtractionProvider class
     * All extraction providers must extend this class
     */
    class ExtractionProvider {
        /**
         * @param {Object} config - Provider configuration
         */
        constructor(config = {}) {
            this.config = config;
            this.providerType = null; // Must be set by subclass
            this.providerName = 'Base Provider';
        }

        /**
         * Extract document data from a file
         * Must be implemented by subclasses
         *
         * @param {Object} fileObj - NetSuite file object
         * @param {Object} options - Extraction options
         * @param {string} options.documentType - Type of document (invoice, receipt, etc.)
         * @param {string} options.language - Document language
         * @param {number} options.timeout - Timeout in milliseconds
         * @returns {NormalizedExtractionResult} - Normalized extraction result
         */
        extract(fileObj, options = {}) {
            throw new Error('extract() must be implemented by subclass');
        }

        /**
         * Check if the provider is available and properly configured
         * @returns {Object} - {available: boolean, reason: string|null}
         */
        checkAvailability() {
            throw new Error('checkAvailability() must be implemented by subclass');
        }

        /**
         * Get remaining usage/quota if applicable
         * @returns {Object|null} - Usage info or null if not applicable
         */
        getUsageInfo() {
            return null;
        }

        /**
         * Get provider type
         * @returns {string}
         */
        getProviderType() {
            return this.providerType;
        }

        /**
         * Get provider display name
         * @returns {string}
         */
        getProviderName() {
            return this.providerName;
        }

        /**
         * Validate configuration
         * @returns {Object} - {valid: boolean, errors: Array<string>}
         */
        validateConfig() {
            return { valid: true, errors: [] };
        }

        /**
         * Helper: Create empty normalized result
         * @returns {NormalizedExtractionResult}
         */
        _createEmptyResult() {
            return {
                pages: [],
                rawFields: [],
                rawTables: [],
                rawText: '',
                pageCount: 0,
                mimeType: null
            };
        }

        /**
         * Helper: Create a normalized field
         * @param {Object} params
         * @returns {NormalizedField}
         */
        _createNormalizedField(params) {
            return {
                page: params.page || 0,
                label: params.label || '',
                labelConfidence: params.labelConfidence || 0.5,
                value: params.value || '',
                valueConfidence: params.valueConfidence || 0.5,
                position: params.position || null,
                _rawLabel: params._rawLabel || null,
                _rawValue: params._rawValue || null,
                _rawType: params._rawType || null
            };
        }

        /**
         * Helper: Create a normalized table
         * @param {Object} params
         * @returns {NormalizedTable}
         */
        _createNormalizedTable(params) {
            return {
                page: params.page || 0,
                index: params.index || 0,
                headerRows: params.headerRows || [],
                bodyRows: params.bodyRows || [],
                footerRows: params.footerRows || [],
                confidence: params.confidence || 0.5
            };
        }

        /**
         * Helper: Extract text from various field formats
         * @param {*} obj - Field object or string
         * @returns {string|null}
         */
        _extractText(obj) {
            if (!obj) return null;
            if (typeof obj === 'string') return obj;
            if (typeof obj === 'number') return String(obj);
            return obj.text || obj.name || obj.value || obj.content || null;
        }

        /**
         * Helper: Safe stringify for logging
         * @param {*} obj
         * @param {number} maxLen
         * @returns {string}
         */
        _safeStringify(obj, maxLen = 200) {
            if (obj === null) return 'null';
            if (obj === undefined) return 'undefined';
            if (typeof obj === 'string') return obj.substring(0, maxLen);
            if (typeof obj === 'number' || typeof obj === 'boolean') return String(obj);
            try {
                const str = JSON.stringify(obj);
                return str.length > maxLen ? str.substring(0, maxLen) + '...' : str;
            } catch (e) {
                return `[Object: ${typeof obj}]`;
            }
        }

        /**
         * Helper: Log debug message
         * @param {string} title
         * @param {*} details
         */
        _debug(title, details) {
            log.debug(`${this.providerName}.${title}`,
                typeof details === 'object' ? JSON.stringify(details) : details);
        }

        /**
         * Helper: Log audit message
         * @param {string} title
         * @param {*} details
         */
        _audit(title, details) {
            log.audit(`${this.providerName}.${title}`,
                typeof details === 'object' ? JSON.stringify(details) : details);
        }

        /**
         * Helper: Log error message
         * @param {string} title
         * @param {*} details
         */
        _error(title, details) {
            log.error(`${this.providerName}.${title}`,
                typeof details === 'object' ? JSON.stringify(details) : details);
        }
    }

    return {
        ExtractionProvider: ExtractionProvider,
        ProviderType: ProviderType,
        DocumentType: DocumentType
    };
});
