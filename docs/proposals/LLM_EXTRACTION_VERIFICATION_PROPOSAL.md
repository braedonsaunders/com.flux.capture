# Proposal: LLM-Based Extraction Verification & Enhancement

## Executive Summary

This proposal outlines an optional LLM verification layer that can be added to the Flux Capture extraction pipeline. The LLM would receive the PDF document, OCR-extracted data, and form field schema to:

1. **Verify** extraction accuracy and flag discrepancies
2. **Enhance** extraction by catching missed fields
3. **Validate** logical consistency across fields
4. **Suggest** corrections for low-confidence extractions

This feature would be configurable via Settings, disabled by default.

---

## 1. Current State Analysis

### Existing 7-Stage Pipeline
```
Stage 1: Raw OCR Extraction (OCI/Azure/Mindee)
Stage 2: Layout Analysis (zone detection)
Stage 3: Field Matching (semantic patterns)
Stage 4: Vendor Resolution (fuzzy matching)
Stage 4.5: Vendor Defaults Loading
Stage 4.6: Custom Field Matching
Stage 5: Cross-Field Validation
Stage 6: Anomaly Detection
Stage 7: Confidence Scoring
```

### Current Limitations
- OCR providers are optimized for structured extraction, not semantic understanding
- Pattern-based field matching can miss unusual invoice formats
- No way to "read" the document holistically as a human would
- Low-confidence extractions require manual review with no AI assistance

---

## 2. LLM Provider Analysis

### Option A: NetSuite N/LLM Module
**Status: NOT AVAILABLE**

NetSuite does not currently provide a native `N/llm` module. There is no built-in LLM capability in SuiteScript 2.1.

**Conclusion: External API integration required.**

### Option B: Google Gemini Flash (Recommended)

| Model | Input Cost | Output Cost | Context Window | Speed | Multimodal |
|-------|-----------|-------------|----------------|-------|------------|
| Gemini 2.0 Flash | $0.10/1M tokens | $0.40/1M tokens | 1M tokens | ~2-3s | Yes (PDF native) |
| Gemini 1.5 Flash | $0.075/1M tokens | $0.30/1M tokens | 1M tokens | ~1-2s | Yes (PDF native) |

**Advantages:**
- Native PDF/image understanding (no separate OCR needed)
- Extremely cost-effective ($0.10-0.40/1M tokens)
- Fast inference (1-3 seconds typical)
- Large context window handles multi-page invoices
- Structured JSON output mode

### Option C: Other Providers (For Reference)

| Provider | Model | Cost (Input/Output per 1M) | Speed |
|----------|-------|---------------------------|-------|
| OpenAI | GPT-4o-mini | $0.15 / $0.60 | ~2s |
| OpenAI | GPT-4o | $2.50 / $10.00 | ~3s |
| Anthropic | Claude 3.5 Haiku | $0.80 / $4.00 | ~1s |
| Anthropic | Claude 3.5 Sonnet | $3.00 / $15.00 | ~2s |

**Recommendation: Gemini 2.0 Flash**
- Best price-to-performance ratio
- Native multimodal (PDF + image support)
- Structured output guarantees valid JSON
- Google Cloud integration available

---

## 3. Proposed Architecture

### New Stage: LLM Verification (Stage 7.5)

Insert after confidence scoring, before final result:

```
Stage 7: Confidence Scoring
    ↓
Stage 7.5: LLM Verification (Optional - if enabled in settings)
    ├── Input: PDF file + extracted data + form schema
    ├── Process: Gemini Flash verification
    └── Output: Verified data + corrections + flags
    ↓
Stage 8: Final Result Assembly
```

### Component Design

```
lib/
├── llm/
│   ├── LLMProvider.js           # Base class for LLM providers
│   ├── GeminiProvider.js        # Gemini API implementation
│   ├── LLMVerifier.js           # Verification logic orchestrator
│   └── PromptBuilder.js         # Constructs verification prompts
```

### Data Flow

