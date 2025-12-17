/**
 * Flux Capture - Documents List View Controller
 * View and manage all captured documents with delete functionality
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

    var StatusLabels = {
        '1': 'Pending',
        '2': 'Processing',
        '3': 'Extracted',
        '4': 'Needs Review',
        '5': 'Rejected',
        '6': 'Completed',
        '7': 'Error'
    };

    var StatusClasses = {
        '1': 'pending',
        '2': 'processing',
        '3': 'extracted',
        '4': 'review',
        '5': 'rejected',
        '6': 'completed',
        '7': 'error'
    };

    var DocumentsController = {
        documents: [],
        filteredDocuments: [],
        selectedIds: [],
        currentFilter: '',
        searchQuery: '',
        batchFilter: '',
        page: 1,
        pageSize: 50,

        // ==========================================
        // INITIALIZATION
        // ==========================================
        init: function(params) {
            this.documents = [];
            this.filteredDocuments = [];
            this.selectedIds = [];
            this.currentFilter = '';
            this.searchQuery = '';
            this.batchFilter = (params && params.batch) ? params.batch : '';
            this.page = 1;

            renderTemplate('tpl-documents', 'view-container');
            this.bindEvents();
            this.loadData();

            // Update header if filtering by batch
            if (this.batchFilter) {
                var subtitle = el('.header-subtitle');
                if (subtitle) {
                    subtitle.innerHTML = 'Showing documents from batch #' + this.batchFilter +
                        ' <a href="#" id="clear-batch-filter" style="color:var(--color-primary);">Show all</a>';
                    var clearLink = el('#clear-batch-filter');
                    if (clearLink) {
                        clearLink.addEventListener('click', function(e) {
                            e.preventDefault();
                            Router.navigate('documents');
                        });
                    }
                }
            }
        },

        cleanup: function() {
            this.documents = [];
            this.filteredDocuments = [];
            this.selectedIds = [];
        },

        // ==========================================
        // DATA LOADING
        // ==========================================
        loadData: function() {
            var self = this;

            // Use list endpoint to get ALL documents (not just queue)
            var params = { pageSize: 200 };
            if (this.currentFilter) {
                params.status = this.currentFilter;
            }
            if (this.batchFilter) {
                params.batchId = this.batchFilter;
            }

            API.get('list', params)
                .then(function(data) {
                    self.documents = data || [];
                    self.applyFilters();
                    self.render();
                })
                .catch(function(err) {
                    console.error('[Documents] Load error:', err);
                    UI.toast('Failed to load documents: ' + err.message, 'error');
                });
        },

        applyFilters: function() {
            var self = this;
            var docs = this.documents;

            // Apply status filter
            if (this.currentFilter) {
                docs = docs.filter(function(d) {
                    return String(d.status) === self.currentFilter;
                });
            }

            // Apply search filter
            if (this.searchQuery) {
                var query = this.searchQuery.toLowerCase();
                docs = docs.filter(function(d) {
                    return (d.name && d.name.toLowerCase().indexOf(query) !== -1) ||
                           (d.vendorName && d.vendorName.toLowerCase().indexOf(query) !== -1) ||
                           (d.invoiceNumber && d.invoiceNumber.toLowerCase().indexOf(query) !== -1);
                });
            }

            this.filteredDocuments = docs;
        },

        // ==========================================
        // EVENT BINDING
        // ==========================================
        bindEvents: function() {
            var self = this;

            // Upload button
            this.on('#btn-upload-new', 'click', function() {
                Router.navigate('upload');
            });

            // Refresh button
            this.on('#btn-refresh', 'click', function() {
                self.loadData();
                UI.toast('Refreshed', 'success');
            });

            // Delete selected button
            this.on('#btn-delete-selected', 'click', function() {
                self.deleteSelected();
            });

            // Select all checkbox
            this.on('#select-all', 'change', function() {
                self.toggleSelectAll(this.checked);
            });

            // Search input
            var searchInput = el('#doc-search');
            if (searchInput) {
                var searchTimeout;
                searchInput.addEventListener('input', function() {
                    clearTimeout(searchTimeout);
                    var query = this.value;
                    searchTimeout = setTimeout(function() {
                        self.searchQuery = query;
                        self.applyFilters();
                        self.render();
                    }, 300);
                });
            }

            // Filter tabs (delegated)
            document.addEventListener('click', function(e) {
                var tab = e.target.closest('.filter-tab');
                if (tab && tab.closest('#status-filter')) {
                    els('#status-filter .filter-tab').forEach(function(t) {
                        t.classList.remove('active');
                    });
                    tab.classList.add('active');
                    self.currentFilter = tab.dataset.status || '';
                    self.applyFilters();
                    self.render();
                }

                // Row checkbox
                var checkbox = e.target.closest('.row-checkbox');
                if (checkbox) {
                    self.toggleSelection(checkbox.dataset.id, checkbox.checked);
                }

                // Row actions
                var actionBtn = e.target.closest('.action-btn');
                if (actionBtn) {
                    var docId = actionBtn.dataset.id;
                    var action = actionBtn.dataset.action;
                    self.handleAction(action, docId);
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
            var tbody = el('#documents-table-body');
            var emptyState = el('#empty-state');

            if (!tbody) return;

            if (this.filteredDocuments.length === 0) {
                tbody.innerHTML = '';
                if (emptyState) emptyState.style.display = 'block';
                return;
            }

            if (emptyState) emptyState.style.display = 'none';
            tbody.innerHTML = this.filteredDocuments.map(function(doc) {
                return this.renderRow(doc);
            }, this).join('');

            this.updateDeleteButton();
        },

        renderRow: function(doc) {
            var status = String(doc.status);
            var statusLabel = StatusLabels[status] || 'Unknown';
            var statusClass = StatusClasses[status] || '';
            var isSelected = this.selectedIds.indexOf(String(doc.id)) !== -1;
            var confidence = parseInt(doc.confidence) || 0;
            var confClass = confidence >= 85 ? 'high' : confidence >= 60 ? 'medium' : 'low';

            return '<tr class="' + (isSelected ? 'selected' : '') + '">' +
                '<td class="col-check">' +
                    '<input type="checkbox" class="row-checkbox" data-id="' + doc.id + '"' + (isSelected ? ' checked' : '') + '>' +
                '</td>' +
                '<td>' +
                    '<div class="doc-name">' + escapeHtml(doc.name || 'Document ' + doc.id) + '</div>' +
                    '<div class="doc-id text-muted">#' + doc.id + '</div>' +
                '</td>' +
                '<td>' + escapeHtml(doc.vendorName || '-') + '</td>' +
                '<td>' + escapeHtml(doc.invoiceNumber || '-') + '</td>' +
                '<td class="col-amount">$' + formatNumber(doc.totalAmount || 0) + '</td>' +
                '<td class="col-confidence">' +
                    '<div class="confidence-bar"><div class="confidence-fill conf-' + confClass + '" style="width:' + confidence + '%"></div></div>' +
                    '<span class="conf-text">' + confidence + '%</span>' +
                '</td>' +
                '<td class="col-status">' +
                    '<span class="status-badge status-' + statusClass + '">' + statusLabel + '</span>' +
                '</td>' +
                '<td>' + formatDate(doc.createdDate) + '</td>' +
                '<td class="col-actions">' +
                    '<button class="btn btn-ghost btn-icon btn-sm action-btn" data-id="' + doc.id + '" data-action="view" title="View">' +
                        '<i class="fas fa-eye"></i>' +
                    '</button>' +
                    '<button class="btn btn-ghost btn-icon btn-sm action-btn" data-id="' + doc.id + '" data-action="delete" title="Delete">' +
                        '<i class="fas fa-trash"></i>' +
                    '</button>' +
                '</td>' +
            '</tr>';
        },

        // ==========================================
        // SELECTION
        // ==========================================
        toggleSelectAll: function(checked) {
            var self = this;
            if (checked) {
                this.selectedIds = this.filteredDocuments.map(function(d) {
                    return String(d.id);
                });
            } else {
                this.selectedIds = [];
            }

            // Update all checkboxes
            els('.row-checkbox').forEach(function(cb) {
                cb.checked = checked;
            });

            // Update rows visual
            els('#documents-table-body tr').forEach(function(row) {
                row.classList.toggle('selected', checked);
            });

            this.updateDeleteButton();
        },

        toggleSelection: function(docId, checked) {
            var id = String(docId);
            var idx = this.selectedIds.indexOf(id);

            if (checked && idx === -1) {
                this.selectedIds.push(id);
            } else if (!checked && idx !== -1) {
                this.selectedIds.splice(idx, 1);
            }

            // Update row visual
            var row = document.querySelector('.row-checkbox[data-id="' + docId + '"]');
            if (row) {
                row.closest('tr').classList.toggle('selected', checked);
            }

            // Update select all checkbox
            var selectAll = el('#select-all');
            if (selectAll) {
                selectAll.checked = this.selectedIds.length === this.filteredDocuments.length;
            }

            this.updateDeleteButton();
        },

        updateDeleteButton: function() {
            var btn = el('#btn-delete-selected');
            if (btn) {
                btn.disabled = this.selectedIds.length === 0;
                var count = this.selectedIds.length;
                btn.innerHTML = '<i class="fas fa-trash"></i> Delete' + (count > 0 ? ' (' + count + ')' : ' Selected');
            }
        },

        // ==========================================
        // ACTIONS
        // ==========================================
        handleAction: function(action, docId) {
            switch (action) {
                case 'view':
                    Router.navigate('review', { docId: docId });
                    break;
                case 'delete':
                    this.confirmDelete([docId]);
                    break;
            }
        },

        deleteSelected: function() {
            if (this.selectedIds.length === 0) return;
            this.confirmDelete(this.selectedIds.slice());
        },

        confirmDelete: function(ids) {
            var self = this;
            var count = ids.length;
            var message = count === 1
                ? 'Are you sure you want to delete this document? This action cannot be undone.'
                : 'Are you sure you want to delete ' + count + ' documents? This action cannot be undone.';

            UI.confirm({
                title: 'Delete Document' + (count > 1 ? 's' : ''),
                message: message,
                confirmText: 'Delete',
                cancelText: 'Cancel',
                type: 'danger'
            }).then(function(confirmed) {
                if (confirmed) {
                    self.performDelete(ids);
                }
            });
        },

        performDelete: function(ids) {
            var self = this;
            var deleted = 0;
            var errors = 0;

            UI.toast('Deleting ' + ids.length + ' document(s)...', 'info');

            // Delete documents sequentially to avoid overwhelming the server
            function deleteNext(index) {
                if (index >= ids.length) {
                    // All done
                    if (errors === 0) {
                        UI.toast('Successfully deleted ' + deleted + ' document(s)', 'success');
                    } else {
                        UI.toast('Deleted ' + deleted + ' document(s), ' + errors + ' failed', 'warning');
                    }
                    self.selectedIds = [];
                    self.loadData();
                    return;
                }

                API.delete('document', { id: ids[index] })
                    .then(function() {
                        deleted++;
                        deleteNext(index + 1);
                    })
                    .catch(function(err) {
                        console.error('[Documents] Delete error:', err);
                        errors++;
                        deleteNext(index + 1);
                    });
            }

            deleteNext(0);
        }
    };

    // Helper functions
    function formatDate(dateStr) {
        if (!dateStr) return '-';
        try {
            var date = new Date(dateStr);
            return date.toLocaleDateString();
        } catch (e) {
            return dateStr;
        }
    }

    // Register the controller
    Router.register('documents',
        function(params) { DocumentsController.init(params); },
        function() { DocumentsController.cleanup(); }
    );

    console.log('[View.Documents] Loaded');

})();
