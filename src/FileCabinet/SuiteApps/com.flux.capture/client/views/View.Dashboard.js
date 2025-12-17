/**
 * Flux Capture - Dashboard View Controller
 */
(function() {
    'use strict';

    var DashboardController = {
        data: null,

        init: function() {
            // Render template
            renderTemplate('tpl-dashboard', 'view-container');

            // Bind events
            this.bindEvents();

            // Load data
            this.loadData();
        },

        bindEvents: function() {
            var self = this;

            // New Upload button
            var uploadBtn = el('#btn-new-upload');
            if (uploadBtn) {
                uploadBtn.addEventListener('click', function() {
                    Router.navigate('upload');
                });
            }
        },

        loadData: function() {
            var self = this;

            Promise.all([
                API.get('stats'),
                API.get('anomalies', { limit: 5 })
            ])
            .then(function(results) {
                var stats = results[0] || {};
                var anomalies = results[1] || [];

                self.data = {
                    summary: stats.summary || {},
                    anomalies: anomalies
                };

                self.render();

                // Update queue badge
                if (stats.summary && stats.summary.pendingReview) {
                    UI.updateBadge(stats.summary.pendingReview);
                }
            })
            .catch(function(err) {
                console.error('[Dashboard] Load error:', err);
                UI.toast('Failed to load dashboard data', 'error');
            });
        },

        render: function() {
            if (!this.data) return;

            this.renderKPIs();
            this.renderActivity();
            this.renderAlerts();
        },

        renderKPIs: function() {
            var container = el('#kpi-container');
            if (!container) return;

            var s = this.data.summary;

            container.innerHTML = [
                this.kpiCard('Total Processed', s.totalProcessed || 0, 'file-invoice', 'blue', 'All time'),
                this.kpiCard('Completed', s.completed || 0, 'check-double', 'green', 'Successfully processed'),
                this.kpiCard('Pending Review', s.pendingReview || 0, 'clock', 'amber', 'Requires attention', true),
                this.kpiCard('Total Value', '$' + formatCompact(s.totalValue || 0), 'sack-dollar', 'purple', 'Last 30 days')
            ].join('');

            // Bind click on pending review card
            var pendingCard = container.querySelector('.kpi-card.clickable');
            if (pendingCard) {
                pendingCard.addEventListener('click', function() {
                    Router.navigate('queue', { status: '4' });
                });
            }
        },

        kpiCard: function(label, value, icon, color, subtitle, clickable) {
            return '<div class="kpi-card kpi-' + color + (clickable ? ' clickable' : '') + '">' +
                '<div class="kpi-icon"><i class="fas fa-' + icon + '"></i></div>' +
                '<div class="kpi-content">' +
                    '<div class="kpi-value">' + value + '</div>' +
                    '<div class="kpi-label">' + label + '</div>' +
                    (subtitle ? '<div class="kpi-subtitle">' + subtitle + '</div>' : '') +
                '</div>' +
            '</div>';
        },

        renderActivity: function() {
            var container = el('#activity-container');
            if (!container) return;

            // For now, show empty state (no recent docs in data yet)
            container.innerHTML = '<div class="empty-state">' +
                '<div class="empty-icon"><i class="fas fa-inbox"></i></div>' +
                '<h4>No recent activity</h4>' +
                '<p>Upload documents to get started</p>' +
                '<button class="btn btn-primary" id="btn-activity-upload">Upload Documents</button>' +
            '</div>';

            var btn = el('#btn-activity-upload');
            if (btn) {
                btn.addEventListener('click', function() {
                    Router.navigate('upload');
                });
            }
        },

        renderAlerts: function() {
            var container = el('#alerts-container');
            var countEl = el('#alert-count');
            if (!container) return;

            var anomalies = this.data.anomalies || [];

            if (countEl) {
                countEl.textContent = anomalies.length;
                countEl.classList.toggle('has-alerts', anomalies.length > 0);
            }

            if (anomalies.length === 0) {
                container.innerHTML = '<div class="empty-state">' +
                    '<div class="empty-icon success"><i class="fas fa-shield-check"></i></div>' +
                    '<h4>All Clear</h4>' +
                    '<p>No anomalies detected</p>' +
                '</div>';
                return;
            }

            container.innerHTML = '<div class="alerts-list">' +
                anomalies.map(function(a) {
                    var severity = a.severity || 'medium';
                    return '<div class="alert-item alert-' + severity + '">' +
                        '<div class="alert-indicator"></div>' +
                        '<div class="alert-content">' +
                            '<div class="alert-message">' + escapeHtml(a.message) + '</div>' +
                            '<div class="alert-source">' + escapeHtml(a.vendorName || 'Document') + '</div>' +
                        '</div>' +
                        '<button class="btn btn-sm btn-ghost" data-doc-id="' + a.documentId + '">Review</button>' +
                    '</div>';
                }).join('') +
            '</div>';

            // Bind review buttons
            container.querySelectorAll('[data-doc-id]').forEach(function(btn) {
                btn.addEventListener('click', function() {
                    var docId = this.dataset.docId;
                    Router.navigate('review', { docId: docId });
                });
            });
        },

        cleanup: function() {
            this.data = null;
        }
    };

    // Register route
    Router.register('dashboard',
        function(params) { DashboardController.init(params); },
        function() { DashboardController.cleanup(); }
    );

    console.log('[View.Dashboard] Loaded');

})();
