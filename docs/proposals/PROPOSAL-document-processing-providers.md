# Proposal: AWS Textract & Mindee Document Processing Support

**Author:** Claude
**Date:** 2025-12-19
**Status:** Draft
**Version:** 1.0

---

## Executive Summary

This proposal outlines the addition of two new document processing providers to Flux Capture:
1. **AWS Textract** - Amazon's machine learning document analysis service
2. **Mindee** - Modern document parsing API with strong invoice support

The existing architecture has a well-designed provider abstraction layer, making this integration straightforward. Both providers will slot into the existing `ExtractionProvider` pattern alongside the current OCI and Azure Form Recognizer implementations.

**Total Estimated Effort:** 3-5 days (per provider)

---

## Current Architecture

### Provider Abstraction Pattern

The system uses a factory pattern with a base `ExtractionProvider` class:

```
ExtractionProvider (base class)
    ├── OCIProvider (NetSuite native)
    ├── AzureFormRecognizerProvider
    ├── AwsTextractProvider (proposed)
    └── MindeeProvider (proposed)
```

### Key Integration Points

| File | Purpose |
|------|---------|
| `lib/providers/ExtractionProvider.js` | Base class with normalized result contract |
| `lib/providers/ProviderFactory.js` | Provider instantiation & configuration |
| `lib/FC_Engine.js` | Processing orchestration |
| `suitelet/FC_Router.js` | API endpoints for config |
| `client/views/View.Settings.js` | Configuration UI |

### Normalized Result Format (Required Contract)

All providers must return this structure:

```javascript
{
    pages: [],              // Raw page objects
    rawFields: [{
        page: 0,
        label: 'Invoice Number',
        labelConfidence: 0.95,
        value: 'INV-2024-001',
        valueConfidence: 0.92,
        position: { x, y, width, height },
        _rawLabel: ...,     // Provider-specific
        _rawValue: ...,
        _rawType: ...
    }],
    rawTables: [{
        page: 0,
        index: 0,
        headerRows: [],
        bodyRows: [],
        footerRows: [],
        confidence: 0.8
    }],
    rawText: '',
    pageCount: 0,
    mimeType: null
}
```

---

## Proposed Implementation: AWS Textract

### Overview

AWS Textract provides machine learning-based document analysis with support for:
- Form field extraction (key-value pairs)
- Table extraction
- Raw text extraction
- Specialized invoice/expense analysis

### API Integration Approach

**Option A: Synchronous API (Recommended for < 5 pages)**
- `AnalyzeDocument` - Single page, instant response
- `AnalyzeExpense` - Expense/receipt analysis

**Option B: Asynchronous API (For larger documents)**
- `StartDocumentAnalysis` → Poll `GetDocumentAnalysis`
- Required for multi-page documents > 1 page

**Recommendation:** Implement both with automatic selection based on page count.

### Configuration Fields

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `accessKeyId` | password | Yes | AWS Access Key ID |
| `secretAccessKey` | password | Yes | AWS Secret Access Key |
| `region` | select | Yes | AWS Region (us-east-1, eu-west-1, etc.) |
| `useExpenseAnalysis` | checkbox | No | Use AnalyzeExpense for invoices |

### AWS Authentication Challenge

**Problem:** AWS requires Signature Version 4 (SigV4) for API authentication, which involves:
- Computing HMAC-SHA256 hashes
- Constructing canonical requests
- Creating string-to-sign
- Computing final signature

**Solution Options:**

1. **Implement SigV4 in SuiteScript** (Medium effort)
   - Use `N/crypto` module for HMAC-SHA256
   - Build canonical request per AWS spec
   - ~200-300 lines of signing code

2. **Use AWS Lambda Proxy** (Lower effort, adds dependency)
   - Lambda function handles auth
   - SuiteScript calls Lambda via simple HTTPS
   - Adds infrastructure dependency

**Recommendation:** Option 1 - Implement SigV4 natively for self-contained solution.

### Field Mapping (Textract → Normalized)

```javascript
const TEXTRACT_FIELD_MAP = {
    // AnalyzeExpense mappings
    'VENDOR_NAME': 'vendorName',
    'INVOICE_RECEIPT_ID': 'invoiceNumber',
    'INVOICE_RECEIPT_DATE': 'invoiceDate',
    'DUE_DATE': 'dueDate',
    'PO_NUMBER': 'poNumber',
    'TOTAL': 'totalAmount',
    'SUBTOTAL': 'subtotal',
    'TAX': 'taxAmount',
    'DISCOUNT': 'discountAmount',
    'SHIPPING_HANDLING_CHARGE': 'shippingAmount',
    'VENDOR_ADDRESS': 'vendorAddress',
    'RECEIVER_ADDRESS': 'shipToAddress',
    // ... additional mappings
};
```

### Files to Create/Modify

