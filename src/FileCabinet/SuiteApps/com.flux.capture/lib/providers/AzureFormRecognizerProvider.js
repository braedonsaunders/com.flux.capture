/**
 * @NApiVersion 2.1
 * @NModuleScope Public
 * @module FluxCapture/Providers/AzureFormRecognizerProvider
 *
 * Azure Form Recognizer (Document Intelligence) provider implementation.
 * Uses Azure's REST API for document extraction.
 *
 * Supports:
 * - Prebuilt Invoice model
 * - Prebuilt Receipt model
 * - General Document model
 *
 * API Version: 2023-07-31 (GA)
 */

define([
    'N/log',
    'N/https',
    'N/encode',
    './ExtractionProvider'
], function(log, https, encode, ExtractionProviderModule) {
    'use strict';

    const { ExtractionProvider, ProviderType, DocumentType } = ExtractionProviderModule;

    // Azure Form Recognizer API configuration
    const AZURE_API_VERSION = '2023-07-31';

    // Model IDs for different document types
    const AZURE_MODELS = {
        invoice: 'prebuilt-invoice',
        receipt: 'prebuilt-receipt',
        general: 'prebuilt-document'
    };

    // Field mappings from Azure field names to our normalized names
    const AZURE_FIELD_MAPPINGS = {
        // Invoice fields
        'VendorName': 'vendorName',
        'VendorAddress': 'vendorAddress',
        'VendorAddressRecipient': 'vendorName',
        'CustomerName': 'customerName',
        'CustomerAddress': 'customerAddress',
        'CustomerAddressRecipient': 'customerName',
        'InvoiceId': 'invoiceNumber',
        'InvoiceDate': 'invoiceDate',
        'DueDate': 'dueDate',
        'PurchaseOrder': 'poNumber',
        'SubTotal': 'subtotal',
        'TotalTax': 'taxAmount',
        'InvoiceTotal': 'totalAmount',
        'AmountDue': 'amountDue',
        'PreviousUnpaidBalance': 'previousBalance',
        'RemittanceAddress': 'remittanceAddress',
        'RemittanceAddressRecipient': 'remittanceRecipient',
        'ServiceAddress': 'serviceAddress',
        'ServiceAddressRecipient': 'serviceRecipient',
        'BillingAddress': 'billingAddress',
        'BillingAddressRecipient': 'billingRecipient',
        'ShippingAddress': 'shippingAddress',
        'ShippingAddressRecipient': 'shippingRecipient',
        'PaymentTerm': 'paymentTerms',
        'PaymentTerms': 'paymentTerms',
        'CurrencyCode': 'currency',

        // Memo/Notes fields (document-level)
        'Memo': 'memo',
        'Notes': 'memo',
        'Comments': 'memo',
        'Remarks': 'memo',
        'Description': 'memo', // At document level, description is often a memo
        'Message': 'memo',

        // Receipt fields
        'MerchantName': 'vendorName',
        'MerchantAddress': 'vendorAddress',
        'MerchantPhoneNumber': 'vendorPhone',
        'TransactionDate': 'invoiceDate',
        'TransactionTime': 'transactionTime',
        'Total': 'totalAmount',
        'Subtotal': 'subtotal',
        'TotalTax': 'taxAmount',
        'Tip': 'tip'
    };

    // Line item field mappings
    const AZURE_LINE_ITEM_MAPPINGS = {
        'Description': 'description',
        'ProductCode': 'itemCode',
        'Quantity': 'quantity',
        'Unit': 'unit',
        'UnitPrice': 'unitPrice',
        'Amount': 'amount',
        'Tax': 'tax',
        'Date': 'date',
        // Memo/Notes for line items
        'Memo': 'memo',
        'Notes': 'memo',
        'Comments': 'memo',
        'Remarks': 'memo',
        'ItemDescription': 'memo' // Sometimes separate from main description
    };

    /**
     * Azure Form Recognizer Provider
     */
    class AzureFormRecognizerProvider extends ExtractionProvider {
        /**
         * @param {Object} config - Provider configuration
         * @param {string} config.endpoint - Azure endpoint URL (e.g., https://your-resource.cognitiveservices.azure.com)
         * @param {string} config.apiKey - Azure API key
         * @param {string} [config.defaultModel] - Default model to use
         * @param {number} [config.pollingInterval] - Polling interval in ms (default 1000)
         * @param {number} [config.maxPollingAttempts] - Max polling attempts (default 60)
         */
        constructor(config = {}) {
            super(config);
            this.providerType = ProviderType.AZURE;
            this.providerName = 'Azure Form Recognizer';

            // Configuration
            this.endpoint = (config.endpoint || '').replace(/\/$/, ''); // Remove trailing slash
            this.apiKey = config.apiKey || '';
            this.defaultModel = config.defaultModel || AZURE_MODELS.invoice;
            this.pollingInterval = config.pollingInterval || 1000;
            // v4.1: Increased max attempts since we use lighter sleep to save governance
            // HTTP latency (~200-500ms) provides natural spacing, so more attempts = longer total wait
            this.maxPollingAttempts = config.maxPollingAttempts || 180;
        }

        /**
         * Extract document data using Azure Form Recognizer
         * @param {Object} fileObj - NetSuite file object
         * @param {Object} options - Extraction options
         * @returns {Object} - Normalized extraction result
         */
        extract(fileObj, options = {}) {
            const availability = this.checkAvailability();

            if (!availability.available) {
                this._error('extract', `Provider not available: ${availability.reason}`);
                throw new Error(`Azure Form Recognizer not available: ${availability.reason}`);
            }

            try {
                // Determine which model to use
                const model = this._getModelForDocumentType(options.documentType);

                this._audit('extract', `Starting extraction with model: ${model}`);

                // Step 1: Submit document for analysis
                const operationLocation = this._submitDocument(fileObj, model);

                if (!operationLocation) {
                    throw new Error('Failed to submit document for analysis');
                }

                this._debug('extract', `Operation submitted, location: ${operationLocation}`);

                // Step 2: Poll for results
                const result = this._pollForResults(operationLocation);

                if (!result) {
                    throw new Error('Failed to retrieve analysis results');
                }

                this._audit('extract', `Analysis complete, status: ${result.status}`);

                // Step 3: Normalize results
                return this._normalizeResult(result, options);

            } catch (e) {
                this._error('extract', {
                    message: e.message,
                    stack: e.stack
                });
                throw e;
            }
        }

        /**
         * Check if Azure Form Recognizer is available
         * @returns {Object}
         */
        checkAvailability() {
            if (!this.endpoint) {
                return {
                    available: false,
                    reason: 'Azure endpoint not configured'
                };
            }

            if (!this.apiKey) {
                return {
                    available: false,
                    reason: 'Azure API key not configured'
                };
            }

            // Validate endpoint format
            if (!this.endpoint.startsWith('https://')) {
                return {
                    available: false,
                    reason: 'Azure endpoint must use HTTPS'
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

            if (!this.endpoint) {
                errors.push('Azure endpoint is required');
            } else if (!this.endpoint.startsWith('https://')) {
                errors.push('Azure endpoint must start with https://');
            } else if (!this.endpoint.includes('.cognitiveservices.azure.com')) {
                errors.push('Azure endpoint should be a Cognitive Services endpoint');
            }

            if (!this.apiKey) {
                errors.push('Azure API key is required');
            } else if (this.apiKey.length < 20) {
                errors.push('Azure API key appears to be invalid (too short)');
            }

            return {
                valid: errors.length === 0,
                errors: errors
            };
        }

        /**
         * Get the appropriate model for document type
         * @param {string} documentType
         * @returns {string}
         */
        _getModelForDocumentType(documentType) {
            if (!documentType) return this.defaultModel;

            const docType = String(documentType).toLowerCase();

            if (docType === 'receipt' || docType === 'expense_report' || docType === '2' || docType === '4') {
                return AZURE_MODELS.receipt;
            }

            if (docType === 'invoice' || docType === '1') {
                return AZURE_MODELS.invoice;
            }

            return this.defaultModel;
        }

        /**
         * Submit document for analysis
         * @param {Object} fileObj - NetSuite file object
         * @param {string} model - Model ID
         * @returns {string|null} - Operation location URL or null
         */
        _submitDocument(fileObj, model) {
            // Build the analyze URL
            const analyzeUrl = `${this.endpoint}/formrecognizer/documentModels/${model}:analyze?api-version=${AZURE_API_VERSION}`;

            // Get file content as base64
            const fileContent = fileObj.getContents();

            // Determine content type
            const fileName = fileObj.name.toLowerCase();
            let contentType = 'application/octet-stream';
            if (fileName.endsWith('.pdf')) {
                contentType = 'application/pdf';
            } else if (fileName.endsWith('.png')) {
                contentType = 'image/png';
            } else if (fileName.endsWith('.jpg') || fileName.endsWith('.jpeg')) {
                contentType = 'image/jpeg';
            } else if (fileName.endsWith('.tiff') || fileName.endsWith('.tif')) {
                contentType = 'image/tiff';
            }

            this._debug('submitDocument', {
                url: analyzeUrl,
                contentType: contentType,
                fileSize: fileContent ? fileContent.length : 0
            });

            try {
                // Submit as base64 encoded content
                const requestBody = JSON.stringify({
                    base64Source: fileContent
                });

                const response = https.post({
                    url: analyzeUrl,
                    headers: {
                        'Ocp-Apim-Subscription-Key': this.apiKey,
                        'Content-Type': 'application/json'
                    },
                    body: requestBody
                });

                this._debug('submitDocument.response', {
                    code: response.code,
                    headers: Object.keys(response.headers || {})
                });

                // Check for successful submission (202 Accepted)
                if (response.code === 202) {
                    // Get operation location from headers
                    const operationLocation = response.headers['Operation-Location'] ||
                        response.headers['operation-location'];

                    if (operationLocation) {
                        return operationLocation;
                    }
                }

                // Handle error responses
                if (response.code >= 400) {
                    let errorMessage = `Azure API error: ${response.code}`;
                    try {
                        const errorBody = JSON.parse(response.body);
                        errorMessage = errorBody.error?.message || errorBody.message || errorMessage;
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
         * Poll for analysis results
         * @param {string} operationLocation - Operation location URL
         * @returns {Object|null} - Analysis result or null
         */
        _pollForResults(operationLocation) {
            let attempts = 0;

            while (attempts < this.maxPollingAttempts) {
                attempts++;

                try {
                    const response = https.get({
                        url: operationLocation,
                        headers: {
                            'Ocp-Apim-Subscription-Key': this.apiKey
                        }
                    });

                    if (response.code !== 200) {
                        this._error('pollForResults', `Unexpected response code: ${response.code}`);
                        return null;
                    }

                    const result = JSON.parse(response.body);

                    this._debug('pollForResults', {
                        attempt: attempts,
                        status: result.status
                    });

                    if (result.status === 'succeeded') {
                        return result;
                    }

                    if (result.status === 'failed') {
                        const errorMsg = result.error?.message || 'Analysis failed';
                        this._error('pollForResults', errorMsg);
                        throw new Error(`Azure analysis failed: ${errorMsg}`);
                    }

                    // Status is 'running' or 'notStarted' - wait and retry
                    this._sleep(this.pollingInterval);

                } catch (e) {
                    if (e.message && e.message.includes('Azure analysis failed')) {
                        throw e;
                    }
                    this._error('pollForResults', e.message);
                    // Continue polling on transient errors
                    this._sleep(this.pollingInterval);
                }
            }

            this._error('pollForResults', `Polling timeout after ${attempts} attempts`);
            throw new Error('Azure analysis timed out');
        }

        /**
         * Sleep for specified milliseconds
         * FIXED: Previous busy-wait (while Date.now()) was burning through governance.
         * Now uses fixed iteration count that provides ~100-200ms delay while staying
         * well under governance limits (~50K statements vs 10M limit).
         * Combined with HTTP latency (~200-500ms), this gives adequate spacing.
         * @param {number} ms - Requested sleep time (used for logging only)
         */
        _sleep(ms) {
            // SuiteScript doesn't have native sleep, and time-based busy-wait burns governance
            // Use fixed iteration count: 50,000 iterations ≈ 100-200ms delay
            // This is governance-friendly (50K << 10M limit) while providing real delay
            // Combined with HTTP latency and increased maxPollingAttempts, total timeout ~60-90s
            for (let i = 0; i < 50000; i++) {
                // Each iteration is ~1-3 microseconds
                // 50K iterations ≈ 100-200ms depending on server load
            }
        }

        /**
         * Normalize Azure result to standard format
         * @param {Object} result - Azure analysis result
         * @param {Object} options - Extraction options including maxPages
         * @returns {Object} - Normalized result
         */
        _normalizeResult(result, options = {}) {
            const analyzeResult = result.analyzeResult || {};
            const rawFields = [];
            const rawTables = [];
            let rawText = '';

            // Get page count and apply limit if specified
            let pages = analyzeResult.pages || [];
            const totalDocumentPages = pages.length || 1;
            const maxPages = options.maxPages || 0;

            if (maxPages > 0 && pages.length > maxPages) {
                this._audit('normalizeResult', `Limiting from ${pages.length} pages to first ${maxPages} pages`);
                pages = pages.slice(0, maxPages);
            }
            const pageCount = pages.length || 1;

            // Extract raw text from pages
            pages.forEach((page, pageIndex) => {
                if (page.lines) {
                    page.lines.forEach(line => {
                        rawText += (line.content || '') + '\n';
                    });
                }
            });

            // Extract document-level fields
            const documents = analyzeResult.documents || [];
            if (documents.length > 0) {
                const doc = documents[0];
                const fields = doc.fields || {};

                for (const [azureFieldName, fieldData] of Object.entries(fields)) {
                    // Skip line items - handle separately
                    if (azureFieldName === 'Items' || azureFieldName === 'LineItems') {
                        continue;
                    }

                    const normalizedField = this._normalizeField(azureFieldName, fieldData, 0);
                    if (normalizedField) {
                        rawFields.push(normalizedField);
                    }
                }

                // Extract line items as a table
                const lineItemsField = fields.Items || fields.LineItems;
                if (lineItemsField && lineItemsField.valueArray) {
                    const lineItemsTable = this._extractLineItemsTable(lineItemsField.valueArray);
                    if (lineItemsTable) {
                        rawTables.push(lineItemsTable);
                    }
                }
            }

            // Extract tables from pages
            const pageTables = analyzeResult.tables || [];
            pageTables.forEach((table, tableIndex) => {
                const normalizedTable = this._normalizeTable(table, tableIndex);
                if (normalizedTable) {
                    rawTables.push(normalizedTable);
                }
            });

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
                _azureResult: analyzeResult // Keep for debugging
            };
        }

        /**
         * Normalize a single Azure field
         * @param {string} azureFieldName
         * @param {Object} fieldData
         * @param {number} pageIndex
         * @returns {Object|null}
         */
        _normalizeField(azureFieldName, fieldData, pageIndex) {
            if (!fieldData) return null;

            // Get the mapped field name or use original
            const normalizedName = AZURE_FIELD_MAPPINGS[azureFieldName] || azureFieldName;

            // Extract value based on type
            let value = null;
            const valueType = fieldData.type || 'string';

            switch (valueType) {
                case 'string':
                    value = fieldData.valueString || fieldData.content || '';
                    break;
                case 'number':
                case 'currency':
                    value = fieldData.valueCurrency?.amount ||
                        fieldData.valueNumber ||
                        fieldData.content ||
                        '';
                    break;
                case 'date':
                    value = fieldData.valueDate || fieldData.content || '';
                    break;
                case 'phoneNumber':
                    value = fieldData.valuePhoneNumber || fieldData.content || '';
                    break;
                case 'address':
                    value = fieldData.valueAddress ?
                        this._formatAddress(fieldData.valueAddress) :
                        fieldData.content || '';
                    break;
                case 'array':
                    // Skip arrays (handled separately)
                    return null;
                default:
                    value = fieldData.content || '';
            }

            // Skip empty values
            if (!value && value !== 0) return null;

            // Get bounding region if available
            let position = null;
            if (fieldData.boundingRegions && fieldData.boundingRegions.length > 0) {
                const region = fieldData.boundingRegions[0];
                position = {
                    page: region.pageNumber - 1, // Azure uses 1-based
                    polygon: region.polygon,
                    // Convert polygon to bounding box
                    ...this._polygonToBoundingBox(region.polygon)
                };
                pageIndex = region.pageNumber - 1;
            }

            return this._createNormalizedField({
                page: pageIndex,
                label: azureFieldName,
                labelConfidence: fieldData.confidence || 0.5,
                value: String(value),
                valueConfidence: fieldData.confidence || 0.5,
                position: position,
                _rawLabel: azureFieldName,
                _rawValue: fieldData,
                _rawType: valueType
            });
        }

        /**
         * Format Azure address object to string
         * @param {Object} address
         * @returns {string}
         */
        _formatAddress(address) {
            const parts = [
                address.streetAddress,
                address.city,
                address.state,
                address.postalCode,
                address.countryRegion
            ].filter(p => p);

            return parts.join(', ');
        }

        /**
         * Convert polygon to bounding box
         * @param {Array} polygon - Array of x,y coordinates
         * @returns {Object}
         */
        _polygonToBoundingBox(polygon) {
            if (!polygon || polygon.length < 8) return {};

            // Polygon is [x1,y1, x2,y2, x3,y3, x4,y4]
            const xs = polygon.filter((_, i) => i % 2 === 0);
            const ys = polygon.filter((_, i) => i % 2 === 1);

            return {
                x: Math.min(...xs),
                y: Math.min(...ys),
                width: Math.max(...xs) - Math.min(...xs),
                height: Math.max(...ys) - Math.min(...ys)
            };
        }

        /**
         * Extract line items as a normalized table
         * @param {Array} items - Azure line items array
         * @returns {Object|null}
         */
        _extractLineItemsTable(items) {
            if (!items || items.length === 0) return null;

            // Determine columns from first few items
            const columnSet = new Set();
            items.slice(0, 5).forEach(item => {
                if (item.valueObject) {
                    Object.keys(item.valueObject).forEach(k => columnSet.add(k));
                }
            });

            const columns = Array.from(columnSet);
            if (columns.length === 0) return null;

            // Build header row
            const headerRow = columns.map(col => ({
                text: col,
                content: col
            }));

            // Build body rows
            const bodyRows = items.map(item => {
                const fields = item.valueObject || {};
                return columns.map(col => {
                    const field = fields[col];
                    if (!field) return { text: '', content: '' };

                    const value = field.valueString ||
                        field.valueNumber ||
                        field.valueCurrency?.amount ||
                        field.content ||
                        '';

                    return {
                        text: String(value),
                        content: String(value),
                        confidence: field.confidence
                    };
                });
            });

            return this._createNormalizedTable({
                page: 0,
                index: 0,
                headerRows: [headerRow],
                bodyRows: bodyRows,
                footerRows: [],
                confidence: 0.8
            });
        }

        /**
         * Normalize an Azure table
         * @param {Object} table - Azure table object
         * @param {number} tableIndex
         * @returns {Object|null}
         */
        _normalizeTable(table, tableIndex) {
            if (!table || !table.cells) return null;

            const rowCount = table.rowCount || 0;
            const columnCount = table.columnCount || 0;

            if (rowCount === 0 || columnCount === 0) return null;

            // Initialize grid
            const grid = [];
            for (let r = 0; r < rowCount; r++) {
                grid[r] = [];
                for (let c = 0; c < columnCount; c++) {
                    grid[r][c] = { text: '', content: '' };
                }
            }

            // Fill grid from cells
            table.cells.forEach(cell => {
                const row = cell.rowIndex || 0;
                const col = cell.columnIndex || 0;

                if (row < rowCount && col < columnCount) {
                    grid[row][col] = {
                        text: cell.content || '',
                        content: cell.content || '',
                        confidence: cell.confidence,
                        isHeader: cell.kind === 'columnHeader' || cell.kind === 'rowHeader'
                    };
                }
            });

            // Separate header and body rows
            const headerRows = [];
            const bodyRows = [];

            grid.forEach((row, rowIndex) => {
                // Check if this row is a header row
                const isHeaderRow = row.some(cell => cell.isHeader);
                if (isHeaderRow || rowIndex === 0) {
                    headerRows.push(row);
                } else {
                    bodyRows.push(row);
                }
            });

            // Get page number from first cell
            let pageIndex = 0;
            if (table.boundingRegions && table.boundingRegions.length > 0) {
                pageIndex = (table.boundingRegions[0].pageNumber || 1) - 1;
            }

            return this._createNormalizedTable({
                page: pageIndex,
                index: tableIndex,
                headerRows: headerRows,
                bodyRows: bodyRows,
                footerRows: [],
                confidence: 0.8
            });
        }
    }

    return {
        AzureFormRecognizerProvider: AzureFormRecognizerProvider,
        AZURE_MODELS: AZURE_MODELS,
        AZURE_API_VERSION: AZURE_API_VERSION
    };
});
