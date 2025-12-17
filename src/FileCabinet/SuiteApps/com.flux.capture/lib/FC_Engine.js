/**
 * @NApiVersion 2.1
 * @NModuleScope Public
 * @module FluxCapture/Engine
 *
 * Flux Capture - Intelligent Document Processing Engine
 * Core library for document extraction, vendor matching, and anomaly detection
 *
 * Uses N/documentCapture module (NetSuite 2025.2+) with OCI Document Understanding
 */

define([
    'N/file',
    'N/record',
    'N/search',
    'N/query',
    'N/runtime',
    'N/log',
    'N/format',
    'N/encode',
    'N/documentCapture'
], function(file, record, search, query, runtime, log, format, encode, documentCapture) {

    'use strict';

    // N/documentCapture module reference (loaded via AMD)
    const docCaptureModule = documentCapture;

    // ==================== Constants ====================

    const DocStatus = Object.freeze({
        PENDING: 1,
        PROCESSING: 2,
        EXTRACTED: 3,
        NEEDS_REVIEW: 4,
        REJECTED: 5,
        COMPLETED: 6,
        ERROR: 7
    });

    const DocumentType = Object.freeze({
        INVOICE: 1,
        RECEIPT: 2,
        CREDIT_MEMO: 3,
        EXPENSE_REPORT: 4,
        PURCHASE_ORDER: 5,
        UNKNOWN: 6
    });

    const DocumentTypeLabels = Object.freeze({
        [DocumentType.INVOICE]: 'Invoice',
        [DocumentType.RECEIPT]: 'Receipt',
        [DocumentType.CREDIT_MEMO]: 'Credit Memo',
        [DocumentType.EXPENSE_REPORT]: 'Expense Report',
        [DocumentType.PURCHASE_ORDER]: 'Purchase Order',
        [DocumentType.UNKNOWN]: 'Unknown'
    });

    const ConfidenceLevel = Object.freeze({
        HIGH: { min: 0.85, label: 'High', color: '#22c55e' },
        MEDIUM: { min: 0.60, label: 'Medium', color: '#f59e0b' },
        LOW: { min: 0, label: 'Low', color: '#ef4444' }
    });

    const SUPPORTED_FILE_TYPES = ['pdf', 'png', 'jpg', 'jpeg', 'tiff', 'tif'];

    // Field label mappings for OCI Document Understanding
    // Maps N/documentCapture field label names to our internal field names
    // Based on NetSuite's AI extraction which returns standardized field names
    const FIELD_LABEL_MAPPINGS = {
        // Primary mappings (exact names from N/documentCapture)
        vendorName: ['vendorname', 'vendor name', 'vendor', 'suppliername', 'supplier name', 'supplier', 'company name', 'company', 'from', 'bill from', 'sold by', 'merchant'],
        vendorAddress: ['vendoraddress', 'vendor address', 'supplier address', 'company address', 'address', 'bill from address', 'merchant address'],
        invoiceNumber: ['invoiceid', 'invoice id', 'billnumber', 'bill number', 'invoice number', 'invoice no', 'invoice #', 'document number', 'doc no', 'reference', 'ref', 'receipt number'],
        invoiceDate: ['invoicedate', 'invoice date', 'date', 'document date', 'bill date', 'issue date', 'issued', 'transaction date', 'receipt date'],
        dueDate: ['duedate', 'due date', 'payment due', 'pay by', 'due by', 'payment date'],
        poNumber: ['purchaseorder', 'purchase order', 'po number', 'po #', 'po', 'order number', 'order #'],
        subtotal: ['subtotal', 'sub total', 'sub-total', 'net amount', 'net total', 'amount before tax'],
        taxAmount: ['taxamount', 'tax amount', 'tax', 'vat', 'gst', 'sales tax', 'tax total', 'total tax'],
        totalAmount: ['totalamount', 'total amount', 'total', 'amount due', 'grand total', 'balance due', 'total due', 'invoice total', 'amount', 'total paid'],
        currency: ['currency', 'currency code']
    };

    // ==================== Flux Capture Engine ====================

    class FluxCaptureEngine {
        constructor(options = {}) {
            this.enableLearning = options.enableLearning !== false;
            this.enableFraudDetection = options.enableFraudDetection !== false;
            this.vendorCache = null;
            this.docCaptureModule = null;
        }

        /**
         * Process a document file and extract data
         * @param {number} fileId - File Cabinet file ID
         * @param {Object} options - Processing options
         * @returns {Object} - Extraction results
         */
        processDocument(fileId, options = {}) {
            const startTime = Date.now();

            try {
                const fileObj = file.load({ id: fileId });
                this._validateFile(fileObj);

                log.audit('FluxCapture.processDocument', `Processing file: ${fileObj.name} (${fileObj.size} bytes)`);

                // Extract text and structure from document using N/documentCapture
                const extractionResult = this._extractDocumentData(fileObj, options);

                // Match vendor from extracted data
                const vendorMatch = this._matchVendor(extractionResult.fields.vendorName);

                // Detect anomalies if enabled
                let anomalies = [];
                if (this.enableFraudDetection) {
                    anomalies = this._detectAnomalies(extractionResult, vendorMatch);
                }

                // Validate amounts
                const amountValidation = this._validateAmounts(extractionResult);

                // Calculate confidence scores
                const confidence = this._calculateConfidence(extractionResult, vendorMatch);

                const processingTime = Date.now() - startTime;
                log.audit('FluxCapture.processDocument', `Completed in ${processingTime}ms. Confidence: ${confidence.overall}%`);

                return {
                    success: true,
                    extraction: {
                        documentType: extractionResult.documentType || options.documentType || DocumentType.INVOICE,
                        fields: extractionResult.fields,
                        lineItems: extractionResult.lineItems,
                        vendorMatch: vendorMatch,
                        anomalies: anomalies,
                        confidence: confidence,
                        amountValidation: amountValidation,
                        rawText: extractionResult.rawText,
                        pageCount: extractionResult.pageCount,
                        processingTime: processingTime
                    }
                };

            } catch (error) {
                log.error('FluxCaptureEngine.processDocument', { message: error.message, stack: error.stack });
                return {
                    success: false,
                    error: error.message
                };
            }
        }

        /**
         * Validate file for processing
         */
        _validateFile(fileObj) {
            const fileName = fileObj.name.toLowerCase();
            const extension = fileName.split('.').pop();

            if (!SUPPORTED_FILE_TYPES.includes(extension)) {
                throw new Error(`Unsupported file type: ${extension}. Supported: ${SUPPORTED_FILE_TYPES.join(', ')}`);
            }

            // N/documentCapture supports files up to 5 pages for synchronous processing
            if (fileObj.size > 20971520) { // 20MB
                throw new Error('File size exceeds 20MB limit');
            }
        }

        /**
         * Get the N/documentCapture module (already loaded via AMD define)
         * @returns {Object} The documentCapture module or null if unavailable
         */
        _getDocCaptureModule() {
            // Module is loaded via define() at top of file
            if (docCaptureModule) {
                log.debug('N/documentCapture', 'Module available via AMD');
                return docCaptureModule;
            }
            log.warn('N/documentCapture', 'Module not available');
            return null;
        }

        /**
         * Extract document data using N/documentCapture (OCI Document Understanding)
         * @param {file.File} fileObj - The file object to process
         * @param {Object} options - Processing options
         * @returns {Object} Normalized extraction result
         */
        _extractDocumentData(fileObj, options) {
            const docCapture = this._getDocCaptureModule();

            if (!docCapture) {
                log.audit('FluxCapture', 'N/documentCapture not available, using fallback');
                return this._simulateExtraction(fileObj);
            }

            try {
                // Determine document type for optimization
                let captureDocType = docCapture.DocumentType.INVOICE;
                if (options.documentType === DocumentType.RECEIPT ||
                    options.documentType === DocumentType.EXPENSE_REPORT ||
                    options.documentType === 'RECEIPT' ||
                    options.documentType === 'EXPENSE_REPORT') {
                    captureDocType = docCapture.DocumentType.RECEIPT;
                }

                // Build extraction options
                const extractOptions = {
                    file: fileObj,
                    documentType: captureDocType,
                    features: [
                        docCapture.Feature.FIELD_EXTRACTION,
                        docCapture.Feature.TABLE_EXTRACTION,
                        docCapture.Feature.TEXT_EXTRACTION
                    ]
                };

                // Add language if specified
                if (options.language && docCapture.Language[options.language]) {
                    extractOptions.language = docCapture.Language[options.language];
                }

                // Set timeout for larger documents (minimum 30000ms)
                if (options.timeout) {
                    extractOptions.timeout = Math.max(30000, options.timeout);
                }

                log.debug('FluxCapture.extract', `Calling documentToStructure with type: ${captureDocType}`);

                // Call the OCI Document Understanding API
                const result = docCapture.documentToStructure(extractOptions);

                log.debug('FluxCapture.extract', `Received result with ${result.pages ? result.pages.length : 0} pages`);

                return this._normalizeExtractionResult(result, docCapture);

            } catch (e) {
                log.error('FluxCapture._extractDocumentData', {
                    message: e.message,
                    stack: e.stack,
                    name: e.name
                });

                // Check for specific error types
                if (e.message && e.message.includes('usage')) {
                    throw new Error('Document capture usage limit reached. Please try again later or configure OCI credentials.');
                }

                // Fall back to simulation for development/testing
                log.audit('FluxCapture', `Extraction failed, using fallback: ${e.message}`);
                return this._simulateExtraction(fileObj);
            }
        }

        /**
         * Normalize extraction results from N/documentCapture to standard format
         *
         * N/documentCapture returns:
         * - result.pages[] - array of Page objects
         * - page.fields[] - array of Field objects with label (FieldLabel) and value (FieldValue)
         * - page.tables[] - array of Table objects with headerRows, bodyRows, footerRows
         * - page.lines[] - array of Line objects
         * - page.getText() - method to get all text on page
         *
         * Field structure:
         * - field.label: FieldLabel with .name (string) and .confidence (number)
         * - field.value: FieldValue - could be direct value or object with .text
         * - field.type: string (date, number, string)
         *
         * Table structure:
         * - table.headerRows: array of header rows
         * - table.bodyRows: array of data rows (TableRow objects)
         * - table.footerRows: array of footer rows (totals)
         * - Each row contains .cells[] array
         * - Each cell has .text (string) and .confidence (number)
         *
         * @param {documentCapture.Document} result - The raw result from documentToStructure
         * @param {Object} docCapture - The documentCapture module reference
         * @returns {Object} Normalized extraction result
         */
        _normalizeExtractionResult(result, docCapture) {
            const fields = {
                vendorName: null,
                vendorAddress: null,
                invoiceNumber: null,
                invoiceDate: null,
                dueDate: null,
                poNumber: null,
                subtotal: 0,
                taxAmount: 0,
                totalAmount: 0,
                currency: 'USD'
            };

            let rawText = '';
            let allLineItems = [];
            const pageCount = result.pages ? result.pages.length : 1;
            const fieldConfidences = {};

            // Process each page
            if (result.pages && result.pages.length > 0) {
                result.pages.forEach((page, pageIndex) => {
                    // Extract text from page
                    if (typeof page.getText === 'function') {
                        rawText += page.getText() + '\n';
                    } else if (page.lines) {
                        // Fallback: concatenate lines
                        page.lines.forEach(line => {
                            const lineText = line.text || (line.words ? line.words.map(w => w.text || w).join(' ') : '');
                            if (lineText) rawText += lineText + '\n';
                        });
                    }

                    // Process extracted fields
                    if (page.fields && page.fields.length > 0) {
                        page.fields.forEach(field => {
                            // Extract label name - could be field.label.name or field.label directly
                            const labelName = this._extractLabelName(field.label);
                            const labelConfidence = this._extractLabelConfidence(field.label);

                            // Extract field value - could be field.value.text, field.value directly, etc.
                            const fieldValue = this._extractFieldValue(field.value);

                            // Map to our internal field name
                            const mappedField = this._mapFieldLabel(labelName);

                            if (mappedField && fieldValue) {
                                // Parse the value based on field type
                                const parsedValue = this._parseFieldValue(mappedField, fieldValue);

                                if (parsedValue !== null && parsedValue !== undefined) {
                                    // Only overwrite if we don't have a value yet or this has higher confidence
                                    const existingConfidence = fieldConfidences[mappedField] || 0;
                                    const newConfidence = labelConfidence || 0.5;

                                    if (!fields[mappedField] || newConfidence > existingConfidence) {
                                        fields[mappedField] = parsedValue;
                                        fieldConfidences[mappedField] = newConfidence;
                                    }
                                }
                            }

                            log.debug('FluxCapture.field', `Page ${pageIndex + 1}: "${labelName}" = "${fieldValue}" (conf: ${labelConfidence || 'N/A'})`);
                        });
                    }

                    // Process tables for line items
                    if (page.tables && page.tables.length > 0) {
                        page.tables.forEach((table, tableIndex) => {
                            log.debug('FluxCapture.table', `Page ${pageIndex + 1}, Table ${tableIndex + 1}: ${table.bodyRows ? table.bodyRows.length : 0} body rows`);
                            const tableItems = this._extractLineItemsFromTable(table);
                            if (tableItems.length > 0) {
                                allLineItems = allLineItems.concat(tableItems);
                            }
                        });
                    }
                });
            }

            // Detect document type from text content
            const documentType = this._detectDocumentType({ text: rawText });

            log.audit('FluxCapture.normalize', `Extracted ${Object.keys(fields).filter(k => fields[k]).length} fields, ${allLineItems.length} line items from ${pageCount} pages`);

            return {
                documentType: documentType,
                fields: fields,
                fieldConfidences: fieldConfidences,
                lineItems: allLineItems,
                rawText: rawText.trim(),
                pageCount: pageCount,
                mimeType: result.mimeType || null
            };
        }

        /**
         * Extract label name from a FieldLabel object or string
         * @param {Object|string} label - The label from N/documentCapture
         * @returns {string} The label name
         */
        _extractLabelName(label) {
            if (!label) return '';
            if (typeof label === 'string') return label;
            if (typeof label === 'object') {
                // FieldLabel object has .name property
                return label.name || label.text || label.label || String(label);
            }
            return String(label);
        }

        /**
         * Extract confidence from a FieldLabel object
         * @param {Object|string} label - The label from N/documentCapture
         * @returns {number} The confidence (0-1)
         */
        _extractLabelConfidence(label) {
            if (!label || typeof label !== 'object') return 0.5;
            return label.confidence || 0.5;
        }

        /**
         * Extract value from a FieldValue object or string
         * @param {Object|string|number} value - The value from N/documentCapture
         * @returns {string} The value as string
         */
        _extractFieldValue(value) {
            if (value === null || value === undefined) return null;
            if (typeof value === 'string' || typeof value === 'number') return String(value);
            if (typeof value === 'object') {
                // FieldValue object might have .text, .value, or other properties
                return value.text || value.value || value.content || String(value);
            }
            return String(value);
        }

        /**
         * Map an OCR field label to our internal field name
         * @param {string} label - The field label from OCR
         * @returns {string|null} The internal field name or null if not recognized
         */
        _mapFieldLabel(label) {
            if (!label) return null;

            const normalizedLabel = label.toLowerCase().trim();

            for (const [fieldName, labels] of Object.entries(FIELD_LABEL_MAPPINGS)) {
                if (labels.some(l => normalizedLabel.includes(l) || l.includes(normalizedLabel))) {
                    return fieldName;
                }
            }

            return null;
        }

        /**
         * Parse a field value based on its type
         * @param {string} fieldName - The internal field name
         * @param {string} rawValue - The raw value from OCR
         * @returns {*} The parsed value
         */
        _parseFieldValue(fieldName, rawValue) {
            if (!rawValue) return null;

            const value = String(rawValue).trim();

            // Date fields
            if (fieldName === 'invoiceDate' || fieldName === 'dueDate') {
                return this._parseDate(value);
            }

            // Amount fields
            if (['subtotal', 'taxAmount', 'totalAmount'].includes(fieldName)) {
                return this._parseAmount(value);
            }

            // String fields
            return value;
        }

        /**
         * Parse a date string to a Date object
         * @param {string} value - The date string
         * @returns {Date|null} The parsed date or null
         */
        _parseDate(value) {
            if (!value) return null;

            try {
                // Try NetSuite format first
                return format.parse({ value: value, type: format.Type.DATE });
            } catch (e) {
                // Try common date formats
                const datePatterns = [
                    /(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})/,  // MM/DD/YYYY or DD/MM/YYYY
                    /(\d{4})[\/\-](\d{1,2})[\/\-](\d{1,2})/,    // YYYY-MM-DD
                    /(\w+)\s+(\d{1,2}),?\s+(\d{4})/              // Month DD, YYYY
                ];

                for (const pattern of datePatterns) {
                    const match = value.match(pattern);
                    if (match) {
                        try {
                            const parsed = new Date(value);
                            if (!isNaN(parsed.getTime())) {
                                return parsed;
                            }
                        } catch (e2) {
                            continue;
                        }
                    }
                }

                return null;
            }
        }

        /**
         * Parse an amount string to a number
         * @param {string} value - The amount string
         * @returns {number} The parsed amount
         */
        _parseAmount(value) {
            if (!value) return 0;

            // Remove currency symbols and thousands separators
            const cleaned = String(value)
                .replace(/[^0-9.,\-]/g, '')  // Keep only digits, dots, commas, minus
                .replace(/,(\d{3})/g, '$1')   // Remove thousands separator commas
                .replace(/,/g, '.');          // Convert remaining commas to dots (European format)

            const amount = parseFloat(cleaned);
            return isNaN(amount) ? 0 : Math.round(amount * 100) / 100;
        }

        /**
         * Extract line items from a table structure
         *
         * N/documentCapture Table structure:
         * - table.headerRows: array of rows containing column headers
         * - table.bodyRows: array of TableRow objects (line item data)
         * - table.footerRows: array of rows containing totals/summaries
         * - Each row has .cells[] array
         * - Each cell has .text (string) and .confidence (number)
         *
         * @param {documentCapture.Table} table - The table object from OCR
         * @returns {Array} Array of line item objects
         */
        _extractLineItemsFromTable(table) {
            const items = [];

            if (!table) return items;

            // Helper to extract cell text from various formats
            const getCellText = (cell) => {
                if (!cell) return '';
                if (typeof cell === 'string') return cell;
                // Cell object has .text property
                return cell.text || cell.value || cell.content || String(cell);
            };

            // Helper to extract cells from a row (row might be array or have .cells property)
            const getRowCells = (row) => {
                if (!row) return [];
                if (Array.isArray(row)) return row;
                if (row.cells && Array.isArray(row.cells)) return row.cells;
                return [];
            };

            // Get headers from headerRows
            let headers = [];
            if (table.headerRows && table.headerRows.length > 0) {
                const headerRow = table.headerRows[0];
                const headerCells = getRowCells(headerRow);
                headers = headerCells.map(cell => getCellText(cell).toLowerCase().trim());
            }

            // If no headers found, try first body row as header
            if (headers.length === 0 && table.bodyRows && table.bodyRows.length > 1) {
                const firstRow = getRowCells(table.bodyRows[0]);
                const looksLikeHeader = firstRow.some(cell => {
                    const text = getCellText(cell).toLowerCase();
                    return text.includes('description') || text.includes('item') ||
                           text.includes('qty') || text.includes('amount');
                });
                if (looksLikeHeader) {
                    headers = firstRow.map(cell => getCellText(cell).toLowerCase().trim());
                    // Remove first row from body rows for processing
                    table.bodyRows = table.bodyRows.slice(1);
                }
            }

            log.debug('FluxCapture.tableHeaders', `Found ${headers.length} headers: ${headers.join(', ')}`);

            // Find column indices based on common keywords
            const findColumnIndex = (...keywords) => {
                return headers.findIndex(h =>
                    keywords.some(k => h.includes(k))
                );
            };

            const descIdx = findColumnIndex('description', 'item', 'product', 'service', 'particulars', 'name', 'details');
            const qtyIdx = findColumnIndex('qty', 'quantity', 'units', 'count', 'pcs');
            const priceIdx = findColumnIndex('price', 'rate', 'unit price', 'unit cost', 'each', 'unit');
            const amountIdx = findColumnIndex('amount', 'total', 'extended', 'line total', 'ext', 'sum');

            // Process body rows
            if (table.bodyRows && table.bodyRows.length > 0) {
                table.bodyRows.forEach((row, rowIndex) => {
                    const cells = getRowCells(row);

                    const getCellValue = (idx) => {
                        if (idx < 0 || idx >= cells.length) return null;
                        return getCellText(cells[idx]) || null;
                    };

                    const getCellNumber = (idx) => {
                        const val = getCellValue(idx);
                        if (!val) return 0;
                        return this._parseAmount(val);
                    };

                    // Get cell confidence (average of cells used)
                    const getCellConfidence = (idx) => {
                        if (idx < 0 || idx >= cells.length || !cells[idx]) return null;
                        return cells[idx].confidence || null;
                    };

                    const item = {
                        description: getCellValue(descIdx >= 0 ? descIdx : 0), // Default to first column
                        quantity: getCellNumber(qtyIdx),
                        unitPrice: getCellNumber(priceIdx),
                        amount: getCellNumber(amountIdx >= 0 ? amountIdx : cells.length - 1), // Default to last column
                        confidence: getCellConfidence(amountIdx) || table.confidence || null
                    };

                    // Filter out summary/footer rows and rows without meaningful content
                    const desc = (item.description || '').trim().toLowerCase();
                    const isSummaryRow = /^(sub\s*total|subtotal|total|tax|vat|gst|hst|pst|shipping|freight|discount|balance|amount\s*due|grand\s*total|net|gross)$/i.test(desc) ||
                                        desc.startsWith('total') || desc.startsWith('subtotal') ||
                                        desc.includes('total due') || desc.includes('amount due');

                    // Check for meaningful description (not just numbers, not too short, not summary)
                    const hasValidDescription = item.description &&
                                               item.description.trim().length >= 3 &&
                                               !/^\d+[\.,]?\d*$/.test(item.description.trim()) &&
                                               !isSummaryRow;

                    // Line item must have a valid description AND (amount > 0 OR qty > 0)
                    const isValidLineItem = hasValidDescription && (item.amount > 0 || item.quantity > 0);

                    if (isValidLineItem) {
                        // Calculate amount if missing but we have qty and price
                        if (!item.amount && item.quantity && item.unitPrice) {
                            item.amount = Math.round(item.quantity * item.unitPrice * 100) / 100;
                        }
                        items.push(item);
                        log.debug('FluxCapture.lineItem', `Row ${rowIndex + 1}: "${item.description}" x${item.quantity} @ ${item.unitPrice} = ${item.amount}`);
                    } else {
                        log.debug('FluxCapture.lineItem.skipped', `Row ${rowIndex + 1} skipped: "${item.description}" (summary: ${isSummaryRow}, validDesc: ${hasValidDescription})`);
                    }
                });
            }

            return items;
        }

        /**
         * Detect document type from text content
         * @param {Object} result - Object containing text property
         * @returns {number} Document type constant
         */
        _detectDocumentType(result) {
            const text = (result.text || '').toLowerCase();

            // Credit memo indicators
            if (text.includes('credit memo') || text.includes('credit note') ||
                text.includes('refund') || text.includes('credit adjustment')) {
                return DocumentType.CREDIT_MEMO;
            }

            // Receipt/expense indicators
            if (text.includes('receipt') || text.includes('expense') ||
                text.includes('cash register') || text.includes('thank you for your purchase')) {
                return DocumentType.RECEIPT;
            }

            // Purchase order indicators
            if (text.includes('purchase order') || text.includes('p.o.') ||
                (text.includes('order') && !text.includes('invoice'))) {
                return DocumentType.PURCHASE_ORDER;
            }

            // Default to invoice
            return DocumentType.INVOICE;
        }

        /**
         * Simulate extraction for testing/demo when N/documentCapture is unavailable
         * Attempts to extract data from filename patterns
         */
        _simulateExtraction(fileObj) {
            const fileName = fileObj.name || '';
            log.audit('FluxCapture.simulate', `Simulating extraction for: ${fileName}`);

            // Try to extract data from filename patterns
            // Common patterns: "DATE-VendorName - INVXXXXXX.pdf", "Invoice_XXXXX_Vendor.pdf", etc.
            let vendorName = null;
            let invoiceNumber = null;
            let invoiceDate = null;

            // Extract invoice number patterns: INV, INVOICE, #, etc.
            const invPatterns = [
                /INV[#\-_]?(\d+)/i,              // INV12345, INV-12345
                /INVOICE[#\-_\s]?(\d+)/i,       // INVOICE 12345
                /(?:^|[\s\-_])(\d{6,})/,        // 6+ digit numbers
                /#(\d+)/                         // #12345
            ];

            for (const pattern of invPatterns) {
                const match = fileName.match(pattern);
                if (match) {
                    invoiceNumber = match[0].replace(/^[\s\-_#]+/, '');
                    break;
                }
            }

            // Extract date patterns: MM-DD-YYYY, YYYY-MM-DD, etc.
            const datePatterns = [
                /(\d{1,2}[-\/]\d{1,2}[-\/]\d{2,4})/,  // MM-DD-YYYY or MM/DD/YYYY
                /(\d{4}[-\/]\d{1,2}[-\/]\d{1,2})/     // YYYY-MM-DD
            ];

            for (const pattern of datePatterns) {
                const match = fileName.match(pattern);
                if (match) {
                    try {
                        const parsed = new Date(match[1].replace(/-/g, '/'));
                        if (!isNaN(parsed.getTime())) {
                            invoiceDate = parsed;
                        }
                    } catch (e) { /* ignore parsing errors */ }
                    break;
                }
            }

            // Extract vendor name from filename
            // Remove common patterns and extensions
            let cleanName = fileName
                .replace(/\.(pdf|png|jpg|jpeg|tiff?)$/i, '')  // Remove extension
                .replace(/INV[#\-_]?\d+/gi, '')               // Remove invoice numbers
                .replace(/\d{1,2}[-\/]\d{1,2}[-\/]\d{2,4}/g, '') // Remove dates
                .replace(/^[A-Z][-\s]/i, '')                  // Remove leading letter codes like "O-"
                .replace(/[-_]+/g, ' ')                       // Convert separators to spaces
                .trim();

            // Split by common separators and find likely vendor name
            const parts = cleanName.split(/\s*[-–—]\s*/);
            if (parts.length > 1) {
                // Vendor is often the second or last meaningful part
                vendorName = parts.find(p => p.length > 2 && !/^\d+$/.test(p));
            } else if (cleanName.length > 2) {
                vendorName = cleanName;
            }

            // Clean up vendor name
            if (vendorName) {
                vendorName = vendorName.replace(/\s+/g, ' ').trim();
            }

            log.debug('FluxCapture.simulate', {
                fileName: fileName,
                extractedVendor: vendorName,
                extractedInvoice: invoiceNumber,
                extractedDate: invoiceDate
            });

            return {
                documentType: DocumentType.INVOICE,
                fields: {
                    vendorName: vendorName,
                    vendorAddress: null,
                    invoiceNumber: invoiceNumber,
                    invoiceDate: invoiceDate,
                    dueDate: invoiceDate ? new Date(invoiceDate.getTime() + 30 * 24 * 60 * 60 * 1000) : null, // +30 days
                    poNumber: null,
                    subtotal: 0,
                    taxAmount: 0,
                    totalAmount: 0,
                    currency: 'USD'
                },
                fieldConfidences: {
                    vendorName: vendorName ? 0.6 : 0,
                    invoiceNumber: invoiceNumber ? 0.7 : 0,
                    invoiceDate: invoiceDate ? 0.6 : 0
                },
                lineItems: [],
                rawText: '[Document capture not available - data extracted from filename]',
                pageCount: 1,
                mimeType: fileObj.fileType || null
            };
        }

        /**
         * Match vendor from extracted name using intelligent fuzzy search
         * @param {string} vendorName - The extracted vendor name
         * @returns {Object} Vendor match result with suggestions
         */
        _matchVendor(vendorName) {
            if (!vendorName) {
                return { vendorId: null, vendorName: null, confidence: 0, suggestions: [] };
            }

            const searchName = String(vendorName).toLowerCase().trim();

            // Normalize vendor name - remove common suffixes/prefixes and punctuation
            const normalizedSearch = this._normalizeVendorName(searchName);
            const searchTokens = this._tokenizeVendorName(normalizedSearch);

            // Generate search variations for fuzzy matching
            const searchVariations = this._generateSearchVariations(normalizedSearch, searchTokens);

            // Build SQL with all variations
            const likeConditions = searchVariations.map(() => 'LOWER(companyname) LIKE ?').join(' OR ');

            const sql = `
                SELECT id, companyname, entityid, email
                FROM vendor
                WHERE isinactive = 'F'
                AND (${likeConditions})
                ORDER BY companyname
                FETCH FIRST 20 ROWS ONLY
            `;

            try {
                const results = query.runSuiteQL({
                    query: sql,
                    params: searchVariations.map(v => `%${v}%`)
                });

                if (!results.results || results.results.length === 0) {
                    // Try broader search with just the first significant word
                    return this._broadVendorSearch(vendorName, searchTokens);
                }

                const candidates = results.results.map(r => ({
                    id: r.values[0],
                    companyName: r.values[1],
                    entityId: r.values[2],
                    email: r.values[3]
                }));

                // Score all candidates using fuzzy matching
                const scoredCandidates = candidates.map(c => {
                    const score = this._calculateVendorMatchScore(searchName, normalizedSearch, searchTokens, c.companyName);
                    return { ...c, score };
                }).sort((a, b) => b.score - a.score);

                const bestMatch = scoredCandidates[0];

                // Top 5 suggestions for review
                const suggestions = scoredCandidates.slice(0, 5);

                return {
                    vendorId: bestMatch.score >= 0.6 ? bestMatch.id : null,
                    vendorName: bestMatch.companyName,
                    confidence: bestMatch.score,
                    suggestions: suggestions
                };

            } catch (e) {
                log.error('FluxCapture._matchVendor', e.message);
                return { vendorId: null, vendorName: vendorName, confidence: 0, suggestions: [] };
            }
        }

        /**
         * Normalize vendor name by removing common suffixes and punctuation
         */
        _normalizeVendorName(name) {
            return name
                .toLowerCase()
                .replace(/[.,'"!?]/g, '')
                .replace(/\s*(inc\.?|llc\.?|ltd\.?|corp\.?|co\.?|company|incorporated|limited|corporation|enterprises?|services?|solutions?|group|holdings?|international|intl\.?)$/gi, '')
                .replace(/\s+/g, ' ')
                .trim();
        }

        /**
         * Tokenize vendor name into significant words
         */
        _tokenizeVendorName(name) {
            const stopWords = ['the', 'a', 'an', 'and', 'or', 'of', 'for', 'to', 'in', 'at', 'by'];
            return name.split(/\s+/)
                .filter(w => w.length > 1 && !stopWords.includes(w));
        }

        /**
         * Generate search variations for fuzzy matching
         */
        _generateSearchVariations(normalizedName, tokens) {
            const variations = [normalizedName];

            // Add individual significant tokens (for partial matches)
            tokens.forEach(token => {
                if (token.length >= 4) {
                    variations.push(token);
                    // Handle common plural/singular variations
                    if (token.endsWith('s')) {
                        variations.push(token.slice(0, -1)); // Remove trailing s
                    } else {
                        variations.push(token + 's'); // Add s
                    }
                    // Handle -tion/-tions variations
                    if (token.endsWith('tions')) {
                        variations.push(token.slice(0, -1)); // insulations -> insulation
                    } else if (token.endsWith('tion')) {
                        variations.push(token + 's'); // insulation -> insulations
                    }
                }
            });

            // First 2-3 tokens combined (company name core)
            if (tokens.length >= 2) {
                variations.push(tokens.slice(0, 2).join(' '));
                if (tokens.length >= 3) {
                    variations.push(tokens.slice(0, 3).join(' '));
                }
            }

            return [...new Set(variations)]; // Remove duplicates
        }

        /**
         * Broader vendor search when exact variations fail
         */
        _broadVendorSearch(originalName, tokens) {
            if (tokens.length === 0) {
                return { vendorId: null, vendorName: originalName, confidence: 0, suggestions: [] };
            }

            // Search for the most significant token (usually the first long word)
            const significantToken = tokens.find(t => t.length >= 4) || tokens[0];

            const sql = `
                SELECT id, companyname, entityid, email
                FROM vendor
                WHERE isinactive = 'F'
                AND LOWER(companyname) LIKE ?
                ORDER BY companyname
                FETCH FIRST 10 ROWS ONLY
            `;

            try {
                const results = query.runSuiteQL({
                    query: sql,
                    params: [`%${significantToken}%`]
                });

                if (!results.results || results.results.length === 0) {
                    return { vendorId: null, vendorName: originalName, confidence: 0, suggestions: [] };
                }

                const normalizedSearch = this._normalizeVendorName(originalName.toLowerCase());
                const searchTokens = this._tokenizeVendorName(normalizedSearch);

                const candidates = results.results.map(r => {
                    const companyName = r.values[1];
                    const score = this._calculateVendorMatchScore(originalName.toLowerCase(), normalizedSearch, searchTokens, companyName);
                    return {
                        id: r.values[0],
                        companyName,
                        entityId: r.values[2],
                        email: r.values[3],
                        score
                    };
                }).sort((a, b) => b.score - a.score);

                const bestMatch = candidates[0];

                return {
                    vendorId: bestMatch.score >= 0.55 ? bestMatch.id : null,
                    vendorName: bestMatch.companyName,
                    confidence: bestMatch.score,
                    suggestions: candidates.slice(0, 5)
                };

            } catch (e) {
                log.error('FluxCapture._broadVendorSearch', e.message);
                return { vendorId: null, vendorName: originalName, confidence: 0, suggestions: [] };
            }
        }

        /**
         * Calculate fuzzy match score between search and candidate vendor names
         */
        _calculateVendorMatchScore(searchName, normalizedSearch, searchTokens, candidateName) {
            const normalizedCandidate = this._normalizeVendorName(candidateName.toLowerCase());
            const candidateTokens = this._tokenizeVendorName(normalizedCandidate);

            // Exact match after normalization
            if (normalizedSearch === normalizedCandidate) {
                return 0.98;
            }

            // Calculate multiple similarity metrics
            const scores = [];

            // 1. Token overlap score (Jaccard-like)
            const tokenOverlap = this._calculateTokenOverlap(searchTokens, candidateTokens);
            scores.push(tokenOverlap * 0.4);

            // 2. Levenshtein-based similarity on normalized names
            const levenshteinSim = this._calculateLevenshteinSimilarity(normalizedSearch, normalizedCandidate);
            scores.push(levenshteinSim * 0.35);

            // 3. Prefix match bonus
            if (normalizedCandidate.startsWith(normalizedSearch) || normalizedSearch.startsWith(normalizedCandidate)) {
                scores.push(0.15);
            }

            // 4. Contains bonus
            if (normalizedCandidate.includes(normalizedSearch) || normalizedSearch.includes(normalizedCandidate)) {
                scores.push(0.1);
            }

            return Math.min(scores.reduce((a, b) => a + b, 0), 0.98);
        }

        /**
         * Calculate token overlap score
         */
        _calculateTokenOverlap(tokens1, tokens2) {
            if (tokens1.length === 0 || tokens2.length === 0) return 0;

            let matches = 0;
            const used = new Set();

            for (const t1 of tokens1) {
                for (let i = 0; i < tokens2.length; i++) {
                    if (used.has(i)) continue;
                    const t2 = tokens2[i];

                    // Exact token match
                    if (t1 === t2) {
                        matches += 1;
                        used.add(i);
                        break;
                    }

                    // Fuzzy token match (handles insulations vs insulation)
                    const tokenSim = this._calculateLevenshteinSimilarity(t1, t2);
                    if (tokenSim >= 0.85) {
                        matches += tokenSim;
                        used.add(i);
                        break;
                    }
                }
            }

            return matches / Math.max(tokens1.length, tokens2.length);
        }

        /**
         * Calculate Levenshtein similarity (0-1 scale)
         */
        _calculateLevenshteinSimilarity(str1, str2) {
            if (str1 === str2) return 1;
            if (str1.length === 0 || str2.length === 0) return 0;

            const len1 = str1.length;
            const len2 = str2.length;

            // Quick check: if lengths differ too much, low similarity
            if (Math.abs(len1 - len2) > Math.max(len1, len2) * 0.5) {
                return 0;
            }

            // Levenshtein distance calculation
            const matrix = [];
            for (let i = 0; i <= len1; i++) {
                matrix[i] = [i];
            }
            for (let j = 0; j <= len2; j++) {
                matrix[0][j] = j;
            }

            for (let i = 1; i <= len1; i++) {
                for (let j = 1; j <= len2; j++) {
                    const cost = str1[i - 1] === str2[j - 1] ? 0 : 1;
                    matrix[i][j] = Math.min(
                        matrix[i - 1][j] + 1,      // deletion
                        matrix[i][j - 1] + 1,      // insertion
                        matrix[i - 1][j - 1] + cost // substitution
                    );
                }
            }

            const distance = matrix[len1][len2];
            const maxLen = Math.max(len1, len2);
            return 1 - (distance / maxLen);
        }

        /**
         * Detect anomalies in extracted data
         */
        _detectAnomalies(extraction, vendorMatch) {
            const anomalies = [];
            const fields = extraction.fields;

            // Missing invoice number
            if (!fields.invoiceNumber) {
                anomalies.push({
                    type: 'missing_field',
                    field: 'invoiceNumber',
                    severity: 'medium',
                    message: 'Invoice number not detected'
                });
            }

            // Missing or zero total
            if (!fields.totalAmount || fields.totalAmount === 0) {
                anomalies.push({
                    type: 'missing_amount',
                    field: 'totalAmount',
                    severity: 'high',
                    message: 'Total amount not detected or is zero'
                });
            }

            // Vendor not found
            if (!vendorMatch.vendorId) {
                anomalies.push({
                    type: 'vendor_not_found',
                    field: 'vendorName',
                    severity: 'medium',
                    message: `Vendor "${fields.vendorName || 'Unknown'}" not found in system`
                });
            } else if (vendorMatch.confidence < 0.8) {
                anomalies.push({
                    type: 'low_vendor_confidence',
                    field: 'vendorName',
                    severity: 'low',
                    message: `Vendor match confidence is ${Math.round(vendorMatch.confidence * 100)}%`
                });
            }

            // Amount mismatch
            if (fields.subtotal && fields.taxAmount) {
                const calculated = fields.subtotal + fields.taxAmount;
                const diff = Math.abs(calculated - fields.totalAmount);
                if (fields.totalAmount > 0 && diff > 0.01 && (diff / fields.totalAmount) > 0.02) {
                    anomalies.push({
                        type: 'amount_mismatch',
                        field: 'totalAmount',
                        severity: 'medium',
                        message: `Subtotal + Tax ($${calculated.toFixed(2)}) differs from Total ($${fields.totalAmount.toFixed(2)})`
                    });
                }
            }

            // Future invoice date
            if (fields.invoiceDate) {
                const today = new Date();
                today.setHours(23, 59, 59, 999);
                if (fields.invoiceDate > today) {
                    anomalies.push({
                        type: 'future_date',
                        field: 'invoiceDate',
                        severity: 'high',
                        message: 'Invoice date is in the future'
                    });
                }
            }

            // Past due date
            if (fields.dueDate && fields.invoiceDate) {
                if (fields.dueDate < fields.invoiceDate) {
                    anomalies.push({
                        type: 'invalid_due_date',
                        field: 'dueDate',
                        severity: 'medium',
                        message: 'Due date is before invoice date'
                    });
                }
            }

            // Duplicate invoice check
            if (vendorMatch.vendorId && fields.invoiceNumber) {
                const isDuplicate = this._checkDuplicateInvoice(vendorMatch.vendorId, fields.invoiceNumber);
                if (isDuplicate) {
                    anomalies.push({
                        type: 'duplicate_invoice',
                        field: 'invoiceNumber',
                        severity: 'high',
                        message: 'Invoice number already exists for this vendor'
                    });
                }
            }

            // Benford's Law check for suspicious amounts (large values)
            if (fields.totalAmount > 10000) {
                const firstDigit = parseInt(String(Math.floor(fields.totalAmount))[0]);
                // Digits 7, 8, 9 are statistically rare as first digits
                if (firstDigit >= 7) {
                    anomalies.push({
                        type: 'benford_anomaly',
                        field: 'totalAmount',
                        severity: 'low',
                        message: 'Amount first digit pattern unusual (statistical check)'
                    });
                }
            }

            // Line items don't match total
            if (extraction.lineItems && extraction.lineItems.length > 0) {
                const lineTotal = extraction.lineItems.reduce((sum, item) => sum + (item.amount || 0), 0);
                if (fields.totalAmount > 0 && Math.abs(lineTotal - fields.totalAmount) > fields.totalAmount * 0.1) {
                    anomalies.push({
                        type: 'line_total_mismatch',
                        field: 'lineItems',
                        severity: 'low',
                        message: `Line items total ($${lineTotal.toFixed(2)}) differs significantly from invoice total`
                    });
                }
            }

            return anomalies;
        }

        /**
         * Check for duplicate invoice
         */
        _checkDuplicateInvoice(vendorId, invoiceNumber) {
            try {
                const sql = `
                    SELECT COUNT(*) as cnt
                    FROM customrecord_dm_captured_document
                    WHERE custrecord_dm_vendor = ?
                    AND LOWER(custrecord_dm_invoice_number) = LOWER(?)
                    AND custrecord_dm_status IN (${DocStatus.EXTRACTED}, ${DocStatus.NEEDS_REVIEW}, ${DocStatus.COMPLETED})
                `;
                const result = query.runSuiteQL({ query: sql, params: [vendorId, invoiceNumber] });
                return result.results[0].values[0] > 0;
            } catch (e) {
                log.debug('FluxCapture._checkDuplicateInvoice', e.message);
                return false;
            }
        }

        /**
         * Validate amounts
         */
        _validateAmounts(extraction) {
            const fields = extraction.fields;
            const lineItems = extraction.lineItems || [];

            const lineTotal = lineItems.reduce((sum, item) => sum + (item.amount || 0), 0);
            const calculatedTotal = (fields.subtotal || 0) + (fields.taxAmount || 0);

            return {
                valid: calculatedTotal === 0 || Math.abs(fields.totalAmount - calculatedTotal) < 0.02,
                extractedTotal: fields.totalAmount,
                calculatedTotal: calculatedTotal,
                lineItemsTotal: lineTotal,
                subtotal: fields.subtotal,
                taxAmount: fields.taxAmount
            };
        }

        /**
         * Calculate confidence scores
         */
        _calculateConfidence(extraction, vendorMatch) {
            const fields = extraction.fields;
            const fieldConfidences = extraction.fieldConfidences || {};

            let totalScore = 0;
            let maxScore = 0;

            const weights = {
                vendorName: 20,
                invoiceNumber: 15,
                invoiceDate: 10,
                totalAmount: 25,
                lineItems: 15,
                vendorMatch: 15
            };

            // Score each field based on presence and OCR confidence
            if (fields.vendorName) {
                const conf = fieldConfidences.vendorName || 0.7;
                totalScore += weights.vendorName * conf;
            }
            maxScore += weights.vendorName;

            if (fields.invoiceNumber) {
                const conf = fieldConfidences.invoiceNumber || 0.7;
                totalScore += weights.invoiceNumber * conf;
            }
            maxScore += weights.invoiceNumber;

            if (fields.invoiceDate) {
                const conf = fieldConfidences.invoiceDate || 0.7;
                totalScore += weights.invoiceDate * conf;
            }
            maxScore += weights.invoiceDate;

            if (fields.totalAmount > 0) {
                const conf = fieldConfidences.totalAmount || 0.7;
                totalScore += weights.totalAmount * conf;
            }
            maxScore += weights.totalAmount;

            if (extraction.lineItems && extraction.lineItems.length > 0) {
                totalScore += weights.lineItems * 0.8;
            }
            maxScore += weights.lineItems;

            if (vendorMatch.vendorId) {
                totalScore += weights.vendorMatch * vendorMatch.confidence;
            }
            maxScore += weights.vendorMatch;

            const overall = maxScore > 0 ? Math.round((totalScore / maxScore) * 100) : 0;

            return {
                overall: overall,
                level: overall >= 85 ? 'HIGH' : overall >= 60 ? 'MEDIUM' : 'LOW',
                breakdown: {
                    vendorName: fields.vendorName ? Math.round((fieldConfidences.vendorName || 0.7) * 100) : 0,
                    invoiceNumber: fields.invoiceNumber ? Math.round((fieldConfidences.invoiceNumber || 0.7) * 100) : 0,
                    invoiceDate: fields.invoiceDate ? Math.round((fieldConfidences.invoiceDate || 0.7) * 100) : 0,
                    totalAmount: fields.totalAmount > 0 ? Math.round((fieldConfidences.totalAmount || 0.7) * 100) : 0,
                    lineItems: extraction.lineItems && extraction.lineItems.length > 0 ? 80 : 0,
                    vendorMatch: Math.round(vendorMatch.confidence * 100)
                }
            };
        }

        /**
         * Check remaining free usage for the month
         * @returns {number|null} Remaining usage or null if unavailable
         */
        getRemainingUsage() {
            const docCapture = this._getDocCaptureModule();
            if (docCapture && typeof docCapture.getRemainingFreeUsage === 'function') {
                try {
                    return docCapture.getRemainingFreeUsage();
                } catch (e) {
                    log.debug('getRemainingUsage', e.message);
                }
            }
            return null;
        }
    }

    // ==================== Exports ====================

    return {
        FluxCaptureEngine: FluxCaptureEngine,
        DocumentType: DocumentType,
        DocumentTypeLabels: DocumentTypeLabels,
        DocStatus: DocStatus,
        ConfidenceLevel: ConfidenceLevel,
        SUPPORTED_FILE_TYPES: SUPPORTED_FILE_TYPES
    };
});
