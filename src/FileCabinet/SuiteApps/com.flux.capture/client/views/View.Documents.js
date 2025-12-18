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
        _clickHandler: null,
        _keydownHandler: null,

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
            // Remove event listeners
            if (this._clickHandler) {
                document.removeEventListener('click', this._clickHandler);
                this._clickHandler = null;
            }
            if (this._keydownHandler) {
                document.removeEventListener('keydown', this._keydownHandler);
                this._keydownHandler = null;
            }
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

            // Remove any existing handlers first (safety)
            if (this._clickHandler) {
                document.removeEventListener('click', this._clickHandler);
            }
            if (this._keydownHandler) {
                document.removeEventListener('keydown', this._keydownHandler);
            }

            // Create click handler
            this._clickHandler = function(e) {
                var tab = e.target.closest('.triage-tab');
                if (tab) {
                    self.setFilter(tab.dataset.filter);
                    return;
                }

                // Select-all checkbox
                if (e.target.id === 'select-all') {
                    self.toggleSelectAll(e.target.checked);
                    return;
                }

                // Row checkbox
                var checkbox = e.target.closest('.row-checkbox');
                if (checkbox) {
                    var docId = checkbox.dataset.id;
                    self.toggleRowSelection(docId, checkbox.checked);
                    return;
                }

                // Bulk action buttons
                if (e.target.closest('#bulk-clear')) {
                    e.stopPropagation();
                    self.clearSelection();
                    return;
                }

                if (e.target.closest('#bulk-delete')) {
                    e.stopPropagation();
                    self.deleteSelected();
                    return;
                }

                // Document row double-click opens review (no single-click focus)
                var row = e.target.closest('.doc-row');
                if (row && !e.target.closest('.row-action') && !e.target.closest('.checkbox-wrapper')) {
                    if (e.detail === 2) {
                        var docId = row.dataset.docId;
                        Router.navigate('review', { docId: docId });
                    }
                    return;
                }

                // Quick action buttons
                var action = e.target.closest('.row-action');
                if (action) {
                    e.stopPropagation();
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
            };
            document.addEventListener('click', this._clickHandler);

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

            // Create keydown handler
            this._keydownHandler = function(e) {
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
            };
            document.addEventListener('keydown', this._keydownHandler);
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

            var allSelected = this.filteredDocuments.length > 0 &&
                this.filteredDocuments.every(function(d) { return self.selectedIds.indexOf(String(d.id)) !== -1; });

            var html = '<div class="docs-table-wrapper">' +
                '<table class="docs-table">' +
                '<thead>' +
                    '<tr>' +
                        '<th class="col-checkbox"><label class="checkbox-wrapper"><input type="checkbox" id="select-all" ' + (allSelected ? 'checked' : '') + '><span class="checkmark"></span></label></th>' +
                        '<th class="col-confidence">Conf</th>' +
                        '<th class="col-status">Status</th>' +
                        '<th class="col-vendor">Vendor</th>' +
                        '<th class="col-invoice">Invoice #</th>' +
                        '<th class="col-amount">Amount</th>' +
                        '<th class="col-date">Date</th>' +
                        '<th class="col-type">Type</th>' +
                        '<th class="col-actions">Actions</th>' +
                    '</tr>' +
                '</thead>' +
                '<tbody>';

            html += this.filteredDocuments.map(function(doc, index) {
                return self.renderDocumentRow(doc, index);
            }).join('');

            html += '</tbody></table></div>';

            // Bulk actions bar
            html += '<div class="bulk-actions-bar" id="bulk-actions-bar" style="display:' + (this.selectedIds.length > 0 ? 'flex' : 'none') + ';">' +
                '<span class="bulk-count"><strong>' + this.selectedIds.length + '</strong> selected</span>' +
                '<div class="bulk-buttons">' +
                    '<button class="btn btn-sm btn-secondary" id="bulk-clear"><i class="fas fa-times"></i> Clear</button>' +
                    '<button class="btn btn-sm btn-danger" id="bulk-delete"><i class="fas fa-trash-can"></i> Delete Selected</button>' +
                '</div>' +
            '</div>';

            container.innerHTML = html;
        },

        renderDocumentRow: function(doc, index) {
            var isSelected = this.selectedIds.indexOf(String(doc.id)) !== -1;
            var conf = parseInt(doc.confidence) || 0;
            var confClass = conf >= 85 ? 'high' : conf >= 60 ? 'medium' : 'low';
            var hasAnomaly = doc.anomalies && doc.anomalies.length > 0;
            var hasError = String(doc.status) === DocStatus.ERROR;
            var statusText = this.getStatusText(doc.status);
            var statusClass = this.getStatusClass(doc.status);
            var docTypeText = this.getDocTypeText(doc.documentType);

            var classes = ['doc-row'];
            if (isSelected) classes.push('selected');

            var html = '<tr class="' + classes.join(' ') + '" data-index="' + index + '" data-doc-id="' + doc.id + '">' +
                '<td class="col-checkbox"><label class="checkbox-wrapper"><input type="checkbox" class="row-checkbox" data-id="' + doc.id + '" ' + (isSelected ? 'checked' : '') + '><span class="checkmark"></span></label></td>' +
                '<td class="col-confidence"><span class="conf-badge conf-' + confClass + '">' + conf + '%</span></td>' +
                '<td class="col-status"><span class="status-pill status-' + statusClass + '">' + statusText + '</span>' +
                    (hasAnomaly || hasError ? ' <i class="fas fa-flag text-warning" title="Has anomalies"></i>' : '') + '</td>' +
                '<td class="col-vendor">' + escapeHtml(doc.vendorName || 'Unknown') + '</td>' +
                '<td class="col-invoice">' + escapeHtml(doc.invoiceNumber || '-') + '</td>' +
                '<td class="col-amount">$' + formatNumber(doc.totalAmount || 0) + '</td>' +
                '<td class="col-date">' + this.formatDate(doc.createdDate) + '</td>' +
                '<td class="col-type">' + escapeHtml(docTypeText) + '</td>' +
                '<td class="col-actions">' +
                    '<div class="row-actions">' +
                        '<button class="row-action btn-approve" data-action="approve" title="Approve"><i class="fas fa-check"></i></button>' +
                        '<button class="row-action btn-open" data-action="open" title="Open"><i class="fas fa-expand"></i></button>' +
                        '<button class="row-action btn-delete" data-action="delete" title="Delete"><i class="fas fa-trash-can"></i></button>' +
                    '</div>' +
                '</td>' +
            '</tr>';

            return html;
        },

        getStatusText: function(status) {
            var statusMap = {
                '1': 'Pending',
                '2': 'Processing',
                '3': 'Extracted',
                '4': 'Review',
                '5': 'Rejected',
                '6': 'Completed',
                '7': 'Error'
            };
            return statusMap[String(status)] || 'Unknown';
        },

        getStatusClass: function(status) {
            var classMap = {
                '1': 'pending',
                '2': 'processing',
                '3': 'extracted',
                '4': 'review',
                '5': 'rejected',
                '6': 'completed',
                '7': 'error'
            };
            return classMap[String(status)] || 'unknown';
        },

        getDocTypeText: function(docType) {
            var typeMap = {
                '1': 'Invoice',
                '2': 'Bill',
                '3': 'Receipt',
                '4': 'PO',
                '5': 'Credit Memo',
                '6': 'Statement'
            };
            return typeMap[String(docType)] || 'Document';
        },

        formatDate: function(dateStr) {
            if (!dateStr) return '-';
            try {
                var date = new Date(dateStr);
                if (isNaN(date.getTime())) return dateStr;
                return (date.getMonth() + 1) + '/' + date.getDate() + '/' + date.getFullYear();
            } catch (e) {
                return dateStr;
            }
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

        toggleSelectAll: function(checked) {
            var self = this;
            if (checked) {
                this.filteredDocuments.forEach(function(doc) {
                    var id = String(doc.id);
                    if (self.selectedIds.indexOf(id) === -1) {
                        self.selectedIds.push(id);
                    }
                });
            } else {
                this.selectedIds = [];
            }
            this.render();
        },

        toggleRowSelection: function(docId, checked) {
            var id = String(docId);
            var idx = this.selectedIds.indexOf(id);

            if (checked && idx === -1) {
                this.selectedIds.push(id);
            } else if (!checked && idx !== -1) {
                this.selectedIds.splice(idx, 1);
            }

            this.updateBulkActionsBar();
            this.updateSelectAllCheckbox();
        },

        clearSelection: function() {
            this.selectedIds = [];
            this.render();
        },

        updateBulkActionsBar: function() {
            var bar = el('#bulk-actions-bar');
            if (bar) {
                bar.style.display = this.selectedIds.length > 0 ? 'flex' : 'none';
                var countEl = bar.querySelector('.bulk-count strong');
                if (countEl) countEl.textContent = this.selectedIds.length;
            }
        },

        updateSelectAllCheckbox: function() {
            var self = this;
            var selectAll = el('#select-all');
            if (selectAll) {
                var allSelected = this.filteredDocuments.length > 0 &&
                    this.filteredDocuments.every(function(d) { return self.selectedIds.indexOf(String(d.id)) !== -1; });
                selectAll.checked = allSelected;
            }
        },

        deleteSelected: function() {
            var self = this;
            var count = this.selectedIds.length;

            if (count === 0) return;

            UI.confirm({
                title: 'Delete ' + count + ' Document' + (count > 1 ? 's' : ''),
                message: 'Are you sure you want to delete ' + count + ' document' + (count > 1 ? 's' : '') + '? This action cannot be undone.',
                confirmText: 'Delete',
                cancelText: 'Cancel',
                type: 'danger'
            }).then(function(confirmed) {
                if (!confirmed) return;

                var deleted = 0;
                var errors = 0;
                var idsToDelete = self.selectedIds.slice();

                function deleteNext(index) {
                    if (index >= idsToDelete.length) {
                        self.selectedIds = [];
                        if (deleted > 0) {
                            UI.toast('Deleted ' + deleted + ' document' + (deleted > 1 ? 's' : ''), 'success');
                        }
                        if (errors > 0) {
                            UI.toast(errors + ' document' + (errors > 1 ? 's' : '') + ' failed to delete', 'error');
                        }
                        self.loadData();
                        return;
                    }

                    API.delete('document', { id: idsToDelete[index] })
                        .then(function() {
                            deleted++;
                            deleteNext(index + 1);
                        })
                        .catch(function() {
                            errors++;
                            deleteNext(index + 1);
                        });
                }

                deleteNext(0);
            });
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
