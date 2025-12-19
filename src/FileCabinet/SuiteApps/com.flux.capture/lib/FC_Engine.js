/**
 * @NApiVersion 2.1
 * @NModuleScope Public
 * @module FluxCapture/Engine
 *
 * Flux Capture - Intelligent Document Processing Engine v2.0
 * World-class document extraction with semantic understanding,
 * multi-signal entity resolution, and active learning
 *
 * Supports multiple extraction providers:
 * - OCI Document Understanding (via N/documentCapture)
 * - Azure Form Recognizer
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
    // Debug utility
    './FC_Debug',
    // Provider factory
    './providers/ProviderFactory',
    // Extraction modules
    './extraction/FieldMatcher',
    './extraction/DateParser',
    './extraction/AmountParser',
    './extraction/LayoutAnalyzer',
    './extraction/TableAnalyzer',
    './extraction/DynamicFieldMatcher',
    // Resolution modules
    './resolution/VendorMatcher',
    './resolution/TaxIdExtractor',
    // Learning modules
    './learning/CorrectionLearner',
    './learning/AliasManager',
    // Validation modules
    './validation/CrossFieldValidator',
    // Vendor modules
    './vendors/VendorDataLoader'
], function(
    file, record, search, query, runtime, log, format, encode,
    fcDebug,
    ProviderFactoryModule,
    FieldMatcherModule, DateParserModule, AmountParserModule, LayoutAnalyzerModule, TableAnalyzerModule,
    DynamicFieldMatcherModule,
    VendorMatcherModule, TaxIdExtractorModule,
    CorrectionLearnerModule, AliasManagerModule,
    CrossFieldValidatorModule,
    VendorDataLoaderModule
) {

    'use strict';

    // Provider factory for extraction providers
    const providerFactory = ProviderFactoryModule.factory;

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

    // ==================== Flux Capture Engine v2.0 ====================

    class FluxCaptureEngine {
        constructor(options = {}) {
            this.enableLearning = options.enableLearning !== false;
            this.enableFraudDetection = options.enableFraudDetection !== false;

            // Initialize intelligent modules
            this.aliasManager = new AliasManagerModule.AliasManager();
            this.fieldMatcher = new FieldMatcherModule.FieldMatcher();
            this.dateParser = new DateParserModule.DateParser();
            this.amountParser = new AmountParserModule.AmountParser();
            this.layoutAnalyzer = new LayoutAnalyzerModule.LayoutAnalyzer();
            this.tableAnalyzer = new TableAnalyzerModule.TableAnalyzer(this.amountParser);
            this.vendorMatcher = new VendorMatcherModule.VendorMatcher(this.aliasManager);
            this.taxIdExtractor = new TaxIdExtractorModule.TaxIdExtractor();
            this.correctionLearner = new CorrectionLearnerModule.CorrectionLearner(this.aliasManager);
            this.crossFieldValidator = new CrossFieldValidatorModule.CrossFieldValidator();

            // v3.0: New modules for enhanced extraction
            this.dynamicFieldMatcher = new DynamicFieldMatcherModule.DynamicFieldMatcher();
            this.vendorDataLoader = new VendorDataLoaderModule.VendorDataLoader();

            this.vendorCache = null;

            // Extraction provider (lazy loaded)
            this._extractionProvider = null;
            this._providerConfig = options.providerConfig || null;
        }

        /**
         * Get the configured extraction provider
         * @returns {Object} Extraction provider instance
         */
        _getExtractionProvider() {
            if (!this._extractionProvider) {
                this._extractionProvider = providerFactory.getProvider(this._providerConfig);
                log.audit('FluxCaptureEngine', `Using extraction provider: ${this._extractionProvider.getProviderName()}`);
            }
            return this._extractionProvider;
        }

        /**
         * Set a specific extraction provider configuration
         * @param {Object} config - Provider configuration
         */
        setProviderConfig(config) {
            this._providerConfig = config;
            this._extractionProvider = null; // Reset to force reload
        }

        /**
         * Get current provider information
         * @returns {Object} Provider info
         */
        getProviderInfo() {
            const provider = this._getExtractionProvider();
            return {
                type: provider.getProviderType(),
                name: provider.getProviderName(),
                available: provider.checkAvailability(),
                usage: provider.getUsageInfo()
            };
        }

        /**
         * Process a document file and extract data using intelligent extraction
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

                // Stage 1: Raw OCR extraction from N/documentCapture
                const rawResult = this._extractDocumentData(fileObj, options);

                // Stage 2: Layout analysis - identify document zones
                const layout = this.layoutAnalyzer.analyze(rawResult);

                // Stage 3: Intelligent field extraction with semantic matching
                const extractionResult = this._performIntelligentExtraction(rawResult, layout, options);

                // Stage 4: Entity resolution - vendor matching with multiple signals
                const vendorMatch = this._performVendorResolution(extractionResult, rawResult.rawText);

                // Stage 4.5: Load vendor defaults LIVE from NetSuite
                let vendorDefaults = null;
                if (vendorMatch && vendorMatch.vendorId) {
                    vendorDefaults = this.vendorDataLoader.getVendorDefaults(vendorMatch.vendorId);
                    if (vendorDefaults) {
                        fcDebug.debug('FC_Engine.vendorDefaults', {
                            vendorId: vendorMatch.vendorId,
                            subsidiary: vendorDefaults.subsidiary,
                            currency: vendorDefaults.currency,
                            terms: vendorDefaults.terms
                        });
                    }
                }

                // Stage 4.6: Match unmatched extractions to custom form fields
                let customFieldMatches = {};
                if (options.formSchema && extractionResult.allExtractedFields) {
                    customFieldMatches = this.dynamicFieldMatcher.matchCustomFields(
                        extractionResult.allExtractedFields,
                        options.formSchema,
                        extractionResult.fields
                    );
                }

                // Stage 5: Cross-field validation
                const validation = this.crossFieldValidator.validate(extractionResult);

                // Stage 6: Anomaly detection if enabled
                let anomalies = [];
                if (this.enableFraudDetection) {
                    anomalies = this._detectAnomalies(extractionResult, vendorMatch, validation);
                }

                // Stage 7: Calculate confidence scores
                const confidence = this._calculateConfidence(extractionResult, vendorMatch, validation);

                const processingTime = Date.now() - startTime;
                log.audit('FluxCapture.processDocument', `Completed in ${processingTime}ms. Confidence: ${confidence.overall}%`);

                return {
                    success: true,
                    extraction: {
                        documentType: extractionResult.documentType || options.documentType || DocumentType.INVOICE,
                        fields: extractionResult.fields,
                        fieldConfidences: extractionResult.fieldConfidences || {},
                        lineItems: extractionResult.lineItems,
                        vendorMatch: vendorMatch,
                        anomalies: anomalies,
                        confidence: confidence,
                        validation: validation,
                        rawText: extractionResult.rawText,
                        pageCount: extractionResult.pageCount,
                        processingTime: processingTime,
                        allExtractedFields: extractionResult.allExtractedFields || {},
                        extractionMeta: {
                            layout: {
                                zones: Object.keys(layout.zones || {}).filter(z => (layout.zones[z] || []).length > 0),
                                tableCount: (layout.tables || []).length
                            },
                            signals: vendorMatch.signals || []
                        },
                        // v2.0: Include extraction warnings for transparency
                        extractionWarnings: extractionResult.extractionWarnings || [],
                        skippedLineItems: extractionResult.skippedLineItems || [],
                        lineItemWarnings: extractionResult.lineItemWarnings || [],
                        // v3.0: Vendor defaults loaded LIVE from NetSuite
                        vendorDefaults: vendorDefaults,
                        // v3.0: Custom field auto-matches from dynamic field matcher
                        customFieldMatches: customFieldMatches
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

            if (fileObj.size > 20971520) { // 20MB
                throw new Error('File size exceeds 20MB limit');
            }
        }

        /**
         * Extract document data using configured extraction provider
         * Supports multiple providers: OCI Document Understanding, Azure Form Recognizer
         */
        _extractDocumentData(fileObj, options) {
            const provider = this._getExtractionProvider();

            fcDebug.debug('FluxCapture.extract', `Using provider: ${provider.getProviderName()}`);

            try {
                // Use the provider to extract document data
                // Provider returns data in normalized format
                const result = provider.extract(fileObj, {
                    documentType: options.documentType,
                    language: options.language,
                    timeout: options.timeout
                });

                fcDebug.debug('FluxCapture.extract', {
                    provider: provider.getProviderType(),
                    pageCount: result.pageCount,
                    fieldCount: result.rawFields?.length || 0,
                    tableCount: result.rawTables?.length || 0
                });

                return result;

            } catch (e) {
                log.error('FluxCapture._extractDocumentData', {
                    provider: provider.getProviderType(),
                    message: e.message,
                    stack: e.stack
                });

                // Re-throw critical errors
                if (e.message && (e.message.includes('usage') || e.message.includes('limit'))) {
                    throw e;
                }

                throw new Error(`Document extraction failed: ${e.message}`);
            }
        }

        /**
         * Normalize raw N/documentCapture result (preserve for analysis)
         */
        _normalizeRawResult(result, docCapture) {
            let rawText = '';
            const pageCount = result.pages ? result.pages.length : 1;
            const rawFields = [];
            const rawTables = [];

            // ============= DEBUG: Log raw result structure =============
            fcDebug.debugAudit('DEBUG.RawResult', '========== RAW N/documentCapture RESULT ==========');
            fcDebug.debugAudit('DEBUG.RawResult.Keys', `Top-level keys: ${Object.keys(result || {}).join(', ')}`);
            fcDebug.debugAudit('DEBUG.RawResult.PageCount', `Pages: ${result.pages ? result.pages.length : 'NO PAGES'}`);

            // Log the entire raw result structure (truncated for large objects)
            try {
                const resultSummary = {
                    hasPages: !!result.pages,
                    pageCount: result.pages?.length || 0,
                    mimeType: result.mimeType,
                    topLevelKeys: Object.keys(result || {})
                };
                fcDebug.debugAudit('DEBUG.RawResult.Summary', JSON.stringify(resultSummary));
            } catch (e) {
                fcDebug.debug('DEBUG.RawResult.Summary', 'Could not stringify summary: ' + e.message);
            }

            if (result.pages && result.pages.length > 0) {
                result.pages.forEach((page, pageIndex) => {
                    // ============= DEBUG: Log page structure =============
                    fcDebug.debugAudit(`DEBUG.Page[${pageIndex}]`, `Page ${pageIndex + 1} keys: ${Object.keys(page || {}).join(', ')}`);
                    fcDebug.debugAudit(`DEBUG.Page[${pageIndex}].Counts`, JSON.stringify({
                        fields: page.fields?.length || 0,
                        tables: page.tables?.length || 0,
                        lines: page.lines?.length || 0,
                        hasGetText: typeof page.getText === 'function'
                    }));

                    // Extract text
                    if (typeof page.getText === 'function') {
                        rawText += page.getText() + '\n';
                    } else if (page.lines) {
                        page.lines.forEach(line => {
                            const lineText = line.text || (line.words ? line.words.map(w => w.text || w).join(' ') : '');
                            if (lineText) rawText += lineText + '\n';
                        });
                    }

                    // Collect raw fields with DEBUG logging
                    if (page.fields && page.fields.length > 0) {
                        fcDebug.debugAudit(`DEBUG.Page[${pageIndex}].Fields`, `Processing ${page.fields.length} fields...`);

                        page.fields.forEach((field, fieldIndex) => {
                            // ============= DEBUG: Log each field's raw structure =============
                            const fieldDebug = {
                                index: fieldIndex,
                                fieldKeys: Object.keys(field || {}),
                                labelType: typeof field.label,
                                labelKeys: typeof field.label === 'object' ? Object.keys(field.label || {}) : null,
                                labelRaw: this._safeStringify(field.label, 100),
                                valueType: typeof field.value,
                                valueKeys: typeof field.value === 'object' ? Object.keys(field.value || {}) : null,
                                valueRaw: this._safeStringify(field.value, 100),
                                confidence: field.confidence,
                                type: field.type,
                                boundingBox: field.boundingBox ? 'present' : 'absent'
                            };
                            fcDebug.debug(`DEBUG.Field[${pageIndex}][${fieldIndex}]`, JSON.stringify(fieldDebug));

                            const extractedLabel = this._extractText(field.label);
                            const extractedValue = this._extractText(field.value);

                            // Log what we extracted
                            fcDebug.debugAudit(`DEBUG.Field.Extracted[${fieldIndex}]`,
                                `"${extractedLabel}" = "${extractedValue}" (conf: ${field.label?.confidence || field.confidence || 'N/A'})`);

                            rawFields.push({
                                page: pageIndex,
                                label: extractedLabel,
                                labelConfidence: field.label?.confidence || 0.5,
                                value: extractedValue,
                                valueConfidence: field.value?.confidence || field.confidence || 0.5,
                                position: field.boundingBox || field.bbox || null,
                                // Store raw for debugging
                                _rawLabel: field.label,
                                _rawValue: field.value,
                                _rawType: field.type
                            });
                        });
                    }

                    // Collect raw tables with DEBUG logging
                    if (page.tables && page.tables.length > 0) {
                        fcDebug.debugAudit(`DEBUG.Page[${pageIndex}].Tables`, `Processing ${page.tables.length} tables...`);

                        page.tables.forEach((table, tableIndex) => {
                            // ============= DEBUG: Log table structure =============
                            const tableDebug = {
                                index: tableIndex,
                                tableKeys: Object.keys(table || {}),
                                headerRowCount: table.headerRows?.length || 0,
                                bodyRowCount: table.bodyRows?.length || 0,
                                footerRowCount: table.footerRows?.length || 0,
                                confidence: table.confidence
                            };
                            fcDebug.debugAudit(`DEBUG.Table[${pageIndex}][${tableIndex}]`, JSON.stringify(tableDebug));

                            // Log first header row structure if present
                            if (table.headerRows && table.headerRows.length > 0) {
                                const headerRow = table.headerRows[0];
                                fcDebug.debug(`DEBUG.Table[${tableIndex}].HeaderRow`,
                                    `Type: ${typeof headerRow}, IsArray: ${Array.isArray(headerRow)}, ` +
                                    `Keys: ${typeof headerRow === 'object' ? Object.keys(headerRow).join(',') : 'N/A'}`);
                                if (headerRow.cells || Array.isArray(headerRow)) {
                                    const cells = headerRow.cells || headerRow;
                                    fcDebug.debug(`DEBUG.Table[${tableIndex}].HeaderCells`,
                                        `Count: ${cells.length}, Values: ${cells.slice(0, 5).map(c => this._safeStringify(c, 30)).join(' | ')}`);
                                }
                            }

                            // Log first body row structure if present
                            if (table.bodyRows && table.bodyRows.length > 0) {
                                const bodyRow = table.bodyRows[0];
                                fcDebug.debug(`DEBUG.Table[${tableIndex}].BodyRow[0]`,
                                    `Type: ${typeof bodyRow}, IsArray: ${Array.isArray(bodyRow)}, ` +
                                    `Keys: ${typeof bodyRow === 'object' ? Object.keys(bodyRow).join(',') : 'N/A'}`);
                                if (bodyRow.cells || Array.isArray(bodyRow)) {
                                    const cells = bodyRow.cells || bodyRow;
                                    fcDebug.debug(`DEBUG.Table[${tableIndex}].BodyCells[0]`,
                                        `Count: ${cells.length}, Values: ${cells.slice(0, 5).map(c => this._safeStringify(c, 30)).join(' | ')}`);
                                }
                            }

                            rawTables.push({
                                page: pageIndex,
                                index: tableIndex,
                                headerRows: table.headerRows,
                                bodyRows: table.bodyRows,
                                footerRows: table.footerRows,
                                confidence: table.confidence
                            });
                        });
                    }
                });
            }

            // ============= DEBUG: Log final extracted data summary =============
            fcDebug.debugAudit('DEBUG.Extraction.Summary', JSON.stringify({
                totalFields: rawFields.length,
                totalTables: rawTables.length,
                rawTextLength: rawText.length,
                rawTextPreview: rawText.substring(0, 500)
            }));

            // Log all extracted field label/value pairs
            fcDebug.debugAudit('DEBUG.AllFields', '---------- ALL EXTRACTED FIELDS ----------');
            rawFields.forEach((f, i) => {
                fcDebug.debugAudit(`DEBUG.AllFields[${i}]`, `"${f.label}" => "${f.value}"`);
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
         * Safely stringify an object for logging (with truncation)
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
         * Perform intelligent extraction using semantic matching
         * v2.0: Collects warnings from all extraction modules
         */
        _performIntelligentExtraction(rawResult, layout, options) {
            const fields = {
                vendorName: null,
                vendorAddress: null,
                invoiceNumber: null,
                invoiceDate: null,
                dueDate: null,
                poNumber: null,
                memo: null,
                paymentTerms: null,
                subtotal: 0,
                taxAmount: 0,
                totalAmount: 0,
                currency: 'USD'
            };

            const fieldConfidences = {};
            const fieldCandidates = {};
            const extractionWarnings = []; // Collect all warnings

            // Build context for extraction
            const extractionContext = {
                vendorCountry: options.vendorCountry || null,
                vendorLocale: options.vendorLocale || null,
                learnedFormat: null // Will be set if vendor has learned format
            };

            // Get learned formats if we have a vendor
            if (options.vendorId) {
                const dateFormat = this.correctionLearner.getVendorDateFormat(options.vendorId);
                const amountFormat = this.correctionLearner.getVendorAmountFormat(options.vendorId);

                if (dateFormat && dateFormat.format) {
                    extractionContext.dateFormat = dateFormat.format;
                    extractionContext.learnedFormat = dateFormat.format;
                    fcDebug.debug('FC_Engine.extraction', `Using learned date format for vendor ${options.vendorId}: ${dateFormat.format}`);
                }
                if (amountFormat && amountFormat.format) {
                    extractionContext.amountFormat = amountFormat.format;
                }
            }

            // Process each raw field with semantic matching
            for (const rawField of rawResult.rawFields) {
                // Determine zone for this field
                const zone = layout.zones ?
                    this._determineFieldZone(rawField.position, layout) :
                    null;

                // Get nearby labels for context
                const nearbyLabels = zone ?
                    this.layoutAnalyzer.getNearbyLabels(layout, rawField.position) :
                    [];

                // Match field using semantic matcher
                const match = this.fieldMatcher.match(rawField.label, {
                    zone: zone,
                    nearbyLabels: nearbyLabels,
                    position: rawField.position
                });

                if (match && match.field) {
                    // Store as candidate
                    if (!fieldCandidates[match.field]) {
                        fieldCandidates[match.field] = [];
                    }

                    fieldCandidates[match.field].push({
                        label: rawField.label,
                        value: rawField.value,
                        confidence: rawField.valueConfidence,
                        matchScore: match.score,
                        zone: zone,
                        position: rawField.position
                    });
                }
            }

            // Resolve best candidate for each field
            // IMPORTANT: Parse invoiceDate FIRST so it's available for dueDate validation
            const fieldOrder = ['invoiceDate', 'dueDate', ...Object.keys(fieldCandidates).filter(f => f !== 'invoiceDate' && f !== 'dueDate')];

            for (const fieldName of fieldOrder) {
                const candidates = fieldCandidates[fieldName];
                if (!candidates) continue;

                const best = this.fieldMatcher.resolveMultipleCandidates(fieldName, candidates);
                if (best) {
                    // Update context with parsed invoiceDate for dueDate parsing
                    if (fieldName === 'dueDate' && fields.invoiceDate) {
                        extractionContext.invoiceDate = fields.invoiceDate;
                    }

                    // Parse the value based on field type
                    const parsedValue = this._parseFieldValue(fieldName, best.value, extractionContext, extractionWarnings);

                    if (parsedValue !== null && parsedValue !== undefined) {
                        fields[fieldName] = parsedValue;
                        fieldConfidences[fieldName] = best.combinedScore || best.matchScore || 0.7;
                    }
                }
            }

            // Extract line items from tables
            let lineItems = [];
            let lineItemWarnings = [];
            let skippedLineItems = [];
            let tableDiagnostics = [];
            let lineItemExtractionMethod = 'table_analyzer'; // Track how we extracted line items

            // ========== LINE ITEM EXTRACTION DIAGNOSTICS ==========
            fcDebug.debugAudit('FC_Engine.LINEITEM_START', JSON.stringify({
                rawTableCount: rawResult.rawTables?.length || 0,
                hasLayoutTable: !!layout.lineItemsTable,
                hasAzureResult: !!rawResult._azureResult,
                hasMindeeResult: !!rawResult._mindeeResult
            }));

            // v4.0: CHECK FOR PROVIDER-NATIVE STRUCTURED LINE ITEMS
            // Azure and Mindee already extract line items in a structured format
            // Use them directly instead of re-processing through TableAnalyzer
            const providerLineItems = this._extractProviderNativeLineItems(rawResult, extractionContext);

            if (providerLineItems && providerLineItems.items.length > 0) {
                // Use provider-native line items directly - skip TableAnalyzer
                lineItems = providerLineItems.items;
                lineItemExtractionMethod = providerLineItems.method;
                lineItemWarnings = providerLineItems.warnings || [];
                extractionWarnings.push(...lineItemWarnings);

                fcDebug.debugAudit('FC_Engine.PROVIDER_NATIVE_LINEITEMS', JSON.stringify({
                    method: lineItemExtractionMethod,
                    itemCount: lineItems.length,
                    confidence: providerLineItems.confidence
                }));

                // Log each provider-native line item
                lineItems.forEach((item, idx) => {
                    fcDebug.debugAudit(`FC_Engine.LINEITEM[${idx}]`, JSON.stringify({
                        desc: (item.description || '').substring(0, 50),
                        code: item.itemCode,
                        qty: item.quantity,
                        rate: item.unitPrice,
                        amt: item.amount,
                        source: 'provider_native'
                    }));
                });
            }
            // Fall back to TableAnalyzer for OCI or when provider doesn't have structured items
            else if (rawResult.rawTables && rawResult.rawTables.length > 0) {
                // Log all tables found
                rawResult.rawTables.forEach((t, idx) => {
                    fcDebug.debugAudit(`FC_Engine.TABLE[${idx}]`, JSON.stringify({
                        headerRows: t.headerRows?.length || 0,
                        bodyRows: t.bodyRows?.length || 0,
                        footerRows: t.footerRows?.length || 0,
                        confidence: t.confidence
                    }));
                });

                // Find the line items table (usually the largest)
                const lineItemsTable = layout.lineItemsTable?.raw ||
                    rawResult.rawTables.reduce((best, t) =>
                        (t.bodyRows?.length || 0) > (best?.bodyRows?.length || 0) ? t : best,
                        null
                    );

                if (lineItemsTable) {
                    fcDebug.debugAudit('FC_Engine.SELECTED_TABLE', JSON.stringify({
                        bodyRows: lineItemsTable.bodyRows?.length || 0,
                        headerRows: lineItemsTable.headerRows?.length || 0,
                        reason: layout.lineItemsTable ? 'layout_detected' : 'largest_table'
                    }));

                    // Pass table index for logging
                    extractionContext.tableIndex = 0;
                    const tableResult = this.tableAnalyzer.analyze(lineItemsTable, extractionContext);
                    lineItems = tableResult.lineItems;

                    // Store diagnostics for return
                    if (tableResult.diagnostics) {
                        tableDiagnostics = tableResult.diagnostics;
                    }

                    // Log extraction result summary
                    fcDebug.debugAudit('FC_Engine.LINEITEM_RESULT', JSON.stringify({
                        extractedCount: lineItems.length,
                        skippedCount: tableResult.skippedItems?.length || 0,
                        warningCount: tableResult.warnings?.length || 0,
                        totalFromItems: tableResult.totalFromItems,
                        confidence: tableResult.confidence?.toFixed(2)
                    }));

                    // Log each line item extracted
                    lineItems.forEach((item, idx) => {
                        fcDebug.debugAudit(`FC_Engine.LINEITEM[${idx}]`, JSON.stringify({
                            desc: (item.description || '').substring(0, 50),
                            code: item.itemCode,
                            qty: item.quantity,
                            rate: item.unitPrice,
                            amt: item.amount,
                            hasMemo: !!item.memo,
                            flags: {
                                needsDescReview: item._needsDescriptionReview,
                                needsAmtReview: item._needsAmountReview,
                                amtCalculated: item._amountCalculated
                            }
                        }));
                    });

                    // Collect TableAnalyzer warnings
                    if (tableResult.warnings && tableResult.warnings.length > 0) {
                        lineItemWarnings = tableResult.warnings;
                        extractionWarnings.push(...tableResult.warnings);
                    }

                    // Track skipped items for visibility
                    if (tableResult.skippedItems && tableResult.skippedItems.length > 0) {
                        skippedLineItems = tableResult.skippedItems;
                    }
                }
            }

            // Detect document type
            const documentType = this._detectDocumentType({ text: rawResult.rawText });

            // Try to infer missing amounts
            this._inferMissingAmounts(fields, lineItems);

            // v4.0: Cross-validate line items sum vs extracted totals
            if (lineItems.length > 0) {
                const lineItemsSum = lineItems.reduce((sum, item) => sum + (item.amount || 0), 0);
                const roundedSum = Math.round(lineItemsSum * 100) / 100;

                // Check against subtotal or total if available
                let validationTarget = null;
                let validationTargetName = '';

                if (fields.subtotal) {
                    const subtotalAmount = this.amountParser.parse(fields.subtotal, extractionContext);
                    if (subtotalAmount.amount > 0) {
                        validationTarget = subtotalAmount.amount;
                        validationTargetName = 'subtotal';
                    }
                }

                if (!validationTarget && fields.totalAmount) {
                    const totalAmount = this.amountParser.parse(fields.totalAmount, extractionContext);
                    if (totalAmount.amount > 0) {
                        validationTarget = totalAmount.amount;
                        validationTargetName = 'total';
                    }
                }

                if (validationTarget) {
                    const diff = Math.abs(roundedSum - validationTarget);
                    const diffPercent = validationTarget > 0 ? (diff / validationTarget) * 100 : 0;

                    fcDebug.debugAudit('FC_Engine.LINEITEM_SUM_VALIDATION', JSON.stringify({
                        lineItemsSum: roundedSum,
                        target: validationTarget,
                        targetType: validationTargetName,
                        diff: diff.toFixed(2),
                        diffPercent: diffPercent.toFixed(1)
                    }));

                    // If significant mismatch (>5%), flag for review
                    if (diffPercent > 5 && diff > 1) {
                        extractionWarnings.push({
                            type: 'line_item_sum_mismatch',
                            message: `Line items sum (${roundedSum.toFixed(2)}) doesn't match ${validationTargetName} (${validationTarget.toFixed(2)}) - ${diffPercent.toFixed(1)}% difference`,
                            data: {
                                lineItemsSum: roundedSum,
                                expectedTotal: validationTarget,
                                difference: diff,
                                differencePercent: diffPercent
                            }
                        });
                    }
                }
            }

            fcDebug.debug('FluxCapture.intelligentExtraction', {
                fieldsExtracted: Object.keys(fields).filter(k => fields[k]).length,
                lineItems: lineItems.length,
                documentType: DocumentTypeLabels[documentType]
            });

            // Collect ALL extracted label/value pairs for flexible field mapping
            // This allows the UI to offer suggestions for any form field
            const allExtractedFields = {};
            for (const rawField of rawResult.rawFields) {
                if (rawField.label && rawField.value) {
                    // Normalize label to a field key
                    const normalizedKey = this._normalizeFieldKey(rawField.label);
                    if (normalizedKey && !allExtractedFields[normalizedKey]) {
                        allExtractedFields[normalizedKey] = {
                            label: rawField.label,
                            value: rawField.value,
                            confidence: rawField.valueConfidence || 0.5,
                            position: rawField.position
                        };
                    }
                }
            }

            return {
                documentType: documentType,
                fields: fields,
                fieldConfidences: fieldConfidences,
                lineItems: lineItems,
                rawText: rawResult.rawText,
                pageCount: rawResult.pageCount,
                // Include all raw extractions for flexible field suggestions
                allExtractedFields: allExtractedFields,
                fieldCandidates: fieldCandidates,
                // v2.0: Include extraction warnings and skipped items
                extractionWarnings: extractionWarnings,
                skippedLineItems: skippedLineItems,
                lineItemWarnings: lineItemWarnings,
                // v3.0: Include table diagnostics for debugging
                tableDiagnostics: tableDiagnostics,
                // v4.0: Track how line items were extracted
                lineItemExtractionMethod: lineItemExtractionMethod
            };
        }

        /**
         * Normalize a field label to a key for matching
         */
        _normalizeFieldKey(label) {
            if (!label) return null;
            return label
                .toLowerCase()
                .replace(/[^a-z0-9]/g, '')
                .substring(0, 50);
        }

        /**
         * Determine which zone a field belongs to based on position
         */
        _determineFieldZone(position, layout) {
            if (!position || !layout.zones) return null;

            const y = position.y || 0;

            // Simple zone determination based on vertical position
            if (y < 0.25) return 'HEADER';
            if (y > 0.75) return 'TOTALS';
            if (y > 0.25 && y < 0.75) return 'LINE_ITEMS';

            return null;
        }

        /**
         * Parse field value based on type with intelligent parsing
         * v2.0: Collects warnings and returns structured result
         */
        _parseFieldValue(fieldName, rawValue, context, warningsArray) {
            if (!rawValue) return null;

            const value = String(rawValue).trim();

            // Date fields
            if (fieldName === 'invoiceDate' || fieldName === 'dueDate') {
                const dateContext = {
                    vendorCountry: context.vendorCountry,
                    fieldType: fieldName,
                    invoiceDate: fieldName === 'dueDate' ? context.invoiceDate : null,
                    learnedFormat: context.learnedFormat || context.dateFormat
                };

                // Check if this is relative date term (Net 30)
                if (fieldName === 'dueDate' && /net\s*\d+/i.test(value)) {
                    if (context.invoiceDate) {
                        const relative = this.dateParser.parseRelativeDate(value, context.invoiceDate);
                        if (relative) {
                            return relative.date;
                        }
                    } else {
                        // Add warning if we can't parse relative date without invoice date
                        if (warningsArray) {
                            warningsArray.push({
                                type: 'relative_date_no_base',
                                message: `Cannot calculate "${value}" without invoice date`,
                                field: fieldName,
                                rawValue: value
                            });
                        }
                    }
                }

                // Use learned format if available
                if (context.dateFormat) {
                    dateContext.vendorCountry = context.dateFormat === 'DMY' ? 'GB' : 'US';
                }

                const result = this.dateParser.parse(value, dateContext);

                // Collect any date parsing warnings
                if (warningsArray && result.warnings && result.warnings.length > 0) {
                    result.warnings.forEach(w => {
                        warningsArray.push({
                            ...w,
                            field: fieldName
                        });
                    });
                }

                // If date was corrected, log it
                if (result.corrected) {
                    fcDebug.debug('FC_Engine.parseFieldValue',
                        `Date ${fieldName} corrected from ${result.originalInterpretation} to ${result.date}`
                    );
                }

                return result.date;
            }

            // Amount fields
            if (['subtotal', 'taxAmount', 'totalAmount'].includes(fieldName)) {
                const amountContext = {
                    vendorCountry: context.vendorCountry,
                    currency: context.currency
                };

                // Use learned format if available
                if (context.amountFormat) {
                    amountContext.vendorLocale = context.amountFormat === 'COMMA' ? 'DE' : 'US';
                }

                const result = this.amountParser.parse(value, amountContext);

                // Extract currency if found
                if (result.currency && !context.currency) {
                    context.currency = result.currency;
                }

                return result.amount;
            }

            // String fields
            return value;
        }

        /**
         * Infer missing amounts from available data
         */
        _inferMissingAmounts(fields, lineItems) {
            // Calculate line items total
            const lineItemsTotal = lineItems.reduce((sum, item) =>
                sum + (item.amount || 0), 0
            );

            // If we have line items but no subtotal
            if (lineItemsTotal > 0 && !fields.subtotal) {
                fields.subtotal = Math.round(lineItemsTotal * 100) / 100;
            }

            // If we have subtotal and tax but no total
            if (fields.subtotal && fields.taxAmount && !fields.totalAmount) {
                fields.totalAmount = Math.round((fields.subtotal + fields.taxAmount) * 100) / 100;
            }

            // If we have subtotal and total but no tax
            if (fields.subtotal && fields.totalAmount && !fields.taxAmount) {
                const inferredTax = fields.totalAmount - fields.subtotal;
                if (inferredTax >= 0) {
                    fields.taxAmount = Math.round(inferredTax * 100) / 100;
                }
            }
        }

        /**
         * Perform vendor resolution using multiple signals
         */
        _performVendorResolution(extraction, rawText) {
            const fields = extraction.fields;

            // Extract additional signals from raw text
            const taxIdResult = this.taxIdExtractor.extractPrimary(rawText);
            const emailMatch = rawText.match(/[\w.-]+@[\w.-]+\.\w{2,}/);
            const phoneMatch = rawText.match(/(?:\+?1[-.]?)?\(?[0-9]{3}\)?[-.]?[0-9]{3}[-.]?[0-9]{4}/);

            // Build signal data for matching
            const signalData = {
                vendorName: fields.vendorName,
                taxId: taxIdResult?.value || null,
                email: emailMatch ? emailMatch[0] : null,
                phone: phoneMatch ? phoneMatch[0] : null,
                address: fields.vendorAddress
            };

            // Perform multi-signal matching
            const matchResult = this.vendorMatcher.match(signalData);

            // Enhance result with tax ID info
            if (taxIdResult) {
                matchResult.taxId = {
                    value: taxIdResult.value,
                    type: taxIdResult.type,
                    confidence: taxIdResult.confidence
                };
            }

            return matchResult;
        }

        /**
         * Detect anomalies in extracted data
         */
        _detectAnomalies(extraction, vendorMatch, validation) {
            const anomalies = [];
            const fields = extraction.fields;

            // Add validation issues as anomalies
            if (validation && validation.issues) {
                validation.issues.forEach(issue => {
                    anomalies.push({
                        type: issue.type,
                        field: issue.field || issue.fields?.[0],
                        severity: issue.severity === 'error' ? 'high' :
                            issue.severity === 'warning' ? 'medium' : 'low',
                        message: issue.message,
                        suggestion: issue.suggestion
                    });
                });
            }

            // Vendor not found
            if (!vendorMatch.vendorId) {
                anomalies.push({
                    type: 'vendor_not_found',
                    field: 'vendorName',
                    severity: 'medium',
                    message: `Vendor "${fields.vendorName || 'Unknown'}" not found in system`,
                    suggestion: vendorMatch.suggestions?.length > 0 ?
                        `Did you mean: ${vendorMatch.suggestions[0].companyName}?` :
                        'Add vendor to system or select from suggestions'
                });
            } else if (vendorMatch.confidence < 0.8) {
                anomalies.push({
                    type: 'low_vendor_confidence',
                    field: 'vendorName',
                    severity: 'low',
                    message: `Vendor match confidence is ${Math.round(vendorMatch.confidence * 100)}%`
                });
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

            return anomalies;
        }

        /**
         * Check for duplicate invoice
         */
        _checkDuplicateInvoice(vendorId, invoiceNumber) {
            try {
                const sql = `
                    SELECT COUNT(*) as cnt
                    FROM customrecord_flux_document
                    WHERE custrecord_flux_vendor = ?
                    AND LOWER(custrecord_flux_invoice_number) = LOWER(?)
                    AND custrecord_flux_status IN (${DocStatus.EXTRACTED}, ${DocStatus.NEEDS_REVIEW}, ${DocStatus.COMPLETED})
                `;
                const result = query.runSuiteQL({ query: sql, params: [vendorId, invoiceNumber] });
                return result.results[0].values[0] > 0;
            } catch (e) {
                fcDebug.debug('FluxCapture._checkDuplicateInvoice', e.message);
                return false;
            }
        }

        /**
         * Calculate comprehensive confidence scores
         */
        _calculateConfidence(extraction, vendorMatch, validation) {
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

            // Score each field
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

            // Penalty for validation errors
            if (validation && validation.summary) {
                totalScore -= validation.summary.errors * 5;
                totalScore -= validation.summary.warnings * 2;
            }

            const overall = maxScore > 0 ? Math.round(Math.max(0, totalScore / maxScore) * 100) : 0;

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
         * Detect document type from text content
         * Biased towards INVOICE as that's the most common B2B document type
         */
        _detectDocumentType(result) {
            const text = (result.text || '').toLowerCase();

            // Credit Memo: explicit keywords only
            if (text.includes('credit memo') || text.includes('credit note') ||
                (text.includes('credit') && text.includes('adjustment'))) {
                return DocumentType.CREDIT_MEMO;
            }

            // Expense Report: only for explicit expense/reimbursement documents
            // NOT regular receipts - those should be invoices
            if ((text.includes('expense report') || text.includes('expense claim') ||
                text.includes('reimbursement') || text.includes('travel expense')) &&
                !text.includes('invoice')) {
                return DocumentType.EXPENSE_REPORT;
            }

            // Purchase Order: very strict - only explicit "purchase order" header
            // Avoid false positives from "order number", "order date", etc.
            if (text.includes('purchase order') &&
                !text.includes('invoice') && !text.includes('bill')) {
                return DocumentType.PURCHASE_ORDER;
            }

            // Default to INVOICE - most B2B documents are vendor bills/invoices
            return DocumentType.INVOICE;
        }

        /**
         * Extract text from various field formats
         */
        _extractText(obj) {
            if (!obj) return null;
            if (typeof obj === 'string') return obj;
            if (typeof obj === 'number') return String(obj);
            return obj.text || obj.name || obj.value || obj.content || null;
        }

        /**
         * v4.0: Extract line items directly from provider-native structured data
         * This bypasses TableAnalyzer for Azure/Mindee which already extract structured line items
         * @param {Object} rawResult - Raw extraction result from provider
         * @param {Object} context - Extraction context
         * @returns {Object|null} { items: Array, method: string, confidence: number, warnings: Array }
         */
        _extractProviderNativeLineItems(rawResult, context = {}) {
            // Check for Azure native line items
            if (rawResult._azureResult) {
                return this._extractAzureNativeLineItems(rawResult._azureResult, context);
            }

            // Check for Mindee native line items
            if (rawResult._mindeeResult) {
                return this._extractMindeeNativeLineItems(rawResult._mindeeResult, context);
            }

            return null;
        }

        /**
         * v4.0: Extract line items directly from Azure Form Recognizer result
         * Azure's prebuilt-invoice model provides highly accurate structured line items
         */
        _extractAzureNativeLineItems(azureResult, context) {
            const items = [];
            const warnings = [];

            try {
                const documents = azureResult.documents || [];
                if (documents.length === 0) return null;

                const doc = documents[0];
                const fields = doc.fields || {};
                const itemsField = fields.Items || fields.LineItems;

                if (!itemsField || !itemsField.valueArray || itemsField.valueArray.length === 0) {
                    return null;
                }

                fcDebug.debugAudit('FC_Engine.AZURE_NATIVE', `Found ${itemsField.valueArray.length} Azure native line items`);

                // Azure field name mappings
                const fieldMap = {
                    'Description': 'description',
                    'ProductCode': 'itemCode',
                    'Quantity': 'quantity',
                    'Unit': 'unit',
                    'UnitPrice': 'unitPrice',
                    'Amount': 'amount',
                    'Tax': 'tax',
                    'Date': 'date'
                };

                for (const itemData of itemsField.valueArray) {
                    const itemFields = itemData.valueObject || {};
                    const item = {
                        itemCode: null,
                        description: '',
                        memo: null,
                        quantity: null,
                        unit: null,
                        unitPrice: null,
                        amount: null,
                        tax: null,
                        confidence: 0.9,
                        _source: 'azure_native'
                    };

                    let confSum = 0;
                    let confCount = 0;

                    for (const [azureField, ourField] of Object.entries(fieldMap)) {
                        const fieldData = itemFields[azureField];
                        if (!fieldData) continue;

                        let value = null;
                        if (fieldData.type === 'currency' && fieldData.valueCurrency) {
                            value = fieldData.valueCurrency.amount;
                        } else if (fieldData.type === 'number') {
                            value = fieldData.valueNumber;
                        } else {
                            value = fieldData.valueString || fieldData.content;
                        }

                        if (value !== null && value !== undefined) {
                            item[ourField] = value;
                            if (fieldData.confidence) {
                                confSum += fieldData.confidence;
                                confCount++;
                            }
                        }
                    }

                    // Calculate item confidence
                    if (confCount > 0) {
                        item.confidence = confSum / confCount;
                    }

                    // v4.0: Apply math validation for Azure items too
                    if (item.quantity > 0 && item.unitPrice > 0 && item.amount !== null) {
                        const expected = Math.round(item.quantity * item.unitPrice * 100) / 100;
                        if (Math.abs(expected - item.amount) > 0.02) {
                            item._mathMismatch = true;
                            item._expectedAmount = expected;
                        } else {
                            item._mathValidated = true;
                        }
                    }

                    // Only include items with some meaningful data
                    if (item.description || item.itemCode || item.amount !== null) {
                        items.push(item);
                    }
                }

                if (items.length > 0) {
                    return {
                        items: items,
                        method: 'azure_native',
                        confidence: 0.95,
                        warnings: warnings
                    };
                }
            } catch (e) {
                fcDebug.debug('FC_Engine._extractAzureNativeLineItems', `Error: ${e.message}`);
                warnings.push({
                    type: 'azure_extraction_error',
                    message: `Failed to extract Azure native line items: ${e.message}`
                });
            }

            return null;
        }

        /**
         * v4.0: Extract line items directly from Mindee result
         * Mindee's invoice model provides structured line_items array
         */
        _extractMindeeNativeLineItems(mindeeResult, context) {
            const items = [];
            const warnings = [];

            try {
                const document = mindeeResult.document || {};
                const inference = document.inference || {};
                const prediction = inference.prediction || {};
                const lineItemsData = prediction.line_items || [];

                if (lineItemsData.length === 0) return null;

                fcDebug.debugAudit('FC_Engine.MINDEE_NATIVE', `Found ${lineItemsData.length} Mindee native line items`);

                // Mindee field name mappings
                const fieldMap = {
                    'description': 'description',
                    'product_code': 'itemCode',
                    'quantity': 'quantity',
                    'unit_measure': 'unit',
                    'unit_price': 'unitPrice',
                    'total_amount': 'amount',
                    'tax_amount': 'tax',
                    'tax_rate': 'taxRate'
                };

                for (const itemData of lineItemsData) {
                    const item = {
                        itemCode: null,
                        description: '',
                        memo: null,
                        quantity: null,
                        unit: null,
                        unitPrice: null,
                        amount: null,
                        tax: null,
                        confidence: 0.9,
                        _source: 'mindee_native'
                    };

                    let confSum = 0;
                    let confCount = 0;

                    for (const [mindeeField, ourField] of Object.entries(fieldMap)) {
                        const fieldData = itemData[mindeeField];
                        if (!fieldData) continue;

                        let value = null;
                        let confidence = 0;

                        // Mindee can return {value, confidence} objects or direct values
                        if (typeof fieldData === 'object' && 'value' in fieldData) {
                            value = fieldData.value;
                            confidence = fieldData.confidence || 0;
                        } else if (typeof fieldData === 'object' && 'amount' in fieldData) {
                            value = fieldData.amount;
                            confidence = fieldData.confidence || 0;
                        } else {
                            value = fieldData;
                            confidence = 1;
                        }

                        if (value !== null && value !== undefined && value !== '') {
                            item[ourField] = value;
                            confSum += confidence;
                            confCount++;
                        }
                    }

                    // Calculate item confidence
                    if (confCount > 0) {
                        item.confidence = confSum / confCount;
                    }

                    // v4.0: Apply math validation for Mindee items too
                    if (item.quantity > 0 && item.unitPrice > 0 && item.amount !== null) {
                        const expected = Math.round(item.quantity * item.unitPrice * 100) / 100;
                        if (Math.abs(expected - item.amount) > 0.02) {
                            item._mathMismatch = true;
                            item._expectedAmount = expected;
                        } else {
                            item._mathValidated = true;
                        }
                    }

                    // Only include items with some meaningful data
                    if (item.description || item.itemCode || item.amount !== null) {
                        items.push(item);
                    }
                }

                if (items.length > 0) {
                    return {
                        items: items,
                        method: 'mindee_native',
                        confidence: 0.92,
                        warnings: warnings
                    };
                }
            } catch (e) {
                fcDebug.debug('FC_Engine._extractMindeeNativeLineItems', `Error: ${e.message}`);
                warnings.push({
                    type: 'mindee_extraction_error',
                    message: `Failed to extract Mindee native line items: ${e.message}`
                });
            }

            return null;
        }

        /**
         * Simulate extraction for testing/demo
         */
        _simulateExtraction(fileObj) {
            const fileName = fileObj.name || '';
            log.audit('FluxCapture.simulate', `Simulating extraction for: ${fileName}`);

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

            return {
                pages: [],
                rawFields: [],
                rawTables: [],
                rawText: '[Document capture not available - data extracted from filename]',
                pageCount: 1,
                mimeType: fileObj.fileType || null,
                // Provide simulated structure
                fields: {
                    vendorName: vendorName,
                    vendorAddress: null,
                    invoiceNumber: invoiceNumber,
                    invoiceDate: invoiceDate,
                    dueDate: invoiceDate ? new Date(invoiceDate.getTime() + 30 * 24 * 60 * 60 * 1000) : null,
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
                }
            };
        }

        /**
         * Learn from a user correction
         * @param {Object} correction - Correction data
         * @returns {Object} Learning result
         */
        learnFromCorrection(correction) {
            if (!this.enableLearning) {
                return { success: false, reason: 'Learning disabled' };
            }

            return this.correctionLearner.learn(correction);
        }

        /**
         * Get vendor suggestions based on extracted name
         * @param {string} vendorName - Extracted vendor name
         * @returns {Array} Vendor suggestions
         */
        getVendorSuggestions(vendorName) {
            return this.aliasManager.getSuggestions(vendorName, 5);
        }

        /**
         * Get suggested GL account for line item
         * @param {number} vendorId - Vendor ID
         * @param {string} description - Line item description
         * @returns {Object|null} Suggested account
         */
        getSuggestedAccount(vendorId, description) {
            return this.correctionLearner.getSuggestedAccount(vendorId, description);
        }

        /**
         * Check remaining usage for the current provider
         * @returns {Object|null} Usage info or null if unavailable
         */
        getRemainingUsage() {
            try {
                const provider = this._getExtractionProvider();
                return provider.getUsageInfo();
            } catch (e) {
                fcDebug.debug('getRemainingUsage', e.message);
                return null;
            }
        }

        /**
         * Get alias statistics
         */
        getAliasStats() {
            return this.aliasManager.getStats();
        }
    }

    // ==================== Exports ====================

    return {
        FluxCaptureEngine: FluxCaptureEngine,
        DocumentType: DocumentType,
        DocumentTypeLabels: DocumentTypeLabels,
        DocStatus: DocStatus,
        ConfidenceLevel: ConfidenceLevel,
        SUPPORTED_FILE_TYPES: SUPPORTED_FILE_TYPES,
        // Provider-related exports
        ProviderFactory: ProviderFactoryModule,
        getAvailableProviders: ProviderFactoryModule.getAvailableProviders,
        getProviderConfig: ProviderFactoryModule.getProviderConfigForUI,
        getProviderConfigForUI: ProviderFactoryModule.getProviderConfigForUI,
        saveProviderConfig: ProviderFactoryModule.saveProviderConfig,
        testProviderConnection: ProviderFactoryModule.testProviderConnection
    };
});
