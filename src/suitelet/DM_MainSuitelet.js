/**
 * @NApiVersion 2.1
 * @NScriptType Suitelet
 * @NModuleScope SameAccount
 * 
 * DocuMind - Main Dashboard Suitelet
 * World-class document capture and intelligence platform UI
 */

define([
    'N/ui/serverWidget',
    'N/runtime',
    'N/search',
    'N/file',
    'N/record',
    'N/url',
    'N/query',
    './library/DM_DocumentIntelligenceEngine'
], function(serverWidget, runtime, search, file, record, url, query, DIEngine) {
    
    'use strict';
    
    // ═══════════════════════════════════════════════════════════════════════════
    // MAIN ENTRY POINT
    // ═══════════════════════════════════════════════════════════════════════════
    
    function onRequest(context) {
        const { request, response } = context;
        const action = request.parameters.action || 'dashboard';
        
        try {
            switch (action) {
                case 'dashboard':
                    renderDashboard(context);
                    break;
                case 'upload':
                    renderUploadPage(context);
                    break;
                case 'review':
                    renderReviewPage(context);
                    break;
                case 'queue':
                    renderProcessingQueue(context);
                    break;
                case 'analytics':
                    renderAnalytics(context);
                    break;
                case 'settings':
                    renderSettings(context);
                    break;
                case 'batch':
                    renderBatchUpload(context);
                    break;
                default:
                    renderDashboard(context);
            }
        } catch (error) {
            log.error({ title: 'Suitelet Error', details: error });
            response.write(renderErrorPage(error));
        }
    }
    
    // ═══════════════════════════════════════════════════════════════════════════
    // DASHBOARD RENDERER
    // ═══════════════════════════════════════════════════════════════════════════
    
    function renderDashboard(context) {
        const stats = getDashboardStats();
        const recentDocuments = getRecentDocuments(10);
        const pendingReview = getPendingReviewCount();
        const anomalies = getRecentAnomalies(5);
        
        const html = `
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>DocuMind - Intelligent Document Capture</title>
    <link href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700;800&display=swap" rel="stylesheet">
    <link href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css" rel="stylesheet">
    <style>
        ${getBaseStyles()}
        ${getDashboardStyles()}
    </style>
</head>
<body>
    <div class="app-container">
        ${renderSidebar('dashboard')}
        
        <main class="main-content">
            ${renderHeader('Dashboard', 'AI-Powered Document Intelligence')}
            
            <!-- Quick Actions -->
            <div class="quick-actions">
                <button class="action-btn primary" onclick="navigateTo('upload')">
                    <i class="fas fa-cloud-upload-alt"></i>
                    <span>Upload Documents</span>
                </button>
                <button class="action-btn secondary" onclick="navigateTo('batch')">
                    <i class="fas fa-layer-group"></i>
                    <span>Batch Upload</span>
                </button>
                <button class="action-btn secondary" onclick="navigateTo('queue')">
                    <i class="fas fa-tasks"></i>
                    <span>Processing Queue</span>
                    ${pendingReview > 0 ? `<span class="badge">${pendingReview}</span>` : ''}
                </button>
            </div>
            
            <!-- Stats Cards -->
            <div class="stats-grid">
                <div class="stat-card">
                    <div class="stat-icon blue">
                        <i class="fas fa-file-invoice"></i>
                    </div>
                    <div class="stat-info">
                        <span class="stat-value">${stats.totalProcessed}</span>
                        <span class="stat-label">Documents Processed</span>
                    </div>
                    <div class="stat-trend positive">
                        <i class="fas fa-arrow-up"></i> ${stats.weeklyGrowth}%
                    </div>
                </div>
                
                <div class="stat-card">
                    <div class="stat-icon green">
                        <i class="fas fa-check-circle"></i>
                    </div>
                    <div class="stat-info">
                        <span class="stat-value">${stats.autoProcessed}</span>
                        <span class="stat-label">Auto-Processed</span>
                    </div>
                    <div class="stat-trend">
                        <span class="accuracy">${stats.accuracy}% accuracy</span>
                    </div>
                </div>
                
                <div class="stat-card">
                    <div class="stat-icon orange">
                        <i class="fas fa-clock"></i>
                    </div>
                    <div class="stat-info">
                        <span class="stat-value">${stats.pendingReview}</span>
                        <span class="stat-label">Pending Review</span>
                    </div>
                    <div class="stat-actions">
                        <a href="#" onclick="navigateTo('review')">Review Now →</a>
                    </div>
                </div>
                
                <div class="stat-card">
                    <div class="stat-icon purple">
                        <i class="fas fa-dollar-sign"></i>
                    </div>
                    <div class="stat-info">
                        <span class="stat-value">$${formatNumber(stats.totalValue)}</span>
                        <span class="stat-label">Total Captured Value</span>
                    </div>
                    <div class="stat-period">This Month</div>
                </div>
            </div>
            
            <!-- Main Content Grid -->
            <div class="content-grid">
                <!-- Recent Documents -->
                <div class="card recent-docs">
                    <div class="card-header">
                        <h3><i class="fas fa-history"></i> Recent Documents</h3>
                        <a href="#" onclick="navigateTo('queue')">View All</a>
                    </div>
                    <div class="card-body">
                        <div class="doc-list">
                            ${recentDocuments.map(doc => `
                                <div class="doc-item" onclick="reviewDocument(${doc.id})">
                                    <div class="doc-icon ${doc.type.toLowerCase()}">
                                        <i class="fas ${getDocTypeIcon(doc.type)}"></i>
                                    </div>
                                    <div class="doc-info">
                                        <span class="doc-name">${doc.vendorName || 'Unknown Vendor'}</span>
                                        <span class="doc-meta">${doc.invoiceNumber || 'No Invoice #'} • ${doc.date}</span>
                                    </div>
                                    <div class="doc-amount">$${formatNumber(doc.amount)}</div>
                                    <div class="doc-status">
                                        <span class="status-badge ${doc.status}">${formatStatus(doc.status)}</span>
                                    </div>
                                    <div class="confidence-indicator" style="--confidence: ${doc.confidence * 100}%">
                                        <div class="confidence-fill ${getConfidenceClass(doc.confidence)}"></div>
                                    </div>
                                </div>
                            `).join('')}
                        </div>
                    </div>
                </div>
                
                <!-- Anomaly Alerts -->
                <div class="card anomalies">
                    <div class="card-header">
                        <h3><i class="fas fa-exclamation-triangle"></i> Anomaly Alerts</h3>
                        <span class="alert-count ${anomalies.length > 0 ? 'has-alerts' : ''}">${anomalies.length}</span>
                    </div>
                    <div class="card-body">
                        ${anomalies.length > 0 ? `
                            <div class="anomaly-list">
                                ${anomalies.map(anomaly => `
                                    <div class="anomaly-item ${anomaly.severity}">
                                        <div class="anomaly-icon">
                                            <i class="fas ${getAnomalyIcon(anomaly.type)}"></i>
                                        </div>
                                        <div class="anomaly-info">
                                            <span class="anomaly-title">${anomaly.title}</span>
                                            <span class="anomaly-desc">${anomaly.description}</span>
                                        </div>
                                        <button class="anomaly-action" onclick="reviewDocument(${anomaly.documentId})">
                                            Review
                                        </button>
                                    </div>
                                `).join('')}
                            </div>
                        ` : `
                            <div class="empty-state">
                                <i class="fas fa-shield-alt"></i>
                                <p>No anomalies detected</p>
                                <span>All documents are within normal parameters</span>
                            </div>
                        `}
                    </div>
                </div>
                
                <!-- Processing Performance Chart -->
                <div class="card performance-chart">
                    <div class="card-header">
                        <h3><i class="fas fa-chart-line"></i> Processing Performance</h3>
                        <div class="chart-period-selector">
                            <button class="period-btn active" data-period="7d">7D</button>
                            <button class="period-btn" data-period="30d">30D</button>
                            <button class="period-btn" data-period="90d">90D</button>
                        </div>
                    </div>
                    <div class="card-body">
                        <canvas id="performanceChart" height="200"></canvas>
                    </div>
                </div>
                
                <!-- Document Types Breakdown -->
                <div class="card doc-breakdown">
                    <div class="card-header">
                        <h3><i class="fas fa-pie-chart"></i> Document Types</h3>
                    </div>
                    <div class="card-body">
                        <div class="breakdown-chart">
                            <canvas id="docTypeChart" height="180"></canvas>
                        </div>
                        <div class="breakdown-legend">
                            ${stats.byType.map((type, i) => `
                                <div class="legend-item">
                                    <span class="legend-color" style="background: ${getChartColor(i)}"></span>
                                    <span class="legend-label">${type.name}</span>
                                    <span class="legend-value">${type.count}</span>
                                </div>
                            `).join('')}
                        </div>
                    </div>
                </div>
            </div>
        </main>
    </div>
    
    <script src="https://cdnjs.cloudflare.com/ajax/libs/Chart.js/3.9.1/chart.min.js"></script>
    <script>
        ${getDashboardScript(stats)}
    </script>
</body>
</html>
        `;
        
        context.response.write(html);
    }
    
    // ═══════════════════════════════════════════════════════════════════════════
    // UPLOAD PAGE RENDERER
    // ═══════════════════════════════════════════════════════════════════════════
    
    function renderUploadPage(context) {
        const uploadEndpoint = url.resolveScript({
            scriptId: 'customscript_dm_api',
            deploymentId: 'customdeploy_dm_api',
            returnExternalUrl: false
        });
        
        const html = `
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>DocuMind - Upload Documents</title>
    <link href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700;800&display=swap" rel="stylesheet">
    <link href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css" rel="stylesheet">
    <style>
        ${getBaseStyles()}
        ${getUploadStyles()}
    </style>
</head>
<body>
    <div class="app-container">
        ${renderSidebar('upload')}
        
        <main class="main-content">
            ${renderHeader('Upload Documents', 'Drag & drop or click to upload invoices, receipts, and more')}
            
            <div class="upload-container">
                <!-- Document Type Selector -->
                <div class="type-selector">
                    <label class="type-option active" data-type="auto">
                        <input type="radio" name="docType" value="auto" checked>
                        <div class="type-icon"><i class="fas fa-magic"></i></div>
                        <span class="type-label">Auto-Detect</span>
                        <span class="type-desc">AI identifies document type</span>
                    </label>
                    <label class="type-option" data-type="invoice">
                        <input type="radio" name="docType" value="invoice">
                        <div class="type-icon"><i class="fas fa-file-invoice-dollar"></i></div>
                        <span class="type-label">Invoice</span>
                        <span class="type-desc">Vendor bills & invoices</span>
                    </label>
                    <label class="type-option" data-type="receipt">
                        <input type="radio" name="docType" value="receipt">
                        <div class="type-icon"><i class="fas fa-receipt"></i></div>
                        <span class="type-label">Receipt</span>
                        <span class="type-desc">Purchase receipts</span>
                    </label>
                    <label class="type-option" data-type="expense">
                        <input type="radio" name="docType" value="expense">
                        <div class="type-icon"><i class="fas fa-wallet"></i></div>
                        <span class="type-label">Expense</span>
                        <span class="type-desc">Expense reports</span>
                    </label>
                    <label class="type-option" data-type="credit">
                        <input type="radio" name="docType" value="credit">
                        <div class="type-icon"><i class="fas fa-undo-alt"></i></div>
                        <span class="type-label">Credit Memo</span>
                        <span class="type-desc">Credits & returns</span>
                    </label>
                </div>
                
                <!-- Upload Zone -->
                <div class="upload-zone" id="uploadZone">
                    <div class="upload-content">
                        <div class="upload-icon">
                            <i class="fas fa-cloud-upload-alt"></i>
                        </div>
                        <h2>Drag & Drop Documents Here</h2>
                        <p>or click to browse your files</p>
                        <div class="supported-formats">
                            <span>Supported formats:</span>
                            <span class="format-badge">PDF</span>
                            <span class="format-badge">PNG</span>
                            <span class="format-badge">JPG</span>
                            <span class="format-badge">TIFF</span>
                        </div>
                        <input type="file" id="fileInput" multiple accept=".pdf,.png,.jpg,.jpeg,.tiff,.tif,.gif,.bmp" hidden>
                    </div>
                    <div class="upload-progress" id="uploadProgress" hidden>
                        <div class="progress-content">
                            <div class="spinner"></div>
                            <h3>Processing Documents</h3>
                            <p id="progressText">Uploading...</p>
                            <div class="progress-bar">
                                <div class="progress-fill" id="progressBar"></div>
                            </div>
                        </div>
                    </div>
                </div>
                
                <!-- Upload Queue -->
                <div class="upload-queue" id="uploadQueue" hidden>
                    <div class="queue-header">
                        <h3><i class="fas fa-list"></i> Upload Queue</h3>
                        <button class="btn-clear" onclick="clearQueue()">Clear All</button>
                    </div>
                    <div class="queue-list" id="queueList"></div>
                    <div class="queue-actions">
                        <button class="btn secondary" onclick="addMoreFiles()">
                            <i class="fas fa-plus"></i> Add More Files
                        </button>
                        <button class="btn primary" onclick="processQueue()" id="processBtn">
                            <i class="fas fa-play"></i> Process All (<span id="fileCount">0</span>)
                        </button>
                    </div>
                </div>
                
                <!-- Camera Capture (Mobile) -->
                <div class="camera-capture" id="cameraCapture">
                    <button class="camera-btn" onclick="openCamera()">
                        <i class="fas fa-camera"></i>
                        <span>Capture with Camera</span>
                    </button>
                </div>
                
                <!-- Email Import -->
                <div class="email-import">
                    <div class="email-info">
                        <i class="fas fa-envelope"></i>
                        <div class="email-text">
                            <h4>Forward Invoices via Email</h4>
                            <p>Send documents to: <strong>invoices@${runtime.accountId}.documind.netsuite.com</strong></p>
                        </div>
                    </div>
                </div>
            </div>
        </main>
    </div>
    
    <script>
        ${getUploadScript(uploadEndpoint)}
    </script>
</body>
</html>
        `;
        
        context.response.write(html);
    }
    
    // ═══════════════════════════════════════════════════════════════════════════
    // REVIEW PAGE RENDERER
    // ═══════════════════════════════════════════════════════════════════════════
    
    function renderReviewPage(context) {
        const documentId = context.request.parameters.docId;
        
        if (!documentId) {
            return renderReviewQueue(context);
        }
        
        const docData = getDocumentData(documentId);
        
        if (!docData) {
            context.response.write(renderErrorPage(new Error('Document not found')));
            return;
        }
        
        const html = `
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>DocuMind - Review Document</title>
    <link href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700;800&display=swap" rel="stylesheet">
    <link href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css" rel="stylesheet">
    <style>
        ${getBaseStyles()}
        ${getReviewStyles()}
    </style>
</head>
<body>
    <div class="app-container">
        ${renderSidebar('review')}
        
        <main class="main-content review-mode">
            <div class="review-header">
                <div class="review-nav">
                    <button class="nav-btn" onclick="navigateTo('queue')">
                        <i class="fas fa-arrow-left"></i> Back to Queue
                    </button>
                    <div class="doc-nav">
                        <button class="nav-btn" onclick="prevDocument()" ${docData.prevId ? '' : 'disabled'}>
                            <i class="fas fa-chevron-left"></i>
                        </button>
                        <span class="doc-position">${docData.position} of ${docData.total}</span>
                        <button class="nav-btn" onclick="nextDocument()" ${docData.nextId ? '' : 'disabled'}>
                            <i class="fas fa-chevron-right"></i>
                        </button>
                    </div>
                </div>
                <div class="review-actions">
                    <button class="action-btn reject" onclick="rejectDocument(${documentId})">
                        <i class="fas fa-times"></i> Reject
                    </button>
                    <button class="action-btn approve" onclick="approveDocument(${documentId})">
                        <i class="fas fa-check"></i> Approve & Create
                    </button>
                </div>
            </div>
            
            <div class="review-container">
                <!-- Document Preview -->
                <div class="document-preview">
                    <div class="preview-toolbar">
                        <button class="tool-btn" onclick="zoomIn()"><i class="fas fa-search-plus"></i></button>
                        <button class="tool-btn" onclick="zoomOut()"><i class="fas fa-search-minus"></i></button>
                        <button class="tool-btn" onclick="rotateDoc()"><i class="fas fa-redo"></i></button>
                        <button class="tool-btn" onclick="downloadOriginal()"><i class="fas fa-download"></i></button>
                    </div>
                    <div class="preview-frame" id="previewFrame">
                        <iframe src="${docData.previewUrl}" id="docPreview"></iframe>
                    </div>
                    ${docData.pageCount > 1 ? `
                        <div class="page-nav">
                            <button onclick="prevPage()"><i class="fas fa-chevron-left"></i></button>
                            <span>Page <span id="currentPage">1</span> of ${docData.pageCount}</span>
                            <button onclick="nextPage()"><i class="fas fa-chevron-right"></i></button>
                        </div>
                    ` : ''}
                </div>
                
                <!-- Extraction Panel -->
                <div class="extraction-panel">
                    <!-- Confidence Score -->
                    <div class="confidence-banner ${docData.confidenceLevel.toLowerCase()}">
                        <div class="confidence-score">
                            <div class="score-circle">
                                <svg viewBox="0 0 36 36">
                                    <path class="score-bg" d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831"/>
                                    <path class="score-fill" stroke-dasharray="${docData.confidence * 100}, 100" d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831"/>
                                    <text x="18" y="20.5" class="score-text">${Math.round(docData.confidence * 100)}%</text>
                                </svg>
                            </div>
                            <div class="score-label">
                                <span class="label-title">${docData.confidenceLevel} Confidence</span>
                                <span class="label-desc">${getConfidenceMessage(docData.confidence)}</span>
                            </div>
                        </div>
                    </div>
                    
                    <!-- Anomaly Warnings -->
                    ${docData.anomalies && docData.anomalies.length > 0 ? `
                        <div class="anomaly-warnings">
                            ${docData.anomalies.map(a => `
                                <div class="warning-item ${a.severity}">
                                    <i class="fas fa-exclamation-triangle"></i>
                                    <span>${a.message}</span>
                                </div>
                            `).join('')}
                        </div>
                    ` : ''}
                    
                    <!-- Document Type -->
                    <div class="field-group type-selector">
                        <label>Document Type</label>
                        <select id="documentType" onchange="updateDocumentType(this.value)">
                            <option value="INVOICE" ${docData.type === 'INVOICE' ? 'selected' : ''}>Vendor Bill</option>
                            <option value="RECEIPT" ${docData.type === 'RECEIPT' ? 'selected' : ''}>Receipt</option>
                            <option value="EXPENSE_REPORT" ${docData.type === 'EXPENSE_REPORT' ? 'selected' : ''}>Expense Report</option>
                            <option value="CREDIT_MEMO" ${docData.type === 'CREDIT_MEMO' ? 'selected' : ''}>Vendor Credit</option>
                        </select>
                    </div>
                    
                    <!-- Extracted Fields -->
                    <div class="extracted-fields">
                        <h3>Extracted Information</h3>
                        
                        ${renderExtractedField('vendorName', 'Vendor', docData.fields.vendorName, {
                            type: 'vendor-select',
                            suggestions: docData.vendorSuggestions
                        })}
                        
                        ${renderExtractedField('invoiceNumber', 'Invoice Number', docData.fields.invoiceNumber)}
                        
                        ${renderExtractedField('invoiceDate', 'Invoice Date', docData.fields.invoiceDate, {
                            type: 'date'
                        })}
                        
                        ${renderExtractedField('dueDate', 'Due Date', docData.fields.dueDate, {
                            type: 'date'
                        })}
                        
                        ${renderExtractedField('poNumber', 'PO Number', docData.fields.poNumber, {
                            type: 'po-select',
                            suggestions: docData.poMatches
                        })}
                        
                        ${renderExtractedField('currency', 'Currency', docData.fields.currency, {
                            type: 'currency-select'
                        })}
                    </div>
                    
                    <!-- Amount Fields -->
                    <div class="amount-fields">
                        <h3>Amounts</h3>
                        <div class="amount-grid">
                            ${renderAmountField('subtotal', 'Subtotal', docData.fields.subtotal)}
                            ${renderAmountField('taxAmount', 'Tax', docData.fields.taxAmount)}
                            ${renderAmountField('totalAmount', 'Total', docData.fields.totalAmount, { highlight: true })}
                        </div>
                        
                        ${docData.amountValidation && !docData.amountValidation.valid ? `
                            <div class="amount-warning">
                                <i class="fas fa-calculator"></i>
                                <span>Calculated total differs from extracted: $${docData.calculatedTotal.toFixed(2)}</span>
                            </div>
                        ` : ''}
                    </div>
                    
                    <!-- Line Items -->
                    <div class="line-items-section">
                        <div class="section-header">
                            <h3>Line Items</h3>
                            <button class="btn-add" onclick="addLineItem()">
                                <i class="fas fa-plus"></i> Add Line
                            </button>
                        </div>
                        
                        <div class="line-items-table" id="lineItemsTable">
                            <div class="table-header">
                                <span class="col-desc">Description</span>
                                <span class="col-qty">Qty</span>
                                <span class="col-rate">Rate</span>
                                <span class="col-amount">Amount</span>
                                <span class="col-actions"></span>
                            </div>
                            <div class="table-body" id="lineItemsBody">
                                ${(docData.lineItems || []).map((item, i) => renderLineItem(item, i)).join('')}
                            </div>
                            <div class="table-footer">
                                <span class="line-total-label">Line Items Total:</span>
                                <span class="line-total-value" id="lineItemsTotal">$${calculateLineTotal(docData.lineItems).toFixed(2)}</span>
                            </div>
                        </div>
                    </div>
                    
                    <!-- Additional Options -->
                    <div class="additional-options">
                        <h3>Options</h3>
                        <div class="option-group">
                            <label class="checkbox-label">
                                <input type="checkbox" id="autoApprove">
                                <span>Auto-approve similar documents from this vendor</span>
                            </label>
                        </div>
                        <div class="option-group">
                            <label class="checkbox-label">
                                <input type="checkbox" id="attachOriginal" checked>
                                <span>Attach original document to transaction</span>
                            </label>
                        </div>
                    </div>
                </div>
            </div>
        </main>
    </div>
    
    <script>
        ${getReviewScript(documentId, docData)}
    </script>
</body>
</html>
        `;
        
        context.response.write(html);
    }
    
    // ═══════════════════════════════════════════════════════════════════════════
    // HELPER FUNCTIONS
    // ═══════════════════════════════════════════════════════════════════════════
    
    function renderSidebar(activeItem) {
        return `
            <aside class="sidebar">
                <div class="sidebar-header">
                    <div class="logo">
                        <i class="fas fa-brain"></i>
                        <span>DocuMind</span>
                    </div>
                </div>
                <nav class="sidebar-nav">
                    <a href="#" onclick="navigateTo('dashboard')" class="nav-item ${activeItem === 'dashboard' ? 'active' : ''}">
                        <i class="fas fa-chart-pie"></i>
                        <span>Dashboard</span>
                    </a>
                    <a href="#" onclick="navigateTo('upload')" class="nav-item ${activeItem === 'upload' ? 'active' : ''}">
                        <i class="fas fa-cloud-upload-alt"></i>
                        <span>Upload</span>
                    </a>
                    <a href="#" onclick="navigateTo('queue')" class="nav-item ${activeItem === 'queue' ? 'active' : ''}">
                        <i class="fas fa-tasks"></i>
                        <span>Queue</span>
                    </a>
                    <a href="#" onclick="navigateTo('review')" class="nav-item ${activeItem === 'review' ? 'active' : ''}">
                        <i class="fas fa-clipboard-check"></i>
                        <span>Review</span>
                    </a>
                    <a href="#" onclick="navigateTo('analytics')" class="nav-item ${activeItem === 'analytics' ? 'active' : ''}">
                        <i class="fas fa-chart-line"></i>
                        <span>Analytics</span>
                    </a>
                    <div class="nav-divider"></div>
                    <a href="#" onclick="navigateTo('settings')" class="nav-item ${activeItem === 'settings' ? 'active' : ''}">
                        <i class="fas fa-cog"></i>
                        <span>Settings</span>
                    </a>
                </nav>
                <div class="sidebar-footer">
                    <div class="usage-info">
                        <span class="usage-label">OCR Credits</span>
                        <div class="usage-bar">
                            <div class="usage-fill" style="width: 68%"></div>
                        </div>
                        <span class="usage-text">680 / 1,000 used</span>
                    </div>
                </div>
            </aside>
        `;
    }
    
    function renderHeader(title, subtitle) {
        return `
            <header class="page-header">
                <div class="header-content">
                    <h1>${title}</h1>
                    <p>${subtitle}</p>
                </div>
                <div class="header-actions">
                    <div class="search-box">
                        <i class="fas fa-search"></i>
                        <input type="text" placeholder="Search documents..." id="globalSearch">
                    </div>
                    <button class="icon-btn notification-btn">
                        <i class="fas fa-bell"></i>
                        <span class="notification-badge">3</span>
                    </button>
                    <div class="user-menu">
                        <img src="https://ui-avatars.com/api/?name=${runtime.getCurrentUser().name}&background=6366f1&color=fff" alt="User">
                    </div>
                </div>
            </header>
        `;
    }
    
    function renderExtractedField(fieldId, label, fieldData, options = {}) {
        const confidence = fieldData?.confidence || 0;
        const value = fieldData?.value || '';
        const confidenceClass = getConfidenceClass(confidence);
        
        let inputHtml = '';
        
        if (options.type === 'vendor-select') {
            inputHtml = `
                <div class="smart-select" data-field="${fieldId}">
                    <input type="text" class="field-input" value="${value}" id="${fieldId}" onchange="onFieldChange('${fieldId}')">
                    ${options.suggestions && options.suggestions.length > 0 ? `
                        <div class="suggestions-dropdown">
                            ${options.suggestions.map(s => `
                                <div class="suggestion-item" onclick="selectSuggestion('${fieldId}', ${s.id}, '${s.name}')">
                                    <span class="suggestion-name">${s.name}</span>
                                    <span class="suggestion-match">${Math.round(s.similarity * 100)}% match</span>
                                </div>
                            `).join('')}
                        </div>
                    ` : ''}
                </div>
            `;
        } else if (options.type === 'date') {
            inputHtml = `<input type="date" class="field-input" value="${formatDateInput(value)}" id="${fieldId}" onchange="onFieldChange('${fieldId}')">`;
        } else {
            inputHtml = `<input type="text" class="field-input" value="${value}" id="${fieldId}" onchange="onFieldChange('${fieldId}')">`;
        }
        
        return `
            <div class="field-group" data-field="${fieldId}">
                <label>${label}</label>
                <div class="field-wrapper">
                    ${inputHtml}
                    <div class="confidence-badge ${confidenceClass}" title="Confidence: ${Math.round(confidence * 100)}%">
                        <div class="conf-fill" style="width: ${confidence * 100}%"></div>
                    </div>
                </div>
            </div>
        `;
    }
    
    function renderAmountField(fieldId, label, fieldData, options = {}) {
        const value = fieldData?.numericValue || 0;
        const confidence = fieldData?.confidence || 0;
        
        return `
            <div class="amount-field ${options.highlight ? 'highlight' : ''}">
                <label>${label}</label>
                <div class="amount-input-wrapper">
                    <span class="currency-symbol">$</span>
                    <input type="number" step="0.01" value="${value.toFixed(2)}" id="${fieldId}" onchange="onAmountChange('${fieldId}')">
                </div>
            </div>
        `;
    }
    
    function renderLineItem(item, index) {
        return `
            <div class="line-item" data-index="${index}">
                <input type="text" class="col-desc" value="${item.description || ''}" placeholder="Description">
                <input type="number" class="col-qty" value="${item.quantity || 1}" step="1" min="0">
                <input type="number" class="col-rate" value="${(item.unitPrice || 0).toFixed(2)}" step="0.01">
                <input type="number" class="col-amount" value="${(item.amount || 0).toFixed(2)}" step="0.01">
                <button class="col-actions" onclick="removeLineItem(${index})">
                    <i class="fas fa-trash"></i>
                </button>
            </div>
        `;
    }
    
    // ═══════════════════════════════════════════════════════════════════════════
    // DATA RETRIEVAL FUNCTIONS
    // ═══════════════════════════════════════════════════════════════════════════
    
    function getDashboardStats() {
        // In production, these would come from actual database queries
        return {
            totalProcessed: 1247,
            autoProcessed: 892,
            pendingReview: 23,
            accuracy: 94.7,
            totalValue: 2847392.45,
            weeklyGrowth: 12,
            byType: [
                { name: 'Invoices', count: 743 },
                { name: 'Receipts', count: 312 },
                { name: 'Expenses', count: 156 },
                { name: 'Credits', count: 36 }
            ]
        };
    }
    
    function getRecentDocuments(limit) {
        // Mock data - would be replaced with actual search
        return [
            { id: 1, vendorName: 'Acme Corp', invoiceNumber: 'INV-2024-0893', date: 'Dec 15, 2025', amount: 4523.50, status: 'pending', confidence: 0.92, type: 'INVOICE' },
            { id: 2, vendorName: 'Office Supplies Inc', invoiceNumber: 'OS-78234', date: 'Dec 14, 2025', amount: 892.10, status: 'completed', confidence: 0.98, type: 'INVOICE' },
            { id: 3, vendorName: 'Cloud Services Ltd', invoiceNumber: 'CS-2025-1205', date: 'Dec 14, 2025', amount: 1500.00, status: 'needs_review', confidence: 0.67, type: 'INVOICE' },
            { id: 4, vendorName: 'Travel Agency', invoiceNumber: 'TA-9012', date: 'Dec 13, 2025', amount: 2340.00, status: 'completed', confidence: 0.95, type: 'EXPENSE_REPORT' },
            { id: 5, vendorName: 'Hardware Store', invoiceNumber: 'HW-4521', date: 'Dec 12, 2025', amount: 456.78, status: 'completed', confidence: 0.89, type: 'RECEIPT' }
        ].slice(0, limit);
    }
    
    function getPendingReviewCount() {
        return 23;
    }
    
    function getRecentAnomalies(limit) {
        return [
            { id: 1, documentId: 3, type: 'POTENTIAL_DUPLICATE', severity: 'high', title: 'Potential Duplicate', description: 'Invoice CS-2025-1205 matches a previous document from Nov 15' },
            { id: 2, documentId: 6, type: 'UNUSUAL_AMOUNT', severity: 'medium', title: 'Unusual Amount', description: 'Amount is 340% higher than vendor average' }
        ].slice(0, limit);
    }
    
    function getDocumentData(documentId) {
        // Mock document data
        return {
            id: documentId,
            type: 'INVOICE',
            confidence: 0.87,
            confidenceLevel: 'High',
            previewUrl: `/documents/${documentId}/preview`,
            pageCount: 2,
            position: 1,
            total: 23,
            prevId: null,
            nextId: 2,
            fields: {
                vendorName: { value: 'Acme Corporation', confidence: 0.95 },
                invoiceNumber: { value: 'INV-2024-0893', confidence: 0.98 },
                invoiceDate: { value: '2025-12-15', confidence: 0.92, parsedValue: new Date('2025-12-15') },
                dueDate: { value: '2026-01-15', confidence: 0.88, parsedValue: new Date('2026-01-15') },
                poNumber: { value: 'PO-2025-1234', confidence: 0.85 },
                currency: { value: 'USD', confidence: 0.99 },
                subtotal: { value: '4,250.00', numericValue: 4250, confidence: 0.94 },
                taxAmount: { value: '273.50', numericValue: 273.50, confidence: 0.91 },
                totalAmount: { value: '4,523.50', numericValue: 4523.50, confidence: 0.96 }
            },
            vendorSuggestions: [
                { id: 123, name: 'Acme Corporation', similarity: 0.98 },
                { id: 456, name: 'Acme Industries', similarity: 0.72 },
                { id: 789, name: 'ACME Ltd', similarity: 0.68 }
            ],
            poMatches: [
                { id: 1001, tranId: 'PO-2025-1234', vendor: 'Acme Corporation', total: 4500 }
            ],
            lineItems: [
                { description: 'Widget Assembly - Model A', quantity: 100, unitPrice: 25.00, amount: 2500.00, confidence: 0.94 },
                { description: 'Widget Assembly - Model B', quantity: 50, unitPrice: 35.00, amount: 1750.00, confidence: 0.92 }
            ],
            calculatedTotal: 4523.50,
            amountValidation: { valid: true, issues: [] },
            anomalies: []
        };
    }
    
    // ═══════════════════════════════════════════════════════════════════════════
    // UTILITY FUNCTIONS
    // ═══════════════════════════════════════════════════════════════════════════
    
    function formatNumber(num) {
        if (num >= 1000000) return (num / 1000000).toFixed(1) + 'M';
        if (num >= 1000) return (num / 1000).toFixed(1) + 'K';
        return num.toFixed(2);
    }
    
    function formatStatus(status) {
        const labels = {
            pending: 'Pending',
            processing: 'Processing',
            extracted: 'Extracted',
            needs_review: 'Needs Review',
            approved: 'Approved',
            rejected: 'Rejected',
            completed: 'Completed',
            error: 'Error'
        };
        return labels[status] || status;
    }
    
    function getConfidenceClass(confidence) {
        if (confidence >= 0.85) return 'high';
        if (confidence >= 0.60) return 'medium';
        return 'low';
    }
    
    function getConfidenceMessage(confidence) {
        if (confidence >= 0.85) return 'Ready for auto-processing';
        if (confidence >= 0.60) return 'Review recommended';
        return 'Manual verification required';
    }
    
    function getDocTypeIcon(type) {
        const icons = {
            'INVOICE': 'fa-file-invoice-dollar',
            'RECEIPT': 'fa-receipt',
            'EXPENSE_REPORT': 'fa-wallet',
            'CREDIT_MEMO': 'fa-undo-alt',
            'PURCHASE_ORDER': 'fa-clipboard-list'
        };
        return icons[type] || 'fa-file-alt';
    }
    
    function getAnomalyIcon(type) {
        const icons = {
            'POTENTIAL_DUPLICATE': 'fa-copy',
            'UNUSUAL_AMOUNT': 'fa-dollar-sign',
            'BENFORD_ANOMALY': 'fa-chart-bar',
            'ROUND_NUMBER_PATTERN': 'fa-dice'
        };
        return icons[type] || 'fa-exclamation-circle';
    }
    
    function getChartColor(index) {
        const colors = ['#6366f1', '#22c55e', '#f59e0b', '#ef4444', '#8b5cf6', '#06b6d4'];
        return colors[index % colors.length];
    }
    
    function formatDateInput(value) {
        if (!value) return '';
        if (value instanceof Date) return value.toISOString().split('T')[0];
        return value;
    }
    
    function calculateLineTotal(lineItems) {
        if (!lineItems) return 0;
        return lineItems.reduce((sum, item) => sum + (item.amount || 0), 0);
    }
    
    function renderErrorPage(error) {
        return `
<!DOCTYPE html>
<html>
<head>
    <title>DocuMind - Error</title>
    <style>
        body { font-family: Inter, sans-serif; display: flex; justify-content: center; align-items: center; height: 100vh; margin: 0; background: #f1f5f9; }
        .error-box { background: white; padding: 40px; border-radius: 12px; box-shadow: 0 4px 20px rgba(0,0,0,0.1); text-align: center; }
        .error-icon { font-size: 48px; color: #ef4444; margin-bottom: 20px; }
        h1 { color: #1e293b; margin-bottom: 10px; }
        p { color: #64748b; }
        a { color: #6366f1; text-decoration: none; }
    </style>
</head>
<body>
    <div class="error-box">
        <div class="error-icon">⚠️</div>
        <h1>Something went wrong</h1>
        <p>${error.message || 'An unexpected error occurred'}</p>
        <p><a href="#">← Back to Dashboard</a></p>
    </div>
</body>
</html>
        `;
    }
    
    // ═══════════════════════════════════════════════════════════════════════════
    // STYLES
    // ═══════════════════════════════════════════════════════════════════════════
    
    function getBaseStyles() {
        return `
            * { margin: 0; padding: 0; box-sizing: border-box; }
            
            :root {
                --primary: #6366f1;
                --primary-dark: #4f46e5;
                --secondary: #64748b;
                --success: #22c55e;
                --warning: #f59e0b;
                --danger: #ef4444;
                --bg-primary: #ffffff;
                --bg-secondary: #f8fafc;
                --bg-tertiary: #f1f5f9;
                --text-primary: #1e293b;
                --text-secondary: #64748b;
                --text-muted: #94a3b8;
                --border: #e2e8f0;
                --shadow-sm: 0 1px 2px rgba(0,0,0,0.05);
                --shadow-md: 0 4px 6px -1px rgba(0,0,0,0.1);
                --shadow-lg: 0 10px 15px -3px rgba(0,0,0,0.1);
                --radius-sm: 6px;
                --radius-md: 10px;
                --radius-lg: 16px;
            }
            
            body {
                font-family: 'Inter', -apple-system, BlinkMacSystemFont, sans-serif;
                background: var(--bg-secondary);
                color: var(--text-primary);
                line-height: 1.5;
            }
            
            .app-container {
                display: flex;
                min-height: 100vh;
            }
            
            /* Sidebar */
            .sidebar {
                width: 260px;
                background: var(--bg-primary);
                border-right: 1px solid var(--border);
                display: flex;
                flex-direction: column;
                position: fixed;
                height: 100vh;
                z-index: 100;
            }
            
            .sidebar-header {
                padding: 24px;
                border-bottom: 1px solid var(--border);
            }
            
            .logo {
                display: flex;
                align-items: center;
                gap: 12px;
                font-size: 22px;
                font-weight: 700;
                color: var(--primary);
            }
            
            .logo i {
                font-size: 28px;
            }
            
            .sidebar-nav {
                flex: 1;
                padding: 16px 12px;
            }
            
            .nav-item {
                display: flex;
                align-items: center;
                gap: 12px;
                padding: 12px 16px;
                color: var(--text-secondary);
                text-decoration: none;
                border-radius: var(--radius-md);
                margin-bottom: 4px;
                transition: all 0.2s;
            }
            
            .nav-item:hover {
                background: var(--bg-tertiary);
                color: var(--text-primary);
            }
            
            .nav-item.active {
                background: linear-gradient(135deg, var(--primary), var(--primary-dark));
                color: white;
            }
            
            .nav-item i {
                width: 20px;
                text-align: center;
            }
            
            .nav-divider {
                height: 1px;
                background: var(--border);
                margin: 16px 0;
            }
            
            .sidebar-footer {
                padding: 16px 20px;
                border-top: 1px solid var(--border);
            }
            
            .usage-info {
                font-size: 12px;
            }
            
            .usage-label {
                color: var(--text-muted);
            }
            
            .usage-bar {
                height: 6px;
                background: var(--bg-tertiary);
                border-radius: 3px;
                margin: 8px 0;
                overflow: hidden;
            }
            
            .usage-fill {
                height: 100%;
                background: linear-gradient(90deg, var(--primary), var(--primary-dark));
                border-radius: 3px;
            }
            
            .usage-text {
                color: var(--text-secondary);
            }
            
            /* Main Content */
            .main-content {
                flex: 1;
                margin-left: 260px;
                padding: 24px;
                min-height: 100vh;
            }
            
            /* Header */
            .page-header {
                display: flex;
                justify-content: space-between;
                align-items: center;
                margin-bottom: 24px;
            }
            
            .page-header h1 {
                font-size: 28px;
                font-weight: 700;
                color: var(--text-primary);
            }
            
            .page-header p {
                color: var(--text-secondary);
                margin-top: 4px;
            }
            
            .header-actions {
                display: flex;
                align-items: center;
                gap: 16px;
            }
            
            .search-box {
                display: flex;
                align-items: center;
                background: var(--bg-primary);
                border: 1px solid var(--border);
                border-radius: var(--radius-md);
                padding: 8px 16px;
                width: 280px;
            }
            
            .search-box i {
                color: var(--text-muted);
                margin-right: 10px;
            }
            
            .search-box input {
                border: none;
                outline: none;
                background: transparent;
                flex: 1;
                font-size: 14px;
            }
            
            .icon-btn {
                width: 40px;
                height: 40px;
                border: none;
                background: var(--bg-primary);
                border-radius: var(--radius-md);
                color: var(--text-secondary);
                cursor: pointer;
                position: relative;
                transition: all 0.2s;
            }
            
            .icon-btn:hover {
                background: var(--bg-tertiary);
                color: var(--primary);
            }
            
            .notification-badge {
                position: absolute;
                top: 6px;
                right: 6px;
                width: 18px;
                height: 18px;
                background: var(--danger);
                color: white;
                font-size: 10px;
                font-weight: 600;
                border-radius: 50%;
                display: flex;
                align-items: center;
                justify-content: center;
            }
            
            .user-menu img {
                width: 40px;
                height: 40px;
                border-radius: 50%;
                cursor: pointer;
            }
            
            /* Cards */
            .card {
                background: var(--bg-primary);
                border-radius: var(--radius-lg);
                box-shadow: var(--shadow-sm);
                border: 1px solid var(--border);
            }
            
            .card-header {
                display: flex;
                justify-content: space-between;
                align-items: center;
                padding: 16px 20px;
                border-bottom: 1px solid var(--border);
            }
            
            .card-header h3 {
                font-size: 15px;
                font-weight: 600;
                display: flex;
                align-items: center;
                gap: 10px;
            }
            
            .card-header h3 i {
                color: var(--primary);
            }
            
            .card-header a {
                color: var(--primary);
                text-decoration: none;
                font-size: 13px;
                font-weight: 500;
            }
            
            .card-body {
                padding: 20px;
            }
            
            /* Buttons */
            .btn {
                display: inline-flex;
                align-items: center;
                justify-content: center;
                gap: 8px;
                padding: 10px 20px;
                border-radius: var(--radius-md);
                font-size: 14px;
                font-weight: 500;
                cursor: pointer;
                transition: all 0.2s;
                border: none;
            }
            
            .btn.primary {
                background: linear-gradient(135deg, var(--primary), var(--primary-dark));
                color: white;
            }
            
            .btn.primary:hover {
                transform: translateY(-1px);
                box-shadow: 0 4px 12px rgba(99, 102, 241, 0.4);
            }
            
            .btn.secondary {
                background: var(--bg-tertiary);
                color: var(--text-primary);
            }
            
            .btn.secondary:hover {
                background: var(--border);
            }
            
            /* Empty State */
            .empty-state {
                text-align: center;
                padding: 40px;
                color: var(--text-muted);
            }
            
            .empty-state i {
                font-size: 48px;
                margin-bottom: 16px;
                opacity: 0.5;
            }
            
            .empty-state p {
                font-weight: 500;
                color: var(--text-secondary);
                margin-bottom: 8px;
            }
            
            /* Status Badges */
            .status-badge {
                display: inline-block;
                padding: 4px 10px;
                border-radius: 12px;
                font-size: 11px;
                font-weight: 600;
                text-transform: uppercase;
            }
            
            .status-badge.pending { background: #fef3c7; color: #92400e; }
            .status-badge.processing { background: #dbeafe; color: #1e40af; }
            .status-badge.completed { background: #dcfce7; color: #166534; }
            .status-badge.needs_review { background: #fed7aa; color: #9a3412; }
            .status-badge.error { background: #fee2e2; color: #991b1b; }
        `;
    }
    
    function getDashboardStyles() {
        return `
            /* Quick Actions */
            .quick-actions {
                display: flex;
                gap: 12px;
                margin-bottom: 24px;
            }
            
            .action-btn {
                display: inline-flex;
                align-items: center;
                gap: 10px;
                padding: 14px 24px;
                border-radius: var(--radius-md);
                font-size: 14px;
                font-weight: 500;
                cursor: pointer;
                border: none;
                transition: all 0.2s;
            }
            
            .action-btn.primary {
                background: linear-gradient(135deg, var(--primary), var(--primary-dark));
                color: white;
            }
            
            .action-btn.primary:hover {
                transform: translateY(-2px);
                box-shadow: 0 8px 16px rgba(99, 102, 241, 0.3);
            }
            
            .action-btn.secondary {
                background: var(--bg-primary);
                border: 1px solid var(--border);
                color: var(--text-primary);
            }
            
            .action-btn.secondary:hover {
                border-color: var(--primary);
                color: var(--primary);
            }
            
            .action-btn .badge {
                background: var(--danger);
                color: white;
                padding: 2px 8px;
                border-radius: 10px;
                font-size: 11px;
            }
            
            /* Stats Grid */
            .stats-grid {
                display: grid;
                grid-template-columns: repeat(4, 1fr);
                gap: 20px;
                margin-bottom: 24px;
            }
            
            .stat-card {
                background: var(--bg-primary);
                border-radius: var(--radius-lg);
                padding: 20px;
                display: flex;
                align-items: flex-start;
                gap: 16px;
                border: 1px solid var(--border);
                transition: all 0.2s;
            }
            
            .stat-card:hover {
                transform: translateY(-2px);
                box-shadow: var(--shadow-md);
            }
            
            .stat-icon {
                width: 48px;
                height: 48px;
                border-radius: var(--radius-md);
                display: flex;
                align-items: center;
                justify-content: center;
                font-size: 20px;
            }
            
            .stat-icon.blue { background: #e0e7ff; color: var(--primary); }
            .stat-icon.green { background: #dcfce7; color: var(--success); }
            .stat-icon.orange { background: #fef3c7; color: var(--warning); }
            .stat-icon.purple { background: #ede9fe; color: #8b5cf6; }
            
            .stat-info {
                flex: 1;
            }
            
            .stat-value {
                display: block;
                font-size: 28px;
                font-weight: 700;
                color: var(--text-primary);
            }
            
            .stat-label {
                color: var(--text-muted);
                font-size: 13px;
            }
            
            .stat-trend {
                font-size: 12px;
                font-weight: 600;
            }
            
            .stat-trend.positive {
                color: var(--success);
            }
            
            .stat-trend .accuracy {
                color: var(--primary);
            }
            
            .stat-actions a {
                color: var(--primary);
                text-decoration: none;
                font-size: 13px;
            }
            
            .stat-period {
                font-size: 11px;
                color: var(--text-muted);
            }
            
            /* Content Grid */
            .content-grid {
                display: grid;
                grid-template-columns: 1.5fr 1fr;
                grid-template-rows: auto auto;
                gap: 20px;
            }
            
            .recent-docs {
                grid-row: span 2;
            }
            
            /* Document List */
            .doc-list {
                display: flex;
                flex-direction: column;
                gap: 12px;
            }
            
            .doc-item {
                display: flex;
                align-items: center;
                gap: 14px;
                padding: 12px;
                border-radius: var(--radius-md);
                cursor: pointer;
                transition: all 0.2s;
            }
            
            .doc-item:hover {
                background: var(--bg-tertiary);
            }
            
            .doc-icon {
                width: 40px;
                height: 40px;
                border-radius: var(--radius-sm);
                display: flex;
                align-items: center;
                justify-content: center;
                font-size: 16px;
            }
            
            .doc-icon.invoice { background: #e0e7ff; color: var(--primary); }
            .doc-icon.receipt { background: #dcfce7; color: var(--success); }
            .doc-icon.expense_report { background: #fef3c7; color: var(--warning); }
            .doc-icon.credit_memo { background: #fee2e2; color: var(--danger); }
            
            .doc-info {
                flex: 1;
            }
            
            .doc-name {
                display: block;
                font-weight: 500;
                color: var(--text-primary);
            }
            
            .doc-meta {
                font-size: 12px;
                color: var(--text-muted);
            }
            
            .doc-amount {
                font-weight: 600;
                color: var(--text-primary);
            }
            
            .confidence-indicator {
                width: 40px;
                height: 4px;
                background: var(--bg-tertiary);
                border-radius: 2px;
                overflow: hidden;
            }
            
            .confidence-fill {
                height: 100%;
                width: var(--confidence);
                border-radius: 2px;
            }
            
            .confidence-fill.high { background: var(--success); }
            .confidence-fill.medium { background: var(--warning); }
            .confidence-fill.low { background: var(--danger); }
            
            /* Anomaly Section */
            .alert-count {
                background: var(--bg-tertiary);
                padding: 4px 10px;
                border-radius: 12px;
                font-size: 12px;
                font-weight: 600;
            }
            
            .alert-count.has-alerts {
                background: #fee2e2;
                color: var(--danger);
            }
            
            .anomaly-list {
                display: flex;
                flex-direction: column;
                gap: 10px;
            }
            
            .anomaly-item {
                display: flex;
                align-items: center;
                gap: 12px;
                padding: 12px;
                border-radius: var(--radius-md);
                border-left: 3px solid;
            }
            
            .anomaly-item.high {
                background: #fef2f2;
                border-color: var(--danger);
            }
            
            .anomaly-item.medium {
                background: #fffbeb;
                border-color: var(--warning);
            }
            
            .anomaly-item.low {
                background: #f0fdf4;
                border-color: var(--success);
            }
            
            .anomaly-icon {
                width: 32px;
                height: 32px;
                border-radius: 50%;
                display: flex;
                align-items: center;
                justify-content: center;
                font-size: 14px;
            }
            
            .anomaly-item.high .anomaly-icon { background: #fee2e2; color: var(--danger); }
            .anomaly-item.medium .anomaly-icon { background: #fef3c7; color: var(--warning); }
            
            .anomaly-info {
                flex: 1;
            }
            
            .anomaly-title {
                display: block;
                font-weight: 500;
                font-size: 13px;
            }
            
            .anomaly-desc {
                font-size: 12px;
                color: var(--text-secondary);
            }
            
            .anomaly-action {
                padding: 6px 12px;
                background: transparent;
                border: 1px solid var(--border);
                border-radius: var(--radius-sm);
                font-size: 12px;
                cursor: pointer;
            }
            
            /* Chart Styles */
            .chart-period-selector {
                display: flex;
                gap: 4px;
            }
            
            .period-btn {
                padding: 4px 10px;
                border: none;
                background: transparent;
                color: var(--text-muted);
                font-size: 12px;
                cursor: pointer;
                border-radius: var(--radius-sm);
            }
            
            .period-btn.active {
                background: var(--primary);
                color: white;
            }
            
            .breakdown-legend {
                margin-top: 20px;
            }
            
            .legend-item {
                display: flex;
                align-items: center;
                gap: 10px;
                padding: 8px 0;
                border-bottom: 1px solid var(--border);
            }
            
            .legend-color {
                width: 12px;
                height: 12px;
                border-radius: 3px;
            }
            
            .legend-label {
                flex: 1;
                font-size: 13px;
            }
            
            .legend-value {
                font-weight: 600;
                font-size: 13px;
            }
        `;
    }
    
    function getUploadStyles() {
        return `
            .upload-container {
                max-width: 900px;
                margin: 0 auto;
            }
            
            /* Type Selector */
            .type-selector {
                display: flex;
                gap: 12px;
                margin-bottom: 24px;
            }
            
            .type-option {
                flex: 1;
                display: flex;
                flex-direction: column;
                align-items: center;
                padding: 16px;
                background: var(--bg-primary);
                border: 2px solid var(--border);
                border-radius: var(--radius-lg);
                cursor: pointer;
                transition: all 0.2s;
            }
            
            .type-option input {
                display: none;
            }
            
            .type-option:hover {
                border-color: var(--primary);
            }
            
            .type-option.active {
                border-color: var(--primary);
                background: linear-gradient(180deg, #f5f3ff 0%, var(--bg-primary) 100%);
            }
            
            .type-icon {
                width: 48px;
                height: 48px;
                background: var(--bg-tertiary);
                border-radius: var(--radius-md);
                display: flex;
                align-items: center;
                justify-content: center;
                font-size: 20px;
                color: var(--text-secondary);
                margin-bottom: 10px;
            }
            
            .type-option.active .type-icon {
                background: var(--primary);
                color: white;
            }
            
            .type-label {
                font-weight: 600;
                font-size: 13px;
                margin-bottom: 4px;
            }
            
            .type-desc {
                font-size: 11px;
                color: var(--text-muted);
                text-align: center;
            }
            
            /* Upload Zone */
            .upload-zone {
                background: var(--bg-primary);
                border: 2px dashed var(--border);
                border-radius: var(--radius-lg);
                padding: 60px 40px;
                text-align: center;
                transition: all 0.3s;
                cursor: pointer;
                position: relative;
                min-height: 300px;
            }
            
            .upload-zone:hover, .upload-zone.dragover {
                border-color: var(--primary);
                background: linear-gradient(180deg, #f5f3ff 0%, var(--bg-primary) 100%);
            }
            
            .upload-icon {
                width: 80px;
                height: 80px;
                background: linear-gradient(135deg, var(--primary), var(--primary-dark));
                border-radius: 50%;
                display: flex;
                align-items: center;
                justify-content: center;
                margin: 0 auto 24px;
                font-size: 32px;
                color: white;
            }
            
            .upload-content h2 {
                font-size: 22px;
                margin-bottom: 8px;
            }
            
            .upload-content p {
                color: var(--text-muted);
                margin-bottom: 20px;
            }
            
            .supported-formats {
                display: flex;
                align-items: center;
                justify-content: center;
                gap: 8px;
                font-size: 13px;
                color: var(--text-secondary);
            }
            
            .format-badge {
                padding: 4px 10px;
                background: var(--bg-tertiary);
                border-radius: var(--radius-sm);
                font-size: 11px;
                font-weight: 600;
            }
            
            /* Upload Progress */
            .upload-progress {
                position: absolute;
                inset: 0;
                background: var(--bg-primary);
                display: flex;
                align-items: center;
                justify-content: center;
                border-radius: inherit;
            }
            
            .progress-content {
                text-align: center;
            }
            
            .spinner {
                width: 50px;
                height: 50px;
                border: 4px solid var(--bg-tertiary);
                border-top-color: var(--primary);
                border-radius: 50%;
                margin: 0 auto 20px;
                animation: spin 1s linear infinite;
            }
            
            @keyframes spin {
                to { transform: rotate(360deg); }
            }
            
            .progress-bar {
                width: 200px;
                height: 6px;
                background: var(--bg-tertiary);
                border-radius: 3px;
                margin: 20px auto 0;
                overflow: hidden;
            }
            
            .progress-fill {
                height: 100%;
                background: linear-gradient(90deg, var(--primary), var(--primary-dark));
                border-radius: 3px;
                transition: width 0.3s;
            }
            
            /* Upload Queue */
            .upload-queue {
                background: var(--bg-primary);
                border: 1px solid var(--border);
                border-radius: var(--radius-lg);
                margin-top: 24px;
            }
            
            .queue-header {
                display: flex;
                justify-content: space-between;
                align-items: center;
                padding: 16px 20px;
                border-bottom: 1px solid var(--border);
            }
            
            .queue-header h3 {
                font-size: 15px;
                font-weight: 600;
            }
            
            .btn-clear {
                background: none;
                border: none;
                color: var(--danger);
                cursor: pointer;
                font-size: 13px;
            }
            
            .queue-list {
                max-height: 300px;
                overflow-y: auto;
            }
            
            .queue-item {
                display: flex;
                align-items: center;
                gap: 12px;
                padding: 12px 20px;
                border-bottom: 1px solid var(--border);
            }
            
            .queue-item:last-child {
                border-bottom: none;
            }
            
            .queue-actions {
                display: flex;
                justify-content: space-between;
                padding: 16px 20px;
                border-top: 1px solid var(--border);
            }
            
            /* Camera & Email */
            .camera-capture {
                margin-top: 24px;
                text-align: center;
            }
            
            .camera-btn {
                display: inline-flex;
                align-items: center;
                gap: 10px;
                padding: 12px 24px;
                background: var(--bg-primary);
                border: 1px solid var(--border);
                border-radius: var(--radius-lg);
                font-size: 14px;
                cursor: pointer;
            }
            
            .email-import {
                margin-top: 24px;
                background: linear-gradient(90deg, #eef2ff 0%, #e0e7ff 100%);
                border-radius: var(--radius-lg);
                padding: 16px 20px;
            }
            
            .email-info {
                display: flex;
                align-items: center;
                gap: 16px;
            }
            
            .email-info i {
                font-size: 24px;
                color: var(--primary);
            }
            
            .email-text h4 {
                font-size: 14px;
                margin-bottom: 4px;
            }
            
            .email-text p {
                font-size: 13px;
                color: var(--text-secondary);
            }
        `;
    }
    
    function getReviewStyles() {
        return `
            .review-mode {
                padding: 0;
                display: flex;
                flex-direction: column;
                height: 100vh;
            }
            
            .review-header {
                display: flex;
                justify-content: space-between;
                align-items: center;
                padding: 16px 24px;
                background: var(--bg-primary);
                border-bottom: 1px solid var(--border);
            }
            
            .review-nav {
                display: flex;
                align-items: center;
                gap: 24px;
            }
            
            .nav-btn {
                display: inline-flex;
                align-items: center;
                gap: 8px;
                padding: 8px 14px;
                background: var(--bg-tertiary);
                border: none;
                border-radius: var(--radius-sm);
                font-size: 13px;
                cursor: pointer;
            }
            
            .nav-btn:disabled {
                opacity: 0.5;
                cursor: not-allowed;
            }
            
            .doc-nav {
                display: flex;
                align-items: center;
                gap: 10px;
            }
            
            .doc-position {
                font-size: 13px;
                color: var(--text-secondary);
            }
            
            .review-actions {
                display: flex;
                gap: 12px;
            }
            
            .review-actions .action-btn {
                padding: 10px 24px;
                border-radius: var(--radius-md);
                font-weight: 500;
                cursor: pointer;
                border: none;
            }
            
            .action-btn.reject {
                background: var(--bg-tertiary);
                color: var(--danger);
            }
            
            .action-btn.approve {
                background: linear-gradient(135deg, var(--success), #16a34a);
                color: white;
            }
            
            /* Review Container */
            .review-container {
                flex: 1;
                display: flex;
                overflow: hidden;
            }
            
            /* Document Preview */
            .document-preview {
                flex: 1;
                display: flex;
                flex-direction: column;
                background: #1e1e2d;
            }
            
            .preview-toolbar {
                display: flex;
                gap: 8px;
                padding: 12px;
                background: #171723;
            }
            
            .tool-btn {
                width: 36px;
                height: 36px;
                background: rgba(255,255,255,0.1);
                border: none;
                border-radius: var(--radius-sm);
                color: white;
                cursor: pointer;
            }
            
            .tool-btn:hover {
                background: rgba(255,255,255,0.2);
            }
            
            .preview-frame {
                flex: 1;
                padding: 20px;
                overflow: auto;
            }
            
            .preview-frame iframe {
                width: 100%;
                height: 100%;
                background: white;
                border: none;
                border-radius: var(--radius-md);
            }
            
            .page-nav {
                display: flex;
                align-items: center;
                justify-content: center;
                gap: 16px;
                padding: 12px;
                background: #171723;
                color: white;
            }
            
            .page-nav button {
                background: rgba(255,255,255,0.1);
                border: none;
                padding: 8px 12px;
                border-radius: var(--radius-sm);
                color: white;
                cursor: pointer;
            }
            
            /* Extraction Panel */
            .extraction-panel {
                width: 480px;
                background: var(--bg-primary);
                border-left: 1px solid var(--border);
                overflow-y: auto;
            }
            
            /* Confidence Banner */
            .confidence-banner {
                padding: 16px 20px;
                border-bottom: 1px solid var(--border);
            }
            
            .confidence-banner.high { background: linear-gradient(90deg, #f0fdf4 0%, var(--bg-primary) 100%); }
            .confidence-banner.medium { background: linear-gradient(90deg, #fffbeb 0%, var(--bg-primary) 100%); }
            .confidence-banner.low { background: linear-gradient(90deg, #fef2f2 0%, var(--bg-primary) 100%); }
            
            .confidence-score {
                display: flex;
                align-items: center;
                gap: 16px;
            }
            
            .score-circle {
                width: 56px;
                height: 56px;
            }
            
            .score-circle svg {
                transform: rotate(-90deg);
            }
            
            .score-bg {
                fill: none;
                stroke: var(--bg-tertiary);
                stroke-width: 3;
            }
            
            .score-fill {
                fill: none;
                stroke-width: 3;
                stroke-linecap: round;
            }
            
            .confidence-banner.high .score-fill { stroke: var(--success); }
            .confidence-banner.medium .score-fill { stroke: var(--warning); }
            .confidence-banner.low .score-fill { stroke: var(--danger); }
            
            .score-text {
                fill: var(--text-primary);
                font-size: 9px;
                font-weight: 600;
                text-anchor: middle;
            }
            
            .score-label .label-title {
                display: block;
                font-weight: 600;
                font-size: 14px;
            }
            
            .score-label .label-desc {
                font-size: 12px;
                color: var(--text-secondary);
            }
            
            /* Anomaly Warnings */
            .anomaly-warnings {
                padding: 12px 20px;
                background: #fef2f2;
                border-bottom: 1px solid var(--border);
            }
            
            .warning-item {
                display: flex;
                align-items: center;
                gap: 10px;
                padding: 8px 0;
                font-size: 13px;
            }
            
            .warning-item i {
                color: var(--danger);
            }
            
            /* Extracted Fields */
            .extracted-fields, .amount-fields, .line-items-section, .additional-options {
                padding: 16px 20px;
                border-bottom: 1px solid var(--border);
            }
            
            .extracted-fields h3, .amount-fields h3, .line-items-section h3, .additional-options h3 {
                font-size: 14px;
                margin-bottom: 16px;
                color: var(--text-secondary);
            }
            
            .field-group {
                margin-bottom: 14px;
            }
            
            .field-group label {
                display: block;
                font-size: 12px;
                color: var(--text-muted);
                margin-bottom: 6px;
            }
            
            .field-wrapper {
                display: flex;
                gap: 10px;
            }
            
            .field-input {
                flex: 1;
                padding: 10px 12px;
                border: 1px solid var(--border);
                border-radius: var(--radius-sm);
                font-size: 14px;
            }
            
            .field-input:focus {
                outline: none;
                border-color: var(--primary);
            }
            
            .confidence-badge {
                width: 48px;
                height: 6px;
                background: var(--bg-tertiary);
                border-radius: 3px;
                overflow: hidden;
                align-self: center;
            }
            
            .conf-fill {
                height: 100%;
                border-radius: 3px;
            }
            
            .confidence-badge.high .conf-fill { background: var(--success); }
            .confidence-badge.medium .conf-fill { background: var(--warning); }
            .confidence-badge.low .conf-fill { background: var(--danger); }
            
            /* Smart Select */
            .smart-select {
                position: relative;
                flex: 1;
            }
            
            .suggestions-dropdown {
                position: absolute;
                top: 100%;
                left: 0;
                right: 0;
                background: var(--bg-primary);
                border: 1px solid var(--border);
                border-radius: var(--radius-sm);
                margin-top: 4px;
                box-shadow: var(--shadow-lg);
                display: none;
                z-index: 10;
            }
            
            .smart-select:focus-within .suggestions-dropdown {
                display: block;
            }
            
            .suggestion-item {
                display: flex;
                justify-content: space-between;
                padding: 10px 12px;
                cursor: pointer;
            }
            
            .suggestion-item:hover {
                background: var(--bg-tertiary);
            }
            
            .suggestion-name {
                font-weight: 500;
            }
            
            .suggestion-match {
                font-size: 12px;
                color: var(--success);
            }
            
            /* Amount Fields */
            .amount-grid {
                display: grid;
                grid-template-columns: repeat(3, 1fr);
                gap: 12px;
            }
            
            .amount-field label {
                display: block;
                font-size: 12px;
                color: var(--text-muted);
                margin-bottom: 6px;
            }
            
            .amount-input-wrapper {
                display: flex;
                align-items: center;
                border: 1px solid var(--border);
                border-radius: var(--radius-sm);
                overflow: hidden;
            }
            
            .currency-symbol {
                padding: 10px 12px;
                background: var(--bg-tertiary);
                color: var(--text-secondary);
                font-size: 14px;
            }
            
            .amount-input-wrapper input {
                flex: 1;
                padding: 10px 12px;
                border: none;
                font-size: 14px;
                text-align: right;
            }
            
            .amount-field.highlight .amount-input-wrapper {
                border-color: var(--primary);
                background: #f5f3ff;
            }
            
            .amount-warning {
                margin-top: 12px;
                padding: 10px 12px;
                background: #fef3c7;
                border-radius: var(--radius-sm);
                font-size: 12px;
                display: flex;
                align-items: center;
                gap: 8px;
            }
            
            .amount-warning i {
                color: var(--warning);
            }
            
            /* Line Items */
            .section-header {
                display: flex;
                justify-content: space-between;
                align-items: center;
                margin-bottom: 12px;
            }
            
            .btn-add {
                padding: 6px 12px;
                background: var(--bg-tertiary);
                border: none;
                border-radius: var(--radius-sm);
                font-size: 12px;
                cursor: pointer;
                display: flex;
                align-items: center;
                gap: 6px;
            }
            
            .line-items-table {
                border: 1px solid var(--border);
                border-radius: var(--radius-sm);
            }
            
            .table-header {
                display: grid;
                grid-template-columns: 1fr 60px 80px 80px 40px;
                gap: 8px;
                padding: 10px 12px;
                background: var(--bg-tertiary);
                font-size: 11px;
                font-weight: 600;
                color: var(--text-muted);
                text-transform: uppercase;
            }
            
            .line-item {
                display: grid;
                grid-template-columns: 1fr 60px 80px 80px 40px;
                gap: 8px;
                padding: 8px 12px;
                border-top: 1px solid var(--border);
                align-items: center;
            }
            
            .line-item input {
                padding: 6px 8px;
                border: 1px solid var(--border);
                border-radius: var(--radius-sm);
                font-size: 12px;
            }
            
            .line-item .col-actions {
                background: none;
                border: none;
                color: var(--text-muted);
                cursor: pointer;
            }
            
            .line-item .col-actions:hover {
                color: var(--danger);
            }
            
            .table-footer {
                display: flex;
                justify-content: flex-end;
                gap: 12px;
                padding: 12px;
                background: var(--bg-tertiary);
                border-top: 1px solid var(--border);
            }
            
            .line-total-label {
                font-size: 13px;
                color: var(--text-secondary);
            }
            
            .line-total-value {
                font-weight: 600;
            }
            
            /* Options */
            .option-group {
                margin-bottom: 12px;
            }
            
            .checkbox-label {
                display: flex;
                align-items: center;
                gap: 10px;
                font-size: 13px;
                cursor: pointer;
            }
            
            .checkbox-label input {
                width: 16px;
                height: 16px;
            }
        `;
    }
    
    function getDashboardScript(stats) {
        return `
            function navigateTo(action) {
                window.location.href = window.location.pathname + '?action=' + action;
            }
            
            function reviewDocument(docId) {
                window.location.href = window.location.pathname + '?action=review&docId=' + docId;
            }
            
            // Initialize Charts
            document.addEventListener('DOMContentLoaded', function() {
                // Performance Chart
                const perfCtx = document.getElementById('performanceChart');
                if (perfCtx) {
                    new Chart(perfCtx, {
                        type: 'line',
                        data: {
                            labels: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'],
                            datasets: [{
                                label: 'Documents Processed',
                                data: [32, 45, 28, 62, 54, 18, 24],
                                borderColor: '#6366f1',
                                backgroundColor: 'rgba(99, 102, 241, 0.1)',
                                fill: true,
                                tension: 0.4
                            }]
                        },
                        options: {
                            responsive: true,
                            plugins: {
                                legend: { display: false }
                            },
                            scales: {
                                y: { beginAtZero: true }
                            }
                        }
                    });
                }
                
                // Doc Type Chart
                const typeCtx = document.getElementById('docTypeChart');
                if (typeCtx) {
                    new Chart(typeCtx, {
                        type: 'doughnut',
                        data: {
                            labels: ${JSON.stringify(stats.byType.map(t => t.name))},
                            datasets: [{
                                data: ${JSON.stringify(stats.byType.map(t => t.count))},
                                backgroundColor: ['#6366f1', '#22c55e', '#f59e0b', '#ef4444']
                            }]
                        },
                        options: {
                            responsive: true,
                            plugins: {
                                legend: { display: false }
                            },
                            cutout: '65%'
                        }
                    });
                }
            });
        `;
    }
    
    function getUploadScript(endpoint) {
        return `
            const uploadZone = document.getElementById('uploadZone');
            const fileInput = document.getElementById('fileInput');
            const uploadQueue = document.getElementById('uploadQueue');
            const queueList = document.getElementById('queueList');
            const uploadProgress = document.getElementById('uploadProgress');
            let files = [];
            
            function navigateTo(action) {
                window.location.href = window.location.pathname + '?action=' + action;
            }
            
            // Drag and drop handlers
            uploadZone.addEventListener('click', () => fileInput.click());
            
            uploadZone.addEventListener('dragover', (e) => {
                e.preventDefault();
                uploadZone.classList.add('dragover');
            });
            
            uploadZone.addEventListener('dragleave', () => {
                uploadZone.classList.remove('dragover');
            });
            
            uploadZone.addEventListener('drop', (e) => {
                e.preventDefault();
                uploadZone.classList.remove('dragover');
                handleFiles(e.dataTransfer.files);
            });
            
            fileInput.addEventListener('change', (e) => {
                handleFiles(e.target.files);
            });
            
            function handleFiles(fileList) {
                const newFiles = Array.from(fileList);
                files = [...files, ...newFiles];
                updateQueue();
            }
            
            function updateQueue() {
                if (files.length === 0) {
                    uploadQueue.hidden = true;
                    return;
                }
                
                uploadQueue.hidden = false;
                queueList.innerHTML = files.map((file, i) => \`
                    <div class="queue-item">
                        <i class="fas fa-file-pdf" style="color: #ef4444;"></i>
                        <div style="flex:1;">
                            <div style="font-weight: 500;">\${file.name}</div>
                            <div style="font-size: 12px; color: var(--text-muted);">\${(file.size / 1024).toFixed(1)} KB</div>
                        </div>
                        <button onclick="removeFile(\${i})" style="background:none;border:none;cursor:pointer;color:var(--text-muted);">
                            <i class="fas fa-times"></i>
                        </button>
                    </div>
                \`).join('');
                
                document.getElementById('fileCount').textContent = files.length;
            }
            
            function removeFile(index) {
                files.splice(index, 1);
                updateQueue();
            }
            
            function clearQueue() {
                files = [];
                updateQueue();
            }
            
            function addMoreFiles() {
                fileInput.click();
            }
            
            async function processQueue() {
                const docType = document.querySelector('input[name="docType"]:checked').value;
                
                uploadProgress.hidden = false;
                
                for (let i = 0; i < files.length; i++) {
                    document.getElementById('progressText').textContent = \`Processing \${i + 1} of \${files.length}...\`;
                    document.getElementById('progressBar').style.width = ((i + 1) / files.length * 100) + '%';
                    
                    const formData = new FormData();
                    formData.append('file', files[i]);
                    formData.append('docType', docType);
                    
                    try {
                        await fetch('${endpoint}?action=upload', {
                            method: 'POST',
                            body: formData
                        });
                    } catch (err) {
                        console.error('Upload error:', err);
                    }
                }
                
                window.location.href = window.location.pathname + '?action=queue';
            }
            
            // Type selector
            document.querySelectorAll('.type-option').forEach(opt => {
                opt.addEventListener('click', () => {
                    document.querySelectorAll('.type-option').forEach(o => o.classList.remove('active'));
                    opt.classList.add('active');
                });
            });
            
            function openCamera() {
                // Mobile camera implementation
                const input = document.createElement('input');
                input.type = 'file';
                input.accept = 'image/*';
                input.capture = 'environment';
                input.onchange = (e) => handleFiles(e.target.files);
                input.click();
            }
        `;
    }
    
    function getReviewScript(documentId, docData) {
        return `
            let currentZoom = 1;
            let currentRotation = 0;
            const documentId = ${documentId};
            const documentData = ${JSON.stringify(docData)};
            
            function navigateTo(action) {
                window.location.href = window.location.pathname + '?action=' + action;
            }
            
            function prevDocument() {
                if (documentData.prevId) {
                    window.location.href = window.location.pathname + '?action=review&docId=' + documentData.prevId;
                }
            }
            
            function nextDocument() {
                if (documentData.nextId) {
                    window.location.href = window.location.pathname + '?action=review&docId=' + documentData.nextId;
                }
            }
            
            function zoomIn() {
                currentZoom = Math.min(currentZoom + 0.25, 3);
                document.getElementById('docPreview').style.transform = \`scale(\${currentZoom}) rotate(\${currentRotation}deg)\`;
            }
            
            function zoomOut() {
                currentZoom = Math.max(currentZoom - 0.25, 0.5);
                document.getElementById('docPreview').style.transform = \`scale(\${currentZoom}) rotate(\${currentRotation}deg)\`;
            }
            
            function rotateDoc() {
                currentRotation = (currentRotation + 90) % 360;
                document.getElementById('docPreview').style.transform = \`scale(\${currentZoom}) rotate(\${currentRotation}deg)\`;
            }
            
            function downloadOriginal() {
                // Download original document
            }
            
            function onFieldChange(fieldId) {
                console.log('Field changed:', fieldId, document.getElementById(fieldId).value);
            }
            
            function onAmountChange(fieldId) {
                updateLineItemsTotal();
            }
            
            function selectSuggestion(fieldId, id, name) {
                document.getElementById(fieldId).value = name;
                document.getElementById(fieldId).dataset.vendorId = id;
            }
            
            function addLineItem() {
                const tbody = document.getElementById('lineItemsBody');
                const index = tbody.children.length;
                const html = \`
                    <div class="line-item" data-index="\${index}">
                        <input type="text" class="col-desc" placeholder="Description">
                        <input type="number" class="col-qty" value="1" step="1" min="0">
                        <input type="number" class="col-rate" value="0.00" step="0.01">
                        <input type="number" class="col-amount" value="0.00" step="0.01">
                        <button class="col-actions" onclick="removeLineItem(\${index})">
                            <i class="fas fa-trash"></i>
                        </button>
                    </div>
                \`;
                tbody.insertAdjacentHTML('beforeend', html);
            }
            
            function removeLineItem(index) {
                const item = document.querySelector('.line-item[data-index="' + index + '"]');
                if (item) item.remove();
                updateLineItemsTotal();
            }
            
            function updateLineItemsTotal() {
                let total = 0;
                document.querySelectorAll('.line-item .col-amount').forEach(input => {
                    total += parseFloat(input.value) || 0;
                });
                document.getElementById('lineItemsTotal').textContent = '$' + total.toFixed(2);
            }
            
            async function approveDocument(docId) {
                const data = collectFormData();
                
                try {
                    const response = await fetch(window.location.pathname.replace(/\\/app\\/.*/, '/app/site/hosting/restlet.nl?script=customscript_dm_api&deploy=customdeploy_dm_api'), {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ action: 'approve', documentId: docId, data })
                    });
                    
                    const result = await response.json();
                    
                    if (result.success) {
                        alert('Transaction created: ' + result.tranId);
                        nextDocument();
                    } else {
                        alert('Error: ' + result.error);
                    }
                } catch (err) {
                    alert('Error creating transaction');
                }
            }
            
            async function rejectDocument(docId) {
                if (!confirm('Are you sure you want to reject this document?')) return;
                
                try {
                    await fetch(window.location.pathname.replace(/\\/app\\/.*/, '/app/site/hosting/restlet.nl?script=customscript_dm_api&deploy=customdeploy_dm_api'), {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ action: 'reject', documentId: docId })
                    });
                    
                    nextDocument();
                } catch (err) {
                    alert('Error rejecting document');
                }
            }
            
            function collectFormData() {
                return {
                    documentType: document.getElementById('documentType').value,
                    vendorName: document.getElementById('vendorName').value,
                    vendorId: document.getElementById('vendorName').dataset.vendorId,
                    invoiceNumber: document.getElementById('invoiceNumber').value,
                    invoiceDate: document.getElementById('invoiceDate').value,
                    dueDate: document.getElementById('dueDate').value,
                    poNumber: document.getElementById('poNumber').value,
                    currency: document.getElementById('currency').value,
                    subtotal: parseFloat(document.getElementById('subtotal').value) || 0,
                    taxAmount: parseFloat(document.getElementById('taxAmount').value) || 0,
                    totalAmount: parseFloat(document.getElementById('totalAmount').value) || 0,
                    lineItems: collectLineItems(),
                    autoApprove: document.getElementById('autoApprove').checked,
                    attachOriginal: document.getElementById('attachOriginal').checked
                };
            }
            
            function collectLineItems() {
                const items = [];
                document.querySelectorAll('.line-item').forEach(row => {
                    items.push({
                        description: row.querySelector('.col-desc').value,
                        quantity: parseFloat(row.querySelector('.col-qty').value) || 0,
                        unitPrice: parseFloat(row.querySelector('.col-rate').value) || 0,
                        amount: parseFloat(row.querySelector('.col-amount').value) || 0
                    });
                });
                return items;
            }
            
            // Auto-calculate amounts
            document.addEventListener('input', (e) => {
                if (e.target.classList.contains('col-qty') || e.target.classList.contains('col-rate')) {
                    const row = e.target.closest('.line-item');
                    const qty = parseFloat(row.querySelector('.col-qty').value) || 0;
                    const rate = parseFloat(row.querySelector('.col-rate').value) || 0;
                    row.querySelector('.col-amount').value = (qty * rate).toFixed(2);
                    updateLineItemsTotal();
                }
            });
        `;
    }
    
    // Placeholders for other page renderers
    function renderReviewQueue(context) {
        context.response.write('<html><body><h1>Review Queue - Coming Soon</h1></body></html>');
    }
    
    function renderProcessingQueue(context) {
        context.response.write('<html><body><h1>Processing Queue - Coming Soon</h1></body></html>');
    }
    
    function renderAnalytics(context) {
        context.response.write('<html><body><h1>Analytics - Coming Soon</h1></body></html>');
    }
    
    function renderSettings(context) {
        context.response.write('<html><body><h1>Settings - Coming Soon</h1></body></html>');
    }
    
    function renderBatchUpload(context) {
        context.response.write('<html><body><h1>Batch Upload - Coming Soon</h1></body></html>');
    }
    
    return { onRequest };
});
