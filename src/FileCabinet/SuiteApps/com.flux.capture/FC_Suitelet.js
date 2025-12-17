/**
 * @NApiVersion 2.1
 * @NScriptType Suitelet
 * @NModuleScope SameAccount
 *
 * Flux Capture - Main Suitelet
 * Professional SPA interface with world-class design
 * Features: Client-side routing, no page reloads, NetSuite theme sync
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
        if (context.request.method !== 'GET') {
            context.response.write('Method not allowed');
            return;
        }

        try {
            const isInnerFrame = context.request.parameters.fc_mode === 'app';

            if (isInnerFrame) {
                serveAppContent(context);
            } else {
                serveWrapper(context);
            }
        } catch (error) {
            log.error('Suitelet Error', error);
            context.response.write(renderErrorPage(error.message));
        }
    }

    // ==================== Wrapper (NetSuite Integration) ====================

    function serveWrapper(context) {
        const form = serverWidget.createForm({ title: 'Flux Capture' });
        const currentScript = runtime.getCurrentScript();
        const action = context.request.parameters.action || 'dashboard';
        const docId = context.request.parameters.docId || '';

        let suiteletUrl = url.resolveScript({
            scriptId: currentScript.id,
            deploymentId: currentScript.deploymentId
        }) + '&fc_mode=app&action=' + action;

        if (docId) {
            suiteletUrl += '&docId=' + docId;
        }

        const field = form.addField({
            id: 'custpage_fc_frame',
            type: serverWidget.FieldType.INLINEHTML,
            label: ' '
        });

        field.defaultValue = `
            <style>
                #main_form > table:first-child,
                .uir-page-title-secondline,
                .uir-page-title,
                .uir-page-title-firstline,
                #main_form > tbody > tr:first-child,
                #main_form > table > tbody > tr:first-child {
                    visibility: hidden !important;
                    pointer-events: none !important;
                    height: 0 !important;
                    min-height: 0 !important;
                    max-height: 0 !important;
                    overflow: visible !important;
                    padding: 0 !important;
                    margin: 0 !important;
                    border: none !important;
                    line-height: 0 !important;
                    font-size: 0 !important;
                }

                .fc-frame-wrapper {
                    position: fixed;
                    left: 0;
                    right: 0;
                    bottom: 0;
                    top: 103px;
                    width: 100vw;
                    z-index: 100;
                    visibility: visible !important;
                    opacity: 1 !important;
                    pointer-events: auto !important;
                }

                .fc-iframe {
                    width: 100%;
                    height: 100%;
                    border: none;
                    display: block;
                    visibility: visible !important;
                    opacity: 1 !important;
                    pointer-events: auto !important;
                }
            </style>
            <div class="fc-frame-wrapper">
                <iframe src="${suiteletUrl}" class="fc-iframe" title="Flux Capture"></iframe>
            </div>
            <script>
                (function() {
                    function adjustIframePosition() {
                        var wrapper = document.querySelector('.fc-frame-wrapper');
                        if (!wrapper) return false;

                        var headerSelectors = [
                            '#div__header', '#ns-header', '#ns_navigation',
                            '.uir-page-header', '#nscm'
                        ];

                        var headerBottom = 0;
                        for (var i = 0; i < headerSelectors.length; i++) {
                            var header = document.querySelector(headerSelectors[i]);
                            if (header) {
                                var rect = header.getBoundingClientRect();
                                if (rect.bottom > headerBottom) {
                                    headerBottom = rect.bottom;
                                }
                            }
                        }

                        if (headerBottom === 0) {
                            var yPositions = [40, 60, 80, 100];
                            for (var j = 0; j < yPositions.length; j++) {
                                var elements = document.elementsFromPoint(window.innerWidth / 2, yPositions[j]);
                                for (var k = 0; k < elements.length; k++) {
                                    var el = elements[k];
                                    if (el.tagName === 'BODY' || el.tagName === 'HTML') continue;
                                    var rect = el.getBoundingClientRect();
                                    if (rect.bottom > headerBottom && rect.bottom < 200) {
                                        headerBottom = rect.bottom;
                                    }
                                }
                            }
                        }

                        if (headerBottom > 0) {
                            headerBottom = Math.max(80, Math.min(120, headerBottom));
                            wrapper.style.top = headerBottom + 'px';
                            return true;
                        }
                        return false;
                    }

                    var success = adjustIframePosition();
                    if (!success) {
                        [100, 200, 400, 800].forEach(function(delay) {
                            setTimeout(adjustIframePosition, delay);
                        });
                    }
                    window.addEventListener('resize', adjustIframePosition);
                })();
            </script>
        `;

        context.response.writePage(form);
    }

    // ==================== App Content (SPA) ====================

    function serveAppContent(context) {
        const { request } = context;
        const action = request.parameters.action || 'dashboard';
        const docId = request.parameters.docId || '';
        const statusFilter = request.parameters.status || '';
        const page = parseInt(request.parameters.page) || 1;

        // Load initial data for SPA
        const initialData = getInitialData(action, docId, statusFilter, page);
        const cssUrl = getCssFileUrl();
        const restletUrl = getRestletUrl();
        const user = runtime.getCurrentUser();

        const html = `
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Flux Capture</title>
    <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">
    <link href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css" rel="stylesheet">
    <link href="${cssUrl}" rel="stylesheet">
    <style>
        /* NetSuite Theme Override - Applied dynamically */
        .ns-theme-applied {
            --fc-primary: var(--ns-primary, #6366f1);
            --fc-primary-dark: var(--ns-primary-dark, #4f46e5);
            --fc-sidebar-bg: linear-gradient(180deg, var(--ns-primary-dark, #1e1b4b) 0%, var(--ns-primary, #312e81) 50%, color-mix(in srgb, var(--ns-primary, #3730a3) 80%, white) 100%);
        }
    </style>
</head>
<body>
    <div class="app-container" id="app">
        <!-- Sidebar -->
        <aside class="sidebar">
            <div class="sidebar-header">
                <div class="sidebar-logo">
                    <i class="fas fa-bolt"></i>
                </div>
                <div class="sidebar-brand">
                    <span class="sidebar-brand-name">Flux Capture</span>
                    <span class="sidebar-brand-tagline">Document AI</span>
                </div>
            </div>
            <nav class="sidebar-nav">
                <div class="nav-section">
                    <div class="nav-section-title">Main</div>
                    <a href="#" class="nav-item ${action === 'dashboard' ? 'active' : ''}" data-view="dashboard" onclick="FluxApp.navigate('dashboard'); return false;">
                        <i class="fas fa-th-large"></i>
                        <span>Dashboard</span>
                    </a>
                    <a href="#" class="nav-item ${action === 'upload' ? 'active' : ''}" data-view="upload" onclick="FluxApp.navigate('upload'); return false;">
                        <i class="fas fa-cloud-upload-alt"></i>
                        <span>Upload</span>
                    </a>
                    <a href="#" class="nav-item ${action === 'queue' ? 'active' : ''}" data-view="queue" onclick="FluxApp.navigate('queue'); return false;">
                        <i class="fas fa-inbox"></i>
                        <span>Queue</span>
                        <span class="badge" id="pendingBadge" style="display: ${(initialData.stats && initialData.stats.pending > 0) ? 'inline' : 'none'}">${(initialData.stats && initialData.stats.pending) || 0}</span>
                    </a>
                </div>
                <div class="nav-section">
                    <div class="nav-section-title">Manage</div>
                    <a href="#" class="nav-item ${action === 'batch' ? 'active' : ''}" data-view="batch" onclick="FluxApp.navigate('batch'); return false;">
                        <i class="fas fa-layer-group"></i>
                        <span>Batches</span>
                    </a>
                    <a href="#" class="nav-item ${action === 'settings' ? 'active' : ''}" data-view="settings" onclick="FluxApp.navigate('settings'); return false;">
                        <i class="fas fa-cog"></i>
                        <span>Settings</span>
                    </a>
                </div>
            </nav>
            <div class="sidebar-footer">
                <div class="sidebar-user">
                    <div class="sidebar-user-avatar">${getInitials(user.name)}</div>
                    <div class="sidebar-user-info">
                        <div class="sidebar-user-name">${user.name}</div>
                        <div class="sidebar-user-role">Administrator</div>
                    </div>
                </div>
            </div>
        </aside>

        <!-- Main Content -->
        <main class="main-content">
            <div id="viewContainer">
                ${renderView(action, initialData, docId)}
            </div>
        </main>
    </div>

    <!-- Loading Overlay -->
    <div class="loading-overlay" id="loadingOverlay" style="display: none;">
        <div class="loading-spinner"></div>
    </div>

    <script>
        // ==================== Flux Capture SPA Application ====================
        const FluxApp = (function() {
            const API_URL = '${restletUrl}';
            let currentView = '${action}';
            let viewCache = {};
            let pendingChanges = {};

            // Build API URL with query params (handles existing ? in URL)
            function buildApiUrl(params) {
                const queryString = new URLSearchParams(params).toString();
                const separator = API_URL.includes('?') ? '&' : '?';
                return API_URL + separator + queryString;
            }

            // Initialize
            function init() {
                syncNetSuiteTheme();
                setupEventListeners();
                initViewHandlers(currentView);
            }

            // NetSuite Theme Synchronization
            function syncNetSuiteTheme() {
                try {
                    if (window.parent && window.parent !== window) {
                        const parentDoc = window.parent.document;

                        // Try multiple header selectors
                        const headerSelectors = ['#div__header', '#ns-header', '#ns_navigation', '.ns-role-menubar'];
                        let primaryColor = null;

                        for (const selector of headerSelectors) {
                            const el = parentDoc.querySelector(selector);
                            if (el) {
                                const style = window.parent.getComputedStyle(el);
                                const bg = style.backgroundColor;
                                if (bg && bg !== 'rgba(0, 0, 0, 0)' && bg !== 'transparent') {
                                    primaryColor = bg;
                                    break;
                                }
                            }
                        }

                        if (primaryColor) {
                            document.documentElement.style.setProperty('--ns-primary', primaryColor);
                            document.documentElement.style.setProperty('--ns-primary-dark', adjustColor(primaryColor, -20));
                            document.body.classList.add('ns-theme-applied');
                        }
                    }
                } catch (e) {
                    console.log('Theme sync: using default colors');
                }
            }

            // Darken/lighten color
            function adjustColor(color, amount) {
                const match = color.match(/rgba?\\((\\d+),\\s*(\\d+),\\s*(\\d+)/);
                if (!match) return color;
                const r = Math.max(0, Math.min(255, parseInt(match[1]) + amount));
                const g = Math.max(0, Math.min(255, parseInt(match[2]) + amount));
                const b = Math.max(0, Math.min(255, parseInt(match[3]) + amount));
                return 'rgb(' + r + ', ' + g + ', ' + b + ')';
            }

            // Navigation - uses URL-based navigation for smooth iframe reloading
            function navigate(view, params) {
                params = params || {};
                if (view === currentView && !params.force) return;

                showLoading();

                // Build new URL with updated action parameter
                var urlParams = new URLSearchParams(window.location.search);
                urlParams.set('action', view);

                // Remove docId if navigating away from review
                if (view !== 'review') {
                    urlParams.delete('docId');
                }

                // Add any additional params
                if (params.status) {
                    urlParams.set('status', params.status);
                }
                if (params.page) {
                    urlParams.set('page', params.page);
                }
                if (params.docId) {
                    urlParams.set('docId', params.docId);
                }

                // Navigate by changing location (iframe reload is smooth)
                window.location.href = window.location.pathname + '?' + urlParams.toString();
            }

            // Review document - navigates to review view with docId
            function reviewDoc(docId) {
                navigate('review', { docId: docId, force: true });
            }

            // Filter queue - navigates with status filter
            function filterQueue(status) {
                navigate('queue', { status: status, force: true });
            }

            // Initialize view-specific handlers
            function initViewHandlers(view) {
                if (view === 'upload') {
                    initUploadHandlers();
                } else if (view === 'review') {
                    initReviewHandlers();
                }
            }

            // Upload handlers
            function initUploadHandlers() {
                const uploadZone = document.getElementById('uploadZone');
                const fileInput = document.getElementById('fileInput');

                if (!uploadZone || !fileInput) return;

                uploadZone.onclick = () => fileInput.click();
                uploadZone.ondragover = (e) => { e.preventDefault(); uploadZone.classList.add('dragover'); };
                uploadZone.ondragleave = () => uploadZone.classList.remove('dragover');
                uploadZone.ondrop = (e) => {
                    e.preventDefault();
                    uploadZone.classList.remove('dragover');
                    handleFiles(e.dataTransfer.files);
                };
                fileInput.onchange = (e) => handleFiles(e.target.files);

                document.querySelectorAll('.type-option').forEach(opt => {
                    opt.onclick = () => {
                        document.querySelectorAll('.type-option').forEach(o => o.classList.remove('active'));
                        opt.classList.add('active');
                        opt.querySelector('input').checked = true;
                    };
                });
            }

            // File handling
            let uploadFiles = [];

            function handleFiles(newFiles) {
                uploadFiles = [...uploadFiles, ...Array.from(newFiles)];
                renderUploadQueue();
            }

            function renderUploadQueue() {
                const queue = document.getElementById('uploadQueue');
                const list = document.getElementById('queueList');
                const count = document.getElementById('fileCount');

                if (!queue || !list) return;

                if (uploadFiles.length === 0) {
                    queue.hidden = true;
                    return;
                }

                queue.hidden = false;
                list.innerHTML = uploadFiles.map((f, i) =>
                    '<div class="queue-item">' +
                        '<i class="fas fa-file-pdf"></i>' +
                        '<span>' + f.name + '</span>' +
                        '<span class="file-size">' + (f.size / 1024 / 1024).toFixed(2) + ' MB</span>' +
                        '<button class="btn-icon" onclick="FluxApp.removeFile(' + i + ')"><i class="fas fa-times"></i></button>' +
                    '</div>'
                ).join('');

                if (count) count.textContent = uploadFiles.length;
            }

            function removeFile(index) {
                uploadFiles.splice(index, 1);
                renderUploadQueue();
            }

            function clearQueue() {
                uploadFiles = [];
                renderUploadQueue();
            }

            async function processQueue() {
                if (uploadFiles.length === 0) return;

                const progress = document.getElementById('uploadProgress');
                const queue = document.getElementById('uploadQueue');
                const progressTitle = document.getElementById('progressTitle');
                const progressText = document.getElementById('progressText');
                const progressFill = document.getElementById('progressFill');

                if (progress) progress.hidden = false;
                if (queue) queue.hidden = true;

                const docType = document.querySelector('input[name="docType"]:checked')?.value || 'auto';

                for (let i = 0; i < uploadFiles.length; i++) {
                    if (progressTitle) progressTitle.textContent = 'Uploading...';
                    if (progressText) progressText.textContent = 'Processing ' + (i + 1) + ' of ' + uploadFiles.length;
                    if (progressFill) progressFill.style.width = ((i + 1) / uploadFiles.length * 100) + '%';

                    const base64 = await readFileAsBase64(uploadFiles[i]);

                    try {
                        await fetch(API_URL, {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({
                                action: 'upload',
                                fileName: uploadFiles[i].name,
                                fileContent: base64,
                                documentType: docType
                            })
                        });
                    } catch (e) {
                        console.error('Upload error:', e);
                    }
                }

                if (progressTitle) progressTitle.textContent = 'Complete!';
                if (progressText) progressText.textContent = 'All files uploaded successfully';

                uploadFiles = [];
                setTimeout(() => navigate('queue'), 1500);
            }

            function readFileAsBase64(file) {
                return new Promise((resolve, reject) => {
                    const reader = new FileReader();
                    reader.onload = () => resolve(reader.result.split(',')[1]);
                    reader.onerror = reject;
                    reader.readAsDataURL(file);
                });
            }

            // Review handlers
            function initReviewHandlers() {
                // Zoom functionality
                window.zoomLevel = 1;
            }

            function trackChange(field, value) {
                pendingChanges[field] = value;
            }

            async function approveDocument(docId) {
                if (!confirm('Create transaction from this document?')) return;

                showLoading();

                try {
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
                        pendingChanges = {};
                        navigate('queue');
                    } else {
                        alert('Error: ' + (result.error?.message || 'Unknown error'));
                    }
                } finally {
                    hideLoading();
                }
            }

            async function rejectDocument(docId) {
                const reason = prompt('Reason for rejection:');
                if (!reason) return;

                showLoading();

                try {
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
                } finally {
                    hideLoading();
                }
            }

            function zoomIn() {
                window.zoomLevel = Math.min((window.zoomLevel || 1) + 0.25, 3);
                updateZoom();
            }

            function zoomOut() {
                window.zoomLevel = Math.max((window.zoomLevel || 1) - 0.25, 0.5);
                updateZoom();
            }

            function updateZoom() {
                const iframe = document.getElementById('docPreview');
                if (iframe) iframe.style.transform = 'scale(' + window.zoomLevel + ')';
            }

            function calculateTotal() {
                const subtotal = parseFloat(document.getElementById('subtotal')?.value) || 0;
                const tax = parseFloat(document.getElementById('taxAmount')?.value) || 0;
                const totalEl = document.getElementById('totalAmount');
                if (totalEl) totalEl.value = (subtotal + tax).toFixed(2);
            }

            // Queue actions
            function toggleSelectAll() {
                const checked = document.getElementById('selectAll')?.checked;
                document.querySelectorAll('.doc-select').forEach(cb => cb.checked = checked);
            }

            async function deleteDoc(docId) {
                if (!confirm('Delete this document?')) return;

                showLoading();
                try {
                    await fetch(API_URL, {
                        method: 'DELETE',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ action: 'delete', documentId: docId })
                    });
                    navigate('queue', { force: true });
                } finally {
                    hideLoading();
                }
            }

            function downloadFile(fileId) {
                window.open('/core/media/media.nl?id=' + fileId, '_blank');
            }

            function goToPage(page) {
                navigate('queue', { page: page, force: true });
            }

            // Utility functions
            function showLoading() {
                const overlay = document.getElementById('loadingOverlay');
                if (overlay) overlay.style.display = 'flex';
            }

            function hideLoading() {
                const overlay = document.getElementById('loadingOverlay');
                if (overlay) overlay.style.display = 'none';
            }

            function setupEventListeners() {
                // View container transitions (for any future animations)
                var container = document.getElementById('viewContainer');
                if (container) {
                    container.style.transition = 'opacity 0.15s ease, transform 0.15s ease';
                }
            }

            // Public API
            return {
                init,
                navigate,
                reviewDoc,
                filterQueue,
                handleFiles,
                removeFile,
                clearQueue,
                processQueue,
                trackChange,
                approveDocument,
                rejectDocument,
                zoomIn,
                zoomOut,
                calculateTotal,
                toggleSelectAll,
                deleteDoc,
                downloadFile,
                goToPage
            };
        })();

        // Initialize app
        document.addEventListener('DOMContentLoaded', FluxApp.init);
    </script>
</body>
</html>`;

        context.response.write(html);
    }

    // ==================== View Renderers ====================

    function renderView(action, data, docId) {
        switch (action) {
            case 'dashboard':
                return renderDashboardView(data);
            case 'upload':
                return renderUploadView();
            case 'queue':
                return renderQueueView(data);
            case 'review':
                return renderReviewView(data, docId);
            case 'batch':
                return renderBatchView(data);
            case 'settings':
                return renderSettingsView();
            default:
                return renderDashboardView(data);
        }
    }

    function renderDashboardView(data) {
        const stats = data.stats || { total: 0, pending: 0, completed: 0, autoRate: 0, totalValue: 0 };
        const recentDocs = data.recentDocs || [];
        const anomalies = data.anomalies || [];

        return `
            <header class="page-header">
                <div class="page-header-content">
                    <h1><i class="fas fa-th-large"></i> Dashboard</h1>
                    <p class="page-header-subtitle">AI-Powered Document Intelligence</p>
                </div>
                <div class="page-header-actions">
                    <button class="action-btn primary" onclick="FluxApp.navigate('upload')">
                        <i class="fas fa-cloud-upload-alt"></i> Upload Documents
                    </button>
                </div>
            </header>

            <div class="page-body">
                <div class="quick-actions">
                    <button class="action-btn primary" onclick="FluxApp.navigate('upload')">
                        <i class="fas fa-cloud-upload-alt"></i> Upload Documents
                    </button>
                    <button class="action-btn" onclick="FluxApp.navigate('queue')">
                        <i class="fas fa-inbox"></i> Processing Queue
                        ${stats.pending > 0 ? '<span class="badge">' + stats.pending + '</span>' : ''}
                    </button>
                </div>

                <div class="stats-grid">
                    <div class="stat-card blue">
                        <div class="stat-header">
                            <div class="stat-icon blue"><i class="fas fa-file-invoice"></i></div>
                        </div>
                        <div class="stat-content">
                            <span class="stat-value">${stats.total}</span>
                            <span class="stat-label">Documents Processed</span>
                        </div>
                    </div>
                    <div class="stat-card green">
                        <div class="stat-header">
                            <div class="stat-icon green"><i class="fas fa-check-circle"></i></div>
                            <span class="stat-trend up"><i class="fas fa-arrow-up"></i> ${stats.autoRate}%</span>
                        </div>
                        <div class="stat-content">
                            <span class="stat-value">${stats.completed}</span>
                            <span class="stat-label">Completed</span>
                        </div>
                        <div class="stat-footer">
                            <span class="stat-link">${stats.autoRate}% auto-processed</span>
                        </div>
                    </div>
                    <div class="stat-card orange">
                        <div class="stat-header">
                            <div class="stat-icon orange"><i class="fas fa-clock"></i></div>
                        </div>
                        <div class="stat-content">
                            <span class="stat-value">${stats.pending}</span>
                            <span class="stat-label">Pending Review</span>
                        </div>
                        <div class="stat-footer">
                            <a href="#" onclick="FluxApp.navigate('queue'); return false;" class="stat-link">Review Now <i class="fas fa-arrow-right"></i></a>
                        </div>
                    </div>
                    <div class="stat-card purple">
                        <div class="stat-header">
                            <div class="stat-icon purple"><i class="fas fa-dollar-sign"></i></div>
                        </div>
                        <div class="stat-content">
                            <span class="stat-value">$${formatNumber(stats.totalValue)}</span>
                            <span class="stat-label">Total Value (30d)</span>
                        </div>
                    </div>
                </div>

                <div class="content-grid">
                    <div class="card">
                        <div class="card-header">
                            <h3 class="card-title"><i class="fas fa-history"></i> Recent Documents</h3>
                            <a href="#" onclick="FluxApp.navigate('queue'); return false;">View All</a>
                        </div>
                        <div class="card-body">
                            ${recentDocs.length > 0 ? `
                                <div class="doc-list">
                                    ${recentDocs.map(doc => `
                                        <div class="doc-item" onclick="FluxApp.reviewDoc(${doc.id})">
                                            <div class="doc-icon ${getStatusClass(doc.status)}">
                                                <i class="fas fa-file-invoice"></i>
                                            </div>
                                            <div class="doc-info">
                                                <span class="doc-name">${escapeHtml(doc.vendorName || 'Unknown Vendor')}</span>
                                                <span class="doc-meta">${escapeHtml(doc.invoiceNumber || 'No #')} &bull; ${escapeHtml(doc.date)}</span>
                                            </div>
                                            <div class="doc-amount">$${formatNumber(doc.amount)}</div>
                                            <span class="status-badge ${getStatusClass(doc.status)}">${escapeHtml(doc.statusText)}</span>
                                        </div>
                                    `).join('')}
                                </div>
                            ` : `
                                <div class="empty-state">
                                    <div class="empty-state-icon"><i class="fas fa-inbox"></i></div>
                                    <h4 class="empty-state-title">No documents yet</h4>
                                    <p class="empty-state-description">Upload your first document to get started</p>
                                </div>
                            `}
                        </div>
                    </div>

                    <div class="card">
                        <div class="card-header">
                            <h3 class="card-title"><i class="fas fa-exclamation-triangle"></i> Anomaly Alerts</h3>
                            <span class="alert-count ${anomalies.length > 0 ? 'has-alerts' : ''}">${anomalies.length}</span>
                        </div>
                        <div class="card-body">
                            ${anomalies.length > 0 ? `
                                <div class="anomaly-list">
                                    ${anomalies.map(a => `
                                        <div class="anomaly-item ${a.severity || ''}">
                                            <i class="fas fa-exclamation-circle"></i>
                                            <div class="anomaly-info">
                                                <span class="anomaly-title">${escapeHtml(a.message)}</span>
                                                <span class="anomaly-meta">${escapeHtml(a.vendorName || 'Document')} &bull; ${escapeHtml(a.type)}</span>
                                            </div>
                                            <button class="btn-sm" onclick="FluxApp.reviewDoc(${a.documentId})">Review</button>
                                        </div>
                                    `).join('')}
                                </div>
                            ` : `
                                <div class="empty-state">
                                    <div class="empty-state-icon"><i class="fas fa-shield-alt"></i></div>
                                    <h4 class="empty-state-title">All Clear</h4>
                                    <p class="empty-state-description">No anomalies detected</p>
                                </div>
                            `}
                        </div>
                    </div>
                </div>
            </div>`;
    }

    function renderUploadView() {
        return `
            <header class="page-header">
                <div class="page-header-content">
                    <h1><i class="fas fa-cloud-upload-alt"></i> Upload Documents</h1>
                    <p class="page-header-subtitle">Drag & drop or click to upload</p>
                </div>
            </header>

            <div class="page-body">
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
                            <button class="btn-text" onclick="FluxApp.clearQueue()">Clear All</button>
                        </div>
                        <div class="queue-list" id="queueList"></div>
                        <div class="queue-actions">
                            <button class="btn" onclick="document.getElementById('fileInput').click()">
                                <i class="fas fa-plus"></i> Add More
                            </button>
                            <button class="btn primary" onclick="FluxApp.processQueue()">
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
            </div>`;
    }

    function renderQueueView(data) {
        const queue = data.queue || { documents: [], total: 0, totalPages: 0 };
        const page = data.page || 1;
        const statusFilter = data.statusFilter || '';

        return `
            <header class="page-header">
                <div class="page-header-content">
                    <h1><i class="fas fa-inbox"></i> Processing Queue</h1>
                    <p class="page-header-subtitle">${queue.total} documents</p>
                </div>
                <div class="page-header-actions">
                    <button class="btn" onclick="FluxApp.navigate('upload')">
                        <i class="fas fa-plus"></i> Upload
                    </button>
                </div>
            </header>

            <div class="page-body">
                <div class="queue-filters">
                    <div class="filter-tabs">
                        <button class="filter-tab ${!statusFilter ? 'active' : ''}" data-status="" onclick="FluxApp.filterQueue('')">All</button>
                        <button class="filter-tab ${statusFilter === 'pending' ? 'active' : ''}" data-status="pending" onclick="FluxApp.filterQueue('pending')">Pending</button>
                        <button class="filter-tab ${statusFilter === 'processing' ? 'active' : ''}" data-status="processing" onclick="FluxApp.filterQueue('processing')">Processing</button>
                        <button class="filter-tab ${statusFilter === 'review' ? 'active' : ''}" data-status="review" onclick="FluxApp.filterQueue('review')">Needs Review</button>
                        <button class="filter-tab ${statusFilter === 'completed' ? 'active' : ''}" data-status="completed" onclick="FluxApp.filterQueue('completed')">Completed</button>
                    </div>
                </div>

                <div class="queue-table">
                    <table>
                        <thead>
                            <tr>
                                <th style="width: 40px;"><input type="checkbox" id="selectAll" onchange="FluxApp.toggleSelectAll()"></th>
                                <th>Document</th>
                                <th>Vendor</th>
                                <th>Invoice #</th>
                                <th>Amount</th>
                                <th>Confidence</th>
                                <th>Status</th>
                                <th>Date</th>
                                <th style="width: 100px;">Actions</th>
                            </tr>
                        </thead>
                        <tbody>
                            ${queue.documents.length > 0 ? queue.documents.map(doc => `
                                <tr class="${doc.hasAnomalies ? 'has-anomaly' : ''}">
                                    <td><input type="checkbox" class="doc-select" value="${doc.id}"></td>
                                    <td class="doc-name-cell">${escapeHtml(doc.name)}</td>
                                    <td>${escapeHtml(doc.vendorName || '-')}</td>
                                    <td>${escapeHtml(doc.invoiceNumber || '-')}</td>
                                    <td><strong>$${formatNumber(doc.amount)}</strong></td>
                                    <td>
                                        <div class="confidence-bar ${getConfidenceClass(doc.confidence)}">
                                            <div class="confidence-fill" style="width: ${doc.confidence}%"></div>
                                            <span>${doc.confidence}%</span>
                                        </div>
                                    </td>
                                    <td><span class="status-badge ${getStatusClass(doc.status)}">${escapeHtml(doc.statusText)}</span></td>
                                    <td>${escapeHtml(doc.date)}</td>
                                    <td>
                                        <button class="btn-icon" onclick="FluxApp.reviewDoc(${doc.id})" title="Review">
                                            <i class="fas fa-eye"></i>
                                        </button>
                                        <button class="btn-icon" onclick="FluxApp.deleteDoc(${doc.id})" title="Delete">
                                            <i class="fas fa-trash"></i>
                                        </button>
                                    </td>
                                </tr>
                            `).join('') : `
                                <tr>
                                    <td colspan="9" style="text-align: center; padding: 60px;">
                                        <div class="empty-state">
                                            <div class="empty-state-icon"><i class="fas fa-inbox"></i></div>
                                            <h4 class="empty-state-title">No documents found</h4>
                                            <p class="empty-state-description">Upload documents to get started</p>
                                        </div>
                                    </td>
                                </tr>
                            `}
                        </tbody>
                    </table>
                </div>

                ${queue.totalPages > 1 ? `
                    <div class="pagination">
                        <button ${page <= 1 ? 'disabled' : ''} onclick="FluxApp.goToPage(${page - 1})">
                            <i class="fas fa-chevron-left"></i>
                        </button>
                        <span>Page ${page} of ${queue.totalPages}</span>
                        <button ${page >= queue.totalPages ? 'disabled' : ''} onclick="FluxApp.goToPage(${page + 1})">
                            <i class="fas fa-chevron-right"></i>
                        </button>
                    </div>
                ` : ''}
            </div>`;
    }

    function renderReviewView(data, docId) {
        const doc = data.document || {};

        if (!doc.id) {
            return `
                <div class="page-body">
                    <div class="empty-state">
                        <div class="empty-state-icon"><i class="fas fa-file-alt"></i></div>
                        <h4 class="empty-state-title">Document not found</h4>
                        <p class="empty-state-description">The requested document could not be loaded</p>
                        <button class="btn primary" onclick="FluxApp.navigate('queue')">Back to Queue</button>
                    </div>
                </div>`;
        }

        return `
            <div class="review-mode">
                <div class="review-header">
                    <button class="btn-back" onclick="FluxApp.navigate('queue')">
                        <i class="fas fa-arrow-left"></i> Back to Queue
                    </button>
                    <div class="review-actions">
                        <button class="btn danger" onclick="FluxApp.rejectDocument(${doc.id})">
                            <i class="fas fa-times"></i> Reject
                        </button>
                        <button class="btn success" onclick="FluxApp.approveDocument(${doc.id})">
                            <i class="fas fa-check"></i> Approve & Create
                        </button>
                    </div>
                </div>

                <div class="review-container">
                    <div class="document-preview">
                        <div class="preview-toolbar">
                            <button class="tool-btn" onclick="FluxApp.zoomIn()"><i class="fas fa-search-plus"></i></button>
                            <button class="tool-btn" onclick="FluxApp.zoomOut()"><i class="fas fa-search-minus"></i></button>
                            <button class="tool-btn" onclick="FluxApp.downloadFile(${doc.fileId})"><i class="fas fa-download"></i></button>
                        </div>
                        <div class="preview-frame">
                            ${doc.fileUrl ? `<iframe src="${doc.fileUrl}" id="docPreview"></iframe>` : '<p style="padding: 40px; text-align: center; color: #666;">No preview available</p>'}
                        </div>
                    </div>

                    <div class="extraction-panel">
                        <div class="confidence-banner ${(doc.confidenceLevel || 'low').toLowerCase()}">
                            <div class="confidence-score">
                                <div class="score-circle">
                                    <svg viewBox="0 0 36 36">
                                        <path class="score-bg" d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831"/>
                                        <path class="score-fill" stroke-dasharray="${doc.confidence || 0}, 100" d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831"/>
                                        <text x="18" y="21" class="score-text">${doc.confidence || 0}%</text>
                                    </svg>
                                </div>
                                <span class="score-label">${doc.confidenceLevel || 'Low'} Confidence</span>
                            </div>
                        </div>

                        ${(doc.anomalies || []).length > 0 ? `
                            <div class="anomaly-warnings">
                                ${doc.anomalies.map(a => `
                                    <div class="warning-item ${a.severity || ''}">
                                        <i class="fas fa-exclamation-triangle"></i>
                                        <span>${escapeHtml(a.message)}</span>
                                    </div>
                                `).join('')}
                            </div>
                        ` : ''}

                        <div class="extracted-fields">
                            <h3>Extracted Information</h3>

                            <div class="field-group">
                                <label>Vendor</label>
                                <select id="vendor" onchange="FluxApp.trackChange('vendor', this.value)">
                                    <option value="">-- Select Vendor --</option>
                                    ${(doc.vendorSuggestions || []).map(v => `
                                        <option value="${v.id}" ${v.id == doc.vendorId ? 'selected' : ''}>${escapeHtml(v.name)}</option>
                                    `).join('')}
                                </select>
                            </div>

                            <div class="field-row">
                                <div class="field-group">
                                    <label>Invoice Number</label>
                                    <input type="text" id="invoiceNumber" value="${escapeHtml(doc.invoiceNumber || '')}" onchange="FluxApp.trackChange('invoiceNumber', this.value)">
                                </div>
                                <div class="field-group">
                                    <label>Invoice Date</label>
                                    <input type="date" id="invoiceDate" value="${formatDateInput(doc.invoiceDate)}" onchange="FluxApp.trackChange('invoiceDate', this.value)">
                                </div>
                            </div>

                            <div class="field-row">
                                <div class="field-group">
                                    <label>Due Date</label>
                                    <input type="date" id="dueDate" value="${formatDateInput(doc.dueDate)}" onchange="FluxApp.trackChange('dueDate', this.value)">
                                </div>
                                <div class="field-group">
                                    <label>PO Number</label>
                                    <input type="text" id="poNumber" value="${escapeHtml(doc.poNumber || '')}" onchange="FluxApp.trackChange('poNumber', this.value)">
                                </div>
                            </div>
                        </div>

                        <div class="amount-fields">
                            <h3>Amounts</h3>
                            <div class="amount-grid">
                                <div class="amount-field">
                                    <label>Subtotal</label>
                                    <input type="number" step="0.01" id="subtotal" value="${doc.subtotal || 0}" onchange="FluxApp.trackChange('subtotal', this.value); FluxApp.calculateTotal()">
                                </div>
                                <div class="amount-field">
                                    <label>Tax</label>
                                    <input type="number" step="0.01" id="taxAmount" value="${doc.taxAmount || 0}" onchange="FluxApp.trackChange('taxAmount', this.value); FluxApp.calculateTotal()">
                                </div>
                                <div class="amount-field total">
                                    <label>Total</label>
                                    <input type="number" step="0.01" id="totalAmount" value="${doc.totalAmount || 0}" onchange="FluxApp.trackChange('totalAmount', this.value)">
                                </div>
                            </div>
                        </div>

                        ${(doc.lineItems || []).length > 0 ? `
                            <div class="line-items">
                                <h3>Line Items (${doc.lineItems.length})</h3>
                                <table class="line-items-table">
                                    <thead>
                                        <tr>
                                            <th>Description</th>
                                            <th style="width: 60px;">Qty</th>
                                            <th style="width: 80px;">Price</th>
                                            <th style="width: 80px;">Amount</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        ${doc.lineItems.map((item, i) => `
                                            <tr>
                                                <td><input type="text" value="${escapeHtml(item.description || '')}"></td>
                                                <td><input type="number" value="${item.quantity || 0}"></td>
                                                <td><input type="number" step="0.01" value="${item.unitPrice || 0}"></td>
                                                <td><input type="number" step="0.01" value="${item.amount || 0}"></td>
                                            </tr>
                                        `).join('')}
                                    </tbody>
                                </table>
                            </div>
                        ` : ''}
                    </div>
                </div>
            </div>`;
    }

    function renderBatchView(data) {
        const batches = data.batches || [];

        return `
            <header class="page-header">
                <div class="page-header-content">
                    <h1><i class="fas fa-layer-group"></i> Batch Processing</h1>
                    <p class="page-header-subtitle">Process multiple documents at once</p>
                </div>
            </header>

            <div class="page-body">
                <div class="batch-upload">
                    <div class="upload-zone" id="batchZone" onclick="document.getElementById('batchInput').click()">
                        <div class="upload-content">
                            <i class="fas fa-layer-group upload-icon"></i>
                            <h2>Upload Batch</h2>
                            <p>Drop multiple files here for batch processing</p>
                        </div>
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
                                <th style="width: 80px;">Actions</th>
                            </tr>
                        </thead>
                        <tbody>
                            ${batches.length > 0 ? batches.map(b => `
                                <tr>
                                    <td><strong>${escapeHtml(b.name)}</strong></td>
                                    <td>${b.processed}/${b.total}</td>
                                    <td>
                                        <div class="progress-bar" style="width: 120px; display: inline-block;">
                                            <div class="progress-fill" style="width: ${b.progress}%"></div>
                                        </div>
                                    </td>
                                    <td><span class="status-badge ${b.status}">${escapeHtml(b.statusText)}</span></td>
                                    <td>${escapeHtml(b.date)}</td>
                                    <td>
                                        <button class="btn-icon"><i class="fas fa-eye"></i></button>
                                    </td>
                                </tr>
                            `).join('') : `
                                <tr>
                                    <td colspan="6" style="text-align: center; padding: 40px;">
                                        <div class="empty-state">
                                            <div class="empty-state-icon"><i class="fas fa-layer-group"></i></div>
                                            <h4 class="empty-state-title">No batches yet</h4>
                                            <p class="empty-state-description">Upload multiple files to create a batch</p>
                                        </div>
                                    </td>
                                </tr>
                            `}
                        </tbody>
                    </table>
                </div>
            </div>`;
    }

    function renderSettingsView() {
        return `
            <header class="page-header">
                <div class="page-header-content">
                    <h1><i class="fas fa-cog"></i> Settings</h1>
                    <p class="page-header-subtitle">Configure Flux Capture</p>
                </div>
            </header>

            <div class="page-body">
                <div class="settings-grid">
                    <div class="settings-section">
                        <h3><i class="fas fa-robot"></i> Processing</h3>
                        <div class="setting-item">
                            <label>Auto-approve Threshold</label>
                            <div style="display: flex; align-items: center; gap: 12px;">
                                <input type="range" min="70" max="100" value="85" id="autoThreshold" oninput="document.getElementById('thresholdValue').textContent = this.value + '%'">
                                <span id="thresholdValue" style="min-width: 45px;">85%</span>
                            </div>
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
                            <label class="toggle-switch">
                                <input type="checkbox" id="emailEnabled" checked>
                                <span class="toggle-slider"></span>
                            </label>
                        </div>
                        <div class="setting-item">
                            <label>Import Address</label>
                            <input type="text" value="flux-${runtime.accountId}@netsuite.com" readonly style="width: 250px;">
                        </div>
                    </div>

                    <div class="settings-section">
                        <h3><i class="fas fa-shield-alt"></i> Fraud Detection</h3>
                        <div class="setting-item">
                            <label>Duplicate Detection</label>
                            <label class="toggle-switch">
                                <input type="checkbox" id="duplicateDetection" checked>
                                <span class="toggle-slider"></span>
                            </label>
                        </div>
                        <div class="setting-item">
                            <label>Amount Validation</label>
                            <label class="toggle-switch">
                                <input type="checkbox" id="amountValidation" checked>
                                <span class="toggle-slider"></span>
                            </label>
                        </div>
                    </div>

                    <div class="settings-section">
                        <h3><i class="fas fa-bell"></i> Notifications</h3>
                        <div class="setting-item">
                            <label>Email Notifications</label>
                            <label class="toggle-switch">
                                <input type="checkbox" id="emailNotifications" checked>
                                <span class="toggle-slider"></span>
                            </label>
                        </div>
                        <div class="setting-item">
                            <label>Anomaly Alerts</label>
                            <label class="toggle-switch">
                                <input type="checkbox" id="anomalyAlerts" checked>
                                <span class="toggle-slider"></span>
                            </label>
                        </div>
                    </div>
                </div>

                <div class="settings-actions">
                    <button class="btn primary" onclick="alert('Settings saved!')">
                        <i class="fas fa-save"></i> Save Settings
                    </button>
                </div>
            </div>`;
    }

    // ==================== Data Functions ====================

    function getInitialData(action, docId, statusFilter, page) {
        const data = {};

        try {
            data.stats = getDashboardStats();
            data.recentDocs = getRecentDocuments(8);
            data.anomalies = getRecentAnomalies(5);

            if (action === 'queue') {
                data.queue = getProcessingQueue(page || 1, 25, statusFilter || '');
                data.page = page || 1;
                data.statusFilter = statusFilter || '';
            }

            if (action === 'review' && docId) {
                data.document = getDocumentDetails(docId);
            }

            if (action === 'batch') {
                data.batches = getBatches(10);
            }
        } catch (e) {
            log.error('getInitialData', e);
        }

        return data;
    }

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
            const row = result.results && result.results[0] ? result.results[0] : null;
            const vals = row && row.values ? row.values : [0, 0, 0, 0, 0];

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

            const statusMap = { 'pending': '1', 'processing': '2', 'review': '4', 'completed': '6' };
            if (statusFilter && statusMap[statusFilter]) {
                sql += ` AND custrecord_dm_status = ${statusMap[statusFilter]}`;
            }

            sql += ` ORDER BY custrecord_dm_created_date DESC`;
            sql += ` OFFSET ${(page - 1) * pageSize} ROWS FETCH NEXT ${pageSize} ROWS ONLY`;

            const result = query.runSuiteQL({ query: sql });

            const countSql = 'SELECT COUNT(*) FROM customrecord_dm_captured_document WHERE 1=1';
            const countResult = query.runSuiteQL({ query: countSql });
            const countRow = countResult.results && countResult.results[0] ? countResult.results[0] : null;
            const total = countRow && countRow.values ? countRow.values[0] : 0;

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

    function getCssFileUrl() {
        try {
            const cssFile = file.load({
                id: '/SuiteApps/com.flux.capture/FC_Styles.css'
            });
            return cssFile.url;
        } catch (e) {
            log.error('CSS Load Error', e);
            return '';
        }
    }

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

    function getInitials(name) {
        if (!name) return 'U';
        const parts = name.split(' ');
        if (parts.length >= 2) {
            return (parts[0][0] + parts[1][0]).toUpperCase();
        }
        return name.substring(0, 2).toUpperCase();
    }

    function escapeHtml(str) {
        if (!str) return '';
        return String(str)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#039;');
    }

    function renderErrorPage(message) {
        return `
<!DOCTYPE html>
<html><head><title>Error</title>
<style>
body { font-family: 'Inter', sans-serif; padding: 60px; text-align: center; background: #f8fafc; }
.error-container { max-width: 400px; margin: 0 auto; background: white; padding: 40px; border-radius: 16px; box-shadow: 0 4px 6px rgba(0,0,0,0.1); }
h1 { color: #ef4444; margin-bottom: 16px; }
p { color: #64748b; margin-bottom: 24px; }
a { color: #6366f1; text-decoration: none; font-weight: 600; }
</style>
</head>
<body>
<div class="error-container">
    <h1>Error</h1>
    <p>${escapeHtml(message)}</p>
    <a href="#" onclick="history.back()">Go Back</a>
</div>
</body></html>`;
    }

    return { onRequest };
});
