/**
 * @NApiVersion 2.1
 * @NModuleScope Public
 * @module FluxCapture/Providers/OCIProvider
 *
 * OCI Document Understanding provider implementation.
 * Uses NetSuite's N/documentCapture module which integrates with Oracle Cloud Infrastructure.
 */

define([
    'N/log',
    'N/documentCapture',
    './ExtractionProvider'
], function(log, documentCapture, ExtractionProviderModule) {
    'use strict';

    const { ExtractionProvider, ProviderType, DocumentType } = ExtractionProviderModule;

    /**
     * OCI Document Understanding Provider
     * Wraps NetSuite's N/documentCapture module
     */
    class OCIProvider extends ExtractionProvider {
        /**
         * @param {Object} config - Provider configuration
         */
        constructor(config = {}) {
            super(config);
            this.providerType = ProviderType.OCI;
            this.providerName = 'OCI Document Understanding';
            this.docCaptureModule = documentCapture;
        }

        /**
         * Extract document data using N/documentCapture
         * @param {Object} fileObj - NetSuite file object
         * @param {Object} options - Extraction options
         * @returns {Object} - Normalized extraction result
         */
        extract(fileObj, options = {}) {
            const availability = this.checkAvailability();

            if (!availability.available) {
                this._audit('extract', `Provider not available: ${availability.reason}`);
                return this._createFallbackResult(fileObj);
            }

            try {
                // Map document type to N/documentCapture type
                let captureDocType = this.docCaptureModule.DocumentType.INVOICE;
                if (options.documentType === DocumentType.RECEIPT ||
                    options.documentType === 'RECEIPT' ||
                    options.documentType === 'receipt') {
                    captureDocType = this.docCaptureModule.DocumentType.RECEIPT;
                }

                const extractOptions = {
                    file: fileObj,
                    documentType: captureDocType,
                    features: [
                        this.docCaptureModule.Feature.FIELD_EXTRACTION,
                        this.docCaptureModule.Feature.TABLE_EXTRACTION,
                        this.docCaptureModule.Feature.TEXT_EXTRACTION
                    ]
                };

                // Add language if specified
                if (options.language && this.docCaptureModule.Language[options.language]) {
                    extractOptions.language = this.docCaptureModule.Language[options.language];
                }

                // Add timeout if specified
                if (options.timeout) {
                    extractOptions.timeout = Math.max(30000, options.timeout);
                }

                this._debug('extract', `Calling documentToStructure with type: ${captureDocType}`);

                const result = this.docCaptureModule.documentToStructure(extractOptions);

                this._debug('extract', `Received result with ${result.pages ? result.pages.length : 0} pages`);

                return this._normalizeResult(result);

            } catch (e) {
                this._error('extract', {
                    message: e.message,
                    stack: e.stack,
                    name: e.name
                });

                // Check for usage limit error
                if (e.message && e.message.includes('usage')) {
                    throw new Error('Document capture usage limit reached. Please try again later or configure OCI credentials.');
                }

                this._audit('extract', `Extraction failed, using fallback: ${e.message}`);
                return this._createFallbackResult(fileObj);
            }
        }

        /**
         * Check if N/documentCapture is available
         * @returns {Object}
         */
        checkAvailability() {
            if (!this.docCaptureModule) {
                return {
                    available: false,
                    reason: 'N/documentCapture module not loaded'
                };
            }

            try {
                // Check if required methods exist
                if (typeof this.docCaptureModule.documentToStructure !== 'function') {
                    return {
                        available: false,
                        reason: 'documentToStructure method not available'
                    };
                }

                return { available: true, reason: null };
            } catch (e) {
                return {
                    available: false,
                    reason: e.message
                };
            }
        }

        /**
         * Get remaining free usage
         * @returns {Object|null}
         */
        getUsageInfo() {
            if (this.docCaptureModule && typeof this.docCaptureModule.getRemainingFreeUsage === 'function') {
                try {
                    const remaining = this.docCaptureModule.getRemainingFreeUsage();
                    return {
                        remaining: remaining,
                        type: 'monthly_free_tier'
                    };
                } catch (e) {
                    this._debug('getUsageInfo', e.message);
                }
            }
            return null;
        }

        /**
         * Normalize OCI result to standard format
         * @param {Object} result - Raw N/documentCapture result
         * @returns {Object} - Normalized result
         */
        _normalizeResult(result) {
            let rawText = '';
            const pageCount = result.pages ? result.pages.length : 1;
            const rawFields = [];
            const rawTables = [];

            this._debug('normalizeResult', `Processing ${pageCount} pages`);

            if (result.pages && result.pages.length > 0) {
                result.pages.forEach((page, pageIndex) => {
                    // Extract text
                    if (typeof page.getText === 'function') {
                        rawText += page.getText() + '\n';
                    } else if (page.lines) {
                        page.lines.forEach(line => {
                            const lineText = line.text || (line.words ? line.words.map(w => w.text || w).join(' ') : '');
                            if (lineText) rawText += lineText + '\n';
                        });
                    }

                    // Collect raw fields
                    if (page.fields && page.fields.length > 0) {
                        page.fields.forEach((field, fieldIndex) => {
                            const extractedLabel = this._extractText(field.label);
                            const extractedValue = this._extractText(field.value);

                            rawFields.push(this._createNormalizedField({
                                page: pageIndex,
                                label: extractedLabel,
                                labelConfidence: field.label?.confidence || 0.5,
                                value: extractedValue,
                                valueConfidence: field.value?.confidence || field.confidence || 0.5,
                                position: field.boundingBox || field.bbox || null,
                                _rawLabel: field.label,
                                _rawValue: field.value,
                                _rawType: field.type
                            }));
                        });
                    }

                    // Collect raw tables
                    if (page.tables && page.tables.length > 0) {
                        page.tables.forEach((table, tableIndex) => {
                            rawTables.push(this._createNormalizedTable({
                                page: pageIndex,
                                index: tableIndex,
                                headerRows: table.headerRows,
                                bodyRows: table.bodyRows,
                                footerRows: table.footerRows,
                                confidence: table.confidence
                            }));
                        });
                    }
                });
            }

            this._debug('normalizeResult', {
                totalFields: rawFields.length,
                totalTables: rawTables.length,
                rawTextLength: rawText.length
            });

            return {
                pages: result.pages,
                rawFields: rawFields,
                rawTables: rawTables,
                rawText: rawText.trim(),
                pageCount: pageCount,
                mimeType: result.mimeType || null
            };
        }

        /**
         * Create fallback result when N/documentCapture is unavailable
         * Extracts minimal data from filename
         * @param {Object} fileObj
         * @returns {Object}
         */
        _createFallbackResult(fileObj) {
            const fileName = fileObj.name || '';
            this._audit('createFallbackResult', `Creating fallback for: ${fileName}`);

            let vendorName = null;
            let invoiceNumber = null;
            let invoiceDate = null;

            // Extract invoice number patterns
            const invPatterns = [
                /INV[#\-_]?(\d+)/i,
                /INVOICE[#\-_\s]?(\d+)/i,
                /(?:^|[\s\-_])(\d{6,})/,
                /#(\d+)/
            ];

            for (const pattern of invPatterns) {
                const match = fileName.match(pattern);
                if (match) {
                    invoiceNumber = match[0].replace(/^[\s\-_#]+/, '');
                    break;
                }
            }

            // Extract date patterns
            const datePatterns = [
                /(\d{1,2}[-\/]\d{1,2}[-\/]\d{2,4})/,
                /(\d{4}[-\/]\d{1,2}[-\/]\d{1,2})/
            ];

            for (const pattern of datePatterns) {
                const match = fileName.match(pattern);
                if (match) {
                    try {
                        const parsed = new Date(match[1].replace(/-/g, '/'));
                        if (!isNaN(parsed.getTime())) {
                            invoiceDate = parsed;
                        }
                    } catch (e) { /* ignore */ }
                    break;
                }
            }

            // Extract vendor name from filename
            let cleanName = fileName
                .replace(/\.(pdf|png|jpg|jpeg|tiff?)$/i, '')
                .replace(/INV[#\-_]?\d+/gi, '')
                .replace(/\d{1,2}[-\/]\d{1,2}[-\/]\d{2,4}/g, '')
                .replace(/^[A-Z][-\s]/i, '')
                .replace(/[-_]+/g, ' ')
                .trim();

            const parts = cleanName.split(/\s*[-–—]\s*/);
            if (parts.length > 1) {
                vendorName = parts.find(p => p.length > 2 && !/^\d+$/.test(p));
            } else if (cleanName.length > 2) {
                vendorName = cleanName;
            }

            if (vendorName) {
                vendorName = vendorName.replace(/\s+/g, ' ').trim();
            }

            // Build minimal rawFields for downstream processing
            const rawFields = [];
            if (vendorName) {
                rawFields.push(this._createNormalizedField({
                    page: 0,
                    label: 'Vendor Name',
                    labelConfidence: 0.6,
                    value: vendorName,
                    valueConfidence: 0.6
                }));
            }
            if (invoiceNumber) {
                rawFields.push(this._createNormalizedField({
                    page: 0,
                    label: 'Invoice Number',
                    labelConfidence: 0.7,
                    value: invoiceNumber,
                    valueConfidence: 0.7
                }));
            }
            if (invoiceDate) {
                rawFields.push(this._createNormalizedField({
                    page: 0,
                    label: 'Invoice Date',
                    labelConfidence: 0.6,
                    value: invoiceDate.toISOString().split('T')[0],
                    valueConfidence: 0.6
                }));
            }

            return {
                pages: [],
                rawFields: rawFields,
                rawTables: [],
                rawText: '[Document capture not available - data extracted from filename]',
                pageCount: 1,
                mimeType: fileObj.fileType || null,
                isFallback: true
            };
        }
    }

    return {
        OCIProvider: OCIProvider
    };
});
