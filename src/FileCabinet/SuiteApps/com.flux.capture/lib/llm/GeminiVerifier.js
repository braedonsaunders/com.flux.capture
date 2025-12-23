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
         * @param {boolean} config.autoApplyCorrections - Auto-apply high-confidence corrections
         * @param {number} config.autoApplyThreshold - Confidence threshold for auto-apply (0-1)
         * @param {boolean} config.enhanceLineItems - Allow AI to add/edit/delete line items
         * @param {boolean} config.guessAccounts - Allow AI to suggest accounts for line items
         * @param {boolean} config.guessDepartments - Allow AI to suggest departments for line items
         * @param {boolean} config.guessClasses - Allow AI to suggest classes for line items
         * @param {boolean} config.guessLocations - Allow AI to suggest locations for line items
         */
        constructor(config = {}) {
            this.enabled = config.enabled || false;
            this.apiKey = config.apiKey || null;
            this.model = config.model || DEFAULT_MODEL;
            this.triggerMode = config.triggerMode || TriggerMode.SMART;
            this.smartThreshold = config.smartThreshold || 0.70;
            this.maxPages = config.maxPages || 20;
            this.skipFileSizeMB = config.skipFileSizeMB || 25;
            // Auto-apply settings - AI can directly update fields
            this.autoApplyCorrections = config.autoApplyCorrections !== false; // Default: true
            this.autoApplyThreshold = config.autoApplyThreshold || 0.85; // High confidence threshold
            // Line item enhancement settings
            this.enhanceLineItems = config.enhanceLineItems || false;
            this.guessAccounts = config.guessAccounts || false;
            this.guessDepartments = config.guessDepartments || false;
            this.guessClasses = config.guessClasses || false;
            this.guessLocations = config.guessLocations || false;

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
         * @param {Object} options - Additional options
         * @param {number} options.vendorId - Vendor ID for history lookup
         * @returns {Object} Verification result
         */
        verify(fileId, extractionResult, formSchema = null, options = {}) {
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

                // Get vendor history for anomaly detection (if vendor ID provided)
                let vendorHistory = null;
                if (options.vendorId) {
                    vendorHistory = getVendorHistory(options.vendorId);
                }

                // Extract existing anomalies from the extraction result
                const existingAnomalies = extractionResult.extraction?.anomalies || extractionResult.anomalies || [];

                // Build line item options for prompt
                const lineItemOptions = {
                    enhanceLineItems: this.enhanceLineItems,
                    guessAccounts: this.guessAccounts,
                    guessDepartments: this.guessDepartments,
                    guessClasses: this.guessClasses,
                    guessLocations: this.guessLocations
                };

                // Build verification prompt with vendor history context and existing alerts
                const prompt = this._buildVerificationPrompt(extractionResult, formSchema, vendorHistory, existingAnomalies, lineItemOptions);

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
                    lineItems: verificationResult.lineItems || null, // Complete line items from AI
                    validationFlags: verificationResult.validationFlags || [],
                    mathValidation: verificationResult.mathValidation || null,
                    paymentTerms: verificationResult.paymentTerms || null,
                    alerts: verificationResult.alerts || [],
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
         * Check if the form schema has quantity and rate fields in sublists
         * @private
         */
        _hasQuantityRateFields(formSchema) {
            if (!formSchema || !formSchema.sublists) {
                return false;
            }

            const qtyRateFieldIds = ['quantity', 'qty', 'rate', 'unitprice', 'unit_price', 'price'];

            for (const sublist of formSchema.sublists) {
                if (!sublist.fields) continue;

                let hasQty = false;
                let hasRate = false;

                for (const field of sublist.fields) {
                    const fieldIdLower = (field.id || '').toLowerCase();
                    if (fieldIdLower === 'quantity' || fieldIdLower === 'qty') {
                        hasQty = true;
                    }
                    if (fieldIdLower === 'rate' || fieldIdLower === 'unitprice' || fieldIdLower === 'unit_price' || fieldIdLower === 'price') {
                        hasRate = true;
                    }
                }

                // If any sublist has both qty and rate, return true
                if (hasQty && hasRate) {
                    return true;
                }
            }

            return false;
        }

        /**
         * Build the verification prompt for Gemini
         * Enhanced with fraud detection, risk assessment, and high-value insights
         * @private
         */
        _buildVerificationPrompt(extractionResult, formSchema, vendorHistory = null, existingAlerts = [], lineItemOptions = {}) {
            const today = new Date();
            const todayIso = today.toISOString().split('T')[0];

            // Prepare extracted data summary
            const extractedData = this._prepareExtractionSummary(extractionResult);

            // Check if form has quantity/rate fields for line item calculation validation
            const hasQtyRateFields = this._hasQuantityRateFields(formSchema);

            // Build form fields list if available
            let formFieldsSection = '';
            if (formSchema && formSchema.bodyFields) {
                const fieldLabels = formSchema.bodyFields
                    .slice(0, 30)
                    .map(f => `${f.id}: ${f.label || f.id}`)
                    .join('\n');
                formFieldsSection = `\nAVAILABLE FORM FIELDS:\n${fieldLabels}\n`;
            }

            // Build vendor history context if available
            let vendorHistorySection = '';
            if (vendorHistory) {
                vendorHistorySection = `
VENDOR HISTORY CONTEXT (use this to detect anomalies):
- Vendor: ${vendorHistory.vendorName || 'Unknown'}
- Typical invoice range: ${vendorHistory.avgAmount ? '$' + vendorHistory.minAmount + ' - $' + vendorHistory.maxAmount : 'Unknown'}
- Average invoice: ${vendorHistory.avgAmount ? '$' + vendorHistory.avgAmount.toFixed(2) : 'Unknown'}
- Typical payment terms: ${vendorHistory.typicalTerms || 'Unknown'}
- Common invoice format: ${vendorHistory.invoicePattern || 'Unknown'}
- Last invoice date: ${vendorHistory.lastInvoiceDate || 'Unknown'}
- Total invoices processed: ${vendorHistory.invoiceCount || 'Unknown'}
`;
            }

            // Build existing alerts section
            let existingAlertsSection = '';
            if (existingAlerts && existingAlerts.length > 0) {
                existingAlertsSection = `
EXISTING SYSTEM ALERTS (review and consolidate these - DO NOT duplicate):
${JSON.stringify(existingAlerts, null, 2)}

IMPORTANT: The above alerts were generated by our validation system. You must:
1. Review each existing alert and determine if it's valid based on the actual document
2. Include valid alerts in your unified "alerts" array (don't duplicate - consolidate similar ones)
3. Dismiss any alerts that are false positives based on what you see in the document
4. Add any NEW alerts you discover that aren't already covered
`;
            }

            // Build line item calculation validation section based on form schema
            let lineItemCalcSection = '';
            if (hasQtyRateFields) {
                lineItemCalcSection = `
   - Verify: Quantity × Unit Price = Line Item Amount (only if both qty and rate are visible on document)`;
            }

            // Build lineItemIssues type list based on form schema
            const lineItemIssueTypes = hasQtyRateFields
                ? 'missing|incorrect|extra|calculation_error'
                : 'missing|incorrect|extra';

            return `You are an expert accounts payable analyst and fraud detection specialist. Your job is to verify invoice accuracy, detect potential fraud or errors, and provide actionable insights that save the company money.

CURRENT DATE: ${todayIso}
COMPANY LOCATION: Canada (CAD is the primary currency)

EXTRACTED DATA TO VERIFY:
${JSON.stringify(extractedData, null, 2)}
${formFieldsSection}${vendorHistorySection}${existingAlertsSection}

=== PRIMARY VERIFICATION TASKS ===

1. OCR ACCURACY VERIFICATION
   - Compare every extracted field against the actual document
   - Identify OCR misreads (0/O, 1/I/l, 5/S, 8/B, etc.)
   - Check for truncated or partial values

2. MATHEMATICAL VALIDATION (HIGH PRIORITY)
   - Verify: Sum of line item amounts = Subtotal
   - Verify: Subtotal + Tax = Total
   - Check tax rate reasonableness (typically 5-15% for GST/HST/PST)
   - Flag any rounding discrepancies > $0.05${lineItemCalcSection}

3. DATE VALIDATION & PAYMENT TERMS
   - Invoice date should not be in the future
   - Invoice date should not be more than 90 days old (flag if stale)
   - If payment terms are visible (Net 30, Net 60, 2/10 Net 30), infer the due date
   - Flag if due date is before invoice date (impossible)
   - Calculate days until due date

4. MISSING CRITICAL FIELDS
   - Invoice number (required for duplicate detection)
   - PO number (if this vendor typically uses POs)
   - Payment terms (if visible on document)
   - Remittance address (if different from header address)
   - Account numbers or reference codes

5. FRAUD & RISK INDICATORS (CRITICAL)
   Watch for these red flags and report with HIGH severity:
   - Round dollar amounts with no cents (e.g., $5,000.00 exactly)
   - Invoice number patterns that seem unusual or sequential manipulation
   - Vendor address that's a PO Box or residential address
   - Bank account change notices on the invoice
   - "Rush" or "urgent" payment language
   - Invoice dated on weekend/holiday
   - Amount significantly different from vendor's typical range
   - Duplicate invoice number from same vendor (different amount)
   - Missing or inconsistent tax registration numbers
   - Handwritten changes or whiteout marks on printed invoices
   - Email/wire payment instructions added by hand

6. VENDOR CONSISTENCY CHECKS
   - Does the vendor name match the letterhead/logo?
   - Is the address consistent with what's expected?
   - Are there multiple vendor names/entities on the document?

=== CURRENCY RULES (STRICT) ===
- NEVER correct currency based on $ symbol alone
- Only flag currency issues if you see an EXPLICIT code (USD, EUR, GBP written out)
- Company is in Canada - assume $ = CAD unless explicitly marked otherwise
- If you see "US$" or "USD" explicitly, THAT is evidence for a correction
${this._buildLineItemEnhancementSection(lineItemOptions, vendorHistory)}
=== RESPONSE FORMAT ===
{
    "verification": {
        "accuracy": 0.0-1.0,
        "fieldsVerified": number,
        "issuesFound": number,
        "riskScore": "low|medium|high|critical",
        "summary": "One-sentence summary of findings",
        "recommendation": "approve|review|reject"
    },
    "mathValidation": {
        "lineItemsSum": number or null,
        "subtotalOnDoc": number or null,
        "taxAmount": number or null,
        "taxRate": "X%" or null,
        "totalOnDoc": number or null,
        "calculatedTotal": number or null,
        "discrepancy": number or null,
        "isValid": true/false
    },
    "corrections": [
        {
            "field": "fieldName",
            "extracted": "what was extracted",
            "correct": "what it should be",
            "confidence": 0.0-1.0,
            "reason": "why this is wrong",
            "impact": "low|medium|high"
        }
    ],
    "missedFields": [
        {
            "field": "fieldName",
            "value": "the value",
            "confidence": 0.0-1.0,
            "location": "where on document",
            "importance": "critical|important|optional"
        }
    ],
    "lineItemIssues": [
        {
            "type": "${lineItemIssueTypes}",
            "lineNumber": number,
            "description": "what's wrong",
            "expectedValue": "what should be",
            "extractedValue": "what was extracted",
            "impact": "$X difference" or null
        }
    ],
    "lineItems": [
        {
            "description": "Line item description/memo",
            "quantity": number or null,
            "unitPrice": number or null,
            "amount": number,
            "account": "Account name or number (if guessing enabled)" or null,
            "department": "Department name (if guessing enabled)" or null,
            "class": "Class name (if guessing enabled)" or null,
            "location": "Location name (if guessing enabled)" or null,
            "confidence": 0.0-1.0,
            "_action": "keep|add|modify|delete",
            "_originalIndex": number or null,
            "_reason": "Why this action is recommended"
        }
    ],
    "alerts": [
        {
            "message": "Clear, actionable description of the alert",
            "severity": "critical|high|medium|low",
            "type": "validation|duplicate|fraud_risk|date_issue|amount_mismatch|vendor_mismatch|missing_field|tax_error|other",
            "action": "What the user should do (optional)",
            "source": "ai|system|consolidated"
        }
    ],
    "paymentTerms": {
        "detected": "Net 30" or null,
        "dueDate": "YYYY-MM-DD" or null,
        "daysUntilDue": number or null,
        "earlyPayDiscount": "2% if paid within 10 days" or null
    },
    "insights": [
        "Any additional observations that could save money or time"
    ]
}

=== IMPORTANT GUIDELINES ===
- The "alerts" array should be the UNIFIED list of all alerts (system + AI). Do NOT duplicate alerts.
- Consolidate similar alerts from the existing system alerts with your findings
- Mark source as "consolidated" if you merged a system alert with your own finding
- Mark source as "system" if you're keeping an existing alert as-is
- Mark source as "ai" for new alerts you discovered
- Be thorough but only report genuine issues, not formatting preferences
- If math doesn't add up, this is HIGH severity - money is at stake
- Missing invoice numbers are HIGH severity - duplicate payment risk
- Fraud indicators should always be flagged even if you're not certain
- Provide specific, actionable recommendations
- If everything looks correct, say so confidently with high accuracy score
- LINE ITEM CALCULATION: Only report "calculation_error" if BOTH quantity AND unit price/rate are visible on the document. Many invoices only show amounts without qty/rate breakdown - this is normal and NOT an error.`;
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
                paymentTerms: fields.paymentTerms || null,
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
         * Build line item enhancement section for the prompt
         * @private
         */
        _buildLineItemEnhancementSection(lineItemOptions, vendorHistory) {
            if (!lineItemOptions.enhanceLineItems) {
                return '\n'; // No line item enhancement
            }

            const guessingFields = [];
            if (lineItemOptions.guessAccounts) guessingFields.push('account');
            if (lineItemOptions.guessDepartments) guessingFields.push('department');
            if (lineItemOptions.guessClasses) guessingFields.push('class');
            if (lineItemOptions.guessLocations) guessingFields.push('location');

            let section = `
=== LINE ITEM ENHANCEMENT (ENABLED) ===
You have full authority to enhance line items. Your goal is to ensure the line items are COMPLETE and ACCURATE based on what you see in the PDF.

CAPABILITIES:
- ADD line items that appear in the PDF but were missed by OCR
- MODIFY line items where values were extracted incorrectly
- DELETE line items that don't exist in the PDF (OCR hallucinations)
- KEEP line items that are correct

CRITICAL REQUIREMENTS:
1. Extract ALL line items visible in the PDF - be thorough
2. Include description/memo, quantity, unit price, and amount for each line
3. Ensure line item amounts match what's in the document
4. Mark each line item with _action: "keep", "add", "modify", or "delete"
5. For modified items, include _originalIndex to indicate which extracted item was changed
6. For deleted items, include _originalIndex and set other fields to null

`;

            if (guessingFields.length > 0) {
                section += `
FIELD GUESSING (ENABLED for: ${guessingFields.join(', ')}):
You may suggest values for these sublist-level fields based on context clues:
`;
                if (lineItemOptions.guessAccounts) {
                    section += `- account: Suggest an expense/COGS account based on the line item description
  Examples: "Office Supplies" for pens/paper, "Travel" for flights/hotels, "Software" for subscriptions
`;
                }
                if (lineItemOptions.guessDepartments) {
                    section += `- department: Suggest a department based on context (e.g., "Marketing", "Engineering", "Sales")
`;
                }
                if (lineItemOptions.guessClasses) {
                    section += `- class: Suggest a class/category if apparent from the invoice context
`;
                }
                if (lineItemOptions.guessLocations) {
                    section += `- location: Suggest a location if mentioned or implied in the document
`;
                }

                if (vendorHistory) {
                    section += `
VENDOR HISTORY FOR GUESSING:
This vendor typically uses these classifications (use as guidance):
${vendorHistory.typicalAccount ? `- Common account: ${vendorHistory.typicalAccount}` : ''}
${vendorHistory.typicalDepartment ? `- Common department: ${vendorHistory.typicalDepartment}` : ''}
${vendorHistory.typicalClass ? `- Common class: ${vendorHistory.typicalClass}` : ''}
${vendorHistory.typicalLocation ? `- Common location: ${vendorHistory.typicalLocation}` : ''}
`;
                }

                section += `
GUESSING CONFIDENCE:
- Only guess fields with confidence >= 0.7
- Set confidence based on how certain you are about the suggestion
- Leave fields as null if you can't make a reasonable guess
`;
            } else {
                section += `
FIELD GUESSING: DISABLED
Do not include account, department, class, or location fields in line items.
`;
            }

            return section;
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
            const verification = verificationResult.verification || {};
            const corrections = verificationResult.corrections || [];
            const missedFields = verificationResult.missedFields || [];

            // Separate corrections into auto-applied and suggestions based on confidence
            const autoApplied = [];
            const suggestedCorrections = [];
            const suggestedMissedFields = [];

            // Auto-apply high-confidence corrections
            if (this.autoApplyCorrections) {
                extraction.fields = extraction.fields || {};

                for (const correction of corrections) {
                    const confidence = correction.confidence || 0;
                    if (confidence >= this.autoApplyThreshold) {
                        // Auto-apply this correction
                        const fieldKey = this._normalizeFieldKey(correction.field);
                        const oldValue = extraction.fields[fieldKey];
                        extraction.fields[fieldKey] = correction.correct;
                        autoApplied.push({
                            field: correction.field,
                            oldValue: oldValue || correction.extracted,
                            value: correction.correct,
                            confidence: confidence,
                            reason: correction.reason || 'AI verification detected discrepancy'
                        });
                        log.audit('GeminiVerifier', `Auto-applied correction: ${correction.field} = ${correction.correct} (confidence: ${confidence})`);
                    } else {
                        // Keep as suggestion
                        suggestedCorrections.push(correction);
                    }
                }

                // Auto-apply high-confidence missed fields
                for (const missed of missedFields) {
                    const confidence = missed.confidence || 0;
                    const importance = missed.importance || 'optional';
                    // Auto-apply if high confidence AND critical/important
                    if (confidence >= this.autoApplyThreshold && (importance === 'critical' || importance === 'important')) {
                        const fieldKey = this._normalizeFieldKey(missed.field);
                        if (!extraction.fields[fieldKey]) {
                            extraction.fields[fieldKey] = missed.value;
                            autoApplied.push({
                                field: missed.field,
                                oldValue: null,
                                value: missed.value,
                                confidence: confidence,
                                reason: missed.location ? `Found at: ${missed.location}` : 'AI detected missing field'
                            });
                            log.audit('GeminiVerifier', `Auto-added missed field: ${missed.field} = ${missed.value} (confidence: ${confidence})`);
                        } else {
                            suggestedMissedFields.push(missed);
                        }
                    } else {
                        suggestedMissedFields.push(missed);
                    }
                }
            } else {
                // If auto-apply is disabled, all corrections become suggestions
                suggestedCorrections.push(...corrections);
                suggestedMissedFields.push(...missedFields);
            }

            // Process line item enhancements if enabled and AI returned line items
            const lineItemChanges = {
                added: [],
                modified: [],
                deleted: [],
                kept: []
            };
            const aiLineItems = verificationResult.lineItems || verificationResult.rawResponse?.lineItems || null;

            if (this.enhanceLineItems && aiLineItems && Array.isArray(aiLineItems)) {
                const originalLineItems = extraction.lineItems || [];
                const enhancedLineItems = [];

                for (const aiItem of aiLineItems) {
                    const action = aiItem._action || 'keep';
                    const confidence = aiItem.confidence || 0;

                    if (action === 'delete') {
                        // Track deletion (don't add to enhanced list)
                        if (aiItem._originalIndex !== null && aiItem._originalIndex !== undefined) {
                            const deletedItem = originalLineItems[aiItem._originalIndex];
                            if (deletedItem) {
                                lineItemChanges.deleted.push({
                                    originalIndex: aiItem._originalIndex,
                                    description: deletedItem.description || deletedItem.memo,
                                    amount: deletedItem.amount,
                                    reason: aiItem._reason || 'AI detected this line item does not exist in document'
                                });
                            }
                        }
                        log.audit('GeminiVerifier', `Deleted line item at index ${aiItem._originalIndex}: ${aiItem._reason || 'not in document'}`);

                    } else if (action === 'add' && confidence >= this.autoApplyThreshold) {
                        // Add new line item
                        const newItem = this._buildLineItem(aiItem);
                        newItem._source = 'ai_enhanced';
                        newItem._aiAdded = true;
                        enhancedLineItems.push(newItem);
                        lineItemChanges.added.push({
                            description: newItem.description || newItem.memo,
                            amount: newItem.amount,
                            confidence: confidence,
                            reason: aiItem._reason || 'AI detected missing line item'
                        });
                        log.audit('GeminiVerifier', `Added line item: ${newItem.description || newItem.memo} = $${newItem.amount}`);

                    } else if (action === 'modify' && confidence >= this.autoApplyThreshold) {
                        // Modify existing line item
                        const originalIndex = aiItem._originalIndex;
                        const originalItem = originalIndex !== null && originalIndex !== undefined
                            ? originalLineItems[originalIndex] : null;
                        const modifiedItem = this._buildLineItem(aiItem, originalItem);
                        modifiedItem._source = 'ai_enhanced';
                        modifiedItem._aiModified = true;
                        modifiedItem._originalIndex = originalIndex;
                        enhancedLineItems.push(modifiedItem);
                        lineItemChanges.modified.push({
                            originalIndex: originalIndex,
                            original: originalItem ? {
                                description: originalItem.description || originalItem.memo,
                                amount: originalItem.amount
                            } : null,
                            modified: {
                                description: modifiedItem.description || modifiedItem.memo,
                                amount: modifiedItem.amount
                            },
                            confidence: confidence,
                            reason: aiItem._reason || 'AI corrected line item values'
                        });
                        log.audit('GeminiVerifier', `Modified line item at index ${originalIndex}`);

                    } else if (action === 'keep') {
                        // Keep original line item (possibly with field suggestions)
                        const originalIndex = aiItem._originalIndex;
                        const originalItem = originalIndex !== null && originalIndex !== undefined
                            ? originalLineItems[originalIndex] : null;

                        if (originalItem) {
                            const keptItem = { ...originalItem };
                            // Apply field suggestions (account, department, etc.) if guessing is enabled
                            if (this.guessAccounts && aiItem.account && confidence >= 0.7) {
                                keptItem.account = aiItem.account;
                                keptItem._accountSuggested = true;
                            }
                            if (this.guessDepartments && aiItem.department && confidence >= 0.7) {
                                keptItem.department = aiItem.department;
                                keptItem._departmentSuggested = true;
                            }
                            if (this.guessClasses && aiItem.class && confidence >= 0.7) {
                                keptItem.class = aiItem.class;
                                keptItem._classSuggested = true;
                            }
                            if (this.guessLocations && aiItem.location && confidence >= 0.7) {
                                keptItem.location = aiItem.location;
                                keptItem._locationSuggested = true;
                            }
                            enhancedLineItems.push(keptItem);
                            lineItemChanges.kept.push({
                                originalIndex: originalIndex,
                                description: keptItem.description || keptItem.memo,
                                suggestedFields: {
                                    account: keptItem._accountSuggested ? keptItem.account : null,
                                    department: keptItem._departmentSuggested ? keptItem.department : null,
                                    class: keptItem._classSuggested ? keptItem.class : null,
                                    location: keptItem._locationSuggested ? keptItem.location : null
                                }
                            });
                        }
                    } else {
                        // Low confidence add/modify - keep original if exists, otherwise skip
                        const originalIndex = aiItem._originalIndex;
                        if (originalIndex !== null && originalIndex !== undefined && originalLineItems[originalIndex]) {
                            enhancedLineItems.push({ ...originalLineItems[originalIndex] });
                        }
                    }
                }

                // Replace line items with enhanced version
                extraction.lineItems = enhancedLineItems;
                log.audit('GeminiVerifier', `Line items enhanced: ${lineItemChanges.added.length} added, ${lineItemChanges.modified.length} modified, ${lineItemChanges.deleted.length} deleted`);
            }

            // Get unified alerts from AI (consolidates system alerts + AI findings)
            const rawAlerts = verificationResult.alerts || verificationResult.rawResponse?.alerts || [];

            // Filter out alerts for fields that have been auto-corrected
            // (since the correction already addresses the issue, no need to alert)
            const autoAppliedFields = new Set(autoApplied.map(a =>
                this._normalizeFieldKey(a.field)?.toLowerCase()
            ));

            const unifiedAlerts = rawAlerts.filter(alert => {
                // If alert has a field property, check if that field was auto-corrected
                const alertField = alert.field ? this._normalizeFieldKey(alert.field)?.toLowerCase() : null;
                if (alertField && autoAppliedFields.has(alertField)) {
                    log.audit('GeminiVerifier', `Filtering alert for auto-corrected field: ${alert.field}`);
                    return false;
                }

                // Also check message content for field references (e.g., "currency is incorrect")
                if (alert.message && autoAppliedFields.size > 0) {
                    const messageLower = alert.message.toLowerCase();
                    for (const field of autoAppliedFields) {
                        if (field && messageLower.includes(field)) {
                            log.audit('GeminiVerifier', `Filtering alert mentioning auto-corrected field "${field}": ${alert.message.substring(0, 50)}`);
                            return false;
                        }
                    }
                }

                return true;
            });

            // Add AI verification metadata with enhanced fields
            extraction.aiVerification = {
                verified: true,
                accuracy: verification.accuracy || null,
                fieldsVerified: verification.fieldsVerified || 0,
                issuesFound: verification.issuesFound || 0,
                riskScore: verification.riskScore || 'low',
                recommendation: verification.recommendation || 'review',
                summary: verification.summary || null,
                // Auto-applied items (already applied to fields)
                autoApplied: autoApplied,
                // Suggested items (require user action)
                corrections: suggestedCorrections,
                missedFields: suggestedMissedFields,
                lineItemIssues: verificationResult.lineItemIssues || [],
                // Line item enhancement results
                lineItemChanges: lineItemChanges,
                // Unified alerts (replaces both anomalies and validationFlags)
                alerts: unifiedAlerts,
                // Enhanced data
                mathValidation: verificationResult.mathValidation || null,
                paymentTerms: verificationResult.paymentTerms || null,
                insights: verificationResult.insights || [],
                duration: verificationResult.duration || 0
            };

            // Replace original anomalies with unified alerts from AI
            // This prevents duplicate display in the UI
            if (unifiedAlerts.length > 0) {
                extraction.anomalies = unifiedAlerts.map(alert => ({
                    message: alert.message,
                    severity: alert.severity || 'medium',
                    type: alert.type || 'other',
                    source: alert.source || 'ai'
                }));
            }

            // Auto-apply payment terms if detected and not already set
            if (verificationResult.paymentTerms) {
                const terms = verificationResult.paymentTerms;
                if (terms.dueDate && !extraction.fields?.dueDate) {
                    extraction.fields = extraction.fields || {};
                    extraction.fields.dueDate = terms.dueDate;
                    extraction.aiVerification.autoApplied.push({
                        field: 'dueDate',
                        value: terms.dueDate,
                        reason: `Inferred from ${terms.detected || 'payment terms'}`
                    });
                }
                if (terms.detected && !extraction.fields?.paymentTerms) {
                    extraction.fields = extraction.fields || {};
                    extraction.fields.paymentTerms = terms.detected;
                }
            }

            // Adjust confidence based on AI accuracy and risk score
            if (verification.accuracy) {
                const ocrConfidence = extraction.confidence?.overall || 0;
                const aiAccuracy = verification.accuracy;
                const riskPenalty = verification.riskScore === 'critical' ? 0.3 :
                                   verification.riskScore === 'high' ? 0.15 :
                                   verification.riskScore === 'medium' ? 0.05 : 0;

                // Blend OCR confidence with AI accuracy, apply risk penalty
                extraction.confidence = extraction.confidence || {};
                extraction.confidence.aiVerified = true;
                extraction.confidence.aiAccuracy = Math.round(aiAccuracy * 100);
                extraction.confidence.riskScore = verification.riskScore;
                extraction.confidence.adjusted = Math.round(
                    Math.max(0, ((ocrConfidence / 100 * 0.4) + (aiAccuracy * 0.6) - riskPenalty)) * 100
                );
            }

            return enhanced;
        }

        /**
         * Normalize field key from AI response to extraction field format
         * @private
         */
        _normalizeFieldKey(field) {
            if (!field) return field;
            // Map common AI field names to extraction field keys
            const fieldMap = {
                'invoiceNumber': 'invoiceNumber',
                'invoice_number': 'invoiceNumber',
                'Invoice Number': 'invoiceNumber',
                'invoiceDate': 'invoiceDate',
                'invoice_date': 'invoiceDate',
                'Invoice Date': 'invoiceDate',
                'dueDate': 'dueDate',
                'due_date': 'dueDate',
                'Due Date': 'dueDate',
                'totalAmount': 'totalAmount',
                'total_amount': 'totalAmount',
                'Total': 'totalAmount',
                'Total Amount': 'totalAmount',
                'subtotal': 'subtotal',
                'Subtotal': 'subtotal',
                'taxAmount': 'taxAmount',
                'tax_amount': 'taxAmount',
                'Tax': 'taxAmount',
                'Tax Amount': 'taxAmount',
                'poNumber': 'poNumber',
                'po_number': 'poNumber',
                'PO Number': 'poNumber',
                'Purchase Order': 'poNumber',
                'vendorName': 'vendorName',
                'vendor_name': 'vendorName',
                'Vendor': 'vendorName',
                'Vendor Name': 'vendorName',
                'currency': 'currency',
                'Currency': 'currency',
                'paymentTerms': 'paymentTerms',
                'payment_terms': 'paymentTerms',
                'Payment Terms': 'paymentTerms',
                'Terms': 'paymentTerms',
                'memo': 'memo',
                'Memo': 'memo',
                'Description': 'memo'
            };
            return fieldMap[field] || field;
        }

        /**
         * Build a line item object from AI response data
         * @private
         * @param {Object} aiItem - Line item from AI response
         * @param {Object} originalItem - Original line item (for modifications)
         * @returns {Object} Normalized line item object
         */
        _buildLineItem(aiItem, originalItem = null) {
            const item = originalItem ? { ...originalItem } : {};

            // Core line item fields
            if (aiItem.description !== undefined) {
                item.description = aiItem.description;
                item.memo = aiItem.description; // Also set memo for compatibility
            }
            if (aiItem.quantity !== undefined) {
                item.quantity = aiItem.quantity;
            }
            if (aiItem.unitPrice !== undefined) {
                item.unitPrice = aiItem.unitPrice;
                item.rate = aiItem.unitPrice; // Also set rate for compatibility
            }
            if (aiItem.amount !== undefined) {
                item.amount = aiItem.amount;
            }

            // Sublist-level fields (only if guessing is enabled and values provided)
            if (aiItem.account) {
                item.account = aiItem.account;
            }
            if (aiItem.department) {
                item.department = aiItem.department;
            }
            if (aiItem.class) {
                item.class = aiItem.class;
            }
            if (aiItem.location) {
                item.location = aiItem.location;
            }

            // Metadata
            item.confidence = aiItem.confidence || 0.85;

            return item;
        }
    }

    // ==================== Vendor History Lookup ====================

    /**
     * Get vendor invoice history for anomaly detection
     * @param {number} vendorId - NetSuite vendor internal ID
     * @returns {Object|null} Vendor history summary
     */
    function getVendorHistory(vendorId) {
        if (!vendorId) return null;

        try {
            // Search for recent vendor bills to build history
            const billSearch = search.create({
                type: 'vendorbill',
                filters: [
                    ['entity', 'anyof', vendorId],
                    'AND',
                    ['mainline', 'is', 'T'],
                    'AND',
                    ['trandate', 'within', 'lastrollingyear']
                ],
                columns: [
                    search.createColumn({ name: 'tranid', summary: 'GROUP' }),
                    search.createColumn({ name: 'amount', summary: 'AVG' }),
                    search.createColumn({ name: 'amount', summary: 'MIN' }),
                    search.createColumn({ name: 'amount', summary: 'MAX' }),
                    search.createColumn({ name: 'internalid', summary: 'COUNT' }),
                    search.createColumn({ name: 'trandate', summary: 'MAX' }),
                    search.createColumn({ name: 'terms', summary: 'GROUP' }),
                    search.createColumn({ name: 'entity', summary: 'GROUP' })
                ]
            });

            let history = null;
            billSearch.run().each(function(result) {
                history = {
                    vendorName: result.getText({ name: 'entity', summary: 'GROUP' }),
                    avgAmount: parseFloat(result.getValue({ name: 'amount', summary: 'AVG' })) || 0,
                    minAmount: parseFloat(result.getValue({ name: 'amount', summary: 'MIN' })) || 0,
                    maxAmount: parseFloat(result.getValue({ name: 'amount', summary: 'MAX' })) || 0,
                    invoiceCount: parseInt(result.getValue({ name: 'internalid', summary: 'COUNT' })) || 0,
                    lastInvoiceDate: result.getValue({ name: 'trandate', summary: 'MAX' }),
                    typicalTerms: result.getText({ name: 'terms', summary: 'GROUP' }),
                    invoicePattern: result.getValue({ name: 'tranid', summary: 'GROUP' })
                };
                return false; // Just get first aggregated result
            });

            return history;

        } catch (e) {
            log.debug('getVendorHistory', `Could not get history for vendor ${vendorId}: ${e.message}`);
            return null;
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
            skipFileSizeMB: 25,
            // Line item enhancement options
            enhanceLineItems: false,
            guessAccounts: false,
            guessDepartments: false,
            guessClasses: false,
            guessLocations: false
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
        getVendorHistory: getVendorHistory,
        DEFAULT_MODEL: DEFAULT_MODEL
    };
});
