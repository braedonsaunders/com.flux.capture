/**
 * Flux Capture - Mission Control Dashboard View (Redesigned)
 * Three switchable layouts: Focused Flow, Dense Grid, Kanban Pipeline
 */
(function() {
    'use strict';

    // ==========================================
    // CONSTANTS
    // ==========================================
    var QUICK_WIN_THRESHOLD = 85;  // Confidence >= 85% = ready to approve
    var URGENT_HOURS = 48;         // Due within 48 hours = urgent
    var REFRESH_MS = 15000;        // Auto-refresh interval

    // Status constants
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
        allDocs: [],
        selectedIds: new Set(),
        focusedIndex: 0,
        skippedIds: new Set(),
        refreshInterval: null,
        currentLayout: 'focused', // 'focused', 'grid', 'kanban'
        currentFilter: 'all',
        commandPaletteOpen: false,
        keyboardHelpOpen: false,

        // Stats
        stats: {
            toReview: 0,
            processing: 0,
            doneToday: 0,
            pendingAmount: 0,
            ready: 0,
            urgent: 0,
            needsReview: 0
        },

        // ==========================================
        // INITIALIZATION
        // ==========================================
        init: function() {
            this.documents = [];
            this.allDocs = [];
            this.selectedIds = new Set();
            this.focusedIndex = 0;
            this.skippedIds = this.loadSkippedIds();
            this.currentLayout = localStorage.getItem('mc_layout') || 'focused';

            renderTemplate('tpl-dashboard', 'view-container');
            this.bindEvents();
            this.bindKeyboard();
            this.loadData();
            this.startRefresh();
            this.setActiveLayout(this.currentLayout);

            FCDebug.log('[Dashboard] Redesigned Dashboard initialized');
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

                self.allDocs = (queueData.queue || []).map(function(doc) {
                    return self.enrichDocument(doc);
                });

                self.processDocuments();
                self.calculateStats(statsData);
                self.render();

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

            var isReady = conf >= QUICK_WIN_THRESHOLD && status !== DocStatus.ERROR;
            var isUrgent = hoursUntilDue <= URGENT_HOURS && hoursUntilDue > 0;
            var isOverdue = hoursUntilDue < 0;

            return Object.assign({}, doc, {
                confidence: conf,
                isReady: isReady,
                isUrgent: isUrgent,
                isOverdue: isOverdue,
                isError: status === DocStatus.ERROR,
                isSkipped: this.skippedIds.has(String(doc.id)),
                hoursUntilDue: hoursUntilDue,
                category: isReady ? 'ready' : (isUrgent || isOverdue ? 'urgent' : 'review')
            });
        },

        processDocuments: function() {
            var self = this;

            // Filter to reviewable documents
            this.documents = this.allDocs.filter(function(d) {
                var status = String(d.status);
                return status === DocStatus.NEEDS_REVIEW ||
                       status === DocStatus.EXTRACTED ||
                       status === DocStatus.ERROR;
            });

            // Sort by priority: urgent first, then ready, then review
            this.documents.sort(function(a, b) {
                if (a.isSkipped && !b.isSkipped) return 1;
                if (!a.isSkipped && b.isSkipped) return -1;
                if (a.isOverdue && !b.isOverdue) return -1;
                if (!a.isOverdue && b.isOverdue) return 1;
                if (a.isUrgent && !b.isUrgent) return -1;
                if (!a.isUrgent && b.isUrgent) return 1;
                if (a.isReady && !b.isReady) return -1;
                if (!a.isReady && b.isReady) return 1;
                return b.confidence - a.confidence;
            });
        },

        calculateStats: function(serverStats) {
            var self = this;
            var pendingAmount = 0;
            var ready = 0;
            var urgent = 0;
            var needsReview = 0;
            var processing = 0;

            this.allDocs.forEach(function(d) {
                var status = String(d.status);

                if (status === DocStatus.PROCESSING) {
                    processing++;
                }

                if (status === DocStatus.NEEDS_REVIEW || status === DocStatus.EXTRACTED || status === DocStatus.ERROR) {
                    pendingAmount += parseFloat(d.totalAmount) || 0;
                    if (d.isReady) ready++;
                    else if (d.isUrgent || d.isOverdue) urgent++;
                    else needsReview++;
                }
            });

            this.stats = {
                toReview: this.documents.length,
                processing: processing,
                doneToday: serverStats.summary ? serverStats.summary.completed : 0,
                pendingAmount: pendingAmount,
                ready: ready,
                urgent: urgent,
                needsReview: needsReview
            };
        },

        // ==========================================
        // RENDERING
        // ==========================================
        render: function() {
            this.renderStatusBar();

            switch (this.currentLayout) {
                case 'focused':
                    this.renderFocused();
                    break;
                case 'grid':
                    this.renderGrid();
                    break;
                case 'kanban':
                    this.renderKanban();
                    break;
            }

            this.updateBulkBar();
        },

        renderStatusBar: function() {
            this.setText('#stat-to-review-v2', this.stats.toReview);
            this.setText('#stat-pending-v2', '$' + formatCompact(this.stats.pendingAmount));
        },

        // ==========================================
        // LAYOUT 1: FOCUSED FLOW
        // ==========================================
        renderFocused: function() {
            var heroEmpty = el('#mc-hero-empty');
            var heroDoc = el('#mc-hero-doc');

            if (this.documents.length === 0) {
                if (heroEmpty) heroEmpty.style.display = 'block';
                if (heroDoc) heroDoc.style.display = 'none';
                this.renderQueueStrip([]);
                return;
            }

            if (heroEmpty) heroEmpty.style.display = 'none';
            if (heroDoc) heroDoc.style.display = 'flex';

            // Render hero document (first in queue)
            var doc = this.documents[this.focusedIndex] || this.documents[0];
            this.renderHeroDoc(doc);

            // Render queue strip (remaining documents)
            var remaining = this.documents.filter(function(d, i) {
                return i !== self.focusedIndex;
            });
            var self = this;
            this.renderQueueStrip(this.documents);
        },

        renderHeroDoc: function(doc) {
            if (!doc) return;

            // Badge
            var badge = el('#hero-badge');
            if (badge) {
                if (doc.isReady) {
                    badge.textContent = 'Ready to Approve';
                    badge.className = 'hero-badge ready';
                } else if (doc.isUrgent || doc.isOverdue) {
                    badge.textContent = doc.isOverdue ? 'Overdue' : 'Urgent';
                    badge.className = 'hero-badge urgent';
                } else {
                    badge.textContent = 'Needs Review';
                    badge.className = 'hero-badge review';
                }
            }

            // Preview image
            var img = el('#hero-img');
            if (img) {
                img.src = doc.fileUrl || '';
                img.style.display = doc.fileUrl ? 'block' : 'none';
            }

            // Info
            this.setText('#hero-vendor', doc.vendorName || 'Unknown Vendor');
            this.setText('#hero-invoice', doc.invoiceNumber ? '#' + doc.invoiceNumber : '');
            this.setText('#hero-amount', doc.totalAmount ? '$' + formatNumber(doc.totalAmount) : '');

            // Confidence bar
            var confFill = el('#hero-conf-fill');
            if (confFill) {
                confFill.style.width = doc.confidence + '%';
                confFill.className = 'conf-fill' + (doc.confidence >= 85 ? '' : doc.confidence >= 60 ? ' medium' : ' low');
            }
            this.setText('#hero-conf-text', doc.confidence + '%');

            // Due date
            var dueEl = el('#hero-due');
            if (dueEl) {
                if (doc.dueDate) {
                    dueEl.textContent = 'Due: ' + formatDate(doc.dueDate);
                    dueEl.className = 'hero-due' + (doc.isOverdue ? ' overdue' : doc.isUrgent ? ' urgent' : '');
                } else {
                    dueEl.textContent = '';
                }
            }

            // Store current doc ID for actions
            var heroDocEl = el('#mc-hero-doc');
            if (heroDocEl) {
                heroDocEl.dataset.docId = doc.id;
            }
        },

        renderQueueStrip: function(docs) {
            var container = el('#queue-strip-items');
            var countEl = el('#queue-count-v2');
            var approveAllBtn = el('#btn-approve-all-v2');
            var self = this;

            if (!container) return;

            var readyCount = docs.filter(function(d) { return d.isReady && !d.isSkipped; }).length;

            if (countEl) countEl.textContent = docs.length;
            if (approveAllBtn) approveAllBtn.disabled = readyCount === 0;

            if (docs.length === 0) {
                container.innerHTML = '';
                return;
            }

            var html = docs.map(function(doc, index) {
                var isActive = index === self.focusedIndex;
                var classes = ['queue-thumb'];
                if (isActive) classes.push('active');
                if (doc.isReady) classes.push('ready');

                return '<div class="' + classes.join(' ') + '" data-doc-id="' + doc.id + '" data-index="' + index + '">' +
                    '<div class="queue-thumb-vendor">' + escapeHtml(doc.vendorName || 'Unknown') + '</div>' +
                    '<div class="queue-thumb-amount">$' + formatCompact(doc.totalAmount || 0) + '</div>' +
                    '<div class="queue-thumb-conf"><div style="width:' + doc.confidence + '%;background:' +
                        (doc.confidence >= 85 ? 'var(--color-success)' : doc.confidence >= 60 ? 'var(--color-warning)' : 'var(--color-danger)') + '"></div></div>' +
                '</div>';
            }).join('');

            container.innerHTML = html;
        },

        // ==========================================
        // LAYOUT 2: DENSE GRID
        // ==========================================
        renderGrid: function() {
            var container = el('#grid-container');
            var emptyEl = el('#grid-empty');
            var self = this;

            if (!container) return;

            // Update filter counts
            this.setText('#filter-count-all', this.documents.length);
            this.setText('#filter-count-ready', this.documents.filter(function(d) { return d.isReady; }).length);
            this.setText('#filter-count-urgent', this.documents.filter(function(d) { return d.isUrgent || d.isOverdue; }).length);
            this.setText('#filter-count-review', this.documents.filter(function(d) { return !d.isReady && !d.isUrgent && !d.isOverdue; }).length);

            // Filter documents
            var filtered = this.getFilteredDocs();

            if (filtered.length === 0) {
                container.style.display = 'none';
                if (emptyEl) emptyEl.style.display = 'flex';
                return;
            }

            container.style.display = 'grid';
            if (emptyEl) emptyEl.style.display = 'none';

            var html = filtered.map(function(doc) {
                var isSelected = self.selectedIds.has(String(doc.id));
                var classes = ['grid-item'];
                if (isSelected) classes.push('selected');
                if (doc.isReady) classes.push('ready');
                else if (doc.isUrgent || doc.isOverdue) classes.push('urgent');
                else classes.push('review');

                var confClass = doc.confidence >= 85 ? 'high' : '';

                return '<div class="' + classes.join(' ') + '" data-doc-id="' + doc.id + '">' +
                    '<div class="grid-item-vendor">' + escapeHtml(doc.vendorName || 'Unknown') + '</div>' +
                    '<div class="grid-item-amount">$' + formatNumber(doc.totalAmount || 0) + '</div>' +
                    '<div class="grid-item-meta">' +
                        '<span class="grid-item-invoice">' + (doc.invoiceNumber ? '#' + doc.invoiceNumber : '') + '</span>' +
                        '<span class="grid-item-conf ' + confClass + '">' + doc.confidence + '%</span>' +
                    '</div>' +
                    '<div class="grid-item-actions">' +
                        '<button class="grid-item-btn approve" data-action="approve" title="Approve"><i class="fas fa-check"></i></button>' +
                        '<button class="grid-item-btn" data-action="open" title="Open"><i class="fas fa-expand"></i></button>' +
                    '</div>' +
                '</div>';
            }).join('');

            container.innerHTML = html;

            // Update approve selected button
            var approveBtn = el('#btn-approve-selected-grid');
            if (approveBtn) {
                approveBtn.disabled = this.selectedIds.size === 0;
            }
        },

        getFilteredDocs: function() {
            var filter = this.currentFilter;

            if (filter === 'all') return this.documents;
            if (filter === 'ready') return this.documents.filter(function(d) { return d.isReady; });
            if (filter === 'urgent') return this.documents.filter(function(d) { return d.isUrgent || d.isOverdue; });
            if (filter === 'review') return this.documents.filter(function(d) { return !d.isReady && !d.isUrgent && !d.isOverdue; });

            return this.documents;
        },

        // ==========================================
        // LAYOUT 3: KANBAN PIPELINE
        // ==========================================
        renderKanban: function() {
            var self = this;

            // Categorize documents
            var processing = this.allDocs.filter(function(d) {
                return String(d.status) === DocStatus.PROCESSING;
            });

            var ready = this.documents.filter(function(d) { return d.isReady && !d.isSkipped; });
            var review = this.documents.filter(function(d) { return !d.isReady && !d.isSkipped; });

            var done = this.allDocs.filter(function(d) {
                var status = String(d.status);
                return status === DocStatus.COMPLETED || status === DocStatus.REJECTED;
            }).slice(0, 10); // Show last 10 completed

            // Update counts
            this.setText('#kanban-count-processing', processing.length);
            this.setText('#kanban-count-ready', ready.length);
            this.setText('#kanban-count-review', review.length);
            this.setText('#kanban-count-done', done.length);

            // Render columns
            this.renderKanbanColumn('#kanban-processing', processing, 'processing');
            this.renderKanbanColumn('#kanban-ready', ready, 'ready');
            this.renderKanbanColumn('#kanban-review', review, 'review');
            this.renderKanbanColumn('#kanban-done', done, 'done');
        },

        renderKanbanColumn: function(selector, docs, stage) {
            var container = el(selector);
            if (!container) return;

            if (docs.length === 0) {
                container.innerHTML = '<div class="kanban-empty">No documents</div>';
                return;
            }

            var html = docs.map(function(doc) {
                var badgeHtml = '';
                if (doc.isOverdue) {
                    badgeHtml = '<span class="kanban-card-badge urgent">Overdue</span>';
                } else if (doc.isUrgent) {
                    badgeHtml = '<span class="kanban-card-badge urgent">Urgent</span>';
                }

                var actionsHtml = stage !== 'done' && stage !== 'processing' ?
                    '<div class="kanban-card-actions">' +
                        '<button class="kanban-card-btn approve" data-action="approve"><i class="fas fa-check"></i> Approve</button>' +
                        '<button class="kanban-card-btn" data-action="open"><i class="fas fa-expand"></i> Open</button>' +
                    '</div>' : '';

                return '<div class="kanban-card" data-doc-id="' + doc.id + '">' +
                    '<div class="kanban-card-vendor">' + escapeHtml(doc.vendorName || 'Unknown') + '</div>' +
                    '<div class="kanban-card-amount">$' + formatNumber(doc.totalAmount || 0) + '</div>' +
                    '<div class="kanban-card-meta">' +
                        '<span class="kanban-card-invoice">' + (doc.invoiceNumber ? '#' + doc.invoiceNumber : '') + '</span>' +
                        badgeHtml +
                    '</div>' +
                    actionsHtml +
                '</div>';
            }).join('');

            container.innerHTML = html;
        },

        // ==========================================
        // BULK SELECTION BAR
        // ==========================================
        updateBulkBar: function() {
            var bar = el('#mc-bulk-bar');
            var countEl = el('#bulk-count');

            if (!bar) return;

            if (this.selectedIds.size > 0) {
                bar.style.display = 'flex';
                if (countEl) countEl.textContent = this.selectedIds.size;
            } else {
                bar.style.display = 'none';
            }
        },

        // ==========================================
        // EVENT BINDING
        // ==========================================
        bindEvents: function() {
            var self = this;

            // Layout switcher
            document.querySelectorAll('.layout-btn').forEach(function(btn) {
                btn.addEventListener('click', function() {
                    self.setActiveLayout(btn.dataset.layout);
                });
            });

            // Upload button
            this.on('#btn-go-to-flow', 'click', function() { Router.navigate('ingest'); });
            this.on('#btn-upload-hero', 'click', function() { Router.navigate('ingest'); });

            // Hero actions
            this.on('#hero-approve', 'click', function() { self.approveHeroDoc(); });
            this.on('#hero-reject', 'click', function() { self.rejectHeroDoc(); });
            this.on('#hero-open', 'click', function() { self.openHeroDoc(); });
            this.on('#hero-skip', 'click', function() { self.skipHeroDoc(); });

            // Approve all
            this.on('#btn-approve-all-v2', 'click', function() { self.approveAllReady(); });
            this.on('#kanban-approve-ready', 'click', function() { self.approveAllReady(); });
            this.on('#btn-approve-selected-grid', 'click', function() { self.bulkApprove(); });

            // Bulk actions
            this.on('#btn-bulk-approve', 'click', function() { self.bulkApprove(); });
            this.on('#btn-bulk-reject', 'click', function() { self.bulkReject(); });
            this.on('#btn-clear-selection', 'click', function() { self.clearSelection(); });

            // Grid filters
            document.querySelectorAll('.grid-filter').forEach(function(btn) {
                btn.addEventListener('click', function() {
                    document.querySelectorAll('.grid-filter').forEach(function(b) { b.classList.remove('active'); });
                    btn.classList.add('active');
                    self.currentFilter = btn.dataset.filter;
                    self.renderGrid();
                });
            });

            // Keyboard help
            this.on('#close-keyboard-help', 'click', function() { self.hideKeyboardHelp(); });
            this.on('.mc-kbd-hint', 'click', function() { self.showKeyboardHelp(); });

            // Document clicks (delegation)
            document.addEventListener('click', function(e) { self.handleDocumentClick(e); });
            document.addEventListener('contextmenu', function(e) { self.handleContextMenu(e); });
        },

        handleDocumentClick: function(e) {
            var self = this;

            // Queue thumb click
            var thumb = e.target.closest('.queue-thumb');
            if (thumb && thumb.dataset.index !== undefined) {
                this.focusedIndex = parseInt(thumb.dataset.index);
                this.renderFocused();
                return;
            }

            // Grid item click
            var gridItem = e.target.closest('.grid-item');
            if (gridItem) {
                var docId = gridItem.dataset.docId;
                var actionBtn = e.target.closest('.grid-item-btn');

                if (actionBtn) {
                    e.stopPropagation();
                    var action = actionBtn.dataset.action;
                    if (action === 'approve') self.approveDocument(docId);
                    else if (action === 'open') Router.navigate('review', { docId: docId });
                    return;
                }

                // Toggle selection
                self.toggleSelection(docId);
                return;
            }

            // Kanban card click
            var kanbanCard = e.target.closest('.kanban-card');
            if (kanbanCard) {
                var docId = kanbanCard.dataset.docId;
                var actionBtn = e.target.closest('.kanban-card-btn');

                if (actionBtn) {
                    e.stopPropagation();
                    var action = actionBtn.dataset.action;
                    if (action === 'approve') self.approveDocument(docId);
                    else if (action === 'open') Router.navigate('review', { docId: docId });
                    return;
                }

                // Open on click
                Router.navigate('review', { docId: docId });
                return;
            }

            // Context menu
            var contextItem = e.target.closest('.context-menu-item');
            if (contextItem) {
                self.handleContextMenuAction(contextItem.dataset.action);
                return;
            }

            // Hide context menu
            self.hideContextMenu();

            // Command result
            var cmdResult = e.target.closest('.command-result');
            if (cmdResult) {
                self.executeCommand(cmdResult.dataset.command, cmdResult.dataset.arg);
            }
        },

        handleContextMenu: function(e) {
            var item = e.target.closest('.grid-item, .kanban-card, .queue-thumb');
            if (item) {
                e.preventDefault();
                this.showContextMenuForDoc(item.dataset.docId, e);
            }
        },

        setActiveLayout: function(layout) {
            this.currentLayout = layout;
            localStorage.setItem('mc_layout', layout);

            // Update buttons
            document.querySelectorAll('.layout-btn').forEach(function(btn) {
                btn.classList.toggle('active', btn.dataset.layout === layout);
            });

            // Show/hide layouts
            var layouts = ['focused', 'grid', 'kanban'];
            layouts.forEach(function(l) {
                var layoutEl = el('#layout-' + l);
                if (layoutEl) {
                    layoutEl.style.display = l === layout ? 'flex' : 'none';
                }
            });

            // Clear selection when switching layouts
            this.clearSelection();
            this.render();
        },

        // ==========================================
        // KEYBOARD HANDLING
        // ==========================================
        keyboardHandler: null,

        bindKeyboard: function() {
            var self = this;

            this.keyboardHandler = function(e) {
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
            var key = e.key;

            // Command palette
            if ((e.metaKey || e.ctrlKey) && key === 'k') {
                e.preventDefault();
                this.toggleCommandPalette();
                return;
            }

            // Close overlays
            if (key === 'Escape') {
                if (this.commandPaletteOpen) { this.closeCommandPalette(); return; }
                if (this.keyboardHelpOpen) { this.hideKeyboardHelp(); return; }
                if (this.selectedIds.size > 0) { this.clearSelection(); return; }
            }

            if (this.commandPaletteOpen || this.keyboardHelpOpen) return;

            // Layout switching
            if (key === '1') { this.setActiveLayout('focused'); return; }
            if (key === '2') { this.setActiveLayout('grid'); return; }
            if (key === '3') { this.setActiveLayout('kanban'); return; }

            // Navigation (focused layout)
            if (this.currentLayout === 'focused') {
                if (key === 'j' || key === 'ArrowDown') {
                    e.preventDefault();
                    this.focusedIndex = Math.min(this.focusedIndex + 1, this.documents.length - 1);
                    this.renderFocused();
                    return;
                }
                if (key === 'k' || key === 'ArrowUp') {
                    e.preventDefault();
                    this.focusedIndex = Math.max(this.focusedIndex - 1, 0);
                    this.renderFocused();
                    return;
                }
            }

            // Actions
            if (key === 'a' || key === 'A') {
                if (this.selectedIds.size > 0) this.bulkApprove();
                else if (this.currentLayout === 'focused') this.approveHeroDoc();
                return;
            }
            if (key === 'r' || key === 'R') {
                if (this.selectedIds.size > 0) this.bulkReject();
                else if (this.currentLayout === 'focused') this.rejectHeroDoc();
                return;
            }
            if (key === 's' || key === 'S') {
                if (this.currentLayout === 'focused') this.skipHeroDoc();
                return;
            }
            if (key === 'Enter') {
                if (this.currentLayout === 'focused') this.openHeroDoc();
                return;
            }

            // Help
            if (key === '?') { this.showKeyboardHelp(); return; }
            if (key === '/') { e.preventDefault(); this.openCommandPalette(); return; }
            if (key === 'u' || key === 'U') { Router.navigate('ingest'); return; }
        },

        // ==========================================
        // DOCUMENT ACTIONS
        // ==========================================
        approveHeroDoc: function() {
            var heroDoc = el('#mc-hero-doc');
            if (heroDoc && heroDoc.dataset.docId) {
                this.approveDocument(heroDoc.dataset.docId);
            }
        },

        rejectHeroDoc: function() {
            var heroDoc = el('#mc-hero-doc');
            if (heroDoc && heroDoc.dataset.docId) {
                this.rejectDocument(heroDoc.dataset.docId);
            }
        },

        openHeroDoc: function() {
            var heroDoc = el('#mc-hero-doc');
            if (heroDoc && heroDoc.dataset.docId) {
                Router.navigate('review', { docId: heroDoc.dataset.docId });
            }
        },

        skipHeroDoc: function() {
            var heroDoc = el('#mc-hero-doc');
            if (heroDoc && heroDoc.dataset.docId) {
                this.skipDocument(heroDoc.dataset.docId);
            }
        },

        approveDocument: function(docId) {
            var self = this;

            this.removeDocFromUI(docId);

            API.put('approve', { documentId: docId }).then(function() {
                self.showToast('Document approved', 'success');
                self.loadData();
            }).catch(function(err) {
                console.error('Approve failed:', err);
                self.showToast('Approve failed', 'error');
                self.loadData();
            });
        },

        rejectDocument: function(docId) {
            var self = this;

            this.removeDocFromUI(docId);

            API.put('reject', { documentId: docId, reason: 'Rejected from dashboard' }).then(function() {
                self.showToast('Document rejected', 'warning');
                self.loadData();
            }).catch(function(err) {
                console.error('Reject failed:', err);
                self.showToast('Reject failed', 'error');
                self.loadData();
            });
        },

        skipDocument: function(docId) {
            this.skippedIds.add(String(docId));
            this.saveSkippedIds();

            var doc = this.findDoc(docId);
            if (doc) doc.isSkipped = true;

            this.processDocuments();
            this.calculateStats({});

            // Move to next document in focused view
            if (this.currentLayout === 'focused' && this.focusedIndex >= this.documents.length) {
                this.focusedIndex = Math.max(0, this.documents.length - 1);
            }

            this.render();
            this.showToast('Skipped', 'info');
        },

        approveAllReady: function() {
            var self = this;
            var ready = this.documents.filter(function(d) { return d.isReady && !d.isSkipped; });
            var ids = ready.map(function(d) { return d.id; });

            if (ids.length === 0) return;

            ids.forEach(function(id) { self.removeDocFromUI(id); });

            Promise.all(ids.map(function(id) {
                return API.put('approve', { documentId: id });
            })).then(function() {
                self.showToast(ids.length + ' approved', 'success');
                self.loadData();
            }).catch(function(err) {
                console.error('Bulk approve failed:', err);
                self.loadData();
            });
        },

        bulkApprove: function() {
            var self = this;
            var ids = Array.from(this.selectedIds);

            if (ids.length === 0) return;

            this.selectedIds.clear();
            ids.forEach(function(id) { self.removeDocFromUI(id); });

            Promise.all(ids.map(function(id) {
                return API.put('approve', { documentId: id });
            })).then(function() {
                self.showToast(ids.length + ' approved', 'success');
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

            this.selectedIds.clear();
            ids.forEach(function(id) { self.removeDocFromUI(id); });

            Promise.all(ids.map(function(id) {
                return API.put('reject', { documentId: id, reason: 'Bulk rejected' });
            })).then(function() {
                self.showToast(ids.length + ' rejected', 'warning');
                self.loadData();
            }).catch(function(err) {
                console.error('Bulk reject failed:', err);
                self.loadData();
            });
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
            this.render();
        },

        // ==========================================
        // CONTEXT MENU
        // ==========================================
        contextMenuDocId: null,

        showContextMenuForDoc: function(docId, e) {
            this.contextMenuDocId = docId;

            var menu = el('#context-menu');
            if (!menu) return;

            var x = e.clientX;
            var y = e.clientY;

            if (x + 200 > window.innerWidth) x = window.innerWidth - 210;
            if (y + 200 > window.innerHeight) y = window.innerHeight - 210;

            menu.style.left = x + 'px';
            menu.style.top = y + 'px';
            menu.style.display = 'block';

            e.stopPropagation();
        },

        hideContextMenu: function() {
            var menu = el('#context-menu');
            if (menu) menu.style.display = 'none';
            this.contextMenuDocId = null;
        },

        handleContextMenuAction: function(action) {
            var docId = this.contextMenuDocId;
            this.hideContextMenu();

            if (!docId) return;

            switch (action) {
                case 'approve': this.approveDocument(docId); break;
                case 'reject': this.rejectDocument(docId); break;
                case 'open': Router.navigate('review', { docId: docId }); break;
                case 'skip': this.skipDocument(docId); break;
            }
        },

        // ==========================================
        // COMMAND PALETTE
        // ==========================================
        toggleCommandPalette: function() {
            if (this.commandPaletteOpen) this.closeCommandPalette();
            else this.openCommandPalette();
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
                    input.oninput = function() { self.renderCommandResults(input.value); };
                    input.onkeydown = function(e) { self.handleCommandPaletteKey(e); };
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
            if (e.key === 'Escape') { this.closeCommandPalette(); return; }
            if (e.key === 'Enter') {
                var selected = el('.command-result.selected');
                if (selected) this.executeCommand(selected.dataset.command, selected.dataset.arg);
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
                container.innerHTML = '<div class="command-empty">No results</div>';
                return;
            }

            var html = commands.map(function(cmd, i) {
                return '<div class="command-result' + (i === 0 ? ' selected' : '') + '" data-command="' + cmd.id + '" data-arg="' + (cmd.arg || '') + '">' +
                    '<i class="fas ' + cmd.icon + '"></i>' +
                    '<div class="command-text"><span class="command-name">' + cmd.name + '</span><span class="command-desc">' + cmd.description + '</span></div>' +
                    (cmd.shortcut ? '<kbd>' + cmd.shortcut + '</kbd>' : '') +
                '</div>';
            }).join('');

            container.innerHTML = html;
        },

        getCommands: function(query) {
            var self = this;
            var q = (query || '').toLowerCase();

            var commands = [
                { id: 'upload', name: 'Upload', description: 'Upload documents', icon: 'fa-cloud-upload-alt', shortcut: 'U' },
                { id: 'layout-focused', name: 'Focused View', description: 'One document at a time', icon: 'fa-square', shortcut: '1' },
                { id: 'layout-grid', name: 'Grid View', description: 'Compact grid layout', icon: 'fa-th', shortcut: '2' },
                { id: 'layout-kanban', name: 'Pipeline View', description: 'Kanban board layout', icon: 'fa-columns', shortcut: '3' },
                { id: 'approve-all', name: 'Approve All Ready', description: 'Approve high-confidence documents', icon: 'fa-check-double' },
                { id: 'refresh', name: 'Refresh', description: 'Reload data', icon: 'fa-sync' },
                { id: 'documents', name: 'All Documents', description: 'View document list', icon: 'fa-file-alt' },
                { id: 'settings', name: 'Settings', description: 'Open settings', icon: 'fa-cog' }
            ];

            // Add document search
            if (q.length >= 2) {
                this.documents.forEach(function(doc) {
                    if ((doc.vendorName || '').toLowerCase().indexOf(q) >= 0 ||
                        (doc.invoiceNumber || '').toLowerCase().indexOf(q) >= 0) {
                        commands.push({
                            id: 'open-doc', arg: doc.id,
                            name: doc.vendorName || 'Unknown',
                            description: '$' + formatNumber(doc.totalAmount || 0),
                            icon: 'fa-file-invoice'
                        });
                    }
                });
            }

            if (!q) return commands.slice(0, 8);

            return commands.filter(function(cmd) {
                return cmd.name.toLowerCase().indexOf(q) >= 0 ||
                       cmd.description.toLowerCase().indexOf(q) >= 0;
            }).slice(0, 8);
        },

        navigateCommandResults: function(delta) {
            var results = document.querySelectorAll('.command-result');
            var current = document.querySelector('.command-result.selected');
            var currentIndex = Array.from(results).indexOf(current);
            var newIndex = Math.max(0, Math.min(results.length - 1, currentIndex + delta));

            results.forEach(function(r, i) { r.classList.toggle('selected', i === newIndex); });
            results[newIndex].scrollIntoView({ block: 'nearest' });
        },

        executeCommand: function(command, arg) {
            this.closeCommandPalette();

            switch (command) {
                case 'upload': Router.navigate('ingest'); break;
                case 'layout-focused': this.setActiveLayout('focused'); break;
                case 'layout-grid': this.setActiveLayout('grid'); break;
                case 'layout-kanban': this.setActiveLayout('kanban'); break;
                case 'approve-all': this.approveAllReady(); break;
                case 'refresh': this.loadData(); break;
                case 'documents': Router.navigate('documents'); break;
                case 'settings': Router.navigate('settings'); break;
                case 'open-doc': Router.navigate('review', { docId: arg }); break;
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
        // TOAST
        // ==========================================
        showToast: function(message, type) {
            var toast = el('#action-toast');
            var msgEl = el('#action-toast-message');

            if (!toast || !msgEl) return;

            toast.className = 'action-toast ' + (type || 'info');
            msgEl.textContent = message;
            toast.style.display = 'flex';

            setTimeout(function() { toast.style.display = 'none'; }, 3000);
        },

        // ==========================================
        // UTILITIES
        // ==========================================
        findDoc: function(docId) {
            var id = String(docId);
            return this.allDocs.find(function(d) { return String(d.id) === id; });
        },

        removeDocFromUI: function(docId) {
            var id = String(docId);

            this.documents = this.documents.filter(function(d) { return String(d.id) !== id; });
            this.allDocs = this.allDocs.filter(function(d) { return String(d.id) !== id; });

            if (this.focusedIndex >= this.documents.length) {
                this.focusedIndex = Math.max(0, this.documents.length - 1);
            }

            this.calculateStats({});
            this.render();
        },

        loadSkippedIds: function() {
            try {
                var stored = localStorage.getItem('flux_skipped_docs');
                return new Set(stored ? JSON.parse(stored) : []);
            } catch (e) {
                return new Set();
            }
        },

        saveSkippedIds: function() {
            try {
                localStorage.setItem('flux_skipped_docs', JSON.stringify(Array.from(this.skippedIds)));
            } catch (e) {}
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
                if (!API.sessionExpired) self.loadData();
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
    // REGISTER ROUTE
    // ==========================================
    Router.register('dashboard',
        function(params) { DashboardController.init(params); },
        function() { DashboardController.cleanup(); }
    );

    FCDebug.log('[View.Dashboard] Redesigned Dashboard loaded');

})();
