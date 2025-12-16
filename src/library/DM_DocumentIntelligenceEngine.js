/**
 * @NApiVersion 2.1
 * @NModuleScope Public
 * @module Flux Capture/DocumentIntelligenceEngine
 * 
 * Flux Capture - Intelligent Document Capture Engine
 * Core AI-powered document processing, extraction, and intelligence library
 * 
 * Features:
 * - Multi-document type support (Invoice, Receipt, Credit Memo, Expense Report)
 * - Smart vendor matching with fuzzy logic
 * - Fraud and anomaly detection
 * - Confidence scoring with visual feedback
 * - Learning from user corrections
 * - Multi-currency support with real-time rates
 */

define([
    'N/task',
    'N/file',
    'N/record',
    'N/search',
    'N/query',
    'N/runtime',
    'N/log',
    'N/format',
    'N/currency',
    'N/encode',
    'N/crypto',
    'N/cache'
], function(task, file, record, search, query, runtime, log, format, currency, encode, crypto, cache) {
    
    'use strict';
    
    // ═══════════════════════════════════════════════════════════════════════════
    // CONSTANTS & CONFIGURATION
    // ═══════════════════════════════════════════════════════════════════════════
    
    const DocumentType = Object.freeze({
        INVOICE: 'INVOICE',
        RECEIPT: 'RECEIPT', 
        CREDIT_MEMO: 'CREDIT_MEMO',
        EXPENSE_REPORT: 'EXPENSE_REPORT',
        PURCHASE_ORDER: 'PURCHASE_ORDER',
        UNKNOWN: 'UNKNOWN'
    });
    
    const ProcessingStatus = Object.freeze({
        PENDING: 'pending',
        PROCESSING: 'processing',
        EXTRACTED: 'extracted',
        NEEDS_REVIEW: 'needs_review',
        APPROVED: 'approved',
        REJECTED: 'rejected',
        COMPLETED: 'completed',
        ERROR: 'error'
    });
    
    const ConfidenceLevel = Object.freeze({
        HIGH: { min: 0.85, label: 'High', color: '#22c55e' },
        MEDIUM: { min: 0.60, label: 'Medium', color: '#f59e0b' },
        LOW: { min: 0, label: 'Low', color: '#ef4444' }
    });
    
    const SUPPORTED_FILE_TYPES = ['pdf', 'png', 'jpg', 'jpeg', 'tiff', 'tif', 'gif', 'bmp'];
    
    const ANOMALY_THRESHOLDS = {
        DUPLICATE_SIMILARITY: 0.92,
        AMOUNT_DEVIATION_PERCENT: 50,
        UNUSUAL_FREQUENCY_DAYS: 3,
        BENFORD_DEVIATION: 0.15
    };
    
    // ═══════════════════════════════════════════════════════════════════════════
    // DOCUMENT CAPTURE ENGINE
    // ═══════════════════════════════════════════════════════════════════════════
    
    /**
     * DocumentCaptureEngine - Core class for document processing
     */
    class DocumentCaptureEngine {
        constructor(options = {}) {
            this.subsidiaryId = options.subsidiaryId || runtime.getCurrentUser().subsidiary;
            this.useOCI = options.useOCI || false;
            this.ociConfig = options.ociConfig || null;
            this.enableLearning = options.enableLearning !== false;
            this.enableFraudDetection = options.enableFraudDetection !== false;
        }
        
        /**
         * Process a single document file
         * @param {Object} options - Processing options
         * @returns {Object} - Extraction results with confidence scores
         */
        processDocument(options) {
            const { fileId, documentType, language = 'ENG', async = true } = options;
            
            try {
                const fileObj = file.load({ id: fileId });
                this._validateFile(fileObj);
                
                const extractionResult = async 
                    ? this._processAsync(fileObj, documentType, language)
                    : this._processSync(fileObj, documentType, language);
                
                // Enhance extraction with intelligence
                const enhancedResult = this._enhanceExtraction(extractionResult);
                
                // Run fraud detection
                if (this.enableFraudDetection) {
                    enhancedResult.anomalies = this._detectAnomalies(enhancedResult);
                }
                
                // Calculate overall confidence
                enhancedResult.overallConfidence = this._calculateOverallConfidence(enhancedResult);
                enhancedResult.confidenceLevel = this._getConfidenceLevel(enhancedResult.overallConfidence);
                
                return enhancedResult;
                
            } catch (error) {
                log.error({ title: 'DocumentCaptureEngine.processDocument', details: error });
                throw error;
            }
        }
        
        /**
         * Process multiple documents in batch
         * @param {Array} fileIds - Array of file IDs to process
         * @param {Object} options - Batch processing options
         * @returns {string} - Task ID for tracking
         */
        processBatch(fileIds, options = {}) {
            const batchRecord = this._createBatchRecord(fileIds, options);
            
            // Create Map/Reduce task for parallel processing
            const mrTask = task.create({
                taskType: task.TaskType.MAP_REDUCE,
                scriptId: 'customscript_dm_batch_processor',
                deploymentId: 'customdeploy_dm_batch_processor',
                params: {
                    custscript_dm_batch_id: batchRecord.id,
                    custscript_dm_options: JSON.stringify(options)
                }
            });
            
            const taskId = mrTask.submit();
            
            record.submitFields({
                type: 'customrecord_dm_batch',
                id: batchRecord.id,
                values: { custrecord_dm_task_id: taskId }
            });
            
            return { batchId: batchRecord.id, taskId };
        }
        
        /**
         * Synchronous document processing using N/documentCapture
         */
        _processSync(fileObj, documentType, language) {
            // Use NetSuite's native documentCapture module for synchronous extraction
            const docCapture = require('N/documentCapture');
            
            const docTypeMap = {
                [DocumentType.INVOICE]: docCapture.DocumentType.INVOICE,
                [DocumentType.RECEIPT]: docCapture.DocumentType.RECEIPT,
                [DocumentType.EXPENSE_REPORT]: docCapture.DocumentType.RECEIPT
            };
            
            const result = docCapture.documentToStructure({
                file: fileObj,
                documentType: docTypeMap[documentType] || docCapture.DocumentType.INVOICE,
                language: language
            });
            
            return this._normalizeExtractionResult(result, documentType);
        }
        
        /**
         * Asynchronous document processing using N/task.DocumentCaptureTask
         */
        _processAsync(fileObj, documentType, language) {
            const outputPath = `/SuiteApps/com.flux.capture/output/${Date.now()}_${fileObj.name.replace(/\.[^.]+$/, '')}.json`;
            
            const docTask = task.create({
                taskType: task.TaskType.DOCUMENT_CAPTURE
            });
            
            docTask.inputFile = fileObj;
            docTask.documentType = this._mapDocumentType(documentType);
            docTask.language = language;
            docTask.outputFilePath = outputPath;
            docTask.features = ['FIELD_EXTRACTION', 'TABLE_EXTRACTION', 'TEXT_EXTRACTION'];
            
            if (this.useOCI && this.ociConfig) {
                docTask.ociConfig = this.ociConfig;
            }
            
            const taskId = docTask.submit();
            
            return {
                taskId,
                outputFilePath: outputPath,
                status: ProcessingStatus.PROCESSING
            };
        }
        
        /**
         * Validate file for processing
         */
        _validateFile(fileObj) {
            const fileName = fileObj.name.toLowerCase();
            const extension = fileName.split('.').pop();
            
            if (!SUPPORTED_FILE_TYPES.includes(extension)) {
                throw new Error(`Unsupported file type: ${extension}. Supported types: ${SUPPORTED_FILE_TYPES.join(', ')}`);
            }
            
            // Check file size (max 10MB)
            if (fileObj.size > 10485760) {
                throw new Error('File size exceeds maximum allowed (10MB)');
            }
        }
        
        /**
         * Map document type to NetSuite enum
         */
        _mapDocumentType(docType) {
            const docCapture = require('N/documentCapture');
            const mapping = {
                [DocumentType.INVOICE]: docCapture.DocumentType.INVOICE,
                [DocumentType.RECEIPT]: docCapture.DocumentType.RECEIPT,
                [DocumentType.CREDIT_MEMO]: docCapture.DocumentType.INVOICE,
                [DocumentType.EXPENSE_REPORT]: docCapture.DocumentType.RECEIPT,
                [DocumentType.PURCHASE_ORDER]: docCapture.DocumentType.INVOICE
            };
            return mapping[docType] || docCapture.DocumentType.INVOICE;
        }
        
        /**
         * Normalize extraction results to standard format
         */
        _normalizeExtractionResult(rawResult, documentType) {
            return {
                documentType,
                rawData: rawResult,
                extractedFields: {
                    vendorName: this._extractField(rawResult, 'vendor_name', 'supplier_name', 'company_name'),
                    vendorAddress: this._extractField(rawResult, 'vendor_address', 'supplier_address'),
                    invoiceNumber: this._extractField(rawResult, 'invoice_number', 'invoice_no', 'document_number', 'receipt_number'),
                    invoiceDate: this._extractDateField(rawResult, 'invoice_date', 'document_date', 'date'),
                    dueDate: this._extractDateField(rawResult, 'due_date', 'payment_due'),
                    poNumber: this._extractField(rawResult, 'po_number', 'purchase_order', 'po_reference'),
                    subtotal: this._extractAmountField(rawResult, 'subtotal', 'sub_total'),
                    taxAmount: this._extractAmountField(rawResult, 'tax', 'tax_amount', 'vat', 'gst'),
                    totalAmount: this._extractAmountField(rawResult, 'total', 'total_amount', 'amount_due', 'grand_total'),
                    currency: this._extractField(rawResult, 'currency', 'currency_code') || 'USD',
                    paymentTerms: this._extractField(rawResult, 'payment_terms', 'terms'),
                    bankDetails: this._extractBankDetails(rawResult)
                },
                lineItems: this._extractLineItems(rawResult),
                tables: rawResult.tables || [],
                rawText: rawResult.text || '',
                pageCount: rawResult.pageCount || 1,
                mimeType: rawResult.mimeType
            };
        }
        
        /**
         * Extract field with multiple possible names
         */
        _extractField(result, ...fieldNames) {
            for (const name of fieldNames) {
                const value = this._findFieldValue(result, name);
                if (value) {
                    return {
                        value: value.value || value,
                        confidence: value.confidence || 0.5,
                        boundingBox: value.boundingBox || null
                    };
                }
            }
            return { value: null, confidence: 0, boundingBox: null };
        }
        
        /**
         * Find field value in nested result structure
         */
        _findFieldValue(obj, fieldName) {
            if (!obj || typeof obj !== 'object') return null;
            
            // Direct property
            if (obj[fieldName]) return obj[fieldName];
            
            // Check fields array
            if (Array.isArray(obj.fields)) {
                const field = obj.fields.find(f => 
                    f.name?.toLowerCase() === fieldName.toLowerCase() ||
                    f.type?.toLowerCase() === fieldName.toLowerCase()
                );
                if (field) return field;
            }
            
            // Recursive search
            for (const key in obj) {
                if (typeof obj[key] === 'object') {
                    const found = this._findFieldValue(obj[key], fieldName);
                    if (found) return found;
                }
            }
            
            return null;
        }
        
        /**
         * Extract and parse date fields
         */
        _extractDateField(result, ...fieldNames) {
            const field = this._extractField(result, ...fieldNames);
            if (field.value) {
                try {
                    const parsedDate = format.parse({
                        value: field.value,
                        type: format.Type.DATE
                    });
                    field.parsedValue = parsedDate;
                } catch (e) {
                    field.parsedValue = null;
                }
            }
            return field;
        }
        
        /**
         * Extract and parse amount fields
         */
        _extractAmountField(result, ...fieldNames) {
            const field = this._extractField(result, ...fieldNames);
            if (field.value) {
                // Clean and parse amount
                const cleaned = String(field.value).replace(/[^0-9.-]/g, '');
                field.numericValue = parseFloat(cleaned) || 0;
            } else {
                field.numericValue = 0;
            }
            return field;
        }
        
        /**
         * Extract bank details for payment
         */
        _extractBankDetails(result) {
            return {
                bankName: this._extractField(result, 'bank_name', 'bank'),
                accountNumber: this._extractField(result, 'account_number', 'bank_account'),
                routingNumber: this._extractField(result, 'routing_number', 'sort_code', 'bsb'),
                iban: this._extractField(result, 'iban'),
                swift: this._extractField(result, 'swift', 'bic')
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
            
            // Find the line items table (usually the largest table with item-like columns)
            const itemTable = this._findLineItemsTable(result.tables);
            
            if (!itemTable || !itemTable.rows) {
                return items;
            }
            
            const headers = this._normalizeHeaders(itemTable.headers || itemTable.rows[0]);
            const dataRows = itemTable.headers ? itemTable.rows : itemTable.rows.slice(1);
            
            for (const row of dataRows) {
                const item = this._parseLineItem(row, headers);
                if (item && (item.description || item.quantity || item.amount)) {
                    items.push(item);
                }
            }
            
            return items;
        }
        
        /**
         * Find the table most likely to contain line items
         */
        _findLineItemsTable(tables) {
            const lineItemKeywords = ['item', 'description', 'quantity', 'qty', 'price', 'amount', 'total', 'unit'];
            
            let bestTable = null;
            let bestScore = 0;
            
            for (const table of tables) {
                const headers = (table.headers || table.rows?.[0] || []).map(h => 
                    String(h.value || h).toLowerCase()
                );
                
                const score = headers.reduce((acc, header) => {
                    return acc + (lineItemKeywords.some(kw => header.includes(kw)) ? 1 : 0);
                }, 0);
                
                if (score > bestScore) {
                    bestScore = score;
                    bestTable = table;
                }
            }
            
            return bestTable;
        }
        
        /**
         * Normalize table headers to standard names
         */
        _normalizeHeaders(headers) {
            const headerMap = {
                description: ['description', 'desc', 'item', 'product', 'service', 'particulars'],
                quantity: ['quantity', 'qty', 'units', 'count'],
                unitPrice: ['unit price', 'unit_price', 'price', 'rate', 'unit cost'],
                amount: ['amount', 'total', 'line total', 'extended', 'subtotal'],
                tax: ['tax', 'vat', 'gst', 'tax amount'],
                itemCode: ['code', 'sku', 'item code', 'part number', 'part no']
            };
            
            const normalized = {};
            const rawHeaders = headers.map(h => String(h.value || h).toLowerCase().trim());
            
            for (const [stdName, variants] of Object.entries(headerMap)) {
                const idx = rawHeaders.findIndex(h => 
                    variants.some(v => h.includes(v))
                );
                if (idx >= 0) {
                    normalized[stdName] = idx;
                }
            }
            
            return normalized;
        }
        
        /**
         * Parse a single line item row
         */
        _parseLineItem(row, headerIndices) {
            const getValue = (idx) => {
                if (idx === undefined || idx < 0 || idx >= row.length) return null;
                const cell = row[idx];
                return cell?.value || cell || null;
            };
            
            const getNumericValue = (idx) => {
                const val = getValue(idx);
                if (!val) return 0;
                const cleaned = String(val).replace(/[^0-9.-]/g, '');
                return parseFloat(cleaned) || 0;
            };
            
            return {
                description: getValue(headerIndices.description),
                quantity: getNumericValue(headerIndices.quantity),
                unitPrice: getNumericValue(headerIndices.unitPrice),
                amount: getNumericValue(headerIndices.amount),
                tax: getNumericValue(headerIndices.tax),
                itemCode: getValue(headerIndices.itemCode),
                confidence: this._calculateLineItemConfidence(row)
            };
        }
        
        /**
         * Calculate confidence score for a line item
         */
        _calculateLineItemConfidence(row) {
            let totalConfidence = 0;
            let cellCount = 0;
            
            for (const cell of row) {
                if (cell && typeof cell === 'object' && cell.confidence !== undefined) {
                    totalConfidence += cell.confidence;
                    cellCount++;
                }
            }
            
            return cellCount > 0 ? totalConfidence / cellCount : 0.5;
        }
        
        /**
         * Enhance extraction with additional intelligence
         */
        _enhanceExtraction(result) {
            const enhanced = { ...result };
            
            // Smart vendor matching
            enhanced.vendorMatch = this._matchVendor(result.extractedFields.vendorName);
            
            // PO matching
            if (result.extractedFields.poNumber?.value) {
                enhanced.poMatch = this._matchPurchaseOrder(result.extractedFields.poNumber.value);
            }
            
            // Currency detection and conversion
            enhanced.currencyInfo = this._processCurrency(result.extractedFields);
            
            // Calculate line item totals for validation
            enhanced.calculatedTotals = this._calculateTotals(result);
            
            // Validate extracted amounts
            enhanced.amountValidation = this._validateAmounts(result, enhanced.calculatedTotals);
            
            return enhanced;
        }
        
        /**
         * Match vendor using fuzzy logic
         */
        _matchVendor(vendorNameField) {
            if (!vendorNameField?.value) {
                return { matched: false, suggestions: [] };
            }
            
            const vendorName = vendorNameField.value;
            
            // Search for exact and similar vendors
            const vendorSearch = search.create({
                type: search.Type.VENDOR,
                filters: [
                    ['isinactive', 'is', 'F']
                ],
                columns: [
                    'internalid',
                    'companyname',
                    'entityid',
                    'email',
                    'defaulttaxreg'
                ]
            });
            
            const matches = [];
            
            vendorSearch.run().each((result) => {
                const companyName = result.getValue('companyname') || '';
                const entityId = result.getValue('entityid') || '';
                
                const similarity = Math.max(
                    this._calculateSimilarity(vendorName.toLowerCase(), companyName.toLowerCase()),
                    this._calculateSimilarity(vendorName.toLowerCase(), entityId.toLowerCase())
                );
                
                if (similarity > 0.4) {
                    matches.push({
                        id: result.getValue('internalid'),
                        name: companyName || entityId,
                        entityId,
                        email: result.getValue('email'),
                        similarity,
                        confidence: similarity
                    });
                }
                
                return matches.length < 10;
            });
            
            // Sort by similarity
            matches.sort((a, b) => b.similarity - a.similarity);
            
            const bestMatch = matches.length > 0 && matches[0].similarity >= 0.85 ? matches[0] : null;
            
            return {
                matched: !!bestMatch,
                bestMatch,
                suggestions: matches.slice(0, 5),
                searchTerm: vendorName
            };
        }
        
        /**
         * Calculate string similarity using Levenshtein distance
         */
        _calculateSimilarity(str1, str2) {
            if (str1 === str2) return 1;
            if (!str1 || !str2) return 0;
            
            const len1 = str1.length;
            const len2 = str2.length;
            const maxLen = Math.max(len1, len2);
            
            if (maxLen === 0) return 1;
            
            // Create distance matrix
            const matrix = Array(len1 + 1).fill().map(() => Array(len2 + 1).fill(0));
            
            for (let i = 0; i <= len1; i++) matrix[i][0] = i;
            for (let j = 0; j <= len2; j++) matrix[0][j] = j;
            
            for (let i = 1; i <= len1; i++) {
                for (let j = 1; j <= len2; j++) {
                    const cost = str1[i - 1] === str2[j - 1] ? 0 : 1;
                    matrix[i][j] = Math.min(
                        matrix[i - 1][j] + 1,
                        matrix[i][j - 1] + 1,
                        matrix[i - 1][j - 1] + cost
                    );
                }
            }
            
            const distance = matrix[len1][len2];
            return 1 - (distance / maxLen);
        }
        
        /**
         * Match purchase order by number
         */
        _matchPurchaseOrder(poNumber) {
            if (!poNumber) return { matched: false };
            
            const poSearch = search.create({
                type: search.Type.PURCHASE_ORDER,
                filters: [
                    ['numbertext', 'contains', poNumber],
                    'AND',
                    ['mainline', 'is', 'T']
                ],
                columns: [
                    'internalid',
                    'tranid',
                    'entity',
                    'total',
                    'status'
                ]
            });
            
            const results = [];
            
            poSearch.run().each((result) => {
                results.push({
                    id: result.getValue('internalid'),
                    tranId: result.getValue('tranid'),
                    vendor: result.getText('entity'),
                    vendorId: result.getValue('entity'),
                    total: parseFloat(result.getValue('total')) || 0,
                    status: result.getText('status')
                });
                return results.length < 5;
            });
            
            return {
                matched: results.length > 0,
                matches: results,
                searchTerm: poNumber
            };
        }
        
        /**
         * Process currency information
         */
        _processCurrency(fields) {
            const extractedCurrency = fields.currency?.value || 'USD';
            const baseCurrency = runtime.getCurrentScript().getParameter('custscript_dm_base_currency') || 'USD';
            
            let exchangeRate = 1;
            
            if (extractedCurrency !== baseCurrency) {
                try {
                    exchangeRate = currency.exchangeRate({
                        source: extractedCurrency,
                        target: baseCurrency,
                        date: fields.invoiceDate?.parsedValue || new Date()
                    });
                } catch (e) {
                    log.warning({ title: 'Currency Exchange', details: `Could not get rate for ${extractedCurrency}` });
                }
            }
            
            return {
                extracted: extractedCurrency,
                base: baseCurrency,
                exchangeRate,
                convertedTotal: fields.totalAmount?.numericValue 
                    ? fields.totalAmount.numericValue * exchangeRate 
                    : null
            };
        }
        
        /**
         * Calculate totals from line items
         */
        _calculateTotals(result) {
            const lineItems = result.lineItems || [];
            
            let subtotal = 0;
            let taxTotal = 0;
            
            for (const item of lineItems) {
                if (item.amount) {
                    subtotal += item.amount;
                } else if (item.quantity && item.unitPrice) {
                    subtotal += item.quantity * item.unitPrice;
                }
                taxTotal += item.tax || 0;
            }
            
            return {
                calculatedSubtotal: subtotal,
                calculatedTax: taxTotal,
                calculatedTotal: subtotal + taxTotal,
                lineItemCount: lineItems.length
            };
        }
        
        /**
         * Validate amounts between extracted and calculated
         */
        _validateAmounts(result, calculated) {
            const extracted = result.extractedFields;
            const issues = [];
            
            // Check subtotal
            if (extracted.subtotal?.numericValue && calculated.calculatedSubtotal) {
                const diff = Math.abs(extracted.subtotal.numericValue - calculated.calculatedSubtotal);
                if (diff > 0.01 && diff / extracted.subtotal.numericValue > 0.02) {
                    issues.push({
                        type: 'SUBTOTAL_MISMATCH',
                        extracted: extracted.subtotal.numericValue,
                        calculated: calculated.calculatedSubtotal,
                        difference: diff
                    });
                }
            }
            
            // Check total
            if (extracted.totalAmount?.numericValue && calculated.calculatedTotal) {
                const diff = Math.abs(extracted.totalAmount.numericValue - calculated.calculatedTotal);
                if (diff > 0.01 && diff / extracted.totalAmount.numericValue > 0.02) {
                    issues.push({
                        type: 'TOTAL_MISMATCH',
                        extracted: extracted.totalAmount.numericValue,
                        calculated: calculated.calculatedTotal,
                        difference: diff
                    });
                }
            }
            
            return {
                valid: issues.length === 0,
                issues
            };
        }
        
        /**
         * Detect anomalies and potential fraud
         */
        _detectAnomalies(result) {
            const anomalies = [];
            
            // Check for duplicates
            const duplicateCheck = this._checkForDuplicates(result);
            if (duplicateCheck.found) {
                anomalies.push({
                    type: 'POTENTIAL_DUPLICATE',
                    severity: 'high',
                    message: `Similar document found: ${duplicateCheck.matchingDocument}`,
                    details: duplicateCheck
                });
            }
            
            // Check amount against vendor history
            const amountCheck = this._checkAmountAgainstHistory(result);
            if (amountCheck.unusual) {
                anomalies.push({
                    type: 'UNUSUAL_AMOUNT',
                    severity: amountCheck.severity,
                    message: amountCheck.message,
                    details: amountCheck
                });
            }
            
            // Benford's Law analysis for fraud detection
            const benfordCheck = this._checkBenfordsLaw(result);
            if (benfordCheck.suspicious) {
                anomalies.push({
                    type: 'BENFORD_ANOMALY',
                    severity: 'medium',
                    message: 'Amount distribution deviates from expected pattern',
                    details: benfordCheck
                });
            }
            
            // Check for round number patterns (potential manipulation)
            const roundNumberCheck = this._checkRoundNumbers(result);
            if (roundNumberCheck.suspicious) {
                anomalies.push({
                    type: 'ROUND_NUMBER_PATTERN',
                    severity: 'low',
                    message: 'Document contains unusually many round numbers',
                    details: roundNumberCheck
                });
            }
            
            return anomalies;
        }
        
        /**
         * Check for duplicate documents
         */
        _checkForDuplicates(result) {
            const vendorId = result.vendorMatch?.bestMatch?.id;
            const invoiceNumber = result.extractedFields.invoiceNumber?.value;
            const totalAmount = result.extractedFields.totalAmount?.numericValue;
            
            if (!invoiceNumber && !totalAmount) {
                return { found: false };
            }
            
            // Check custom capture records for duplicates
            const filters = [['custrecord_dm_status', 'noneof', ProcessingStatus.REJECTED, ProcessingStatus.ERROR]];
            
            if (invoiceNumber) {
                filters.push('AND', ['custrecord_dm_invoice_number', 'is', invoiceNumber]);
            }
            
            if (vendorId) {
                filters.push('AND', ['custrecord_dm_vendor', 'is', vendorId]);
            }
            
            try {
                const dupSearch = search.create({
                    type: 'customrecord_dm_captured_document',
                    filters,
                    columns: ['internalid', 'custrecord_dm_invoice_number', 'custrecord_dm_total', 'created']
                });
                
                let duplicate = null;
                
                dupSearch.run().each((res) => {
                    const docTotal = parseFloat(res.getValue('custrecord_dm_total')) || 0;
                    
                    if (totalAmount && Math.abs(docTotal - totalAmount) < 0.01) {
                        duplicate = {
                            id: res.getValue('internalid'),
                            invoiceNumber: res.getValue('custrecord_dm_invoice_number'),
                            total: docTotal,
                            created: res.getValue('created')
                        };
                        return false;
                    }
                    return true;
                });
                
                return {
                    found: !!duplicate,
                    matchingDocument: duplicate
                };
                
            } catch (e) {
                return { found: false, error: e.message };
            }
        }
        
        /**
         * Check amount against vendor history
         */
        _checkAmountAgainstHistory(result) {
            const vendorId = result.vendorMatch?.bestMatch?.id;
            const totalAmount = result.extractedFields.totalAmount?.numericValue;
            
            if (!vendorId || !totalAmount) {
                return { unusual: false };
            }
            
            // Get historical bills for this vendor
            const billSearch = search.create({
                type: search.Type.VENDOR_BILL,
                filters: [
                    ['entity', 'is', vendorId],
                    'AND',
                    ['mainline', 'is', 'T'],
                    'AND',
                    ['trandate', 'within', 'lastrollingyear']
                ],
                columns: [
                    search.createColumn({ name: 'amount', summary: search.Summary.AVG }),
                    search.createColumn({ name: 'amount', summary: search.Summary.MAX }),
                    search.createColumn({ name: 'amount', summary: search.Summary.MIN }),
                    search.createColumn({ name: 'amount', summary: search.Summary.COUNT })
                ]
            });
            
            let avgAmount = 0, maxAmount = 0, minAmount = 0, count = 0;
            
            billSearch.run().each((res) => {
                avgAmount = parseFloat(res.getValue({ name: 'amount', summary: search.Summary.AVG })) || 0;
                maxAmount = parseFloat(res.getValue({ name: 'amount', summary: search.Summary.MAX })) || 0;
                minAmount = parseFloat(res.getValue({ name: 'amount', summary: search.Summary.MIN })) || 0;
                count = parseInt(res.getValue({ name: 'amount', summary: search.Summary.COUNT })) || 0;
                return false;
            });
            
            if (count < 3) {
                return { unusual: false, reason: 'Insufficient history' };
            }
            
            const deviationPercent = avgAmount > 0 
                ? Math.abs((totalAmount - avgAmount) / avgAmount) * 100 
                : 0;
            
            if (totalAmount > maxAmount * 1.5) {
                return {
                    unusual: true,
                    severity: 'high',
                    message: `Amount ($${totalAmount.toFixed(2)}) is ${deviationPercent.toFixed(0)}% higher than historical average ($${avgAmount.toFixed(2)})`,
                    avgAmount,
                    maxAmount,
                    minAmount,
                    deviationPercent
                };
            }
            
            if (deviationPercent > ANOMALY_THRESHOLDS.AMOUNT_DEVIATION_PERCENT) {
                return {
                    unusual: true,
                    severity: 'medium',
                    message: `Amount deviates ${deviationPercent.toFixed(0)}% from historical average`,
                    avgAmount,
                    maxAmount,
                    minAmount,
                    deviationPercent
                };
            }
            
            return { unusual: false };
        }
        
        /**
         * Benford's Law analysis for fraud detection
         */
        _checkBenfordsLaw(result) {
            const amounts = [];
            
            // Collect all amounts from line items
            if (result.lineItems) {
                for (const item of result.lineItems) {
                    if (item.amount) amounts.push(item.amount);
                    if (item.unitPrice) amounts.push(item.unitPrice);
                }
            }
            
            if (amounts.length < 10) {
                return { suspicious: false, reason: 'Insufficient data points' };
            }
            
            // Expected Benford distribution
            const benfordExpected = [0.301, 0.176, 0.125, 0.097, 0.079, 0.067, 0.058, 0.051, 0.046];
            
            // Count first digits
            const firstDigitCounts = Array(9).fill(0);
            
            for (const amount of amounts) {
                if (amount > 0) {
                    const firstDigit = parseInt(String(amount).replace(/[^0-9]/g, '')[0]) || 0;
                    if (firstDigit >= 1 && firstDigit <= 9) {
                        firstDigitCounts[firstDigit - 1]++;
                    }
                }
            }
            
            // Calculate observed distribution
            const total = firstDigitCounts.reduce((a, b) => a + b, 0);
            const observed = firstDigitCounts.map(c => c / total);
            
            // Chi-square test
            let chiSquare = 0;
            for (let i = 0; i < 9; i++) {
                const diff = observed[i] - benfordExpected[i];
                chiSquare += (diff * diff) / benfordExpected[i];
            }
            
            // Normalize to deviation score
            const deviationScore = Math.sqrt(chiSquare / 9);
            
            return {
                suspicious: deviationScore > ANOMALY_THRESHOLDS.BENFORD_DEVIATION,
                deviationScore,
                observed,
                expected: benfordExpected,
                sampleSize: amounts.length
            };
        }
        
        /**
         * Check for suspicious round number patterns
         */
        _checkRoundNumbers(result) {
            const amounts = [];
            
            if (result.lineItems) {
                for (const item of result.lineItems) {
                    if (item.amount) amounts.push(item.amount);
                }
            }
            
            if (amounts.length < 5) {
                return { suspicious: false };
            }
            
            const roundCount = amounts.filter(a => a % 100 === 0 || a % 50 === 0).length;
            const roundPercent = roundCount / amounts.length;
            
            return {
                suspicious: roundPercent > 0.6,
                roundPercent,
                roundCount,
                totalCount: amounts.length
            };
        }
        
        /**
         * Calculate overall confidence score
         */
        _calculateOverallConfidence(result) {
            const fields = result.extractedFields;
            const weights = {
                vendorName: 0.20,
                invoiceNumber: 0.15,
                invoiceDate: 0.10,
                totalAmount: 0.20,
                lineItems: 0.15,
                vendorMatch: 0.10,
                amountValidation: 0.10
            };
            
            let totalScore = 0;
            let totalWeight = 0;
            
            // Field confidence scores
            for (const [field, weight] of Object.entries(weights)) {
                if (field === 'lineItems') {
                    if (result.lineItems && result.lineItems.length > 0) {
                        const avgConf = result.lineItems.reduce((sum, item) => 
                            sum + (item.confidence || 0.5), 0) / result.lineItems.length;
                        totalScore += avgConf * weight;
                    }
                } else if (field === 'vendorMatch') {
                    if (result.vendorMatch?.matched) {
                        totalScore += result.vendorMatch.bestMatch.confidence * weight;
                    }
                } else if (field === 'amountValidation') {
                    totalScore += (result.amountValidation?.valid ? 1 : 0.3) * weight;
                } else if (fields[field]) {
                    totalScore += (fields[field].confidence || 0) * weight;
                }
                totalWeight += weight;
            }
            
            // Reduce confidence if anomalies detected
            if (result.anomalies && result.anomalies.length > 0) {
                const anomalyPenalty = result.anomalies.reduce((penalty, anomaly) => {
                    if (anomaly.severity === 'high') return penalty + 0.15;
                    if (anomaly.severity === 'medium') return penalty + 0.08;
                    return penalty + 0.03;
                }, 0);
                
                totalScore = Math.max(0, totalScore - anomalyPenalty);
            }
            
            return totalWeight > 0 ? totalScore / totalWeight : 0;
        }
        
        /**
         * Get confidence level from score
         */
        _getConfidenceLevel(score) {
            if (score >= ConfidenceLevel.HIGH.min) return ConfidenceLevel.HIGH;
            if (score >= ConfidenceLevel.MEDIUM.min) return ConfidenceLevel.MEDIUM;
            return ConfidenceLevel.LOW;
        }
        
        /**
         * Create batch processing record
         */
        _createBatchRecord(fileIds, options) {
            const batchRec = record.create({ type: 'customrecord_dm_batch' });
            
            batchRec.setValue({ fieldId: 'name', value: `Batch ${new Date().toISOString()}` });
            batchRec.setValue({ fieldId: 'custrecord_dm_batch_status', value: ProcessingStatus.PENDING });
            batchRec.setValue({ fieldId: 'custrecord_dm_batch_file_count', value: fileIds.length });
            batchRec.setValue({ fieldId: 'custrecord_dm_batch_options', value: JSON.stringify(options) });
            batchRec.setValue({ fieldId: 'custrecord_dm_batch_file_ids', value: JSON.stringify(fileIds) });
            
            const id = batchRec.save();
            
            return { id };
        }
    }
    
    // ═══════════════════════════════════════════════════════════════════════════
    // TRANSACTION CREATOR
    // ═══════════════════════════════════════════════════════════════════════════
    
    /**
     * TransactionCreator - Creates NetSuite transactions from extraction results
     */
    class TransactionCreator {
        constructor(options = {}) {
            this.autoPost = options.autoPost || false;
            this.defaultApprovalStatus = options.defaultApprovalStatus || 'pendingApproval';
        }
        
        /**
         * Create vendor bill from extraction results
         */
        createVendorBill(extractionResult, overrides = {}) {
            const fields = extractionResult.extractedFields;
            const vendorId = overrides.vendorId || extractionResult.vendorMatch?.bestMatch?.id;
            
            if (!vendorId) {
                throw new Error('Vendor not identified or matched');
            }
            
            const bill = record.create({
                type: record.Type.VENDOR_BILL,
                isDynamic: true
            });
            
            // Set header fields
            bill.setValue({ fieldId: 'entity', value: vendorId });
            
            if (fields.invoiceDate?.parsedValue) {
                bill.setValue({ fieldId: 'trandate', value: fields.invoiceDate.parsedValue });
            }
            
            if (fields.dueDate?.parsedValue) {
                bill.setValue({ fieldId: 'duedate', value: fields.dueDate.parsedValue });
            }
            
            if (fields.invoiceNumber?.value) {
                bill.setValue({ fieldId: 'tranid', value: fields.invoiceNumber.value });
            }
            
            if (extractionResult.currencyInfo?.extracted) {
                try {
                    const currencyId = this._getCurrencyId(extractionResult.currencyInfo.extracted);
                    if (currencyId) {
                        bill.setValue({ fieldId: 'currency', value: currencyId });
                    }
                } catch (e) {
                    log.warning({ title: 'Currency Setting', details: e.message });
                }
            }
            
            // Add line items
            if (extractionResult.lineItems && extractionResult.lineItems.length > 0) {
                for (const item of extractionResult.lineItems) {
                    this._addBillLine(bill, item, overrides);
                }
            } else {
                // Create single expense line
                bill.selectNewLine({ sublistId: 'expense' });
                bill.setCurrentSublistValue({
                    sublistId: 'expense',
                    fieldId: 'account',
                    value: overrides.defaultExpenseAccount || this._getDefaultExpenseAccount()
                });
                bill.setCurrentSublistValue({
                    sublistId: 'expense',
                    fieldId: 'amount',
                    value: fields.totalAmount?.numericValue || 0
                });
                bill.setCurrentSublistValue({
                    sublistId: 'expense',
                    fieldId: 'memo',
                    value: 'Captured from document'
                });
                bill.commitLine({ sublistId: 'expense' });
            }
            
            // Apply overrides
            for (const [fieldId, value] of Object.entries(overrides)) {
                if (!['vendorId', 'defaultExpenseAccount', 'lineItems'].includes(fieldId)) {
                    try {
                        bill.setValue({ fieldId, value });
                    } catch (e) {
                        // Skip invalid fields
                    }
                }
            }
            
            const billId = bill.save({ enableSourcing: true, ignoreMandatoryFields: false });
            
            return {
                success: true,
                transactionId: billId,
                transactionType: 'vendorbill',
                tranId: search.lookupFields({
                    type: record.Type.VENDOR_BILL,
                    id: billId,
                    columns: ['tranid']
                }).tranid
            };
        }
        
        /**
         * Create expense report from extraction results
         */
        createExpenseReport(extractionResult, overrides = {}) {
            const fields = extractionResult.extractedFields;
            const employeeId = overrides.employeeId || runtime.getCurrentUser().id;
            
            const expReport = record.create({
                type: record.Type.EXPENSE_REPORT,
                isDynamic: true
            });
            
            expReport.setValue({ fieldId: 'entity', value: employeeId });
            
            if (fields.invoiceDate?.parsedValue) {
                expReport.setValue({ fieldId: 'trandate', value: fields.invoiceDate.parsedValue });
            }
            
            // Add expense lines
            if (extractionResult.lineItems && extractionResult.lineItems.length > 0) {
                for (const item of extractionResult.lineItems) {
                    this._addExpenseLine(expReport, item, fields, overrides);
                }
            } else {
                // Single expense line
                expReport.selectNewLine({ sublistId: 'expense' });
                expReport.setCurrentSublistValue({
                    sublistId: 'expense',
                    fieldId: 'category',
                    value: overrides.defaultCategory || this._getDefaultExpenseCategory()
                });
                expReport.setCurrentSublistValue({
                    sublistId: 'expense',
                    fieldId: 'amount',
                    value: fields.totalAmount?.numericValue || 0
                });
                expReport.setCurrentSublistValue({
                    sublistId: 'expense',
                    fieldId: 'expensedate',
                    value: fields.invoiceDate?.parsedValue || new Date()
                });
                expReport.setCurrentSublistValue({
                    sublistId: 'expense',
                    fieldId: 'memo',
                    value: fields.vendorName?.value || 'Captured expense'
                });
                expReport.commitLine({ sublistId: 'expense' });
            }
            
            const reportId = expReport.save();
            
            return {
                success: true,
                transactionId: reportId,
                transactionType: 'expensereport'
            };
        }
        
        /**
         * Create vendor credit from extraction results
         */
        createVendorCredit(extractionResult, overrides = {}) {
            const fields = extractionResult.extractedFields;
            const vendorId = overrides.vendorId || extractionResult.vendorMatch?.bestMatch?.id;
            
            if (!vendorId) {
                throw new Error('Vendor not identified or matched');
            }
            
            const credit = record.create({
                type: record.Type.VENDOR_CREDIT,
                isDynamic: true
            });
            
            credit.setValue({ fieldId: 'entity', value: vendorId });
            
            if (fields.invoiceDate?.parsedValue) {
                credit.setValue({ fieldId: 'trandate', value: fields.invoiceDate.parsedValue });
            }
            
            if (fields.invoiceNumber?.value) {
                credit.setValue({ fieldId: 'tranid', value: fields.invoiceNumber.value });
            }
            
            // Add lines
            if (extractionResult.lineItems && extractionResult.lineItems.length > 0) {
                for (const item of extractionResult.lineItems) {
                    this._addCreditLine(credit, item, overrides);
                }
            } else {
                credit.selectNewLine({ sublistId: 'expense' });
                credit.setCurrentSublistValue({
                    sublistId: 'expense',
                    fieldId: 'account',
                    value: overrides.defaultExpenseAccount || this._getDefaultExpenseAccount()
                });
                credit.setCurrentSublistValue({
                    sublistId: 'expense',
                    fieldId: 'amount',
                    value: fields.totalAmount?.numericValue || 0
                });
                credit.commitLine({ sublistId: 'expense' });
            }
            
            const creditId = credit.save();
            
            return {
                success: true,
                transactionId: creditId,
                transactionType: 'vendorcredit'
            };
        }
        
        /**
         * Add line to vendor bill
         */
        _addBillLine(bill, item, overrides) {
            const itemId = this._matchItem(item);
            
            if (itemId) {
                // Add as item line
                bill.selectNewLine({ sublistId: 'item' });
                bill.setCurrentSublistValue({ sublistId: 'item', fieldId: 'item', value: itemId });
                bill.setCurrentSublistValue({ sublistId: 'item', fieldId: 'quantity', value: item.quantity || 1 });
                bill.setCurrentSublistValue({ sublistId: 'item', fieldId: 'rate', value: item.unitPrice || item.amount });
                if (item.description) {
                    bill.setCurrentSublistValue({ sublistId: 'item', fieldId: 'description', value: item.description });
                }
                bill.commitLine({ sublistId: 'item' });
            } else {
                // Add as expense line
                bill.selectNewLine({ sublistId: 'expense' });
                bill.setCurrentSublistValue({
                    sublistId: 'expense',
                    fieldId: 'account',
                    value: overrides.defaultExpenseAccount || this._getDefaultExpenseAccount()
                });
                bill.setCurrentSublistValue({ sublistId: 'expense', fieldId: 'amount', value: item.amount || 0 });
                bill.setCurrentSublistValue({ sublistId: 'expense', fieldId: 'memo', value: item.description || '' });
                bill.commitLine({ sublistId: 'expense' });
            }
        }
        
        /**
         * Add expense line to expense report
         */
        _addExpenseLine(report, item, fields, overrides) {
            report.selectNewLine({ sublistId: 'expense' });
            report.setCurrentSublistValue({
                sublistId: 'expense',
                fieldId: 'category',
                value: overrides.defaultCategory || this._getDefaultExpenseCategory()
            });
            report.setCurrentSublistValue({ sublistId: 'expense', fieldId: 'amount', value: item.amount || 0 });
            report.setCurrentSublistValue({
                sublistId: 'expense',
                fieldId: 'expensedate',
                value: fields.invoiceDate?.parsedValue || new Date()
            });
            report.setCurrentSublistValue({
                sublistId: 'expense',
                fieldId: 'memo',
                value: item.description || ''
            });
            report.commitLine({ sublistId: 'expense' });
        }
        
        /**
         * Add credit line
         */
        _addCreditLine(credit, item, overrides) {
            credit.selectNewLine({ sublistId: 'expense' });
            credit.setCurrentSublistValue({
                sublistId: 'expense',
                fieldId: 'account',
                value: overrides.defaultExpenseAccount || this._getDefaultExpenseAccount()
            });
            credit.setCurrentSublistValue({ sublistId: 'expense', fieldId: 'amount', value: item.amount || 0 });
            credit.setCurrentSublistValue({ sublistId: 'expense', fieldId: 'memo', value: item.description || '' });
            credit.commitLine({ sublistId: 'expense' });
        }
        
        /**
         * Match line item to NetSuite item
         */
        _matchItem(lineItem) {
            if (!lineItem.itemCode && !lineItem.description) return null;
            
            const filters = [];
            
            if (lineItem.itemCode) {
                filters.push(['itemid', 'contains', lineItem.itemCode]);
            }
            
            if (filters.length === 0) return null;
            
            filters.push('AND', ['isinactive', 'is', 'F']);
            
            const itemSearch = search.create({
                type: search.Type.ITEM,
                filters,
                columns: ['internalid', 'itemid', 'displayname']
            });
            
            let itemId = null;
            
            itemSearch.run().each((result) => {
                itemId = result.getValue('internalid');
                return false;
            });
            
            return itemId;
        }
        
        /**
         * Get currency internal ID
         */
        _getCurrencyId(currencyCode) {
            const currSearch = search.create({
                type: 'currency',
                filters: [['symbol', 'is', currencyCode]],
                columns: ['internalid']
            });
            
            let currId = null;
            currSearch.run().each((result) => {
                currId = result.getValue('internalid');
                return false;
            });
            
            return currId;
        }
        
        /**
         * Get default expense account
         */
        _getDefaultExpenseAccount() {
            const accountSearch = search.create({
                type: search.Type.ACCOUNT,
                filters: [
                    ['type', 'is', 'Expense'],
                    'AND',
                    ['isinactive', 'is', 'F']
                ],
                columns: ['internalid', 'acctnumber', 'name']
            });
            
            let accountId = null;
            accountSearch.run().each((result) => {
                accountId = result.getValue('internalid');
                return false;
            });
            
            return accountId;
        }
        
        /**
         * Get default expense category
         */
        _getDefaultExpenseCategory() {
            const catSearch = search.create({
                type: 'expensecategory',
                filters: [['isinactive', 'is', 'F']],
                columns: ['internalid']
            });
            
            let catId = null;
            catSearch.run().each((result) => {
                catId = result.getValue('internalid');
                return false;
            });
            
            return catId;
        }
    }
    
    // ═══════════════════════════════════════════════════════════════════════════
    // LEARNING ENGINE
    // ═══════════════════════════════════════════════════════════════════════════
    
    /**
     * LearningEngine - Learns from user corrections to improve accuracy
     */
    class LearningEngine {
        /**
         * Record a correction made by user
         */
        recordCorrection(options) {
            const { capturedDocumentId, fieldName, originalValue, correctedValue, vendorId } = options;
            
            const correction = record.create({ type: 'customrecord_dm_correction' });
            
            correction.setValue({ fieldId: 'custrecord_dm_corr_document', value: capturedDocumentId });
            correction.setValue({ fieldId: 'custrecord_dm_corr_field', value: fieldName });
            correction.setValue({ fieldId: 'custrecord_dm_corr_original', value: JSON.stringify(originalValue) });
            correction.setValue({ fieldId: 'custrecord_dm_corr_corrected', value: JSON.stringify(correctedValue) });
            
            if (vendorId) {
                correction.setValue({ fieldId: 'custrecord_dm_corr_vendor', value: vendorId });
            }
            
            return correction.save();
        }
        
        /**
         * Get learned mappings for a vendor
         */
        getVendorMappings(vendorId) {
            const mappings = {
                fieldPatterns: {},
                lineItemMappings: []
            };
            
            const corrSearch = search.create({
                type: 'customrecord_dm_correction',
                filters: [
                    ['custrecord_dm_corr_vendor', 'is', vendorId]
                ],
                columns: [
                    'custrecord_dm_corr_field',
                    'custrecord_dm_corr_original',
                    'custrecord_dm_corr_corrected'
                ]
            });
            
            corrSearch.run().each((result) => {
                const field = result.getValue('custrecord_dm_corr_field');
                const original = JSON.parse(result.getValue('custrecord_dm_corr_original') || '{}');
                const corrected = JSON.parse(result.getValue('custrecord_dm_corr_corrected') || '{}');
                
                if (!mappings.fieldPatterns[field]) {
                    mappings.fieldPatterns[field] = [];
                }
                
                mappings.fieldPatterns[field].push({ original, corrected });
                
                return true;
            });
            
            return mappings;
        }
        
        /**
         * Apply learned patterns to extraction result
         */
        applyLearnings(extractionResult, vendorId) {
            if (!vendorId) return extractionResult;
            
            const mappings = this.getVendorMappings(vendorId);
            
            // Apply field pattern corrections
            for (const [fieldName, patterns] of Object.entries(mappings.fieldPatterns)) {
                if (extractionResult.extractedFields[fieldName]) {
                    const currentValue = extractionResult.extractedFields[fieldName].value;
                    
                    for (const pattern of patterns) {
                        if (this._matchesPattern(currentValue, pattern.original)) {
                            extractionResult.extractedFields[fieldName].suggestedValue = pattern.corrected;
                            extractionResult.extractedFields[fieldName].fromLearning = true;
                            break;
                        }
                    }
                }
            }
            
            return extractionResult;
        }
        
        /**
         * Check if value matches a pattern
         */
        _matchesPattern(value, pattern) {
            if (!value || !pattern) return false;
            
            // Simple string matching for now
            return String(value).toLowerCase() === String(pattern.value || pattern).toLowerCase();
        }
    }
    
    // ═══════════════════════════════════════════════════════════════════════════
    // EXPORT PUBLIC API
    // ═══════════════════════════════════════════════════════════════════════════
    
    return {
        DocumentType,
        ProcessingStatus,
        ConfidenceLevel,
        SUPPORTED_FILE_TYPES,
        
        DocumentCaptureEngine,
        TransactionCreator,
        LearningEngine,
        
        // Convenience factory methods
        createEngine: (options) => new DocumentCaptureEngine(options),
        createTransactionCreator: (options) => new TransactionCreator(options),
        createLearningEngine: () => new LearningEngine()
    };
});
