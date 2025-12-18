/**
 * Flux Capture - Mission Control Dashboard View
 * Dense metrics dashboard with velocity charts, queue composition,
 * anomaly radar, and activity stream
 */
(function() {
    'use strict';

    var DashboardController = {
        documents: [],
        refreshInterval: null,
        REFRESH_MS: 15000,
        stats: {
            toReview: 0,
            processing: 0,
            pendingAmount: 0,
            accuracy: 0,
            processedToday: 0,
            velocity: []
        },

        // ==========================================
        // INITIALIZATION
        // ==========================================
        init: function() {
            this.documents = [];
            this.stats = {
                toReview: 0,
                processing: 0,
                pendingAmount: 0,
                accuracy: 0,
                processedToday: 0,
                velocity: []
            };

            renderTemplate('tpl-dashboard', 'view-container');
            this.setGreeting();
            this.bindEvents();
            this.loadData();
            this.startRefresh();
        },

        cleanup: function() {
            this.stopRefresh();
            this.documents = [];
        },

        // ==========================================
        // DATA LOADING
        // ==========================================
        loadData: function() {
            var self = this;

            // Load queue data for metrics
            Promise.all([
                API.get('queue', { pageSize: 200 }),
                API.get('stats', {}).catch(function() { return {}; })
            ]).then(function(results) {
                var queueData = results[0] || {};
                var statsData = results[1] || {};

                self.documents = queueData.queue || [];
                self.processStats(statsData);
                self.render();

                // Update nav badges
                if (self.stats.toReview > 0) {
                    UI.updateBadge(self.stats.toReview);
                }
            }).catch(function(err) {
                console.error('[MissionControl] Load error:', err);
                self.render();
            });
        },

        processStats: function(statsData) {
            var docs = this.documents;

            // Count by status
            var toReview = 0;
            var processing = 0;
            var pendingAmount = 0;
            var totalConfidence = 0;
            var confCount = 0;
            var highConf = 0;
            var medConf = 0;
            var lowConf = 0;

            docs.forEach(function(d) {
                var status = String(d.status);
                var conf = parseInt(d.confidence) || 0;

                // Count review items (NEEDS_REVIEW, EXTRACTED, ERROR)
                if (status === '4' || status === '3' || status === '7') {
                    toReview++;
                    pendingAmount += parseFloat(d.totalAmount) || 0;

                    // Confidence buckets
                    if (conf >= 85) highConf++;
                    else if (conf >= 60) medConf++;
                    else lowConf++;

                    totalConfidence += conf;
                    confCount++;
                }

                // Count processing
                if (status === '2') {
                    processing++;
                }
            });

            this.stats = {
                toReview: toReview,
                processing: processing,
                pendingAmount: pendingAmount,
                accuracy: confCount > 0 ? Math.round(totalConfidence / confCount) : 0,
                processedToday: statsData.processedToday || 0,
                highConf: highConf,
                medConf: medConf,
                lowConf: lowConf,
                velocity: statsData.velocity || this.generateMockVelocity(),
                topVendors: this.calculateTopVendors(),
                anomalies: this.detectAnomalies()
            };
        },

        calculateTopVendors: function() {
            var vendorTotals = {};
            this.documents.forEach(function(d) {
                var vendor = d.vendorName || 'Unknown';
                var amount = parseFloat(d.totalAmount) || 0;
                if (!vendorTotals[vendor]) {
                    vendorTotals[vendor] = 0;
                }
                vendorTotals[vendor] += amount;
            });

            var vendors = Object.keys(vendorTotals).map(function(name) {
                return { name: name, total: vendorTotals[name] };
            });

            vendors.sort(function(a, b) { return b.total - a.total; });
            return vendors.slice(0, 5);
        },

        detectAnomalies: function() {
            var anomalies = [];
            var seen = {};

            this.documents.forEach(function(d) {
                // Check for errors
                if (String(d.status) === '7') {
                    anomalies.push({
                        type: 'error',
                        severity: 'high',
                        message: 'Processing error: ' + (d.vendorName || 'Unknown'),
                        docId: d.id
                    });
                }

                // Check for potential duplicates (same vendor + amount)
                var key = (d.vendorName || '') + '-' + (d.totalAmount || 0);
                if (seen[key]) {
                    anomalies.push({
                        type: 'duplicate',
                        severity: 'medium',
                        message: 'Potential duplicate: ' + (d.vendorName || 'Unknown') + ' $' + formatNumber(d.totalAmount),
                        docId: d.id
                    });
                }
                seen[key] = true;

                // Check for low confidence
                var conf = parseInt(d.confidence) || 0;
                if (conf < 50 && String(d.status) === '4') {
                    anomalies.push({
                        type: 'low-confidence',
                        severity: 'medium',
                        message: 'Low confidence (' + conf + '%): ' + (d.vendorName || 'Unknown'),
                        docId: d.id
                    });
                }

                // Check for anomalies from extraction
                if (d.anomalies && d.anomalies.length > 0) {
                    d.anomalies.forEach(function(a) {
                        anomalies.push({
                            type: 'extraction',
                            severity: a.severity || 'medium',
                            message: a.message,
                            docId: d.id
                        });
                    });
                }
            });

            return anomalies.slice(0, 10);
        },

        generateMockVelocity: function() {
            // Generate mock 24-hour velocity data
            var data = [];
            for (var i = 0; i < 24; i++) {
                data.push(Math.floor(Math.random() * 20));
            }
            return data;
        },

        startRefresh: function() {
            var self = this;
            this.stopRefresh();
            this.refreshInterval = setInterval(function() {
                self.loadData();
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

            this.on('#btn-go-to-flow', 'click', function() {
                Router.navigate('ingest');
            });

            this.on('#btn-view-anomalies', 'click', function() {
                Router.navigate('documents', { filter: 'flagged' });
            });

            // Click on anomaly item
            document.addEventListener('click', function(e) {
                var anomalyItem = e.target.closest('.anomaly-item');
                if (anomalyItem && anomalyItem.dataset.docId) {
                    Router.navigate('review', { docId: anomalyItem.dataset.docId });
                }

                var activityItem = e.target.closest('.activity-item');
                if (activityItem && activityItem.dataset.docId) {
                    Router.navigate('review', { docId: activityItem.dataset.docId });
                }

                var vendorItem = e.target.closest('.vendor-item');
                if (vendorItem && vendorItem.dataset.vendor) {
                    Router.navigate('documents', { search: vendorItem.dataset.vendor });
                }
            });
        },

        on: function(selector, event, handler) {
            var element = document.querySelector(selector);
            if (element) element.addEventListener(event, handler);
        },

        setGreeting: function() {
            var greetingEl = el('#mc-greeting');
            if (!greetingEl) return;

            var hour = new Date().getHours();
            var greeting = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';
            greetingEl.textContent = greeting;
        },

        // ==========================================
        // RENDERING
        // ==========================================
        render: function() {
            this.renderMetrics();
            this.renderVelocityChart();
            this.renderQueueComposition();
            this.renderTopVendors();
            this.renderAnomalies();
            this.renderActivityStream();
        },

        renderMetrics: function() {
            var s = this.stats;

            // To Review
            var toReviewEl = el('#metric-to-review');
            if (toReviewEl) toReviewEl.textContent = s.toReview;

            // Processing
            var processingEl = el('#metric-processing');
            if (processingEl) processingEl.textContent = s.processing;

            var etaEl = el('#metric-processing-eta');
            if (etaEl && s.processing > 0) {
                var eta = Math.ceil(s.processing * 0.5); // ~30 sec per doc
                etaEl.textContent = '~' + eta + ' min';
            } else if (etaEl) {
                etaEl.textContent = '';
            }

            // Pending Amount
            var pendingEl = el('#metric-pending-amount');
            if (pendingEl) pendingEl.textContent = '$' + formatNumber(s.pendingAmount);

            // AI Accuracy
            var accuracyEl = el('#metric-accuracy');
            if (accuracyEl) accuracyEl.textContent = s.accuracy + '%';
        },

        renderVelocityChart: function() {
            var container = el('#velocity-bars');
            if (!container) return;

            var velocity = this.stats.velocity || [];
            var max = Math.max.apply(null, velocity) || 1;

            var html = velocity.map(function(v, i) {
                var height = Math.round((v / max) * 100);
                var isNow = i === new Date().getHours();
                return '<div class="velocity-bar' + (isNow ? ' current' : '') + '" style="height:' + height + '%" title="' + v + ' docs"></div>';
            }).join('');

            container.innerHTML = html;

            // Stats
            var peak = Math.max.apply(null, velocity);
            var current = velocity[new Date().getHours()] || 0;
            var today = velocity.reduce(function(a, b) { return a + b; }, 0);

            var peakEl = el('#velocity-peak');
            var currentEl = el('#velocity-current');
            var todayEl = el('#velocity-today');

            if (peakEl) peakEl.textContent = peak + '/hr';
            if (currentEl) currentEl.textContent = current + '/hr';
            if (todayEl) todayEl.textContent = today;
        },

        renderQueueComposition: function() {
            var s = this.stats;
            var total = s.highConf + s.medConf + s.lowConf;
            if (total === 0) total = 1;

            var highPct = Math.round((s.highConf / total) * 100);
            var medPct = Math.round((s.medConf / total) * 100);
            var lowPct = Math.round((s.lowConf / total) * 100);

            var highBar = el('#comp-high');
            var medBar = el('#comp-medium');
            var lowBar = el('#comp-low');

            if (highBar) highBar.style.width = highPct + '%';
            if (medBar) medBar.style.width = medPct + '%';
            if (lowBar) lowBar.style.width = lowPct + '%';

            var highPctEl = el('#comp-high-pct');
            var medPctEl = el('#comp-medium-pct');
            var lowPctEl = el('#comp-low-pct');

            if (highPctEl) highPctEl.textContent = highPct + '%';
            if (medPctEl) medPctEl.textContent = medPct + '%';
            if (lowPctEl) lowPctEl.textContent = lowPct + '%';
        },

        renderTopVendors: function() {
            var container = el('#top-vendors');
            if (!container) return;

            var vendors = this.stats.topVendors || [];

            if (vendors.length === 0) {
                container.innerHTML = '<div class="empty-state-sm"><i class="fas fa-building"></i><span>No vendors yet</span></div>';
                return;
            }

            var html = vendors.map(function(v, i) {
                return '<div class="vendor-item" data-vendor="' + escapeHtml(v.name) + '">' +
                    '<span class="vendor-rank">' + (i + 1) + '</span>' +
                    '<span class="vendor-name">' + escapeHtml(v.name) + '</span>' +
                    '<span class="vendor-total">$' + formatNumber(v.total) + '</span>' +
                '</div>';
            }).join('');

            container.innerHTML = html;
        },

        renderAnomalies: function() {
            var container = el('#anomaly-list');
            var countEl = el('#anomaly-count');
            var btnEl = el('#btn-view-anomalies');

            if (!container) return;

            var anomalies = this.stats.anomalies || [];

            if (countEl) countEl.textContent = anomalies.length;

            if (anomalies.length === 0) {
                container.innerHTML = '<div class="empty-state-sm success"><i class="fas fa-check-circle"></i><span>No anomalies detected</span></div>';
                if (btnEl) btnEl.style.display = 'none';
                return;
            }

            if (btnEl) btnEl.style.display = 'block';

            var html = anomalies.slice(0, 5).map(function(a) {
                var icon = a.type === 'error' ? 'fa-exclamation-circle' :
                           a.type === 'duplicate' ? 'fa-copy' :
                           a.type === 'low-confidence' ? 'fa-question-circle' : 'fa-flag';
                return '<div class="anomaly-item anomaly-' + a.severity + '" data-doc-id="' + a.docId + '">' +
                    '<i class="fas ' + icon + '"></i>' +
                    '<span>' + escapeHtml(a.message) + '</span>' +
                '</div>';
            }).join('');

            container.innerHTML = html;
        },

        renderActivityStream: function() {
            var container = el('#activity-stream');
            if (!container) return;

            // Create activity from recent documents
            var activities = [];

            this.documents.slice(0, 10).forEach(function(d) {
                var status = String(d.status);
                var icon, action;

                if (status === '6') {
                    icon = 'fa-check';
                    action = 'Approved';
                } else if (status === '5') {
                    icon = 'fa-times';
                    action = 'Rejected';
                } else if (status === '3' || status === '4') {
                    icon = 'fa-bolt';
                    action = 'Extracted';
                } else if (status === '2') {
                    icon = 'fa-cog';
                    action = 'Processing';
                } else {
                    icon = 'fa-file';
                    action = 'Uploaded';
                }

                // Mock time
                var mins = Math.floor(Math.random() * 60);
                var time = mins === 0 ? 'Just now' : mins + 'm ago';

                activities.push({
                    icon: icon,
                    action: action,
                    vendor: d.vendorName || 'Unknown',
                    amount: d.totalAmount,
                    time: time,
                    docId: d.id
                });
            });

            if (activities.length === 0) {
                container.innerHTML = '<div class="empty-state-sm"><i class="fas fa-stream"></i><span>No recent activity</span></div>';
                return;
            }

            var html = activities.map(function(a) {
                return '<div class="activity-item" data-doc-id="' + a.docId + '">' +
                    '<span class="activity-icon"><i class="fas ' + a.icon + '"></i></span>' +
                    '<span class="activity-text">' + a.action + ' ' + escapeHtml(a.vendor) +
                        (a.amount ? ' <strong>$' + formatNumber(a.amount) + '</strong>' : '') +
                    '</span>' +
                    '<span class="activity-time">' + a.time + '</span>' +
                '</div>';
            }).join('');

            container.innerHTML = html;
        }
    };

    // Register the controller
    Router.register('dashboard',
        function(params) { DashboardController.init(params); },
        function() { DashboardController.cleanup(); }
    );

    console.log('[View.MissionControl] Loaded');

})();
