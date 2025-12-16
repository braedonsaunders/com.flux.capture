# DocuMind - Intelligent Document Capture for NetSuite

<div align="center">
  <img src="https://via.placeholder.com/200x200/6366f1/ffffff?text=DocuMind" alt="DocuMind Logo" width="200"/>
  
  **AI-Powered Document Capture & Processing Platform**
  
  [![NetSuite](https://img.shields.io/badge/NetSuite-SuiteApp-blue)](https://www.netsuite.com)
  [![SuiteScript](https://img.shields.io/badge/SuiteScript-2.1-green)](https://docs.oracle.com/en/cloud/saas/netsuite/ns-online-help/)
  [![License](https://img.shields.io/badge/License-Proprietary-red)](LICENSE)
</div>

---

## Overview

DocuMind is a world-class, AI-powered document capture SuiteApp for NetSuite that transforms how businesses process vendor bills, expense reports, and financial documents. It goes far beyond NetSuite's native Bill Capture functionality with advanced features like machine learning, fraud detection, and intelligent automation.

## Key Features

### 🤖 AI-Powered Document Intelligence
- **Oracle Cloud Document Understanding Integration** - Enterprise-grade OCR and document parsing
- **Smart Field Extraction** - Automatically extracts vendor name, invoice number, dates, amounts, PO references, payment terms, and line items
- **Multi-Document Support** - Process invoices, receipts, credit memos, expense reports, and purchase orders
- **Confidence Scoring** - Every extraction includes a confidence score with weighted field analysis

### 🔍 Advanced Fraud Detection
- **Duplicate Invoice Detection** - Smart similarity matching (92% threshold) to catch duplicate submissions
- **Benford's Law Analysis** - Statistical analysis of number distributions to detect manipulation
- **Amount Anomaly Detection** - Compares against historical vendor averages (50% deviation threshold)
- **Round Number Pattern Detection** - Identifies suspicious patterns in invoice amounts

### 🧠 Machine Learning Engine
- **Learn from Corrections** - System improves accuracy by learning from user corrections
- **Vendor-Specific Patterns** - Builds custom extraction rules per vendor
- **Field Mapping Memory** - Remembers how to interpret different document layouts
- **Suggestion Engine** - Provides intelligent suggestions based on historical data

### 📊 Smart Vendor Matching
- **Fuzzy String Matching** - Levenshtein distance algorithm for intelligent vendor matching
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
- **Confirmation Emails** - Senders receive processing confirmations

### 📈 Analytics Dashboard
- **Processing Statistics** - Track total processed, auto-processed, and pending review counts
- **Performance Trends** - 7-day processing trend visualization
- **Document Type Breakdown** - Pie chart analysis by document type
- **Anomaly Alerts** - Real-time alerts for detected issues

### 🎨 Modern User Interface
- **Split-Screen Review** - Document preview alongside extraction data
- **Drag & Drop Upload** - Modern file upload with progress tracking
- **Mobile Responsive** - Works on tablets and phones
- **Camera Capture** - Take photos directly on mobile devices
- **Batch Upload** - Process multiple documents at once

## Installation

### Prerequisites
- NetSuite account with SuiteScript 2.1 support
- Advanced Bill Capture feature enabled
- API access for OCI Document Understanding (optional, for unlimited usage)

### SuiteCloud Project Setup

1. Clone this repository into your SuiteCloud project
2. Deploy using SuiteCloud Development Framework:
   ```bash
   suitecloud project:deploy
   ```

### Manual Installation

1. Upload all script files to `/SuiteScripts/DocuMind/`
2. Create custom records and lists from the Objects folder
3. Configure script deployments:
   - Suitelet: `DM_MainSuitelet.js`
   - RESTlet: `DM_API.js`
   - Map/Reduce: `DM_BatchProcessor.js`
   - User Event: `DM_DocumentEvents.js`
   - Client Script: `DM_DocumentClient.js`
   - Scheduled: `DM_EmailMonitor.js`

## Project Structure

```
DocuMind/
├── manifest.xml                    # SuiteApp manifest
├── deploy.xml                      # Deployment configuration
├── README.md                       # This file
├── Objects/                        # Custom record definitions
│   ├── customrecord_dm_captured_document.xml
│   ├── customrecord_dm_batch.xml
│   ├── customrecord_dm_learning.xml
│   ├── customlist_dm_status.xml
│   ├── customlist_dm_document_types.xml
│   ├── customlist_dm_source.xml
│   └── customlist_dm_batch_status.xml
├── src/
│   ├── suitelet/
│   │   └── DM_MainSuitelet.js      # Main UI (Dashboard, Upload, Review)
│   ├── restlet/
│   │   └── DM_API.js               # RESTful API endpoints
│   ├── mapreduce/
│   │   └── DM_BatchProcessor.js    # Batch document processing
│   ├── userevent/
│   │   └── DM_DocumentEvents.js    # Record event automation
│   ├── clientscript/
│   │   └── DM_DocumentClient.js    # Client-side interactions
│   ├── scheduled/
│   │   └── DM_EmailMonitor.js      # Email inbox monitoring
│   └── library/
│       └── DM_DocumentIntelligenceEngine.js  # Core AI engine
└── assets/
    ├── css/
    ├── js/
    └── templates/
```

## Script Details

### DM_DocumentIntelligenceEngine.js (Library)
The core document processing engine with:
- `DocumentCaptureEngine` - Main orchestrator for document processing
- `TransactionCreator` - Creates NetSuite transactions from extractions
- `LearningEngine` - Machine learning from user corrections
- Vendor matching with fuzzy logic
- Fraud detection algorithms
- Multi-currency support

### DM_MainSuitelet.js (Suitelet)
Modern web UI featuring:
- **Dashboard** - Statistics, charts, recent documents, anomaly alerts
- **Upload** - Drag-drop file upload with type detection
- **Review** - Split-screen document review interface
- Responsive design with Chart.js visualizations

### DM_API.js (RESTlet)
RESTful API with endpoints for:
- File upload and processing
- Document status updates
- Batch operations
- Statistics retrieval
- Settings management

### DM_BatchProcessor.js (Map/Reduce)
High-performance batch processing:
- Parallel document processing
- Governance management
- Error handling and retry logic
- Progress tracking

### DM_DocumentEvents.js (User Event)
Record automation:
- Status change workflows
- Transaction creation on approval
- Notification triggers
- Learning engine integration
- Audit trail maintenance

### DM_DocumentClient.js (Client Script)
Client-side enhancements:
- Real-time validation
- Auto-save functionality
- Keyboard shortcuts
- Smart suggestions
- Visual feedback

### DM_EmailMonitor.js (Scheduled)
Email inbox monitoring:
- Polls inbox every 15 minutes
- Trusted sender validation
- Auto-document creation
- Confirmation emails
- Error handling

## Custom Records

### DM Captured Document (`customrecord_dm_captured_document`)
Primary record for captured documents with fields for:
- Source file and document ID
- Vendor, invoice details, amounts
- Line items (JSON)
- Confidence scores
- Anomaly data
- Status tracking
- Audit information

### DM Batch (`customrecord_dm_batch`)
Groups multiple documents for batch processing:
- Document counts and progress
- Status tracking
- Total value calculations
- Average confidence

### DM Learning Record (`customrecord_dm_learning`)
Stores user corrections for ML improvement:
- Original vs corrected values
- Pattern recognition data
- Occurrence counts
- Vendor associations

## Configuration

### Script Parameters

**Main Suitelet:**
- `custscript_dm_auto_approve_threshold` - Confidence threshold for auto-approval (default: 85%)
- `custscript_dm_default_doc_type` - Default document type

**Email Monitor:**
- `custscript_dm_email_enabled` - Enable/disable email monitoring
- `custscript_dm_auto_process` - Auto-process email attachments
- `custscript_dm_inbox_folder` - File cabinet folder for inbox
- `custscript_dm_notify_complete` - Send completion notifications

## API Reference

### Upload Document
```javascript
POST /app/site/hosting/restlet.nl?script=customscript_dm_api&deploy=customdeploy_dm_api
Content-Type: application/json

{
  "action": "upload",
  "files": [
    {
      "name": "invoice.pdf",
      "content": "base64encodedcontent",
      "type": "pdf"
    }
  ],
  "options": {
    "documentType": "INVOICE",
    "autoProcess": true
  }
}
```

### Get Document Status
```javascript
GET /app/site/hosting/restlet.nl?script=customscript_dm_api&deploy=customdeploy_dm_api&action=status&documentId=12345
```

### Approve Document
```javascript
POST /app/site/hosting/restlet.nl?script=customscript_dm_api&deploy=customdeploy_dm_api
Content-Type: application/json

{
  "action": "approve",
  "documentId": 12345,
  "corrections": {
    "vendor": 456,
    "totalAmount": 1500.00
  }
}
```

## Fraud Detection Thresholds

| Detection Type | Threshold | Description |
|----------------|-----------|-------------|
| Duplicate Similarity | 92% | Minimum similarity for duplicate detection |
| Amount Deviation | 50% | Max deviation from vendor average |
| Benford Deviation | 15% | Max deviation from expected distribution |
| Round Number Pattern | 60% | Threshold for suspicious round numbers |

## Confidence Scoring

Weighted calculation:
- Vendor Name: 20%
- Invoice Number: 15%
- Invoice Date: 10%
- Total Amount: 20%
- Line Items: 15%
- Vendor Match: 10%
- Amount Validation: 10%

**Levels:**
- HIGH: ≥85%
- MEDIUM: ≥60%
- LOW: <60%

## Support

For support and feature requests, please contact your NetSuite administrator or the DocuMind development team.

## License

Proprietary - All rights reserved.

---

<div align="center">
  <strong>DocuMind</strong> - Transforming Document Capture
  <br>
  Built with ❤️ for NetSuite
</div>
