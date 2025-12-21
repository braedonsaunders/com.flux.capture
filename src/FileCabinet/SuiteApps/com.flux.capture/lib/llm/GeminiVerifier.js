/**
 * @NApiVersion 2.1
 * @NModuleScope Public
 * @module FluxCapture/LLM/GeminiVerifier
 *
 * Gemini 3 Flash Verification Layer
 * Provides AI-powered verification of OCR extraction results by analyzing
 * the actual PDF document and comparing against extracted data.
 *
 * This is an optional enhancement layer that runs AFTER standard OCR extraction.
 */

define([
    'N/https',
    'N/file',
    'N/encode',
    'N/record',
    'N/search',
    'N/log',
    'N/crypto',
    '../FC_Debug'
], function(https, file, encode, record, search, log, crypto, fcDebug) {
    'use strict';

    // ==================== Constants ====================

    const GEMINI_API_BASE = 'https://generativelanguage.googleapis.com/v1beta';
    const DEFAULT_MODEL = 'gemini-2.0-flash'; // Will use gemini-3-flash when available
    const CONFIG_RECORD_TYPE = 'customrecord_flux_config';
    const LLM_CONFIG_TYPE = 'llm_settings';
    const LLM_CONFIG_KEY = 'gemini_verifier';
    const ENCRYPTION_KEY_ID = 'flux_capture_llm_key';

    // Trigger modes
    const TriggerMode = Object.freeze({
        ALWAYS: 'always',
        SMART: 'smart',
        MANUAL: 'manual'
    });

    // ==================== GeminiVerifier Class ====================

    /**
     * Gemini-powered document verification
     * Analyzes PDF documents to verify and enhance OCR extraction accuracy
     */
    class GeminiVerifier {
        /**
         * @param {Object} config - Verifier configuration
         * @param {boolean} config.enabled - Whether verification is enabled
         * @param {string} config.apiKey - Gemini API key
         * @param {string} config.model - Model to use (default: gemini-2.0-flash)
         * @param {string} config.triggerMode - When to run: 'always', 'smart', 'manual'
         * @param {number} config.smartThreshold - Confidence threshold for smart mode (0-1)
         * @param {number} config.maxPages - Maximum pages to send to API
         */
        constructor(config = {}) {
            this.enabled = config.enabled || false;
            this.apiKey = config.apiKey || null;
            this.model = config.model || DEFAULT_MODEL;
            this.triggerMode = config.triggerMode || TriggerMode.SMART;
            this.smartThreshold = config.smartThreshold || 0.70;
            this.maxPages = config.maxPages || 20;
            this.skipFileSizeMB = config.skipFileSizeMB || 25;

            // Build endpoint URL
            this.endpoint = `${GEMINI_API_BASE}/models/${this.model}:generateContent`;
        }

        /**
         * Determine if verification should run for this extraction
         * @param {Object} extractionResult - The extraction result from OCR
         * @param {Object} options - Additional options
         * @param {boolean} options.forceVerification - Force verification regardless of settings
         * @returns {boolean} Whether to run verification
         */
        shouldVerify(extractionResult, options = {}) {
            // Manual trigger always runs
            if (options.forceVerification) {
                return true;
            }

            // Must be enabled
            if (!this.enabled || !this.apiKey) {
                return false;
            }

            // Check trigger mode
            switch (this.triggerMode) {
                case TriggerMode.ALWAYS:
                    return true;

                case TriggerMode.MANUAL:
                    return false;

                case TriggerMode.SMART:
                default:
                    // Run if confidence is below threshold
                    const confidence = extractionResult.confidence?.overall || 0;
                    const normalizedConfidence = confidence > 1 ? confidence / 100 : confidence;
                    return normalizedConfidence < this.smartThreshold;
            }
        }

        /**
         * Verify extraction results against the actual PDF document
         * @param {number} fileId - NetSuite file ID
         * @param {Object} extractionResult - OCR extraction result
         * @param {Object} formSchema - Form field schema (optional)
         * @returns {Object} Verification result
         */
        verify(fileId, extractionResult, formSchema = null) {
            const startTime = Date.now();

            try {
                // Validate API key
                if (!this.apiKey) {
                    return {
                        success: false,
                        error: 'Gemini API key not configured',
                        skipped: true
                    };
                }

                // Load and encode PDF
                const fileObj = file.load({ id: fileId });
                const fileSizeMB = fileObj.size / (1024 * 1024);

                // Skip large files
                if (fileSizeMB > this.skipFileSizeMB) {
                    log.audit('GeminiVerifier', `Skipping file ${fileId}: ${fileSizeMB.toFixed(2)}MB exceeds limit`);
                    return {
                        success: false,
                        skipped: true,
                        reason: `File size (${fileSizeMB.toFixed(1)}MB) exceeds limit (${this.skipFileSizeMB}MB)`
                    };
                }

                // Get file content as base64 (NetSuite binary files return base64)
                const fileContents = fileObj.getContents();

                // Avoid double-encoding when contents are already base64 (PDF/Image files)
                const looksBase64 = /^[A-Za-z0-9+/=\s]+$/.test(fileContents);
                const pdfBase64 = looksBase64
                    ? fileContents
                    : encode.convert({
                        string: fileContents,
                        inputEncoding: encode.Encoding.UTF_8,
                        outputEncoding: encode.Encoding.BASE_64
                    });

                // Determine MIME type
                const fileName = fileObj.name.toLowerCase();
                let mimeType = 'application/pdf';
                if (fileName.endsWith('.png')) mimeType = 'image/png';
                else if (fileName.endsWith('.jpg') || fileName.endsWith('.jpeg')) mimeType = 'image/jpeg';
                else if (fileName.endsWith('.tiff') || fileName.endsWith('.tif')) mimeType = 'image/tiff';

                // Build verification prompt
                const prompt = this._buildVerificationPrompt(extractionResult, formSchema);

                // Build request body
                const requestBody = {
                    contents: [{
                        parts: [
                            {
                                inline_data: {
                                    mime_type: mimeType,
                                    data: pdfBase64
                                }
                            },
                            {
                                text: prompt
                            }
                        ]
                    }],
                    generationConfig: {
                        responseMimeType: 'application/json',
                        temperature: 0.1,
                        maxOutputTokens: 8192
                    }
                };

                // Make API call
                log.audit('GeminiVerifier', `Calling Gemini API for file ${fileId}`);

                const response = https.post({
                    url: `${this.endpoint}?key=${this.apiKey}`,
                    headers: {
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify(requestBody)
                });

                if (response.code !== 200) {
                    log.error('GeminiVerifier', `API error: ${response.code} - ${response.body}`);
                    return {
                        success: false,
                        error: `Gemini API error: ${response.code}`,
                        details: response.body
                    };
                }

                // Parse response
                const apiResponse = JSON.parse(response.body);
                const verificationResult = this._parseResponse(apiResponse);

                const duration = Date.now() - startTime;
                log.audit('GeminiVerifier', `Verification completed in ${duration}ms`);

                return {
                    success: true,
                    duration: duration,
                    verification: verificationResult.verification || {},
                    corrections: verificationResult.corrections || [],
                    missedFields: verificationResult.missedFields || [],
                    lineItemIssues: verificationResult.lineItemIssues || [],
                    validationFlags: verificationResult.validationFlags || [],
                    rawResponse: verificationResult
                };

            } catch (error) {
                log.error('GeminiVerifier.verify', {
                    message: error.message,
                    stack: error.stack
                });

                return {
                    success: false,
                    error: error.message,
                    duration: Date.now() - startTime
                };
            }
        }

        /**
         * Build the verification prompt for Gemini
         * @private
         */
        _buildVerificationPrompt(extractionResult, formSchema) {
            // Prepare extracted data summary
            const extractedData = this._prepareExtractionSummary(extractionResult);

            // Build form fields list if available
            let formFieldsSection = '';
            if (formSchema && formSchema.bodyFields) {
                const fieldLabels = formSchema.bodyFields
                    .slice(0, 30)
                    .map(f => `${f.id}: ${f.label || f.id}`)
                    .join('\n');
                formFieldsSection = `\nAVAILABLE FORM FIELDS:\n${fieldLabels}\n`;
            }

            return `You are an expert document analyst verifying invoice/bill OCR extraction accuracy.

TASK: Carefully read the attached document and verify the accuracy of the extracted data below.

EXTRACTED DATA TO VERIFY:
${JSON.stringify(extractedData, null, 2)}
${formFieldsSection}
VERIFICATION INSTRUCTIONS:
1. Read every visible element on this document carefully
2. Compare each extracted field against what you see in the document
3. Identify any OCR errors (misread characters, wrong values)
4. Find important fields that exist on the document but weren't extracted
5. Verify line items match what's on the invoice
6. Check that amounts add up correctly (line items = subtotal, subtotal + tax = total)
7. Look for handwritten annotations, stamps, or notes that might contain important info

RESPOND WITH THIS EXACT JSON STRUCTURE:
{
    "verification": {
        "accuracy": 0.95,
        "fieldsVerified": 12,
        "issuesFound": 2,
        "summary": "Brief summary of verification results"
    },
    "corrections": [
        {
            "field": "invoiceNumber",
            "extracted": "1NV-123",
            "correct": "INV-123",
            "confidence": 0.98,
            "reason": "OCR misread 'I' as '1'"
        }
    ],
    "missedFields": [
        {
            "field": "purchaseOrderNumber",
            "value": "PO-5678",
            "confidence": 0.95,
            "location": "Top right header area"
        }
    ],
    "lineItemIssues": [
        {
            "type": "missing|incorrect|extra",
            "lineNumber": 1,
            "description": "Description of the issue",
            "expectedValue": "What should be there",
            "extractedValue": "What was extracted"
        }
    ],
    "validationFlags": [
        {
            "type": "amount_mismatch|date_invalid|vendor_mismatch|duplicate_warning",
            "message": "Clear description of the issue",
            "severity": "high|medium|low",
            "details": {}
        }
    ]
}

Be thorough but focus on accuracy. Only report genuine discrepancies, not minor formatting differences.`;
        }

        /**
         * Prepare extraction summary for the prompt
         * @private
         */
        _prepareExtractionSummary(result) {
            const extraction = result.extraction || result;
            const fields = extraction.fields || {};

            return {
                vendorName: fields.vendorName || null,
                invoiceNumber: fields.invoiceNumber || null,
                invoiceDate: fields.invoiceDate || null,
                dueDate: fields.dueDate || null,
                poNumber: fields.poNumber || null,
                subtotal: fields.subtotal || null,
                taxAmount: fields.taxAmount || null,
                totalAmount: fields.totalAmount || null,
                currency: fields.currency || 'USD',
                lineItems: (extraction.lineItems || []).slice(0, 20).map(item => ({
                    description: item.description || item.memo,
                    quantity: item.quantity,
                    unitPrice: item.unitPrice || item.rate,
                    amount: item.amount
                })),
                confidence: extraction.confidence?.overall || null
            };
        }

        /**
         * Parse API response and extract structured verification data
         * @private
         */
        _parseResponse(apiResponse) {
            try {
                // Extract text content from response
                const content = apiResponse.candidates?.[0]?.content?.parts?.[0]?.text;

                if (!content) {
                    log.error('GeminiVerifier._parseResponse', 'No content in API response');
                    return { error: 'Empty response from API' };
                }

                // Parse JSON response
                const parsed = JSON.parse(content);
                return parsed;

            } catch (e) {
                log.error('GeminiVerifier._parseResponse', `Parse error: ${e.message}`);
                return {
                    error: 'Failed to parse API response',
                    rawContent: apiResponse.candidates?.[0]?.content?.parts?.[0]?.text?.substring(0, 500)
                };
            }
        }

        /**
         * Apply verification results to extraction data
         * Creates an enhanced extraction with AI corrections and additions
         * @param {Object} originalResult - Original extraction result
         * @param {Object} verificationResult - Verification result from verify()
         * @returns {Object} Enhanced extraction result
         */
        applyVerification(originalResult, verificationResult) {
            if (!verificationResult.success) {
                return originalResult;
            }

            const enhanced = JSON.parse(JSON.stringify(originalResult));
            const extraction = enhanced.extraction || enhanced;

            // Add AI verification metadata
            extraction.aiVerification = {
                verified: true,
                accuracy: verificationResult.verification?.accuracy || null,
                fieldsVerified: verificationResult.verification?.fieldsVerified || 0,
                issuesFound: verificationResult.verification?.issuesFound || 0,
                summary: verificationResult.verification?.summary || null,
                corrections: verificationResult.corrections || [],
                missedFields: verificationResult.missedFields || [],
                lineItemIssues: verificationResult.lineItemIssues || [],
                validationFlags: verificationResult.validationFlags || [],
                duration: verificationResult.duration || 0
            };

            // Adjust confidence if we have AI accuracy score
            if (verificationResult.verification?.accuracy) {
                const ocrConfidence = extraction.confidence?.overall || 0;
                const aiAccuracy = verificationResult.verification.accuracy;

                // Blend OCR confidence with AI accuracy
                extraction.confidence = extraction.confidence || {};
                extraction.confidence.aiVerified = true;
                extraction.confidence.aiAccuracy = Math.round(aiAccuracy * 100);
                extraction.confidence.adjusted = Math.round(
                    ((ocrConfidence / 100 * 0.4) + (aiAccuracy * 0.6)) * 100
                );
            }

            return enhanced;
        }
    }

    // ==================== Configuration Management ====================

    /**
     * Load LLM verifier configuration from NetSuite
     * @returns {Object} Configuration object
     */
    function loadConfig() {
        try {
            const searchObj = search.create({
                type: CONFIG_RECORD_TYPE,
                filters: [
                    ['custrecord_flux_cfg_type', 'is', LLM_CONFIG_TYPE],
                    'AND',
                    ['custrecord_flux_cfg_key', 'is', LLM_CONFIG_KEY]
                ],
                columns: ['custrecord_flux_cfg_data']
            });

            let config = null;
            searchObj.run().each(function(result) {
                const dataJson = result.getValue({ name: 'custrecord_flux_cfg_data' });
                if (dataJson) {
                    config = JSON.parse(dataJson);
                }
                return false;
            });

            if (!config) {
                return getDefaultConfig();
            }

            // Decrypt API key if encrypted
            if (config.apiKey && config._apiKeyEncrypted) {
                config.apiKey = decryptValue(config.apiKey);
            }

            return config;

        } catch (e) {
            log.error('GeminiVerifier.loadConfig', e.message);
            return getDefaultConfig();
        }
    }

    /**
     * Save LLM verifier configuration
     * @param {Object} config - Configuration to save
     * @returns {Object} Result {success, message}
     */
    function saveConfig(config) {
        try {
            // Encrypt API key if provided
            const configToSave = { ...config };
            if (configToSave.apiKey && !configToSave.apiKey.startsWith('ENC:') && !configToSave.apiKey.startsWith('B64:')) {
                configToSave.apiKey = encryptValue(configToSave.apiKey);
                configToSave._apiKeyEncrypted = true;
            }

            // Find existing record
            const searchObj = search.create({
                type: CONFIG_RECORD_TYPE,
                filters: [
                    ['custrecord_flux_cfg_type', 'is', LLM_CONFIG_TYPE],
                    'AND',
                    ['custrecord_flux_cfg_key', 'is', LLM_CONFIG_KEY]
                ],
                columns: ['internalid']
            });

            let existingId = null;
            searchObj.run().each(function(result) {
                existingId = result.id;
                return false;
            });

            if (existingId) {
                // Update existing
                record.submitFields({
                    type: CONFIG_RECORD_TYPE,
                    id: existingId,
                    values: {
                        'custrecord_flux_cfg_data': JSON.stringify(configToSave)
                    }
                });
            } else {
                // Create new
                const configRecord = record.create({ type: CONFIG_RECORD_TYPE });
                configRecord.setValue({ fieldId: 'name', value: 'Gemini Verifier Settings' });
                configRecord.setValue({ fieldId: 'custrecord_flux_cfg_type', value: LLM_CONFIG_TYPE });
                configRecord.setValue({ fieldId: 'custrecord_flux_cfg_key', value: LLM_CONFIG_KEY });
                configRecord.setValue({ fieldId: 'custrecord_flux_cfg_data', value: JSON.stringify(configToSave) });
                configRecord.save();
            }

            log.audit('GeminiVerifier.saveConfig', 'Configuration saved');

            return { success: true, message: 'Configuration saved' };

        } catch (e) {
            log.error('GeminiVerifier.saveConfig', e.message);
            return { success: false, message: e.message };
        }
    }

    /**
     * Get configuration for UI (with masked API key)
     * @returns {Object} Configuration with masked sensitive fields
     */
    function getConfigForUI() {
        const config = loadConfig();

        // Mask API key
        if (config.apiKey) {
            const key = config.apiKey;
            config.apiKey = key.length > 4 ?
                '••••••••' + key.substring(key.length - 4) :
                '••••••••';
            config._hasApiKey = true;
        } else {
            config._hasApiKey = false;
        }

        return config;
    }

    /**
     * Get default configuration
     * @returns {Object} Default config
     */
    function getDefaultConfig() {
        return {
            enabled: false,
            apiKey: '',
            model: DEFAULT_MODEL,
            triggerMode: TriggerMode.SMART,
            smartThreshold: 0.70,
            maxPages: 20,
            skipFileSizeMB: 25
        };
    }

    /**
     * Test Gemini API connection
     * @param {string} apiKey - API key to test
     * @returns {Object} Test result
     */
    function testConnection(apiKey) {
        try {
            if (!apiKey) {
                return { success: false, message: 'API key is required' };
            }

            // Make a simple API call to verify the key works
            const response = https.get({
                url: `${GEMINI_API_BASE}/models?key=${apiKey}`,
                headers: { 'Content-Type': 'application/json' }
            });

            if (response.code === 200) {
                const data = JSON.parse(response.body);
                const models = data.models || [];
                const flashModels = models.filter(m => m.name && m.name.includes('flash'));

                return {
                    success: true,
                    message: 'Connection successful',
                    availableModels: flashModels.length,
                    models: flashModels.map(m => m.name).slice(0, 5)
                };
            } else if (response.code === 401 || response.code === 403) {
                return { success: false, message: 'Invalid API key' };
            } else {
                return {
                    success: false,
                    message: `API error: ${response.code}`,
                    details: response.body
                };
            }

        } catch (e) {
            return { success: false, message: e.message };
        }
    }

    /**
     * Create a configured GeminiVerifier instance
     * @returns {GeminiVerifier} Configured verifier
     */
    function createVerifier() {
        const config = loadConfig();
        return new GeminiVerifier(config);
    }

    // ==================== Encryption Helpers ====================

    function encryptValue(value) {
        if (!value) return value;

        try {
            const secretKey = crypto.createSecretKey({
                guid: ENCRYPTION_KEY_ID,
                encoding: crypto.Encoding.UTF_8
            });

            const cipher = crypto.createCipher({
                algorithm: crypto.EncryptionAlg.AES,
                key: secretKey
            });

            cipher.update({
                input: value,
                inputEncoding: crypto.Encoding.UTF_8
            });

            const encrypted = cipher.final({
                outputEncoding: crypto.Encoding.BASE_64
            });

            return 'ENC:' + encrypted;

        } catch (e) {
            // Fallback to base64
            log.error('GeminiVerifier.encryptValue', `Crypto failed: ${e.message}`);
            const encoded = encode.convert({
                string: value,
                inputEncoding: encode.Encoding.UTF_8,
                outputEncoding: encode.Encoding.BASE_64
            });
            return 'B64:' + encoded;
        }
    }

    function decryptValue(encryptedValue) {
        if (!encryptedValue) return encryptedValue;

        try {
            if (encryptedValue.startsWith('ENC:')) {
                const encrypted = encryptedValue.substring(4);

                const secretKey = crypto.createSecretKey({
                    guid: ENCRYPTION_KEY_ID,
                    encoding: crypto.Encoding.UTF_8
                });

                const decipher = crypto.createDecipher({
                    algorithm: crypto.EncryptionAlg.AES,
                    key: secretKey
                });

                decipher.update({
                    input: encrypted,
                    inputEncoding: crypto.Encoding.BASE_64
                });

                return decipher.final({
                    outputEncoding: crypto.Encoding.UTF_8
                });

            } else if (encryptedValue.startsWith('B64:')) {
                const encoded = encryptedValue.substring(4);
                return encode.convert({
                    string: encoded,
                    inputEncoding: encode.Encoding.BASE_64,
                    outputEncoding: encode.Encoding.UTF_8
                });
            }

            return encryptedValue;

        } catch (e) {
            log.error('GeminiVerifier.decryptValue', e.message);
            return encryptedValue;
        }
    }

    // ==================== Exports ====================

    return {
        GeminiVerifier: GeminiVerifier,
        TriggerMode: TriggerMode,
        loadConfig: loadConfig,
        saveConfig: saveConfig,
        getConfigForUI: getConfigForUI,
        getDefaultConfig: getDefaultConfig,
        testConnection: testConnection,
        createVerifier: createVerifier,
        DEFAULT_MODEL: DEFAULT_MODEL
    };
});
