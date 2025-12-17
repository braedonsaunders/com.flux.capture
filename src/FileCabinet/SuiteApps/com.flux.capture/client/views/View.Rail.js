/**
 * Flux Capture - Document Rail View Controller
 * Unified document processing interface with horizontal flow
 */
(function() {
    'use strict';

    // Document status constants (must match server)
    var DocStatus = {
        PENDING: '1',
        PROCESSING: '2',
        EXTRACTED: '3',
        NEEDS_REVIEW: '4',
        REJECTED: '5',
        COMPLETED: '6',
        ERROR: '7'
    };

    // Zone configuration mapping statuses to zones
    var ZONES = [
        { id: 'incoming', label: 'Incoming', statuses: [DocStatus.PENDING], icon: 'fa-inbox' },
        { id: 'extracting', label: 'Extracting', statuses: [DocStatus.PROCESSING], icon: 'fa-cog' },
        { id: 'review', label: 'Review', statuses: [DocStatus.NEEDS_REVIEW, DocStatus.EXTRACTED, DocStatus.ERROR], icon: 'fa-eye' },
        { id: 'done', label: 'Done', statuses: [DocStatus.COMPLETED, DocStatus.REJECTED], icon: 'fa-check-double' }
    ];

    var RailController = {
        documents: [],
        selectedDoc: null,
        selectedDocId: null,
        formFields: null,
        activeTab: 'details',
        flowMode: false,
        flowIndex: 0,
        reviewQueue: [],
        refreshInterval: null,
        detailPanelOpen: false,
        REFRESH_MS: 8000,

        // ==========================================
        // INITIALIZATION
        // ==========================================
        init: function() {
            this.documents = [];
            this.selectedDoc = null;
            this.selectedDocId = null;
            this.activeTab = 'details';
            this.flowMode = false;
            this.detailPanelOpen = false;
            this.formFieldsLoaded = false;

            renderTemplate('tpl-rail', 'view-container');
            this.bindEvents();
            this.loadInitialData();
            this.startRefresh();
        },

        cleanup: function() {
            this.stopRefresh();
            this.documents = [];
            this.selectedDoc = null;
        },

        // ==========================================
        // DATA LOADING
        // ==========================================
        loadInitialData: function() {
            var self = this;

            // Load queue data AND form fields on first load only
            Promise.all([
                API.get('queue', { pageSize: 100 }),
                API.get('formfields', { transactionType: 'vendorbill' })
            ]).then(function(results) {
                var queueData = results[0] || {};
                self.documents = queueData.queue || [];
                self.formFields = results[1] || {};
                self.formFieldsLoaded = true;

                self.processDocuments();
                self.render();

                // If we had a selected doc, refresh its data
                if (self.selectedDocId) {
                    self.loadDocumentDetails(self.selectedDocId);
                }
            }).catch(function(err) {
                console.error('[Flow] Load error:', err);
                UI.toast('Failed to load documents: ' + err.message, 'error');
            });
        },

        refreshQueue: function() {
            var self = this;

            // Only refresh queue data, not form fields
            API.get('queue', { pageSize: 100 }).then(function(queueData) {
                self.documents = (queueData && queueData.queue) || [];
                self.processDocuments();
                self.render();
            }).catch(function(err) {
                console.error('[Flow] Refresh error:', err);
            });
        },

        processDocuments: function() {
            var self = this;
            // Build review queue
            this.reviewQueue = this.documents.filter(function(d) {
                var status = String(d.status);
                return status === DocStatus.NEEDS_REVIEW ||
                       status === DocStatus.EXTRACTED ||
                       status === DocStatus.ERROR;
            });
        },

        loadData: function() {
            // For backwards compatibility, call refreshQueue
            this.refreshQueue();
        },

        loadDocumentDetails: function(docId) {
            var self = this;
            API.get('document', { id: docId }).then(function(doc) {
                self.selectedDoc = doc;
                self.renderDetailPanel();
            }).catch(function(err) {
                console.error('[Rail] Document load error:', err);
            });
        },

        startRefresh: function() {
            var self = this;
            this.stopRefresh();
            this.refreshInterval = setInterval(function() {
                if (!self.flowMode && !self.detailPanelOpen) {
                    self.refreshQueue();
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

            // Upload button
            this.on('#btn-upload', 'click', function() {
                Router.navigate('upload');
            });

            // Flow mode toggle
            this.on('#btn-flow-mode', 'click', function() {
                self.toggleFlowMode();
            });

            // Command palette
            this.on('#rail-search', 'click', function() {
                self.openCommandPalette();
            });

            // Card clicks - delegated
            document.addEventListener('click', function(e) {
                // Card selection
                var card = e.target.closest('.doc-card');
                if (card && !e.target.closest('.quick-action')) {
                    var docId = card.dataset.docId;
                    self.selectDocument(docId);
                    e.preventDefault();
                    return;
                }

                // Quick actions
                var quickAction = e.target.closest('.quick-action');
                if (quickAction) {
                    var action = quickAction.dataset.action;
                    var cardEl = quickAction.closest('.doc-card');
                    if (cardEl) {
                        self.handleQuickAction(action, cardEl.dataset.docId);
                    }
                    e.preventDefault();
                    e.stopPropagation();
                    return;
                }

                // Tab clicks
                var tab = e.target.closest('.detail-tab');
                if (tab) {
                    self.switchTab(tab.dataset.tab);
                    return;
                }

                // Close panel button
                if (e.target.closest('#btn-close-panel')) {
                    self.closeDetailPanel();
                    return;
                }
            });

            // Keyboard shortcuts
            document.addEventListener('keydown', function(e) {
                // Escape to close panel
                if (e.key === 'Escape') {
                    if (self.detailPanelOpen) {
                        self.closeDetailPanel();
                    } else if (self.flowMode) {
                        self.toggleFlowMode();
                    }
                    return;
                }

                // Flow mode shortcuts
                if (self.flowMode && !e.target.closest('input, textarea, select')) {
                    if (e.key === 'ArrowRight' || e.key === 'Enter') {
                        e.preventDefault();
                        self.approveAndNext();
                    } else if (e.key === 'ArrowLeft') {
                        e.preventDefault();
                        self.skipDocument();
                    } else if (e.key === 'ArrowDown') {
                        e.preventDefault();
                        self.rejectCurrent();
                    }
                }

                // Command palette
                if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
                    e.preventDefault();
                    self.openCommandPalette();
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
            this.renderStats();
            this.renderZones();
            if (!this.detailPanelOpen) {
                this.renderDetailPanel();
            }
        },

        renderStats: function() {
            var statsEl = el('#rail-stats');
            if (!statsEl) return;

            var counts = { incoming: 0, extracting: 0, review: 0, done: 0 };

            this.documents.forEach(function(d) {
                var status = String(d.status);
                if (status === DocStatus.PENDING) counts.incoming++;
                else if (status === DocStatus.PROCESSING) counts.extracting++;
                else if (status === DocStatus.NEEDS_REVIEW || status === DocStatus.EXTRACTED || status === DocStatus.ERROR) counts.review++;
                else if (status === DocStatus.COMPLETED || status === DocStatus.REJECTED) counts.done++;
            });

            statsEl.innerHTML =
                '<span class="stat-item"><span class="stat-num">' + counts.incoming + '</span> incoming</span>' +
                '<span class="stat-item"><span class="stat-num">' + counts.extracting + '</span> extracting</span>' +
                '<span class="stat-item highlight"><span class="stat-num">' + counts.review + '</span> to review</span>' +
                '<span class="stat-item success"><span class="stat-num">' + counts.done + '</span> done</span>';
        },

        renderZones: function() {
            var self = this;

            ZONES.forEach(function(zone) {
                var container = el('#zone-' + zone.id + ' .zone-cards');
                if (!container) return;

                var docs = self.documents.filter(function(d) {
                    return zone.statuses.indexOf(String(d.status)) !== -1;
                });

                // Update count
                var countEl = el('#zone-' + zone.id + ' .zone-count');
                if (countEl) countEl.textContent = docs.length;

                if (docs.length === 0) {
                    container.innerHTML = '<div class="zone-empty"><i class="fas fa-inbox"></i><span>Empty</span></div>';
                    return;
                }

                container.innerHTML = docs.slice(0, 20).map(function(doc) {
                    return self.renderDocCard(doc, zone.id);
                }).join('');

                if (docs.length > 20) {
                    container.innerHTML += '<div class="zone-more">+' + (docs.length - 20) + ' more</div>';
                }
            });
        },

        renderDocCard: function(doc, zoneId) {
            var isSelected = String(this.selectedDocId) === String(doc.id);
            var confidence = parseInt(doc.confidence) || 0;
            var confClass = confidence >= 85 ? 'high' : confidence >= 60 ? 'medium' : 'low';
            var status = String(doc.status);
            var hasAnomaly = doc.anomalies && doc.anomalies.length > 0;
            var hasError = status === DocStatus.ERROR;

            var glowClass = '';
            if (status === DocStatus.PROCESSING) glowClass = 'glow-processing';
            else if (hasError) glowClass = 'glow-error';
            else if (hasAnomaly) glowClass = 'glow-anomaly';
            else if (confClass === 'high') glowClass = 'glow-high';
            else if (confClass === 'medium') glowClass = 'glow-medium';
            else if (confClass === 'low') glowClass = 'glow-low';

            var cardClass = 'doc-card ' + glowClass;
            if (isSelected) cardClass += ' selected';

            return '<div class="' + cardClass + '" data-doc-id="' + doc.id + '">' +
                '<div class="card-header">' +
                    '<span class="card-vendor">' + escapeHtml(doc.vendorName || 'Unknown Vendor') + '</span>' +
                    '<span class="card-amount">$' + formatNumber(doc.totalAmount || 0) + '</span>' +
                '</div>' +
                (doc.invoiceNumber ? '<div class="card-ref">#' + escapeHtml(doc.invoiceNumber) + '</div>' : '') +
                (hasError ? '<div class="card-error"><i class="fas fa-exclamation-triangle"></i> Error</div>' : '') +
                '<div class="card-footer">' +
                    '<div class="confidence-bar"><div class="confidence-fill conf-' + confClass + '" style="width:' + confidence + '%"></div></div>' +
                    (hasAnomaly ? '<span class="anomaly-indicator"><i class="fas fa-flag"></i></span>' : '') +
                '</div>' +
                '<div class="card-actions">' +
                    '<button class="quick-action" data-action="approve" title="Approve"><i class="fas fa-check"></i></button>' +
                    '<button class="quick-action" data-action="review" title="Review"><i class="fas fa-expand"></i></button>' +
                    '<button class="quick-action" data-action="reject" title="Reject"><i class="fas fa-times"></i></button>' +
                '</div>' +
            '</div>';
        },

        renderDetailPanel: function() {
            var panel = el('#detail-panel');
            if (!panel) return;

            if (!this.selectedDoc) {
                panel.innerHTML = this.renderDashboardState();
                panel.classList.remove('open');
                this.detailPanelOpen = false;
            } else {
                panel.innerHTML = this.renderDocumentState();
                panel.classList.add('open');
                this.detailPanelOpen = true;
                this.bindDetailEvents();
            }
        },

        renderDashboardState: function() {
            var reviewCount = this.reviewQueue.length;

            return '<div class="panel-dashboard">' +
                '<div class="dash-summary">' +
                    '<div class="dash-stat-big">' +
                        '<span class="stat-value">' + reviewCount + '</span>' +
                        '<span class="stat-label">Documents to Review</span>' +
                    '</div>' +
                '</div>' +
                (reviewCount > 0 ?
                    '<button class="btn btn-primary btn-lg btn-block" id="btn-start-flow">' +
                        '<i class="fas fa-bolt"></i> Start Flow Mode' +
                    '</button>' :
                    '<div class="dash-empty"><i class="fas fa-check-circle"></i><p>All caught up!</p></div>'
                ) +
                '<div class="dash-tips">' +
                    '<h4>Quick Tips</h4>' +
                    '<ul>' +
                        '<li><kbd>Click</kbd> a card to review</li>' +
                        '<li><kbd>→</kbd> Approve in flow mode</li>' +
                        '<li><kbd>←</kbd> Skip document</li>' +
                        '<li><kbd>Esc</kbd> Close panel</li>' +
                    '</ul>' +
                '</div>' +
            '</div>';
        },

        renderDocumentState: function() {
            var doc = this.selectedDoc;
            if (!doc) return '';

            var confidence = parseInt(doc.confidence) || 0;
            var confClass = confidence >= 85 ? 'high' : confidence >= 60 ? 'medium' : 'low';
            var lineItems = doc.lineItems || [];

            return '<div class="panel-document">' +
                // Header with close button
                '<div class="panel-header">' +
                    '<div class="panel-title">' +
                        '<span class="conf-badge conf-' + confClass + '">' + confidence + '%</span>' +
                        '<span>' + escapeHtml(doc.vendorName || 'Document Review') + '</span>' +
                    '</div>' +
                    '<button class="btn btn-ghost btn-icon" id="btn-close-panel"><i class="fas fa-times"></i></button>' +
                '</div>' +
                // PDF Preview
                '<div class="panel-preview">' +
                    (doc.sourceFile ?
                        '<iframe src="' + this.getPreviewUrl(doc.sourceFile) + '" title="Document Preview"></iframe>' :
                        '<div class="no-preview"><i class="fas fa-file-pdf"></i><span>No preview available</span></div>'
                    ) +
                '</div>' +
                // Tabs
                '<div class="panel-tabs">' +
                    '<button class="detail-tab' + (this.activeTab === 'details' ? ' active' : '') + '" data-tab="details">Details</button>' +
                    '<button class="detail-tab' + (this.activeTab === 'lines' ? ' active' : '') + '" data-tab="lines">Lines (' + lineItems.length + ')</button>' +
                    '<button class="detail-tab' + (this.activeTab === 'more' ? ' active' : '') + '" data-tab="more">More</button>' +
                '</div>' +
                // Tab content
                '<div class="panel-content" id="panel-content">' +
                    this.renderTabContent() +
                '</div>' +
                // Actions
                '<div class="panel-actions">' +
                    '<button class="btn btn-success" id="btn-approve"><i class="fas fa-check"></i> Approve</button>' +
                    '<button class="btn btn-danger" id="btn-reject"><i class="fas fa-times"></i> Reject</button>' +
                    '<button class="btn btn-secondary" id="btn-full-review"><i class="fas fa-expand"></i> Full Review</button>' +
                '</div>' +
            '</div>';
        },

        renderTabContent: function() {
            var doc = this.selectedDoc;
            if (!doc) return '';

            switch (this.activeTab) {
                case 'details':
                    return this.renderDetailsTab(doc);
                case 'lines':
                    return this.renderLinesTab(doc);
                case 'more':
                    return this.renderMoreTab(doc);
                default:
                    return '';
            }
        },

        renderDetailsTab: function(doc) {
            return '<div class="detail-form">' +
                '<div class="form-row">' +
                    '<label>Vendor</label>' +
                    '<input type="text" id="field-vendor" value="' + escapeHtml(doc.vendorName || '') + '">' +
                '</div>' +
                '<div class="form-row-2col">' +
                    '<div class="form-row">' +
                        '<label>Invoice #</label>' +
                        '<input type="text" id="field-invoiceNumber" value="' + escapeHtml(doc.invoiceNumber || '') + '">' +
                    '</div>' +
                    '<div class="form-row">' +
                        '<label>Date</label>' +
                        '<input type="date" id="field-invoiceDate" value="' + formatDateInput(doc.invoiceDate) + '">' +
                    '</div>' +
                '</div>' +
                '<div class="form-row-2col">' +
                    '<div class="form-row">' +
                        '<label>Due Date</label>' +
                        '<input type="date" id="field-dueDate" value="' + formatDateInput(doc.dueDate) + '">' +
                    '</div>' +
                    '<div class="form-row">' +
                        '<label>PO #</label>' +
                        '<input type="text" id="field-poNumber" value="' + escapeHtml(doc.poNumber || '') + '">' +
                    '</div>' +
                '</div>' +
                '<div class="form-divider"></div>' +
                '<div class="form-row-2col">' +
                    '<div class="form-row">' +
                        '<label>Subtotal</label>' +
                        '<div class="input-money"><span>$</span><input type="number" step="0.01" id="field-subtotal" value="' + (doc.subtotal || 0).toFixed(2) + '"></div>' +
                    '</div>' +
                    '<div class="form-row">' +
                        '<label>Tax</label>' +
                        '<div class="input-money"><span>$</span><input type="number" step="0.01" id="field-taxAmount" value="' + (doc.taxAmount || 0).toFixed(2) + '"></div>' +
                    '</div>' +
                '</div>' +
                '<div class="form-row total-row">' +
                    '<label>Total</label>' +
                    '<div class="input-money total"><span>$</span><input type="number" step="0.01" id="field-totalAmount" value="' + (doc.totalAmount || 0).toFixed(2) + '"></div>' +
                '</div>' +
            '</div>';
        },

        renderLinesTab: function(doc) {
            var lines = doc.lineItems || [];

            if (lines.length === 0) {
                return '<div class="empty-state"><i class="fas fa-receipt"></i><p>No line items extracted</p></div>';
            }

            var html = '<div class="lines-list">';
            var total = 0;

            lines.forEach(function(line, idx) {
                var amount = parseFloat(line.amount) || 0;
                total += amount;
                html += '<div class="line-row">' +
                    '<div class="line-desc">' + escapeHtml(line.description || 'Line ' + (idx + 1)) + '</div>' +
                    '<div class="line-amount">$' + amount.toFixed(2) + '</div>' +
                '</div>';
            });

            html += '</div>' +
                '<div class="lines-total">' +
                    '<span>Line Total:</span>' +
                    '<span>$' + total.toFixed(2) + '</span>' +
                '</div>';

            return html;
        },

        renderMoreTab: function(doc) {
            var formFields = this.formFields || {};
            var bodyFields = formFields.bodyFields || [];

            // Show classification fields
            var classFields = ['subsidiary', 'department', 'class', 'location', 'terms', 'account'];
            var html = '<div class="detail-form">';

            classFields.forEach(function(fieldId) {
                var field = bodyFields.find(function(f) { return f.id === fieldId; });
                if (!field) return;

                html += '<div class="form-row">' +
                    '<label>' + escapeHtml(field.label || fieldId) + '</label>';

                if (field.options && field.options.length > 0) {
                    html += '<select id="field-' + fieldId + '">' +
                        '<option value="">-- Select --</option>';
                    field.options.forEach(function(opt) {
                        html += '<option value="' + escapeHtml(opt.value) + '">' + escapeHtml(opt.text) + '</option>';
                    });
                    html += '</select>';
                } else {
                    html += '<input type="text" id="field-' + fieldId + '" value="">';
                }

                html += '</div>';
            });

            html += '</div>';
            return html;
        },

        getPreviewUrl: function(fileId) {
            // NetSuite file cabinet URL format
            if (!fileId) return '';
            return '/core/media/media.nl?id=' + fileId + '&c=' + (window.FC_CONFIG ? window.FC_CONFIG.accountId : '') + '&h=1';
        },

        bindDetailEvents: function() {
            var self = this;

            this.on('#btn-approve', 'click', function() {
                self.approveDocument(self.selectedDocId);
            });

            this.on('#btn-reject', 'click', function() {
                self.rejectDocument(self.selectedDocId);
            });

            this.on('#btn-full-review', 'click', function() {
                Router.navigate('review', { docId: self.selectedDocId });
            });

            this.on('#btn-start-flow', 'click', function() {
                self.toggleFlowMode();
            });
        },

        // ==========================================
        // DOCUMENT ACTIONS
        // ==========================================
        selectDocument: function(docId) {
            this.selectedDocId = docId;
            this.loadDocumentDetails(docId);
            this.renderZones(); // Re-render to show selection
        },

        closeDetailPanel: function() {
            this.selectedDocId = null;
            this.selectedDoc = null;
            this.detailPanelOpen = false;
            this.renderDetailPanel();
            this.renderZones();
        },

        handleQuickAction: function(action, docId) {
            switch (action) {
                case 'approve':
                    this.approveDocument(docId);
                    break;
                case 'reject':
                    this.rejectDocument(docId);
                    break;
                case 'review':
                    Router.navigate('review', { docId: docId });
                    break;
            }
        },

        approveDocument: function(docId) {
            var self = this;
            API.put('approve', { documentId: docId, createTransaction: true })
                .then(function(result) {
                    UI.toast('Document approved!', 'success');
                    self.closeDetailPanel();
                    self.loadData();
                })
                .catch(function(err) {
                    UI.toast('Error: ' + err.message, 'error');
                });
        },

        rejectDocument: function(docId) {
            var self = this;
            UI.prompt('Enter rejection reason:').then(function(reason) {
                if (reason) {
                    API.put('reject', { documentId: docId, reason: reason })
                        .then(function() {
                            UI.toast('Document rejected', 'success');
                            self.closeDetailPanel();
                            self.loadData();
                        })
                        .catch(function(err) {
                            UI.toast('Error: ' + err.message, 'error');
                        });
                }
            });
        },

        switchTab: function(tabId) {
            this.activeTab = tabId;

            // Update tab buttons
            els('.detail-tab').forEach(function(tab) {
                tab.classList.toggle('active', tab.dataset.tab === tabId);
            });

            // Re-render content
            var contentEl = el('#panel-content');
            if (contentEl) {
                contentEl.innerHTML = this.renderTabContent();
            }
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
                    UI.toast('Flow Mode: Use arrow keys to navigate', 'info');
                } else {
                    this.flowMode = false;
                    UI.toast('No documents to review', 'warning');
                }
            }

            document.body.classList.toggle('flow-mode-active', this.flowMode);
            var btn = el('#btn-flow-mode');
            if (btn) btn.classList.toggle('active', this.flowMode);
        },

        approveAndNext: function() {
            var self = this;
            if (!this.selectedDocId) return;

            API.put('approve', { documentId: this.selectedDocId, createTransaction: true })
                .then(function() {
                    self.flowIndex++;
                    self.loadData().then(function() {
                        if (self.flowIndex < self.reviewQueue.length) {
                            self.selectDocument(self.reviewQueue[self.flowIndex].id);
                        } else {
                            UI.toast('All documents reviewed!', 'success');
                            self.toggleFlowMode();
                        }
                    });
                });
        },

        skipDocument: function() {
            this.flowIndex++;
            if (this.flowIndex < this.reviewQueue.length) {
                this.selectDocument(this.reviewQueue[this.flowIndex].id);
            } else {
                this.flowIndex = 0;
                if (this.reviewQueue.length > 0) {
                    this.selectDocument(this.reviewQueue[0].id);
                }
            }
        },

        rejectCurrent: function() {
            if (this.selectedDocId) {
                this.rejectDocument(this.selectedDocId);
            }
        },

        // ==========================================
        // COMMAND PALETTE
        // ==========================================
        openCommandPalette: function() {
            var self = this;
            var overlay = document.createElement('div');
            overlay.className = 'command-overlay';
            overlay.innerHTML =
                '<div class="command-modal">' +
                    '<input type="text" class="command-input" placeholder="Type a command..." autofocus>' +
                    '<div class="command-list">' +
                        '<div class="command-item" data-cmd="flow"><i class="fas fa-bolt"></i> Start Flow Mode</div>' +
                        '<div class="command-item" data-cmd="upload"><i class="fas fa-upload"></i> Upload Documents</div>' +
                        '<div class="command-item" data-cmd="refresh"><i class="fas fa-sync"></i> Refresh</div>' +
                        '<div class="command-item" data-cmd="settings"><i class="fas fa-cog"></i> Settings</div>' +
                    '</div>' +
                '</div>';

            overlay.addEventListener('click', function(e) {
                if (e.target === overlay) overlay.remove();

                var item = e.target.closest('.command-item');
                if (item) {
                    var cmd = item.dataset.cmd;
                    overlay.remove();
                    self.executeCommand(cmd);
                }
            });

            overlay.querySelector('.command-input').addEventListener('keydown', function(e) {
                if (e.key === 'Escape') overlay.remove();
            });

            document.body.appendChild(overlay);
            overlay.querySelector('.command-input').focus();
        },

        executeCommand: function(cmd) {
            switch (cmd) {
                case 'flow':
                    this.toggleFlowMode();
                    break;
                case 'upload':
                    Router.navigate('upload');
                    break;
                case 'refresh':
                    this.loadData();
                    UI.toast('Refreshed', 'success');
                    break;
                case 'settings':
                    Router.navigate('settings');
                    break;
            }
        }
    };

    // Register the controller as 'flow' (primary route)
    Router.register('flow',
        function(params) { RailController.init(params); },
        function() { RailController.cleanup(); }
    );

    // Keep backward compatibility with 'queue' and 'rail' routes
    Router.register('queue',
        function(params) { RailController.init(params); },
        function() { RailController.cleanup(); }
    );
    Router.register('rail',
        function(params) { RailController.init(params); },
        function() { RailController.cleanup(); }
    );

    console.log('[View.Flow] Loaded');

})();
