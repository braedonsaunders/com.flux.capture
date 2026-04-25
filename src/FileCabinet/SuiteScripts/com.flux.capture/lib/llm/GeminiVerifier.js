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

                // v4.2: Load available options for field guessing if any guessing is enabled
                let availableOptions = null;
                if (lineItemOptions.guessAccounts || lineItemOptions.guessDepartments ||
                    lineItemOptions.guessClasses || lineItemOptions.guessLocations) {
                    availableOptions = this._loadAvailableOptions(lineItemOptions);
                    // Store on instance for use in applyVerification
                    this._availableOptions = availableOptions;
                }

                // Build verification prompt with vendor history context, existing alerts, and available options
                const prompt = this._buildVerificationPrompt(extractionResult, formSchema, vendorHistory, existingAnomalies, lineItemOptions, availableOptions);

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
         * v4.2: Added availableOptions parameter for field guessing
         * @private
         */
        _buildVerificationPrompt(extractionResult, formSchema, vendorHistory = null, existingAlerts = [], lineItemOptions = {}, availableOptions = null) {
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
${this._buildLineItemEnhancementSection(lineItemOptions, vendorHistory, availableOptions)}
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
         * v4.2: Include _originalIndex for each line item so AI can reference them correctly
         * v4.2: Increased limit from 20 to 50 items, and track if truncated
         * @private
         */
        _prepareExtractionSummary(result) {
            const extraction = result.extraction || result;
            const fields = extraction.fields || {};
            const allLineItems = extraction.lineItems || [];
            const MAX_LINE_ITEMS = 50; // v4.2: Increased from 20

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
                // v4.2: Include _originalIndex so AI knows which item to reference
                lineItems: allLineItems.slice(0, MAX_LINE_ITEMS).map((item, index) => ({
                    _originalIndex: index, // v4.2: Critical for proper item tracking
                    description: item.description || item.memo,
                    quantity: item.quantity,
                    unitPrice: item.unitPrice || item.rate,
                    amount: item.amount
                })),
                // v4.2: Track total count so AI knows if there are more items
                lineItemsTotal: allLineItems.length,
                lineItemsTruncated: allLineItems.length > MAX_LINE_ITEMS,
                confidence: extraction.confidence?.overall || null
            };
        }

        /**
         * Build line item enhancement section for the prompt
         * v4.2: Now includes available options for accounts, departments, etc.
         * @private
         */
        _buildLineItemEnhancementSection(lineItemOptions, vendorHistory, availableOptions = null) {
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

CRITICAL REQUIREMENTS - READ CAREFULLY:
1. Each extracted line item has an "_originalIndex" field - this is its position in our system
2. When you return line items, you MUST include "_originalIndex" to reference existing items
3. For KEEP actions: copy the "_originalIndex" from the extracted data exactly
4. For MODIFY actions: copy the "_originalIndex" from the item you are modifying
5. For DELETE actions: copy the "_originalIndex" from the item you are deleting
6. For ADD actions: do NOT include "_originalIndex" (these are new items)
7. Mark each line item with _action: "keep", "add", "modify", or "delete"
8. Extract ALL line items visible in the PDF - be thorough
9. Include description/memo, quantity, unit price, and amount for each line
10. If the extracted data shows "lineItemsTruncated: true", there are more items not shown

IMPORTANT: Every existing line item you want to KEEP or MODIFY must have the correct _originalIndex.
If you omit an item from your response, it may be lost. Return ALL items with appropriate actions.

`;

            if (guessingFields.length > 0) {
                section += `
FIELD GUESSING (ENABLED for: ${guessingFields.join(', ')}):
You MUST select values from the AVAILABLE OPTIONS listed below. Do NOT make up values.
Return the exact ID or name from the available options.

`;
                // v4.2: Include available options in the prompt
                if (lineItemOptions.guessAccounts && availableOptions?.accounts?.length > 0) {
                    section += `AVAILABLE ACCOUNTS (use ID or exact name):
`;
                    // Show top 30 accounts to avoid prompt overload
                    const accountsToShow = availableOptions.accounts.slice(0, 30);
                    accountsToShow.forEach(acc => {
                        section += `  - ID: ${acc.id}, Name: "${acc.name}"${acc.number ? `, Number: ${acc.number}` : ''}
`;
                    });
                    if (availableOptions.accounts.length > 30) {
                        section += `  ... and ${availableOptions.accounts.length - 30} more accounts
`;
                    }
                    section += `
`;
                }

                if (lineItemOptions.guessDepartments && availableOptions?.departments?.length > 0) {
                    section += `AVAILABLE DEPARTMENTS (use ID or exact name):
`;
                    availableOptions.departments.forEach(dept => {
                        section += `  - ID: ${dept.id}, Name: "${dept.name}"
`;
                    });
                    section += `
`;
                }

                if (lineItemOptions.guessClasses && availableOptions?.classes?.length > 0) {
                    section += `AVAILABLE CLASSES (use ID or exact name):
`;
                    availableOptions.classes.forEach(cls => {
                        section += `  - ID: ${cls.id}, Name: "${cls.name}"
`;
                    });
                    section += `
`;
                }

                if (lineItemOptions.guessLocations && availableOptions?.locations?.length > 0) {
                    section += `AVAILABLE LOCATIONS (use ID or exact name):
`;
                    availableOptions.locations.forEach(loc => {
                        section += `  - ID: ${loc.id}, Name: "${loc.name}"
`;
                    });
                    section += `
`;
                }

                section += `GUESSING INSTRUCTIONS:
- For "account": Select the MOST appropriate expense account based on the line item description
- For "department": Select the department if context clues indicate which department should be charged
- For "class": Select a class if the invoice context suggests one
- For "location": Select a location if mentioned or implied in the document
- Return the ID (preferred) or exact name from the lists above
- ONLY suggest if confidence >= 0.7
- Leave as null if you cannot confidently match to an available option

`;

                if (vendorHistory) {
                    section += `VENDOR HISTORY (this vendor typically uses):
${vendorHistory.typicalAccount ? `- Common account: ${vendorHistory.typicalAccount}` : ''}
${vendorHistory.typicalDepartment ? `- Common department: ${vendorHistory.typicalDepartment}` : ''}
${vendorHistory.typicalClass ? `- Common class: ${vendorHistory.typicalClass}` : ''}
${vendorHistory.typicalLocation ? `- Common location: ${vendorHistory.typicalLocation}` : ''}

`;
                }
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
                kept: [],
                preserved: [] // v4.2: Track items preserved from original (not mentioned by AI)
            };
            const aiLineItems = verificationResult.lineItems || verificationResult.rawResponse?.lineItems || null;

            if (this.enhanceLineItems && aiLineItems && Array.isArray(aiLineItems)) {
                const originalLineItems = extraction.lineItems || [];
                const enhancedLineItems = [];

                // v4.2 FIX: Track which original items have been processed by AI
                // This prevents losing items that AI didn't mention
                const processedOriginalIndices = new Set();
                const deletedOriginalIndices = new Set();

                // v4.2 FIX: Log counts for debugging
                log.audit('GeminiVerifier', `Line item enhancement starting: ${originalLineItems.length} original items, ${aiLineItems.length} AI items`);

                // v4.2 FIX: Validate AI returned proper data structure
                const validAiItems = aiLineItems.filter(item =>
                    item && typeof item === 'object' &&
                    (item._action || item.description || item.amount !== undefined)
                );

                if (validAiItems.length !== aiLineItems.length) {
                    log.audit('GeminiVerifier', `Filtered ${aiLineItems.length - validAiItems.length} malformed AI line items`);
                }

                // v4.2 FIX: Validate and map AI-returned account/department values to NetSuite IDs
                const availableOptions = this._availableOptions || null;
                const validatedAiItems = validAiItems.map(item => {
                    if (availableOptions) {
                        return this._validateAndMapLineItemFields(item, availableOptions);
                    }
                    return item;
                });

                // v4.2 FIX: Safety check - if AI returns empty/invalid array, preserve original items
                if (validatedAiItems.length === 0 && originalLineItems.length > 0) {
                    log.audit('GeminiVerifier', `AI returned no valid line items - preserving ${originalLineItems.length} original items`);
                    // Don't process - keep original line items as-is
                } else {
                    // Use validatedAiItems (validated and mapped to NetSuite IDs) for processing
                    for (const aiItem of validatedAiItems) {
                        const action = aiItem._action || 'keep';
                        const confidence = aiItem.confidence || 0;

                        if (action === 'delete') {
                            // Track deletion (don't add to enhanced list)
                            if (aiItem._originalIndex !== null && aiItem._originalIndex !== undefined) {
                                const deletedItem = originalLineItems[aiItem._originalIndex];
                                if (deletedItem) {
                                    // v4.2: Only delete if confidence is high enough
                                    if (confidence >= this.autoApplyThreshold) {
                                        deletedOriginalIndices.add(aiItem._originalIndex);
                                        processedOriginalIndices.add(aiItem._originalIndex);
                                        lineItemChanges.deleted.push({
                                            originalIndex: aiItem._originalIndex,
                                            description: deletedItem.description || deletedItem.memo,
                                            amount: deletedItem.amount,
                                            reason: aiItem._reason || 'AI detected this line item does not exist in document'
                                        });
                                        log.audit('GeminiVerifier', `Deleted line item at index ${aiItem._originalIndex}: ${aiItem._reason || 'not in document'}`);
                                    } else {
                                        // Low confidence delete - keep the original item
                                        enhancedLineItems.push({ ...deletedItem });
                                        processedOriginalIndices.add(aiItem._originalIndex);
                                        log.audit('GeminiVerifier', `Kept line item at index ${aiItem._originalIndex} (delete confidence ${confidence} below threshold)`);
                                    }
                                }
                            }

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
                            if (originalIndex !== null && originalIndex !== undefined) {
                                processedOriginalIndices.add(originalIndex);
                            }
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
                                // v4.2: Also set display values for UI rendering
                                if (this.guessAccounts && aiItem.account && confidence >= 0.7) {
                                    keptItem.account = aiItem.account;
                                    if (aiItem.account_display) {
                                        keptItem.account_display = aiItem.account_display;
                                    }
                                    keptItem._accountSuggested = true;
                                }
                                if (this.guessDepartments && aiItem.department && confidence >= 0.7) {
                                    keptItem.department = aiItem.department;
                                    if (aiItem.department_display) {
                                        keptItem.department_display = aiItem.department_display;
                                    }
                                    keptItem._departmentSuggested = true;
                                }
                                if (this.guessClasses && aiItem.class && confidence >= 0.7) {
                                    keptItem.class = aiItem.class;
                                    if (aiItem.class_display) {
                                        keptItem.class_display = aiItem.class_display;
                                    }
                                    keptItem._classSuggested = true;
                                }
                                if (this.guessLocations && aiItem.location && confidence >= 0.7) {
                                    keptItem.location = aiItem.location;
                                    if (aiItem.location_display) {
                                        keptItem.location_display = aiItem.location_display;
                                    }
                                    keptItem._locationSuggested = true;
                                }
                                enhancedLineItems.push(keptItem);
                                processedOriginalIndices.add(originalIndex);
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
                            } else {
                                // v4.2 FIX: AI said "keep" but didn't provide valid _originalIndex
                                // This likely means AI is describing an item it found - treat as potential add
                                if (aiItem.description || aiItem.amount !== null) {
                                    const newItem = this._buildLineItem(aiItem);
                                    newItem._source = 'ai_keep_no_index';
                                    // Only add if it has meaningful content
                                    if ((newItem.description && newItem.description.length > 0) || newItem.amount > 0) {
                                        enhancedLineItems.push(newItem);
                                        log.audit('GeminiVerifier', `Added item from "keep" action without index: ${newItem.description || newItem.memo}`);
                                    }
                                }
                            }
                        } else {
                            // Low confidence add/modify - keep original if exists, otherwise try to use AI data
                            const originalIndex = aiItem._originalIndex;
                            if (originalIndex !== null && originalIndex !== undefined && originalLineItems[originalIndex]) {
                                enhancedLineItems.push({ ...originalLineItems[originalIndex] });
                                processedOriginalIndices.add(originalIndex);
                            } else if (action === 'add' && aiItem.description) {
                                // v4.2 FIX: Low confidence add - still include but mark for review
                                const newItem = this._buildLineItem(aiItem);
                                newItem._source = 'ai_low_confidence';
                                newItem._needsReview = true;
                                enhancedLineItems.push(newItem);
                                log.audit('GeminiVerifier', `Added low-confidence item for review: ${newItem.description || newItem.memo}`);
                            }
                        }
                    }

                    // v4.2 FIX: CRITICAL - Preserve any original items that AI didn't mention
                    // This prevents losing line items when AI returns incomplete data
                    for (let i = 0; i < originalLineItems.length; i++) {
                        if (!processedOriginalIndices.has(i) && !deletedOriginalIndices.has(i)) {
                            const preservedItem = { ...originalLineItems[i] };
                            preservedItem._preserved = true; // Mark as preserved from original
                            enhancedLineItems.push(preservedItem);
                            lineItemChanges.preserved.push({
                                originalIndex: i,
                                description: preservedItem.description || preservedItem.memo,
                                amount: preservedItem.amount,
                                reason: 'AI did not mention this item - preserved from original extraction'
                            });
                            log.audit('GeminiVerifier', `Preserved unmentioned item at index ${i}: ${preservedItem.description || preservedItem.memo}`);
                        }
                    }

                    // v4.2 FIX: Final safety check - only replace if we have at least as many items
                    // or if deletions explain the difference
                    const expectedMinItems = originalLineItems.length - deletedOriginalIndices.size;
                    if (enhancedLineItems.length >= expectedMinItems || enhancedLineItems.length >= originalLineItems.length) {
                        extraction.lineItems = enhancedLineItems;
                        log.audit('GeminiVerifier', `Line items enhanced: ${lineItemChanges.added.length} added, ${lineItemChanges.modified.length} modified, ${lineItemChanges.deleted.length} deleted, ${lineItemChanges.preserved.length} preserved`);
                    } else {
                        // Something went wrong - AI lost items. Keep original to be safe.
                        log.audit('GeminiVerifier', `Safety check failed: enhanced has ${enhancedLineItems.length} items, expected at least ${expectedMinItems}. Keeping original ${originalLineItems.length} items.`);
                        lineItemChanges.added = [];
                        lineItemChanges.modified = [];
                        lineItemChanges.deleted = [];
                        lineItemChanges.kept = [];
                        lineItemChanges.preserved = [];
                        // Don't modify extraction.lineItems - keep original
                    }
                }
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
         * v4.2: Load available options for accounts, departments, classes, locations
         * This provides the LLM with valid NetSuite values to choose from
         * @private
         * @param {Object} lineItemOptions - Which fields are enabled for guessing
         * @returns {Object} Available options for each field type
         */
        _loadAvailableOptions(lineItemOptions) {
            const options = {
                accounts: [],
                departments: [],
                classes: [],
                locations: []
            };

            try {
                // Only load what we need based on enabled guessing
                if (lineItemOptions.guessAccounts) {
                    // Get expense accounts (most common for AP)
                    const accountSearch = search.create({
                        type: search.Type.ACCOUNT,
                        filters: [
                            ['isinactive', 'is', 'F'],
                            'AND',
                            ['type', 'anyof', ['Expense', 'OthExpense', 'COGS']]
                        ],
                        columns: [
                            search.createColumn({ name: 'internalid' }),
                            search.createColumn({ name: 'number' }),
                            search.createColumn({ name: 'name', sort: search.Sort.ASC })
                        ]
                    });

                    accountSearch.run().each(function(result) {
                        const number = result.getValue('number') || '';
                        const name = result.getValue('name') || '';
                        options.accounts.push({
                            id: result.getValue('internalid'),
                            number: number,
                            name: name,
                            display: number ? `${number} - ${name}` : name
                        });
                        return options.accounts.length < 100; // Limit to 100
                    });
                }

                if (lineItemOptions.guessDepartments) {
                    const deptSearch = search.create({
                        type: search.Type.DEPARTMENT,
                        filters: [['isinactive', 'is', 'F']],
                        columns: [
                            search.createColumn({ name: 'internalid' }),
                            search.createColumn({ name: 'name', sort: search.Sort.ASC })
                        ]
                    });

                    deptSearch.run().each(function(result) {
                        options.departments.push({
                            id: result.getValue('internalid'),
                            name: result.getValue('name')
                        });
                        return options.departments.length < 50;
                    });
                }

                if (lineItemOptions.guessClasses) {
                    const classSearch = search.create({
                        type: search.Type.CLASSIFICATION,
                        filters: [['isinactive', 'is', 'F']],
                        columns: [
                            search.createColumn({ name: 'internalid' }),
                            search.createColumn({ name: 'name', sort: search.Sort.ASC })
                        ]
                    });

                    classSearch.run().each(function(result) {
                        options.classes.push({
                            id: result.getValue('internalid'),
                            name: result.getValue('name')
                        });
                        return options.classes.length < 50;
                    });
                }

                if (lineItemOptions.guessLocations) {
                    const locSearch = search.create({
                        type: search.Type.LOCATION,
                        filters: [['isinactive', 'is', 'F']],
                        columns: [
                            search.createColumn({ name: 'internalid' }),
                            search.createColumn({ name: 'name', sort: search.Sort.ASC })
                        ]
                    });

                    locSearch.run().each(function(result) {
                        options.locations.push({
                            id: result.getValue('internalid'),
                            name: result.getValue('name')
                        });
                        return options.locations.length < 50;
                    });
                }

                log.audit('GeminiVerifier._loadAvailableOptions',
                    `Loaded: ${options.accounts.length} accounts, ${options.departments.length} departments, ${options.classes.length} classes, ${options.locations.length} locations`);

            } catch (e) {
                log.error('GeminiVerifier._loadAvailableOptions', e.message);
            }

            return options;
        }

        /**
         * v4.2: Validate and map AI-returned account/department values to NetSuite IDs
         * @private
         * @param {Object} aiItem - Line item from AI response
         * @param {Object} availableOptions - Available options from _loadAvailableOptions
         * @returns {Object} AI item with validated/mapped IDs
         */
        _validateAndMapLineItemFields(aiItem, availableOptions) {
            if (!aiItem || !availableOptions) return aiItem;

            const validated = { ...aiItem };

            // Validate account
            if (aiItem.account && availableOptions.accounts.length > 0) {
                const matchedAccount = this._findMatchingOption(
                    aiItem.account,
                    availableOptions.accounts,
                    ['id', 'number', 'name', 'display']
                );
                if (matchedAccount) {
                    validated.account = matchedAccount.id;
                    // v4.2 FIX: Set display value for UI rendering
                    validated.account_display = matchedAccount.display || matchedAccount.name;
                    validated._accountName = matchedAccount.name;
                    validated._accountValidated = true;
                } else {
                    // AI returned invalid account - clear it
                    log.audit('GeminiVerifier', `Invalid account "${aiItem.account}" - no match found`);
                    validated.account = null;
                    validated._accountInvalid = aiItem.account;
                }
            }

            // Validate department
            if (aiItem.department && availableOptions.departments.length > 0) {
                const matchedDept = this._findMatchingOption(
                    aiItem.department,
                    availableOptions.departments,
                    ['id', 'name']
                );
                if (matchedDept) {
                    validated.department = matchedDept.id;
                    // v4.2 FIX: Set display value for UI rendering
                    validated.department_display = matchedDept.name;
                    validated._departmentName = matchedDept.name;
                    validated._departmentValidated = true;
                } else {
                    log.audit('GeminiVerifier', `Invalid department "${aiItem.department}" - no match found`);
                    validated.department = null;
                    validated._departmentInvalid = aiItem.department;
                }
            }

            // Validate class
            if (aiItem.class && availableOptions.classes.length > 0) {
                const matchedClass = this._findMatchingOption(
                    aiItem.class,
                    availableOptions.classes,
                    ['id', 'name']
                );
                if (matchedClass) {
                    validated.class = matchedClass.id;
                    // v4.2 FIX: Set display value for UI rendering
                    validated.class_display = matchedClass.name;
                    validated._className = matchedClass.name;
                    validated._classValidated = true;
                } else {
                    log.audit('GeminiVerifier', `Invalid class "${aiItem.class}" - no match found`);
                    validated.class = null;
                    validated._classInvalid = aiItem.class;
                }
            }

            // Validate location
            if (aiItem.location && availableOptions.locations.length > 0) {
                const matchedLoc = this._findMatchingOption(
                    aiItem.location,
                    availableOptions.locations,
                    ['id', 'name']
                );
                if (matchedLoc) {
                    validated.location = matchedLoc.id;
                    // v4.2 FIX: Set display value for UI rendering
                    validated.location_display = matchedLoc.name;
                    validated._locationName = matchedLoc.name;
                    validated._locationValidated = true;
                } else {
                    log.audit('GeminiVerifier', `Invalid location "${aiItem.location}" - no match found`);
                    validated.location = null;
                    validated._locationInvalid = aiItem.location;
                }
            }

            return validated;
        }

        /**
         * v4.2: Find matching option by ID, name, or fuzzy match
         * @private
         */
        _findMatchingOption(value, options, fields) {
            if (!value || !options || options.length === 0) return null;

            const searchVal = String(value).toLowerCase().trim();

            // First: exact match on any field
            for (const opt of options) {
                for (const field of fields) {
                    if (opt[field] && String(opt[field]).toLowerCase() === searchVal) {
                        return opt;
                    }
                }
            }

            // Second: ID match (if value looks like a number)
            if (/^\d+$/.test(searchVal)) {
                for (const opt of options) {
                    if (String(opt.id) === searchVal) {
                        return opt;
                    }
                }
            }

            // Third: partial match on name (contains)
            for (const opt of options) {
                const optName = (opt.name || '').toLowerCase();
                if (optName.includes(searchVal) || searchVal.includes(optName)) {
                    return opt;
                }
            }

            // Fourth: fuzzy match - check if words overlap significantly
            const searchWords = searchVal.split(/\s+/).filter(w => w.length > 2);
            for (const opt of options) {
                const optName = (opt.name || '').toLowerCase();
                const optWords = optName.split(/\s+/).filter(w => w.length > 2);
                const matchCount = searchWords.filter(sw =>
                    optWords.some(ow => ow.includes(sw) || sw.includes(ow))
                ).length;
                if (matchCount >= Math.min(2, searchWords.length) && matchCount > 0) {
                    return opt;
                }
            }

            return null;
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
            // v4.2: Also copy display values for UI rendering
            if (aiItem.account) {
                item.account = aiItem.account;
                if (aiItem.account_display) {
                    item.account_display = aiItem.account_display;
                }
            }
            if (aiItem.department) {
                item.department = aiItem.department;
                if (aiItem.department_display) {
                    item.department_display = aiItem.department_display;
                }
            }
            if (aiItem.class) {
                item.class = aiItem.class;
                if (aiItem.class_display) {
                    item.class_display = aiItem.class_display;
                }
            }
            if (aiItem.location) {
                item.location = aiItem.location;
                if (aiItem.location_display) {
                    item.location_display = aiItem.location_display;
                }
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
            log.error('GeminiVerifier.encryptValue', `Crypto failed: ${e.message}`);
            throw new Error('Could not encrypt Gemini API key. Configure the NetSuite secret "' + ENCRYPTION_KEY_ID + '" before saving AI credentials.');
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