```
┌─────────────────────────────────────────────────────────────────┐
│                    LLM Verification Stage                        │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  ┌─────────────┐   ┌──────────────┐   ┌─────────────────────┐  │
│  │  PDF File   │   │  Extracted   │   │   Form Schema       │  │
│  │  (base64)   │   │  Data (JSON) │   │   (field defs)      │  │
│  └──────┬──────┘   └──────┬───────┘   └──────────┬──────────┘  │
│         │                 │                       │              │
│         └─────────────────┼───────────────────────┘              │
│                           ▼                                      │
│                 ┌──────────────────┐                             │
│                 │  PromptBuilder   │                             │
│                 │  - Verification  │                             │
│                 │  - Enhancement   │                             │
│                 │  - Validation    │                             │
│                 └────────┬─────────┘                             │
│                          ▼                                       │
│                 ┌──────────────────┐                             │
│                 │  Gemini Flash    │                             │
│                 │  API Call        │                             │
│                 └────────┬─────────┘                             │
│                          ▼                                       │
│                 ┌──────────────────┐                             │
│                 │  LLMVerifier     │                             │
│                 │  - Parse result  │                             │
│                 │  - Apply fixes   │                             │
│                 │  - Add flags     │                             │
│                 └────────┬─────────┘                             │
│                          ▼                                       │
│         ┌────────────────────────────────────┐                   │
│         │  Enhanced Extraction Result        │                   │
│         │  - Verified fields                 │                   │
│         │  - LLM corrections                 │                   │
│         │  - Discrepancy flags               │                   │
│         │  - Additional extracted fields     │                   │
│         └────────────────────────────────────┘                   │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

---

## 4. Implementation Details

### 4.1 Settings Configuration

**New settings in `customrecord_flux_config`:**

```javascript
// Settings schema additions
{
    llmVerification: {
        enabled: false,                    // Master toggle (default OFF)
        provider: 'gemini',                // 'gemini' | future providers
        apiKey: '[encrypted]',             // Gemini API key
        model: 'gemini-2.0-flash',         // Model selection
        triggerConditions: {
            always: false,                 // Run on every document
            lowConfidence: true,           // Run when confidence < threshold
            confidenceThreshold: 0.70,     // Threshold for "low confidence"
            onRequest: true                // Manual trigger from Review UI
        },
        verificationOptions: {
            verifyFields: true,            // Check extracted values
            enhanceExtraction: true,       // Look for missed fields
            validateLogic: true,           // Cross-field validation
            suggestCorrections: true       // Propose fixes
        },
        costControls: {
            maxPagesPerDocument: 10,       // Limit pages sent to LLM
            monthlyBudgetUSD: 50,          // Monthly spending cap
            skipIfFileOver: 10485760       // Skip files > 10MB
        }
    }
}
```

### 4.2 Settings UI Addition

Add to `View.Settings.js`:

```javascript
// New section: LLM Verification
{
    title: 'LLM Verification (Beta)',
    description: 'Use AI to verify and enhance extraction accuracy',
    fields: [
        {
            type: 'toggle',
            id: 'llmVerificationEnabled',
            label: 'Enable LLM Verification',
            default: false
        },
        {
            type: 'select',
            id: 'llmProvider',
            label: 'LLM Provider',
            options: [
                { value: 'gemini', label: 'Google Gemini Flash' }
            ],
            dependsOn: 'llmVerificationEnabled'
        },
        {
            type: 'password',
            id: 'llmApiKey',
            label: 'API Key',
            dependsOn: 'llmVerificationEnabled'
        },
        {
            type: 'select',
            id: 'llmTrigger',
            label: 'When to Verify',
            options: [
                { value: 'low_confidence', label: 'Low confidence only (<70%)' },
                { value: 'always', label: 'Every document' },
                { value: 'manual', label: 'Manual trigger only' }
            ],
            dependsOn: 'llmVerificationEnabled'
        }
    ]
}
```

### 4.3 Gemini Provider Implementation

```javascript
// lib/llm/GeminiProvider.js
/**
 * @NApiVersion 2.1
 * @NModuleScope Public
 */
