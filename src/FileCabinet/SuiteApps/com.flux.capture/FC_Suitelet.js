/**
 * @NApiVersion 2.1
 * @NScriptType Suitelet
 * @NModuleScope SameAccount
 *
 * Flux Capture - Main Suitelet
 * Single Suitelet handling all UI: Dashboard, Upload, Review, Queue, Settings
 * Includes embedded client-side code for simplified deployment
 */

define([
    'N/ui/serverWidget',
    'N/runtime',
    'N/search',
    'N/file',
    'N/record',
    'N/url',
    'N/query'
], function(serverWidget, runtime, search, file, record, url, query) {

    'use strict';

    // ==================== Main Entry Point ====================

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
                    renderQueuePage(context);
                    break;
                case 'batch':
                    renderBatchPage(context);
                    break;
                case 'settings':
                    renderSettingsPage(context);
                    break;
                default:
                    renderDashboard(context);
            }
        } catch (error) {
            log.error('Suitelet Error', error);
            response.write(renderErrorPage(error.message));
        }
    }

    // ==================== Dashboard ====================

    function renderDashboard(context) {
        const stats = getDashboardStats();
        const recentDocs = getRecentDocuments(8);
        const anomalies = getRecentAnomalies(5);

        const html = `
<!DOCTYPE html>
<html lang="en">
<head>
    ${renderHead('Dashboard')}
</head>
<body>
    <div class="app-container">
        ${renderSidebar('dashboard')}
        <main class="main-content">
            ${renderHeader('Dashboard', 'AI-Powered Document Intelligence')}

            <div class="quick-actions">
                <button class="action-btn primary" onclick="navigate('upload')">
                    <i class="fas fa-cloud-upload-alt"></i> Upload Documents
                </button>
                <button class="action-btn" onclick="navigate('queue')">
                    <i class="fas fa-tasks"></i> Processing Queue
                    ${stats.pending > 0 ? `<span class="badge">${stats.pending}</span>` : ''}
                </button>
            </div>

            <div class="stats-grid">
                <div class="stat-card">
                    <div class="stat-icon blue"><i class="fas fa-file-invoice"></i></div>
                    <div class="stat-info">
                        <span class="stat-value">${stats.total}</span>
                        <span class="stat-label">Documents Processed</span>
                    </div>
                </div>
                <div class="stat-card">
                    <div class="stat-icon green"><i class="fas fa-check-circle"></i></div>
                    <div class="stat-info">
                        <span class="stat-value">${stats.completed}</span>
                        <span class="stat-label">Completed</span>
                    </div>
                    <span class="stat-trend">${stats.autoRate}% auto-processed</span>
                </div>
                <div class="stat-card">
                    <div class="stat-icon orange"><i class="fas fa-clock"></i></div>
                    <div class="stat-info">
                        <span class="stat-value">${stats.pending}</span>
                        <span class="stat-label">Pending Review</span>
                    </div>
                    <a href="#" onclick="navigate('queue')" class="stat-link">Review Now →</a>
                </div>
                <div class="stat-card">
                    <div class="stat-icon purple"><i class="fas fa-dollar-sign"></i></div>
                    <div class="stat-info">
                        <span class="stat-value">$${formatNumber(stats.totalValue)}</span>
                        <span class="stat-label">Total Value (30d)</span>
                    </div>
                </div>
            </div>

            <div class="content-grid">
                <div class="card">
                    <div class="card-header">
                        <h3><i class="fas fa-history"></i> Recent Documents</h3>
                        <a href="#" onclick="navigate('queue')">View All</a>
                    </div>
                    <div class="card-body">
                        <div class="doc-list">
                            ${recentDocs.map(doc => `
                                <div class="doc-item" onclick="reviewDoc(${doc.id})">
                                    <div class="doc-icon ${getStatusClass(doc.status)}">
                                        <i class="fas fa-file-invoice"></i>
                                    </div>
                                    <div class="doc-info">
                                        <span class="doc-name">${doc.vendorName || 'Unknown Vendor'}</span>
                                        <span class="doc-meta">${doc.invoiceNumber || 'No #'} • ${doc.date}</span>
                                    </div>
                                    <div class="doc-amount">$${formatNumber(doc.amount)}</div>
                                    <span class="status-badge ${getStatusClass(doc.status)}">${doc.statusText}</span>
                                </div>
                            `).join('')}
                        </div>
                    </div>
                </div>

                <div class="card">
                    <div class="card-header">
                        <h3><i class="fas fa-exclamation-triangle"></i> Anomaly Alerts</h3>
                        <span class="alert-count ${anomalies.length > 0 ? 'has-alerts' : ''}">${anomalies.length}</span>
                    </div>
                    <div class="card-body">
                        ${anomalies.length > 0 ? `
                            <div class="anomaly-list">
                                ${anomalies.map(a => `
                                    <div class="anomaly-item ${a.severity}">
                                        <i class="fas fa-exclamation-circle"></i>
                                        <div class="anomaly-info">
                                            <span class="anomaly-title">${a.message}</span>
                                            <span class="anomaly-meta">${a.vendorName || 'Document'} • ${a.type}</span>
                                        </div>
                                        <button class="btn-sm" onclick="reviewDoc(${a.documentId})">Review</button>
                                    </div>
                                `).join('')}
                            </div>
                        ` : `
                            <div class="empty-state">
                                <i class="fas fa-shield-alt"></i>
                                <p>No anomalies detected</p>
                            </div>
                        `}
                    </div>
                </div>
            </div>
        </main>
    </div>
    ${renderScripts()}
</body>
</html>`;

        context.response.write(html);
    }

    // ==================== Upload Page ====================

    function renderUploadPage(context) {
        const apiUrl = url.resolveScript({
            scriptId: runtime.getCurrentScript().id,
            deploymentId: runtime.getCurrentScript().deploymentId
        }).replace(/action=\w+/, '') + '&action=api';

        const restletUrl = getRestletUrl();

        const html = `
<!DOCTYPE html>
<html lang="en">
<head>
    ${renderHead('Upload Documents')}
</head>
<body>
    <div class="app-container">
        ${renderSidebar('upload')}
        <main class="main-content">
            ${renderHeader('Upload Documents', 'Drag & drop or click to upload')}

            <div class="upload-container">
                <div class="type-selector">
                    <label class="type-option active" data-type="auto">
                        <input type="radio" name="docType" value="auto" checked>
                        <i class="fas fa-magic"></i>
                        <span>Auto-Detect</span>
                    </label>
                    <label class="type-option" data-type="INVOICE">
                        <input type="radio" name="docType" value="INVOICE">
                        <i class="fas fa-file-invoice-dollar"></i>
                        <span>Invoice</span>
                    </label>
                    <label class="type-option" data-type="RECEIPT">
                        <input type="radio" name="docType" value="RECEIPT">
                        <i class="fas fa-receipt"></i>
                        <span>Receipt</span>
                    </label>
                    <label class="type-option" data-type="EXPENSE_REPORT">
                        <input type="radio" name="docType" value="EXPENSE_REPORT">
                        <i class="fas fa-wallet"></i>
                        <span>Expense</span>
                    </label>
                </div>

                <div class="upload-zone" id="uploadZone">
                    <div class="upload-content">
                        <i class="fas fa-cloud-upload-alt upload-icon"></i>
                        <h2>Drag & Drop Documents Here</h2>
                        <p>or click to browse</p>
                        <div class="supported-formats">
                            <span>Supported:</span>
                            <span class="format-badge">PDF</span>
                            <span class="format-badge">PNG</span>
                            <span class="format-badge">JPG</span>
                            <span class="format-badge">TIFF</span>
                        </div>
                    </div>
                    <input type="file" id="fileInput" multiple accept=".pdf,.png,.jpg,.jpeg,.tiff,.tif" hidden>
                </div>

                <div class="upload-queue" id="uploadQueue" hidden>
                    <div class="queue-header">
                        <h3><i class="fas fa-list"></i> Upload Queue</h3>
                        <button class="btn-text" onclick="clearQueue()">Clear All</button>
                    </div>
                    <div class="queue-list" id="queueList"></div>
                    <div class="queue-actions">
                        <button class="btn" onclick="document.getElementById('fileInput').click()">
                            <i class="fas fa-plus"></i> Add More
                        </button>
                        <button class="btn primary" onclick="processQueue()" id="processBtn">
                            <i class="fas fa-play"></i> Process All (<span id="fileCount">0</span>)
                        </button>
                    </div>
                </div>

                <div class="upload-progress" id="uploadProgress" hidden>
                    <div class="progress-content">
                        <div class="spinner"></div>
                        <h3 id="progressTitle">Uploading...</h3>
                        <p id="progressText">Preparing files...</p>
                        <div class="progress-bar">
                            <div class="progress-fill" id="progressFill"></div>
                        </div>
                    </div>
                </div>
            </div>
        </main>
    </div>
    <script>
        const API_URL = '${restletUrl}';
        ${getUploadScript()}
    </script>
    ${renderScripts()}
</body>
</html>`;

        context.response.write(html);
    }

    // ==================== Queue Page ====================

    function renderQueuePage(context) {
        const page = parseInt(context.request.parameters.page) || 1;
        const statusFilter = context.request.parameters.status || '';
        const queue = getProcessingQueue(page, 25, statusFilter);

        const html = `
<!DOCTYPE html>
<html lang="en">
<head>
    ${renderHead('Processing Queue')}
</head>
<body>
    <div class="app-container">
        ${renderSidebar('queue')}
        <main class="main-content">
            ${renderHeader('Processing Queue', `${queue.total} documents`)}

            <div class="queue-filters">
                <div class="filter-tabs">
                    <button class="filter-tab ${!statusFilter ? 'active' : ''}" onclick="filterQueue('')">All</button>
                    <button class="filter-tab ${statusFilter === 'pending' ? 'active' : ''}" onclick="filterQueue('pending')">Pending</button>
                    <button class="filter-tab ${statusFilter === 'processing' ? 'active' : ''}" onclick="filterQueue('processing')">Processing</button>
                    <button class="filter-tab ${statusFilter === 'review' ? 'active' : ''}" onclick="filterQueue('review')">Needs Review</button>
                    <button class="filter-tab ${statusFilter === 'completed' ? 'active' : ''}" onclick="filterQueue('completed')">Completed</button>
                </div>
                <div class="queue-actions">
                    <button class="btn" onclick="processSelected()">
                        <i class="fas fa-play"></i> Process Selected
                    </button>
                </div>
            </div>

            <div class="queue-table">
                <table>
                    <thead>
                        <tr>
                            <th><input type="checkbox" id="selectAll" onchange="toggleSelectAll()"></th>
                            <th>Document</th>
                            <th>Vendor</th>
                            <th>Invoice #</th>
                            <th>Amount</th>
                            <th>Confidence</th>
                            <th>Status</th>
                            <th>Date</th>
                            <th>Actions</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${queue.documents.map(doc => `
                            <tr class="${doc.hasAnomalies ? 'has-anomaly' : ''}">
                                <td><input type="checkbox" class="doc-select" value="${doc.id}"></td>
                                <td class="doc-name">${doc.name}</td>
                                <td>${doc.vendorName || '-'}</td>
                                <td>${doc.invoiceNumber || '-'}</td>
                                <td>$${formatNumber(doc.amount)}</td>
                                <td>
                                    <div class="confidence-bar ${getConfidenceClass(doc.confidence)}">
                                        <div class="confidence-fill" style="width: ${doc.confidence}%"></div>
                                        <span>${doc.confidence}%</span>
                                    </div>
                                </td>
                                <td><span class="status-badge ${getStatusClass(doc.status)}">${doc.statusText}</span></td>
                                <td>${doc.date}</td>
                                <td>
                                    <button class="btn-icon" onclick="reviewDoc(${doc.id})" title="Review">
                                        <i class="fas fa-eye"></i>
                                    </button>
                                    <button class="btn-icon" onclick="deleteDoc(${doc.id})" title="Delete">
                                        <i class="fas fa-trash"></i>
                                    </button>
                                </td>
                            </tr>
                        `).join('')}
                    </tbody>
                </table>
            </div>

            ${renderPagination(page, queue.totalPages)}
        </main>
    </div>
    ${renderScripts()}
</body>
</html>`;

        context.response.write(html);
    }

    // ==================== Review Page ====================

    function renderReviewPage(context) {
        const docId = context.request.parameters.docId;

        if (!docId) {
            return renderQueuePage(context);
        }

        const doc = getDocumentDetails(docId);
        const restletUrl = getRestletUrl();

        const html = `
<!DOCTYPE html>
<html lang="en">
<head>
    ${renderHead('Review Document')}
</head>
<body>
    <div class="app-container">
        ${renderSidebar('review')}
        <main class="main-content review-mode">
            <div class="review-header">
                <button class="btn-back" onclick="navigate('queue')">
                    <i class="fas fa-arrow-left"></i> Back to Queue
                </button>
                <div class="review-actions">
                    <button class="btn danger" onclick="rejectDocument(${docId})">
                        <i class="fas fa-times"></i> Reject
                    </button>
                    <button class="btn success" onclick="approveDocument(${docId})">
                        <i class="fas fa-check"></i> Approve & Create
                    </button>
                </div>
            </div>

            <div class="review-container">
                <div class="document-preview">
                    <div class="preview-toolbar">
                        <button class="tool-btn" onclick="zoomIn()"><i class="fas fa-search-plus"></i></button>
                        <button class="tool-btn" onclick="zoomOut()"><i class="fas fa-search-minus"></i></button>
                        <button class="tool-btn" onclick="downloadFile(${doc.fileId})"><i class="fas fa-download"></i></button>
                    </div>
                    <div class="preview-frame">
                        ${doc.fileUrl ? `<iframe src="${doc.fileUrl}" id="docPreview"></iframe>` : '<p>No preview available</p>'}
                    </div>
                </div>

                <div class="extraction-panel">
                    <div class="confidence-banner ${doc.confidenceLevel.toLowerCase()}">
                        <div class="confidence-score">
                            <div class="score-circle">
                                <svg viewBox="0 0 36 36">
                                    <path class="score-bg" d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831"/>
                                    <path class="score-fill" stroke-dasharray="${doc.confidence}, 100" d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831"/>
                                    <text x="18" y="20.5" class="score-text">${doc.confidence}%</text>
                                </svg>
                            </div>
                            <span class="score-label">${doc.confidenceLevel} Confidence</span>
                        </div>
                    </div>

                    ${doc.anomalies.length > 0 ? `
                        <div class="anomaly-warnings">
                            ${doc.anomalies.map(a => `
                                <div class="warning-item ${a.severity}">
                                    <i class="fas fa-exclamation-triangle"></i>
                                    <span>${a.message}</span>
                                </div>
                            `).join('')}
                        </div>
                    ` : ''}

                    <div class="extracted-fields">
                        <h3>Extracted Information</h3>

                        <div class="field-group">
                            <label>Vendor</label>
                            <select id="vendor" onchange="trackChange('vendor', this.value)">
                                <option value="">-- Select Vendor --</option>
                                ${doc.vendorSuggestions.map(v => `
                                    <option value="${v.id}" ${v.id == doc.vendorId ? 'selected' : ''}>${v.name}</option>
                                `).join('')}
                            </select>
                            <input type="text" id="vendorSearch" placeholder="Search vendors..." onkeyup="searchVendor(this.value)">
                        </div>

                        <div class="field-row">
                            <div class="field-group">
                                <label>Invoice Number</label>
                                <input type="text" id="invoiceNumber" value="${doc.invoiceNumber || ''}" onchange="trackChange('invoiceNumber', this.value)">
                            </div>
                            <div class="field-group">
                                <label>Invoice Date</label>
                                <input type="date" id="invoiceDate" value="${formatDateInput(doc.invoiceDate)}" onchange="trackChange('invoiceDate', this.value)">
                            </div>
                        </div>

                        <div class="field-row">
                            <div class="field-group">
                                <label>Due Date</label>
                                <input type="date" id="dueDate" value="${formatDateInput(doc.dueDate)}" onchange="trackChange('dueDate', this.value)">
                            </div>
                            <div class="field-group">
                                <label>PO Number</label>
                                <input type="text" id="poNumber" value="${doc.poNumber || ''}" onchange="trackChange('poNumber', this.value)">
                            </div>
                        </div>
                    </div>

                    <div class="amount-fields">
                        <h3>Amounts</h3>
                        <div class="amount-grid">
                            <div class="amount-field">
                                <label>Subtotal</label>
                                <input type="number" step="0.01" id="subtotal" value="${doc.subtotal || 0}" onchange="trackChange('subtotal', this.value); calculateTotal()">
                            </div>
                            <div class="amount-field">
                                <label>Tax</label>
                                <input type="number" step="0.01" id="taxAmount" value="${doc.taxAmount || 0}" onchange="trackChange('taxAmount', this.value); calculateTotal()">
                            </div>
                            <div class="amount-field total">
                                <label>Total</label>
                                <input type="number" step="0.01" id="totalAmount" value="${doc.totalAmount || 0}" onchange="trackChange('totalAmount', this.value)">
                            </div>
                        </div>
                    </div>

                    ${doc.lineItems.length > 0 ? `
                        <div class="line-items">
                            <h3>Line Items (${doc.lineItems.length})</h3>
                            <table class="line-items-table">
                                <thead>
                                    <tr>
                                        <th>Description</th>
                                        <th>Qty</th>
                                        <th>Price</th>
                                        <th>Amount</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    ${doc.lineItems.map((item, i) => `
                                        <tr>
                                            <td><input type="text" value="${item.description || ''}" onchange="updateLineItem(${i}, 'description', this.value)"></td>
                                            <td><input type="number" value="${item.quantity || 0}" onchange="updateLineItem(${i}, 'quantity', this.value)"></td>
                                            <td><input type="number" step="0.01" value="${item.unitPrice || 0}" onchange="updateLineItem(${i}, 'unitPrice', this.value)"></td>
                                            <td><input type="number" step="0.01" value="${item.amount || 0}" onchange="updateLineItem(${i}, 'amount', this.value)"></td>
                                        </tr>
                                    `).join('')}
                                </tbody>
                            </table>
                        </div>
                    ` : ''}
                </div>
            </div>
        </main>
    </div>
    <script>
        const API_URL = '${restletUrl}';
        const DOC_ID = ${docId};
        const pendingChanges = {};
        let lineItems = ${JSON.stringify(doc.lineItems)};

        function trackChange(field, value) {
            pendingChanges[field] = value;
        }

        function updateLineItem(index, field, value) {
            lineItems[index][field] = field === 'description' ? value : parseFloat(value) || 0;
            pendingChanges.lineItems = lineItems;
        }

        function calculateTotal() {
            const subtotal = parseFloat(document.getElementById('subtotal').value) || 0;
            const tax = parseFloat(document.getElementById('taxAmount').value) || 0;
            document.getElementById('totalAmount').value = (subtotal + tax).toFixed(2);
        }

        async function approveDocument(docId) {
            if (!confirm('Create transaction from this document?')) return;

            // Save pending changes first
            if (Object.keys(pendingChanges).length > 0) {
                await fetch(API_URL, {
                    method: 'PUT',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ action: 'update', documentId: docId, updates: pendingChanges })
                });
            }

            const response = await fetch(API_URL, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ action: 'approve', documentId: docId, createTransaction: true })
            });

            const result = await response.json();
            if (result.success) {
                alert('Document approved and transaction created!');
                navigate('queue');
            } else {
                alert('Error: ' + (result.error?.message || 'Unknown error'));
            }
        }

        async function rejectDocument(docId) {
            const reason = prompt('Reason for rejection:');
            if (!reason) return;

            const response = await fetch(API_URL, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ action: 'reject', documentId: docId, reason: reason })
            });

            const result = await response.json();
            if (result.success) {
                alert('Document rejected');
                navigate('queue');
            }
        }

        async function searchVendor(query) {
            if (query.length < 2) return;

            const response = await fetch(API_URL + '?action=vendors&query=' + encodeURIComponent(query));
            const result = await response.json();

            if (result.success && result.data.length > 0) {
                const select = document.getElementById('vendor');
                select.innerHTML = '<option value="">-- Select Vendor --</option>';
                result.data.forEach(v => {
                    select.innerHTML += '<option value="' + v.id + '">' + v.companyName + '</option>';
                });
            }
        }

        let zoom = 1;
        function zoomIn() { zoom = Math.min(zoom + 0.25, 3); updateZoom(); }
        function zoomOut() { zoom = Math.max(zoom - 0.25, 0.5); updateZoom(); }
        function updateZoom() {
            const iframe = document.getElementById('docPreview');
            if (iframe) iframe.style.transform = 'scale(' + zoom + ')';
        }
    </script>
    ${renderScripts()}
</body>
</html>`;

        context.response.write(html);
    }

    // ==================== Batch Page ====================

    function renderBatchPage(context) {
        const batches = getBatches(10);

        const html = `
<!DOCTYPE html>
<html lang="en">
<head>
    ${renderHead('Batch Processing')}
</head>
<body>
    <div class="app-container">
        ${renderSidebar('batch')}
        <main class="main-content">
            ${renderHeader('Batch Processing', 'Process multiple documents at once')}

            <div class="batch-upload">
                <div class="upload-zone" id="batchZone">
                    <i class="fas fa-layer-group upload-icon"></i>
                    <h2>Upload Batch</h2>
                    <p>Drop multiple files here for batch processing</p>
                    <input type="file" id="batchInput" multiple accept=".pdf,.png,.jpg,.jpeg,.tiff" hidden>
                </div>
            </div>

            <div class="batch-list">
                <h3>Recent Batches</h3>
                <table>
                    <thead>
                        <tr>
                            <th>Batch Name</th>
                            <th>Documents</th>
                            <th>Progress</th>
                            <th>Status</th>
                            <th>Created</th>
                            <th>Actions</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${batches.map(b => `
                            <tr>
                                <td>${b.name}</td>
                                <td>${b.processed}/${b.total}</td>
                                <td>
                                    <div class="progress-bar">
                                        <div class="progress-fill" style="width: ${b.progress}%"></div>
                                    </div>
                                </td>
                                <td><span class="status-badge ${b.status}">${b.statusText}</span></td>
                                <td>${b.date}</td>
                                <td>
                                    <button class="btn-icon" onclick="viewBatch(${b.id})"><i class="fas fa-eye"></i></button>
                                </td>
                            </tr>
                        `).join('')}
                    </tbody>
                </table>
            </div>
        </main>
    </div>
    ${renderScripts()}
</body>
</html>`;

        context.response.write(html);
    }

    // ==================== Settings Page ====================

    function renderSettingsPage(context) {
        const html = `
<!DOCTYPE html>
<html lang="en">
<head>
    ${renderHead('Settings')}
</head>
<body>
    <div class="app-container">
        ${renderSidebar('settings')}
        <main class="main-content">
            ${renderHeader('Settings', 'Configure Flux Capture')}

            <div class="settings-grid">
                <div class="settings-section">
                    <h3><i class="fas fa-robot"></i> Processing</h3>
                    <div class="setting-item">
                        <label>Auto-approve Threshold</label>
                        <input type="range" min="70" max="100" value="85" id="autoThreshold">
                        <span id="thresholdValue">85%</span>
                    </div>
                    <div class="setting-item">
                        <label>Default Document Type</label>
                        <select id="defaultType">
                            <option value="auto">Auto-Detect</option>
                            <option value="INVOICE">Invoice</option>
                            <option value="RECEIPT">Receipt</option>
                        </select>
                    </div>
                </div>

                <div class="settings-section">
                    <h3><i class="fas fa-envelope"></i> Email Import</h3>
                    <div class="setting-item">
                        <label>Enable Email Import</label>
                        <input type="checkbox" id="emailEnabled" checked>
                    </div>
                    <div class="setting-item">
                        <label>Email Address</label>
                        <input type="text" value="flux-${runtime.accountId}@netsuite.com" readonly>
                    </div>
                </div>

                <div class="settings-section">
                    <h3><i class="fas fa-shield-alt"></i> Fraud Detection</h3>
                    <div class="setting-item">
                        <label>Duplicate Detection</label>
                        <input type="checkbox" id="duplicateDetection" checked>
                    </div>
                    <div class="setting-item">
                        <label>Amount Validation</label>
                        <input type="checkbox" id="amountValidation" checked>
                    </div>
                </div>
            </div>

            <div class="settings-actions">
                <button class="btn primary" onclick="saveSettings()">
                    <i class="fas fa-save"></i> Save Settings
                </button>
            </div>
        </main>
    </div>
    ${renderScripts()}
</body>
</html>`;

        context.response.write(html);
    }

    // ==================== Data Functions ====================

    function getDashboardStats() {
        try {
            const sql = `
                SELECT
                    COUNT(*) as total,
                    SUM(CASE WHEN custrecord_dm_status IN (1,2,3,4) THEN 1 ELSE 0 END) as pending,
                    SUM(CASE WHEN custrecord_dm_status = 6 THEN 1 ELSE 0 END) as completed,
                    SUM(CASE WHEN custrecord_dm_status = 6 AND custrecord_dm_confidence_score >= 85 THEN 1 ELSE 0 END) as autoProcessed,
                    SUM(custrecord_dm_total_amount) as totalValue
                FROM customrecord_dm_captured_document
                WHERE custrecord_dm_created_date >= ADD_MONTHS(SYSDATE, -1)
            `;

            const result = query.runSuiteQL({ query: sql });
            const vals = result.results[0]?.values || [0, 0, 0, 0, 0];

            return {
                total: vals[0] || 0,
                pending: vals[1] || 0,
                completed: vals[2] || 0,
                autoProcessed: vals[3] || 0,
                totalValue: vals[4] || 0,
                autoRate: vals[0] > 0 ? Math.round((vals[3] / vals[0]) * 100) : 0
            };
        } catch (e) {
            return { total: 0, pending: 0, completed: 0, autoProcessed: 0, totalValue: 0, autoRate: 0 };
        }
    }

    function getRecentDocuments(limit) {
        try {
            const sql = `
                SELECT id, name, custrecord_dm_status,
                    BUILTIN.DF(custrecord_dm_status) as statusText,
                    BUILTIN.DF(custrecord_dm_vendor) as vendorName,
                    custrecord_dm_invoice_number, custrecord_dm_total_amount,
                    TO_CHAR(custrecord_dm_created_date, 'Mon DD') as createdDate
                FROM customrecord_dm_captured_document
                ORDER BY custrecord_dm_created_date DESC
                FETCH FIRST ${limit} ROWS ONLY
            `;

            const result = query.runSuiteQL({ query: sql });

            return result.results.map(r => ({
                id: r.values[0],
                name: r.values[1],
                status: r.values[2],
                statusText: r.values[3],
                vendorName: r.values[4],
                invoiceNumber: r.values[5],
                amount: r.values[6] || 0,
                date: r.values[7]
            }));
        } catch (e) {
            return [];
        }
    }

    function getRecentAnomalies(limit) {
        try {
            const sql = `
                SELECT id, custrecord_dm_anomalies, BUILTIN.DF(custrecord_dm_vendor) as vendorName
                FROM customrecord_dm_captured_document
                WHERE custrecord_dm_anomalies IS NOT NULL
                AND custrecord_dm_anomalies != '[]'
                AND custrecord_dm_status NOT IN (5, 6)
                ORDER BY custrecord_dm_created_date DESC
                FETCH FIRST ${limit * 2} ROWS ONLY
            `;

            const result = query.runSuiteQL({ query: sql });
            const anomalies = [];

            result.results.forEach(r => {
                const docAnomalies = JSON.parse(r.values[1] || '[]');
                docAnomalies.forEach(a => {
                    anomalies.push({
                        documentId: r.values[0],
                        vendorName: r.values[2],
                        ...a
                    });
                });
            });

            return anomalies.slice(0, limit);
        } catch (e) {
            return [];
        }
    }

    function getProcessingQueue(page, pageSize, statusFilter) {
        try {
            let sql = `
                SELECT id, name, custrecord_dm_status,
                    BUILTIN.DF(custrecord_dm_status) as statusText,
                    BUILTIN.DF(custrecord_dm_vendor) as vendorName,
                    custrecord_dm_invoice_number, custrecord_dm_total_amount,
                    custrecord_dm_confidence_score, custrecord_dm_anomalies,
                    TO_CHAR(custrecord_dm_created_date, 'Mon DD HH24:MI') as createdDate
                FROM customrecord_dm_captured_document
                WHERE 1=1
            `;

            const statusMap = {
                'pending': '1', 'processing': '2', 'review': '4', 'completed': '6'
            };

            if (statusFilter && statusMap[statusFilter]) {
                sql += ` AND custrecord_dm_status = ${statusMap[statusFilter]}`;
            }

            sql += ` ORDER BY custrecord_dm_created_date DESC`;
            sql += ` OFFSET ${(page - 1) * pageSize} ROWS FETCH NEXT ${pageSize} ROWS ONLY`;

            const result = query.runSuiteQL({ query: sql });

            const countSql = `SELECT COUNT(*) FROM customrecord_dm_captured_document WHERE 1=1`;
            const countResult = query.runSuiteQL({ query: countSql });
            const total = countResult.results[0]?.values[0] || 0;

            return {
                documents: result.results.map(r => ({
                    id: r.values[0],
                    name: r.values[1],
                    status: r.values[2],
                    statusText: r.values[3],
                    vendorName: r.values[4],
                    invoiceNumber: r.values[5],
                    amount: r.values[6] || 0,
                    confidence: r.values[7] || 0,
                    hasAnomalies: r.values[8] && r.values[8] !== '[]',
                    date: r.values[9]
                })),
                total: total,
                totalPages: Math.ceil(total / pageSize)
            };
        } catch (e) {
            return { documents: [], total: 0, totalPages: 0 };
        }
    }

    function getDocumentDetails(docId) {
        try {
            const docRecord = record.load({
                type: 'customrecord_dm_captured_document',
                id: docId
            });

            const fileId = docRecord.getValue('custrecord_dm_source_file');
            let fileUrl = '';
            if (fileId) {
                try {
                    const fileObj = file.load({ id: fileId });
                    fileUrl = fileObj.url;
                } catch (e) {}
            }

            const vendorId = docRecord.getValue('custrecord_dm_vendor');
            const vendorSuggestions = getVendorSuggestions(vendorId);
            const confidence = docRecord.getValue('custrecord_dm_confidence_score') || 0;

            return {
                id: docId,
                name: docRecord.getValue('name'),
                status: docRecord.getValue('custrecord_dm_status'),
                vendorId: vendorId,
                vendorName: docRecord.getText('custrecord_dm_vendor'),
                vendorSuggestions: vendorSuggestions,
                invoiceNumber: docRecord.getValue('custrecord_dm_invoice_number'),
                invoiceDate: docRecord.getValue('custrecord_dm_invoice_date'),
                dueDate: docRecord.getValue('custrecord_dm_due_date'),
                poNumber: docRecord.getValue('custrecord_dm_po_number'),
                subtotal: docRecord.getValue('custrecord_dm_subtotal') || 0,
                taxAmount: docRecord.getValue('custrecord_dm_tax_amount') || 0,
                totalAmount: docRecord.getValue('custrecord_dm_total_amount') || 0,
                currency: docRecord.getValue('custrecord_dm_currency'),
                confidence: confidence,
                confidenceLevel: confidence >= 85 ? 'HIGH' : confidence >= 60 ? 'MEDIUM' : 'LOW',
                lineItems: JSON.parse(docRecord.getValue('custrecord_dm_line_items') || '[]'),
                anomalies: JSON.parse(docRecord.getValue('custrecord_dm_anomalies') || '[]'),
                fileId: fileId,
                fileUrl: fileUrl
            };
        } catch (e) {
            return null;
        }
    }

    function getVendorSuggestions(currentVendorId) {
        const suggestions = [];

        if (currentVendorId) {
            try {
                const vendor = search.lookupFields({
                    type: 'vendor',
                    id: currentVendorId,
                    columns: ['companyname']
                });
                suggestions.push({ id: currentVendorId, name: vendor.companyname });
            } catch (e) {}
        }

        return suggestions;
    }

    function getBatches(limit) {
        try {
            const sql = `
                SELECT id, name, custrecord_dm_batch_status,
                    BUILTIN.DF(custrecord_dm_batch_status) as statusText,
                    custrecord_dm_batch_document_count,
                    custrecord_dm_batch_processed_count,
                    TO_CHAR(custrecord_dm_batch_created_date, 'Mon DD') as createdDate
                FROM customrecord_dm_batch
                ORDER BY custrecord_dm_batch_created_date DESC
                FETCH FIRST ${limit} ROWS ONLY
            `;

            const result = query.runSuiteQL({ query: sql });

            return result.results.map(r => ({
                id: r.values[0],
                name: r.values[1],
                status: r.values[2],
                statusText: r.values[3],
                total: r.values[4] || 0,
                processed: r.values[5] || 0,
                progress: r.values[4] > 0 ? Math.round((r.values[5] / r.values[4]) * 100) : 0,
                date: r.values[6]
            }));
        } catch (e) {
            return [];
        }
    }

    // ==================== Helper Functions ====================

    function getRestletUrl() {
        return url.resolveScript({
            scriptId: 'customscript_fc_router',
            deploymentId: 'customdeploy_fc_router'
        });
    }

    function formatNumber(num) {
        return (num || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    }

    function formatDateInput(date) {
        if (!date) return '';
        const d = new Date(date);
        return d.toISOString().split('T')[0];
    }

    function getStatusClass(status) {
        const classes = { 1: 'pending', 2: 'processing', 3: 'extracted', 4: 'review', 5: 'rejected', 6: 'completed', 7: 'error' };
        return classes[status] || 'pending';
    }

    function getConfidenceClass(confidence) {
        if (confidence >= 85) return 'high';
        if (confidence >= 60) return 'medium';
        return 'low';
    }

    // ==================== Render Functions ====================

    function renderHead(title) {
        return `
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Flux Capture - ${title}</title>
    <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">
    <link href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css" rel="stylesheet">
    <style>${getStyles()}</style>`;
    }

    function renderSidebar(active) {
        const items = [
            { id: 'dashboard', icon: 'fas fa-home', label: 'Dashboard' },
            { id: 'upload', icon: 'fas fa-cloud-upload-alt', label: 'Upload' },
            { id: 'queue', icon: 'fas fa-tasks', label: 'Queue' },
            { id: 'batch', icon: 'fas fa-layer-group', label: 'Batches' },
            { id: 'settings', icon: 'fas fa-cog', label: 'Settings' }
        ];

        return `
        <aside class="sidebar">
            <div class="sidebar-logo">
                <i class="fas fa-bolt"></i>
                <span>Flux Capture</span>
            </div>
            <nav class="sidebar-nav">
                ${items.map(item => `
                    <a href="#" class="nav-item ${active === item.id ? 'active' : ''}" onclick="navigate('${item.id}')">
                        <i class="${item.icon}"></i>
                        <span>${item.label}</span>
                    </a>
                `).join('')}
            </nav>
        </aside>`;
    }

    function renderHeader(title, subtitle) {
        return `
        <header class="page-header">
            <div class="header-info">
                <h1>${title}</h1>
                <p>${subtitle}</p>
            </div>
            <div class="header-user">
                <span>${runtime.getCurrentUser().name}</span>
            </div>
        </header>`;
    }

    function renderPagination(page, totalPages) {
        if (totalPages <= 1) return '';

        return `
        <div class="pagination">
            <button ${page <= 1 ? 'disabled' : ''} onclick="goToPage(${page - 1})">
                <i class="fas fa-chevron-left"></i>
            </button>
            <span>Page ${page} of ${totalPages}</span>
            <button ${page >= totalPages ? 'disabled' : ''} onclick="goToPage(${page + 1})">
                <i class="fas fa-chevron-right"></i>
            </button>
        </div>`;
    }

    function renderErrorPage(message) {
        return `
<!DOCTYPE html>
<html><head><title>Error</title></head>
<body style="font-family: sans-serif; padding: 40px; text-align: center;">
    <h1>Error</h1>
    <p>${message}</p>
    <a href="#" onclick="history.back()">Go Back</a>
</body></html>`;
    }

    function renderScripts() {
        return `
    <script>
        function navigate(action) {
            window.location.href = window.location.pathname + '?action=' + action;
        }

        function reviewDoc(id) {
            window.location.href = window.location.pathname + '?action=review&docId=' + id;
        }

        function filterQueue(status) {
            window.location.href = window.location.pathname + '?action=queue&status=' + status;
        }

        function goToPage(page) {
            const params = new URLSearchParams(window.location.search);
            params.set('page', page);
            window.location.href = window.location.pathname + '?' + params.toString();
        }

        function toggleSelectAll() {
            const checked = document.getElementById('selectAll').checked;
            document.querySelectorAll('.doc-select').forEach(cb => cb.checked = checked);
        }

        function downloadFile(fileId) {
            window.open('/core/media/media.nl?id=' + fileId, '_blank');
        }
    </script>`;
    }

    function getUploadScript() {
        return `
        const uploadZone = document.getElementById('uploadZone');
        const fileInput = document.getElementById('fileInput');
        const uploadQueue = document.getElementById('uploadQueue');
        const queueList = document.getElementById('queueList');
        const uploadProgress = document.getElementById('uploadProgress');
        let files = [];

        uploadZone.addEventListener('click', () => fileInput.click());
        uploadZone.addEventListener('dragover', e => { e.preventDefault(); uploadZone.classList.add('dragover'); });
        uploadZone.addEventListener('dragleave', () => uploadZone.classList.remove('dragover'));
        uploadZone.addEventListener('drop', e => {
            e.preventDefault();
            uploadZone.classList.remove('dragover');
            handleFiles(e.dataTransfer.files);
        });
        fileInput.addEventListener('change', e => handleFiles(e.target.files));

        document.querySelectorAll('.type-option').forEach(opt => {
            opt.addEventListener('click', () => {
                document.querySelectorAll('.type-option').forEach(o => o.classList.remove('active'));
                opt.classList.add('active');
            });
        });

        function handleFiles(newFiles) {
            files = [...files, ...Array.from(newFiles)];
            renderQueue();
        }

        function renderQueue() {
            if (files.length === 0) {
                uploadQueue.hidden = true;
                return;
            }
            uploadQueue.hidden = false;
            queueList.innerHTML = files.map((f, i) => \`
                <div class="queue-item">
                    <i class="fas fa-file-pdf"></i>
                    <span>\${f.name}</span>
                    <span class="file-size">\${(f.size / 1024 / 1024).toFixed(2)} MB</span>
                    <button class="btn-icon" onclick="removeFile(\${i})"><i class="fas fa-times"></i></button>
                </div>
            \`).join('');
            document.getElementById('fileCount').textContent = files.length;
        }

        function removeFile(index) {
            files.splice(index, 1);
            renderQueue();
        }

        function clearQueue() {
            files = [];
            renderQueue();
        }

        async function processQueue() {
            if (files.length === 0) return;

            uploadProgress.hidden = false;
            uploadQueue.hidden = true;
            const docType = document.querySelector('input[name="docType"]:checked').value;

            for (let i = 0; i < files.length; i++) {
                document.getElementById('progressTitle').textContent = 'Uploading...';
                document.getElementById('progressText').textContent = 'Processing ' + (i + 1) + ' of ' + files.length;
                document.getElementById('progressFill').style.width = ((i + 1) / files.length * 100) + '%';

                const base64 = await readFileAsBase64(files[i]);

                try {
                    await fetch(API_URL, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            action: 'upload',
                            fileName: files[i].name,
                            fileContent: base64,
                            documentType: docType
                        })
                    });
                } catch (e) {
                    console.error('Upload error:', e);
                }
            }

            document.getElementById('progressTitle').textContent = 'Complete!';
            document.getElementById('progressText').textContent = 'All files processed';

            setTimeout(() => navigate('queue'), 1500);
        }

        function readFileAsBase64(file) {
            return new Promise((resolve, reject) => {
                const reader = new FileReader();
                reader.onload = () => resolve(reader.result.split(',')[1]);
                reader.onerror = reject;
                reader.readAsDataURL(file);
            });
        }`;
    }

    function getStyles() {
        return `
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body { font-family: 'Inter', sans-serif; background: #f1f5f9; color: #1e293b; }

        .app-container { display: flex; min-height: 100vh; }

        .sidebar {
            width: 240px; background: linear-gradient(180deg, #6366f1, #4f46e5);
            color: white; padding: 20px 0; position: fixed; height: 100vh;
        }
        .sidebar-logo { padding: 0 20px 30px; font-size: 20px; font-weight: 700; display: flex; align-items: center; gap: 10px; }
        .sidebar-logo i { font-size: 24px; }
        .sidebar-nav { display: flex; flex-direction: column; }
        .nav-item {
            padding: 14px 20px; color: rgba(255,255,255,0.8); text-decoration: none;
            display: flex; align-items: center; gap: 12px; transition: all 0.2s;
        }
        .nav-item:hover, .nav-item.active { background: rgba(255,255,255,0.1); color: white; }
        .nav-item.active { border-left: 3px solid white; }

        .main-content { flex: 1; margin-left: 240px; padding: 30px; }

        .page-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 30px; }
        .page-header h1 { font-size: 28px; font-weight: 700; }
        .page-header p { color: #64748b; margin-top: 4px; }

        .quick-actions { display: flex; gap: 12px; margin-bottom: 30px; }
        .action-btn {
            padding: 12px 24px; border: none; border-radius: 8px; cursor: pointer;
            font-size: 14px; font-weight: 500; display: flex; align-items: center; gap: 8px;
            background: white; color: #374151; box-shadow: 0 1px 3px rgba(0,0,0,0.1);
            transition: all 0.2s;
        }
        .action-btn:hover { box-shadow: 0 4px 6px rgba(0,0,0,0.1); }
        .action-btn.primary { background: #6366f1; color: white; }
        .action-btn .badge { background: #ef4444; color: white; padding: 2px 8px; border-radius: 10px; font-size: 12px; }

        .stats-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 20px; margin-bottom: 30px; }
        .stat-card {
            background: white; border-radius: 12px; padding: 20px;
            box-shadow: 0 1px 3px rgba(0,0,0,0.1); display: flex; flex-direction: column; gap: 12px;
        }
        .stat-icon { width: 48px; height: 48px; border-radius: 12px; display: flex; align-items: center; justify-content: center; font-size: 20px; }
        .stat-icon.blue { background: #dbeafe; color: #2563eb; }
        .stat-icon.green { background: #dcfce7; color: #16a34a; }
        .stat-icon.orange { background: #fed7aa; color: #ea580c; }
        .stat-icon.purple { background: #e9d5ff; color: #9333ea; }
        .stat-value { font-size: 28px; font-weight: 700; }
        .stat-label { color: #64748b; font-size: 14px; }
        .stat-trend { color: #16a34a; font-size: 13px; }
        .stat-link { color: #6366f1; font-size: 13px; text-decoration: none; }

        .content-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 20px; }
        .card { background: white; border-radius: 12px; box-shadow: 0 1px 3px rgba(0,0,0,0.1); }
        .card-header {
            padding: 16px 20px; border-bottom: 1px solid #e2e8f0;
            display: flex; justify-content: space-between; align-items: center;
        }
        .card-header h3 { font-size: 16px; display: flex; align-items: center; gap: 8px; }
        .card-header a { color: #6366f1; font-size: 13px; text-decoration: none; }
        .card-body { padding: 16px 20px; }

        .doc-list { display: flex; flex-direction: column; gap: 12px; }
        .doc-item {
            display: flex; align-items: center; gap: 12px; padding: 12px;
            border-radius: 8px; cursor: pointer; transition: background 0.2s;
        }
        .doc-item:hover { background: #f8fafc; }
        .doc-icon { width: 40px; height: 40px; border-radius: 8px; display: flex; align-items: center; justify-content: center; }
        .doc-icon.pending { background: #fef3c7; color: #d97706; }
        .doc-icon.processing { background: #dbeafe; color: #2563eb; }
        .doc-icon.completed { background: #dcfce7; color: #16a34a; }
        .doc-icon.rejected { background: #fee2e2; color: #dc2626; }
        .doc-info { flex: 1; }
        .doc-name { display: block; font-weight: 500; }
        .doc-meta { display: block; font-size: 12px; color: #64748b; }
        .doc-amount { font-weight: 600; }
        .status-badge {
            padding: 4px 10px; border-radius: 12px; font-size: 12px; font-weight: 500;
        }
        .status-badge.pending { background: #fef3c7; color: #d97706; }
        .status-badge.processing { background: #dbeafe; color: #2563eb; }
        .status-badge.extracted, .status-badge.review { background: #fed7aa; color: #ea580c; }
        .status-badge.completed { background: #dcfce7; color: #16a34a; }
        .status-badge.rejected, .status-badge.error { background: #fee2e2; color: #dc2626; }

        .anomaly-list { display: flex; flex-direction: column; gap: 10px; }
        .anomaly-item {
            display: flex; align-items: center; gap: 12px; padding: 12px;
            border-radius: 8px; background: #fef3c7;
        }
        .anomaly-item.high { background: #fee2e2; }
        .anomaly-item i { color: #d97706; }
        .anomaly-item.high i { color: #dc2626; }
        .anomaly-info { flex: 1; }
        .anomaly-title { display: block; font-weight: 500; font-size: 14px; }
        .anomaly-meta { display: block; font-size: 12px; color: #64748b; }
        .btn-sm { padding: 6px 12px; border: none; border-radius: 6px; background: white; cursor: pointer; font-size: 12px; }

        .alert-count { padding: 4px 10px; border-radius: 12px; font-size: 12px; background: #e2e8f0; }
        .alert-count.has-alerts { background: #fee2e2; color: #dc2626; }

        .empty-state { text-align: center; padding: 40px 20px; color: #64748b; }
        .empty-state i { font-size: 48px; margin-bottom: 16px; opacity: 0.5; }

        /* Upload Page */
        .upload-container { max-width: 800px; margin: 0 auto; }
        .type-selector { display: flex; gap: 12px; margin-bottom: 24px; }
        .type-option {
            flex: 1; padding: 16px; background: white; border: 2px solid #e2e8f0;
            border-radius: 12px; cursor: pointer; text-align: center; transition: all 0.2s;
        }
        .type-option:hover { border-color: #6366f1; }
        .type-option.active { border-color: #6366f1; background: #eef2ff; }
        .type-option input { display: none; }
        .type-option i { font-size: 24px; color: #6366f1; margin-bottom: 8px; display: block; }
        .type-option span { font-weight: 500; }

        .upload-zone {
            background: white; border: 2px dashed #cbd5e1; border-radius: 16px;
            padding: 60px 40px; text-align: center; cursor: pointer; transition: all 0.2s;
        }
        .upload-zone:hover, .upload-zone.dragover { border-color: #6366f1; background: #f8fafc; }
        .upload-icon { font-size: 64px; color: #6366f1; margin-bottom: 20px; }
        .upload-zone h2 { margin-bottom: 8px; }
        .upload-zone p { color: #64748b; }
        .supported-formats { margin-top: 20px; }
        .format-badge { display: inline-block; padding: 4px 10px; background: #e2e8f0; border-radius: 4px; font-size: 12px; margin: 0 4px; }

        .upload-queue { background: white; border-radius: 12px; padding: 20px; margin-top: 24px; }
        .queue-header { display: flex; justify-content: space-between; margin-bottom: 16px; }
        .queue-list { max-height: 300px; overflow-y: auto; }
        .queue-item { display: flex; align-items: center; gap: 12px; padding: 12px; border-bottom: 1px solid #e2e8f0; }
        .queue-item i { color: #ef4444; font-size: 20px; }
        .queue-item span { flex: 1; }
        .file-size { color: #64748b; font-size: 12px; }
        .queue-actions { display: flex; justify-content: flex-end; gap: 12px; margin-top: 16px; }

        .upload-progress { background: white; border-radius: 12px; padding: 60px 40px; text-align: center; margin-top: 24px; }
        .spinner { width: 48px; height: 48px; border: 4px solid #e2e8f0; border-top-color: #6366f1; border-radius: 50%; animation: spin 1s linear infinite; margin: 0 auto 20px; }
        @keyframes spin { to { transform: rotate(360deg); } }
        .progress-bar { height: 8px; background: #e2e8f0; border-radius: 4px; overflow: hidden; margin-top: 20px; }
        .progress-fill { height: 100%; background: #6366f1; transition: width 0.3s; }

        .btn { padding: 10px 20px; border: 1px solid #e2e8f0; background: white; border-radius: 8px; cursor: pointer; font-size: 14px; display: inline-flex; align-items: center; gap: 8px; }
        .btn.primary { background: #6366f1; color: white; border: none; }
        .btn.success { background: #16a34a; color: white; border: none; }
        .btn.danger { background: #dc2626; color: white; border: none; }
        .btn-text { background: none; border: none; color: #6366f1; cursor: pointer; }
        .btn-icon { background: none; border: none; cursor: pointer; padding: 8px; color: #64748b; }
        .btn-icon:hover { color: #1e293b; }
        .btn-back { background: none; border: none; cursor: pointer; display: flex; align-items: center; gap: 8px; color: #64748b; }

        /* Queue Page */
        .queue-filters { display: flex; justify-content: space-between; margin-bottom: 20px; }
        .filter-tabs { display: flex; gap: 8px; }
        .filter-tab { padding: 8px 16px; border: none; background: white; border-radius: 8px; cursor: pointer; }
        .filter-tab.active { background: #6366f1; color: white; }

        .queue-table { background: white; border-radius: 12px; overflow: hidden; }
        .queue-table table { width: 100%; border-collapse: collapse; }
        .queue-table th, .queue-table td { padding: 14px 16px; text-align: left; border-bottom: 1px solid #e2e8f0; }
        .queue-table th { background: #f8fafc; font-weight: 600; font-size: 13px; color: #64748b; }
        .queue-table tr:hover { background: #f8fafc; }
        .queue-table tr.has-anomaly { background: #fffbeb; }

        .confidence-bar { width: 100px; height: 8px; background: #e2e8f0; border-radius: 4px; position: relative; }
        .confidence-fill { height: 100%; border-radius: 4px; }
        .confidence-bar.high .confidence-fill { background: #16a34a; }
        .confidence-bar.medium .confidence-fill { background: #f59e0b; }
        .confidence-bar.low .confidence-fill { background: #dc2626; }
        .confidence-bar span { position: absolute; right: -35px; top: -3px; font-size: 12px; }

        .pagination { display: flex; justify-content: center; gap: 12px; margin-top: 20px; }
        .pagination button { padding: 8px 16px; border: 1px solid #e2e8f0; background: white; border-radius: 8px; cursor: pointer; }
        .pagination button:disabled { opacity: 0.5; cursor: not-allowed; }

        /* Review Page */
        .review-mode { display: flex; flex-direction: column; height: calc(100vh - 60px); }
        .review-header { display: flex; justify-content: space-between; margin-bottom: 20px; }
        .review-actions { display: flex; gap: 12px; }
        .review-container { display: grid; grid-template-columns: 1fr 400px; gap: 20px; flex: 1; overflow: hidden; }

        .document-preview { background: white; border-radius: 12px; display: flex; flex-direction: column; }
        .preview-toolbar { padding: 12px; border-bottom: 1px solid #e2e8f0; display: flex; gap: 8px; }
        .tool-btn { padding: 8px; border: 1px solid #e2e8f0; background: white; border-radius: 6px; cursor: pointer; }
        .preview-frame { flex: 1; overflow: hidden; }
        .preview-frame iframe { width: 100%; height: 100%; border: none; transform-origin: top left; }

        .extraction-panel { background: white; border-radius: 12px; padding: 20px; overflow-y: auto; }
        .confidence-banner { padding: 16px; border-radius: 8px; margin-bottom: 20px; }
        .confidence-banner.high { background: #dcfce7; }
        .confidence-banner.medium { background: #fef3c7; }
        .confidence-banner.low { background: #fee2e2; }
        .confidence-score { display: flex; align-items: center; gap: 16px; }
        .score-circle { width: 60px; height: 60px; }
        .score-circle svg { width: 100%; height: 100%; }
        .score-bg { fill: none; stroke: rgba(0,0,0,0.1); stroke-width: 3; }
        .score-fill { fill: none; stroke: currentColor; stroke-width: 3; stroke-linecap: round; }
        .confidence-banner.high .score-fill { stroke: #16a34a; }
        .confidence-banner.medium .score-fill { stroke: #f59e0b; }
        .confidence-banner.low .score-fill { stroke: #dc2626; }
        .score-text { font-size: 10px; font-weight: 600; text-anchor: middle; }
        .score-label { font-weight: 600; }

        .anomaly-warnings { margin-bottom: 20px; }
        .warning-item { display: flex; align-items: center; gap: 12px; padding: 12px; border-radius: 8px; background: #fef3c7; margin-bottom: 8px; }
        .warning-item.high { background: #fee2e2; }
        .warning-item i { color: #d97706; }
        .warning-item.high i { color: #dc2626; }

        .extracted-fields h3, .amount-fields h3, .line-items h3 { font-size: 14px; color: #64748b; margin-bottom: 16px; border-bottom: 1px solid #e2e8f0; padding-bottom: 8px; }
        .field-group { margin-bottom: 16px; }
        .field-group label { display: block; font-size: 12px; color: #64748b; margin-bottom: 4px; }
        .field-group input, .field-group select { width: 100%; padding: 10px 12px; border: 1px solid #e2e8f0; border-radius: 8px; font-size: 14px; }
        .field-row { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; }

        .amount-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 12px; }
        .amount-field { text-align: center; }
        .amount-field label { display: block; font-size: 12px; color: #64748b; margin-bottom: 4px; }
        .amount-field input { width: 100%; padding: 10px; border: 1px solid #e2e8f0; border-radius: 8px; text-align: right; }
        .amount-field.total input { background: #f8fafc; font-weight: 600; }

        .line-items { margin-top: 20px; }
        .line-items-table { width: 100%; border-collapse: collapse; font-size: 13px; }
        .line-items-table th, .line-items-table td { padding: 8px; border: 1px solid #e2e8f0; }
        .line-items-table th { background: #f8fafc; font-weight: 500; }
        .line-items-table input { width: 100%; padding: 6px; border: none; background: transparent; }

        /* Settings */
        .settings-grid { display: grid; grid-template-columns: repeat(2, 1fr); gap: 20px; }
        .settings-section { background: white; border-radius: 12px; padding: 24px; }
        .settings-section h3 { margin-bottom: 20px; display: flex; align-items: center; gap: 10px; }
        .setting-item { margin-bottom: 16px; display: flex; justify-content: space-between; align-items: center; }
        .setting-item label { font-weight: 500; }
        .setting-item input[type="range"] { width: 150px; }
        .setting-item select { padding: 8px 12px; border: 1px solid #e2e8f0; border-radius: 6px; }
        .settings-actions { margin-top: 24px; }

        @media (max-width: 1200px) {
            .stats-grid { grid-template-columns: repeat(2, 1fr); }
            .content-grid { grid-template-columns: 1fr; }
        }
        @media (max-width: 768px) {
            .sidebar { display: none; }
            .main-content { margin-left: 0; }
            .stats-grid { grid-template-columns: 1fr; }
            .review-container { grid-template-columns: 1fr; }
        }
        `;
    }

    return { onRequest };
});
