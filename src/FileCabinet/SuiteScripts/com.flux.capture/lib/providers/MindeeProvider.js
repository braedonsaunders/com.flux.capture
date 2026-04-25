/**
 * @NApiVersion 2.1
 * @NModuleScope Public
 * @module FluxCapture/Providers/MindeeProvider
 *
 * Mindee document processing provider implementation.
 * Uses Mindee's REST API for document extraction.
 *
 * Supports:
 * - Invoice parsing (v4)
 * - Receipt parsing (v5)
 * - General document processing
 *
 * API Documentation: https://developers.mindee.com/docs
 */

define([
    'N/log',
    'N/https',
    'N/encode',
    './ExtractionProvider'
], function(log, https, encode, ExtractionProviderModule) {
    'use strict';

    const { ExtractionProvider, ProviderType, DocumentType } = ExtractionProviderModule;

    // Mindee API configuration
    const MINDEE_API_BASE = 'https://api.mindee.net/v1';

    // API endpoints for different document types
    const MINDEE_ENDPOINTS = {
        invoice: '/products/mindee/invoices/v4/predict',
        receipt: '/products/mindee/expense_receipts/v5/predict',
        general: '/products/mindee/invoices/v4/predict' // Default to invoice
    };

    // Field mappings from Mindee field names to our normalized names
    const MINDEE_INVOICE_FIELD_MAPPINGS = {
        // Supplier/Vendor fields
        'supplier_name': 'vendorName',
        'supplier_address': 'vendorAddress',
        'supplier_company_registrations': 'vendorTaxId',
        'supplier_payment_details': 'vendorPaymentDetails',

        // Customer fields
        'customer_name': 'customerName',
        'customer_address': 'customerAddress',
        'customer_company_registrations': 'customerTaxId',

        // Invoice identification
        'invoice_number': 'invoiceNumber',
        'reference_numbers': 'referenceNumber',
        'invoice_date': 'invoiceDate',
        'due_date': 'dueDate',
        'purchase_order_number': 'poNumber',

        // Amounts
        'total_amount': 'totalAmount',
        'total_net': 'subtotal',
        'total_tax': 'taxAmount',

        // Other
        'locale': 'locale',
        'document_type': 'documentType',

        // Billing/Shipping
        'billing_address': 'billingAddress',
        'shipping_address': 'shippingAddress'
    };

    // Receipt-specific field mappings
    const MINDEE_RECEIPT_FIELD_MAPPINGS = {
        'supplier_name': 'vendorName',
        'supplier_address': 'vendorAddress',
        'date': 'invoiceDate',
        'time': 'transactionTime',
        'total_amount': 'totalAmount',
        'total_net': 'subtotal',
        'total_tax': 'taxAmount',
        'tip': 'tip',
        'locale': 'locale',
        'category': 'category',
        'subcategory': 'subcategory',
        'document_type': 'documentType',
        'receipt_number': 'invoiceNumber'
    };

    // Line item field mappings
    const MINDEE_LINE_ITEM_MAPPINGS = {
        'description': 'description',
        'product_code': 'itemCode',
        'quantity': 'quantity',
        'unit_price': 'unitPrice',
        'total_amount': 'amount',
        'tax_rate': 'taxRate',
        'tax_amount': 'tax',
        'unit_measure': 'unit'
    };

    /**
     * Mindee Provider
     */
    class MindeeProvider extends ExtractionProvider {
        /**
         * @param {Object} config - Provider configuration
         * @param {string} config.apiKey - Mindee API key
         * @param {string} [config.defaultDocumentType] - Default document type (invoice, receipt)
         */
        constructor(config = {}) {
            super(config);
            this.providerType = ProviderType.MINDEE;
            this.providerName = 'Mindee';

            // Configuration
            this.apiKey = config.apiKey || '';
            this.defaultDocumentType = config.defaultDocumentType || 'invoice';
        }

        /**
         * Extract document data using Mindee
         * @param {Object} fileObj - NetSuite file object
         * @param {Object} options - Extraction options
         * @returns {Object} - Normalized extraction result
         */
        extract(fileObj, options = {}) {
            const availability = this.checkAvailability();

            if (!availability.available) {
                this._error('extract', `Provider not available: ${availability.reason}`);
                throw new Error(`Mindee not available: ${availability.reason}`);
            }

            try {
                // Determine which document type to use
                const docType = this._getDocumentType(options.documentType);
                const endpoint = MINDEE_ENDPOINTS[docType] || MINDEE_ENDPOINTS.invoice;

                this._audit('extract', `Starting extraction with document type: ${docType}`);

                // Submit document and get results (Mindee is synchronous)
                const result = this._submitDocument(fileObj, endpoint);

                if (!result) {
                    throw new Error('Failed to get analysis results from Mindee');
                }

                this._audit('extract', `Analysis complete`);

                // Normalize results
                return this._normalizeResult(result, docType, options);

            } catch (e) {
                this._error('extract', {
                    message: e.message,
                    stack: e.stack
                });
                throw e;
            }
        }

        /**
         * Check if Mindee is available
         * @returns {Object}
         */
        checkAvailability() {
            if (!this.apiKey) {
                return {
                    available: false,
                    reason: 'Mindee API key not configured'
                };
            }

            return { available: true, reason: null };
        }

        /**
         * Validate configuration
         * @returns {Object}
         */
        validateConfig() {
            const errors = [];

            if (!this.apiKey) {
                errors.push('Mindee API key is required');
            } else if (this.apiKey.length < 20) {
                errors.push('Mindee API key appears to be invalid (too short)');
            }

            return {
                valid: errors.length === 0,
                errors: errors
            };
        }

        /**
         * Get the appropriate document type
         * @param {string} documentType
         * @returns {string}
         */
        _getDocumentType(documentType) {
            if (!documentType) return this.defaultDocumentType;

            const docType = String(documentType).toLowerCase();

            if (docType === 'receipt' || docType === 'expense_report' || docType === '2' || docType === '4') {
                return 'receipt';
            }

            if (docType === 'invoice' || docType === '1') {
                return 'invoice';
            }

            return this.defaultDocumentType;
        }

        /**
         * Submit document for analysis
         * @param {Object} fileObj - NetSuite file object
         * @param {string} endpoint - API endpoint
         * @returns {Object|null} - Analysis result or null
         */
        _submitDocument(fileObj, endpoint) {
            const url = MINDEE_API_BASE + endpoint;

            // Get file content as base64
            const fileContent = fileObj.getContents();
            const fileName = fileObj.name || 'document.pdf';

            this._debug('submitDocument', {
                url: url,
                fileName: fileName,
                contentLength: fileContent ? fileContent.length : 0
            });

            try {
                // Mindee expects multipart/form-data, but we can also send base64
                // Using base64 JSON approach for SuiteScript compatibility
                const requestBody = JSON.stringify({
                    document: fileContent
                });

                const response = https.post({
                    url: url,
                    headers: {
                        'Authorization': 'Token ' + this.apiKey,
                        'Content-Type': 'application/json'
                    },
                    body: requestBody
                });

                this._debug('submitDocument.response', {
                    code: response.code
                });

                // Check for successful response
                if (response.code === 200 || response.code === 201) {
                    const result = JSON.parse(response.body);
                    return result;
                }

                // Handle error responses
                if (response.code >= 400) {
                    let errorMessage = `Mindee API error: ${response.code}`;
                    try {
                        const errorBody = JSON.parse(response.body);
                        errorMessage = errorBody.api_request?.error?.message ||
                            errorBody.error?.message ||
                            errorBody.message ||
                            errorMessage;
                    } catch (e) { /* ignore parse error */ }

                    this._error('submitDocument', errorMessage);
                    throw new Error(errorMessage);
                }

                return null;

            } catch (e) {
                this._error('submitDocument', e.message);
                throw e;
            }
        }

        /**
         * Normalize Mindee result to standard format
         * @param {Object} result - Mindee analysis result
         * @param {string} docType - Document type
         * @param {Object} options - Extraction options including maxPages
         * @returns {Object} - Normalized result
         */
        _normalizeResult(result, docType, options = {}) {
            const rawFields = [];
            const rawTables = [];
            let rawText = '';

            // Get the document prediction
            const document = result.document || {};
            const inference = document.inference || {};
            const prediction = inference.prediction || {};
            let pages = inference.pages || [];

            // Get original page count and apply limit if specified
            const totalDocumentPages = pages.length || document.n_pages || 1;
            const maxPages = options.maxPages || 0;

            if (maxPages > 0 && pages.length > maxPages) {
                this._audit('normalizeResult', `Limiting from ${pages.length} pages to first ${maxPages} pages`);
                pages = pages.slice(0, maxPages);
            }
            const pageCount = pages.length || 1;

            // Select appropriate field mappings based on document type
            const fieldMappings = docType === 'receipt'
                ? MINDEE_RECEIPT_FIELD_MAPPINGS
                : MINDEE_INVOICE_FIELD_MAPPINGS;

            // Extract document-level fields
            for (const [mindeeField, fieldData] of Object.entries(prediction)) {
                // Skip line items - handle separately
                if (mindeeField === 'line_items') {
                    continue;
                }

                // Skip supplier/customer payment details arrays
                if (mindeeField === 'supplier_payment_details' ||
                    mindeeField === 'supplier_company_registrations' ||
                    mindeeField === 'customer_company_registrations' ||
                    mindeeField === 'reference_numbers') {
                    // Handle arrays specially
                    const normalizedField = this._normalizeArrayField(mindeeField, fieldData, fieldMappings);
                    if (normalizedField) {
                        rawFields.push(normalizedField);
                    }
                    continue;
                }

                const normalizedField = this._normalizeField(mindeeField, fieldData, fieldMappings, 0);
                if (normalizedField) {
                    rawFields.push(normalizedField);
                }
            }

            // Extract line items as a table
            if (prediction.line_items && Array.isArray(prediction.line_items)) {
                const lineItemsTable = this._extractLineItemsTable(prediction.line_items);
                if (lineItemsTable) {
                    rawTables.push(lineItemsTable);
                }
            }

            // Extract raw text from pages if available
            pages.forEach((page, pageIndex) => {
                if (page.extras && page.extras.full_text_ocr) {
                    rawText += page.extras.full_text_ocr.content + '\n';
                }
            });

            // Also try to get text from document level
            if (!rawText && document.ocr && document.ocr.mvision_v1) {
                rawText = document.ocr.mvision_v1.reduce((acc, page) => {
                    return acc + (page.all_lines || []).map(l => l.text).join('\n') + '\n';
                }, '');
            }

            this._debug('normalizeResult', {
                pageCount: pageCount,
                fieldCount: rawFields.length,
                tableCount: rawTables.length,
                rawTextLength: rawText.length
            });

            return {
                pages: pages,
                rawFields: rawFields,
                rawTables: rawTables,
                rawText: rawText.trim(),
                pageCount: pageCount,
                totalDocumentPages: totalDocumentPages,
                pagesLimited: totalDocumentPages > pageCount,
                mimeType: null,
                _mindeeResult: result // Keep for debugging
            };
        }

        /**
         * Normalize a single Mindee field
         * @param {string} mindeeFieldName
         * @param {Object} fieldData
         * @param {Object} fieldMappings
         * @param {number} pageIndex
         * @returns {Object|null}
         */
        _normalizeField(mindeeFieldName, fieldData, fieldMappings, pageIndex) {
            if (!fieldData) return null;

            // Get the mapped field name or use original
            const normalizedName = fieldMappings[mindeeFieldName] || mindeeFieldName;

            // Handle different field types
            let value = null;
            let confidence = 0;

            // Mindee field structure can vary
            if (typeof fieldData === 'object') {
                // Standard field with value property
                if ('value' in fieldData) {
                    value = fieldData.value;
                    confidence = fieldData.confidence || 0;

                    // Handle date fields
                    if (fieldData.date_object) {
                        value = fieldData.value; // Keep ISO date string
                    }

                    // Handle amount fields
                    if (typeof value === 'number') {
                        value = String(value);
                    }
                }
                // Amount field with amount property
                else if ('amount' in fieldData) {
                    value = fieldData.amount;
                    confidence = fieldData.confidence || 0;
                }
                // Currency field
                else if ('currency' in fieldData && 'value' in fieldData) {
                    value = fieldData.value;
                    confidence = fieldData.confidence || 0;
                }
                // String field with raw_value
                else if ('raw_value' in fieldData) {
                    value = fieldData.raw_value;
                    confidence = fieldData.confidence || 0;
                }
            } else if (typeof fieldData === 'string' || typeof fieldData === 'number') {
                value = fieldData;
                confidence = 1.0; // Assume high confidence for direct values
            }

            // Skip empty/null values
            if (value === null || value === undefined || value === '') return null;

            // Get bounding box if available
            let position = null;
            if (fieldData.bounding_box || fieldData.polygon) {
                const poly = fieldData.polygon || fieldData.bounding_box;
                position = this._polygonToPosition(poly, pageIndex);
            }

            // Get page index from field if available
            if (fieldData.page_id !== undefined) {
                pageIndex = fieldData.page_id;
            }

            return this._createNormalizedField({
                page: pageIndex,
                label: mindeeFieldName,
                labelConfidence: confidence,
                value: String(value),
                valueConfidence: confidence,
                position: position,
                _rawLabel: mindeeFieldName,
                _rawValue: fieldData,
                _rawType: typeof fieldData.value
            });
        }

        /**
         * Normalize array fields (like reference_numbers, company_registrations)
         * @param {string} fieldName
         * @param {Array} fieldData
         * @param {Object} fieldMappings
         * @returns {Object|null}
         */
        _normalizeArrayField(fieldName, fieldData, fieldMappings) {
            if (!Array.isArray(fieldData) || fieldData.length === 0) return null;

            // Combine array values into single field
            const values = fieldData.map(item => {
                if (typeof item === 'object' && item.value) {
                    return item.value;
                }
                return item;
            }).filter(v => v);

            if (values.length === 0) return null;

            const normalizedName = fieldMappings[fieldName] || fieldName;
            const avgConfidence = fieldData.reduce((sum, item) => {
                return sum + (item.confidence || 0);
            }, 0) / fieldData.length;

            return this._createNormalizedField({
                page: 0,
                label: fieldName,
                labelConfidence: avgConfidence,
                value: values.join(', '),
                valueConfidence: avgConfidence,
                position: null,
                _rawLabel: fieldName,
                _rawValue: fieldData,
                _rawType: 'array'
            });
        }

        /**
         * Extract line items as a normalized table
         * @param {Array} lineItems - Mindee line items array
         * @returns {Object|null}
         */
        _extractLineItemsTable(lineItems) {
            if (!lineItems || lineItems.length === 0) return null;

            // Determine columns from available fields
            const columnSet = new Set();
            lineItems.slice(0, 5).forEach(item => {
                Object.keys(item).forEach(k => {
                    // Skip polygon/bounding box fields
                    if (k !== 'polygon' && k !== 'bounding_box' && k !== 'page_id') {
                        columnSet.add(k);
                    }
                });
            });

            const columns = Array.from(columnSet);
            if (columns.length === 0) return null;

            // Build header row with readable names
            const headerRow = columns.map(col => ({
                text: this._formatColumnHeader(col),
                content: col
            }));

            // Build body rows
            const bodyRows = lineItems.map(item => {
                return columns.map(col => {
                    const field = item[col];
                    if (field === null || field === undefined) {
                        return { text: '', content: '' };
                    }

                    let value = '';
                    let confidence = 0;

                    if (typeof field === 'object' && 'value' in field) {
                        value = field.value;
                        confidence = field.confidence || 0;
                    } else if (typeof field === 'object' && 'amount' in field) {
                        value = field.amount;
                        confidence = field.confidence || 0;
                    } else {
                        value = field;
                        confidence = 1;
                    }

                    return {
                        text: value !== null ? String(value) : '',
                        content: value !== null ? String(value) : '',
                        confidence: confidence
                    };
                });
            });

            return this._createNormalizedTable({
                page: 0,
                index: 0,
                headerRows: [headerRow],
                bodyRows: bodyRows,
                footerRows: [],
                confidence: 0.85
            });
        }

        /**
         * Format column header for display
         * @param {string} col
         * @returns {string}
         */
        _formatColumnHeader(col) {
            // Convert snake_case to Title Case
            return col.split('_')
                .map(word => word.charAt(0).toUpperCase() + word.slice(1))
                .join(' ');
        }

        /**
         * Convert Mindee polygon to position object
         * @param {Array} polygon - Array of coordinate objects [{x, y}, ...]
         * @param {number} pageIndex
         * @returns {Object|null}
         */
        _polygonToPosition(polygon, pageIndex) {
            if (!polygon || !Array.isArray(polygon) || polygon.length < 4) return null;

            try {
                const xs = polygon.map(p => p.x || p[0] || 0);
                const ys = polygon.map(p => p.y || p[1] || 0);

                return {
                    page: pageIndex,
                    x: Math.min(...xs),
                    y: Math.min(...ys),
                    width: Math.max(...xs) - Math.min(...xs),
                    height: Math.max(...ys) - Math.min(...ys),
                    polygon: polygon
                };
            } catch (e) {
                return null;
            }
        }
    }

    return {
        MindeeProvider: MindeeProvider,
        MINDEE_API_BASE: MINDEE_API_BASE,
        MINDEE_ENDPOINTS: MINDEE_ENDPOINTS
    };
});
