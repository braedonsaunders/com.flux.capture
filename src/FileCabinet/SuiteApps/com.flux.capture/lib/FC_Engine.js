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
    // License validation
    './FC_LicenseGuard',
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
    './vendors/VendorDataLoader',
    // LLM Verification (optional)
    './llm/GeminiVerifier'
], function(
    file, record, search, query, runtime, log, format, encode,
    fcDebug,
    License,
    ProviderFactoryModule,
    FieldMatcherModule, DateParserModule, AmountParserModule, LayoutAnalyzerModule, TableAnalyzerModule,
    DynamicFieldMatcherModule,
    VendorMatcherModule, TaxIdExtractorModule,
    CorrectionLearnerModule, AliasManagerModule,
    CrossFieldValidatorModule,
    VendorDataLoaderModule,
    GeminiVerifierModule
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
            // LICENSE CHECK - Validate before initialization
            this._licenseContext = License.validate();
            if (!this._licenseContext || !this._licenseContext.valid) {
                throw new Error('FLUX_LICENSE_REQUIRED: Valid Flux Capture license required');
            }

            this.enableLearning = options.enableLearning !== false;

            // Anomaly detection settings (all default to true except detectRoundAmounts)
            const ad = options.anomalyDetection || {};
            this.anomalySettings = {
                // Duplicate Detection
                detectDuplicateInvoice: ad.detectDuplicateInvoice !== false,
                detectDuplicatePayment: ad.detectDuplicatePayment !== false,
                // Amount Validation
                validateLineItemsTotal: ad.validateLineItemsTotal !== false,
                validateSubtotalTax: ad.validateSubtotalTax !== false,
                validatePositiveAmounts: ad.validatePositiveAmounts !== false,
                detectRoundAmounts: ad.detectRoundAmounts === true, // Default OFF
                detectAmountOutlier: ad.detectAmountOutlier !== false,
                // Date Validation
                validateFutureDate: ad.validateFutureDate !== false,
                validateDueDateSequence: ad.validateDueDateSequence !== false,
                validateStaleDate: ad.validateStaleDate !== false,
                detectUnusualTerms: ad.detectUnusualTerms !== false,
                // Vendor Validation
                detectVendorNotFound: ad.detectVendorNotFound !== false,
                detectLowVendorConfidence: ad.detectLowVendorConfidence !== false,
                detectInvoiceFormatChange: ad.detectInvoiceFormatChange !== false,
                // Required Fields
                requireInvoiceNumber: ad.requireInvoiceNumber !== false,
                requireTotalAmount: ad.requireTotalAmount !== false
            };

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

            // v4.0: Gemini LLM Verification (lazy loaded, optional)
            this._geminiVerifier = null;
            this._geminiVerifierLoaded = false;
        }

        /**
         * Get the Gemini verifier instance (lazy loaded)
         * @returns {Object|null} GeminiVerifier instance or null if not configured
         */
        _getGeminiVerifier() {
            if (!this._geminiVerifierLoaded) {
                this._geminiVerifierLoaded = true;
                try {
                    if (GeminiVerifierModule && GeminiVerifierModule.createVerifier) {
                        this._geminiVerifier = GeminiVerifierModule.createVerifier();
                        if (this._geminiVerifier && this._geminiVerifier.enabled) {
                            log.audit('FluxCaptureEngine', 'Gemini AI Verification enabled');
                        }
                    }
                } catch (e) {
                    log.error('FluxCaptureEngine', `Failed to load Gemini verifier: ${e.message}`);
                    this._geminiVerifier = null;
                }
            }
            return this._geminiVerifier;
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
         * Get the extraction provider for direct access (e.g., async extraction flows)
         * @returns {Object} - The configured extraction provider
         */
        getExtractionProvider() {
            return this._getExtractionProvider();
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

            // Embedded license revalidation
            if (!License._vld({ id: fileId }, this._licenseContext)) {
                throw new Error('FLUX_LICENSE_REQUIRED: Processing requires valid license');
            }

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

                // Apply vendor/account currency preferences before validation
                this._applyCurrencyPreference(extractionResult, vendorDefaults, options);

                // Stage 4.6: Match unmatched extractions to custom form fields
                let customFieldMatches = {};
                if (options.formSchema && extractionResult.allExtractedFields) {
                    customFieldMatches = this.dynamicFieldMatcher.matchCustomFields(
                        extractionResult.allExtractedFields,
                        options.formSchema,
                        extractionResult.fields
                    );
                }

                // Stage 5: Cross-field validation (respects anomaly settings)
                const validation = this.crossFieldValidator.validate(extractionResult, this.anomalySettings);

                // Stage 6: Anomaly detection (pass documentId to exclude current document from duplicate checks)
                const anomalies = this._detectAnomalies(extractionResult, vendorMatch, validation, options.documentId);

                // Stage 7: Calculate confidence scores
                const confidence = this._calculateConfidence(extractionResult, vendorMatch, validation);

                // Build initial result
                let result = {
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
                        totalDocumentPages: extractionResult.totalDocumentPages || extractionResult.pageCount,
                        pagesLimited: extractionResult.pagesLimited || false,
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

                // Stage 8: Gemini AI Verification (if enabled)
                const geminiVerifier = this._getGeminiVerifier();
                if (geminiVerifier && geminiVerifier.shouldVerify(result, options)) {
                    log.audit('FluxCapture.processDocument', 'Running Gemini AI verification...');

                    try {
                        const verificationResult = geminiVerifier.verify(
                            fileId,
                            result,
                            options.formSchema || null
                        );

                        if (verificationResult.success) {
                            // Apply verification results
                            result = geminiVerifier.applyVerification(result, verificationResult);
                            log.audit('FluxCapture.processDocument',
                                `Gemini verification complete: ${verificationResult.verification?.accuracy * 100 || 0}% accuracy`);
                        } else if (!verificationResult.skipped) {
                            // Log error but don't fail the extraction
                            log.error('FluxCapture.processDocument',
                                `Gemini verification failed: ${verificationResult.error}`);
                            result.extraction.aiVerification = {
                                verified: false,
                                error: verificationResult.error
                            };
                        }
                    } catch (geminiError) {
                        log.error('FluxCapture.processDocument', `Gemini error: ${geminiError.message}`);
                        result.extraction.aiVerification = {
                            verified: false,
                            error: geminiError.message
                        };
                    }
                }

                const processingTime = Date.now() - startTime;
                result.extraction.processingTime = processingTime;

                log.audit('FluxCapture.processDocument', `Completed in ${processingTime}ms. Confidence: ${confidence.overall}%`);

                return result;

            } catch (error) {
                log.error('FluxCaptureEngine.processDocument', { message: error.message, stack: error.stack });
                return {
                    success: false,
                    error: error.message
                };
            }
        }

        /**
         * Process a document with pre-extracted raw result (for async extraction flows).
         * Use this when Azure extraction was done separately and you have the raw result.
         * Performs stages 2-7: layout analysis, field extraction, vendor matching, validation.
         * @param {Object} rawResult - Raw extraction result from Azure provider (normalized)
         * @param {Object} options - Processing options
         * @returns {Object} - Extraction results (same format as processDocument)
         */
        processWithRawResult(rawResult, options = {}) {
            const startTime = Date.now();

            // Embedded license revalidation
            if (!License._vld(rawResult, this._licenseContext)) {
                throw new Error('FLUX_LICENSE_REQUIRED: Processing requires valid license');
            }

            try {
                log.audit('FluxCapture.processWithRawResult', 'Processing with pre-extracted result');

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

                // Apply vendor/account currency preferences before validation
                this._applyCurrencyPreference(extractionResult, vendorDefaults, options);

                // Stage 4.6: Match unmatched extractions to custom form fields
                let customFieldMatches = {};
                if (options.formSchema && extractionResult.allExtractedFields) {
                    customFieldMatches = this.dynamicFieldMatcher.matchCustomFields(
                        extractionResult.allExtractedFields,
                        options.formSchema,
                        extractionResult.fields
                    );
                }

                // Stage 5: Cross-field validation (respects anomaly settings)
                const validation = this.crossFieldValidator.validate(extractionResult, this.anomalySettings);

                // Stage 6: Anomaly detection (pass documentId to exclude current document from duplicate checks)
                const anomalies = this._detectAnomalies(extractionResult, vendorMatch, validation, options.documentId);

                // Stage 7: Calculate confidence scores
                const confidence = this._calculateConfidence(extractionResult, vendorMatch, validation);

                // Build initial result
                let result = {
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
                        allExtractedFields: extractionResult.allExtractedFields || {},
                        extractionMeta: {
                            layout: {
                                zones: Object.keys(layout.zones || {}).filter(z => (layout.zones[z] || []).length > 0),
                                tableCount: (layout.tables || []).length
                            },
                            signals: vendorMatch.signals || []
                        },
                        extractionWarnings: extractionResult.extractionWarnings || [],
                        skippedLineItems: extractionResult.skippedLineItems || [],
                        lineItemWarnings: extractionResult.lineItemWarnings || [],
                        vendorDefaults: vendorDefaults,
                        customFieldMatches: customFieldMatches
                    }
                };

                // Stage 8: Gemini AI Verification (if enabled and fileId provided)
                if (options.fileId) {
                    const geminiVerifier = this._getGeminiVerifier();
                    if (geminiVerifier && geminiVerifier.shouldVerify(result, options)) {
                        log.audit('FluxCapture.processWithRawResult', 'Running Gemini AI verification...');

                        try {
                            const verificationResult = geminiVerifier.verify(
                                options.fileId,
                                result,
                                options.formSchema || null
                            );

                            if (verificationResult.success) {
                                result = geminiVerifier.applyVerification(result, verificationResult);
                                log.audit('FluxCapture.processWithRawResult',
                                    `Gemini verification complete: ${verificationResult.verification?.accuracy * 100 || 0}% accuracy`);
                            } else if (!verificationResult.skipped) {
                                log.error('FluxCapture.processWithRawResult',
                                    `Gemini verification failed: ${verificationResult.error}`);
                                result.extraction.aiVerification = {
                                    verified: false,
                                    error: verificationResult.error
                                };
                            }
                        } catch (geminiError) {
                            log.error('FluxCapture.processWithRawResult', `Gemini error: ${geminiError.message}`);
                            result.extraction.aiVerification = {
                                verified: false,
                                error: geminiError.message
                            };
                        }
                    }
                }

                const processingTime = Date.now() - startTime;
                result.extraction.processingTime = processingTime;

                log.audit('FluxCapture.processWithRawResult', `Completed in ${processingTime}ms. Confidence: ${confidence.overall}%`);

                return result;

            } catch (error) {
                log.error('FluxCaptureEngine.processWithRawResult', { message: error.message, stack: error.stack });
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
                    timeout: options.timeout,
                    maxPages: options.maxExtractionPages || 0
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

            // Process pages and extract data (verbose DEBUG logging removed for performance)
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

                            rawFields.push({
                                page: pageIndex,
                                label: extractedLabel,
                                labelConfidence: field.label?.confidence || 0.5,
                                value: extractedValue,
                                valueConfidence: field.value?.confidence || field.confidence || 0.5,
                                position: field.boundingBox || field.bbox || null,
                                _rawLabel: field.label,
                                _rawValue: field.value,
                                _rawType: field.type
                            });
                        });
                    }

                    // Collect raw tables
                    if (page.tables && page.tables.length > 0) {
                        page.tables.forEach((table, tableIndex) => {
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

            // Minimal extraction summary
            fcDebug.debugAudit('Extraction.Summary', `Fields: ${rawFields.length}, Tables: ${rawTables.length}`);

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
                currency: null
            };

            const fieldConfidences = {};
            const fieldCandidates = {};
            const extractionWarnings = []; // Collect all warnings

            // Build context for extraction
            const extractionContext = {
                vendorCountry: options.vendorCountry || null,
                vendorLocale: options.vendorLocale || null,
                learnedFormat: null, // Will be set if vendor has learned format
                // Company locale settings for reliable currency detection
                companyCountry: options.companyCountry || 'CA',
                companyCurrency: options.companyCurrency || 'CAD'
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

                        if (fieldName === 'currency' && parsedValue) {
                            extractionContext.currency = parsedValue;
                            extractionContext.currencySource = 'field_match';
                        }
                    }
                }
            }

            // If due date wasn't directly extracted, try to infer it from visible payment terms
            if (!fields.dueDate && fields.invoiceDate) {
                const inferredFromText = rawResult.rawText
                    ? this._inferDueDateFromText(rawResult.rawText, fields.invoiceDate, 'document')
                    : null;

                const inferredFromField = !inferredFromText && fields.paymentTerms
                    ? this._inferDueDateFromText(fields.paymentTerms, fields.invoiceDate, 'payment_terms_field')
                    : null;

                const inferred = inferredFromText || inferredFromField;

                if (inferred) {
                    fields.dueDate = inferred.date;
                    extractionWarnings.push({
                        type: 'due_date_inferred',
                        message: `Inferred due date from terms (${inferred.source})`,
                        field: 'dueDate',
                        rawValue: inferred.raw
                    });
                }
            }

            // Extract line items from tables
            let lineItems = [];
            let lineItemWarnings = [];
            let skippedLineItems = [];
            let tableDiagnostics = [];
            let lineItemExtractionMethod = 'table_analyzer';

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

                fcDebug.debugAudit('LineItems.Provider', `${lineItems.length} items from ${lineItemExtractionMethod}`);
            }
            // Fall back to TableAnalyzer for OCI or when provider doesn't have structured items
            else if (rawResult.rawTables && rawResult.rawTables.length > 0) {
                // Merge tables that span multiple pages before selection
                const mergedTables = this._mergeMultiPageTables(rawResult.rawTables);

                // Find the line items table (usually the largest by body row count)
                const lineItemsTable = layout.lineItemsTable?.raw ||
                    mergedTables.reduce((best, t) =>
                        (t.bodyRows?.length || 0) > (best?.bodyRows?.length || 0) ? t : best,
                        null
                    );

                if (lineItemsTable) {
                    // Pass table index for logging
                    extractionContext.tableIndex = 0;
                    const tableResult = this.tableAnalyzer.analyze(lineItemsTable, extractionContext);
                    lineItems = tableResult.lineItems;

                    // Store diagnostics for return
                    if (tableResult.diagnostics) {
                        tableDiagnostics = tableResult.diagnostics;
                    }

                    // Memo-focused summary
                    const withMemo = lineItems.filter(i => i.memo && i.memo.trim().length > 0).length;
                    fcDebug.debugAudit('LineItems.Result', `${lineItems.length} items, ${withMemo} with memo`);

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

            // If currency was detected implicitly via amounts, surface it as a field
            if (!fields.currency && extractionContext.currency) {
                fields.currency = extractionContext.currency;
                fieldConfidences.currency = fieldConfidences.currency || 0.55;
            }

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
                lineItemExtractionMethod: lineItemExtractionMethod,
                currencySource: extractionContext.currencySource || (fieldConfidences.currency ? 'field_match' : null)
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
                    currency: context.currency,
                    // Include company locale for reliable $ symbol resolution
                    companyCountry: context.companyCountry,
                    companyCurrency: context.companyCurrency
                };

                // Use learned format if available
                if (context.amountFormat) {
                    amountContext.vendorLocale = context.amountFormat === 'COMMA' ? 'DE' : 'US';
                }

                const result = this.amountParser.parse(value, amountContext);

                // Extract currency if found
                if (result.currency && !context.currency) {
                    context.currency = result.currency;
                    context.currencySource = 'amount_detection';
                }

                return result.amount;
            }

            // String fields
            return value;
        }

        /**
         * Infer due date from natural-language payment terms in the raw text
         */
        _inferDueDateFromText(rawText, invoiceDate, sourceHint) {
            if (!rawText || !invoiceDate) return null;

            const normalized = rawText.replace(/\s+/g, ' ');

            // First check for "Due on Receipt" / immediate payment terms (due date = invoice date)
            const immediatePatterns = [
                { regex: /due\s*(on|upon)\s*receipt/i, source: 'due_on_receipt' },
                { regex: /payable\s*(on|upon)\s*receipt/i, source: 'payable_on_receipt' },
                { regex: /\bC\.?O\.?D\.?\b/i, source: 'cod' },
                { regex: /cash\s*(on|upon)\s*(delivery|receipt)/i, source: 'cash_on_delivery' },
                { regex: /\bnet\s*0\b/i, source: 'net_0' },
                { regex: /\bimmediate\s*(payment)?\b/i, source: 'immediate' },
                { regex: /\bpayment\s*due\s*immediately\b/i, source: 'immediate' },
                { regex: /\bupon\s*receipt\b/i, source: 'upon_receipt' }
            ];

            for (const pattern of immediatePatterns) {
                const match = normalized.match(pattern.regex);
                if (match) {
                    const source = sourceHint
                        ? `${sourceHint}:${pattern.source}`
                        : pattern.source;

                    return {
                        date: new Date(invoiceDate.getTime()), // Same as invoice date
                        days: 0,
                        raw: match[0],
                        source
                    };
                }
            }

            // Then check for Net X / day-based terms
            const patterns = [
                { regex: /net\s*(\d{1,3})/i, source: 'net_terms' },
                { regex: /due\s+in\s+(\d{1,3})\s+days/i, source: 'due_in_days' },
                { regex: /(payment\s+)?terms?:?\s*(\d{1,3})\s*days/i, source: 'terms_days' }
            ];

            for (const pattern of patterns) {
                const match = normalized.match(pattern.regex);
                if (match) {
                    const days = parseInt(match[1] || match[2], 10);
                    if (!isNaN(days) && days > 0 && days <= 365) {
                        const date = new Date(invoiceDate.getTime() + days * 24 * 60 * 60 * 1000);
                        const source = sourceHint
                            ? `${sourceHint}:${pattern.source}`
                            : pattern.source;

                        return {
                            date,
                            days,
                            raw: match[0],
                            source
                        };
                    }
                }
            }

            return null;
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
         * Apply currency preferences using vendor defaults or account settings
         */
        _applyCurrencyPreference(extractionResult, vendorDefaults, options = {}) {
            if (!extractionResult || !extractionResult.fields) return;

            const fields = extractionResult.fields;
            const fieldConfidences = extractionResult.fieldConfidences || {};
            const warnings = extractionResult.extractionWarnings || [];

            const preferredCurrency = vendorDefaults?.currency ||
                options.preferredCurrency ||
                options.accountCurrency || null;

            const extractedCurrency = fields.currency;
            const extractedConfidence = fieldConfidences.currency || 0;
            const currencySource = extractionResult.currencySource || null;

            if (preferredCurrency) {
                const shouldOverride = !extractedCurrency ||
                    currencySource === 'amount_detection' ||
                    extractedConfidence < 0.75;

                if (shouldOverride) {
                    fields.currency = preferredCurrency;
                    fieldConfidences.currency = Math.max(extractedConfidence, 0.9);

                    warnings.push({
                        type: 'currency_preference',
                        message: `Currency set to ${preferredCurrency} using vendor/account preference`,
                        field: 'currency'
                    });
                }
            }

            extractionResult.fieldConfidences = fieldConfidences;
            extractionResult.extractionWarnings = warnings;
        }

        /**
         * Merge tables that span multiple pages into single logical tables
         * Detects continuation tables on subsequent pages and combines their rows
         * @param {Array} rawTables - Array of table objects with page, headerRows, bodyRows
         * @returns {Array} Merged tables array
         */
        _mergeMultiPageTables(rawTables) {
            if (!rawTables || rawTables.length <= 1) return rawTables;

            // Sort by page then by vertical position (index on page)
            const sorted = [...rawTables].sort((a, b) =>
                ((a.page || 0) - (b.page || 0)) || ((a.index || 0) - (b.index || 0))
            );

            const merged = [];
            let current = null;

            for (const table of sorted) {
                if (!current) {
                    // Start with first table - deep copy to avoid mutation
                    current = {
                        ...table,
                        headerRows: table.headerRows ? [...table.headerRows] : [],
                        bodyRows: table.bodyRows ? [...table.bodyRows] : [],
                        footerRows: table.footerRows ? [...table.footerRows] : [],
                        mergedFromPages: [table.page || 0]
                    };
                    continue;
                }

                // Check if this table is a continuation of current
                const isNextPage = (table.page || 0) === (current.page || 0) + 1 ||
                    (current.mergedFromPages && (table.page || 0) === Math.max(...current.mergedFromPages) + 1);
                const hasNoHeaders = !table.headerRows || table.headerRows.length === 0;
                const hasMatchingHeaders = this._tableHeadersMatch(current.headerRows, table.headerRows);
                const hasBodyRows = table.bodyRows && table.bodyRows.length > 0;

                // A table is a continuation if:
                // 1. It's on the next page
                // 2. Either has no headers (continuation) or matching headers (repeated for readability)
                // 3. Has body rows to contribute
                const isContinuation = isNextPage && (hasNoHeaders || hasMatchingHeaders) && hasBodyRows;

                if (isContinuation) {
                    // Merge body rows from continuation table
                    current.bodyRows.push(...(table.bodyRows || []));
                    current.mergedFromPages.push(table.page || 0);

                    // If continuation has footer rows, they become the merged table's footer
                    if (table.footerRows && table.footerRows.length > 0) {
                        current.footerRows = [...table.footerRows];
                    }

                    fcDebug.debugAudit('TableMerge', `Merged table from page ${table.page} into multi-page table (pages: ${current.mergedFromPages.join(', ')})`);
                } else {
                    // Not a continuation - save current and start fresh
                    merged.push(current);
                    current = {
                        ...table,
                        headerRows: table.headerRows ? [...table.headerRows] : [],
                        bodyRows: table.bodyRows ? [...table.bodyRows] : [],
                        footerRows: table.footerRows ? [...table.footerRows] : [],
                        mergedFromPages: [table.page || 0]
                    };
                }
            }

            // Don't forget the last table
            if (current) merged.push(current);

            // Log merge results
            const multiPageTables = merged.filter(t => t.mergedFromPages && t.mergedFromPages.length > 1);
            if (multiPageTables.length > 0) {
                fcDebug.debugAudit('TableMerge.Summary', `Created ${multiPageTables.length} multi-page table(s) from ${rawTables.length} raw tables`);
            }

            return merged;
        }

        /**
         * Check if two tables have matching header structures
         * Used to detect if a table on a new page is a continuation with repeated headers
         * @param {Array} headers1 - Header rows from first table
         * @param {Array} headers2 - Header rows from second table
         * @returns {boolean} True if headers match
         */
        _tableHeadersMatch(headers1, headers2) {
            if (!headers1?.length || !headers2?.length) return false;

            // Compare first header row's cells
            const h1 = headers1[0]?.cells || [];
            const h2 = headers2[0]?.cells || [];

            // Column count must match
            if (h1.length !== h2.length) return false;

            // Check if at least 70% of headers match
            let matches = 0;
            for (let i = 0; i < h1.length; i++) {
                const t1 = (h1[i]?.text || '').toLowerCase().trim();
                const t2 = (h2[i]?.text || '').toLowerCase().trim();

                // Exact match or substring match
                if (t1 === t2 || (t1.length > 2 && t2.length > 2 && (t1.includes(t2) || t2.includes(t1)))) {
                    matches++;
                }
            }

            return (matches / h1.length) >= 0.7;
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
         * @param {Object} extraction - Extraction results
         * @param {Object} vendorMatch - Vendor matching results
         * @param {Object} validation - Cross-field validation results
         * @param {number} currentDocumentId - Current document ID to exclude from duplicate checks
         */
        _detectAnomalies(extraction, vendorMatch, validation, currentDocumentId) {
            const anomalies = [];
            const fields = extraction.fields;
            const fieldConfidences = extraction.fieldConfidences || {};
            const settings = this.anomalySettings;

            // Add validation issues as anomalies (these are already filtered by CrossFieldValidator)
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
            if (settings.detectVendorNotFound && !vendorMatch.vendorId) {
                anomalies.push({
                    type: 'vendor_not_found',
                    field: 'vendorName',
                    severity: 'medium',
                    message: `Vendor "${fields.vendorName || 'Unknown'}" not found in system`,
                    suggestion: vendorMatch.suggestions?.length > 0 ?
                        `Did you mean: ${vendorMatch.suggestions[0].companyName}?` :
                        'Add vendor to system or select from suggestions'
                });
            } else if (settings.detectLowVendorConfidence && vendorMatch.vendorId && vendorMatch.confidence < 0.8) {
                anomalies.push({
                    type: 'low_vendor_confidence',
                    field: 'vendorName',
                    severity: 'low',
                    message: `Vendor match confidence is ${Math.round(vendorMatch.confidence * 100)}%`
                });
            }

            // Duplicate invoice number check (exclude current document)
            const invoiceNumber = this._normalizeInvoiceNumber(fields.invoiceNumber);
            if (settings.detectDuplicateInvoice && vendorMatch.vendorId &&
                this._isMeaningfulInvoiceNumber(invoiceNumber, fieldConfidences.invoiceNumber)) {
                const isDuplicate = this._checkDuplicateInvoice(vendorMatch.vendorId, invoiceNumber, currentDocumentId);
                if (isDuplicate) {
                    anomalies.push({
                        type: 'duplicate_invoice',
                        field: 'invoiceNumber',
                        severity: 'high',
                        message: 'Invoice number already exists for this vendor'
                    });
                }
            }

            // Duplicate payment check (vendor + amount + date, exclude current document)
            if (settings.detectDuplicatePayment && vendorMatch.vendorId && fields.totalAmount && fields.invoiceDate) {
                const isDuplicatePayment = this._checkDuplicatePayment(
                    vendorMatch.vendorId,
                    fields.totalAmount,
                    fields.invoiceDate,
                    currentDocumentId
                );
                if (isDuplicatePayment) {
                    anomalies.push({
                        type: 'duplicate_payment',
                        field: 'totalAmount',
                        severity: 'high',
                        message: 'Another invoice with same vendor, amount, and date exists (potential duplicate payment)',
                        suggestion: 'Verify this is not a duplicate submission'
                    });
                }
            }

            // Amount outlier detection (compare to vendor historical average)
            if (settings.detectAmountOutlier && vendorMatch.vendorId && fields.totalAmount > 0) {
                const outlierResult = this._checkAmountOutlier(vendorMatch.vendorId, fields.totalAmount);
                if (outlierResult.isOutlier) {
                    anomalies.push({
                        type: 'amount_outlier',
                        field: 'totalAmount',
                        severity: 'medium',
                        message: `Amount $${fields.totalAmount.toFixed(2)} is ${outlierResult.multiplier.toFixed(1)}x higher than vendor's average ($${outlierResult.average.toFixed(2)})`,
                        suggestion: 'Verify amount is correct for this invoice'
                    });
                }
            }

            // Invoice number format change detection
            if (settings.detectInvoiceFormatChange && vendorMatch.vendorId &&
                this._isMeaningfulInvoiceNumber(invoiceNumber, fieldConfidences.invoiceNumber)) {
                const formatChanged = this._checkInvoiceFormatChange(vendorMatch.vendorId, invoiceNumber);
                if (formatChanged.changed) {
                    anomalies.push({
                        type: 'invoice_format_change',
                        field: 'invoiceNumber',
                        severity: 'low',
                        message: `Invoice number format differs from vendor's typical pattern`,
                        suggestion: `Expected pattern like: ${formatChanged.expectedPattern || 'N/A'}`
                    });
                }
            }

            // Unusual payment terms detection
            if (settings.detectUnusualTerms && vendorMatch.vendorId && fields.invoiceDate && fields.dueDate) {
                const termsResult = this._checkUnusualPaymentTerms(
                    vendorMatch.vendorId,
                    fields.invoiceDate,
                    fields.dueDate
                );
                if (termsResult.isUnusual) {
                    anomalies.push({
                        type: 'unusual_payment_terms',
                        field: 'dueDate',
                        severity: 'low',
                        message: `Payment terms (${termsResult.days} days) differ significantly from vendor's typical terms (${termsResult.averageDays} days)`,
                        suggestion: 'Verify due date is correct'
                    });
                }
            }

            return anomalies;
        }

        /**
         * Normalize invoice number for comparisons and storage checks
         * @param {string} invoiceNumber - Raw invoice number
         * @returns {string}
         */
        _normalizeInvoiceNumber(invoiceNumber) {
            if (invoiceNumber === null || invoiceNumber === undefined) return '';
            // Strip leading # signs and leading zeros (preserve at least one digit)
            return String(invoiceNumber).trim().replace(/^[#]+/, '').replace(/^0+(?=\d)/, '');
        }

        /**
         * Compact invoice number for fuzzy comparisons
         * @param {string} invoiceNumber - Raw invoice number
         * @returns {string}
         */
        _compactInvoiceNumber(invoiceNumber) {
            if (invoiceNumber === null || invoiceNumber === undefined) return '';
            return String(invoiceNumber).trim().replace(/[\s\-_.#\/]+/g, '').toLowerCase();
        }

        /**
         * Determine if invoice number is meaningful enough for duplicate checks
         * @param {string} invoiceNumber - Invoice number to evaluate
         * @param {number} confidence - Optional extraction confidence
         * @returns {boolean}
         */
        _isMeaningfulInvoiceNumber(invoiceNumber, confidence) {
            if (!invoiceNumber) return false;

            const trimmed = String(invoiceNumber).trim();
            if (!trimmed) return false;

            const compact = this._compactInvoiceNumber(trimmed);
            if (!compact || compact.length < 3) return false;

            const blocked = [
                'invoice', 'inv', 'invno', 'invnumber', 'invoiceno', 'invoicenumber',
                'invoice#', 'inv#', 'bill', 'document', 'reference', 'ref', 'number',
                'na', 'none', 'null', 'unknown', 'tbd', 'tba'
            ];
            if (blocked.indexOf(compact) !== -1) return false;

            const hasDigit = /\d/.test(compact);
            if (!hasDigit && compact.length < 6) return false;

            if (typeof confidence === 'number' && confidence < 0.45) return false;

            return true;
        }

        /**
         * Build SuiteQL expression to normalize invoice numbers for comparison
         * @param {string} columnRef - Column reference to normalize
         * @returns {string}
         */
        _buildCompactInvoiceSql(columnRef) {
            return `LOWER(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(TRIM(${columnRef}), ' ', ''), '-', ''), '_', ''), '.', ''), '#', ''), '/', ''))`;
        }

        /**
         * Check for duplicate invoice by invoice number
         * @param {number} vendorId - Vendor internal ID
         * @param {string} invoiceNumber - Invoice number to check
         * @param {number} currentDocumentId - Current document ID to exclude from check
         */
        _checkDuplicateInvoice(vendorId, invoiceNumber, currentDocumentId) {
            try {
                const normalized = this._normalizeInvoiceNumber(invoiceNumber);
                if (!this._isMeaningfulInvoiceNumber(normalized)) {
                    return false;
                }

                const normalizedLower = normalized.toLowerCase();
                const compact = this._compactInvoiceNumber(normalized);

                // Always check real transactions first (vendor bills)
                const txnDuplicate = this._checkDuplicateInvoiceTransaction(vendorId, normalizedLower, compact);
                if (txnDuplicate) {
                    return true;
                }

                // Fallback: check other Flux documents still in-flight
                return this._checkDuplicateInvoiceDocument(vendorId, normalizedLower, compact, currentDocumentId);
            } catch (e) {
                fcDebug.debug('FluxCapture._checkDuplicateInvoice', e.message);
                return false;
            }
        }

        /**
         * Check for duplicate invoice on vendor bills (real transactions)
         * @param {number} vendorId - Vendor internal ID
         * @param {string} normalizedLower - Lowercased invoice number
         * @param {string} compact - Compact invoice number (no separators)
         * @returns {boolean}
         */
        _checkDuplicateInvoiceTransaction(vendorId, normalizedLower, compact) {
            try {
                const compactTranidSql = this._buildCompactInvoiceSql('t.tranid');
                const compactOtherSql = this._buildCompactInvoiceSql('t.otherrefnum');
                const sql = `
                    SELECT COUNT(*) as cnt
                    FROM transaction t
                    WHERE t.type = 'VendBill'
                    AND t.mainline = 'T'
                    AND t.entity = ?
                    AND (
                        LOWER(TRIM(t.tranid)) = ?
                        OR LOWER(TRIM(t.otherrefnum)) = ?
                        OR ${compactTranidSql} = ?
                        OR ${compactOtherSql} = ?
                    )
                `;
                const result = query.runSuiteQL({
                    query: sql,
                    params: [vendorId, normalizedLower, normalizedLower, compact, compact]
                });
                return result.results[0].values[0] > 0;
            } catch (e) {
                fcDebug.debug('FluxCapture._checkDuplicateInvoiceTransaction', e.message);
                return false;
            }
        }

        /**
         * Check for duplicate invoice among Flux documents still in-flight
         * @param {number} vendorId - Vendor internal ID
         * @param {string} normalizedLower - Lowercased invoice number
         * @param {string} compact - Compact invoice number (no separators)
         * @param {number} currentDocumentId - Current document ID to exclude from check
         * @returns {boolean}
         */
        _checkDuplicateInvoiceDocument(vendorId, normalizedLower, compact, currentDocumentId) {
            try {
                // Exclude current document from duplicate check to avoid self-matching
                const excludeClause = currentDocumentId ? ' AND id != ?' : '';
                const params = currentDocumentId
                    ? [vendorId, normalizedLower, compact, currentDocumentId]
                    : [vendorId, normalizedLower, compact];

                const compactSql = this._buildCompactInvoiceSql('custrecord_flux_invoice_number');
                const sql = `
                    SELECT COUNT(*) as cnt
                    FROM customrecord_flux_document
                    WHERE custrecord_flux_vendor = ?
                    AND (
                        LOWER(TRIM(custrecord_flux_invoice_number)) = ?
                        OR ${compactSql} = ?
                    )
                    AND custrecord_flux_status IN (${DocStatus.EXTRACTED}, ${DocStatus.NEEDS_REVIEW}, ${DocStatus.COMPLETED})
                    ${excludeClause}
                `;
                const result = query.runSuiteQL({ query: sql, params: params });
                return result.results[0].values[0] > 0;
            } catch (e) {
                fcDebug.debug('FluxCapture._checkDuplicateInvoiceDocument', e.message);
                return false;
            }
        }

        /**
         * Check for duplicate payment (same vendor + amount + date)
         * @param {number} vendorId - Vendor internal ID
         * @param {number} amount - Invoice amount
         * @param {Date|string} invoiceDate - Invoice date
         * @param {number} currentDocumentId - Current document ID to exclude from check
         */
        _checkDuplicatePayment(vendorId, amount, invoiceDate, currentDocumentId) {
            try {
                // Parse the date to get just the date portion
                const dateObj = new Date(invoiceDate);
                const dateStr = dateObj.toISOString().split('T')[0];

                // Exclude current document from duplicate check to avoid self-matching
                const excludeClause = currentDocumentId ? ' AND id != ?' : '';
                const params = currentDocumentId
                    ? [vendorId, amount, dateStr, currentDocumentId]
                    : [vendorId, amount, dateStr];

                const sql = `
                    SELECT COUNT(*) as cnt
                    FROM customrecord_flux_document
                    WHERE custrecord_flux_vendor = ?
                    AND ABS(custrecord_flux_total_amount - ?) < 0.01
                    AND TO_CHAR(custrecord_flux_invoice_date, 'YYYY-MM-DD') = ?
                    AND custrecord_flux_status IN (${DocStatus.EXTRACTED}, ${DocStatus.NEEDS_REVIEW}, ${DocStatus.COMPLETED})
                    ${excludeClause}
                `;
                const result = query.runSuiteQL({ query: sql, params: params });
                return result.results[0].values[0] > 0;
            } catch (e) {
                fcDebug.debug('FluxCapture._checkDuplicatePayment', e.message);
                return false;
            }
        }

        /**
         * Check if amount is an outlier compared to vendor's historical average
         */
        _checkAmountOutlier(vendorId, amount) {
            try {
                const sql = `
                    SELECT AVG(custrecord_flux_total_amount) as avg_amount,
                           STDDEV(custrecord_flux_total_amount) as std_dev,
                           COUNT(*) as cnt
                    FROM customrecord_flux_document
                    WHERE custrecord_flux_vendor = ?
                    AND custrecord_flux_total_amount > 0
                    AND custrecord_flux_status IN (${DocStatus.NEEDS_REVIEW}, ${DocStatus.COMPLETED})
                `;
                const result = query.runSuiteQL({ query: sql, params: [vendorId] });
                const row = result.results[0];

                if (!row || row.values[2] < 3) {
                    // Not enough historical data (need at least 3 invoices)
                    return { isOutlier: false };
                }

                const avgAmount = row.values[0] || 0;
                const stdDev = row.values[1] || 0;

                // Consider it an outlier if it's more than 3x the average or 2 std deviations above
                const multiplier = avgAmount > 0 ? amount / avgAmount : 0;
                const isOutlier = multiplier > 3 || (stdDev > 0 && amount > avgAmount + 2 * stdDev);

                return {
                    isOutlier: isOutlier,
                    average: avgAmount,
                    multiplier: multiplier
                };
            } catch (e) {
                fcDebug.debug('FluxCapture._checkAmountOutlier', e.message);
                return { isOutlier: false };
            }
        }

        /**
         * Check if invoice number format differs from vendor's historical pattern
         */
        _checkInvoiceFormatChange(vendorId, invoiceNumber) {
            try {
                // Get recent invoice numbers for this vendor
                const sql = `
                    SELECT custrecord_flux_invoice_number
                    FROM customrecord_flux_document
                    WHERE custrecord_flux_vendor = ?
                    AND custrecord_flux_invoice_number IS NOT NULL
                    AND custrecord_flux_status IN (${DocStatus.NEEDS_REVIEW}, ${DocStatus.COMPLETED})
                    ORDER BY custrecord_flux_created_date DESC
                    FETCH FIRST 10 ROWS ONLY
                `;
                const result = query.runSuiteQL({ query: sql, params: [vendorId] });

                if (result.results.length < 3) {
                    // Not enough historical data
                    return { changed: false };
                }

                // Analyze the format pattern (digits, letters, separators)
                const getPattern = (inv) => {
                    return String(inv)
                        .replace(/[0-9]+/g, 'N')
                        .replace(/[A-Za-z]+/g, 'A')
                        .replace(/[-_./]+/g, '-');
                };

                const currentPattern = getPattern(invoiceNumber);
                const historicalPatterns = result.results.map(r => getPattern(r.values[0]));

                // Find most common pattern
                const patternCounts = {};
                historicalPatterns.forEach(p => {
                    patternCounts[p] = (patternCounts[p] || 0) + 1;
                });

                const mostCommonPattern = Object.entries(patternCounts)
                    .sort((a, b) => b[1] - a[1])[0];

                if (mostCommonPattern && mostCommonPattern[1] >= 2) {
                    // At least 2 invoices have the same pattern
                    const expectedPattern = mostCommonPattern[0];
                    if (currentPattern !== expectedPattern) {
                        return {
                            changed: true,
                            expectedPattern: result.results[0].values[0] // Show an example
                        };
                    }
                }

                return { changed: false };
            } catch (e) {
                fcDebug.debug('FluxCapture._checkInvoiceFormatChange', e.message);
                return { changed: false };
            }
        }

        /**
         * Check if payment terms differ significantly from vendor's norm
         */
        _checkUnusualPaymentTerms(vendorId, invoiceDate, dueDate) {
            try {
                const invDate = new Date(invoiceDate);
                const dueDateObj = new Date(dueDate);
                const daysDiff = Math.round((dueDateObj - invDate) / (1000 * 60 * 60 * 24));

                if (daysDiff < 0) {
                    // Due date before invoice date is handled by CrossFieldValidator
                    return { isUnusual: false };
                }

                // Get average payment terms for this vendor
                const sql = `
                    SELECT AVG(custrecord_flux_due_date - custrecord_flux_invoice_date) as avg_days,
                           COUNT(*) as cnt
                    FROM customrecord_flux_document
                    WHERE custrecord_flux_vendor = ?
                    AND custrecord_flux_due_date IS NOT NULL
                    AND custrecord_flux_invoice_date IS NOT NULL
                    AND custrecord_flux_due_date >= custrecord_flux_invoice_date
                    AND custrecord_flux_status IN (${DocStatus.NEEDS_REVIEW}, ${DocStatus.COMPLETED})
                `;
                const result = query.runSuiteQL({ query: sql, params: [vendorId] });
                const row = result.results[0];

                if (!row || row.values[1] < 3) {
                    // Not enough historical data
                    return { isUnusual: false, days: daysDiff };
                }

                const avgDays = row.values[0] || 30;

                // Consider it unusual if it differs by more than 15 days or 50%
                const difference = Math.abs(daysDiff - avgDays);
                const isUnusual = difference > 15 || (avgDays > 0 && difference / avgDays > 0.5);

                return {
                    isUnusual: isUnusual,
                    days: daysDiff,
                    averageDays: Math.round(avgDays)
                };
            } catch (e) {
                fcDebug.debug('FluxCapture._checkUnusualPaymentTerms', e.message);
                return { isUnusual: false };
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

                    // v4.1: Populate memo from description (provider-native items bypass TableAnalyzer)
                    if (item.description && item.description.trim().length >= 5) {
                        item.memo = item.description.trim();
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

                    // v4.1: Populate memo from description (provider-native items bypass TableAnalyzer)
                    if (item.description && item.description.trim().length >= 5) {
                        item.memo = item.description.trim();
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
                    currency: null
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
         * Learn from an approved transaction
         * Captures all coding data for future auto-suggestions
         * @param {Object} approvalData - Data from the approved transaction
         * @param {number} approvalData.vendorId - Vendor ID
         * @param {Object} approvalData.headerFields - Header field values
         * @param {Array} approvalData.lineItems - Line items with coding data
         * @returns {Object} Learning results summary
         */
        learnFromApproval(approvalData) {
            if (!this.enableLearning) {
                return { success: false, reason: 'Learning disabled' };
            }
            return this.correctionLearner.learnFromApproval(approvalData);
        }

        /**
         * Get all coding suggestions for a document
         * Returns header defaults and line item suggestions in one call
         * @param {number} vendorId - Vendor ID
         * @param {Array} lineItems - Array of line items with descriptions
         * @returns {Object} All suggestions organized by header and line items
         */
        getSuggestedCoding(vendorId, lineItems) {
            return this.correctionLearner.getSuggestedCoding(vendorId, lineItems);
        }

        /**
         * Get vendor defaults for header fields
         * @param {number} vendorId - Vendor ID
         * @returns {Object|null} Vendor default values
         */
        getVendorDefaults(vendorId) {
            return this.correctionLearner.getVendorDefaults(vendorId);
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
