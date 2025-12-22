/**
 * Flux Capture - Mission Control Dashboard View
 * Action-First Smart Dashboard with one-click actions, keyboard navigation,
 * command palette, and smart triage queue
 */
(function() {
    'use strict';

    // ==========================================
    // CONSTANTS
    // ==========================================
    var QUICK_WIN_THRESHOLD = 85;  // Confidence >= 85% = quick win
    var URGENT_HOURS = 48;         // Due within 48 hours = urgent
    var REFRESH_MS = 15000;        // Auto-refresh interval

    // Status constants (match FC_Router.js)
    var DocStatus = {
        PENDING: '1',
        PROCESSING: '2',
        EXTRACTED: '3',
        NEEDS_REVIEW: '4',
        REJECTED: '5',
        COMPLETED: '6',
        ERROR: '7'
    };

    // ==========================================
    // DASHBOARD CONTROLLER
    // ==========================================
    var DashboardController = {
        // State
        documents: [],
        quickWins: [],
        triageQueue: [],
        selectedIds: new Set(),
        focusedIndex: -1,
        focusedSection: 'triage', // 'quick-wins' or 'triage'
        skippedIds: new Set(),
        refreshInterval: null,
        lastAction: null,  // For undo
        previewDoc: null,
        commandPaletteOpen: false,
        keyboardHelpOpen: false,
        bulkSelectMode: false,
        currentFilter: 'all',
        lastKeyTime: 0,
        lastKey: '',

        // Stats
        stats: {
            toReview: 0,
            processing: 0,
            doneToday: 0,
            pendingAmount: 0,
            quickWins: 0,
            needsAttention: 0,
            urgent: 0,
            anomalies: 0
        },

        // ==========================================
        // INITIALIZATION
        // ==========================================
        init: function() {
            var self = this;

            // Reset state
            this.documents = [];
            this.quickWins = [];
            this.triageQueue = [];
            this.selectedIds = new Set();
            this.focusedIndex = -1;
            this.skippedIds = this.loadSkippedIds();
            this.previewDoc = null;

            // Render template
            renderTemplate('tpl-dashboard', 'view-container');
            this.setGreeting();
            this.bindEvents();
            this.bindKeyboard();

            // Load data
            this.loadData();
            this.startRefresh();

            FCDebug.log('[Dashboard] Action-First Dashboard initialized');
        },

        cleanup: function() {
            this.stopRefresh();
            this.unbindKeyboard();
            this.documents = [];
            this.selectedIds.clear();
        },

        // ==========================================
        // DATA LOADING
        // ==========================================
        loadData: function() {
            var self = this;

            Promise.all([
                API.get('queue', { pageSize: 200 }),
                API.get('stats', {}).catch(function() { return {}; })
            ]).then(function(results) {
                var queueData = results[0] || {};
                var statsData = results[1] || {};

                self.documents = (queueData.queue || []).map(function(doc) {
                    return self.enrichDocument(doc);
                });

                self.processDocuments();
                self.calculateStats(statsData);
                self.render();

                // Update nav badge
                UI.updateBadge(self.stats.toReview);
            }).catch(function(err) {
                console.error('[Dashboard] Load error:', err);
                self.render();
            });
        },

        enrichDocument: function(doc) {
            var conf = parseInt(doc.confidence) || 0;
            var status = String(doc.status);
            var dueDate = doc.dueDate ? new Date(doc.dueDate) : null;
            var now = new Date();
            var hoursUntilDue = dueDate ? (dueDate - now) / (1000 * 60 * 60) : Infinity;

            // Calculate urgency score (lower = more urgent)
            var urgencyScore = hoursUntilDue < 0 ? -1000 : hoursUntilDue;

            // Calculate complexity score (lower = simpler)
            var complexityScore = 100 - conf;
            if (doc.anomalies && doc.anomalies.length > 0) {
                complexityScore += doc.anomalies.length * 20;
            }
            if (status === DocStatus.ERROR) {
                complexityScore += 50;
            }

            // Combined priority score (lower = higher priority)
            var priorityScore = (urgencyScore * 0.4) + (complexityScore * 0.6);

            return Object.assign({}, doc, {
                confidence: conf,
                isQuickWin: conf >= QUICK_WIN_THRESHOLD && status !== DocStatus.ERROR,
                isUrgent: hoursUntilDue <= URGENT_HOURS && hoursUntilDue > 0,
                isOverdue: hoursUntilDue < 0,
                isComplex: conf < 60 || (doc.anomalies && doc.anomalies.length > 0),
                isError: status === DocStatus.ERROR,
                isSkipped: this.skippedIds.has(String(doc.id)),
                urgencyScore: urgencyScore,
                complexityScore: complexityScore,
                priorityScore: priorityScore,
                hoursUntilDue: hoursUntilDue
            });
        },

        processDocuments: function() {
            var self = this;

            // Filter to reviewable documents
            var reviewable = this.documents.filter(function(d) {
                var status = String(d.status);
                return status === DocStatus.NEEDS_REVIEW ||
                       status === DocStatus.EXTRACTED ||
                       status === DocStatus.ERROR;
            });

            // Separate quick wins from triage
            this.quickWins = reviewable.filter(function(d) {
                return d.isQuickWin && !d.isSkipped;
            }).slice(0, 8); // Max 8 quick wins shown

            this.triageQueue = reviewable.filter(function(d) {
                return !d.isQuickWin || d.isSkipped;
            });

            // Sort triage by priority
            this.triageQueue.sort(function(a, b) {
                // Skipped items go to end
                if (a.isSkipped && !b.isSkipped) return 1;
                if (!a.isSkipped && b.isSkipped) return -1;
                return a.priorityScore - b.priorityScore;
            });
        },

        calculateStats: function(serverStats) {
            var self = this;
            var docs = this.documents;

            var toReview = 0;
            var processing = 0;
            var pendingAmount = 0;
            var urgent = 0;
            var anomalies = 0;

            docs.forEach(function(d) {
                var status = String(d.status);

                if (status === DocStatus.NEEDS_REVIEW || status === DocStatus.EXTRACTED || status === DocStatus.ERROR) {
                    toReview++;
                    pendingAmount += parseFloat(d.totalAmount) || 0;

                    if (d.isUrgent || d.isOverdue) urgent++;
                    if (d.isError || (d.anomalies && d.anomalies.length > 0)) anomalies++;
                }

                if (status === DocStatus.PROCESSING) {
                    processing++;
                }
            });

            this.stats = {
                toReview: toReview,
                processing: processing,
                doneToday: serverStats.summary ? serverStats.summary.completed : 0,
                pendingAmount: pendingAmount,
                quickWins: this.quickWins.length,
                needsAttention: this.triageQueue.filter(function(d) { return !d.isSkipped; }).length,
                urgent: urgent,
                anomalies: anomalies
            };
        },

        // ==========================================
        // RENDERING
        // ==========================================
        render: function() {
            this.renderStats();
            this.renderDigest();
            this.renderQuickWins();
            this.renderTriageQueue();
            this.renderActivityStream();
            this.renderTopVendors();
            this.updateBulkActionsUI();
        },

        renderStats: function() {
            var s = this.stats;

            this.setText('#stat-to-review .quick-stat-value', s.toReview);
            this.setText('#stat-processing .quick-stat-value', s.processing);
            this.setText('#stat-today .quick-stat-value', s.doneToday);
            this.setText('#stat-pending-amount .quick-stat-value', '$' + formatCompact(s.pendingAmount));
        },

        renderDigest: function() {
            var s = this.stats;
            var total = s.quickWins + s.needsAttention;
            var progress = total > 0 ? Math.round((s.doneToday / (s.doneToday + total)) * 100) : 100;

            // Update counts
            this.setText('#digest-quick-wins .digest-count', s.quickWins);
            this.setText('#digest-needs-attention .digest-count', s.needsAttention);
            this.setText('#digest-urgent .digest-count', s.urgent);
            this.setText('#digest-anomalies .digest-count', s.anomalies);

            // Update progress ring
            var progressFill = el('#progress-fill');
            var progressText = el('#progress-text');
            if (progressFill) {
                progressFill.setAttribute('stroke-dasharray', progress + ', 100');
            }
            if (progressText) {
                progressText.textContent = progress + '%';
            }
        },

        renderQuickWins: function() {
            var container = el('#quick-wins-cards');
            var countEl = el('#quick-wins-count');
            var approveAllBtn = el('#btn-approve-all-quick');

            if (!container) return;

            if (countEl) countEl.textContent = this.quickWins.length;
            if (approveAllBtn) {
                approveAllBtn.disabled = this.quickWins.length === 0;
            }

            if (this.quickWins.length === 0) {
                container.innerHTML = '<div class="empty-card"><i class="fas fa-check-circle"></i><span>No quick wins available</span></div>';
                return;
            }

            var self = this;
            var html = this.quickWins.map(function(doc, index) {
                var isSelected = self.selectedIds.has(String(doc.id));
                var isFocused = self.focusedSection === 'quick-wins' && self.focusedIndex === index;

                return self.renderQuickWinCard(doc, isSelected, isFocused);
            }).join('');

            container.innerHTML = html;
        },

        renderQuickWinCard: function(doc, isSelected, isFocused) {
            var vendorName = escapeHtml(doc.vendorName || 'Unknown Vendor');
            var amount = doc.totalAmount ? '$' + formatNumber(doc.totalAmount) : '';
            var invoiceNum = doc.invoiceNumber ? '#' + escapeHtml(doc.invoiceNumber) : '';
            var confidence = doc.confidence || 0;

            var classes = ['action-card', 'quick-win-card'];
            if (isSelected) classes.push('selected');
            if (isFocused) classes.push('focused');

            return '<div class="' + classes.join(' ') + '" data-doc-id="' + doc.id + '" data-index="' + doc._index + '">' +
                '<div class="card-checkbox">' +
                    '<input type="checkbox" ' + (isSelected ? 'checked' : '') + '>' +
                '</div>' +
                '<div class="card-content">' +
                    '<div class="card-vendor">' + vendorName + '</div>' +
                    '<div class="card-details">' +
                        (invoiceNum ? '<span class="card-invoice">' + invoiceNum + '</span>' : '') +
                        (amount ? '<span class="card-amount">' + amount + '</span>' : '') +
                    '</div>' +
                    '<div class="card-confidence">' +
                        '<div class="confidence-bar"><div class="confidence-fill high" style="width:' + confidence + '%"></div></div>' +
                        '<span>' + confidence + '%</span>' +
                    '</div>' +
                '</div>' +
                '<div class="card-actions">' +
                    '<button class="btn btn-success btn-sm card-approve" title="Approve (A)">' +
                        '<i class="fas fa-check"></i>' +
                    '</button>' +
                    '<button class="btn btn-ghost btn-sm card-open" title="Open (Enter)">' +
                        '<i class="fas fa-external-link-alt"></i>' +
                    '</button>' +
                '</div>' +
            '</div>';
        },

        renderTriageQueue: function() {
            var container = el('#triage-list');
            var countEl = el('#triage-count');
            var emptyEl = el('#triage-empty');

            if (!container) return;

            // Filter based on current filter
            var filtered = this.getFilteredTriageQueue();

            if (countEl) countEl.textContent = filtered.length;

            if (filtered.length === 0) {
                container.style.display = 'none';
                if (emptyEl) emptyEl.style.display = 'flex';
                return;
            }

            container.style.display = 'block';
            if (emptyEl) emptyEl.style.display = 'none';

            var self = this;
            var html = filtered.map(function(doc, index) {
                var isSelected = self.selectedIds.has(String(doc.id));
                var isFocused = self.focusedSection === 'triage' && self.focusedIndex === index;

                return self.renderTriageItem(doc, isSelected, isFocused);
            }).join('');

            container.innerHTML = html;
        },

        getFilteredTriageQueue: function() {
            var filter = this.currentFilter;

            if (filter === 'all') return this.triageQueue;
            if (filter === 'urgent') return this.triageQueue.filter(function(d) { return d.isUrgent || d.isOverdue; });
            if (filter === 'complex') return this.triageQueue.filter(function(d) { return d.isComplex || d.isError; });
            if (filter === 'skipped') return this.triageQueue.filter(function(d) { return d.isSkipped; });

            return this.triageQueue;
        },

        renderTriageItem: function(doc, isSelected, isFocused) {
            var vendorName = escapeHtml(doc.vendorName || 'Unknown Vendor');
            var amount = doc.totalAmount ? '$' + formatNumber(doc.totalAmount) : '-';
            var invoiceNum = doc.invoiceNumber ? '#' + escapeHtml(doc.invoiceNumber) : '';
            var confidence = doc.confidence || 0;
            var confClass = confidence >= 85 ? 'high' : confidence >= 60 ? 'medium' : 'low';

            var classes = ['triage-item'];
            if (isSelected) classes.push('selected');
            if (isFocused) classes.push('focused');
            if (doc.isUrgent) classes.push('urgent');
            if (doc.isOverdue) classes.push('overdue');
            if (doc.isError) classes.push('error');
            if (doc.isSkipped) classes.push('skipped');

            var badges = [];
            if (doc.isOverdue) badges.push('<span class="item-badge danger">Overdue</span>');
            else if (doc.isUrgent) badges.push('<span class="item-badge warning">Urgent</span>');
            if (doc.isError) badges.push('<span class="item-badge danger">Error</span>');
            if (doc.anomalies && doc.anomalies.length > 0) badges.push('<span class="item-badge warning">' + doc.anomalies.length + ' issues</span>');
            if (doc.isSkipped) badges.push('<span class="item-badge muted">Skipped</span>');

            var dueDateHtml = '';
            if (doc.dueDate) {
                var dueClass = doc.isOverdue ? 'overdue' : doc.isUrgent ? 'urgent' : '';
                dueDateHtml = '<span class="item-due ' + dueClass + '">Due: ' + formatDate(doc.dueDate) + '</span>';
            }

            return '<div class="' + classes.join(' ') + '" data-doc-id="' + doc.id + '">' +
                '<div class="item-checkbox">' +
                    '<input type="checkbox" ' + (isSelected ? 'checked' : '') + '>' +
                '</div>' +
                '<div class="item-main">' +
                    '<div class="item-header">' +
                        '<span class="item-vendor">' + vendorName + '</span>' +
                        '<span class="item-badges">' + badges.join('') + '</span>' +
                    '</div>' +
                    '<div class="item-details">' +
                        (invoiceNum ? '<span class="item-invoice">' + invoiceNum + '</span>' : '') +
                        dueDateHtml +
                    '</div>' +
                '</div>' +
                '<div class="item-amount">' + amount + '</div>' +
                '<div class="item-confidence ' + confClass + '">' +
                    '<div class="confidence-dot"></div>' +
                    '<span>' + confidence + '%</span>' +
                '</div>' +
                '<div class="item-actions">' +
                    '<button class="btn-icon item-approve" title="Approve"><i class="fas fa-check"></i></button>' +
                    '<button class="btn-icon item-reject" title="Reject"><i class="fas fa-times"></i></button>' +
                    '<button class="btn-icon item-skip" title="Skip for later"><i class="fas fa-forward"></i></button>' +
                    '<button class="btn-icon item-menu" title="More options"><i class="fas fa-ellipsis-v"></i></button>' +
                '</div>' +
            '</div>';
        },

        renderActivityStream: function() {
            var container = el('#activity-stream');
            if (!container) return;

            // Get recent documents sorted by date
            var recent = this.documents.slice().sort(function(a, b) {
                var dateA = new Date(a.createdDate || 0);
                var dateB = new Date(b.createdDate || 0);
                return dateB - dateA;
            }).slice(0, 8);

            if (recent.length === 0) {
                container.innerHTML = '<div class="empty-state-sm"><i class="fas fa-stream"></i><span>No recent activity</span></div>';
                return;
            }

            var html = recent.map(function(d) {
                var status = String(d.status);
                var icon, action;

                if (status === DocStatus.COMPLETED) {
                    icon = 'fa-check'; action = 'Approved';
                } else if (status === DocStatus.REJECTED) {
                    icon = 'fa-times'; action = 'Rejected';
                } else if (status === DocStatus.NEEDS_REVIEW || status === DocStatus.EXTRACTED) {
                    icon = 'fa-bolt'; action = 'Extracted';
                } else if (status === DocStatus.PROCESSING) {
                    icon = 'fa-cog fa-spin'; action = 'Processing';
                } else if (status === DocStatus.ERROR) {
                    icon = 'fa-exclamation-circle'; action = 'Error';
                } else {
                    icon = 'fa-file'; action = 'Uploaded';
                }

                var time = formatRelativeTime(d.createdDate);

                return '<div class="activity-item" data-doc-id="' + d.id + '">' +
                    '<span class="activity-icon"><i class="fas ' + icon + '"></i></span>' +
                    '<span class="activity-text">' + action + ' ' + escapeHtml(d.vendorName || 'Unknown') + '</span>' +
                    '<span class="activity-time">' + time + '</span>' +
                '</div>';
            }).join('');

            container.innerHTML = html;
        },

        renderTopVendors: function() {
            var container = el('#top-vendors');
            if (!container) return;

            var vendorTotals = {};
            this.documents.forEach(function(d) {
                var vendor = d.vendorName || 'Unknown';
                var amount = parseFloat(d.totalAmount) || 0;
                vendorTotals[vendor] = (vendorTotals[vendor] || 0) + amount;
            });

            var vendors = Object.keys(vendorTotals).map(function(name) {
                return { name: name, total: vendorTotals[name] };
            }).sort(function(a, b) {
                return b.total - a.total;
            }).slice(0, 5);

            if (vendors.length === 0) {
                container.innerHTML = '<div class="empty-state-sm"><i class="fas fa-building"></i><span>No vendors</span></div>';
                return;
            }

            var html = vendors.map(function(v, i) {
                return '<div class="vendor-item" data-vendor="' + escapeHtml(v.name) + '">' +
                    '<span class="vendor-rank">' + (i + 1) + '</span>' +
                    '<span class="vendor-name">' + escapeHtml(v.name) + '</span>' +
                    '<span class="vendor-total">$' + formatCompact(v.total) + '</span>' +
                '</div>';
            }).join('');

            container.innerHTML = html;
        },

        updateBulkActionsUI: function() {
            var bulkPanel = el('#bulk-actions');
            var countEl = el('#bulk-count');

            if (!bulkPanel) return;

            if (this.selectedIds.size > 0) {
                bulkPanel.style.display = 'block';
                if (countEl) countEl.textContent = this.selectedIds.size;
            } else {
                bulkPanel.style.display = 'none';
            }
        },

        // ==========================================
        // EVENT BINDING
        // ==========================================
        bindEvents: function() {
            var self = this;

            // Upload button
            this.on('#btn-go-to-flow', 'click', function() {
                Router.navigate('ingest');
            });

            // Approve all quick wins
            this.on('#btn-approve-all-quick', 'click', function() {
                self.approveAllQuickWins();
            });

            // Filter buttons
            document.querySelectorAll('.filter-btn').forEach(function(btn) {
                btn.addEventListener('click', function() {
                    document.querySelectorAll('.filter-btn').forEach(function(b) { b.classList.remove('active'); });
                    btn.classList.add('active');
                    self.currentFilter = btn.dataset.filter;
                    self.renderTriageQueue();
                });
            });

            // Bulk select toggle
            this.on('#btn-bulk-select', 'click', function() {
                self.bulkSelectMode = !self.bulkSelectMode;
                this.classList.toggle('active', self.bulkSelectMode);
            });

            // Bulk actions
            this.on('#btn-bulk-approve', 'click', function() { self.bulkApprove(); });
            this.on('#btn-bulk-reject', 'click', function() { self.bulkReject(); });
            this.on('#btn-bulk-skip', 'click', function() { self.bulkSkip(); });
            this.on('#btn-clear-selection', 'click', function() { self.clearSelection(); });

            // Document clicks (delegation)
            document.addEventListener('click', function(e) {
                self.handleDocumentClick(e);
            });

            // Context menu
            document.addEventListener('contextmenu', function(e) {
                self.handleContextMenu(e);
            });

            // Close context menu on click elsewhere
            document.addEventListener('click', function() {
                self.hideContextMenu();
            });

            // Preview panel
            this.on('#preview-close', 'click', function() { self.closePreview(); });
            this.on('#preview-approve', 'click', function() { self.approvePreviewDoc(); });
            this.on('#preview-open', 'click', function() { self.openPreviewDoc(); });

            // Keyboard help
            this.on('#close-keyboard-help', 'click', function() { self.hideKeyboardHelp(); });

            // Toast undo
            this.on('#toast-undo', 'click', function() { self.undoLastAction(); });

            // Digest item clicks
            this.on('#digest-quick-wins', 'click', function() {
                self.scrollToSection('section-quick-wins');
            });
            this.on('#digest-needs-attention', 'click', function() {
                self.scrollToSection('section-triage');
                self.setFilter('all');
            });
            this.on('#digest-urgent', 'click', function() {
                self.scrollToSection('section-triage');
                self.setFilter('urgent');
            });
            this.on('#digest-anomalies', 'click', function() {
                self.scrollToSection('section-triage');
                self.setFilter('complex');
            });
        },

        handleDocumentClick: function(e) {
            var self = this;

            // Quick win card actions
            var card = e.target.closest('.action-card');
            if (card) {
                var docId = card.dataset.docId;

                if (e.target.closest('.card-approve')) {
                    e.stopPropagation();
                    self.approveDocument(docId);
                    return;
                }
                if (e.target.closest('.card-open')) {
                    e.stopPropagation();
                    Router.navigate('review', { docId: docId });
                    return;
                }
                if (e.target.closest('.card-checkbox') || e.target.type === 'checkbox') {
                    self.toggleSelection(docId);
                    return;
                }

                // Click on card itself - show preview
                self.showPreview(docId);
                return;
            }

            // Triage item actions
            var item = e.target.closest('.triage-item');
            if (item) {
                var docId = item.dataset.docId;

                if (e.target.closest('.item-approve')) {
                    e.stopPropagation();
                    self.approveDocument(docId);
                    return;
                }
                if (e.target.closest('.item-reject')) {
                    e.stopPropagation();
                    self.rejectDocument(docId);
                    return;
                }
                if (e.target.closest('.item-skip')) {
                    e.stopPropagation();
                    self.skipDocument(docId);
                    return;
                }
                if (e.target.closest('.item-menu')) {
                    e.stopPropagation();
                    self.showContextMenuForDoc(docId, e);
                    return;
                }
                if (e.target.closest('.item-checkbox') || e.target.type === 'checkbox') {
                    self.toggleSelection(docId);
                    return;
                }

                // Click on item itself
                if (self.bulkSelectMode) {
                    self.toggleSelection(docId);
                } else {
                    self.showPreview(docId);
                }
                return;
            }

            // Activity item click
            var activityItem = e.target.closest('.activity-item');
            if (activityItem && activityItem.dataset.docId) {
                Router.navigate('review', { docId: activityItem.dataset.docId });
                return;
            }

            // Vendor item click
            var vendorItem = e.target.closest('.vendor-item');
            if (vendorItem && vendorItem.dataset.vendor) {
                Router.navigate('documents', { search: vendorItem.dataset.vendor });
                return;
            }

            // Context menu action
            var contextItem = e.target.closest('.context-menu-item');
            if (contextItem) {
                self.handleContextMenuAction(contextItem.dataset.action);
                return;
            }

            // Command result click
            var cmdResult = e.target.closest('.command-result');
            if (cmdResult) {
                self.executeCommand(cmdResult.dataset.command, cmdResult.dataset.arg);
                return;
            }
        },

        handleContextMenu: function(e) {
            var item = e.target.closest('.triage-item, .action-card');
            if (item) {
                e.preventDefault();
                this.showContextMenuForDoc(item.dataset.docId, e);
            }
        },

        // ==========================================
        // KEYBOARD HANDLING
        // ==========================================
        keyboardHandler: null,

        bindKeyboard: function() {
            var self = this;

            this.keyboardHandler = function(e) {
                // Ignore if typing in input
                if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') {
                    if (e.key === 'Escape') {
                        e.target.blur();
                        self.closeCommandPalette();
                    }
                    return;
                }

                self.handleKeypress(e);
            };

            document.addEventListener('keydown', this.keyboardHandler);
        },

        unbindKeyboard: function() {
            if (this.keyboardHandler) {
                document.removeEventListener('keydown', this.keyboardHandler);
            }
        },

        handleKeypress: function(e) {
            var self = this;
            var key = e.key;
            var now = Date.now();

            // Command palette (Cmd+K or Ctrl+K)
            if ((e.metaKey || e.ctrlKey) && key === 'k') {
                e.preventDefault();
                this.toggleCommandPalette();
                return;
            }

            // Close overlays on Escape
            if (key === 'Escape') {
                if (this.commandPaletteOpen) {
                    this.closeCommandPalette();
                    return;
                }
                if (this.keyboardHelpOpen) {
                    this.hideKeyboardHelp();
                    return;
                }
                if (this.previewDoc) {
                    this.closePreview();
                    return;
                }
                if (this.selectedIds.size > 0) {
                    this.clearSelection();
                    return;
                }
            }

            // Don't process if overlays are open
            if (this.commandPaletteOpen || this.keyboardHelpOpen) return;

            // Navigation
            if (key === 'j' || key === 'ArrowDown') {
                e.preventDefault();
                this.moveFocus(1);
                return;
            }
            if (key === 'k' || key === 'ArrowUp') {
                e.preventDefault();
                this.moveFocus(-1);
                return;
            }

            // Go to top (gg)
            if (key === 'g') {
                if (this.lastKey === 'g' && now - this.lastKeyTime < 500) {
                    this.focusedIndex = 0;
                    this.updateFocus();
                }
                this.lastKey = 'g';
                this.lastKeyTime = now;
                return;
            }

            // Go to bottom (G)
            if (key === 'G') {
                this.focusedIndex = this.getCurrentList().length - 1;
                this.updateFocus();
                return;
            }

            // Actions on focused item
            if (key === 'a' || key === 'A') {
                this.approveCurrentOrSelected();
                return;
            }
            if (key === 'r' || key === 'R') {
                this.rejectCurrentOrSelected();
                return;
            }
            if (key === 's' || key === 'S') {
                this.skipCurrentOrSelected();
                return;
            }
            if (key === 'Enter') {
                this.openCurrent();
                return;
            }
            if (key === ' ') {
                e.preventDefault();
                this.togglePreviewCurrent();
                return;
            }

            // Selection
            if (key === 'x') {
                this.toggleSelectionCurrent();
                return;
            }
            if ((e.metaKey || e.ctrlKey) && key === 'a') {
                e.preventDefault();
                this.selectAll();
                return;
            }

            // Quick actions
            if (key === '/') {
                e.preventDefault();
                this.openCommandPalette();
                return;
            }
            if (key === '?') {
                this.showKeyboardHelp();
                return;
            }
            if (key === 'u' || key === 'U') {
                Router.navigate('ingest');
                return;
            }
        },

        getCurrentList: function() {
            if (this.focusedSection === 'quick-wins') {
                return this.quickWins;
            }
            return this.getFilteredTriageQueue();
        },

        moveFocus: function(delta) {
            var list = this.getCurrentList();
            if (list.length === 0) return;

            var newIndex = this.focusedIndex + delta;

            // Switch sections if needed
            if (newIndex < 0) {
                if (this.focusedSection === 'triage' && this.quickWins.length > 0) {
                    this.focusedSection = 'quick-wins';
                    this.focusedIndex = this.quickWins.length - 1;
                } else {
                    this.focusedIndex = 0;
                }
            } else if (newIndex >= list.length) {
                if (this.focusedSection === 'quick-wins' && this.triageQueue.length > 0) {
                    this.focusedSection = 'triage';
                    this.focusedIndex = 0;
                } else {
                    this.focusedIndex = list.length - 1;
                }
            } else {
                this.focusedIndex = newIndex;
            }

            this.updateFocus();
        },

        updateFocus: function() {
            // Remove old focus
            document.querySelectorAll('.focused').forEach(function(el) {
                el.classList.remove('focused');
            });

            var list = this.getCurrentList();
            if (this.focusedIndex >= 0 && this.focusedIndex < list.length) {
                var doc = list[this.focusedIndex];
                var selector = this.focusedSection === 'quick-wins'
                    ? '.action-card[data-doc-id="' + doc.id + '"]'
                    : '.triage-item[data-doc-id="' + doc.id + '"]';

                var el = document.querySelector(selector);
                if (el) {
                    el.classList.add('focused');
                    el.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
                }
            }
        },

        getFocusedDoc: function() {
            var list = this.getCurrentList();
            if (this.focusedIndex >= 0 && this.focusedIndex < list.length) {
                return list[this.focusedIndex];
            }
            return null;
        },

        approveCurrentOrSelected: function() {
            if (this.selectedIds.size > 0) {
                this.bulkApprove();
            } else {
                var doc = this.getFocusedDoc();
                if (doc) this.approveDocument(doc.id);
            }
        },

        rejectCurrentOrSelected: function() {
            if (this.selectedIds.size > 0) {
                this.bulkReject();
            } else {
                var doc = this.getFocusedDoc();
                if (doc) this.rejectDocument(doc.id);
            }
        },

        skipCurrentOrSelected: function() {
            if (this.selectedIds.size > 0) {
                this.bulkSkip();
            } else {
                var doc = this.getFocusedDoc();
                if (doc) this.skipDocument(doc.id);
            }
        },

        openCurrent: function() {
            var doc = this.getFocusedDoc();
            if (doc) {
                Router.navigate('review', { docId: doc.id });
            }
        },

        togglePreviewCurrent: function() {
            var doc = this.getFocusedDoc();
            if (doc) {
                if (this.previewDoc && this.previewDoc.id === doc.id) {
                    this.closePreview();
                } else {
                    this.showPreview(doc.id);
                }
            }
        },

        toggleSelectionCurrent: function() {
            var doc = this.getFocusedDoc();
            if (doc) {
                this.toggleSelection(doc.id);
            }
        },

        selectAll: function() {
            var self = this;
            var list = this.getCurrentList();
            list.forEach(function(doc) {
                self.selectedIds.add(String(doc.id));
            });
            this.render();
        },

        // ==========================================
        // COMMAND PALETTE
        // ==========================================
        toggleCommandPalette: function() {
            if (this.commandPaletteOpen) {
                this.closeCommandPalette();
            } else {
                this.openCommandPalette();
            }
        },

        openCommandPalette: function() {
            var overlay = el('#command-palette-overlay');
            var input = el('#command-input');

            if (overlay) {
                overlay.style.display = 'flex';
                this.commandPaletteOpen = true;

                if (input) {
                    input.value = '';
                    input.focus();
                    this.renderCommandResults('');

                    var self = this;
                    input.oninput = function() {
                        self.renderCommandResults(input.value);
                    };
                    input.onkeydown = function(e) {
                        self.handleCommandPaletteKey(e);
                    };
                }
            }
        },

        closeCommandPalette: function() {
            var overlay = el('#command-palette-overlay');
            if (overlay) {
                overlay.style.display = 'none';
                this.commandPaletteOpen = false;
            }
        },

        handleCommandPaletteKey: function(e) {
            if (e.key === 'Escape') {
                this.closeCommandPalette();
                return;
            }
            if (e.key === 'Enter') {
                var selected = el('.command-result.selected');
                if (selected) {
                    this.executeCommand(selected.dataset.command, selected.dataset.arg);
                }
                return;
            }
            if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
                e.preventDefault();
                this.navigateCommandResults(e.key === 'ArrowDown' ? 1 : -1);
            }
        },

        renderCommandResults: function(query) {
            var container = el('#command-results');
            if (!container) return;

            var commands = this.getCommands(query);

            if (commands.length === 0) {
                container.innerHTML = '<div class="command-empty">No matching commands</div>';
                return;
            }

            var html = commands.map(function(cmd, index) {
                return '<div class="command-result' + (index === 0 ? ' selected' : '') + '" ' +
                    'data-command="' + cmd.id + '" data-arg="' + (cmd.arg || '') + '">' +
                    '<i class="fas ' + cmd.icon + '"></i>' +
                    '<div class="command-text">' +
                        '<span class="command-name">' + cmd.name + '</span>' +
                        '<span class="command-desc">' + cmd.description + '</span>' +
                    '</div>' +
                    (cmd.shortcut ? '<kbd>' + cmd.shortcut + '</kbd>' : '') +
                '</div>';
            }).join('');

            container.innerHTML = html;
        },

        getCommands: function(query) {
            var self = this;
            var q = (query || '').toLowerCase();

            var allCommands = [
                { id: 'upload', name: 'Upload Documents', description: 'Upload new documents', icon: 'fa-cloud-upload-alt', shortcut: 'U' },
                { id: 'approve-all', name: 'Approve All Quick Wins', description: 'Approve all high-confidence documents', icon: 'fa-check-double' },
                { id: 'filter-all', name: 'Show All', description: 'Show all documents in triage', icon: 'fa-layer-group' },
                { id: 'filter-urgent', name: 'Show Urgent', description: 'Filter to urgent documents', icon: 'fa-clock' },
                { id: 'filter-complex', name: 'Show Complex', description: 'Filter to complex documents', icon: 'fa-exclamation-triangle' },
                { id: 'filter-skipped', name: 'Show Skipped', description: 'Filter to skipped documents', icon: 'fa-forward' },
                { id: 'clear-skipped', name: 'Clear All Skipped', description: 'Remove all skip flags', icon: 'fa-undo' },
                { id: 'select-all', name: 'Select All', description: 'Select all visible items', icon: 'fa-check-square', shortcut: 'Ctrl+A' },
                { id: 'clear-selection', name: 'Clear Selection', description: 'Deselect all items', icon: 'fa-square', shortcut: 'Esc' },
                { id: 'keyboard-help', name: 'Keyboard Shortcuts', description: 'Show all keyboard shortcuts', icon: 'fa-keyboard', shortcut: '?' },
                { id: 'refresh', name: 'Refresh Data', description: 'Reload dashboard data', icon: 'fa-sync' },
                { id: 'documents', name: 'Go to Documents', description: 'View all documents', icon: 'fa-file-alt' },
                { id: 'settings', name: 'Go to Settings', description: 'Open settings', icon: 'fa-cog' }
            ];

            // Add document search results
            if (q.length >= 2) {
                this.documents.forEach(function(doc) {
                    var vendor = (doc.vendorName || '').toLowerCase();
                    var invoice = (doc.invoiceNumber || '').toLowerCase();

                    if (vendor.indexOf(q) >= 0 || invoice.indexOf(q) >= 0) {
                        allCommands.push({
                            id: 'open-doc',
                            arg: doc.id,
                            name: doc.vendorName || 'Unknown',
                            description: (doc.invoiceNumber ? '#' + doc.invoiceNumber + ' - ' : '') + '$' + formatNumber(doc.totalAmount || 0),
                            icon: 'fa-file-invoice'
                        });
                    }
                });
            }

            if (!q) return allCommands.slice(0, 10);

            return allCommands.filter(function(cmd) {
                return cmd.name.toLowerCase().indexOf(q) >= 0 ||
                       cmd.description.toLowerCase().indexOf(q) >= 0;
            }).slice(0, 10);
        },

        navigateCommandResults: function(delta) {
            var results = document.querySelectorAll('.command-result');
            var current = document.querySelector('.command-result.selected');
            var currentIndex = Array.from(results).indexOf(current);
            var newIndex = Math.max(0, Math.min(results.length - 1, currentIndex + delta));

            results.forEach(function(r, i) {
                r.classList.toggle('selected', i === newIndex);
            });

            results[newIndex].scrollIntoView({ block: 'nearest' });
        },

        executeCommand: function(command, arg) {
            this.closeCommandPalette();

            switch (command) {
                case 'upload':
                    Router.navigate('ingest');
                    break;
                case 'approve-all':
                    this.approveAllQuickWins();
                    break;
                case 'filter-all':
                case 'filter-urgent':
                case 'filter-complex':
                case 'filter-skipped':
                    this.setFilter(command.replace('filter-', ''));
                    break;
                case 'clear-skipped':
                    this.clearAllSkipped();
                    break;
                case 'select-all':
                    this.selectAll();
                    break;
                case 'clear-selection':
                    this.clearSelection();
                    break;
                case 'keyboard-help':
                    this.showKeyboardHelp();
                    break;
                case 'refresh':
                    this.loadData();
                    break;
                case 'documents':
                    Router.navigate('documents');
                    break;
                case 'settings':
                    Router.navigate('settings');
                    break;
                case 'open-doc':
                    Router.navigate('review', { docId: arg });
                    break;
            }
        },

        // ==========================================
        // DOCUMENT ACTIONS
        // ==========================================
        approveDocument: function(docId) {
            var self = this;
            var doc = this.findDoc(docId);

            if (!doc) return;

            // Store for undo
            this.lastAction = { type: 'approve', docId: docId, doc: doc };

            // Optimistic UI update
            this.removeDocFromUI(docId);

            // API call
            API.put('approve', { documentId: docId }).then(function() {
                self.showToast('Document approved', 'success');
                self.loadData(); // Refresh
            }).catch(function(err) {
                console.error('Approve failed:', err);
                self.showToast('Approve failed: ' + err.message, 'error');
                self.loadData(); // Refresh to restore
            });
        },

        rejectDocument: function(docId) {
            var self = this;
            var doc = this.findDoc(docId);

            if (!doc) return;

            // For reject, we should ask for reason - for now just reject
            this.lastAction = { type: 'reject', docId: docId, doc: doc };

            this.removeDocFromUI(docId);

            API.put('reject', { documentId: docId, reason: 'Rejected from dashboard' }).then(function() {
                self.showToast('Document rejected', 'warning');
                self.loadData();
            }).catch(function(err) {
                console.error('Reject failed:', err);
                self.showToast('Reject failed: ' + err.message, 'error');
                self.loadData();
            });
        },

        skipDocument: function(docId) {
            this.skippedIds.add(String(docId));
            this.saveSkippedIds();

            // Re-process and render
            var doc = this.findDoc(docId);
            if (doc) {
                doc.isSkipped = true;
            }
            this.processDocuments();
            this.calculateStats({});
            this.render();

            this.showToast('Skipped for later', 'info');
        },

        approveAllQuickWins: function() {
            var self = this;
            var ids = this.quickWins.map(function(d) { return d.id; });

            if (ids.length === 0) return;

            this.lastAction = { type: 'bulk-approve', docIds: ids };

            // Optimistic UI
            ids.forEach(function(id) {
                self.removeDocFromUI(id);
            });

            // Bulk API call
            Promise.all(ids.map(function(id) {
                return API.put('approve', { documentId: id });
            })).then(function() {
                self.showToast(ids.length + ' documents approved', 'success');
                self.loadData();
            }).catch(function(err) {
                console.error('Bulk approve failed:', err);
                self.showToast('Some approvals failed', 'error');
                self.loadData();
            });
        },

        bulkApprove: function() {
            var self = this;
            var ids = Array.from(this.selectedIds);

            if (ids.length === 0) return;

            this.lastAction = { type: 'bulk-approve', docIds: ids };
            this.selectedIds.clear();

            ids.forEach(function(id) {
                self.removeDocFromUI(id);
            });

            Promise.all(ids.map(function(id) {
                return API.put('approve', { documentId: id });
            })).then(function() {
                self.showToast(ids.length + ' documents approved', 'success');
                self.loadData();
            }).catch(function(err) {
                console.error('Bulk approve failed:', err);
                self.loadData();
            });
        },

        bulkReject: function() {
            var self = this;
            var ids = Array.from(this.selectedIds);

            if (ids.length === 0) return;

            this.lastAction = { type: 'bulk-reject', docIds: ids };
            this.selectedIds.clear();

            ids.forEach(function(id) {
                self.removeDocFromUI(id);
            });

            Promise.all(ids.map(function(id) {
                return API.put('reject', { documentId: id, reason: 'Bulk rejected from dashboard' });
            })).then(function() {
                self.showToast(ids.length + ' documents rejected', 'warning');
                self.loadData();
            }).catch(function(err) {
                console.error('Bulk reject failed:', err);
                self.loadData();
            });
        },

        bulkSkip: function() {
            var self = this;
            var ids = Array.from(this.selectedIds);

            ids.forEach(function(id) {
                self.skippedIds.add(String(id));
            });
            this.saveSkippedIds();
            this.selectedIds.clear();

            this.processDocuments();
            this.calculateStats({});
            this.render();

            this.showToast(ids.length + ' documents skipped', 'info');
        },

        // ==========================================
        // SELECTION
        // ==========================================
        toggleSelection: function(docId) {
            var id = String(docId);
            if (this.selectedIds.has(id)) {
                this.selectedIds.delete(id);
            } else {
                this.selectedIds.add(id);
            }
            this.render();
        },

        clearSelection: function() {
            this.selectedIds.clear();
            this.bulkSelectMode = false;
            var btn = el('#btn-bulk-select');
            if (btn) btn.classList.remove('active');
            this.render();
        },

        // ==========================================
        // PREVIEW PANEL
        // ==========================================
        showPreview: function(docId) {
            var doc = this.findDoc(docId);
            if (!doc) return;

            this.previewDoc = doc;

            var panel = el('#preview-panel');
            var title = el('#preview-title');
            var img = el('#preview-img');
            var details = el('#preview-details');

            if (!panel) return;

            panel.classList.add('open');

            if (title) {
                title.textContent = doc.vendorName || 'Unknown Vendor';
            }

            if (img && doc.fileUrl) {
                img.src = doc.fileUrl;
                img.style.display = 'block';
            } else if (img) {
                img.style.display = 'none';
            }

            if (details) {
                details.innerHTML =
                    '<div class="preview-field"><label>Invoice #</label><span>' + (doc.invoiceNumber || '-') + '</span></div>' +
                    '<div class="preview-field"><label>Amount</label><span>$' + formatNumber(doc.totalAmount || 0) + '</span></div>' +
                    '<div class="preview-field"><label>Invoice Date</label><span>' + (doc.invoiceDate ? formatDate(doc.invoiceDate) : '-') + '</span></div>' +
                    '<div class="preview-field"><label>Due Date</label><span>' + (doc.dueDate ? formatDate(doc.dueDate) : '-') + '</span></div>' +
                    '<div class="preview-field"><label>Confidence</label><span>' + (doc.confidence || 0) + '%</span></div>';
            }
        },

        closePreview: function() {
            this.previewDoc = null;
            var panel = el('#preview-panel');
            if (panel) {
                panel.classList.remove('open');
            }
        },

        approvePreviewDoc: function() {
            if (this.previewDoc) {
                this.approveDocument(this.previewDoc.id);
                this.closePreview();
            }
        },

        openPreviewDoc: function() {
            if (this.previewDoc) {
                Router.navigate('review', { docId: this.previewDoc.id });
            }
        },

        // ==========================================
        // CONTEXT MENU
        // ==========================================
        contextMenuDocId: null,

        showContextMenuForDoc: function(docId, e) {
            this.contextMenuDocId = docId;

            var menu = el('#context-menu');
            if (!menu) return;

            // Position menu
            var x = e.clientX || e.pageX;
            var y = e.clientY || e.pageY;

            // Keep in viewport
            var menuWidth = 200;
            var menuHeight = 280;
            if (x + menuWidth > window.innerWidth) x = window.innerWidth - menuWidth - 10;
            if (y + menuHeight > window.innerHeight) y = window.innerHeight - menuHeight - 10;

            menu.style.left = x + 'px';
            menu.style.top = y + 'px';
            menu.style.display = 'block';

            e.stopPropagation();
        },

        hideContextMenu: function() {
            var menu = el('#context-menu');
            if (menu) {
                menu.style.display = 'none';
            }
            this.contextMenuDocId = null;
        },

        handleContextMenuAction: function(action) {
            var docId = this.contextMenuDocId;
            this.hideContextMenu();

            if (!docId) return;

            var doc = this.findDoc(docId);

            switch (action) {
                case 'approve':
                    this.approveDocument(docId);
                    break;
                case 'reject':
                    this.rejectDocument(docId);
                    break;
                case 'open':
                    Router.navigate('review', { docId: docId });
                    break;
                case 'preview':
                    this.showPreview(docId);
                    break;
                case 'skip':
                    this.skipDocument(docId);
                    break;
                case 'copy-vendor':
                    if (doc && doc.vendorName) {
                        this.copyToClipboard(doc.vendorName);
                        this.showToast('Vendor name copied', 'info');
                    }
                    break;
                case 'copy-amount':
                    if (doc && doc.totalAmount) {
                        this.copyToClipboard('$' + formatNumber(doc.totalAmount));
                        this.showToast('Amount copied', 'info');
                    }
                    break;
            }
        },

        // ==========================================
        // KEYBOARD HELP
        // ==========================================
        showKeyboardHelp: function() {
            var overlay = el('#keyboard-help-overlay');
            if (overlay) {
                overlay.style.display = 'flex';
                this.keyboardHelpOpen = true;
            }
        },

        hideKeyboardHelp: function() {
            var overlay = el('#keyboard-help-overlay');
            if (overlay) {
                overlay.style.display = 'none';
                this.keyboardHelpOpen = false;
            }
        },

        // ==========================================
        // TOAST NOTIFICATIONS
        // ==========================================
        showToast: function(message, type) {
            var toast = el('#action-toast');
            var msgEl = el('#action-toast-message');
            var undoBtn = el('#toast-undo');

            if (!toast || !msgEl) return;

            toast.className = 'action-toast ' + (type || 'info');
            msgEl.textContent = message;

            // Show/hide undo based on action type
            if (undoBtn) {
                undoBtn.style.display = this.lastAction ? 'inline-block' : 'none';
            }

            toast.style.display = 'flex';

            // Auto hide
            setTimeout(function() {
                toast.style.display = 'none';
            }, 4000);
        },

        undoLastAction: function() {
            if (!this.lastAction) return;

            var self = this;
            var action = this.lastAction;
            this.lastAction = null;

            // For now, just refresh - full undo would require API support
            this.showToast('Undo not yet supported - refreshing', 'info');
            this.loadData();
        },

        // ==========================================
        // UTILITIES
        // ==========================================
        findDoc: function(docId) {
            var id = String(docId);
            return this.documents.find(function(d) {
                return String(d.id) === id;
            });
        },

        removeDocFromUI: function(docId) {
            var id = String(docId);

            this.quickWins = this.quickWins.filter(function(d) {
                return String(d.id) !== id;
            });

            this.triageQueue = this.triageQueue.filter(function(d) {
                return String(d.id) !== id;
            });

            this.documents = this.documents.filter(function(d) {
                return String(d.id) !== id;
            });

            this.calculateStats({});
            this.render();
        },

        setFilter: function(filter) {
            this.currentFilter = filter;
            document.querySelectorAll('.filter-btn').forEach(function(btn) {
                btn.classList.toggle('active', btn.dataset.filter === filter);
            });
            this.renderTriageQueue();
        },

        scrollToSection: function(sectionId) {
            var section = el('#' + sectionId);
            if (section) {
                section.scrollIntoView({ behavior: 'smooth', block: 'start' });
            }
        },

        loadSkippedIds: function() {
            var self = this;

            // First, load from localStorage for immediate availability
            try {
                var stored = localStorage.getItem('flux_skipped_docs');
                self.skippedIds = new Set(stored ? JSON.parse(stored) : []);
            } catch (e) {
                self.skippedIds = new Set();
            }

            // Then, load from server (async) and merge
            API.get('dashboardPrefs', {}).then(function(response) {
                if (response && response.prefs && response.prefs.skippedDocIds) {
                    var serverSkipped = response.prefs.skippedDocIds;
                    serverSkipped.forEach(function(id) {
                        self.skippedIds.add(String(id));
                    });

                    // Save merged set to localStorage
                    try {
                        localStorage.setItem('flux_skipped_docs', JSON.stringify(Array.from(self.skippedIds)));
                    } catch (e) {}

                    // Re-process if we got new data
                    if (serverSkipped.length > 0) {
                        self.processDocuments();
                        self.render();
                    }
                }
            }).catch(function() {
                // Silently fail - localStorage is backup
            });

            return this.skippedIds;
        },

        saveSkippedIds: function() {
            var self = this;
            var skippedArray = Array.from(this.skippedIds);

            // Save to localStorage immediately
            try {
                localStorage.setItem('flux_skipped_docs', JSON.stringify(skippedArray));
            } catch (e) {
                console.error('Failed to save skipped IDs to localStorage:', e);
            }

            // Save to server (async, debounced)
            clearTimeout(this._savePrefsTimeout);
            this._savePrefsTimeout = setTimeout(function() {
                API.put('dashboardPrefs', {
                    prefs: {
                        skippedDocIds: skippedArray,
                        defaultFilter: self.currentFilter,
                        showKeyboardHints: true
                    }
                }).catch(function(err) {
                    console.error('Failed to save prefs to server:', err);
                });
            }, 1000);  // Debounce 1 second
        },

        clearAllSkipped: function() {
            this.skippedIds.clear();
            this.saveSkippedIds();

            this.documents.forEach(function(d) {
                d.isSkipped = false;
            });

            this.processDocuments();
            this.calculateStats({});
            this.render();

            this.showToast('Cleared all skipped documents', 'info');
        },

        copyToClipboard: function(text) {
            if (navigator.clipboard) {
                navigator.clipboard.writeText(text);
            } else {
                // Fallback
                var textarea = document.createElement('textarea');
                textarea.value = text;
                document.body.appendChild(textarea);
                textarea.select();
                document.execCommand('copy');
                document.body.removeChild(textarea);
            }
        },

        setGreeting: function() {
            var greetingEl = el('#mc-greeting');
            if (!greetingEl) return;

            var hour = new Date().getHours();
            var greeting = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';
            greetingEl.textContent = greeting;
        },

        setText: function(selector, text) {
            var element = document.querySelector(selector);
            if (element) element.textContent = text;
        },

        on: function(selector, event, handler) {
            var element = document.querySelector(selector);
            if (element) element.addEventListener(event, handler);
        },

        startRefresh: function() {
            var self = this;
            this.stopRefresh();
            this.refreshInterval = setInterval(function() {
                if (!API.sessionExpired) {
                    self.loadData();
                }
            }, REFRESH_MS);
            API.registerInterval('dashboard', this.refreshInterval);
        },

        stopRefresh: function() {
            if (this.refreshInterval) {
                clearInterval(this.refreshInterval);
                API.clearInterval('dashboard');
                this.refreshInterval = null;
            }
        }
    };

    // ==========================================
    // HELPER FUNCTIONS
    // ==========================================
    function formatRelativeTime(dateStr) {
        if (!dateStr) return '';

        var date = new Date(dateStr);
        var now = new Date();
        var diffMs = now - date;
        var diffMins = Math.floor(diffMs / 60000);
        var diffHours = Math.floor(diffMs / 3600000);
        var diffDays = Math.floor(diffMs / 86400000);

        if (diffMins < 1) return 'Just now';
        if (diffMins < 60) return diffMins + 'm ago';
        if (diffHours < 24) return diffHours + 'h ago';
        if (diffDays < 7) return diffDays + 'd ago';

        return formatDate(dateStr);
    }

    // ==========================================
    // REGISTER ROUTE
    // ==========================================
    Router.register('dashboard',
        function(params) { DashboardController.init(params); },
        function() { DashboardController.cleanup(); }
    );

    FCDebug.log('[View.Dashboard] Action-First Dashboard loaded');

})();
