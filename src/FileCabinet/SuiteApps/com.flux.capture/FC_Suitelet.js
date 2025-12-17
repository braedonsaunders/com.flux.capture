/**
 * @NApiVersion 2.1
 * @NScriptType Suitelet
 * @NModuleScope SameAccount
 *
 * Flux Capture - Main Suitelet
 * Serves a true Single Page Application with client-side routing
 */

define([
    'N/ui/serverWidget',
    'N/runtime',
    'N/file',
    'N/url'
], function(serverWidget, runtime, file, url) {

    'use strict';

    function onRequest(context) {
        if (context.request.method !== 'GET') {
            context.response.write('Method not allowed');
            return;
        }

        try {
            const isInnerFrame = context.request.parameters.fc_mode === 'app';

            if (isInnerFrame) {
                serveApp(context);
            } else {
                serveWrapper(context);
            }
        } catch (error) {
            log.error('Suitelet Error', error);
            context.response.write('<h1>Error</h1><p>' + error.message + '</p>');
        }
    }

    /**
     * Serve the wrapper page that embeds the SPA in an iframe
     */
    function serveWrapper(context) {
        const form = serverWidget.createForm({ title: 'Flux Capture' });
        const currentScript = runtime.getCurrentScript();
        const action = context.request.parameters.action || 'dashboard';

        const suiteletUrl = url.resolveScript({
            scriptId: currentScript.id,
            deploymentId: currentScript.deploymentId
        }) + '&fc_mode=app&action=' + action;

        const field = form.addField({
            id: 'custpage_fc_frame',
            type: serverWidget.FieldType.INLINEHTML,
            label: ' '
        });

        field.defaultValue = getWrapperHTML(suiteletUrl);
        context.response.writePage(form);
    }

    /**
     * Serve the main SPA application
     */
    function serveApp(context) {
        const cssUrl = getCssFileUrl();
        const apiUrl = getRestletUrl();
        const user = runtime.getCurrentUser();
        const initialAction = context.request.parameters.action || 'dashboard';

        const html = buildAppHTML(cssUrl, apiUrl, user, initialAction);
        context.response.write(html);
    }

    /**
     * Build the wrapper HTML that embeds the iframe
     */
    function getWrapperHTML(suiteletUrl) {
        return `
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
                }
                .fc-iframe {
                    width: 100%;
                    height: 100%;
                    border: none;
                    display: block;
                }
            </style>
            <div class="fc-frame-wrapper">
                <iframe src="${suiteletUrl}" class="fc-iframe" title="Flux Capture"></iframe>
            </div>
            <script>
                (function() {
                    function adjustIframePosition() {
                        var wrapper = document.querySelector('.fc-frame-wrapper');
                        if (!wrapper) return;
                        var headerSelectors = ['#div__header', '#ns-header', '#ns_navigation', '.uir-page-header'];
                        var headerBottom = 0;
                        for (var i = 0; i < headerSelectors.length; i++) {
                            var header = document.querySelector(headerSelectors[i]);
                            if (header) {
                                var rect = header.getBoundingClientRect();
                                if (rect.bottom > headerBottom) headerBottom = rect.bottom;
                            }
                        }
                        if (headerBottom > 0) {
                            headerBottom = Math.max(80, Math.min(120, headerBottom));
                            wrapper.style.top = headerBottom + 'px';
                        }
                    }
                    adjustIframePosition();
                    [100, 200, 400, 800].forEach(function(d) { setTimeout(adjustIframePosition, d); });
                    window.addEventListener('resize', adjustIframePosition);
                })();
            </script>
        `;
    }

    /**
     * Build the main SPA HTML
     */
    function buildAppHTML(cssUrl, apiUrl, user, initialAction) {
        const userInitials = getInitials(user.name);

        return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Flux Capture</title>
    <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">
    <link href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css" rel="stylesheet">
    <link href="${cssUrl}" rel="stylesheet">
</head>
<body>
    <div class="app-container" id="app">
        <!-- Sidebar -->
        <aside class="sidebar">
            <div class="sidebar-header">
                <div class="sidebar-logo"><i class="fas fa-bolt"></i></div>
                <div class="sidebar-brand">
                    <span class="sidebar-brand-name">Flux Capture</span>
                    <span class="sidebar-brand-tagline">Document AI</span>
                </div>
            </div>
            <nav class="sidebar-nav">
                <div class="nav-section">
                    <div class="nav-section-title">Main</div>
                    <a href="#" class="nav-item" data-view="dashboard">
                        <i class="fas fa-th-large"></i>
                        <span>Dashboard</span>
                    </a>
                    <a href="#" class="nav-item" data-view="upload">
                        <i class="fas fa-cloud-upload-alt"></i>
                        <span>Upload</span>
                    </a>
                    <a href="#" class="nav-item" data-view="queue">
                        <i class="fas fa-inbox"></i>
                        <span>Queue</span>
                        <span class="badge" id="queueBadge" style="display: none;">0</span>
                    </a>
                </div>
                <div class="nav-section">
                    <div class="nav-section-title">Manage</div>
                    <a href="#" class="nav-item" data-view="batch">
                        <i class="fas fa-layer-group"></i>
                        <span>Batches</span>
                    </a>
                    <a href="#" class="nav-item" data-view="settings">
                        <i class="fas fa-cog"></i>
                        <span>Settings</span>
                    </a>
                </div>
            </nav>
            <div class="sidebar-footer">
                <div class="sidebar-user">
                    <div class="sidebar-user-avatar">${userInitials}</div>
                    <div class="sidebar-user-info">
                        <div class="sidebar-user-name">${escapeHtml(user.name)}</div>
                        <div class="sidebar-user-role">Administrator</div>
                    </div>
                </div>
            </div>
        </aside>

        <!-- Main Content -->
        <main class="main-content">
            <div id="viewContainer" class="view-container"></div>
        </main>
    </div>

    <!-- Loading Overlay -->
    <div class="loading-overlay" id="loadingOverlay">
        <div class="loading-spinner"></div>
    </div>

    <!-- Toast Container -->
    <div id="toastContainer" class="toast-container"></div>

    <script>
    /**
     * Flux Capture SPA Application
     * A true single-page application with client-side routing and rendering
     */
    (function() {
        'use strict';

        // ==================== Configuration ====================
        var CONFIG = {
            API_URL: '${apiUrl}',
            INITIAL_VIEW: '${initialAction}'
        };

        // ==================== State Management ====================
        var State = {
            currentView: null,
            currentParams: {},
            cache: {},
            pendingChanges: {},
            uploadFiles: []
        };

        // ==================== API Client ====================
        var API = {
            buildUrl: function(params) {
                var qs = Object.keys(params).map(function(k) {
                    return encodeURIComponent(k) + '=' + encodeURIComponent(params[k]);
                }).join('&');
                var sep = CONFIG.API_URL.indexOf('?') >= 0 ? '&' : '?';
                return CONFIG.API_URL + sep + qs;
            },

            get: function(action, params) {
                params = params || {};
                params.action = action;
                return fetch(this.buildUrl(params))
                    .then(function(r) { return r.json(); })
                    .then(function(data) {
                        if (!data.success) throw new Error(data.error ? data.error.message : 'API Error');
                        return data.data;
                    });
            },

            post: function(action, body) {
                body = body || {};
                body.action = action;
                return fetch(CONFIG.API_URL, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(body)
                })
                .then(function(r) { return r.json(); })
                .then(function(data) {
                    if (!data.success) throw new Error(data.error ? data.error.message : 'API Error');
                    return data.data;
                });
            },

            put: function(action, body) {
                body = body || {};
                body.action = action;
                return fetch(CONFIG.API_URL, {
                    method: 'PUT',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(body)
                })
                .then(function(r) { return r.json(); })
                .then(function(data) {
                    if (!data.success) throw new Error(data.error ? data.error.message : 'API Error');
                    return data.data;
                });
            },

            delete: function(action, body) {
                body = body || {};
                body.action = action;
                return fetch(CONFIG.API_URL, {
                    method: 'DELETE',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(body)
                })
                .then(function(r) { return r.json(); })
                .then(function(data) {
                    if (!data.success) throw new Error(data.error ? data.error.message : 'API Error');
                    return data.data;
                });
            }
        };

        // ==================== Utilities ====================
        var Utils = {
            escapeHtml: function(str) {
                if (!str) return '';
                return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
            },

            formatNumber: function(num) {
                return (num || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
            },

            formatDate: function(date) {
                if (!date) return '';
                var d = new Date(date);
                return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
            },

            formatDateInput: function(date) {
                if (!date) return '';
                var d = new Date(date);
                return d.toISOString().split('T')[0];
            },

            getStatusClass: function(status) {
                var classes = { 1: 'pending', 2: 'processing', 3: 'extracted', 4: 'review', 5: 'rejected', 6: 'completed', 7: 'error' };
                return classes[status] || 'pending';
            },

            getConfidenceClass: function(conf) {
                if (conf >= 85) return 'high';
                if (conf >= 60) return 'medium';
                return 'low';
            }
        };

        // ==================== UI Helpers ====================
        var UI = {
            showLoading: function() {
                document.getElementById('loadingOverlay').classList.add('visible');
            },

            hideLoading: function() {
                document.getElementById('loadingOverlay').classList.remove('visible');
            },

            toast: function(message, type) {
                type = type || 'info';
                var container = document.getElementById('toastContainer');
                var toast = document.createElement('div');
                toast.className = 'toast toast-' + type;
                toast.innerHTML = '<i class="fas fa-' + (type === 'success' ? 'check-circle' : type === 'error' ? 'exclamation-circle' : 'info-circle') + '"></i><span>' + Utils.escapeHtml(message) + '</span>';
                container.appendChild(toast);
                setTimeout(function() { toast.classList.add('visible'); }, 10);
                setTimeout(function() {
                    toast.classList.remove('visible');
                    setTimeout(function() { toast.remove(); }, 300);
                }, 3000);
            },

            updateBadge: function(count) {
                var badge = document.getElementById('queueBadge');
                if (badge) {
                    badge.textContent = count;
                    badge.style.display = count > 0 ? 'inline' : 'none';
                }
            }
        };

        // ==================== Router ====================
        var Router = {
            navigate: function(view, params, pushState) {
                params = params || {};
                if (pushState !== false) {
                    var url = new URL(window.location.href);
                    url.searchParams.set('action', view);
                    Object.keys(params).forEach(function(k) {
                        if (params[k]) url.searchParams.set(k, params[k]);
                        else url.searchParams.delete(k);
                    });
                    // Clean up params not in current navigation
                    if (view !== 'review') url.searchParams.delete('docId');
                    if (view !== 'queue') {
                        url.searchParams.delete('status');
                        url.searchParams.delete('page');
                    }
                    history.pushState({ view: view, params: params }, '', url.toString());
                }

                State.currentView = view;
                State.currentParams = params;

                // Update active nav item
                document.querySelectorAll('.nav-item').forEach(function(item) {
                    item.classList.toggle('active', item.dataset.view === view);
                });

                // Render the view
                Views.render(view, params);
            },

            init: function() {
                var self = this;

                // Handle browser back/forward
                window.addEventListener('popstate', function(e) {
                    if (e.state && e.state.view) {
                        self.navigate(e.state.view, e.state.params, false);
                    }
                });

                // Handle nav clicks
                document.querySelectorAll('.nav-item').forEach(function(item) {
                    item.addEventListener('click', function(e) {
                        e.preventDefault();
                        self.navigate(this.dataset.view);
                    });
                });

                // Initial navigation
                this.navigate(CONFIG.INITIAL_VIEW, {}, true);
            }
        };

        // ==================== View Templates ====================
        var Templates = {
            dashboard: function(data) {
                var stats = data.summary || {};
                var docs = data.recentDocs || [];
                var anomalies = data.anomalies || [];

                return '<header class="page-header">' +
                    '<div class="page-header-content">' +
                        '<h1><i class="fas fa-th-large"></i> Dashboard</h1>' +
                        '<p class="page-header-subtitle">AI-Powered Document Intelligence</p>' +
                    '</div>' +
                    '<div class="page-header-actions">' +
                        '<button class="action-btn primary" onclick="FluxApp.navigate(\\'upload\\')"><i class="fas fa-cloud-upload-alt"></i> Upload Documents</button>' +
                    '</div>' +
                '</header>' +
                '<div class="page-body">' +
                    '<div class="stats-grid">' +
                        '<div class="stat-card blue"><div class="stat-header"><div class="stat-icon blue"><i class="fas fa-file-invoice"></i></div></div><div class="stat-content"><span class="stat-value">' + (stats.totalProcessed || 0) + '</span><span class="stat-label">Documents Processed</span></div></div>' +
                        '<div class="stat-card green"><div class="stat-header"><div class="stat-icon green"><i class="fas fa-check-circle"></i></div><span class="stat-trend up"><i class="fas fa-arrow-up"></i> ' + (stats.autoProcessRate || 0) + '%</span></div><div class="stat-content"><span class="stat-value">' + (stats.completed || 0) + '</span><span class="stat-label">Completed</span></div></div>' +
                        '<div class="stat-card orange"><div class="stat-header"><div class="stat-icon orange"><i class="fas fa-clock"></i></div></div><div class="stat-content"><span class="stat-value">' + (stats.pendingReview || 0) + '</span><span class="stat-label">Pending Review</span></div><div class="stat-footer"><a href="#" onclick="FluxApp.navigate(\\'queue\\'); return false;" class="stat-link">Review Now <i class="fas fa-arrow-right"></i></a></div></div>' +
                        '<div class="stat-card purple"><div class="stat-header"><div class="stat-icon purple"><i class="fas fa-dollar-sign"></i></div></div><div class="stat-content"><span class="stat-value">$' + Utils.formatNumber(stats.totalValue) + '</span><span class="stat-label">Total Value (30d)</span></div></div>' +
                    '</div>' +
                    '<div class="content-grid">' +
                        '<div class="card">' +
                            '<div class="card-header"><h3 class="card-title"><i class="fas fa-history"></i> Recent Documents</h3><a href="#" onclick="FluxApp.navigate(\\'queue\\'); return false;">View All</a></div>' +
                            '<div class="card-body">' + this.recentDocsList(docs) + '</div>' +
                        '</div>' +
                        '<div class="card">' +
                            '<div class="card-header"><h3 class="card-title"><i class="fas fa-exclamation-triangle"></i> Anomaly Alerts</h3><span class="alert-count ' + (anomalies.length > 0 ? 'has-alerts' : '') + '">' + anomalies.length + '</span></div>' +
                            '<div class="card-body">' + this.anomaliesList(anomalies) + '</div>' +
                        '</div>' +
                    '</div>' +
                '</div>';
            },

            recentDocsList: function(docs) {
                if (!docs || docs.length === 0) {
                    return '<div class="empty-state"><div class="empty-state-icon"><i class="fas fa-inbox"></i></div><h4 class="empty-state-title">No documents yet</h4><p class="empty-state-description">Upload your first document to get started</p></div>';
                }
                return '<div class="doc-list">' + docs.map(function(doc) {
                    return '<div class="doc-item" onclick="FluxApp.reviewDoc(' + doc.id + ')">' +
                        '<div class="doc-icon ' + Utils.getStatusClass(doc.status) + '"><i class="fas fa-file-invoice"></i></div>' +
                        '<div class="doc-info"><span class="doc-name">' + Utils.escapeHtml(doc.vendorName || 'Unknown Vendor') + '</span><span class="doc-meta">' + Utils.escapeHtml(doc.invoiceNumber || 'No #') + '</span></div>' +
                        '<div class="doc-amount">$' + Utils.formatNumber(doc.totalAmount) + '</div>' +
                    '</div>';
                }).join('') + '</div>';
            },

            anomaliesList: function(anomalies) {
                if (!anomalies || anomalies.length === 0) {
                    return '<div class="empty-state"><div class="empty-state-icon"><i class="fas fa-shield-alt"></i></div><h4 class="empty-state-title">All Clear</h4><p class="empty-state-description">No anomalies detected</p></div>';
                }
                return '<div class="anomaly-list">' + anomalies.map(function(a) {
                    return '<div class="anomaly-item ' + (a.severity || '') + '"><i class="fas fa-exclamation-circle"></i><div class="anomaly-info"><span class="anomaly-title">' + Utils.escapeHtml(a.message) + '</span><span class="anomaly-meta">' + Utils.escapeHtml(a.vendorName || 'Document') + '</span></div><button class="btn-sm" onclick="FluxApp.reviewDoc(' + a.documentId + ')">Review</button></div>';
                }).join('') + '</div>';
            },

            upload: function() {
                return '<header class="page-header">' +
                    '<div class="page-header-content">' +
                        '<h1><i class="fas fa-cloud-upload-alt"></i> Upload Documents</h1>' +
                        '<p class="page-header-subtitle">Drag & drop or click to upload</p>' +
                    '</div>' +
                '</header>' +
                '<div class="page-body">' +
                    '<div class="upload-container">' +
                        '<div class="type-selector">' +
                            '<label class="type-option active"><input type="radio" name="docType" value="auto" checked><i class="fas fa-magic"></i><span>Auto-Detect</span></label>' +
                            '<label class="type-option"><input type="radio" name="docType" value="INVOICE"><i class="fas fa-file-invoice-dollar"></i><span>Invoice</span></label>' +
                            '<label class="type-option"><input type="radio" name="docType" value="RECEIPT"><i class="fas fa-receipt"></i><span>Receipt</span></label>' +
                            '<label class="type-option"><input type="radio" name="docType" value="EXPENSE_REPORT"><i class="fas fa-wallet"></i><span>Expense</span></label>' +
                        '</div>' +
                        '<div class="upload-zone" id="uploadZone">' +
                            '<div class="upload-content">' +
                                '<i class="fas fa-cloud-upload-alt upload-icon"></i>' +
                                '<h2>Drag & Drop Documents Here</h2>' +
                                '<p>or click to browse</p>' +
                                '<div class="supported-formats"><span>Supported:</span><span class="format-badge">PDF</span><span class="format-badge">PNG</span><span class="format-badge">JPG</span><span class="format-badge">TIFF</span></div>' +
                            '</div>' +
                            '<input type="file" id="fileInput" multiple accept=".pdf,.png,.jpg,.jpeg,.tiff,.tif" hidden>' +
                        '</div>' +
                        '<div class="upload-queue" id="uploadQueue" style="display: none;">' +
                            '<div class="queue-header"><h3><i class="fas fa-list"></i> Upload Queue</h3><button class="btn-text" onclick="FluxApp.clearUploadQueue()">Clear All</button></div>' +
                            '<div class="queue-list" id="queueList"></div>' +
                            '<div class="queue-actions">' +
                                '<button class="btn" onclick="document.getElementById(\\'fileInput\\').click()"><i class="fas fa-plus"></i> Add More</button>' +
                                '<button class="btn primary" onclick="FluxApp.processUploadQueue()"><i class="fas fa-play"></i> Process All (<span id="fileCount">0</span>)</button>' +
                            '</div>' +
                        '</div>' +
                        '<div class="upload-progress" id="uploadProgress" style="display: none;">' +
                            '<div class="progress-content">' +
                                '<div class="spinner"></div>' +
                                '<h3 id="progressTitle">Uploading...</h3>' +
                                '<p id="progressText">Preparing files...</p>' +
                                '<div class="progress-bar"><div class="progress-fill" id="progressFill"></div></div>' +
                            '</div>' +
                        '</div>' +
                    '</div>' +
                '</div>';
            },

            queue: function(data, params) {
                var queue = data.queue || [];
                var counts = data.counts || {};
                var total = data.total || 0;
                var statusFilter = params.status || '';
                var page = parseInt(params.page) || 1;
                var totalPages = Math.ceil(total / 25);

                return '<header class="page-header">' +
                    '<div class="page-header-content">' +
                        '<h1><i class="fas fa-inbox"></i> Processing Queue</h1>' +
                        '<p class="page-header-subtitle">' + total + ' documents</p>' +
                    '</div>' +
                    '<div class="page-header-actions">' +
                        '<button class="btn" onclick="FluxApp.navigate(\\'upload\\')"><i class="fas fa-plus"></i> Upload</button>' +
                    '</div>' +
                '</header>' +
                '<div class="page-body">' +
                    '<div class="queue-filters">' +
                        '<div class="filter-tabs">' +
                            '<button class="filter-tab ' + (!statusFilter ? 'active' : '') + '" onclick="FluxApp.filterQueue(\\'\\')">All</button>' +
                            '<button class="filter-tab ' + (statusFilter === 'pending' ? 'active' : '') + '" onclick="FluxApp.filterQueue(\\'pending\\')">Pending</button>' +
                            '<button class="filter-tab ' + (statusFilter === 'review' ? 'active' : '') + '" onclick="FluxApp.filterQueue(\\'review\\')">Needs Review</button>' +
                            '<button class="filter-tab ' + (statusFilter === 'completed' ? 'active' : '') + '" onclick="FluxApp.filterQueue(\\'completed\\')">Completed</button>' +
                        '</div>' +
                    '</div>' +
                    '<div class="queue-table"><table>' +
                        '<thead><tr><th style="width:40px;"><input type="checkbox" id="selectAll" onchange="FluxApp.toggleSelectAll()"></th><th>Document</th><th>Vendor</th><th>Invoice #</th><th>Amount</th><th>Confidence</th><th>Status</th><th style="width:100px;">Actions</th></tr></thead>' +
                        '<tbody>' + this.queueRows(queue) + '</tbody>' +
                    '</table></div>' +
                    (totalPages > 1 ? '<div class="pagination"><button ' + (page <= 1 ? 'disabled' : '') + ' onclick="FluxApp.goToPage(' + (page - 1) + ')"><i class="fas fa-chevron-left"></i></button><span>Page ' + page + ' of ' + totalPages + '</span><button ' + (page >= totalPages ? 'disabled' : '') + ' onclick="FluxApp.goToPage(' + (page + 1) + ')"><i class="fas fa-chevron-right"></i></button></div>' : '') +
                '</div>';
            },

            queueRows: function(queue) {
                if (!queue || queue.length === 0) {
                    return '<tr><td colspan="8" style="text-align:center;padding:60px;"><div class="empty-state"><div class="empty-state-icon"><i class="fas fa-inbox"></i></div><h4 class="empty-state-title">No documents found</h4></div></td></tr>';
                }
                return queue.map(function(doc) {
                    return '<tr class="' + (doc.hasAnomalies ? 'has-anomaly' : '') + '">' +
                        '<td><input type="checkbox" class="doc-select" value="' + doc.id + '"></td>' +
                        '<td class="doc-name-cell">' + Utils.escapeHtml(doc.name) + '</td>' +
                        '<td>' + Utils.escapeHtml(doc.vendorName || '-') + '</td>' +
                        '<td>' + Utils.escapeHtml(doc.invoiceNumber || '-') + '</td>' +
                        '<td><strong>$' + Utils.formatNumber(doc.totalAmount) + '</strong></td>' +
                        '<td><div class="confidence-bar ' + Utils.getConfidenceClass(doc.confidence) + '"><div class="confidence-fill" style="width:' + (doc.confidence || 0) + '%"></div><span>' + (doc.confidence || 0) + '%</span></div></td>' +
                        '<td><span class="status-badge ' + Utils.getStatusClass(doc.status) + '">' + Utils.escapeHtml(doc.statusText || 'Pending') + '</span></td>' +
                        '<td><button class="btn-icon" onclick="FluxApp.reviewDoc(' + doc.id + ')" title="Review"><i class="fas fa-eye"></i></button><button class="btn-icon" onclick="FluxApp.deleteDoc(' + doc.id + ')" title="Delete"><i class="fas fa-trash"></i></button></td>' +
                    '</tr>';
                }).join('');
            },

            review: function(data) {
                var doc = data || {};
                if (!doc.id) {
                    return '<div class="page-body"><div class="empty-state"><div class="empty-state-icon"><i class="fas fa-file-alt"></i></div><h4 class="empty-state-title">Document not found</h4><button class="btn primary" onclick="FluxApp.navigate(\\'queue\\')">Back to Queue</button></div></div>';
                }

                var confLevel = (doc.confidence >= 85 ? 'high' : doc.confidence >= 60 ? 'medium' : 'low');
                var anomalies = doc.anomalies || [];
                var lineItems = doc.lineItems || [];

                return '<div class="review-mode">' +
                    '<div class="review-header">' +
                        '<button class="btn-back" onclick="FluxApp.navigate(\\'queue\\')"><i class="fas fa-arrow-left"></i> Back to Queue</button>' +
                        '<div class="review-actions">' +
                            '<button class="btn danger" onclick="FluxApp.rejectDocument(' + doc.id + ')"><i class="fas fa-times"></i> Reject</button>' +
                            '<button class="btn success" onclick="FluxApp.approveDocument(' + doc.id + ')"><i class="fas fa-check"></i> Approve & Create</button>' +
                        '</div>' +
                    '</div>' +
                    '<div class="review-container">' +
                        '<div class="document-preview">' +
                            '<div class="preview-toolbar">' +
                                '<button class="tool-btn" onclick="FluxApp.zoomIn()"><i class="fas fa-search-plus"></i></button>' +
                                '<button class="tool-btn" onclick="FluxApp.zoomOut()"><i class="fas fa-search-minus"></i></button>' +
                                '<button class="tool-btn" onclick="FluxApp.downloadFile(' + doc.sourceFile + ')"><i class="fas fa-download"></i></button>' +
                            '</div>' +
                            '<div class="preview-frame">' + (doc.fileUrl ? '<iframe src="' + doc.fileUrl + '" id="docPreview"></iframe>' : '<p style="padding:40px;text-align:center;color:#666;">No preview available</p>') + '</div>' +
                        '</div>' +
                        '<div class="extraction-panel">' +
                            '<div class="confidence-banner ' + confLevel + '">' +
                                '<div class="confidence-score">' +
                                    '<div class="score-circle"><svg viewBox="0 0 36 36"><path class="score-bg" d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831"/><path class="score-fill" stroke-dasharray="' + (doc.confidence || 0) + ', 100" d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831"/><text x="18" y="21" class="score-text">' + (doc.confidence || 0) + '%</text></svg></div>' +
                                    '<span class="score-label">' + (confLevel.charAt(0).toUpperCase() + confLevel.slice(1)) + ' Confidence</span>' +
                                '</div>' +
                            '</div>' +
                            (anomalies.length > 0 ? '<div class="anomaly-warnings">' + anomalies.map(function(a) { return '<div class="warning-item ' + (a.severity || '') + '"><i class="fas fa-exclamation-triangle"></i><span>' + Utils.escapeHtml(a.message) + '</span></div>'; }).join('') + '</div>' : '') +
                            '<div class="extracted-fields">' +
                                '<h3>Extracted Information</h3>' +
                                '<div class="field-group"><label>Vendor</label><input type="text" id="vendorName" value="' + Utils.escapeHtml(doc.vendorName || '') + '" onchange="FluxApp.trackChange(\\'vendor\\', this.value)"></div>' +
                                '<div class="field-row">' +
                                    '<div class="field-group"><label>Invoice Number</label><input type="text" id="invoiceNumber" value="' + Utils.escapeHtml(doc.invoiceNumber || '') + '" onchange="FluxApp.trackChange(\\'invoiceNumber\\', this.value)"></div>' +
                                    '<div class="field-group"><label>Invoice Date</label><input type="date" id="invoiceDate" value="' + Utils.formatDateInput(doc.invoiceDate) + '" onchange="FluxApp.trackChange(\\'invoiceDate\\', this.value)"></div>' +
                                '</div>' +
                                '<div class="field-row">' +
                                    '<div class="field-group"><label>Due Date</label><input type="date" id="dueDate" value="' + Utils.formatDateInput(doc.dueDate) + '" onchange="FluxApp.trackChange(\\'dueDate\\', this.value)"></div>' +
                                    '<div class="field-group"><label>PO Number</label><input type="text" id="poNumber" value="' + Utils.escapeHtml(doc.poNumber || '') + '" onchange="FluxApp.trackChange(\\'poNumber\\', this.value)"></div>' +
                                '</div>' +
                            '</div>' +
                            '<div class="amount-fields">' +
                                '<h3>Amounts</h3>' +
                                '<div class="amount-grid">' +
                                    '<div class="amount-field"><label>Subtotal</label><input type="number" step="0.01" id="subtotal" value="' + (doc.subtotal || 0) + '" onchange="FluxApp.trackChange(\\'subtotal\\', this.value); FluxApp.calculateTotal()"></div>' +
                                    '<div class="amount-field"><label>Tax</label><input type="number" step="0.01" id="taxAmount" value="' + (doc.taxAmount || 0) + '" onchange="FluxApp.trackChange(\\'taxAmount\\', this.value); FluxApp.calculateTotal()"></div>' +
                                    '<div class="amount-field total"><label>Total</label><input type="number" step="0.01" id="totalAmount" value="' + (doc.totalAmount || 0) + '" onchange="FluxApp.trackChange(\\'totalAmount\\', this.value)"></div>' +
                                '</div>' +
                            '</div>' +
                            (lineItems.length > 0 ? this.lineItemsTable(lineItems) : '') +
                        '</div>' +
                    '</div>' +
                '</div>';
            },

            lineItemsTable: function(items) {
                return '<div class="line-items"><h3>Line Items (' + items.length + ')</h3><table class="line-items-table"><thead><tr><th>Description</th><th style="width:60px;">Qty</th><th style="width:80px;">Price</th><th style="width:80px;">Amount</th></tr></thead><tbody>' +
                    items.map(function(item) {
                        return '<tr><td><input type="text" value="' + Utils.escapeHtml(item.description || '') + '"></td><td><input type="number" value="' + (item.quantity || 0) + '"></td><td><input type="number" step="0.01" value="' + (item.unitPrice || 0) + '"></td><td><input type="number" step="0.01" value="' + (item.amount || 0) + '"></td></tr>';
                    }).join('') +
                '</tbody></table></div>';
            },

            batch: function(data) {
                var batches = data || [];

                return '<header class="page-header">' +
                    '<div class="page-header-content">' +
                        '<h1><i class="fas fa-layer-group"></i> Batch Processing</h1>' +
                        '<p class="page-header-subtitle">Process multiple documents at once</p>' +
                    '</div>' +
                '</header>' +
                '<div class="page-body">' +
                    '<div class="batch-list"><h3>Recent Batches</h3><table>' +
                        '<thead><tr><th>Batch Name</th><th>Documents</th><th>Progress</th><th>Status</th><th>Created</th><th style="width:80px;">Actions</th></tr></thead>' +
                        '<tbody>' + this.batchRows(batches) + '</tbody>' +
                    '</table></div>' +
                '</div>';
            },

            batchRows: function(batches) {
                if (!batches || batches.length === 0) {
                    return '<tr><td colspan="6" style="text-align:center;padding:40px;"><div class="empty-state"><div class="empty-state-icon"><i class="fas fa-layer-group"></i></div><h4 class="empty-state-title">No batches yet</h4></div></td></tr>';
                }
                return batches.map(function(b) {
                    return '<tr><td><strong>' + Utils.escapeHtml(b.name) + '</strong></td><td>' + (b.processedCount || 0) + '/' + (b.documentCount || 0) + '</td><td><div class="progress-bar" style="width:120px;display:inline-block;"><div class="progress-fill" style="width:' + (b.progress || 0) + '%"></div></div></td><td><span class="status-badge">' + Utils.escapeHtml(b.statusText || 'Pending') + '</span></td><td>' + Utils.formatDate(b.createdDate) + '</td><td><button class="btn-icon" onclick="FluxApp.viewBatch(' + b.id + ')"><i class="fas fa-eye"></i></button></td></tr>';
                }).join('');
            },

            settings: function() {
                return '<header class="page-header">' +
                    '<div class="page-header-content">' +
                        '<h1><i class="fas fa-cog"></i> Settings</h1>' +
                        '<p class="page-header-subtitle">Configure Flux Capture</p>' +
                    '</div>' +
                '</header>' +
                '<div class="page-body">' +
                    '<div class="settings-grid">' +
                        '<div class="settings-section"><h3><i class="fas fa-robot"></i> Processing</h3>' +
                            '<div class="setting-item"><label>Auto-approve Threshold</label><div style="display:flex;align-items:center;gap:12px;"><input type="range" min="70" max="100" value="85" id="autoThreshold" oninput="document.getElementById(\\'thresholdValue\\').textContent=this.value+\\'%\\'"><span id="thresholdValue" style="min-width:45px;">85%</span></div></div>' +
                            '<div class="setting-item"><label>Default Document Type</label><select id="defaultType"><option value="auto">Auto-Detect</option><option value="INVOICE">Invoice</option><option value="RECEIPT">Receipt</option></select></div>' +
                        '</div>' +
                        '<div class="settings-section"><h3><i class="fas fa-shield-alt"></i> Fraud Detection</h3>' +
                            '<div class="setting-item"><label>Duplicate Detection</label><label class="toggle-switch"><input type="checkbox" id="duplicateDetection" checked><span class="toggle-slider"></span></label></div>' +
                            '<div class="setting-item"><label>Amount Validation</label><label class="toggle-switch"><input type="checkbox" id="amountValidation" checked><span class="toggle-slider"></span></label></div>' +
                        '</div>' +
                        '<div class="settings-section"><h3><i class="fas fa-bell"></i> Notifications</h3>' +
                            '<div class="setting-item"><label>Email Notifications</label><label class="toggle-switch"><input type="checkbox" id="emailNotifications" checked><span class="toggle-slider"></span></label></div>' +
                            '<div class="setting-item"><label>Anomaly Alerts</label><label class="toggle-switch"><input type="checkbox" id="anomalyAlerts" checked><span class="toggle-slider"></span></label></div>' +
                        '</div>' +
                    '</div>' +
                    '<div class="settings-actions"><button class="btn primary" onclick="UI.toast(\\'Settings saved!\\', \\'success\\')"><i class="fas fa-save"></i> Save Settings</button></div>' +
                '</div>';
            }
        };

        // ==================== View Controller ====================
        var Views = {
            render: function(view, params) {
                params = params || {};
                var container = document.getElementById('viewContainer');

                UI.showLoading();

                // Fade out current content
                container.style.opacity = '0';
                container.style.transform = 'translateY(10px)';

                var self = this;
                setTimeout(function() {
                    self.loadAndRender(view, params, container);
                }, 150);
            },

            loadAndRender: function(view, params, container) {
                var self = this;

                this.fetchData(view, params)
                    .then(function(data) {
                        var html = self.getTemplate(view, data, params);
                        container.innerHTML = html;

                        // Fade in new content
                        setTimeout(function() {
                            container.style.opacity = '1';
                            container.style.transform = 'translateY(0)';
                        }, 50);

                        // Initialize view-specific handlers
                        self.initViewHandlers(view);
                        UI.hideLoading();

                        // Update queue badge
                        if (data && data.summary && typeof data.summary.pendingReview !== 'undefined') {
                            UI.updateBadge(data.summary.pendingReview);
                        }
                    })
                    .catch(function(err) {
                        console.error('View load error:', err);
                        container.innerHTML = '<div class="page-body"><div class="empty-state"><div class="empty-state-icon"><i class="fas fa-exclamation-triangle"></i></div><h4 class="empty-state-title">Error Loading View</h4><p class="empty-state-description">' + Utils.escapeHtml(err.message) + '</p></div></div>';
                        container.style.opacity = '1';
                        container.style.transform = 'translateY(0)';
                        UI.hideLoading();
                    });
            },

            fetchData: function(view, params) {
                switch (view) {
                    case 'dashboard':
                        return Promise.all([
                            API.get('stats'),
                            API.get('anomalies', { limit: 5 })
                        ]).then(function(results) {
                            var stats = results[0];
                            stats.recentDocs = [];  // Could fetch separately
                            stats.anomalies = results[1];
                            return stats;
                        });
                    case 'queue':
                        return API.get('queue', { page: params.page || 1, status: params.status || '' });
                    case 'review':
                        return params.docId ? API.get('document', { id: params.docId }) : Promise.resolve({});
                    case 'batch':
                        return API.get('batches');
                    case 'upload':
                    case 'settings':
                        return Promise.resolve({});
                    default:
                        return Promise.resolve({});
                }
            },

            getTemplate: function(view, data, params) {
                switch (view) {
                    case 'dashboard': return Templates.dashboard(data);
                    case 'upload': return Templates.upload();
                    case 'queue': return Templates.queue(data, params);
                    case 'review': return Templates.review(data);
                    case 'batch': return Templates.batch(data);
                    case 'settings': return Templates.settings();
                    default: return '<div class="page-body"><h2>View not found</h2></div>';
                }
            },

            initViewHandlers: function(view) {
                if (view === 'upload') {
                    this.initUploadHandlers();
                }
            },

            initUploadHandlers: function() {
                var uploadZone = document.getElementById('uploadZone');
                var fileInput = document.getElementById('fileInput');
                if (!uploadZone || !fileInput) return;

                uploadZone.onclick = function() { fileInput.click(); };
                uploadZone.ondragover = function(e) { e.preventDefault(); uploadZone.classList.add('dragover'); };
                uploadZone.ondragleave = function() { uploadZone.classList.remove('dragover'); };
                uploadZone.ondrop = function(e) {
                    e.preventDefault();
                    uploadZone.classList.remove('dragover');
                    FluxApp.handleFiles(e.dataTransfer.files);
                };
                fileInput.onchange = function(e) { FluxApp.handleFiles(e.target.files); };

                document.querySelectorAll('.type-option').forEach(function(opt) {
                    opt.onclick = function() {
                        document.querySelectorAll('.type-option').forEach(function(o) { o.classList.remove('active'); });
                        opt.classList.add('active');
                        opt.querySelector('input').checked = true;
                    };
                });
            }
        };

        // ==================== Public API ====================
        window.FluxApp = {
            navigate: function(view, params) {
                Router.navigate(view, params);
            },

            reviewDoc: function(docId) {
                Router.navigate('review', { docId: docId });
            },

            filterQueue: function(status) {
                Router.navigate('queue', { status: status, page: 1 });
            },

            goToPage: function(page) {
                var params = Object.assign({}, State.currentParams);
                params.page = page;
                Router.navigate('queue', params);
            },

            handleFiles: function(files) {
                State.uploadFiles = State.uploadFiles.concat(Array.from(files));
                this.renderUploadQueue();
            },

            renderUploadQueue: function() {
                var queue = document.getElementById('uploadQueue');
                var list = document.getElementById('queueList');
                var count = document.getElementById('fileCount');
                if (!queue || !list) return;

                if (State.uploadFiles.length === 0) {
                    queue.style.display = 'none';
                    return;
                }

                queue.style.display = 'block';
                list.innerHTML = State.uploadFiles.map(function(f, i) {
                    return '<div class="queue-item"><i class="fas fa-file-pdf"></i><span>' + Utils.escapeHtml(f.name) + '</span><span class="file-size">' + (f.size / 1024 / 1024).toFixed(2) + ' MB</span><button class="btn-icon" onclick="FluxApp.removeFile(' + i + ')"><i class="fas fa-times"></i></button></div>';
                }).join('');
                if (count) count.textContent = State.uploadFiles.length;
            },

            removeFile: function(index) {
                State.uploadFiles.splice(index, 1);
                this.renderUploadQueue();
            },

            clearUploadQueue: function() {
                State.uploadFiles = [];
                this.renderUploadQueue();
            },

            processUploadQueue: function() {
                if (State.uploadFiles.length === 0) return;

                var progress = document.getElementById('uploadProgress');
                var queue = document.getElementById('uploadQueue');
                var progressTitle = document.getElementById('progressTitle');
                var progressText = document.getElementById('progressText');
                var progressFill = document.getElementById('progressFill');

                if (progress) progress.style.display = 'block';
                if (queue) queue.style.display = 'none';

                var docType = 'auto';
                var checked = document.querySelector('input[name="docType"]:checked');
                if (checked) docType = checked.value;

                var files = State.uploadFiles.slice();
                var total = files.length;
                var current = 0;

                var processNext = function() {
                    if (current >= total) {
                        if (progressTitle) progressTitle.textContent = 'Complete!';
                        if (progressText) progressText.textContent = 'All files uploaded successfully';
                        State.uploadFiles = [];
                        setTimeout(function() { Router.navigate('queue'); }, 1500);
                        return;
                    }

                    var f = files[current];
                    if (progressTitle) progressTitle.textContent = 'Uploading...';
                    if (progressText) progressText.textContent = 'Processing ' + (current + 1) + ' of ' + total;
                    if (progressFill) progressFill.style.width = ((current + 1) / total * 100) + '%';

                    var reader = new FileReader();
                    reader.onload = function() {
                        var base64 = reader.result.split(',')[1];
                        API.post('upload', {
                            fileName: f.name,
                            fileContent: base64,
                            documentType: docType
                        }).then(function() {
                            current++;
                            processNext();
                        }).catch(function(err) {
                            console.error('Upload error:', err);
                            current++;
                            processNext();
                        });
                    };
                    reader.readAsDataURL(f);
                };

                processNext();
            },

            trackChange: function(field, value) {
                State.pendingChanges[field] = value;
            },

            calculateTotal: function() {
                var subtotal = parseFloat(document.getElementById('subtotal').value) || 0;
                var tax = parseFloat(document.getElementById('taxAmount').value) || 0;
                var totalEl = document.getElementById('totalAmount');
                if (totalEl) totalEl.value = (subtotal + tax).toFixed(2);
            },

            approveDocument: function(docId) {
                if (!confirm('Create transaction from this document?')) return;

                UI.showLoading();

                var saveChanges = Object.keys(State.pendingChanges).length > 0
                    ? API.put('update', { documentId: docId, updates: State.pendingChanges })
                    : Promise.resolve();

                saveChanges
                    .then(function() {
                        return API.put('approve', { documentId: docId, createTransaction: true });
                    })
                    .then(function() {
                        UI.toast('Document approved and transaction created!', 'success');
                        State.pendingChanges = {};
                        Router.navigate('queue');
                    })
                    .catch(function(err) {
                        UI.toast('Error: ' + err.message, 'error');
                    })
                    .finally(function() {
                        UI.hideLoading();
                    });
            },

            rejectDocument: function(docId) {
                var reason = prompt('Reason for rejection:');
                if (!reason) return;

                UI.showLoading();
                API.put('reject', { documentId: docId, reason: reason })
                    .then(function() {
                        UI.toast('Document rejected', 'success');
                        Router.navigate('queue');
                    })
                    .catch(function(err) {
                        UI.toast('Error: ' + err.message, 'error');
                    })
                    .finally(function() {
                        UI.hideLoading();
                    });
            },

            deleteDoc: function(docId) {
                if (!confirm('Delete this document?')) return;

                UI.showLoading();
                API.delete('document', { id: docId })
                    .then(function() {
                        UI.toast('Document deleted', 'success');
                        Router.navigate('queue', State.currentParams);
                    })
                    .catch(function(err) {
                        UI.toast('Error: ' + err.message, 'error');
                    })
                    .finally(function() {
                        UI.hideLoading();
                    });
            },

            toggleSelectAll: function() {
                var checked = document.getElementById('selectAll').checked;
                document.querySelectorAll('.doc-select').forEach(function(cb) { cb.checked = checked; });
            },

            viewBatch: function(batchId) {
                // Could implement batch detail view
                UI.toast('Batch details coming soon', 'info');
            },

            zoomIn: function() {
                var iframe = document.getElementById('docPreview');
                if (iframe) {
                    var current = parseFloat(iframe.style.transform.replace('scale(', '').replace(')', '')) || 1;
                    iframe.style.transform = 'scale(' + Math.min(current + 0.25, 3) + ')';
                }
            },

            zoomOut: function() {
                var iframe = document.getElementById('docPreview');
                if (iframe) {
                    var current = parseFloat(iframe.style.transform.replace('scale(', '').replace(')', '')) || 1;
                    iframe.style.transform = 'scale(' + Math.max(current - 0.25, 0.5) + ')';
                }
            },

            downloadFile: function(fileId) {
                if (fileId) window.open('/core/media/media.nl?id=' + fileId, '_blank');
            }
        };

        // ==================== Initialize ====================
        document.addEventListener('DOMContentLoaded', function() {
            // Add view container transitions
            var container = document.getElementById('viewContainer');
            if (container) {
                container.style.transition = 'opacity 0.15s ease, transform 0.15s ease';
            }

            // Sync NetSuite theme
            try {
                if (window.parent && window.parent !== window) {
                    var parentDoc = window.parent.document;
                    var headerSelectors = ['#div__header', '#ns-header', '#ns_navigation'];
                    for (var i = 0; i < headerSelectors.length; i++) {
                        var el = parentDoc.querySelector(headerSelectors[i]);
                        if (el) {
                            var style = window.parent.getComputedStyle(el);
                            var bg = style.backgroundColor;
                            if (bg && bg !== 'rgba(0, 0, 0, 0)' && bg !== 'transparent') {
                                document.documentElement.style.setProperty('--ns-primary', bg);
                                break;
                            }
                        }
                    }
                }
            } catch (e) { /* Cross-origin restriction */ }

            // Start router
            Router.init();
        });
    })();
    </script>
</body>
</html>`;
    }

    /**
     * Helper functions
     */
    function getCssFileUrl() {
        try {
            const cssFile = file.load({ id: '/SuiteApps/com.flux.capture/FC_Styles.css' });
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

    function getInitials(name) {
        if (!name) return 'U';
        const parts = name.split(' ');
        if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
        return name.substring(0, 2).toUpperCase();
    }

    function escapeHtml(str) {
        if (!str) return '';
        return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    }

    return { onRequest: onRequest };
});