| File | Action | Description |
|------|--------|-------------|
| `lib/providers/AwsTextractProvider.js` | Create | Main provider implementation |
| `lib/providers/AwsSigV4.js` | Create | AWS Signature V4 signing utility |
| `lib/providers/ExtractionProvider.js` | Modify | Add `AWS_TEXTRACT` to ProviderType |
| `lib/providers/ProviderFactory.js` | Modify | Add factory method & config |
| `client/views/View.Settings.js` | Modify | Add AWS config UI section |

### Effort Estimate: AWS Textract

| Task | Effort | Notes |
|------|--------|-------|
| AWS SigV4 signing implementation | 1 day | Complex but well-documented |
| AwsTextractProvider class | 1-1.5 days | Sync + async APIs |
| Field mapping & normalization | 0.5 day | Map Textract fields |
| Table extraction normalization | 0.5 day | Convert table format |
| ProviderFactory integration | 2 hours | Add factory methods |
| Settings UI updates | 3 hours | Add config fields |
| Testing & validation | 1 day | End-to-end testing |
| **Total** | **4-5 days** | |

---

## Proposed Implementation: Mindee

### Overview

Mindee is a modern document parsing API with:
- Pre-built invoice/receipt parsers
- High accuracy on structured documents
- Simple REST API with API key auth
- Synchronous responses (no polling needed)

### API Integration Approach

Mindee uses a simple REST API:
- `POST /products/mindee/invoices/v4/predict` - Invoice parsing
- `POST /products/mindee/expense_receipts/v5/predict` - Receipt parsing

**Key Advantage:** Simpler auth (API key in header) vs. AWS SigV4.

### Configuration Fields

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `apiKey` | password | Yes | Mindee API Key |
| `documentType` | select | No | Default: invoice, receipt, document |

### Field Mapping (Mindee → Normalized)

```javascript
const MINDEE_INVOICE_MAP = {
    'supplier_name': 'vendorName',
    'supplier_address': 'vendorAddress',
    'invoice_number': 'invoiceNumber',
    'invoice_date': 'invoiceDate',
    'due_date': 'dueDate',
    'purchase_order': 'poNumber',
    'total_amount': 'totalAmount',
    'total_net': 'subtotal',
    'total_tax': 'taxAmount',
    'currency': 'currency',
    'payment_details': 'paymentTerms',
    // ... additional mappings
};
```

### Line Item Extraction

Mindee provides excellent line item parsing:
```javascript
{
    "line_items": [
        {
            "description": "Product A",
            "quantity": 2,
            "unit_price": 50.00,
            "total_amount": 100.00,
            "tax_rate": 0.10,
            "product_code": "SKU-001"
        }
    ]
}
```

### Files to Create/Modify

| File | Action | Description |
|------|--------|-------------|
| `lib/providers/MindeeProvider.js` | Create | Main provider implementation |
| `lib/providers/ExtractionProvider.js` | Modify | Add `MINDEE` to ProviderType |
| `lib/providers/ProviderFactory.js` | Modify | Add factory method & config |
| `client/views/View.Settings.js` | Modify | Add Mindee config UI section |

### Effort Estimate: Mindee

| Task | Effort | Notes |
|------|--------|-------|
| MindeeProvider class | 1 day | Simple REST API |
| Field mapping & normalization | 0.5 day | Map Mindee response |
| Line item extraction | 0.5 day | Parse line items array |
| ProviderFactory integration | 2 hours | Add factory methods |
| Settings UI updates | 2 hours | Add config fields |
| Testing & validation | 0.5 day | End-to-end testing |
| **Total** | **3-4 days** | |

---

## Comparison: Provider Capabilities

| Feature | OCI | Azure | Textract | Mindee |
|---------|-----|-------|----------|--------|
| Auth Complexity | None (native) | API Key | SigV4 (complex) | API Key |
| Invoice Parsing | Basic | Excellent | Good | Excellent |
| Table Extraction | Good | Excellent | Excellent | Good |
| Line Items | Limited | Excellent | Good | Excellent |
| Handwriting | No | Yes | Yes | Limited |
| Multi-page | Yes | Yes | Yes | Yes |
| Cost | Free tier | Pay-per-use | Pay-per-use | Pay-per-use |
| Setup Effort | Zero | Low | Medium | Low |

---

## Implementation Order Recommendation

### Recommended: Mindee First

**Rationale:**
1. Simpler API integration (API key auth vs SigV4)
2. Faster time to value
3. Excellent invoice parsing accuracy
4. Validates the provider pattern before tackling SigV4

### Implementation Phases

**Phase 1: Mindee Provider (3-4 days)**
- Implement MindeeProvider class
- Add configuration support
- Test with sample invoices
- Deploy and validate

**Phase 2: AWS Textract Provider (4-5 days)**
- Implement AWS SigV4 signing
- Implement AwsTextractProvider class
- Add sync + async API support
- Test with sample documents
- Deploy and validate

