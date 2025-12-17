/**
 * Flux Capture - Batch View Controller
 */
(function() {
    'use strict';

    var BatchController = {
        data: null,

        init: function() {
            renderTemplate('tpl-batch', 'view-container');
            this.loadData();
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
                        '<p>Batch processing will appear here</p>' +
                    '</div>' +
                '</td></tr>';
                return;
            }

            tbody.innerHTML = batches.map(function(b) {
                var progress = b.progress || 0;
                return '<tr>' +
                    '<td><strong>' + escapeHtml(b.name) + '</strong></td>' +
                    '<td>' + (b.processedCount || 0) + ' / ' + (b.documentCount || 0) + '</td>' +
                    '<td>' +
                        '<div style="width:100px;height:8px;background:var(--gray-200);border-radius:4px;overflow:hidden;">' +
                            '<div style="width:' + progress + '%;height:100%;background:var(--color-primary);border-radius:4px;"></div>' +
                        '</div>' +
                    '</td>' +
                    '<td><span class="status-pill">' + escapeHtml(b.statusText || 'Pending') + '</span></td>' +
                    '<td>' + formatDate(b.createdDate) + '</td>' +
                    '<td class="col-actions">' +
                        '<button class="btn btn-icon btn-ghost" data-batch="' + b.id + '" title="View Details">' +
                            '<i class="fas fa-eye"></i>' +
                        '</button>' +
                    '</td>' +
                '</tr>';
            }).join('');

            // Bind view buttons
            tbody.querySelectorAll('[data-batch]').forEach(function(btn) {
                btn.addEventListener('click', function() {
                    UI.toast('Batch details coming soon', 'info');
                });
            });
        },

        cleanup: function() {
            this.data = null;
        }
    };

    Router.register('batch',
        function(params) { BatchController.init(params); },
        function() { BatchController.cleanup(); }
    );

    console.log('[View.Batch] Loaded');

})();
