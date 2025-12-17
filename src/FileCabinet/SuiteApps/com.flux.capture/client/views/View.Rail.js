/**
 * Flux Capture - Document Rail View Controller
 * Revolutionary document processing interface with horizontal flow
 */
(function() {
    'use strict';

    // Document status constants
    var DocStatus = {
        PENDING: 1,
        PROCESSING: 2,
        EXTRACTED: 3,
        NEEDS_REVIEW: 4,
        REJECTED: 5,
        COMPLETED: 6,
        ERROR: 7
    };

    // Zone configuration
    var ZONES = [
        { id: 'incoming', label: 'Incoming', statuses: [DocStatus.PENDING], icon: 'fa-inbox' },
        { id: 'extracting', label: 'Extracting', statuses: [DocStatus.PROCESSING], icon: 'fa-cog' },
        { id: 'review', label: 'Review', statuses: [DocStatus.NEEDS_REVIEW, DocStatus.EXTRACTED], icon: 'fa-eye' },
        { id: 'ready', label: 'Ready', statuses: [], icon: 'fa-check-circle' }, // Approved but not posted
        { id: 'done', label: 'Done', statuses: [DocStatus.COMPLETED], icon: 'fa-check-double' }
    ];

    // Flow Mode keyboard shortcuts
    var FLOW_SHORTCUTS = {
        'ArrowRight': { action: 'approve', description: 'Approve and next' },
        'ArrowLeft': { action: 'skip', description: 'Skip for now' },
        'ArrowDown': { action: 'reject', description: 'Reject with reason' },
        'ArrowUp': { action: 'flag', description: 'Flag for supervisor' },
        'Space': { action: 'toggleZoom', description: 'Toggle preview zoom' },
        'Tab': { action: 'nextField', description: 'Next field' },
        'Enter': { action: 'confirm', description: 'Confirm action' },
        'Escape': { action: 'exitFlow', description: 'Exit flow mode' }
    };

    var RailController = {
        documents: [],
        selectedDoc: null,
        selectedDocId: null,
        hoveredDoc: null,
        flowMode: false,
        flowIndex: 0,
        reviewQueue: [],
        multiSelect: [],
        formFields: null,
        formTabs: ['details', 'classification', 'lines', 'custom'],
        activeTab: 'details',
        ghostPreviewTimer: null,
        commandPaletteOpen: false,
        stats: null,
        refreshInterval: null,
        REFRESH_MS: 5000,

        // ==========================================
        // INITIALIZATION
        // ==========================================
        init: function() {
            var self = this;
            this.documents = [];
            this.selectedDoc = null;
            this.selectedDocId = null;
            this.flowMode = false;
            this.multiSelect = [];
            this.activeTab = 'details';

            // Render base template
            renderTemplate('tpl-rail', 'view-container');

            // Bind events
            this.bindEvents();
            this.bindKeyboardShortcuts();
            this.bindDragDrop();

            // Load data
            this.loadData();

            // Start auto-refresh
            this.startRefresh();
        },

        // ==========================================
        // DATA LOADING
        // ==========================================
        loadData: function() {
            var self = this;

            // Load documents and stats in parallel
            Promise.all([
                API.get('list', { pageSize: 200 }),
                API.get('stats'),
                API.get('formfields', { transactionType: 'vendorbill' })
            ]).then(function(results) {
                self.documents = results[0] || [];
                self.stats = results[1] || {};
                self.formFields = results[2] || {};

                // Build review queue (documents needing review)
                self.reviewQueue = self.documents.filter(function(d) {
                    return d.status == DocStatus.NEEDS_REVIEW || d.status == DocStatus.EXTRACTED;
                });

                self.render();
            }).catch(function(err) {
                console.error('[Rail] Load error:', err);
                UI.toast('Failed to load documents: ' + err.message, 'error');
            });
        },

        startRefresh: function() {
            var self = this;
            this.stopRefresh();
            this.refreshInterval = setInterval(function() {
                if (!self.flowMode && !self.commandPaletteOpen) {
                    self.loadData();
                }
            }, this.REFRESH_MS);
        },

        stopRefresh: function() {
            if (this.refreshInterval) {
                clearInterval(this.refreshInterval);
                this.refreshInterval = null;
            }
        },

        // ==========================================
        // EVENT BINDING
        // ==========================================
        bindEvents: function() {
            var self = this;

            // Flow mode toggle
            this.on('#btn-flow-mode', 'click', function() {
                self.toggleFlowMode();
            });

            // Search / Command palette
            this.on('#rail-search', 'focus', function() {
                self.openCommandPalette();
            });

            this.on('#btn-command-palette', 'click', function() {
                self.openCommandPalette();
            });

            // Zone card clicks (delegated)
            document.addEventListener('click', function(e) {
                var card = e.target.closest('.doc-card');
                if (card) {
                    var docId = card.dataset.docId;
                    if (e.shiftKey && self.selectedDocId) {
                        self.extendMultiSelect(docId);
                    } else if (e.ctrlKey || e.metaKey) {
                        self.toggleMultiSelect(docId);
                    } else {
                        self.selectDocument(docId);
                    }
                    e.preventDefault();
                }

                // Quick action buttons
                var quickAction = e.target.closest('.quick-action');
                if (quickAction) {
                    var action = quickAction.dataset.action;
                    var docId = quickAction.closest('.doc-card').dataset.docId;
                    self.handleQuickAction(action, docId);
                    e.preventDefault();
                    e.stopPropagation();
                }
            });

            // Card hover for ghost preview
            document.addEventListener('mouseover', function(e) {
                var card = e.target.closest('.doc-card');
                if (card && !self.selectedDocId) {
                    self.showGhostPreview(card.dataset.docId);
                }
            });

            document.addEventListener('mouseout', function(e) {
                var card = e.target.closest('.doc-card');
                if (card) {
                    self.hideGhostPreview();
                }
            });

            // Detail panel tabs
            document.addEventListener('click', function(e) {
                var tab = e.target.closest('.detail-tab');
                if (tab) {
                    self.switchTab(tab.dataset.tab);
                }
            });

            // Form field changes
            document.addEventListener('change', function(e) {
                if (e.target.closest('#detail-form')) {
                    self.markFormDirty();
                }
            });

            // Action buttons
            this.on('#btn-approve', 'click', function() { self.approveDocument(); });
            this.on('#btn-reject', 'click', function() { self.rejectDocument(); });
            this.on('#btn-save', 'click', function() { self.saveChanges(); });

            // Upload button
            this.on('#btn-upload', 'click', function() {
                Router.navigate('upload');
            });
        },

        bindKeyboardShortcuts: function() {
            var self = this;

            document.addEventListener('keydown', function(e) {
                // Command palette shortcut
                if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
                    e.preventDefault();
                    self.openCommandPalette();
                    return;
                }

                // Flow mode shortcuts
                if (self.flowMode) {
                    var shortcut = FLOW_SHORTCUTS[e.code] || FLOW_SHORTCUTS[e.key];
                    if (shortcut) {
                        e.preventDefault();
                        self.handleFlowAction(shortcut.action);
                        return;
                    }
                }

                // Normal mode shortcuts
                if (!e.target.closest('input, textarea, select')) {
                    switch (e.key) {
                        case 'ArrowRight':
                            if (e.ctrlKey) self.selectNextInReview();
                            break;
                        case 'ArrowLeft':
                            if (e.ctrlKey) self.selectPrevInReview();
                            break;
                        case 'Enter':
                            if (self.selectedDocId) self.approveDocument();
                            break;
                        case 'f':
                            if (!e.ctrlKey) self.toggleFlowMode();
                            break;
                    }
                }
            });
        },

        bindDragDrop: function() {
            var self = this;
            var dropZone = document.body;

            dropZone.addEventListener('dragover', function(e) {
                e.preventDefault();
                document.body.classList.add('drag-active');
            });

            dropZone.addEventListener('dragleave', function(e) {
                if (e.target === document.body || !document.body.contains(e.relatedTarget)) {
                    document.body.classList.remove('drag-active');
                }
            });

            dropZone.addEventListener('drop', function(e) {
                e.preventDefault();
                document.body.classList.remove('drag-active');

                var files = Array.from(e.dataTransfer.files);
                if (files.length > 0) {
                    self.handleFileDrop(files);
                }
            });
        },

        on: function(selector, event, handler) {
            var el = document.querySelector(selector);
            if (el) el.addEventListener(event, handler);
        },

        // ==========================================
        // RENDERING
        // ==========================================
        render: function() {
            this.renderRailHeader();
            this.renderZones();
            this.renderDetailPanel();
            this.updateFlowModeUI();
        },

        renderRailHeader: function() {
            var stats = this.stats || {};
            var headerStats = el('#rail-stats');
            if (!headerStats) return;

            var incoming = this.documents.filter(function(d) { return d.status == DocStatus.PENDING; }).length;
            var processing = this.documents.filter(function(d) { return d.status == DocStatus.PROCESSING; }).length;
            var review = this.documents.filter(function(d) { return d.status == DocStatus.NEEDS_REVIEW || d.status == DocStatus.EXTRACTED; }).length;
            var done = this.documents.filter(function(d) { return d.status == DocStatus.COMPLETED; }).length;

            headerStats.innerHTML =
                '<span class="stat-item"><span class="stat-num">' + incoming + '</span> incoming</span>' +
                '<span class="stat-item"><span class="stat-num">' + processing + '</span> extracting</span>' +
                '<span class="stat-item highlight"><span class="stat-num">' + review + '</span> to review</span>' +
                '<span class="stat-item success"><span class="stat-num">' + done + '</span> done today</span>';
        },

        renderZones: function() {
            var self = this;

            ZONES.forEach(function(zone) {
                var container = el('#zone-' + zone.id + ' .zone-cards');
                if (!container) return;

                var docs = self.getDocumentsForZone(zone);
                var countEl = el('#zone-' + zone.id + ' .zone-count');
                if (countEl) countEl.textContent = docs.length;

                if (docs.length === 0) {
                    container.innerHTML = '<div class="zone-empty">No documents</div>';
                    return;
                }

                container.innerHTML = docs.map(function(doc) {
                    return self.renderDocCard(doc, zone.id);
                }).join('');
            });
        },

        getDocumentsForZone: function(zone) {
            var self = this;
            return this.documents.filter(function(d) {
                return zone.statuses.indexOf(parseInt(d.status)) !== -1;
            });
        },

        renderDocCard: function(doc, zoneId) {
            var isSelected = this.selectedDocId == doc.id;
            var isMulti = this.multiSelect.indexOf(String(doc.id)) !== -1;
            var confidence = doc.confidence || 0;
            var confClass = confidence >= 85 ? 'high' : confidence >= 60 ? 'medium' : 'low';
            var hasAnomaly = doc.anomalies && doc.anomalies.length > 0;

            var glowClass = '';
            if (doc.status == DocStatus.PROCESSING) glowClass = 'glow-processing';
            else if (hasAnomaly) glowClass = 'glow-anomaly';
            else if (confClass === 'high') glowClass = 'glow-high';
            else if (confClass === 'medium') glowClass = 'glow-medium';
            else if (confClass === 'low') glowClass = 'glow-low';

            var cardClass = 'doc-card ' + glowClass;
            if (isSelected) cardClass += ' selected';
            if (isMulti) cardClass += ' multi-selected';
            if (zoneId === 'review' && isSelected) cardClass += ' expanded';

            var html = '<div class="' + cardClass + '" data-doc-id="' + doc.id + '">';

            // Compact view for non-review zones
            if (zoneId !== 'review' || !isSelected) {
                html += '<div class="card-header">' +
                    '<span class="card-vendor">' + escapeHtml(doc.vendorName || 'Unknown') + '</span>' +
                    '<span class="card-amount">$' + formatAmount(doc.totalAmount || 0) + '</span>' +
                    '</div>';

                if (doc.invoiceNumber) {
                    html += '<div class="card-ref">' + escapeHtml(doc.invoiceNumber) + '</div>';
                }

                html += '<div class="card-footer">' +
                    '<span class="confidence-dots conf-' + confClass + '">' +
                    '<span class="dot"></span><span class="dot"></span><span class="dot"></span><span class="dot"></span><span class="dot"></span>' +
                    '</span>';

                if (hasAnomaly) {
                    html += '<span class="anomaly-indicator" title="' + doc.anomalies.length + ' alert(s)"><i class="fas fa-triangle-exclamation"></i></span>';
                }

                html += '</div>';

                // Quick actions on hover
                html += '<div class="card-quick-actions">' +
                    '<button class="quick-action" data-action="approve" title="Approve"><i class="fas fa-check"></i></button>' +
                    '<button class="quick-action" data-action="reject" title="Reject"><i class="fas fa-times"></i></button>' +
                    '<button class="quick-action" data-action="open" title="Open"><i class="fas fa-arrow-right"></i></button>' +
                    '</div>';
            } else {
                // Expanded view in review zone
                html += '<div class="card-expanded">' +
                    '<div class="expanded-preview">' +
                    (doc.sourceFile ? '<iframe src="/core/media/media.nl?id=' + doc.sourceFile + '"></iframe>' : '<div class="no-preview">No preview</div>') +
                    '</div>' +
                    '<div class="expanded-info">' +
                    '<div class="expanded-header">' +
                    '<span class="card-vendor">' + escapeHtml(doc.vendorName || 'Unknown') + '</span>' +
                    '<span class="confidence-badge conf-' + confClass + '">' + confidence + '%</span>' +
                    '</div>' +
                    '<div class="expanded-details">' +
                    '<div class="detail-row"><span>Invoice:</span> ' + escapeHtml(doc.invoiceNumber || 'N/A') + '</div>' +
                    '<div class="detail-row"><span>Amount:</span> $' + formatAmount(doc.totalAmount || 0) + '</div>' +
                    '<div class="detail-row"><span>Due:</span> ' + formatDate(doc.dueDate) + '</div>' +
                    '</div>' +
                    '<div class="expanded-actions">' +
                    '<button class="btn btn-success btn-sm" data-action="approve"><i class="fas fa-check"></i> Approve</button>' +
                    '<button class="btn btn-ghost btn-sm" data-action="open"><i class="fas fa-expand"></i></button>' +
                    '</div>' +
                    '</div>' +
                    '</div>';
            }

            html += '</div>';
            return html;
        },

        renderDetailPanel: function() {
            var panel = el('#detail-panel');
            if (!panel) return;

            if (!this.selectedDoc) {
                this.renderDashboardPanel(panel);
            } else {
                this.renderDocumentPanel(panel);
            }
        },

        renderDashboardPanel: function(panel) {
            var stats = this.stats || {};
            var review = this.reviewQueue.length;

            panel.innerHTML =
                '<div class="panel-dashboard">' +
                '<div class="dash-header">' +
                '<h3>Today\'s Progress</h3>' +
                '</div>' +
                '<div class="dash-stats">' +
                '<div class="dash-stat">' +
                '<span class="dash-value">' + (stats.processedToday || 0) + '</span>' +
                '<span class="dash-label">Processed</span>' +
                '</div>' +
                '<div class="dash-stat">' +
                '<span class="dash-value">' + review + '</span>' +
                '<span class="dash-label">Pending Review</span>' +
                '</div>' +
                '<div class="dash-stat">' +
                '<span class="dash-value">$' + formatAmount(stats.totalValueToday || 0) + '</span>' +
                '<span class="dash-label">Total Value</span>' +
                '</div>' +
                '<div class="dash-stat">' +
                '<span class="dash-value">' + (stats.autoApproveRate || 0) + '%</span>' +
                '<span class="dash-label">Auto-Approved</span>' +
                '</div>' +
                '</div>' +
                (review > 0 ?
                    '<button class="btn btn-primary btn-lg btn-block" id="btn-start-review">' +
                    '<i class="fas fa-play"></i> Start Reviewing (' + review + ')' +
                    '</button>' : '') +
                '<div class="dash-anomalies">' +
                '<h4><i class="fas fa-triangle-exclamation"></i> Recent Alerts</h4>' +
                this.renderRecentAnomalies() +
                '</div>' +
                '</div>';

            // Bind start review button
            var self = this;
            this.on('#btn-start-review', 'click', function() {
                self.toggleFlowMode();
            });
        },

        renderRecentAnomalies: function() {
            var anomalies = [];
            this.documents.forEach(function(d) {
                if (d.anomalies && d.anomalies.length > 0) {
                    d.anomalies.forEach(function(a) {
                        anomalies.push({ doc: d, anomaly: a });
                    });
                }
            });

            if (anomalies.length === 0) {
                return '<div class="no-anomalies">No alerts</div>';
            }

            return anomalies.slice(0, 5).map(function(item) {
                return '<div class="anomaly-item">' +
                    '<i class="fas fa-exclamation-circle"></i>' +
                    '<span>' + escapeHtml(item.anomaly.message || item.anomaly.type) + '</span>' +
                    '<span class="anomaly-doc">' + escapeHtml(item.doc.vendorName || 'Doc #' + item.doc.id) + '</span>' +
                    '</div>';
            }).join('');
        },

        renderDocumentPanel: function(panel) {
            var doc = this.selectedDoc;
            var confidence = doc.confidence || 0;
            var confClass = confidence >= 85 ? 'high' : confidence >= 60 ? 'medium' : 'low';

            panel.innerHTML =
                '<div class="panel-document">' +
                '<div class="panel-preview">' +
                (doc.sourceFile ?
                    '<iframe src="/core/media/media.nl?id=' + doc.sourceFile + '" id="doc-preview-frame"></iframe>' :
                    '<div class="no-preview"><i class="fas fa-file-image"></i><span>No preview</span></div>') +
                '<div class="preview-controls">' +
                '<button class="btn btn-icon btn-ghost" id="btn-zoom-in"><i class="fas fa-plus"></i></button>' +
                '<button class="btn btn-icon btn-ghost" id="btn-zoom-out"><i class="fas fa-minus"></i></button>' +
                '<button class="btn btn-icon btn-ghost" id="btn-rotate"><i class="fas fa-rotate-right"></i></button>' +
                '</div>' +
                '</div>' +
                '<div class="panel-confidence">' +
                '<div class="conf-gauge conf-' + confClass + '">' +
                '<span class="conf-value">' + confidence + '</span>' +
                '<span class="conf-label">' + (confClass === 'high' ? 'High' : confClass === 'medium' ? 'Medium' : 'Low') + '</span>' +
                '</div>' +
                '</div>' +
                '<div class="panel-tabs">' +
                this.renderDetailTabs() +
                '</div>' +
                '<div class="panel-form" id="detail-form">' +
                this.renderActiveTabContent() +
                '</div>' +
                '<div class="panel-actions">' +
                '<button class="btn btn-success btn-lg" id="btn-approve"><i class="fas fa-check"></i> Approve</button>' +
                '<div class="action-row">' +
                '<button class="btn btn-ghost" id="btn-reject"><i class="fas fa-times"></i> Reject</button>' +
                '<button class="btn btn-secondary" id="btn-save"><i class="fas fa-save"></i> Save</button>' +
                '</div>' +
                '</div>' +
                '</div>';

            this.bindDetailPanelEvents();
        },

        renderDetailTabs: function() {
            var self = this;
            var tabs = [
                { id: 'details', label: 'Details', icon: 'fa-file-lines' },
                { id: 'classification', label: 'Class', icon: 'fa-tags' },
                { id: 'lines', label: 'Lines', icon: 'fa-list' },
                { id: 'custom', label: 'Custom', icon: 'fa-cog' }
            ];

            return '<div class="tab-list">' + tabs.map(function(tab) {
                var activeClass = self.activeTab === tab.id ? ' active' : '';
                return '<button class="detail-tab' + activeClass + '" data-tab="' + tab.id + '">' +
                    '<i class="fas ' + tab.icon + '"></i> ' + tab.label +
                    '</button>';
            }).join('') + '</div>';
        },

        renderActiveTabContent: function() {
            var doc = this.selectedDoc;
            if (!doc) return '';

            switch (this.activeTab) {
                case 'details':
                    return this.renderDetailsTab(doc);
                case 'classification':
                    return this.renderClassificationTab(doc);
                case 'lines':
                    return this.renderLinesTab(doc);
                case 'custom':
                    return this.renderCustomTab(doc);
                default:
                    return '';
            }
        },

        renderDetailsTab: function(doc) {
            var formFields = this.formFields || {};
            var bodyFields = formFields.bodyFields || [];

            return '<div class="form-compact">' +
                '<div class="field-row">' +
                '<div class="field-group">' +
                '<label>Vendor</label>' +
                '<input type="text" id="field-vendor" value="' + escapeHtml(doc.vendorName || '') + '" class="field-input">' +
                '</div>' +
                '</div>' +
                '<div class="field-row two-col">' +
                '<div class="field-group">' +
                '<label>Invoice #</label>' +
                '<input type="text" id="field-invoiceNumber" value="' + escapeHtml(doc.invoiceNumber || '') + '">' +
                '</div>' +
                '<div class="field-group">' +
                '<label>PO #</label>' +
                '<input type="text" id="field-poNumber" value="' + escapeHtml(doc.poNumber || '') + '">' +
                '</div>' +
                '</div>' +
                '<div class="field-row two-col">' +
                '<div class="field-group">' +
                '<label>Date</label>' +
                '<input type="date" id="field-invoiceDate" value="' + formatDateInput(doc.invoiceDate) + '">' +
                '</div>' +
                '<div class="field-group">' +
                '<label>Due Date</label>' +
                '<input type="date" id="field-dueDate" value="' + formatDateInput(doc.dueDate) + '">' +
                '</div>' +
                '</div>' +
                '<div class="field-row two-col">' +
                '<div class="field-group">' +
                '<label>Subtotal</label>' +
                '<div class="input-currency"><span>$</span><input type="number" step="0.01" id="field-subtotal" value="' + (doc.subtotal || 0).toFixed(2) + '"></div>' +
                '</div>' +
                '<div class="field-group">' +
                '<label>Tax</label>' +
                '<div class="input-currency"><span>$</span><input type="number" step="0.01" id="field-taxAmount" value="' + (doc.taxAmount || 0).toFixed(2) + '"></div>' +
                '</div>' +
                '</div>' +
                '<div class="field-row">' +
                '<div class="field-group total-field">' +
                '<label>Total Amount</label>' +
                '<div class="input-currency total"><span>$</span><input type="number" step="0.01" id="field-totalAmount" value="' + (doc.totalAmount || 0).toFixed(2) + '"></div>' +
                '</div>' +
                '</div>' +
                '</div>';
        },

        renderClassificationTab: function(doc) {
            var formFields = this.formFields || {};
            var bodyFields = formFields.bodyFields || [];

            var selectFields = ['subsidiary', 'department', 'class', 'location', 'terms', 'currency', 'account'];
            var html = '<div class="form-compact">';

            selectFields.forEach(function(fieldId) {
                var field = bodyFields.find(function(f) { return f.id === fieldId; });
                if (!field) return;

                html += '<div class="field-row">' +
                    '<div class="field-group">' +
                    '<label>' + escapeHtml(field.label || fieldId) + '</label>';

                if (field.options && field.options.length > 0) {
                    html += '<select id="field-' + fieldId + '">' +
                        '<option value="">-- Select --</option>';
                    field.options.forEach(function(opt) {
                        var selected = String(doc[fieldId]) === String(opt.value) ? ' selected' : '';
                        html += '<option value="' + escapeHtml(opt.value) + '"' + selected + '>' + escapeHtml(opt.text) + '</option>';
                    });
                    html += '</select>';
                } else {
                    html += '<input type="text" id="field-' + fieldId + '" value="' + escapeHtml(doc[fieldId] || '') + '">';
                }

                html += '</div></div>';
            });

            html += '</div>';
            return html;
        },

        renderLinesTab: function(doc) {
            var lines = doc.lineItems || [];

            if (lines.length === 0) {
                return '<div class="empty-lines">' +
                    '<i class="fas fa-receipt"></i>' +
                    '<span>No line items</span>' +
                    '<button class="btn btn-ghost btn-sm" id="btn-add-line"><i class="fas fa-plus"></i> Add Line</button>' +
                    '</div>';
            }

            var html = '<div class="lines-list">';
            lines.forEach(function(line, idx) {
                html += '<div class="line-item" data-idx="' + idx + '">' +
                    '<div class="line-desc">' +
                    '<input type="text" value="' + escapeHtml(line.description || '') + '" placeholder="Description">' +
                    '</div>' +
                    '<div class="line-nums">' +
                    '<input type="number" value="' + (line.quantity || 1) + '" class="line-qty" step="0.01">' +
                    '<span>×</span>' +
                    '<input type="number" value="' + (line.unitPrice || 0).toFixed(2) + '" class="line-price" step="0.01">' +
                    '<span>=</span>' +
                    '<input type="number" value="' + (line.amount || 0).toFixed(2) + '" class="line-amount" step="0.01">' +
                    '</div>' +
                    '<button class="btn btn-icon btn-ghost btn-remove-line"><i class="fas fa-times"></i></button>' +
                    '</div>';
            });

            var total = lines.reduce(function(sum, l) { return sum + (l.amount || 0); }, 0);
            html += '</div>' +
                '<div class="lines-footer">' +
                '<button class="btn btn-ghost btn-sm" id="btn-add-line"><i class="fas fa-plus"></i> Add</button>' +
                '<span class="lines-total">Total: $' + total.toFixed(2) + '</span>' +
                '</div>';

            return html;
        },

        renderCustomTab: function(doc) {
            var formFields = this.formFields || {};
            var customFields = (formFields.bodyFields || []).filter(function(f) { return f.isCustom; });

            if (customFields.length === 0) {
                return '<div class="empty-custom"><i class="fas fa-cog"></i><span>No custom fields</span></div>';
            }

            var html = '<div class="form-compact">';
            customFields.forEach(function(field) {
                html += '<div class="field-row">' +
                    '<div class="field-group">' +
                    '<label>' + escapeHtml(field.label || field.id) + '</label>' +
                    '<input type="text" id="field-' + field.id + '" value="' + escapeHtml(doc[field.id] || '') + '">' +
                    '</div></div>';
            });
            html += '</div>';
            return html;
        },

        bindDetailPanelEvents: function() {
            var self = this;

            this.on('#btn-approve', 'click', function() { self.approveDocument(); });
            this.on('#btn-reject', 'click', function() { self.rejectDocument(); });
            this.on('#btn-save', 'click', function() { self.saveChanges(); });
            this.on('#btn-add-line', 'click', function() { self.addLineItem(); });
        },

        // ==========================================
        // DOCUMENT ACTIONS
        // ==========================================
        selectDocument: function(docId) {
            var self = this;
            this.selectedDocId = docId;
            this.selectedDoc = this.documents.find(function(d) { return d.id == docId; });
            this.multiSelect = [];

            // Re-render zones and detail panel
            this.renderZones();
            this.renderDetailPanel();
        },

        handleQuickAction: function(action, docId) {
            switch (action) {
                case 'approve':
                    this.quickApprove(docId);
                    break;
                case 'reject':
                    this.quickReject(docId);
                    break;
                case 'open':
                    Router.navigate('review', { docId: docId });
                    break;
            }
        },

        quickApprove: function(docId) {
            var self = this;
            API.put('approve', { documentId: docId, createTransaction: true })
                .then(function() {
                    UI.toast('Document approved', 'success');
                    self.loadData();
                })
                .catch(function(err) {
                    UI.toast('Error: ' + err.message, 'error');
                });
        },

        quickReject: function(docId) {
            var self = this;
            UI.prompt('Rejection reason:').then(function(reason) {
                if (reason) {
                    API.put('reject', { documentId: docId, reason: reason })
                        .then(function() {
                            UI.toast('Document rejected', 'success');
                            self.loadData();
                        })
                        .catch(function(err) {
                            UI.toast('Error: ' + err.message, 'error');
                        });
                }
            });
        },

        approveDocument: function() {
            if (!this.selectedDocId) return;
            var self = this;

            API.put('approve', { documentId: this.selectedDocId, createTransaction: true })
                .then(function() {
                    UI.toast('Document approved', 'success');
                    self.selectedDocId = null;
                    self.selectedDoc = null;
                    self.loadData();
                })
                .catch(function(err) {
                    UI.toast('Error: ' + err.message, 'error');
                });
        },

        rejectDocument: function() {
            if (!this.selectedDocId) return;
            var self = this;

            UI.prompt('Rejection reason:').then(function(reason) {
                if (reason) {
                    API.put('reject', { documentId: self.selectedDocId, reason: reason })
                        .then(function() {
                            UI.toast('Document rejected', 'success');
                            self.selectedDocId = null;
                            self.selectedDoc = null;
                            self.loadData();
                        })
                        .catch(function(err) {
                            UI.toast('Error: ' + err.message, 'error');
                        });
                }
            });
        },

        saveChanges: function() {
            if (!this.selectedDocId) return;
            var self = this;

            var updates = this.collectFormData();
            API.put('update', { documentId: this.selectedDocId, updates: updates })
                .then(function() {
                    UI.toast('Changes saved', 'success');
                    self.loadData();
                })
                .catch(function(err) {
                    UI.toast('Error: ' + err.message, 'error');
                });
        },

        collectFormData: function() {
            var updates = {};
            var form = el('#detail-form');
            if (!form) return updates;

            form.querySelectorAll('input, select, textarea').forEach(function(field) {
                var id = field.id;
                if (id && id.startsWith('field-')) {
                    var key = id.replace('field-', '');
                    updates[key] = field.value;
                }
            });

            return updates;
        },

        switchTab: function(tabId) {
            this.activeTab = tabId;
            var form = el('#detail-form');
            if (form) {
                form.innerHTML = this.renderActiveTabContent();
            }

            // Update tab active state
            document.querySelectorAll('.detail-tab').forEach(function(tab) {
                tab.classList.toggle('active', tab.dataset.tab === tabId);
            });
        },

        // ==========================================
        // FLOW MODE
        // ==========================================
        toggleFlowMode: function() {
            this.flowMode = !this.flowMode;

            if (this.flowMode) {
                this.flowIndex = 0;
                if (this.reviewQueue.length > 0) {
                    this.selectDocument(this.reviewQueue[0].id);
                }
            }

            this.updateFlowModeUI();
        },

        updateFlowModeUI: function() {
            var flowOverlay = el('#flow-mode-overlay');
            var btn = el('#btn-flow-mode');

            if (this.flowMode) {
                document.body.classList.add('flow-mode-active');
                if (btn) btn.classList.add('active');
            } else {
                document.body.classList.remove('flow-mode-active');
                if (btn) btn.classList.remove('active');
            }
        },

        handleFlowAction: function(action) {
            switch (action) {
                case 'approve':
                    this.approveAndNext();
                    break;
                case 'skip':
                    this.skipDocument();
                    break;
                case 'reject':
                    this.rejectDocument();
                    break;
                case 'flag':
                    this.flagDocument();
                    break;
                case 'exitFlow':
                    this.toggleFlowMode();
                    break;
            }
        },

        approveAndNext: function() {
            var self = this;
            if (!this.selectedDocId) return;

            API.put('approve', { documentId: this.selectedDocId, createTransaction: true })
                .then(function() {
                    self.flowIndex++;
                    if (self.flowIndex < self.reviewQueue.length) {
                        self.selectDocument(self.reviewQueue[self.flowIndex].id);
                    } else {
                        UI.toast('All documents reviewed!', 'success');
                        self.toggleFlowMode();
                    }
                    self.loadData();
                });
        },

        skipDocument: function() {
            this.flowIndex++;
            if (this.flowIndex < this.reviewQueue.length) {
                this.selectDocument(this.reviewQueue[this.flowIndex].id);
            }
        },

        // ==========================================
        // GHOST PREVIEW
        // ==========================================
        showGhostPreview: function(docId) {
            var self = this;
            clearTimeout(this.ghostPreviewTimer);

            this.ghostPreviewTimer = setTimeout(function() {
                var doc = self.documents.find(function(d) { return d.id == docId; });
                if (doc && !self.selectedDocId) {
                    self.hoveredDoc = doc;
                    self.renderGhostPreview(doc);
                }
            }, 300);
        },

        hideGhostPreview: function() {
            clearTimeout(this.ghostPreviewTimer);
            this.hoveredDoc = null;

            var ghost = el('#ghost-preview');
            if (ghost) ghost.classList.remove('visible');
        },

        renderGhostPreview: function(doc) {
            var panel = el('#detail-panel');
            if (!panel || this.selectedDocId) return;

            var ghost = el('#ghost-preview');
            if (!ghost) {
                ghost = document.createElement('div');
                ghost.id = 'ghost-preview';
                ghost.className = 'ghost-preview';
                panel.appendChild(ghost);
            }

            ghost.innerHTML =
                '<div class="ghost-content">' +
                (doc.sourceFile ?
                    '<iframe src="/core/media/media.nl?id=' + doc.sourceFile + '"></iframe>' :
                    '<div class="no-preview"><i class="fas fa-file"></i></div>') +
                '<div class="ghost-info">' +
                '<span class="ghost-vendor">' + escapeHtml(doc.vendorName || 'Unknown') + '</span>' +
                '<span class="ghost-amount">$' + formatAmount(doc.totalAmount || 0) + '</span>' +
                '</div>' +
                '</div>';

            ghost.classList.add('visible');
        },

        // ==========================================
        // COMMAND PALETTE
        // ==========================================
        openCommandPalette: function() {
            this.commandPaletteOpen = true;
            var self = this;

            var overlay = document.createElement('div');
            overlay.id = 'command-palette';
            overlay.className = 'command-palette-overlay';
            overlay.innerHTML =
                '<div class="command-palette">' +
                '<div class="palette-search">' +
                '<i class="fas fa-search"></i>' +
                '<input type="text" id="palette-input" placeholder="Type a command or search..." autofocus>' +
                '</div>' +
                '<div class="palette-results" id="palette-results">' +
                this.renderDefaultCommands() +
                '</div>' +
                '</div>';

            document.body.appendChild(overlay);

            // Focus input
            setTimeout(function() {
                var input = el('#palette-input');
                if (input) input.focus();
            }, 50);

            // Bind events
            overlay.addEventListener('click', function(e) {
                if (e.target === overlay) self.closeCommandPalette();
            });

            el('#palette-input').addEventListener('input', function(e) {
                self.filterCommands(e.target.value);
            });

            el('#palette-input').addEventListener('keydown', function(e) {
                if (e.key === 'Escape') self.closeCommandPalette();
                if (e.key === 'Enter') self.executeSelectedCommand();
            });
        },

        closeCommandPalette: function() {
            this.commandPaletteOpen = false;
            var overlay = el('#command-palette');
            if (overlay) overlay.remove();
        },

        renderDefaultCommands: function() {
            var commands = [
                { icon: 'fa-play', label: 'Start Flow Mode', action: 'flowMode', shortcut: 'F' },
                { icon: 'fa-check-double', label: 'Approve all high confidence', action: 'approveHighConf' },
                { icon: 'fa-search', label: 'Find vendor...', action: 'findVendor' },
                { icon: 'fa-clone', label: 'Show duplicates', action: 'showDuplicates' },
                { icon: 'fa-file-export', label: 'Export to CSV', action: 'export' },
                { icon: 'fa-cloud-arrow-up', label: 'Upload documents', action: 'upload', shortcut: 'U' }
            ];

            return '<div class="command-section"><div class="section-title">Quick Actions</div>' +
                commands.map(function(cmd) {
                    return '<div class="command-item" data-action="' + cmd.action + '">' +
                        '<i class="fas ' + cmd.icon + '"></i>' +
                        '<span class="command-label">' + cmd.label + '</span>' +
                        (cmd.shortcut ? '<span class="command-shortcut">' + cmd.shortcut + '</span>' : '') +
                        '</div>';
                }).join('') +
                '</div>';
        },

        filterCommands: function(query) {
            // Implement command filtering
        },

        executeSelectedCommand: function() {
            // Implement command execution
        },

        // ==========================================
        // DRAG AND DROP UPLOAD
        // ==========================================
        handleFileDrop: function(files) {
            var self = this;
            UI.toast('Uploading ' + files.length + ' file(s)...', 'info');

            // Upload each file
            var uploadPromises = files.map(function(file) {
                return self.uploadFile(file);
            });

            Promise.all(uploadPromises)
                .then(function() {
                    UI.toast('Upload complete', 'success');
                    self.loadData();
                })
                .catch(function(err) {
                    UI.toast('Upload failed: ' + err.message, 'error');
                });
        },

        uploadFile: function(file) {
            return new Promise(function(resolve, reject) {
                var reader = new FileReader();
                reader.onload = function(e) {
                    var base64 = e.target.result.split(',')[1];
                    API.post('upload', {
                        fileName: file.name,
                        fileContent: base64,
                        documentType: 'auto',
                        source: 'DRAG_DROP'
                    }).then(resolve).catch(reject);
                };
                reader.onerror = reject;
                reader.readAsDataURL(file);
            });
        },

        // ==========================================
        // MULTI-SELECT
        // ==========================================
        toggleMultiSelect: function(docId) {
            var idx = this.multiSelect.indexOf(String(docId));
            if (idx === -1) {
                this.multiSelect.push(String(docId));
            } else {
                this.multiSelect.splice(idx, 1);
            }
            this.renderZones();
        },

        extendMultiSelect: function(docId) {
            // Extend selection from selectedDocId to docId
            // Implementation depends on document ordering
        },

        // ==========================================
        // CLEANUP
        // ==========================================
        cleanup: function() {
            this.stopRefresh();
            this.documents = [];
            this.selectedDoc = null;
            this.selectedDocId = null;
            this.flowMode = false;
        }
    };

    // Helper functions
    function formatAmount(amount) {
        return (amount || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    }

    function formatDate(date) {
        if (!date) return 'N/A';
        return new Date(date).toLocaleDateString();
    }

    // Register the controller
    Router.register('rail',
        function(params) { RailController.init(params); },
        function() { RailController.cleanup(); }
    );

    console.log('[View.Rail] Document Rail Loaded');

})();
