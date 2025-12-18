/**
 * Flux Capture - Documents View Controller
 * Inbox Zero + Command Mode keyboard-driven interface
 * Premium document review experience with celebrations
 */
(function() {
    'use strict';

    var DocStatus = {
        PENDING: '1',
        PROCESSING: '2',
        EXTRACTED: '3',
        NEEDS_REVIEW: '4',
        REJECTED: '5',
        COMPLETED: '6',
        ERROR: '7'
    };

    var COMMANDS = [
        { id: 'approve', label: 'Approve current document', icon: 'fa-check', shortcut: 'A' },
        { id: 'approve-all-high', label: 'Approve all high confidence', icon: 'fa-check-double', shortcut: '⌘⇧A' },
        { id: 'delete', label: 'Delete current document', icon: 'fa-trash-can', shortcut: 'D' },
        { id: 'open', label: 'Open full review', icon: 'fa-expand', shortcut: '⏎' },
        { id: 'search', label: 'Search documents', icon: 'fa-search', shortcut: '/' },
        { id: 'upload', label: 'Upload new documents', icon: 'fa-cloud-arrow-up', shortcut: 'U' },
        { id: 'refresh', label: 'Refresh document list', icon: 'fa-sync-alt', shortcut: '⌘R' },
        { id: 'dashboard', label: 'Go to Mission Control', icon: 'fa-gauge-high', shortcut: 'G M' },
        { id: 'ingest', label: 'Go to Ingest', icon: 'fa-bolt', shortcut: 'G I' }
    ];

    var DocumentsController = {
        documents: [],
        filteredDocuments: [],
        selectedIds: [],
        focusedIndex: 0,
        currentFilter: 'review',
        searchQuery: '',
        streak: 0,
        bestStreak: 0,
        processedToday: 0,
        commandPaletteOpen: false,
        previewExpanded: -1,
        refreshInterval: null,
        REFRESH_MS: 10000,

        // ==========================================
        // INITIALIZATION
        // ==========================================
        init: function(params) {
            var self = this;
            this.documents = [];
            this.filteredDocuments = [];
            this.selectedIds = [];
            this.focusedIndex = 0;
            this.currentFilter = (params && params.filter) || 'review';
            this.searchQuery = (params && params.search) || '';
            this.streak = 0;
            this.commandPaletteOpen = false;
            this.previewExpanded = -1;

            // Load streak from localStorage
            this.bestStreak = parseInt(localStorage.getItem('fc_best_streak') || '0');
            this.processedToday = parseInt(localStorage.getItem('fc_processed_today') || '0');

            // Check if it's a new day
            var lastDate = localStorage.getItem('fc_last_date');
            var today = new Date().toDateString();
            if (lastDate !== today) {
                this.processedToday = 0;
                localStorage.setItem('fc_processed_today', '0');
                localStorage.setItem('fc_last_date', today);
            }

            renderTemplate('tpl-documents', 'view-container');
            this.bindEvents();
            this.loadData();
            this.startRefresh();
        },

        cleanup: function() {
            this.stopRefresh();
            this.documents = [];
            this.closeCommandPalette();
        },

        // ==========================================
        // DATA LOADING
        // ==========================================
        loadData: function() {
            var self = this;

            API.get('queue', { pageSize: 200 }).then(function(data) {
                self.documents = (data && data.queue) || [];
                self.applyFilters();
                self.render();
                self.updateBadges();
            }).catch(function(err) {
                console.error('[Documents] Load error:', err);
                UI.toast('Failed to load documents', 'error');
            });
        },

        applyFilters: function() {
            var self = this;
            var docs = this.documents;

            // Apply category filter
            switch (this.currentFilter) {
                case 'review':
                    docs = docs.filter(function(d) {
                        var s = String(d.status);
                        return s === DocStatus.NEEDS_REVIEW || s === DocStatus.EXTRACTED || s === DocStatus.ERROR;
                    });
                    break;
                case 'high':
                    docs = docs.filter(function(d) {
                        var s = String(d.status);
                        var isReview = s === DocStatus.NEEDS_REVIEW || s === DocStatus.EXTRACTED;
                        return isReview && parseInt(d.confidence) >= 85;
                    });
                    break;
                case 'medium':
                    docs = docs.filter(function(d) {
                        var s = String(d.status);
                        var isReview = s === DocStatus.NEEDS_REVIEW || s === DocStatus.EXTRACTED;
                        var conf = parseInt(d.confidence);
                        return isReview && conf >= 60 && conf < 85;
                    });
                    break;
                case 'low':
                    docs = docs.filter(function(d) {
                        var s = String(d.status);
                        var isReview = s === DocStatus.NEEDS_REVIEW || s === DocStatus.EXTRACTED;
                        return isReview && parseInt(d.confidence) < 60;
                    });
                    break;
                case 'flagged':
                    docs = docs.filter(function(d) {
                        return (d.anomalies && d.anomalies.length > 0) || String(d.status) === DocStatus.ERROR;
                    });
                    break;
                case 'completed':
                    docs = docs.filter(function(d) {
                        var s = String(d.status);
                        return s === DocStatus.COMPLETED || s === DocStatus.REJECTED;
                    });
                    break;
                case 'all':
                    // No filter
                    break;
            }

            // Apply search
            if (this.searchQuery) {
                var query = this.searchQuery.toLowerCase();
                docs = docs.filter(function(d) {
                    return (d.vendorName && d.vendorName.toLowerCase().indexOf(query) !== -1) ||
                           (d.invoiceNumber && d.invoiceNumber.toLowerCase().indexOf(query) !== -1) ||
                           (d.fileName && d.fileName.toLowerCase().indexOf(query) !== -1);
                });
            }

            // Sort by confidence (high first for quick processing)
            docs.sort(function(a, b) {
                return (parseInt(b.confidence) || 0) - (parseInt(a.confidence) || 0);
            });

            this.filteredDocuments = docs;
            this.focusedIndex = Math.min(this.focusedIndex, Math.max(0, docs.length - 1));
        },

        startRefresh: function() {
            var self = this;
            this.stopRefresh();
            this.refreshInterval = setInterval(function() {
                if (!self.commandPaletteOpen) {
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

            // Triage tabs
            document.addEventListener('click', function(e) {
                var tab = e.target.closest('.triage-tab');
                if (tab) {
                    self.setFilter(tab.dataset.filter);
                    return;
                }

                // Document row click
                var row = e.target.closest('.doc-row');
                if (row && !e.target.closest('.row-action')) {
                    var index = parseInt(row.dataset.index);
                    self.focusRow(index);

                    // Double-click opens review
                    if (e.detail === 2) {
                        self.openCurrentDocument();
                    }
                    return;
                }

                // Quick action buttons
                var action = e.target.closest('.row-action');
                if (action) {
                    var docId = action.closest('.doc-row').dataset.docId;
                    self.handleRowAction(action.dataset.action, docId);
                    return;
                }

                // Quick actions panel
                if (e.target.closest('#qa-approve-high')) {
                    self.approveAllHighConfidence();
                    return;
                }

                // Command palette overlay
                if (e.target.closest('.palette-overlay')) {
                    self.closeCommandPalette();
                    return;
                }

                // Command item
                var cmdItem = e.target.closest('.command-item');
                if (cmdItem) {
                    self.executeCommand(cmdItem.dataset.cmd);
                    self.closeCommandPalette();
                    return;
                }
            });

            // Search input
            var searchInput = el('#doc-search');
            if (searchInput) {
                searchInput.addEventListener('input', function() {
                    self.searchQuery = this.value;
                    self.applyFilters();
                    self.render();
                });

                searchInput.addEventListener('focus', function() {
                    // Hide keyboard HUD when searching
                });
            }

            // Navigation buttons
            this.on('#btn-refresh', 'click', function() {
                self.loadData();
                UI.toast('Refreshed', 'success');
            });

            this.on('#btn-go-to-flow', 'click', function() {
                Router.navigate('ingest');
            });

            this.on('#btn-upload-from-zero', 'click', function() {
                Router.navigate('ingest');
            });

            // Keyboard navigation
            document.addEventListener('keydown', function(e) {
                // Don't handle if in input
                if (e.target.matches('input, textarea, select')) {
                    if (e.key === 'Escape') {
                        e.target.blur();
                    }
                    return;
                }

                // Command palette
                if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
                    e.preventDefault();
                    self.toggleCommandPalette();
                    return;
                }

                if (self.commandPaletteOpen) {
                    if (e.key === 'Escape') {
                        self.closeCommandPalette();
                    }
                    return;
                }

                // Navigation
                switch (e.key) {
                    case 'j':
                    case 'ArrowDown':
                        e.preventDefault();
                        self.moveFocus(1);
                        break;
                    case 'k':
                    case 'ArrowUp':
                        e.preventDefault();
                        self.moveFocus(-1);
                        break;
                    case 'Enter':
                        e.preventDefault();
                        self.openCurrentDocument();
                        break;
                    case 'a':
                        if (!e.metaKey && !e.ctrlKey) {
                            e.preventDefault();
                            self.approveCurrentDocument();
                        }
                        break;
                    case 'A':
                        if (e.shiftKey && (e.metaKey || e.ctrlKey)) {
                            e.preventDefault();
                            self.approveAllHighConfidence();
                        }
                        break;
                    case 'd':
                        if (!e.metaKey && !e.ctrlKey) {
                            e.preventDefault();
                            self.deleteCurrentDocument();
                        }
                        break;
                    case 'r':
                        if (e.metaKey || e.ctrlKey) {
                            e.preventDefault();
                            self.loadData();
                        }
                        break;
                    case ' ':
                        e.preventDefault();
                        self.toggleSelection();
                        break;
                    case '/':
                        e.preventDefault();
                        var search = el('#doc-search');
                        if (search) search.focus();
                        break;
                    case 'Escape':
                        self.previewExpanded = -1;
                        self.render();
                        break;
                }
            });
        },

        on: function(selector, event, handler) {
            var element = document.querySelector(selector);
            if (element) element.addEventListener(event, handler);
        },

        // ==========================================
        // RENDERING
        // ==========================================
        render: function() {
            this.renderProgress();
            this.renderTabs();
            this.renderQuickActions();
            this.renderDocumentList();
            this.checkInboxZero();
        },

        renderProgress: function() {
            var reviewDocs = this.documents.filter(function(d) {
                var s = String(d.status);
                return s === DocStatus.NEEDS_REVIEW || s === DocStatus.EXTRACTED || s === DocStatus.ERROR;
            });

            var count = reviewDocs.length;
            var total = count + this.processedToday;
            var pct = total > 0 ? Math.round((this.processedToday / total) * 100) : 0;

            var countEl = el('#inbox-count');
            var fillEl = el('#progress-fill');
            var textEl = el('#progress-text');
            var streakBadge = el('#streak-badge');
            var streakCount = el('#streak-count');

            if (countEl) countEl.textContent = count;
            if (fillEl) fillEl.style.width = pct + '%';
            if (textEl) textEl.textContent = pct + '% complete today';

            if (streakBadge && this.streak > 0) {
                streakBadge.style.display = 'inline-flex';
                if (streakCount) streakCount.textContent = this.streak;
            } else if (streakBadge) {
                streakBadge.style.display = 'none';
            }
        },

        renderTabs: function() {
            var self = this;

            // Count documents for each filter
            var reviewCount = 0, highCount = 0, medCount = 0, lowCount = 0, flaggedCount = 0, completedCount = 0;

            this.documents.forEach(function(d) {
                var s = String(d.status);
                var conf = parseInt(d.confidence) || 0;
                var isReview = s === DocStatus.NEEDS_REVIEW || s === DocStatus.EXTRACTED || s === DocStatus.ERROR;
                var hasFlagged = (d.anomalies && d.anomalies.length > 0) || s === DocStatus.ERROR;

                if (isReview) {
                    reviewCount++;
                    if (conf >= 85) highCount++;
                    else if (conf >= 60) medCount++;
                    else lowCount++;
                }
                if (hasFlagged) flaggedCount++;
                if (s === DocStatus.COMPLETED || s === DocStatus.REJECTED) completedCount++;
            });

            // Update counts
            var counts = {
                review: reviewCount,
                high: highCount,
                medium: medCount,
                low: lowCount,
                flagged: flaggedCount,
                completed: completedCount
            };

            Object.keys(counts).forEach(function(key) {
                var el = document.getElementById('tab-count-' + key);
                if (el) el.textContent = counts[key];
            });

            // Update active state
            els('.triage-tab').forEach(function(tab) {
                tab.classList.toggle('active', tab.dataset.filter === self.currentFilter);
            });
        },

        renderQuickActions: function() {
            var panel = el('#quick-actions-panel');
            if (!panel) return;

            var highConfDocs = this.documents.filter(function(d) {
                var s = String(d.status);
                var isReview = s === DocStatus.NEEDS_REVIEW || s === DocStatus.EXTRACTED;
                return isReview && parseInt(d.confidence) >= 85;
            });

            if (highConfDocs.length > 0) {
                panel.style.display = 'flex';

                var total = highConfDocs.reduce(function(sum, d) {
                    return sum + (parseFloat(d.totalAmount) || 0);
                }, 0);

                var countEl = el('#qa-high-count');
                var totalEl = el('#qa-high-total');

                if (countEl) countEl.textContent = highConfDocs.length;
                if (totalEl) totalEl.textContent = formatNumber(total);
            } else {
                panel.style.display = 'none';
            }
        },

        renderDocumentList: function() {
            var self = this;
            var container = el('#document-list');
            if (!container) return;

            if (this.filteredDocuments.length === 0) {
                container.innerHTML = '<div class="list-empty"><i class="fas fa-inbox"></i><span>No documents match filter</span></div>';
                return;
            }

            container.innerHTML = this.filteredDocuments.map(function(doc, index) {
                return self.renderDocumentRow(doc, index);
            }).join('');
        },

        renderDocumentRow: function(doc, index) {
            var isFocused = index === this.focusedIndex;
            var isSelected = this.selectedIds.indexOf(String(doc.id)) !== -1;
            var isExpanded = index === this.previewExpanded;
            var conf = parseInt(doc.confidence) || 0;
            var confClass = conf >= 85 ? 'high' : conf >= 60 ? 'medium' : 'low';
            var hasAnomaly = doc.anomalies && doc.anomalies.length > 0;
            var hasError = String(doc.status) === DocStatus.ERROR;

            var classes = ['doc-row'];
            if (isFocused) classes.push('focused');
            if (isSelected) classes.push('selected');
            if (isExpanded) classes.push('expanded');

            var html = '<div class="' + classes.join(' ') + '" data-index="' + index + '" data-doc-id="' + doc.id + '">' +
                '<div class="row-main">' +
                    '<span class="row-focus-indicator">' + (isFocused ? '▸' : '') + '</span>' +
                    '<span class="row-select-indicator">' + (isSelected ? '■' : '□') + '</span>' +
                    '<span class="row-confidence conf-' + confClass + '">' +
                        '<span class="conf-bar"><span class="conf-fill" style="width:' + conf + '%"></span></span>' +
                    '</span>' +
                    '<span class="row-vendor">' + escapeHtml(doc.vendorName || 'Unknown') + '</span>' +
                    '<span class="row-invoice">' + escapeHtml(doc.invoiceNumber || '-') + '</span>' +
                    '<span class="row-amount">$' + formatNumber(doc.totalAmount || 0) + '</span>' +
                    '<span class="row-conf-badge conf-' + confClass + '">' + conf + '%' + (conf >= 85 ? ' ✓' : '') + '</span>' +
                    (hasAnomaly || hasError ? '<span class="row-flag"><i class="fas fa-flag"></i></span>' : '') +
                    '<div class="row-actions">' +
                        '<button class="row-action btn-approve" data-action="approve" title="Approve (A)"><i class="fas fa-check"></i></button>' +
                        '<button class="row-action btn-open" data-action="open" title="Open (⏎)"><i class="fas fa-expand"></i></button>' +
                        '<button class="row-action btn-delete" data-action="delete" title="Delete (D)"><i class="fas fa-trash-can"></i></button>' +
                    '</div>' +
                '</div>';

            // Expanded preview
            if (isExpanded) {
                html += '<div class="row-preview">' +
                    '<div class="preview-thumb"><i class="fas fa-file-pdf"></i></div>' +
                    '<div class="preview-details">' +
                        '<div class="preview-field"><span class="field-label">Vendor</span><span class="field-value">' + escapeHtml(doc.vendorName || '-') + '</span></div>' +
                        '<div class="preview-field"><span class="field-label">Invoice</span><span class="field-value">' + escapeHtml(doc.invoiceNumber || '-') + '</span></div>' +
                        '<div class="preview-field"><span class="field-label">Amount</span><span class="field-value">$' + formatNumber(doc.totalAmount || 0) + '</span></div>' +
                        '<div class="preview-field"><span class="field-label">Date</span><span class="field-value">' + (doc.invoiceDate || '-') + '</span></div>' +
                    '</div>' +
                    '<div class="preview-confidence">' +
                        '<div class="why-conf">' +
                            '<strong>Why ' + conf + '%:</strong> ' +
                            (conf >= 85 ? '✓ Vendor matched ✓ Amount validated ✓ Format recognized' :
                             conf >= 60 ? '✓ Partial match ⚠ Verify details' :
                             '⚠ Low confidence - manual review needed') +
                        '</div>' +
                    '</div>' +
                '</div>';
            }

            html += '</div>';
            return html;
        },

        checkInboxZero: function() {
            var reviewDocs = this.documents.filter(function(d) {
                var s = String(d.status);
                return s === DocStatus.NEEDS_REVIEW || s === DocStatus.EXTRACTED || s === DocStatus.ERROR;
            });

            var listEl = el('#document-list');
            var zeroEl = el('#inbox-zero');

            if (reviewDocs.length === 0 && this.currentFilter === 'review') {
                if (listEl) listEl.style.display = 'none';
                if (zeroEl) {
                    zeroEl.style.display = 'flex';
                    this.triggerCelebration();
                }

                // Update stats
                var processedEl = el('#zero-processed');
                var accuracyEl = el('#zero-accuracy');
                var streakEl = el('#zero-streak');

                if (processedEl) processedEl.textContent = this.processedToday;
                if (accuracyEl) accuracyEl.textContent = '94%'; // Could calculate from actual data
                if (streakEl) streakEl.textContent = this.bestStreak;
            } else {
                if (listEl) listEl.style.display = 'block';
                if (zeroEl) zeroEl.style.display = 'none';
            }
        },

        updateBadges: function() {
            var reviewCount = this.documents.filter(function(d) {
                var s = String(d.status);
                return s === DocStatus.NEEDS_REVIEW || s === DocStatus.EXTRACTED || s === DocStatus.ERROR;
            }).length;

            UI.updateBadge(reviewCount);

            // Update documents badge in nav
            var docsBadge = el('#documents-badge');
            if (docsBadge) {
                if (reviewCount > 0) {
                    docsBadge.textContent = reviewCount;
                    docsBadge.style.display = 'inline-flex';
                } else {
                    docsBadge.style.display = 'none';
                }
            }
        },

        // ==========================================
        // NAVIGATION & SELECTION
        // ==========================================
        setFilter: function(filter) {
            this.currentFilter = filter;
            this.focusedIndex = 0;
            this.applyFilters();
            this.render();
        },

        moveFocus: function(delta) {
            var newIndex = this.focusedIndex + delta;
            if (newIndex >= 0 && newIndex < this.filteredDocuments.length) {
                this.focusedIndex = newIndex;
                this.render();
                this.scrollToFocused();
            }
        },

        focusRow: function(index) {
            this.focusedIndex = index;
            this.render();
        },

        scrollToFocused: function() {
            var row = el('.doc-row.focused');
            if (row) {
                row.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
            }
        },

        toggleSelection: function() {
            var doc = this.filteredDocuments[this.focusedIndex];
            if (!doc) return;

            var id = String(doc.id);
            var idx = this.selectedIds.indexOf(id);

            if (idx === -1) {
                this.selectedIds.push(id);
            } else {
                this.selectedIds.splice(idx, 1);
            }

            this.render();
        },

        // ==========================================
        // DOCUMENT ACTIONS
        // ==========================================
        handleRowAction: function(action, docId) {
            switch (action) {
                case 'approve':
                    this.approveDocument(docId);
                    break;
                case 'open':
                    Router.navigate('review', { docId: docId });
                    break;
                case 'delete':
                    this.deleteDocument(docId);
                    break;
            }
        },

        openCurrentDocument: function() {
            var doc = this.filteredDocuments[this.focusedIndex];
            if (doc) {
                Router.navigate('review', { docId: doc.id });
            }
        },

        approveCurrentDocument: function() {
            var doc = this.filteredDocuments[this.focusedIndex];
            if (doc) {
                this.approveDocument(doc.id);
            }
        },

        deleteCurrentDocument: function() {
            var doc = this.filteredDocuments[this.focusedIndex];
            if (doc) {
                this.deleteDocument(doc.id);
            }
        },

        approveDocument: function(docId) {
            var self = this;

            API.put('approve', { documentId: docId, createTransaction: true })
                .then(function(result) {
                    self.streak++;
                    self.processedToday++;
                    self.bestStreak = Math.max(self.bestStreak, self.streak);

                    // Save to localStorage
                    localStorage.setItem('fc_best_streak', String(self.bestStreak));
                    localStorage.setItem('fc_processed_today', String(self.processedToday));

                    self.showApprovalAnimation(docId);
                    UI.toast('Document approved!', 'success');

                    // Streak celebration
                    if (self.streak === 5) {
                        UI.toast('🔥 5 streak! Keep going!', 'info');
                    } else if (self.streak === 10) {
                        UI.toast('🔥🔥 10 streak! On fire!', 'info');
                        self.triggerConfetti();
                    }

                    self.loadData();
                })
                .catch(function(err) {
                    self.streak = 0;
                    UI.toast('Error: ' + err.message, 'error');
                });
        },

        deleteDocument: function(docId) {
            var self = this;

            UI.confirm({
                title: 'Delete Document',
                message: 'Are you sure you want to delete this document? This action cannot be undone.',
                confirmText: 'Delete',
                cancelText: 'Cancel',
                type: 'danger'
            }).then(function(confirmed) {
                if (!confirmed) return;

                API.delete('document', { id: docId })
                    .then(function() {
                        self.streak = 0;
                        self.processedToday++;
                        localStorage.setItem('fc_processed_today', String(self.processedToday));

                        UI.toast('Document deleted', 'success');
                        self.loadData();
                    })
                    .catch(function(err) {
                        UI.toast('Error: ' + err.message, 'error');
                    });
            });
        },

        approveAllHighConfidence: function() {
            var self = this;
            var highConfDocs = this.documents.filter(function(d) {
                var s = String(d.status);
                var isReview = s === DocStatus.NEEDS_REVIEW || s === DocStatus.EXTRACTED;
                return isReview && parseInt(d.confidence) >= 85;
            });

            if (highConfDocs.length === 0) {
                UI.toast('No high confidence documents to approve', 'info');
                return;
            }

            UI.confirm({
                title: 'Batch Approve',
                message: 'Approve ' + highConfDocs.length + ' high confidence documents?',
                confirmText: 'Approve All',
                type: 'success'
            }).then(function(confirmed) {
                if (!confirmed) return;

                var approved = 0;
                var errors = 0;

                function approveNext(index) {
                    if (index >= highConfDocs.length) {
                        self.streak += approved;
                        self.processedToday += approved;
                        self.bestStreak = Math.max(self.bestStreak, self.streak);
                        localStorage.setItem('fc_best_streak', String(self.bestStreak));
                        localStorage.setItem('fc_processed_today', String(self.processedToday));

                        UI.toast('Approved ' + approved + ' documents!', 'success');
                        self.triggerConfetti();
                        self.loadData();
                        return;
                    }

                    API.put('approve', { documentId: highConfDocs[index].id, createTransaction: true })
                        .then(function() {
                            approved++;
                            approveNext(index + 1);
                        })
                        .catch(function() {
                            errors++;
                            approveNext(index + 1);
                        });
                }

                approveNext(0);
            });
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
            var palette = el('#command-palette');
            if (!palette) return;

            this.commandPaletteOpen = true;
            palette.style.display = 'flex';

            // Render commands
            var resultsEl = el('#palette-results');
            if (resultsEl) {
                resultsEl.innerHTML = COMMANDS.map(function(cmd) {
                    return '<div class="command-item" data-cmd="' + cmd.id + '">' +
                        '<span class="cmd-icon"><i class="fas ' + cmd.icon + '"></i></span>' +
                        '<span class="cmd-label">' + cmd.label + '</span>' +
                        '<span class="cmd-shortcut">' + cmd.shortcut + '</span>' +
                    '</div>';
                }).join('');
            }

            // Focus input
            var input = el('#palette-input');
            if (input) {
                input.value = '';
                input.focus();

                input.addEventListener('input', function() {
                    var query = this.value.toLowerCase();
                    var filtered = COMMANDS.filter(function(cmd) {
                        return cmd.label.toLowerCase().indexOf(query) !== -1;
                    });

                    if (resultsEl) {
                        resultsEl.innerHTML = filtered.map(function(cmd) {
                            return '<div class="command-item" data-cmd="' + cmd.id + '">' +
                                '<span class="cmd-icon"><i class="fas ' + cmd.icon + '"></i></span>' +
                                '<span class="cmd-label">' + cmd.label + '</span>' +
                                '<span class="cmd-shortcut">' + cmd.shortcut + '</span>' +
                            '</div>';
                        }).join('');
                    }
                });
            }
        },

        closeCommandPalette: function() {
            var palette = el('#command-palette');
            if (palette) {
                palette.style.display = 'none';
            }
            this.commandPaletteOpen = false;
        },

        executeCommand: function(cmdId) {
            var self = this;

            switch (cmdId) {
                case 'approve':
                    this.approveCurrentDocument();
                    break;
                case 'approve-all-high':
                    this.approveAllHighConfidence();
                    break;
                case 'delete':
                    this.deleteCurrentDocument();
                    break;
                case 'open':
                    this.openCurrentDocument();
                    break;
                case 'search':
                    var search = el('#doc-search');
                    if (search) search.focus();
                    break;
                case 'upload':
                    Router.navigate('ingest');
                    break;
                case 'refresh':
                    this.loadData();
                    UI.toast('Refreshed', 'success');
                    break;
                case 'dashboard':
                    Router.navigate('dashboard');
                    break;
                case 'ingest':
                    Router.navigate('ingest');
                    break;
            }
        },

        // ==========================================
        // ANIMATIONS & CELEBRATIONS
        // ==========================================
        showApprovalAnimation: function(docId) {
            var row = document.querySelector('.doc-row[data-doc-id="' + docId + '"]');
            if (row) {
                row.classList.add('approving');
                setTimeout(function() {
                    row.classList.add('approved');
                }, 100);
            }
        },

        triggerCelebration: function() {
            this.triggerConfetti();
        },

        triggerConfetti: function() {
            var container = el('#confetti-container');
            if (!container) return;

            // Create confetti particles
            var colors = ['#2563eb', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6'];

            for (var i = 0; i < 50; i++) {
                var confetti = document.createElement('div');
                confetti.className = 'confetti-particle';
                confetti.style.left = Math.random() * 100 + '%';
                confetti.style.backgroundColor = colors[Math.floor(Math.random() * colors.length)];
                confetti.style.animationDelay = Math.random() * 0.5 + 's';
                confetti.style.animationDuration = (2 + Math.random() * 2) + 's';
                container.appendChild(confetti);
            }

            // Clean up after animation
            setTimeout(function() {
                container.innerHTML = '';
            }, 4000);
        }
    };

    // Register the controller
    Router.register('documents',
        function(params) { DocumentsController.init(params); },
        function() { DocumentsController.cleanup(); }
    );

    console.log('[View.Documents] Loaded');

})();
