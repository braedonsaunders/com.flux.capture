# Flux Capture - Intelligent Document Capture for NetSuite

<div align="center">
  <img src="https://via.placeholder.com/200x200/6366f1/ffffff?text=Flux" alt="Flux Capture Logo" width="200"/>

  **AI-Powered Document Capture & Processing Platform**

  [![NetSuite](https://img.shields.io/badge/NetSuite-SuiteApp-blue)](https://www.netsuite.com)
  [![SuiteScript](https://img.shields.io/badge/SuiteScript-2.1-green)](https://docs.oracle.com/en/cloud/saas/netsuite/ns-online-help/)
  [![License](https://img.shields.io/badge/License-Proprietary-red)](LICENSE)
</div>

---

## Overview

Flux Capture is a world-class, AI-powered document capture SuiteApp for NetSuite that transforms how businesses process vendor bills, expense reports, and financial documents. It goes far beyond NetSuite's native Bill Capture functionality with advanced features like machine learning, fraud detection, and intelligent automation.

## Key Features

### 🤖 AI-Powered Document Intelligence
- **Oracle Cloud Document Understanding Integration** - Enterprise-grade OCR and document parsing
- **Smart Field Extraction** - Automatically extracts vendor name, invoice number, dates, amounts, PO references, payment terms, and line items
- **Multi-Document Support** - Process invoices, receipts, credit memos, expense reports, and purchase orders
- **Confidence Scoring** - Every extraction includes a confidence score with weighted field analysis

### 🔍 Advanced Fraud Detection
- **Duplicate Invoice Detection** - Smart similarity matching to catch duplicate submissions
- **Benford's Law Analysis** - Statistical analysis of number distributions to detect manipulation
- **Amount Anomaly Detection** - Compares against historical vendor averages
- **Round Number Pattern Detection** - Identifies suspicious patterns in invoice amounts

### 🧠 Machine Learning Engine
- **Learn from Corrections** - System improves accuracy by learning from user corrections
- **Vendor-Specific Patterns** - Builds custom extraction rules per vendor
- **Suggestion Engine** - Provides intelligent suggestions based on historical data

### 📊 Smart Vendor Matching
- **Fuzzy String Matching** - Intelligent vendor matching algorithm
- **Multiple Suggestions** - Ranked vendor suggestions with similarity scores
- **Auto-Match Confidence** - High-confidence matches can be auto-approved

### 💰 Financial Validation
- **Amount Reconciliation** - Validates line items against document totals
- **Currency Support** - Multi-currency with real-time exchange rates
- **Tax Calculation Verification** - Ensures tax amounts are accurate

### 📬 Email Integration
- **Email-to-Invoice** - Send invoices to a dedicated email address for automatic processing
- **Trusted Sender Lists** - Configure approved senders and domains
- **Auto-Processing** - Documents automatically queue for extraction

### 📈 Analytics Dashboard
- **Processing Statistics** - Track total processed, auto-processed, and pending review counts
- **Performance Trends** - Processing trend visualization
- **Document Type Breakdown** - Analysis by document type
- **Anomaly Alerts** - Real-time alerts for detected issues

### 🎨 Modern User Interface
- **Split-Screen Review** - Document preview alongside extraction data
- **Drag & Drop Upload** - Modern file upload with progress tracking
- **Mobile Responsive** - Works on tablets and phones
- **Batch Upload** - Process multiple documents at once

## Installation

### Prerequisites
- NetSuite account with SuiteScript 2.1 support
- Advanced Bill Capture feature enabled (optional, for OCI integration)

### Simplified Deployment (Recommended)

Flux Capture uses a **simplified 2-script architecture** for easy deployment:

1. **FC_Suitelet** - Complete UI (Dashboard, Upload, Review, Queue, Settings)
2. **FC_Router** - RESTlet API handling all operations

Deploy using SuiteCloud CLI:
```bash
suitecloud project:deploy
```

### GitHub Actions Deployment

This project includes automated deployment via GitHub Actions. Configure these secrets:

| Secret | Description |
|--------|-------------|
| `NS_ACCOUNT_ID` | NetSuite account ID (e.g., `TSTDRV1234567`) |
| `NS_CERTIFICATE_ID` | OAuth certificate ID |
| `NS_PRIVATE_KEY` | Base64-encoded private key |
| `NS_PASSKEY` | SuiteCloud CI passkey (32-100 chars) |

## Project Structure

```
com.flux.capture/
├── manifest.xml                    # SuiteApp manifest
├── deploy.xml                      # Deployment configuration
├── README.md                       # This file
├── .github/
│   └── workflows/
│       └── deploy-netsuite.yml     # GitHub Actions deployment
├── Objects/                        # Custom record definitions
│   ├── customrecord_dm_captured_document.xml
│   ├── customrecord_dm_batch.xml
│   ├── customscript_fc_router.xml      # RESTlet deployment
│   └── customscript_fc_suitelet.xml    # Suitelet deployment
└── FileCabinet/
    └── SuiteScripts/
        └── FluxCapture/
            ├── FC_Engine.js        # Core AI/OCR processing engine
            ├── FC_Router.js        # RESTlet API (single entry point)
            └── FC_Suitelet.js      # Complete UI (single Suitelet)
```

## Architecture

### Simplified 2-Script Design

| Script | Type | Purpose |
|--------|------|---------|
| **FC_Suitelet** | Suitelet | Complete web UI - Dashboard, Upload, Review, Queue, Batch, Settings |
| **FC_Router** | RESTlet | All API operations - CRUD, upload, process, approve, batch, email import |
| **FC_Engine** | Library | Core processing - OCR, vendor matching, fraud detection, confidence scoring |

### Why 2 Scripts?

- **Easy Deployment** - Only 2 script records to manage
- **Simplified Permissions** - Fewer deployments to configure
- **Single API Entry Point** - FC_Router handles all API calls with action routing
- **Embedded Client Logic** - No separate client script needed
- **No Scheduled Scripts** - Email import triggered via RESTlet endpoint (use external scheduler)

## Script Details

### FC_Engine.js (Library Module)
Core document processing engine:
- `FluxCaptureEngine` class - Main orchestrator for document processing
- Vendor matching with fuzzy logic
- Fraud/anomaly detection algorithms
- Confidence scoring calculation

### FC_Suitelet.js (Suitelet)
Complete web UI featuring:
- **Dashboard** - Statistics, charts, recent documents, anomaly alerts
- **Upload** - Drag-drop file upload with type detection
- **Review** - Split-screen document review interface
- **Queue** - Processing queue with filters and bulk actions
- **Batch** - Batch upload and management
- **Settings** - Configuration options

### FC_Router.js (RESTlet)
RESTful API router with all operations:

**GET Endpoints:**
- `action=document&id=123` - Get document details
- `action=list` - List documents with filters
- `action=queue` - Get processing queue
- `action=stats` - Dashboard statistics
- `action=vendors&query=xyz` - Search vendors
- `action=batches` - List batches
- `action=health` - Health check

**POST Endpoints:**
- `action=upload` - Upload single document
- `action=batch` - Upload batch
- `action=process` - Process document
- `action=reprocess` - Reprocess document
- `action=emailImport` - Import from email
- `action=learn` - Submit correction

**PUT Endpoints:**
- `action=update` - Update document
- `action=approve` - Approve and create transaction
- `action=reject` - Reject document
- `action=status` - Update status

**DELETE Endpoints:**
- `action=document&id=123` - Delete document
- `action=batch&batchId=456` - Delete batch
- `action=clear` - Clear completed documents

## Custom Records

### DM Captured Document (`customrecord_dm_captured_document`)
Primary record for captured documents with fields for:
- Source file and document ID
- Vendor, invoice details, amounts
- Line items (JSON)
- Confidence scores
- Anomaly data
- Status tracking (INTEGER - values hardcoded in JS)
- Document type (INTEGER - values hardcoded in JS)
- Source (INTEGER - values hardcoded in JS)
- User corrections (JSON - for ML learning)
- Audit information

### DM Batch (`customrecord_dm_batch`)
Groups multiple documents for batch processing:
- Document counts and progress
- Status tracking (INTEGER - values hardcoded in JS)
- Total value calculations

> **Note:** All enum values (status, document type, source, batch status) are stored as INTEGER fields with values defined as constants in `FC_Router.js` and `FC_Engine.js`. No custom lists are used.

### Enum Values (Hardcoded Constants)

**Document Type** (`custrecord_dm_document_type`):
| Value | Meaning |
|-------|---------|
| 1 | Invoice |
| 2 | Receipt |
| 3 | Credit Memo |
| 4 | Expense Report |
| 5 | Purchase Order |
| 6 | Unknown |

**Document Status** (`custrecord_dm_status`):
| Value | Meaning |
|-------|---------|
| 1 | Pending |
| 2 | Processing |
| 3 | Extracted |
| 4 | Needs Review |
| 5 | Rejected |
| 6 | Completed |
| 7 | Error |

**Batch Status** (`custrecord_dm_batch_status`):
| Value | Meaning |
|-------|---------|
| 1 | Pending |
| 2 | Processing |
| 3 | Completed |
| 4 | Partial Error |
| 5 | Failed |
| 6 | Cancelled |

**Source** (`custrecord_dm_source` / `custrecord_dm_batch_source`):
| Value | Meaning |
|-------|---------|
| 1 | Manual Upload |
| 2 | Email Import |
| 3 | Drag and Drop |
| 4 | API Integration |
| 5 | Scanner |
| 6 | Mobile App |

## API Examples

### Upload Document
```javascript
POST /app/site/hosting/restlet.nl?script=customscript_fc_router&deploy=customdeploy_fc_router
Content-Type: application/json

{
  "action": "upload",
  "fileName": "invoice.pdf",
  "fileContent": "base64encodedcontent",
  "documentType": "auto"
}
```

### Approve Document
```javascript
PUT /app/site/hosting/restlet.nl?script=customscript_fc_router&deploy=customdeploy_fc_router
Content-Type: application/json

{
  "action": "approve",
  "documentId": 12345,
  "createTransaction": true
}
```

### Get Dashboard Stats
```javascript
GET /app/site/hosting/restlet.nl?script=customscript_fc_router&deploy=customdeploy_fc_router&action=stats
```

## Confidence Scoring

Weighted calculation:
- Vendor Name: 20%
- Invoice Number: 15%
- Invoice Date: 10%
- Total Amount: 25%
- Line Items: 15%
- Vendor Match: 15%

**Levels:**
- HIGH: ≥85% (auto-approvable)
- MEDIUM: ≥60% (needs review)
- LOW: <60% (needs review)

## Deployment Summary

After deployment, you will have:

| Component | Count |
|-----------|-------|
| **Scripts** | 2 (1 Suitelet + 1 RESTlet) |
| **Custom Records** | 2 |
| **Custom Lists** | 0 (enums hardcoded in JS) |
| **Total Objects** | 4 |

## Support

For support and feature requests, please contact your NetSuite administrator or the Flux Capture development team.

## License

Proprietary - All rights reserved.

---

<div align="center">
  <strong>Flux Capture</strong> - Transforming Document Capture
  <br>
  Built with ❤️ for NetSuite
</div>
