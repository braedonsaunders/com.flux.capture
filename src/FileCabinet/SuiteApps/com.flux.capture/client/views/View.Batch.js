/**
 * Flux Capture - Batch View Controller
 * View batches and their associated documents
 */
(function() {
    'use strict';

    var BatchController = {
        data: null,
        selectedBatch: null,

        init: function(params) {
            this.selectedBatch = null;
            renderTemplate('tpl-batch', 'view-container');
            this.bindEvents();
            this.loadData();
        },

        bindEvents: function() {
            var self = this;

            // Upload button
            this.on('#btn-new-batch', 'click', function() {
                Router.navigate('upload');
            });

            // Delegated event for batch actions
            document.addEventListener('click', function(e) {
                var viewBtn = e.target.closest('[data-view-batch]');
                if (viewBtn) {
                    var batchId = viewBtn.dataset.viewBatch;
                    self.viewBatchDocuments(batchId);
                }

                var deleteBtn = e.target.closest('[data-delete-batch]');
                if (deleteBtn) {
                    var batchId = deleteBtn.dataset.deleteBatch;
                    self.confirmDeleteBatch(batchId);
                }

                var docsBtn = e.target.closest('[data-batch-docs]');
                if (docsBtn) {
                    var batchId = docsBtn.dataset.batchDocs;
                    Router.navigate('documents', { batch: batchId });
                }
            });
        },

        on: function(selector, event, handler) {
            var element = document.querySelector(selector);
            if (element) element.addEventListener(event, handler);
        },

        loadData: function() {
            var self = this;

            API.get('batches')
                .then(function(data) {
                    self.data = data || [];
                    self.render();
                })
                .catch(function(err) {
                    console.error('[Batch] Load error:', err);
                    UI.toast('Failed to load batches', 'error');
                });
        },

        render: function() {
            var tbody = el('#batch-table-body');
            if (!tbody) return;

            var batches = this.data || [];

            if (batches.length === 0) {
                tbody.innerHTML = '<tr><td colspan="6">' +
                    '<div class="empty-state">' +
                        '<div class="empty-icon"><i class="fas fa-boxes-stacked"></i></div>' +
                        '<h4>No batches yet</h4>' +
                        '<p>Upload documents to create a batch</p>' +
                        '<button class="btn btn-primary" id="btn-upload-empty"><i class="fas fa-plus"></i> Upload Documents</button>' +
                    '</div>' +
                '</td></tr>';

                var uploadBtn = el('#btn-upload-empty');
                if (uploadBtn) {
                    uploadBtn.addEventListener('click', function() {
                        Router.navigate('upload');
                    });
                }
                return;
            }

            tbody.innerHTML = batches.map(function(b) {
                var progress = b.progress || 0;
                var statusClass = '';
                if (b.status === 'complete') statusClass = 'status-completed';
                else if (b.status === 'processing') statusClass = 'status-processing';
                else if (b.status === 'error') statusClass = 'status-error';
                else statusClass = 'status-pending';

                return '<tr>' +
                    '<td>' +
                        '<div class="batch-name"><strong>' + escapeHtml(b.name) + '</strong></div>' +
                        '<div class="batch-id text-muted">#' + b.id + '</div>' +
                    '</td>' +
                    '<td>' +
                        '<span class="doc-count">' + (b.processedCount || 0) + '</span>' +
                        '<span class="text-muted"> / ' + (b.documentCount || 0) + '</span>' +
                    '</td>' +
                    '<td>' +
                        '<div class="progress-bar-container">' +
                            '<div class="progress-bar-fill" style="width:' + progress + '%;"></div>' +
                        '</div>' +
                        '<span class="progress-text">' + progress + '%</span>' +
                    '</td>' +
                    '<td><span class="status-badge ' + statusClass + '">' + escapeHtml(b.statusText || 'Pending') + '</span></td>' +
                    '<td>' + formatDate(b.createdDate) + '</td>' +
                    '<td class="col-actions">' +
                        '<button class="btn btn-icon btn-ghost" data-batch-docs="' + b.id + '" title="View Documents">' +
                            '<i class="fas fa-folder-open"></i>' +
                        '</button>' +
                        '<button class="btn btn-icon btn-ghost btn-danger" data-delete-batch="' + b.id + '" title="Delete Batch">' +
                            '<i class="fas fa-trash"></i>' +
                        '</button>' +
                    '</td>' +
                '</tr>';
            }).join('');
        },

        viewBatchDocuments: function(batchId) {
            // Navigate to documents page filtered by this batch
            Router.navigate('documents', { batch: batchId });
        },

        confirmDeleteBatch: function(batchId) {
            var self = this;

            UI.confirm({
                title: 'Delete Batch',
                message: 'Are you sure you want to delete this batch and ALL its documents? This action cannot be undone.',
                confirmText: 'Delete',
                cancelText: 'Cancel',
                type: 'danger'
            }).then(function(confirmed) {
                if (confirmed) {
                    self.deleteBatch(batchId);
                }
            });
        },

        deleteBatch: function(batchId) {
            var self = this;

            API.delete('batch', { batchId: batchId })
                .then(function() {
                    UI.toast('Batch deleted', 'success');
                    self.loadData();
                })
                .catch(function(err) {
                    UI.toast('Error: ' + err.message, 'error');
                });
        },

        cleanup: function() {
            this.data = null;
            this.selectedBatch = null;
        }
    };

    Router.register('batch',
        function(params) { BatchController.init(params); },
        function() { BatchController.cleanup(); }
    );

    console.log('[View.Batch] Loaded');

})();
