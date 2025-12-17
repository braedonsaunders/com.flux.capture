/**
 * @NApiVersion 2.1
 * @NScriptType Suitelet
 * @NModuleScope SameAccount
 *
 * Flux Capture - Main Suitelet
 * A true Single Page Application with client-side routing
 * Professional financial-grade document intelligence platform
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
    <link href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700;800&display=swap" rel="stylesheet">
    <link href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css" rel="stylesheet">
    ${cssUrl ? '<link href="' + cssUrl + '" rel="stylesheet">' : ''}
    <style>
    /* Critical inline CSS fallback */
    :root{--flux-primary:#2563eb;--flux-primary-hover:#1d4ed8;--flux-success:#059669;--flux-warning:#d97706;--flux-danger:#dc2626;--flux-gray-50:#f8fafc;--flux-gray-100:#f1f5f9;--flux-gray-200:#e2e8f0;--flux-gray-300:#cbd5e1;--flux-gray-400:#94a3b8;--flux-gray-500:#64748b;--flux-gray-600:#475569;--flux-gray-700:#334155;--flux-gray-800:#1e293b;--flux-gray-900:#0f172a;--flux-surface:#fff;--flux-background:#f8fafc;--flux-border:#e2e8f0;--flux-text-primary:#0f172a;--flux-text-secondary:#475569;--flux-text-tertiary:#94a3b8;--sidebar-bg:linear-gradient(180deg,#0f172a 0%,#1e293b 100%);--sidebar-text:rgba(255,255,255,.65);--sidebar-text-active:#fff;--shadow-sm:0 1px 3px rgba(0,0,0,.06);--shadow-md:0 4px 6px -1px rgba(0,0,0,.07);--transition-base:200ms cubic-bezier(.4,0,.2,1)}
    *,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
    body{font-family:'Inter',system-ui,-apple-system,sans-serif;font-size:14px;line-height:1.5;color:var(--flux-text-primary);background:var(--flux-background);-webkit-font-smoothing:antialiased}
    .app-container{display:flex;min-height:100vh}
    .sidebar{width:260px;background:var(--sidebar-bg);color:var(--sidebar-text);display:flex;flex-direction:column;position:fixed;top:0;left:0;bottom:0;z-index:100}
    .sidebar-header{padding:20px;display:flex;align-items:center;gap:12px}
    .sidebar-logo{width:40px;height:40px;background:var(--flux-primary);border-radius:10px;display:flex;align-items:center;justify-content:center}
    .sidebar-logo svg{width:24px;height:24px;color:#fff}
    .sidebar-brand-name{font-size:20px;font-weight:700;color:#fff}
    .sidebar-brand-tagline{font-size:11px;color:var(--sidebar-text);text-transform:uppercase;letter-spacing:.5px}
    .sidebar-nav{flex:1;padding:8px 12px;overflow-y:auto}
    .nav-section{margin-bottom:24px}
    .nav-section-title{font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:.5px;color:var(--flux-gray-500);padding:8px 12px;margin-bottom:4px}
    .nav-item{display:flex;align-items:center;gap:12px;padding:10px 12px;border-radius:8px;color:var(--sidebar-text);text-decoration:none;transition:all var(--transition-base);cursor:pointer}
    .nav-item:hover{background:rgba(255,255,255,.08);color:rgba(255,255,255,.9)}
    .nav-item.active{background:var(--flux-primary);color:#fff}
    .nav-icon{width:20px;text-align:center}
    .sidebar-footer{padding:16px;border-top:1px solid rgba(255,255,255,.08)}
    .sidebar-user{display:flex;align-items:center;gap:12px}
    .sidebar-user-avatar{width:36px;height:36px;border-radius:8px;background:var(--flux-primary);color:#fff;display:flex;align-items:center;justify-content:center;font-weight:600;font-size:13px}
    .sidebar-user-name{font-weight:500;color:#fff;font-size:13px}
    .sidebar-user-role{font-size:12px;color:var(--sidebar-text)}
    .main-content{flex:1;margin-left:260px;display:flex;flex-direction:column;min-height:100vh}
    .view-container{flex:1;padding:24px 32px;transition:opacity .2s ease,transform .2s ease}
    .page-header{display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:24px}
    .page-header h1{font-size:28px;font-weight:700;color:var(--flux-text-primary);margin:0}
    .page-subtitle{color:var(--flux-text-secondary);margin-top:4px}
    .btn{display:inline-flex;align-items:center;justify-content:center;gap:8px;padding:10px 16px;font-size:14px;font-weight:500;border-radius:8px;border:none;cursor:pointer;transition:all var(--transition-base)}
    .btn-primary{background:var(--flux-primary);color:#fff}
    .btn-primary:hover{background:var(--flux-primary-hover)}
    .btn-ghost{background:transparent;color:var(--flux-text-secondary)}
    .btn-ghost:hover{background:var(--flux-gray-100)}
    .card{background:var(--flux-surface);border-radius:12px;border:1px solid var(--flux-border);box-shadow:var(--shadow-sm)}
    .card-header{padding:16px 20px;border-bottom:1px solid var(--flux-border);display:flex;justify-content:space-between;align-items:center}
    .card-title{font-weight:600;display:flex;align-items:center;gap:8px}
    .card-body{padding:20px}
    .metrics-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:16px;margin-bottom:24px}
    .metric-card{background:var(--flux-surface);border-radius:12px;padding:20px;border:1px solid var(--flux-border);display:flex;align-items:flex-start;gap:16px}
    .metric-icon{width:48px;height:48px;border-radius:12px;display:flex;align-items:center;justify-content:center;font-size:20px}
    .metric-blue .metric-icon{background:rgba(37,99,235,.1);color:var(--flux-primary)}
    .metric-green .metric-icon{background:rgba(5,150,105,.1);color:var(--flux-success)}
    .metric-amber .metric-icon{background:rgba(217,119,6,.1);color:var(--flux-warning)}
    .metric-purple .metric-icon{background:rgba(124,58,237,.1);color:#7c3aed}
    .metric-value{font-size:28px;font-weight:700;color:var(--flux-text-primary)}
    .metric-label{font-size:13px;color:var(--flux-text-secondary);margin-top:2px}
    .empty-state{text-align:center;padding:48px 24px}
    .empty-icon{width:64px;height:64px;margin:0 auto 16px;background:var(--flux-gray-100);border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:24px;color:var(--flux-gray-400)}
    .empty-state h4{font-size:16px;font-weight:600;margin-bottom:8px}
    .empty-state p{color:var(--flux-text-secondary);margin-bottom:16px}
    .loading-overlay{position:fixed;inset:0;background:rgba(255,255,255,.8);display:flex;align-items:center;justify-content:center;z-index:1000;opacity:0;visibility:hidden;transition:all .2s}
    .loading-overlay.visible{opacity:1;visibility:visible}
    .loading-spinner svg{width:48px;height:48px;animation:spin 1s linear infinite}
    @keyframes spin{to{transform:rotate(360deg)}}
    .toast-container{position:fixed;bottom:24px;right:24px;z-index:1001;display:flex;flex-direction:column;gap:8px}
    .toast{padding:12px 16px;background:var(--flux-gray-800);color:#fff;border-radius:8px;display:flex;align-items:center;gap:10px;transform:translateX(120%);transition:transform .3s}
    .toast.visible{transform:translateX(0)}
    .data-table{overflow-x:auto}
    .data-table table{width:100%;border-collapse:collapse}
    .data-table th,.data-table td{padding:12px 16px;text-align:left;border-bottom:1px solid var(--flux-border)}
    .data-table th{font-weight:600;color:var(--flux-text-secondary);font-size:12px;text-transform:uppercase;background:var(--flux-gray-50)}
    .status-pill{display:inline-flex;padding:4px 10px;border-radius:20px;font-size:12px;font-weight:500}
    .status-pending{background:#fef3c7;color:#92400e}
    .status-completed{background:#d1fae5;color:#065f46}
    .status-review{background:#fef3c7;color:#92400e}
    .status-error{background:#fee2e2;color:#991b1b}
    .nav-badge{background:var(--flux-danger);color:#fff;font-size:11px;padding:2px 6px;border-radius:10px;margin-left:auto}
    </style>
</head>
<body>
    <div class="app-container" id="app">
        <!-- Sidebar - Static, never re-renders -->
        <aside class="sidebar" id="sidebar">
            <div class="sidebar-header">
                <div class="sidebar-logo">
                    <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                        <path d="M13 2L3 14H12L11 22L21 10H12L13 2Z" fill="currentColor"/>
                    </svg>
                </div>
                <div class="sidebar-brand">
                    <span class="sidebar-brand-name">Flux</span>
                    <span class="sidebar-brand-tagline">Document Intelligence</span>
                </div>
            </div>
            <nav class="sidebar-nav" id="sidebarNav">
                <div class="nav-section">
                    <div class="nav-section-title">Overview</div>
                    <a href="#" class="nav-item" data-view="dashboard">
                        <div class="nav-icon"><i class="fas fa-chart-line"></i></div>
                        <span>Dashboard</span>
                    </a>
                </div>
                <div class="nav-section">
                    <div class="nav-section-title">Documents</div>
                    <a href="#" class="nav-item" data-view="upload">
                        <div class="nav-icon"><i class="fas fa-cloud-arrow-up"></i></div>
                        <span>Upload</span>
                    </a>
                    <a href="#" class="nav-item" data-view="queue">
                        <div class="nav-icon"><i class="fas fa-layer-group"></i></div>
                        <span>Processing</span>
                        <span class="nav-badge" id="queueBadge" style="display: none;">0</span>
                    </a>
                    <a href="#" class="nav-item" data-view="batch">
                        <div class="nav-icon"><i class="fas fa-boxes-stacked"></i></div>
                        <span>Batches</span>
                    </a>
                </div>
                <div class="nav-section">
                    <div class="nav-section-title">System</div>
                    <a href="#" class="nav-item" data-view="settings">
                        <div class="nav-icon"><i class="fas fa-sliders"></i></div>
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

        <!-- Main Content - Only this area updates -->
        <main class="main-content" id="mainContent">
            <div id="viewContainer" class="view-container"></div>
        </main>
    </div>

    <!-- Loading Overlay -->
    <div class="loading-overlay" id="loadingOverlay">
        <div class="loading-content">
            <div class="loading-spinner">
                <svg viewBox="0 0 50 50">
                    <circle cx="25" cy="25" r="20" fill="none" stroke="currentColor" stroke-width="4" stroke-linecap="round"/>
                </svg>
            </div>
        </div>
    </div>

    <!-- Toast Container -->
    <div id="toastContainer" class="toast-container"></div>

    <script>
    /**
     * Flux Capture SPA Application
     * Professional financial-grade document intelligence platform
     * True SPA with navigation locking and request cancellation
     */
    (function() {
        'use strict';

        // ==================== Configuration ====================
        var CONFIG = {
            API_URL: '${apiUrl}',
            INITIAL_VIEW: '${initialAction}',
            FADE_DURATION: 200,
            DEBOUNCE_DELAY: 150
        };

        // ==================== State Management ====================
        var State = {
            currentView: null,
            currentParams: {},
            isNavigating: false,
            navigationId: 0,
            abortController: null,
            cache: {},
            pendingChanges: {},
            uploadFiles: []
        };

        // ==================== API Client with AbortController ====================
        var API = {
            buildUrl: function(params) {
                var qs = Object.keys(params).map(function(k) {
                    return encodeURIComponent(k) + '=' + encodeURIComponent(params[k]);
                }).join('&');
                var sep = CONFIG.API_URL.indexOf('?') >= 0 ? '&' : '?';
                return CONFIG.API_URL + sep + qs;
            },

            handleResponse: function(response) {
                return response.text().then(function(text) {
                    if (!response.ok) {
                        // Try to parse as JSON for error details
                        try {
                            var errData = JSON.parse(text);
                            throw new Error(errData.error ? errData.error.message : 'Request failed: ' + response.status);
                        } catch (e) {
                            if (e.message.indexOf('Request failed') === 0) throw e;
                            throw new Error('Request failed: ' + response.status + ' - ' + text.substring(0, 100));
                        }
                    }
                    try {
                        var data = JSON.parse(text);
                        if (!data.success) throw new Error(data.error ? data.error.message : 'API Error');
                        return data.data;
                    } catch (e) {
                        throw new Error('Invalid JSON response');
                    }
                });
            },

            get: function(action, params, signal) {
                params = params || {};
                params.action = action;
                var self = this;
                var options = {};
                if (signal) options.signal = signal;
                return fetch(this.buildUrl(params), options).then(function(r) { return self.handleResponse(r); });
            },

            post: function(action, body, signal) {
                body = body || {};
                body.action = action;
                var self = this;
                var options = {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(body)
                };
                if (signal) options.signal = signal;
                return fetch(CONFIG.API_URL, options).then(function(r) { return self.handleResponse(r); });
            },

            put: function(action, body, signal) {
                body = body || {};
                body.action = action;
                var self = this;
                var options = {
                    method: 'PUT',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(body)
                };
                if (signal) options.signal = signal;
                return fetch(CONFIG.API_URL, options).then(function(r) { return self.handleResponse(r); });
            },

            delete: function(action, body, signal) {
                body = body || {};
                body.action = action;
                var self = this;
                var options = {
                    method: 'DELETE',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(body)
                };
                if (signal) options.signal = signal;
                return fetch(CONFIG.API_URL, options).then(function(r) { return self.handleResponse(r); });
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

            formatCompact: function(num) {
                if (num >= 1000000) return (num / 1000000).toFixed(1) + 'M';
                if (num >= 1000) return (num / 1000).toFixed(1) + 'K';
                return String(num || 0);
            },

            formatDate: function(date) {
                if (!date) return '';
                var d = new Date(date);
                return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
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
                var icons = { success: 'check-circle', error: 'exclamation-circle', info: 'info-circle', warning: 'exclamation-triangle' };
                toast.innerHTML = '<i class="fas fa-' + (icons[type] || 'info-circle') + '"></i><span>' + Utils.escapeHtml(message) + '</span>';
                container.appendChild(toast);
                requestAnimationFrame(function() {
                    toast.classList.add('visible');
                });
                setTimeout(function() {
                    toast.classList.remove('visible');
                    setTimeout(function() { toast.remove(); }, 300);
                }, 4000);
            },

            updateBadge: function(count) {
                var badge = document.getElementById('queueBadge');
                if (badge) {
                    badge.textContent = count;
                    badge.style.display = count > 0 ? 'flex' : 'none';
                }
            }
        };

        // ==================== Router with Navigation Lock ====================
        var Router = {
            navigate: function(view, params, pushState) {
                // Prevent overlapping navigations
                if (State.isNavigating && State.currentView === view) {
                    return;
                }

                params = params || {};

                // Cancel any in-flight requests
                if (State.abortController) {
                    State.abortController.abort();
                }
                State.abortController = new AbortController();

                // Increment navigation ID to track current navigation
                var navigationId = ++State.navigationId;
                State.isNavigating = true;

                // Clean up state between views
                if (State.currentView !== view) {
                    State.pendingChanges = {};
                }

                // Update URL
                if (pushState !== false) {
                    var url = new URL(window.location.href);
                    url.searchParams.set('action', view);
                    Object.keys(params).forEach(function(k) {
                        if (params[k]) url.searchParams.set(k, params[k]);
                        else url.searchParams.delete(k);
                    });
                    if (view !== 'review') url.searchParams.delete('docId');
                    if (view !== 'queue') {
                        url.searchParams.delete('status');
                        url.searchParams.delete('page');
                    }
                    history.pushState({ view: view, params: params }, '', url.toString());
                }

                // Update active nav item immediately (visual feedback)
                document.querySelectorAll('.nav-item').forEach(function(item) {
                    item.classList.toggle('active', item.dataset.view === view);
                });

                // Render the view
                Views.render(view, params, navigationId);
            },

            init: function() {
                var self = this;

                // Event delegation for sidebar navigation
                var sidebarNav = document.getElementById('sidebarNav');
                if (sidebarNav) {
                    sidebarNav.addEventListener('click', function(e) {
                        var navItem = e.target.closest('.nav-item');
                        if (navItem) {
                            e.preventDefault();
                            e.stopPropagation();
                            var view = navItem.dataset.view;
                            if (view) {
                                self.navigate(view);
                            }
                        }
                    });
                }

                // Handle browser back/forward
                window.addEventListener('popstate', function(e) {
                    if (e.state && e.state.view) {
                        self.navigate(e.state.view, e.state.params, false);
                    }
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

                return '<div class="page-header">' +
                    '<div class="page-header-content">' +
                        '<div class="page-header-title">' +
                            '<h1>Dashboard</h1>' +
                            '<p class="page-subtitle">Real-time document processing intelligence</p>' +
                        '</div>' +
                    '</div>' +
                    '<div class="page-header-actions">' +
                        '<button class="btn btn-primary btn-lg" onclick="FluxApp.navigate(\\'upload\\')">' +
                            '<i class="fas fa-plus"></i> New Upload' +
                        '</button>' +
                    '</div>' +
                '</div>' +
                '<div class="page-body">' +
                    '<div class="metrics-grid">' +
                        this.metricCard('Total Processed', stats.totalProcessed || 0, 'file-invoice', 'blue', null, 'All time') +
                        this.metricCard('Completed', stats.completed || 0, 'check-double', 'green', stats.autoProcessRate ? '+' + stats.autoProcessRate + '% auto' : null, 'Successfully processed') +
                        this.metricCard('Pending Review', stats.pendingReview || 0, 'clock', 'amber', null, 'Requires attention', 'FluxApp.navigate(\\'queue\\', {status: \\'review\\'})') +
                        this.metricCard('Total Value', '$' + Utils.formatCompact(stats.totalValue || 0), 'sack-dollar', 'purple', null, 'Last 30 days') +
                    '</div>' +
                    '<div class="dashboard-grid">' +
                        '<div class="card card-lg">' +
                            '<div class="card-header">' +
                                '<div class="card-title"><i class="fas fa-clock-rotate-left"></i> Recent Activity</div>' +
                                '<a href="#" class="card-action" onclick="FluxApp.navigate(\\'queue\\'); return false;">View All</a>' +
                            '</div>' +
                            '<div class="card-body">' + this.activityList(docs) + '</div>' +
                        '</div>' +
                        '<div class="card">' +
                            '<div class="card-header">' +
                                '<div class="card-title"><i class="fas fa-triangle-exclamation"></i> Alerts</div>' +
                                '<span class="alert-badge ' + (anomalies.length > 0 ? 'has-alerts' : '') + '">' + anomalies.length + '</span>' +
                            '</div>' +
                            '<div class="card-body">' + this.alertsList(anomalies) + '</div>' +
                        '</div>' +
                    '</div>' +
                '</div>';
            },

            metricCard: function(label, value, icon, color, trend, subtitle, onclick) {
                var clickAttr = onclick ? ' onclick="' + onclick + '" style="cursor:pointer;"' : '';
                return '<div class="metric-card metric-' + color + '"' + clickAttr + '>' +
                    '<div class="metric-icon"><i class="fas fa-' + icon + '"></i></div>' +
                    '<div class="metric-content">' +
                        '<div class="metric-value">' + value + '</div>' +
                        '<div class="metric-label">' + label + '</div>' +
                        (subtitle ? '<div class="metric-subtitle">' + subtitle + '</div>' : '') +
                    '</div>' +
                    (trend ? '<div class="metric-trend trend-up"><i class="fas fa-arrow-up"></i> ' + trend + '</div>' : '') +
                '</div>';
            },

            activityList: function(docs) {
                if (!docs || docs.length === 0) {
                    return '<div class="empty-state">' +
                        '<div class="empty-icon"><i class="fas fa-inbox"></i></div>' +
                        '<h4>No recent activity</h4>' +
                        '<p>Upload documents to get started</p>' +
                        '<button class="btn btn-primary" onclick="FluxApp.navigate(\\'upload\\')">Upload Documents</button>' +
                    '</div>';
                }
                return '<div class="activity-list">' + docs.map(function(doc) {
                    var statusClass = Utils.getStatusClass(doc.status);
                    return '<div class="activity-item" onclick="FluxApp.reviewDoc(' + doc.id + ')">' +
                        '<div class="activity-icon ' + statusClass + '"><i class="fas fa-file-invoice"></i></div>' +
                        '<div class="activity-content">' +
                            '<div class="activity-title">' + Utils.escapeHtml(doc.vendorName || 'Unknown Vendor') + '</div>' +
                            '<div class="activity-meta">' + Utils.escapeHtml(doc.invoiceNumber || 'No invoice #') + '</div>' +
                        '</div>' +
                        '<div class="activity-amount">$' + Utils.formatNumber(doc.totalAmount) + '</div>' +
                        '<div class="activity-arrow"><i class="fas fa-chevron-right"></i></div>' +
                    '</div>';
                }).join('') + '</div>';
            },

            alertsList: function(anomalies) {
                if (!anomalies || anomalies.length === 0) {
                    return '<div class="empty-state empty-state-sm">' +
                        '<div class="empty-icon success"><i class="fas fa-shield-check"></i></div>' +
                        '<h4>All Clear</h4>' +
                        '<p>No anomalies detected</p>' +
                    '</div>';
                }
                return '<div class="alerts-list">' + anomalies.map(function(a) {
                    var severity = a.severity || 'medium';
                    return '<div class="alert-item alert-' + severity + '">' +
                        '<div class="alert-indicator"></div>' +
                        '<div class="alert-content">' +
                            '<div class="alert-message">' + Utils.escapeHtml(a.message) + '</div>' +
                            '<div class="alert-source">' + Utils.escapeHtml(a.vendorName || 'Document') + '</div>' +
                        '</div>' +
                        '<button class="btn btn-sm btn-ghost" onclick="FluxApp.reviewDoc(' + a.documentId + ')">Review</button>' +
                    '</div>';
                }).join('') + '</div>';
            },

            upload: function() {
                return '<div class="page-header">' +
                    '<div class="page-header-content">' +
                        '<div class="page-header-title">' +
                            '<h1>Upload Documents</h1>' +
                            '<p class="page-subtitle">Drag and drop or select files to process</p>' +
                        '</div>' +
                    '</div>' +
                '</div>' +
                '<div class="page-body">' +
                    '<div class="upload-wrapper">' +
                        '<div class="upload-type-selector">' +
                            '<label class="type-card active"><input type="radio" name="docType" value="auto" checked><div class="type-icon"><i class="fas fa-wand-magic-sparkles"></i></div><span>Auto-Detect</span></label>' +
                            '<label class="type-card"><input type="radio" name="docType" value="INVOICE"><div class="type-icon"><i class="fas fa-file-invoice-dollar"></i></div><span>Invoice</span></label>' +
                            '<label class="type-card"><input type="radio" name="docType" value="RECEIPT"><div class="type-icon"><i class="fas fa-receipt"></i></div><span>Receipt</span></label>' +
                            '<label class="type-card"><input type="radio" name="docType" value="EXPENSE_REPORT"><div class="type-icon"><i class="fas fa-file-lines"></i></div><span>Expense Report</span></label>' +
                        '</div>' +
                        '<div class="upload-dropzone" id="uploadZone">' +
                            '<div class="dropzone-content">' +
                                '<div class="dropzone-icon"><i class="fas fa-cloud-arrow-up"></i></div>' +
                                '<h3>Drop files here</h3>' +
                                '<p>or click to browse your computer</p>' +
                                '<div class="dropzone-formats">' +
                                    '<span class="format-tag">PDF</span>' +
                                    '<span class="format-tag">PNG</span>' +
                                    '<span class="format-tag">JPG</span>' +
                                    '<span class="format-tag">TIFF</span>' +
                                '</div>' +
                            '</div>' +
                            '<input type="file" id="fileInput" multiple accept=".pdf,.png,.jpg,.jpeg,.tiff,.tif" hidden>' +
                        '</div>' +
                        '<div class="upload-queue-panel" id="uploadQueue" style="display: none;">' +
                            '<div class="queue-panel-header">' +
                                '<h3><i class="fas fa-list-check"></i> Ready to Upload</h3>' +
                                '<button class="btn btn-ghost btn-sm" onclick="FluxApp.clearUploadQueue()">Clear All</button>' +
                            '</div>' +
                            '<div class="queue-file-list" id="queueList"></div>' +
                            '<div class="queue-panel-footer">' +
                                '<button class="btn btn-secondary" onclick="document.getElementById(\\'fileInput\\').click()"><i class="fas fa-plus"></i> Add More</button>' +
                                '<button class="btn btn-primary btn-lg" onclick="FluxApp.processUploadQueue()"><i class="fas fa-bolt"></i> Process <span id="fileCount">0</span> Files</button>' +
                            '</div>' +
                        '</div>' +
                        '<div class="upload-progress-panel" id="uploadProgress" style="display: none;">' +
                            '<div class="progress-visual">' +
                                '<div class="progress-spinner"></div>' +
                                '<h3 id="progressTitle">Processing...</h3>' +
                                '<p id="progressText">Preparing files...</p>' +
                                '<div class="progress-track"><div class="progress-bar" id="progressFill"></div></div>' +
                            '</div>' +
                        '</div>' +
                    '</div>' +
                '</div>';
            },

            queue: function(data, params) {
                var queue = data.queue || [];
                var total = data.total || 0;
                var statusFilter = params.status || '';
                var page = parseInt(params.page) || 1;
                var totalPages = Math.ceil(total / 25);

                return '<div class="page-header">' +
                    '<div class="page-header-content">' +
                        '<div class="page-header-title">' +
                            '<h1>Processing Queue</h1>' +
                            '<p class="page-subtitle">' + total + ' documents in queue</p>' +
                        '</div>' +
                    '</div>' +
                    '<div class="page-header-actions">' +
                        '<button class="btn btn-primary" onclick="FluxApp.navigate(\\'upload\\')"><i class="fas fa-plus"></i> Upload</button>' +
                    '</div>' +
                '</div>' +
                '<div class="page-body">' +
                    '<div class="filter-bar">' +
                        '<div class="filter-tabs">' +
                            '<button class="filter-tab ' + (!statusFilter ? 'active' : '') + '" onclick="FluxApp.filterQueue(\\'\\')">All</button>' +
                            '<button class="filter-tab ' + (statusFilter === 'pending' ? 'active' : '') + '" onclick="FluxApp.filterQueue(\\'pending\\')">Pending</button>' +
                            '<button class="filter-tab ' + (statusFilter === 'review' ? 'active' : '') + '" onclick="FluxApp.filterQueue(\\'review\\')">Needs Review</button>' +
                            '<button class="filter-tab ' + (statusFilter === 'completed' ? 'active' : '') + '" onclick="FluxApp.filterQueue(\\'completed\\')">Completed</button>' +
                        '</div>' +
                    '</div>' +
                    '<div class="data-table">' +
                        '<table>' +
                            '<thead><tr>' +
                                '<th class="col-check"><input type="checkbox" id="selectAll" onchange="FluxApp.toggleSelectAll()"></th>' +
                                '<th class="col-doc">Document</th>' +
                                '<th>Vendor</th>' +
                                '<th>Invoice #</th>' +
                                '<th class="col-amount">Amount</th>' +
                                '<th class="col-confidence">Confidence</th>' +
                                '<th class="col-status">Status</th>' +
                                '<th class="col-actions">Actions</th>' +
                            '</tr></thead>' +
                            '<tbody>' + this.queueRows(queue) + '</tbody>' +
                        '</table>' +
                    '</div>' +
                    (totalPages > 1 ? '<div class="pagination"><button class="btn btn-icon" ' + (page <= 1 ? 'disabled' : '') + ' onclick="FluxApp.goToPage(' + (page - 1) + ')"><i class="fas fa-chevron-left"></i></button><span class="pagination-info">Page ' + page + ' of ' + totalPages + '</span><button class="btn btn-icon" ' + (page >= totalPages ? 'disabled' : '') + ' onclick="FluxApp.goToPage(' + (page + 1) + ')"><i class="fas fa-chevron-right"></i></button></div>' : '') +
                '</div>';
            },

            queueRows: function(queue) {
                if (!queue || queue.length === 0) {
                    return '<tr><td colspan="8"><div class="empty-state"><div class="empty-icon"><i class="fas fa-inbox"></i></div><h4>No documents found</h4><p>Try adjusting your filters or upload new documents</p></div></td></tr>';
                }
                return queue.map(function(doc) {
                    var confClass = Utils.getConfidenceClass(doc.confidence);
                    var statusClass = Utils.getStatusClass(doc.status);
                    return '<tr class="' + (doc.hasAnomalies ? 'row-warning' : '') + '">' +
                        '<td class="col-check"><input type="checkbox" class="doc-select" value="' + doc.id + '"></td>' +
                        '<td class="col-doc"><span class="doc-name">' + Utils.escapeHtml(doc.name) + '</span></td>' +
                        '<td>' + Utils.escapeHtml(doc.vendorName || '-') + '</td>' +
                        '<td><code>' + Utils.escapeHtml(doc.invoiceNumber || '-') + '</code></td>' +
                        '<td class="col-amount"><strong>$' + Utils.formatNumber(doc.totalAmount) + '</strong></td>' +
                        '<td class="col-confidence"><div class="confidence-indicator ' + confClass + '"><div class="confidence-bar"><div class="confidence-fill" style="width:' + (doc.confidence || 0) + '%"></div></div><span>' + (doc.confidence || 0) + '%</span></div></td>' +
                        '<td class="col-status"><span class="status-pill status-' + statusClass + '">' + Utils.escapeHtml(doc.statusText || 'Pending') + '</span></td>' +
                        '<td class="col-actions"><div class="action-group"><button class="btn btn-icon btn-ghost" onclick="FluxApp.reviewDoc(' + doc.id + ')" title="Review"><i class="fas fa-eye"></i></button><button class="btn btn-icon btn-ghost btn-danger" onclick="FluxApp.deleteDoc(' + doc.id + ')" title="Delete"><i class="fas fa-trash-can"></i></button></div></td>' +
                    '</tr>';
                }).join('');
            },

            review: function(data) {
                var doc = data || {};
                if (!doc.id) {
                    return '<div class="page-body"><div class="empty-state"><div class="empty-icon"><i class="fas fa-file-circle-question"></i></div><h4>Document not found</h4><p>The requested document could not be loaded</p><button class="btn btn-primary" onclick="FluxApp.navigate(\\'queue\\')">Back to Queue</button></div></div>';
                }

                var confLevel = Utils.getConfidenceClass(doc.confidence);
                var anomalies = doc.anomalies || [];
                var lineItems = doc.lineItems || [];

                return '<div class="review-layout">' +
                    '<div class="review-toolbar">' +
                        '<button class="btn btn-ghost" onclick="FluxApp.navigate(\\'queue\\')"><i class="fas fa-arrow-left"></i> Back</button>' +
                        '<div class="review-toolbar-title"><span class="doc-type-badge">Invoice</span><span>' + Utils.escapeHtml(doc.invoiceNumber || 'Document Review') + '</span></div>' +
                        '<div class="review-toolbar-actions">' +
                            '<button class="btn btn-danger" onclick="FluxApp.rejectDocument(' + doc.id + ')"><i class="fas fa-xmark"></i> Reject</button>' +
                            '<button class="btn btn-success" onclick="FluxApp.approveDocument(' + doc.id + ')"><i class="fas fa-check"></i> Approve & Create</button>' +
                        '</div>' +
                    '</div>' +
                    '<div class="review-content">' +
                        '<div class="preview-panel">' +
                            '<div class="preview-tools">' +
                                '<button class="btn btn-icon btn-ghost" onclick="FluxApp.zoomOut()" title="Zoom Out"><i class="fas fa-minus"></i></button>' +
                                '<button class="btn btn-icon btn-ghost" onclick="FluxApp.zoomIn()" title="Zoom In"><i class="fas fa-plus"></i></button>' +
                                '<button class="btn btn-icon btn-ghost" onclick="FluxApp.downloadFile(' + doc.sourceFile + ')" title="Download"><i class="fas fa-download"></i></button>' +
                            '</div>' +
                            '<div class="preview-viewport">' + (doc.fileUrl ? '<iframe src="' + doc.fileUrl + '" id="docPreview"></iframe>' : '<div class="no-preview"><i class="fas fa-file-image"></i><p>Preview not available</p></div>') + '</div>' +
                        '</div>' +
                        '<div class="extraction-panel">' +
                            '<div class="confidence-header confidence-' + confLevel + '">' +
                                '<div class="confidence-score-ring">' +
                                    '<svg viewBox="0 0 36 36"><circle class="ring-bg" cx="18" cy="18" r="15.5" fill="none" stroke-width="3"/><circle class="ring-fill" cx="18" cy="18" r="15.5" fill="none" stroke-width="3" stroke-dasharray="' + (doc.confidence || 0) + ' 100" transform="rotate(-90 18 18)"/></svg>' +
                                    '<span class="score-value">' + (doc.confidence || 0) + '</span>' +
                                '</div>' +
                                '<div class="confidence-info"><span class="confidence-label">' + (confLevel.charAt(0).toUpperCase() + confLevel.slice(1)) + ' Confidence</span><span class="confidence-desc">AI extraction accuracy</span></div>' +
                            '</div>' +
                            (anomalies.length > 0 ? '<div class="anomaly-alerts">' + anomalies.map(function(a) { var sev = a.severity || 'medium'; return '<div class="anomaly-alert anomaly-' + sev + '"><i class="fas fa-triangle-exclamation"></i><span>' + Utils.escapeHtml(a.message) + '</span></div>'; }).join('') + '</div>' : '') +
                            '<div class="form-section"><h4>Vendor Information</h4><div class="form-field"><label>Vendor Name</label><input type="text" id="vendorName" value="' + Utils.escapeHtml(doc.vendorName || '') + '" onchange="FluxApp.trackChange(\\'vendor\\', this.value)"></div></div>' +
                            '<div class="form-section"><h4>Invoice Details</h4><div class="form-row"><div class="form-field"><label>Invoice Number</label><input type="text" id="invoiceNumber" value="' + Utils.escapeHtml(doc.invoiceNumber || '') + '" onchange="FluxApp.trackChange(\\'invoiceNumber\\', this.value)"></div><div class="form-field"><label>Invoice Date</label><input type="date" id="invoiceDate" value="' + Utils.formatDateInput(doc.invoiceDate) + '" onchange="FluxApp.trackChange(\\'invoiceDate\\', this.value)"></div></div><div class="form-row"><div class="form-field"><label>Due Date</label><input type="date" id="dueDate" value="' + Utils.formatDateInput(doc.dueDate) + '" onchange="FluxApp.trackChange(\\'dueDate\\', this.value)"></div><div class="form-field"><label>PO Number</label><input type="text" id="poNumber" value="' + Utils.escapeHtml(doc.poNumber || '') + '" onchange="FluxApp.trackChange(\\'poNumber\\', this.value)"></div></div></div>' +
                            '<div class="form-section"><h4>Amounts</h4><div class="amount-inputs"><div class="amount-field"><label>Subtotal</label><div class="input-currency"><span>$</span><input type="number" step="0.01" id="subtotal" value="' + (doc.subtotal || 0) + '" onchange="FluxApp.trackChange(\\'subtotal\\', this.value); FluxApp.calculateTotal()"></div></div><div class="amount-field"><label>Tax</label><div class="input-currency"><span>$</span><input type="number" step="0.01" id="taxAmount" value="' + (doc.taxAmount || 0) + '" onchange="FluxApp.trackChange(\\'taxAmount\\', this.value); FluxApp.calculateTotal()"></div></div><div class="amount-field amount-total"><label>Total</label><div class="input-currency"><span>$</span><input type="number" step="0.01" id="totalAmount" value="' + (doc.totalAmount || 0) + '" onchange="FluxApp.trackChange(\\'totalAmount\\', this.value)"></div></div></div></div>' +
                            (lineItems.length > 0 ? this.lineItemsSection(lineItems) : '') +
                        '</div>' +
                    '</div>' +
                '</div>';
            },

            lineItemsSection: function(items) {
                return '<div class="form-section"><h4>Line Items <span class="count-badge">' + items.length + '</span></h4><div class="line-items-grid">' +
                    items.map(function(item) {
                        return '<div class="line-item-row"><div class="line-item-desc"><input type="text" value="' + Utils.escapeHtml(item.description || '') + '" placeholder="Description"></div><div class="line-item-qty"><input type="number" value="' + (item.quantity || 0) + '" placeholder="Qty"></div><div class="line-item-price"><input type="number" step="0.01" value="' + (item.unitPrice || 0) + '" placeholder="Price"></div><div class="line-item-amount"><input type="number" step="0.01" value="' + (item.amount || 0) + '" placeholder="Amount" readonly></div></div>';
                    }).join('') +
                '</div></div>';
            },

            batch: function(data) {
                var batches = data || [];

                return '<div class="page-header">' +
                    '<div class="page-header-content">' +
                        '<div class="page-header-title">' +
                            '<h1>Batch Processing</h1>' +
                            '<p class="page-subtitle">Manage document batches</p>' +
                        '</div>' +
                    '</div>' +
                '</div>' +
                '<div class="page-body">' +
                    '<div class="card">' +
                        '<div class="card-header"><div class="card-title"><i class="fas fa-boxes-stacked"></i> Recent Batches</div></div>' +
                        '<div class="card-body">' +
                            '<div class="data-table"><table>' +
                                '<thead><tr><th>Batch Name</th><th>Documents</th><th>Progress</th><th>Status</th><th>Created</th><th class="col-actions">Actions</th></tr></thead>' +
                                '<tbody>' + this.batchRows(batches) + '</tbody>' +
                            '</table></div>' +
                        '</div>' +
                    '</div>' +
                '</div>';
            },

            batchRows: function(batches) {
                if (!batches || batches.length === 0) {
                    return '<tr><td colspan="6"><div class="empty-state empty-state-sm"><div class="empty-icon"><i class="fas fa-boxes-stacked"></i></div><h4>No batches yet</h4><p>Batch processing will appear here</p></div></td></tr>';
                }
                return batches.map(function(b) {
                    var progress = b.progress || 0;
                    return '<tr><td><strong>' + Utils.escapeHtml(b.name) + '</strong></td><td>' + (b.processedCount || 0) + ' / ' + (b.documentCount || 0) + '</td><td><div class="mini-progress"><div class="mini-progress-fill" style="width:' + progress + '%"></div></div></td><td><span class="status-pill">' + Utils.escapeHtml(b.statusText || 'Pending') + '</span></td><td>' + Utils.formatDate(b.createdDate) + '</td><td class="col-actions"><button class="btn btn-icon btn-ghost" onclick="FluxApp.viewBatch(' + b.id + ')"><i class="fas fa-eye"></i></button></td></tr>';
                }).join('');
            },

            settings: function() {
                return '<div class="page-header">' +
                    '<div class="page-header-content">' +
                        '<div class="page-header-title">' +
                            '<h1>Settings</h1>' +
                            '<p class="page-subtitle">Configure Flux Capture</p>' +
                        '</div>' +
                    '</div>' +
                '</div>' +
                '<div class="page-body">' +
                    '<div class="settings-layout">' +
                        '<div class="settings-card"><div class="settings-card-header"><i class="fas fa-microchip"></i><div><h3>Processing</h3><p>Configure AI extraction settings</p></div></div><div class="settings-card-body">' +
                            '<div class="setting-row"><div class="setting-label"><span>Auto-approve Threshold</span><small>Documents above this confidence are auto-approved</small></div><div class="setting-control"><input type="range" min="70" max="100" value="85" id="autoThreshold" oninput="document.getElementById(\\'thresholdValue\\').textContent=this.value+\\'%\\'"><span id="thresholdValue" class="range-value">85%</span></div></div>' +
                            '<div class="setting-row"><div class="setting-label"><span>Default Document Type</span><small>Used when auto-detect is disabled</small></div><div class="setting-control"><select id="defaultType"><option value="auto">Auto-Detect</option><option value="INVOICE">Invoice</option><option value="RECEIPT">Receipt</option></select></div></div>' +
                        '</div></div>' +
                        '<div class="settings-card"><div class="settings-card-header"><i class="fas fa-shield-halved"></i><div><h3>Fraud Detection</h3><p>Configure anomaly detection rules</p></div></div><div class="settings-card-body">' +
                            '<div class="setting-row"><div class="setting-label"><span>Duplicate Detection</span><small>Flag potential duplicate invoices</small></div><div class="setting-control"><label class="toggle"><input type="checkbox" id="duplicateDetection" checked><span class="toggle-track"><span class="toggle-thumb"></span></span></label></div></div>' +
                            '<div class="setting-row"><div class="setting-label"><span>Amount Validation</span><small>Verify line items sum to total</small></div><div class="setting-control"><label class="toggle"><input type="checkbox" id="amountValidation" checked><span class="toggle-track"><span class="toggle-thumb"></span></span></label></div></div>' +
                        '</div></div>' +
                        '<div class="settings-card"><div class="settings-card-header"><i class="fas fa-bell"></i><div><h3>Notifications</h3><p>Manage alert preferences</p></div></div><div class="settings-card-body">' +
                            '<div class="setting-row"><div class="setting-label"><span>Email Notifications</span><small>Receive processing summaries via email</small></div><div class="setting-control"><label class="toggle"><input type="checkbox" id="emailNotifications" checked><span class="toggle-track"><span class="toggle-thumb"></span></span></label></div></div>' +
                            '<div class="setting-row"><div class="setting-label"><span>Anomaly Alerts</span><small>Get notified about detected anomalies</small></div><div class="setting-control"><label class="toggle"><input type="checkbox" id="anomalyAlerts" checked><span class="toggle-track"><span class="toggle-thumb"></span></span></label></div></div>' +
                        '</div></div>' +
                    '</div>' +
                    '<div class="settings-footer"><button class="btn btn-primary btn-lg" onclick="UI.toast(\\'Settings saved!\\', \\'success\\')"><i class="fas fa-check"></i> Save Changes</button></div>' +
                '</div>';
            }
        };

        // ==================== View Controller ====================
        var Views = {
            render: function(view, params, navigationId) {
                params = params || {};
                var container = document.getElementById('viewContainer');
                var self = this;

                // Fade out current content
                container.style.opacity = '0';
                container.style.transform = 'translateY(8px)';

                setTimeout(function() {
                    // Check if this navigation is still current
                    if (navigationId !== State.navigationId) {
                        return; // Newer navigation started, abort this one
                    }

                    self.loadAndRender(view, params, container, navigationId);
                }, CONFIG.FADE_DURATION);
            },

            loadAndRender: function(view, params, container, navigationId) {
                var self = this;
                var signal = State.abortController ? State.abortController.signal : null;

                UI.showLoading();

                this.fetchData(view, params, signal)
                    .then(function(data) {
                        // Check if this navigation is still current
                        if (navigationId !== State.navigationId) {
                            return;
                        }

                        // Update state only after successful fetch
                        State.currentView = view;
                        State.currentParams = params;

                        var html = self.getTemplate(view, data, params);
                        container.innerHTML = html;

                        // Fade in new content
                        requestAnimationFrame(function() {
                            container.style.opacity = '1';
                            container.style.transform = 'translateY(0)';
                        });

                        // Initialize view-specific handlers
                        self.initViewHandlers(view);
                        UI.hideLoading();
                        State.isNavigating = false;

                        // Update queue badge
                        if (data && data.summary && typeof data.summary.pendingReview !== 'undefined') {
                            UI.updateBadge(data.summary.pendingReview);
                        }
                    })
                    .catch(function(err) {
                        // Check if this navigation is still current
                        if (navigationId !== State.navigationId) {
                            return;
                        }

                        // Ignore abort errors
                        if (err.name === 'AbortError') {
                            return;
                        }

                        console.error('View load error:', err);
                        container.innerHTML = '<div class="page-body"><div class="empty-state"><div class="empty-icon error"><i class="fas fa-triangle-exclamation"></i></div><h4>Error Loading View</h4><p>' + Utils.escapeHtml(err.message) + '</p><button class="btn btn-primary" onclick="FluxApp.navigate(\\'dashboard\\')">Go to Dashboard</button></div></div>';
                        container.style.opacity = '1';
                        container.style.transform = 'translateY(0)';
                        UI.hideLoading();
                        State.isNavigating = false;
                    });
            },

            fetchData: function(view, params, signal) {
                switch (view) {
                    case 'dashboard':
                        return Promise.all([
                            API.get('stats', {}, signal),
                            API.get('anomalies', { limit: 5 }, signal)
                        ]).then(function(results) {
                            var stats = results[0];
                            stats.recentDocs = [];
                            stats.anomalies = results[1];
                            return stats;
                        });
                    case 'queue':
                        return API.get('queue', { page: params.page || 1, status: params.status || '' }, signal);
                    case 'review':
                        return params.docId ? API.get('document', { id: params.docId }, signal) : Promise.resolve({});
                    case 'batch':
                        return API.get('batches', {}, signal);
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
                    default: return '<div class="page-body"><div class="empty-state"><div class="empty-icon"><i class="fas fa-question"></i></div><h4>View not found</h4></div></div>';
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

                document.querySelectorAll('.type-card').forEach(function(card) {
                    card.onclick = function() {
                        document.querySelectorAll('.type-card').forEach(function(c) { c.classList.remove('active'); });
                        card.classList.add('active');
                        card.querySelector('input').checked = true;
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
                var zone = document.getElementById('uploadZone');
                if (!queue || !list) return;

                if (State.uploadFiles.length === 0) {
                    queue.style.display = 'none';
                    if (zone) zone.style.display = 'block';
                    return;
                }

                queue.style.display = 'block';
                if (zone) zone.style.display = 'none';

                list.innerHTML = State.uploadFiles.map(function(f, i) {
                    var ext = f.name.split('.').pop().toUpperCase();
                    return '<div class="queue-file-item"><div class="file-icon"><i class="fas fa-file-' + (ext === 'PDF' ? 'pdf' : 'image') + '"></i></div><div class="file-info"><span class="file-name">' + Utils.escapeHtml(f.name) + '</span><span class="file-size">' + (f.size / 1024 / 1024).toFixed(2) + ' MB</span></div><button class="btn btn-icon btn-ghost btn-danger" onclick="FluxApp.removeFile(' + i + ')"><i class="fas fa-xmark"></i></button></div>';
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
                    if (progressText) progressText.textContent = 'Processing ' + (current + 1) + ' of ' + total + ': ' + f.name;
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
            var container = document.getElementById('viewContainer');
            if (container) {
                container.style.transition = 'opacity ' + CONFIG.FADE_DURATION + 'ms ease, transform ' + CONFIG.FADE_DURATION + 'ms ease';
            }

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
        // Try multiple possible paths for the CSS file
        var paths = [
            '/SuiteApps/com.flux.capture/FC_Styles.css',
            'SuiteApps/com.flux.capture/FC_Styles.css',
            '/SuiteScripts/com.flux.capture/FC_Styles.css',
            'SuiteScripts/com.flux.capture/FC_Styles.css'
        ];

        for (var i = 0; i < paths.length; i++) {
            try {
                var cssFile = file.load({ id: paths[i] });
                log.debug('CSS Loaded', 'Found at: ' + paths[i] + ', URL: ' + cssFile.url);
                return cssFile.url;
            } catch (e) {
                log.debug('CSS Path Failed', paths[i] + ' - ' + e.message);
            }
        }

        // Try searching for the file
        try {
            var searchResults = require('N/search').create({
                type: 'file',
                filters: [['name', 'is', 'FC_Styles.css']],
                columns: ['internalid', 'url', 'folder']
            }).run().getRange({ start: 0, end: 1 });

            if (searchResults.length > 0) {
                var foundUrl = searchResults[0].getValue('url');
                log.debug('CSS Found via Search', 'URL: ' + foundUrl);
                return foundUrl;
            }
        } catch (searchErr) {
            log.debug('CSS Search Failed', searchErr.message);
        }

        log.error('CSS Load Failed', 'Could not find FC_Styles.css in any location');
        return '';
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
