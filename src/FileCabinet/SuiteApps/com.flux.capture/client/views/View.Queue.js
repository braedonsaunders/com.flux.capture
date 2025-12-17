/**
 * Flux Capture - Queue View Controller
 */
(function() {
    'use strict';

    var QueueController = {
        data: null,
        params: {},
        autoRefreshInterval: null,
        autoRefreshEnabled: true,
        REFRESH_INTERVAL: 10000, // 10 seconds

        init: function(params) {
            this.params = params || {};
            renderTemplate('tpl-queue', 'view-container');
            this.bindEvents();
            this.loadData();
            this.startAutoRefresh();
        },

        bindEvents: function() {
            var self = this;

            // Upload button
            var uploadBtn = el('#btn-upload-new');
            if (uploadBtn) {
                uploadBtn.addEventListener('click', function() {
                    Router.navigate('upload');
                });
            }

            // Refresh button
            var refreshBtn = el('#btn-refresh');
            if (refreshBtn) {
                refreshBtn.addEventListener('click', function() {
                    self.loadData();
                    UI.toast('Queue refreshed', 'success');
                });
            }

            // Auto-refresh toggle
            var autoRefreshToggle = el('#auto-refresh-toggle');
            if (autoRefreshToggle) {
                autoRefreshToggle.checked = this.autoRefreshEnabled;
                autoRefreshToggle.addEventListener('change', function() {
                    self.autoRefreshEnabled = this.checked;
                    if (self.autoRefreshEnabled) {
                        self.startAutoRefresh();
                    } else {
                        self.stopAutoRefresh();
                    }
                });
            }

            // Filter tabs
            var filterTabs = el('#filter-tabs');
            if (filterTabs) {
                filterTabs.addEventListener('click', function(e) {
                    var tab = e.target.closest('.filter-tab');
                    if (tab) {
                        var status = tab.dataset.status;
                        self.params.status = status;
                        self.params.page = 1;

                        els('.filter-tab').forEach(function(t) { t.classList.remove('active'); });
                        tab.classList.add('active');

                        self.loadData();
                    }
                });
            }

            // Select all checkbox
            var selectAll = el('#select-all');
            if (selectAll) {
                selectAll.addEventListener('change', function() {
                    var checked = this.checked;
                    els('.doc-select').forEach(function(cb) {
                        cb.checked = checked;
                    });
                });
            }
        },

        loadData: function() {
            var self = this;
            var params = {
                page: this.params.page || 1,
                status: this.params.status || ''
            };

            API.get('queue', params)
                .then(function(data) {
                    self.data = data;
                    self.render();
                })
                .catch(function(err) {
                    console.error('[Queue] Load error:', err);
                    UI.toast('Failed to load queue', 'error');
                });
        },

        render: function() {
            if (!this.data) return;

            var totalEl = el('#queue-total');
            if (totalEl) {
                totalEl.textContent = this.data.total || 0;
            }

            this.renderTable();
            this.renderPagination();

            // Update filter tab active state
            var status = this.params.status || '';
            els('.filter-tab').forEach(function(tab) {
                tab.classList.toggle('active', tab.dataset.status === status);
            });
        },

        renderTable: function() {
            var self = this;
            var tbody = el('#queue-table-body');
            if (!tbody) return;

            var queue = this.data.queue || [];

            if (queue.length === 0) {
                tbody.innerHTML = '<tr><td colspan="8">' +
                    '<div class="empty-state">' +
                        '<div class="empty-icon"><i class="fas fa-inbox"></i></div>' +
                        '<h4>No documents found</h4>' +
                        '<p>Try adjusting your filters or upload new documents</p>' +
                    '</div>' +
                '</td></tr>';
                return;
            }

            tbody.innerHTML = queue.map(function(doc) {
                var statusClass = getStatusClass(doc.status);
                var statusLabel = getStatusLabel(doc.status);
                var confClass = getConfidenceClass(doc.confidence || 0);

                return '<tr class="' + (doc.hasAnomalies ? 'row-warning' : '') + '">' +
                    '<td class="col-check"><input type="checkbox" class="doc-select" value="' + doc.id + '"></td>' +
                    '<td class="col-doc"><span class="doc-name">' + escapeHtml(doc.name) + '</span></td>' +
                    '<td>' + escapeHtml(doc.vendorName || '-') + '</td>' +
                    '<td><code>' + escapeHtml(doc.invoiceNumber || '-') + '</code></td>' +
                    '<td class="col-amount"><strong>$' + formatNumber(doc.totalAmount || 0) + '</strong></td>' +
                    '<td class="col-confidence">' +
                        '<div class="confidence-indicator ' + confClass + '">' +
                            '<div class="confidence-bar"><div class="confidence-fill" style="width:' + (doc.confidence || 0) + '%"></div></div>' +
                            '<span>' + (doc.confidence || 0) + '%</span>' +
                        '</div>' +
                    '</td>' +
                    '<td class="col-status"><span class="status-pill status-' + statusClass + '">' + statusLabel + '</span></td>' +
                    '<td class="col-actions">' +
                        '<div style="display:flex;gap:4px;justify-content:flex-end;">' +
                            '<button class="btn btn-icon btn-ghost" data-review="' + doc.id + '" title="Review"><i class="fas fa-eye"></i></button>' +
                            '<button class="btn btn-icon btn-ghost" data-delete="' + doc.id + '" title="Delete" style="color:var(--color-danger)"><i class="fas fa-trash-can"></i></button>' +
                        '</div>' +
                    '</td>' +
                '</tr>';
            }).join('');

            // Bind action buttons
            tbody.querySelectorAll('[data-review]').forEach(function(btn) {
                btn.addEventListener('click', function() {
                    Router.navigate('review', { docId: this.dataset.review });
                });
            });

            tbody.querySelectorAll('[data-delete]').forEach(function(btn) {
                btn.addEventListener('click', function() {
                    var docId = this.dataset.delete;
                    UI.confirm({
                        title: 'Delete Document',
                        message: 'Are you sure you want to delete this document? This action cannot be undone.',
                        confirmText: 'Delete',
                        cancelText: 'Cancel',
                        type: 'danger'
                    }).then(function(confirmed) {
                        if (confirmed) {
                            self.deleteDocument(docId);
                        }
                    });
                });
            });
        },

        renderPagination: function() {
            var container = el('#pagination');
            if (!container) return;

            var total = this.data.total || 0;
            var page = parseInt(this.params.page) || 1;
            var pageSize = 25;
            var totalPages = Math.ceil(total / pageSize);

            if (totalPages <= 1) {
                container.innerHTML = '';
                return;
            }

            var self = this;
            container.innerHTML =
                '<button class="btn btn-icon btn-secondary" id="btn-prev" ' + (page <= 1 ? 'disabled' : '') + '><i class="fas fa-chevron-left"></i></button>' +
                '<span class="pagination-info">Page ' + page + ' of ' + totalPages + '</span>' +
                '<button class="btn btn-icon btn-secondary" id="btn-next" ' + (page >= totalPages ? 'disabled' : '') + '><i class="fas fa-chevron-right"></i></button>';

            el('#btn-prev').addEventListener('click', function() {
                if (page > 1) {
                    self.params.page = page - 1;
                    self.loadData();
                }
            });

            el('#btn-next').addEventListener('click', function() {
                if (page < totalPages) {
                    self.params.page = page + 1;
                    self.loadData();
                }
            });
        },

        deleteDocument: function(docId) {
            var self = this;
            API.delete('document', { id: docId })
                .then(function() {
                    UI.toast('Document deleted', 'success');
                    self.loadData();
                })
                .catch(function(err) {
                    UI.toast('Error: ' + err.message, 'error');
                });
        },

        // Auto-refresh methods
        startAutoRefresh: function() {
            var self = this;
            this.stopAutoRefresh(); // Clear any existing interval
            if (this.autoRefreshEnabled) {
                this.autoRefreshInterval = setInterval(function() {
                    self.loadData();
                }, this.REFRESH_INTERVAL);
            }
        },

        stopAutoRefresh: function() {
            if (this.autoRefreshInterval) {
                clearInterval(this.autoRefreshInterval);
                this.autoRefreshInterval = null;
            }
        },

        cleanup: function() {
            this.stopAutoRefresh();
            this.data = null;
            this.params = {};
        }
    };

    Router.register('queue',
        function(params) { QueueController.init(params); },
        function() { QueueController.cleanup(); }
    );

    console.log('[View.Queue] Loaded');

})();