define(['N/https', 'N/encode', '../FC_Debug'], function(https, encode, fcDebug) {

    const GEMINI_API_BASE = 'https://generativelanguage.googleapis.com/v1beta';

    class GeminiProvider {
        constructor(apiKey, model = 'gemini-2.0-flash') {
            this.apiKey = apiKey;
            this.model = model;
            this.endpoint = `${GEMINI_API_BASE}/models/${model}:generateContent`;
        }

        /**
         * Verify extraction with PDF and extracted data
         * @param {Object} params
         * @param {string} params.pdfBase64 - Base64 encoded PDF
         * @param {Object} params.extractedData - Current extraction result
         * @param {Object} params.formSchema - Available form fields
         * @returns {Object} Verification result
         */
        async verifyExtraction({ pdfBase64, extractedData, formSchema }) {
            const prompt = this._buildVerificationPrompt(extractedData, formSchema);

            const requestBody = {
                contents: [{
                    parts: [
                        {
                            inline_data: {
                                mime_type: 'application/pdf',
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
                    temperature: 0.1,  // Low temperature for accuracy
                    maxOutputTokens: 4096
                }
            };

            const response = https.post({
                url: `${this.endpoint}?key=${this.apiKey}`,
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(requestBody)
            });

            if (response.code !== 200) {
                throw new Error(`Gemini API error: ${response.code}`);
            }

            return this._parseResponse(JSON.parse(response.body));
        }

        _buildVerificationPrompt(extractedData, formSchema) {
            return `You are an expert document analyst verifying invoice/bill extraction accuracy.

TASK: Analyze the attached PDF document and verify the following extracted data.

EXTRACTED DATA (to verify):
${JSON.stringify(extractedData, null, 2)}

AVAILABLE FORM FIELDS:
${JSON.stringify(formSchema.fields?.slice(0, 50), null, 2)}

INSTRUCTIONS:
1. Read the document carefully
2. Compare each extracted field against what you see in the document
3. Identify any errors, missing fields, or discrepancies
4. Suggest corrections where needed

RESPOND WITH THIS EXACT JSON STRUCTURE:
{
    "verification": {
        "overall_accuracy": 0.95,  // 0-1 score
        "fields_verified": 12,
        "fields_with_issues": 2
    },
    "discrepancies": [
        {
            "field": "invoiceNumber",
            "extracted_value": "INV-123",
            "correct_value": "INV-1234",
            "confidence": 0.98,
            "reason": "OCR missed last digit"
        }
    ],
    "missed_fields": [
        {
            "field": "purchaseOrderNumber",
            "value": "PO-5678",
            "confidence": 0.95,
            "location": "Header, top right"
        }
    ],
    "validation_flags": [
        {
            "type": "amount_mismatch",
            "message": "Line items sum to $1,234.56 but total shows $1,243.56",
            "severity": "high"
        }
    ],
    "enhanced_line_items": null  // Only if line items need correction
}`;
        }

        _parseResponse(apiResponse) {
            try {
                const content = apiResponse.candidates[0].content.parts[0].text;
                return JSON.parse(content);
            } catch (e) {
                return { error: 'Failed to parse LLM response', raw: apiResponse };
            }
        }
    }

    return { GeminiProvider };
});
```

### 4.4 LLM Verifier Orchestrator

```javascript
// lib/llm/LLMVerifier.js
/**
 * @NApiVersion 2.1
 * @NModuleScope Public
 */
define([
    'N/file',
    'N/encode',
    './GeminiProvider',
    '../FC_Debug'
], function(file, encode, GeminiProviderModule, fcDebug) {

    class LLMVerifier {
        constructor(config) {
            this.config = config;
            this.provider = new GeminiProviderModule.GeminiProvider(
                config.apiKey,
                config.model || 'gemini-2.0-flash'
            );
        }

        /**
         * Determine if LLM verification should run
         */
        shouldVerify(extractionResult, options = {}) {
            const triggers = this.config.triggerConditions;

            // Manual request always runs
            if (options.forceVerification) return true;

            // Check if enabled
            if (!this.config.enabled) return false;

            // Always mode
            if (triggers.always) return true;

            // Low confidence mode
            if (triggers.lowConfidence) {
                const confidence = extractionResult.confidence?.overall || 0;
                return confidence < triggers.confidenceThreshold;
            }

            return false;
        }

        /**
         * Run LLM verification on extraction result
         */
        async verify(fileId, extractionResult, formSchema) {
            const startTime = Date.now();

            try {
                // Load and encode PDF
                const fileObj = file.load({ id: fileId });
                const pdfBase64 = encode.convert({
                    string: fileObj.getContents(),
                    inputEncoding: encode.Encoding.UTF_8,
                    outputEncoding: encode.Encoding.BASE_64
                });

                // Check file size limits
                if (pdfBase64.length > this.config.costControls?.skipIfFileOver) {
                    return { skipped: true, reason: 'File too large' };
                }

                // Call LLM
                const llmResult = await this.provider.verifyExtraction({
                    pdfBase64,
                    extractedData: this._prepareExtractionData(extractionResult),
                    formSchema
                });

                // Apply corrections if configured
                const enhancedResult = this._applyVerificationResult(
                    extractionResult,
                    llmResult
                );

                return {
                    success: true,
                    duration: Date.now() - startTime,
                    verification: llmResult.verification,
                    discrepancies: llmResult.discrepancies,
                    missedFields: llmResult.missed_fields,
                    validationFlags: llmResult.validation_flags,
                    enhancedResult
                };

            } catch (error) {
                fcDebug.error('LLMVerifier', 'Verification failed', error);
                return { success: false, error: error.message };
            }
        }

        _prepareExtractionData(result) {
            // Send only relevant fields to minimize tokens
            return {
                vendorName: result.vendorName,
                invoiceNumber: result.invoiceNumber,
                invoiceDate: result.invoiceDate,
                dueDate: result.dueDate,
                totalAmount: result.totalAmount,
                subtotal: result.subtotal,
                taxAmount: result.taxAmount,
                currency: result.currency,
                lineItems: result.lineItems?.slice(0, 20), // Limit line items
                customFields: result.customFields
            };
        }

        _applyVerificationResult(original, llmResult) {
            const enhanced = { ...original };

            // Apply corrections from discrepancies
            if (llmResult.discrepancies) {
                enhanced.llmCorrections = llmResult.discrepancies.map(d => ({
                    field: d.field,
                    originalValue: d.extracted_value,
                    correctedValue: d.correct_value,
                    confidence: d.confidence,
                    source: 'llm_verification'
                }));
            }

            // Add missed fields
            if (llmResult.missed_fields) {
                enhanced.llmAdditions = llmResult.missed_fields;
            }

            // Add validation flags
            if (llmResult.validation_flags) {
                enhanced.llmValidationFlags = llmResult.validation_flags;
            }

            // Update confidence with LLM verification score
            if (llmResult.verification?.overall_accuracy) {
                enhanced.confidence = {
                    ...enhanced.confidence,
                    llmVerified: true,
                    llmAccuracy: llmResult.verification.overall_accuracy
                };
            }

            return enhanced;
        }
    }

    return { LLMVerifier };
});
```

### 4.5 Integration into FC_Engine.js

Add to `processDocument()` after Stage 7:

```javascript
// Stage 7.5: LLM Verification (if enabled)
if (this.llmVerifier?.shouldVerify(result, options)) {
    log.audit('FluxCapture', 'Running LLM verification...');

    const llmResult = this.llmVerifier.verify(
        fileId,
        result,
        this._getFormSchema(options.transactionType)
    );

    if (llmResult.success) {
        result = llmResult.enhancedResult;
        result.llmVerification = {
            ran: true,
            duration: llmResult.duration,
            accuracy: llmResult.verification?.overall_accuracy,
            discrepancyCount: llmResult.discrepancies?.length || 0,
            additionsCount: llmResult.missedFields?.length || 0
        };
    }
}
```

---

## 5. Efficiency Optimizations

### 5.1 Conditional Execution
- **Default OFF**: Only runs when explicitly enabled
- **Confidence-based**: Only triggers for low-confidence extractions (<70%)
- **Manual trigger**: Button in Review UI for on-demand verification

### 5.2 Token Optimization
| Optimization | Savings |
|--------------|---------|
| Send only relevant extracted fields | ~40% token reduction |
| Limit line items to 20 | ~30% for large invoices |
| Structured JSON output | Consistent parsing, no retries |
| Low temperature (0.1) | Single pass, no regeneration |

### 5.3 File Size Limits
- Skip files > 10MB by default
- Configurable page limit (default 10 pages)
- First page priority for multi-page documents

### 5.4 Caching (Future Enhancement)
- Cache verification results by document hash
- Skip re-verification for identical documents
- Vendor-specific pattern caching

---

## 6. Cost Analysis

### Estimated Token Usage per Document

| Component | Tokens (Est.) |
|-----------|--------------|
| PDF content (3 pages avg) | ~3,000 |
| Extraction data JSON | ~500 |
| Form schema subset | ~300 |
| System prompt | ~400 |
| Response | ~800 |
| **Total per document** | **~5,000** |

### Monthly Cost Projections (Gemini 2.0 Flash)

| Documents/Month | Token Usage | Cost (USD) |
|-----------------|-------------|------------|
| 100 | 500K | $0.25 |
| 500 | 2.5M | $1.25 |
| 1,000 | 5M | $2.50 |
| 5,000 | 25M | $12.50 |
| 10,000 | 50M | $25.00 |

**Key Insight**: At $0.25-$25/month for 100-10,000 documents, this is extremely cost-effective.

---

## 7. UI/UX Considerations

### 7.1 Review Screen Enhancements

```
┌─────────────────────────────────────────────────────────────────┐
│  Invoice Review                                      [Approve]  │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │  🤖 LLM Verification Results                              │   │
│  │  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ │   │
│  │                                                           │   │
│  │  Accuracy: 94%  │  Verified: 12 fields  │  Issues: 2     │   │
│  │                                                           │   │
│  │  ⚠️ Corrections Suggested:                                │   │
│  │  ┌─────────────────────────────────────────────────────┐  │   │
│  │  │ Invoice Number: "INV-123" → "INV-1234" (98% conf)   │  │   │
│  │  │ [Accept] [Ignore]                                   │  │   │
│  │  └─────────────────────────────────────────────────────┘  │   │
│  │                                                           │   │
│  │  ➕ Additional Fields Found:                              │   │
│  │  ┌─────────────────────────────────────────────────────┐  │   │
│  │  │ PO Number: "PO-5678" (95% confidence)               │  │   │
│  │  │ [Add to Form] [Ignore]                              │  │   │
│  │  └─────────────────────────────────────────────────────┘  │   │
│  │                                                           │   │
│  └──────────────────────────────────────────────────────────┘   │
│                                                                  │
│  [🔄 Re-run LLM Verification]                                   │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

### 7.2 Dashboard Indicators

- Badge showing "LLM Verified" on verified documents
- Separate queue filter for "LLM corrections available"
- Analytics: LLM accuracy improvement metrics

---

## 8. Implementation Phases

### Phase 1: Foundation (Week 1-2)
- [ ] Create LLM provider abstraction layer
- [ ] Implement Gemini Flash provider
- [ ] Add settings configuration for LLM
- [ ] Encrypt and store API key securely

### Phase 2: Core Integration (Week 2-3)
- [ ] Build LLMVerifier orchestrator
- [ ] Integrate into FC_Engine pipeline
- [ ] Implement prompt builder with structured output
- [ ] Add conditional execution logic

### Phase 3: UI Integration (Week 3-4)
- [ ] Add LLM settings section to Settings view
- [ ] Create verification results panel in Review view
- [ ] Add "Accept/Ignore" correction workflow
- [ ] Implement manual verification trigger button

### Phase 4: Optimization & Polish (Week 4-5)
- [ ] Implement token optimization strategies
- [ ] Add cost tracking and budget controls
- [ ] Build analytics for LLM improvement metrics
- [ ] Documentation and testing

---

## 9. Risks & Mitigations

| Risk | Impact | Mitigation |
|------|--------|------------|
| API rate limits | Processing delays | Implement queue with backoff |
| API cost overruns | Budget impact | Hard monthly cap, alerts at 80% |
| LLM hallucinations | False corrections | Require human confirmation for changes |
| API downtime | Feature unavailable | Graceful fallback to OCR-only |
| Sensitive data exposure | Privacy/security | Review Gemini data handling policies |
| Latency increase | UX impact | Async processing, don't block UI |

---

## 10. Future Enhancements

1. **Multi-provider support**: Add OpenAI, Anthropic as alternatives
2. **Fine-tuned models**: Train on customer's document patterns
3. **Batch verification**: Process multiple documents efficiently
4. **Learning loop**: Feed LLM corrections back into pattern matching
5. **Confidence calibration**: Adjust OCR confidence based on LLM feedback

---

## 11. Recommendation

**Proceed with Gemini 2.0 Flash implementation** because:

1. **No native N/LLM exists** - External API is the only option
2. **Gemini is most cost-effective** - ~$0.10/1M tokens input
3. **Native PDF support** - No additional preprocessing needed
4. **Structured output mode** - Guaranteed valid JSON responses
5. **Fast inference** - 2-3 second typical response time
6. **Low risk** - Optional feature, disabled by default

The estimated implementation effort is **4-5 weeks** with a monthly operational cost of **$1-25** depending on volume.

---

## Appendix A: API Key Management

The Gemini API key should be stored using the existing encrypted configuration pattern:

```javascript
// Use existing ProviderFactory encryption
const encryptedKey = providerFactory._encryptApiKey(apiKey);

// Store in customrecord_flux_config
record.create({
    type: 'customrecord_flux_config',
    values: {
        custrecord_flux_config_type: 'llm_settings',
        custrecord_flux_config_value: JSON.stringify({
            provider: 'gemini',
            apiKey: encryptedKey,
            model: 'gemini-2.0-flash',
            enabled: true
        })
    }
});
```

---

## Appendix B: Sample Verification Prompt (Full)

See `lib/llm/prompts/verification_prompt.txt` for the complete prompt template with all edge cases handled.

---

*Document Version: 1.0*
*Created: 2024*
*Author: Claude (AI Assistant)*
