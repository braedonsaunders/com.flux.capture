/**
 * @NApiVersion 2.1
 * @NModuleScope Public
 * @module FluxCapture/Engine
 *
 * Flux Capture - Intelligent Document Processing Engine
 * Core library for document extraction, vendor matching, and anomaly detection
 */

define([
    'N/file',
    'N/record',
    'N/search',
    'N/query',
    'N/runtime',
    'N/log',
    'N/format',
    'N/encode'
], function(file, record, search, query, runtime, log, format, encode) {

    'use strict';

    // ==================== Constants ====================
    // These match the INTEGER values stored in NetSuite custom records

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

    const SUPPORTED_FILE_TYPES = ['pdf', 'png', 'jpg', 'jpeg', 'tiff', 'tif', 'gif', 'bmp'];

    // ==================== Flux Capture Engine ====================

    class FluxCaptureEngine {
        constructor(options = {}) {
            this.enableLearning = options.enableLearning !== false;
            this.enableFraudDetection = options.enableFraudDetection !== false;
            this.vendorCache = null;
        }

        /**
         * Process a document file and extract data
         * @param {number} fileId - File Cabinet file ID
         * @param {Object} options - Processing options
         * @returns {Object} - Extraction results
         */
        processDocument(fileId, options = {}) {
            try {
                const fileObj = file.load({ id: fileId });
                this._validateFile(fileObj);

                // Extract text and structure from document
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
                        pageCount: extractionResult.pageCount
                    }
                };

            } catch (error) {
                log.error('FluxCaptureEngine.processDocument', error);
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
                throw new Error(`Unsupported file type: ${extension}`);
            }

            if (fileObj.size > 10485760) {
                throw new Error('File size exceeds 10MB limit');
            }
        }

        /**
         * Extract document data using native NetSuite document capture
         */
        _extractDocumentData(fileObj, options) {
            try {
                // Try to use NetSuite's native document capture
                const docCapture = require('N/documentCapture');

                const docType = options.documentType === 'EXPENSE_REPORT' ?
                    docCapture.DocumentType.RECEIPT : docCapture.DocumentType.INVOICE;

                const result = docCapture.documentToStructure({
                    file: fileObj,
                    documentType: docType,
                    language: options.language || 'ENG'
                });

                return this._normalizeExtractionResult(result);

            } catch (e) {
                // Fallback: Return simulated extraction for demo/testing
                log.debug('Document capture fallback', e.message);
                return this._simulateExtraction(fileObj);
            }
        }

        /**
         * Normalize extraction results to standard format
         */
        _normalizeExtractionResult(rawResult) {
            const extractField = (result, ...names) => {
                for (const name of names) {
                    if (result.fields) {
                        const field = result.fields.find(f =>
                            f.name?.toLowerCase().includes(name.toLowerCase())
                        );
                        if (field) return field.value;
                    }
                    if (result[name]) return result[name];
                }
                return null;
            };

            const parseAmount = (value) => {
                if (!value) return 0;
                const cleaned = String(value).replace(/[^0-9.-]/g, '');
                return parseFloat(cleaned) || 0;
            };

            const parseDate = (value) => {
                if (!value) return null;
                try {
                    return format.parse({ value: value, type: format.Type.DATE });
                } catch (e) {
                    return null;
                }
            };

            return {
                documentType: this._detectDocumentType(rawResult),
                fields: {
                    vendorName: extractField(rawResult, 'vendor_name', 'supplier_name', 'company'),
                    vendorAddress: extractField(rawResult, 'vendor_address', 'supplier_address'),
                    invoiceNumber: extractField(rawResult, 'invoice_number', 'invoice_no', 'document_number'),
                    invoiceDate: parseDate(extractField(rawResult, 'invoice_date', 'document_date', 'date')),
                    dueDate: parseDate(extractField(rawResult, 'due_date', 'payment_due')),
                    poNumber: extractField(rawResult, 'po_number', 'purchase_order'),
                    subtotal: parseAmount(extractField(rawResult, 'subtotal', 'sub_total')),
                    taxAmount: parseAmount(extractField(rawResult, 'tax', 'tax_amount', 'vat')),
                    totalAmount: parseAmount(extractField(rawResult, 'total', 'total_amount', 'amount_due')),
                    currency: extractField(rawResult, 'currency') || 'USD'
                },
                lineItems: this._extractLineItems(rawResult),
                rawText: rawResult.text || '',
                pageCount: rawResult.pageCount || 1
            };
        }

        /**
         * Extract line items from tables
         */
        _extractLineItems(result) {
            const items = [];

            if (!result.tables || result.tables.length === 0) {
                return items;
            }

            // Find line items table
            const itemTable = result.tables.find(t => {
                const headers = (t.headers || t.rows?.[0] || [])
                    .map(h => String(h.value || h).toLowerCase());
                return headers.some(h =>
                    h.includes('description') || h.includes('item') || h.includes('qty')
                );
            });

            if (!itemTable || !itemTable.rows) return items;

            const headers = (itemTable.headers || itemTable.rows[0] || [])
                .map(h => String(h.value || h).toLowerCase());
            const dataRows = itemTable.headers ? itemTable.rows : itemTable.rows.slice(1);

            const findIndex = (...keywords) => {
                return headers.findIndex(h => keywords.some(k => h.includes(k)));
            };

            const descIdx = findIndex('description', 'item', 'particulars');
            const qtyIdx = findIndex('qty', 'quantity', 'units');
            const priceIdx = findIndex('price', 'rate', 'unit');
            const amountIdx = findIndex('amount', 'total', 'extended');

            for (const row of dataRows) {
                const getValue = (idx) => idx >= 0 && row[idx] ? (row[idx].value || row[idx]) : null;
                const getNumber = (idx) => {
                    const val = getValue(idx);
                    if (!val) return 0;
                    return parseFloat(String(val).replace(/[^0-9.-]/g, '')) || 0;
                };

                const item = {
                    description: getValue(descIdx),
                    quantity: getNumber(qtyIdx),
                    unitPrice: getNumber(priceIdx),
                    amount: getNumber(amountIdx)
                };

                if (item.description || item.amount) {
                    items.push(item);
                }
            }

            return items;
        }

        /**
         * Detect document type from content
         */
        _detectDocumentType(result) {
            const text = (result.text || '').toLowerCase();

            if (text.includes('credit') || text.includes('refund')) {
                return DocumentType.CREDIT_MEMO;
            }
            if (text.includes('expense') || text.includes('receipt')) {
                return DocumentType.RECEIPT;
            }
            return DocumentType.INVOICE;
        }

        /**
         * Simulate extraction for testing/demo
         */
        _simulateExtraction(fileObj) {
            return {
                documentType: DocumentType.INVOICE,
                fields: {
                    vendorName: null,
                    invoiceNumber: null,
                    invoiceDate: null,
                    dueDate: null,
                    poNumber: null,
                    subtotal: 0,
                    taxAmount: 0,
                    totalAmount: 0,
                    currency: 'USD'
                },
                lineItems: [],
                rawText: '',
                pageCount: 1
            };
        }

        /**
         * Match vendor from extracted name
         */
        _matchVendor(vendorName) {
            if (!vendorName) {
                return { vendorId: null, confidence: 0, suggestions: [] };
            }

            const searchName = String(vendorName).toLowerCase().trim();

            // Search for exact and fuzzy matches
            const sql = `
                SELECT id, companyname, entityid
                FROM vendor
                WHERE isinactive = 'F'
                AND (
                    LOWER(companyname) LIKE ? OR
                    LOWER(entityid) LIKE ? OR
                    LOWER(companyname) = ?
                )
                ORDER BY
                    CASE WHEN LOWER(companyname) = ? THEN 0 ELSE 1 END,
                    companyname
                FETCH FIRST 5 ROWS ONLY
            `;

            try {
                const results = query.runSuiteQL({
                    query: sql,
                    params: [`%${searchName}%`, `%${searchName}%`, searchName, searchName]
                });

                if (results.results.length === 0) {
                    return { vendorId: null, confidence: 0, suggestions: [] };
                }

                const suggestions = results.results.map(r => ({
                    id: r.values[0],
                    companyName: r.values[1],
                    entityId: r.values[2]
                }));

                const bestMatch = suggestions[0];
                const isExactMatch = bestMatch.companyName.toLowerCase() === searchName;

                return {
                    vendorId: bestMatch.id,
                    vendorName: bestMatch.companyName,
                    confidence: isExactMatch ? 0.95 : 0.75,
                    suggestions: suggestions
                };

            } catch (e) {
                log.debug('Vendor match error', e.message);
                return { vendorId: null, confidence: 0, suggestions: [] };
            }
        }

        /**
         * Detect anomalies in extracted data
         */
        _detectAnomalies(extraction, vendorMatch) {
            const anomalies = [];
            const fields = extraction.fields;

            // Check for missing required fields
            if (!fields.invoiceNumber) {
                anomalies.push({
                    type: 'missing_field',
                    severity: 'medium',
                    message: 'Invoice number not detected'
                });
            }

            if (!fields.totalAmount || fields.totalAmount === 0) {
                anomalies.push({
                    type: 'missing_amount',
                    severity: 'high',
                    message: 'Total amount not detected or is zero'
                });
            }

            // Check for vendor match issues
            if (!vendorMatch.vendorId) {
                anomalies.push({
                    type: 'vendor_not_found',
                    severity: 'medium',
                    message: 'Vendor not found in system'
                });
            } else if (vendorMatch.confidence < 0.8) {
                anomalies.push({
                    type: 'low_vendor_confidence',
                    severity: 'low',
                    message: 'Vendor match confidence is low'
                });
            }

            // Check for amount validation issues
            if (fields.subtotal && fields.taxAmount) {
                const calculated = fields.subtotal + fields.taxAmount;
                const diff = Math.abs(calculated - fields.totalAmount);
                if (diff > 0.01 && diff / fields.totalAmount > 0.02) {
                    anomalies.push({
                        type: 'amount_mismatch',
                        severity: 'medium',
                        message: `Calculated total ($${calculated.toFixed(2)}) differs from extracted ($${fields.totalAmount.toFixed(2)})`
                    });
                }
            }

            // Check for future dates
            if (fields.invoiceDate && fields.invoiceDate > new Date()) {
                anomalies.push({
                    type: 'future_date',
                    severity: 'high',
                    message: 'Invoice date is in the future'
                });
            }

            // Check for duplicate invoice (if vendor matched)
            if (vendorMatch.vendorId && fields.invoiceNumber) {
                const isDuplicate = this._checkDuplicateInvoice(vendorMatch.vendorId, fields.invoiceNumber);
                if (isDuplicate) {
                    anomalies.push({
                        type: 'duplicate_invoice',
                        severity: 'high',
                        message: 'Invoice number already exists for this vendor'
                    });
                }
            }

            // Benford's Law check for large amounts
            if (fields.totalAmount > 10000) {
                const firstDigit = parseInt(String(Math.floor(fields.totalAmount))[0]);
                const benfordExpected = [0, 30.1, 17.6, 12.5, 9.7, 7.9, 6.7, 5.8, 5.1, 4.6];
                if (firstDigit >= 7) {
                    anomalies.push({
                        type: 'benford_anomaly',
                        severity: 'low',
                        message: 'Amount pattern unusual (Benford analysis)'
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
                    AND custrecord_dm_invoice_number = ?
                    AND custrecord_dm_status IN (${DocStatus.EXTRACTED}, ${DocStatus.COMPLETED})
                `;
                const result = query.runSuiteQL({ query: sql, params: [vendorId, invoiceNumber] });
                return result.results[0].values[0] > 0;
            } catch (e) {
                return false;
            }
        }

        /**
         * Validate amounts
         */
        _validateAmounts(extraction) {
            const fields = extraction.fields;
            const lineItems = extraction.lineItems;

            let lineTotal = 0;
            lineItems.forEach(item => {
                lineTotal += item.amount || 0;
            });

            const calculatedTotal = fields.subtotal + fields.taxAmount;

            return {
                valid: Math.abs(fields.totalAmount - calculatedTotal) < 0.02,
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

            // Score each field
            if (fields.vendorName) totalScore += weights.vendorName;
            maxScore += weights.vendorName;

            if (fields.invoiceNumber) totalScore += weights.invoiceNumber;
            maxScore += weights.invoiceNumber;

            if (fields.invoiceDate) totalScore += weights.invoiceDate;
            maxScore += weights.invoiceDate;

            if (fields.totalAmount > 0) totalScore += weights.totalAmount;
            maxScore += weights.totalAmount;

            if (extraction.lineItems.length > 0) totalScore += weights.lineItems;
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
                    vendorName: fields.vendorName ? 100 : 0,
                    invoiceNumber: fields.invoiceNumber ? 100 : 0,
                    invoiceDate: fields.invoiceDate ? 100 : 0,
                    totalAmount: fields.totalAmount > 0 ? 100 : 0,
                    lineItems: extraction.lineItems.length > 0 ? 100 : 0,
                    vendorMatch: Math.round(vendorMatch.confidence * 100)
                }
            };
        }
    }

    // ==================== Exports ====================

    return {
        FluxCaptureEngine: FluxCaptureEngine,
        DocumentType: DocumentType,
        ConfidenceLevel: ConfidenceLevel,
        SUPPORTED_FILE_TYPES: SUPPORTED_FILE_TYPES
    };
});