**Phase 3: Documentation & Polish (1 day)**
- Update user documentation
- Add provider comparison guide
- Performance optimization if needed

---

## Technical Considerations

### Error Handling

Both providers should implement:
```javascript
try {
    // API call
} catch (e) {
    if (e.name === 'SSS_REQUEST_TIME_EXCEEDED') {
        // Handle timeout - consider retry
    }
    if (e.statusCode === 429) {
        // Rate limiting - exponential backoff
    }
    // Log and return graceful error
}
```

### Rate Limiting

| Provider | Rate Limits |
|----------|-------------|
| AWS Textract | Varies by API, ~50-100 TPS |
| Mindee | 250 requests/month (free), higher on paid |

**Recommendation:** Implement request queuing if batch processing expected.

### Credential Security

Follow existing pattern from Azure provider:
- Encrypt credentials with `N/crypto` AES
- Store encrypted in `customrecord_flux_config`
- Decrypt only when making API calls
- Never log credentials

### SuiteScript Governance

| Operation | Units |
|-----------|-------|
| HTTPS request | 10 units |
| Crypto operations | 10 units |
| Record operations | 2-10 units |

**Note:** Both providers use HTTPS calls which consume governance. For batch processing via Map/Reduce, this is not a concern. For Suitelet/RESTlet calls, monitor usage.

---

## Risks & Mitigations

| Risk | Impact | Likelihood | Mitigation |
|------|--------|------------|------------|
| AWS SigV4 complexity | Schedule slip | Medium | Allocate buffer time, consider proxy |
| API rate limiting | Processing delays | Low | Implement queuing |
| Field mapping gaps | Extraction accuracy | Medium | Iterative testing with real docs |
| External service outages | Processing failure | Low | Graceful fallback to OCI |
| Credential exposure | Security | Low | Follow encryption pattern |

---

## Cost Considerations

### AWS Textract Pricing (US East)
- AnalyzeDocument: $1.50 per 1,000 pages
- AnalyzeExpense: $8.00 per 1,000 pages
- Tables: Additional $1.50 per 1,000 pages

### Mindee Pricing
- Free tier: 250 pages/month
- Developer: $50/month for 1,000 pages
- Growth: Custom pricing

**Recommendation:** Add usage tracking/reporting to help customers monitor costs.

---

## Summary

| Provider | Effort | Complexity | Value |
|----------|--------|------------|-------|
| **Mindee** | 3-4 days | Low | High |
| **AWS Textract** | 4-5 days | Medium | High |
| **Total** | 7-9 days | - | - |

The existing provider architecture is excellent and ready for extension. The main technical challenge is AWS SigV4 implementation, which is well-documented but requires careful implementation.

**Recommendation:** Proceed with Mindee first to deliver value quickly, then implement AWS Textract.

---

## Appendix A: Sample Provider Implementation Structure

```javascript
// MindeeProvider.js (simplified)
define(['N/log', 'N/https', './ExtractionProvider'],
function(log, https, ExtractionProviderModule) {
    const { ExtractionProvider, ProviderType } = ExtractionProviderModule;

    class MindeeProvider extends ExtractionProvider {
        constructor(config = {}) {
            super(config);
            this.providerType = ProviderType.MINDEE;
            this.providerName = 'Mindee';
            this.apiKey = config.apiKey || '';
            this.baseUrl = 'https://api.mindee.net/v1';
        }

        extract(fileObj, options = {}) {
            // 1. Read file contents
            // 2. Submit to Mindee API
            // 3. Parse response
            // 4. Normalize to standard format
            return this._normalizeResult(response);
        }

        checkAvailability() {
            return !!this.apiKey;
        }

        validateConfig() {
            const errors = [];
            if (!this.apiKey) {
                errors.push('Mindee API Key is required');
            }
            return { valid: errors.length === 0, errors };
        }
    }

    return { MindeeProvider };
});
```

---

## Appendix B: UI Configuration Wireframe

```
┌─────────────────────────────────────────────────────────────┐
│ Document Processing Provider                                 │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  ○ OCI Document Understanding (Built-in)                    │
│    No configuration required                                │
│                                                             │
│  ○ Azure Form Recognizer                                    │
│    └─ [Endpoint] [API Key] [Model ▼]                       │
│                                                             │
│  ○ AWS Textract                          ← NEW              │
│    └─ [Access Key ID] [Secret Key] [Region ▼]              │
│    └─ ☐ Use Expense Analysis for invoices                  │
│                                                             │
│  ○ Mindee                                ← NEW              │
│    └─ [API Key] [Document Type ▼]                          │
│                                                             │
│  [Test Connection]  [Save Configuration]                    │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

---

## Next Steps

1. **Review & Approve** this proposal
2. **Prioritize** which provider to implement first
3. **Create** feature branch for development
4. **Implement** following the existing patterns
5. **Test** with production-representative documents
6. **Document** configuration steps for end users

---

*End of Proposal*
