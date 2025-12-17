/**
 * Flux Capture - Review View Controller
 */
(function() {
    'use strict';

    var ReviewController = {
        data: null,
        docId: null,
        changes: {},
        zoom: 1,

        init: function(params) {
            this.docId = params.docId;
            this.changes = {};
            this.zoom = 1;

            renderTemplate('tpl-review', 'view-container');
            this.bindEvents();

            if (this.docId) {
                this.loadData();
            } else {
                this.showError('No document ID provided');
            }
        },

        bindEvents: function() {
            var self = this;

            // Back button
            var backBtn = el('#btn-back');
            if (backBtn) {
                backBtn.addEventListener('click', function() {
                    Router.navigate('queue');
                });
            }

            // Approve button
            var approveBtn = el('#btn-approve');
            if (approveBtn) {
                approveBtn.addEventListener('click', function() {
                    self.approveDocument();
                });
            }

            // Reject button
            var rejectBtn = el('#btn-reject');
            if (rejectBtn) {
                rejectBtn.addEventListener('click', function() {
                    self.rejectDocument();
                });
            }

            // Zoom controls
            var zoomIn = el('#btn-zoom-in');
            var zoomOut = el('#btn-zoom-out');
            if (zoomIn) {
                zoomIn.addEventListener('click', function() {
                    self.setZoom(self.zoom + 0.25);
                });
            }
            if (zoomOut) {
                zoomOut.addEventListener('click', function() {
                    self.setZoom(self.zoom - 0.25);
                });
            }

            // Download button
            var downloadBtn = el('#btn-download');
            if (downloadBtn) {
                downloadBtn.addEventListener('click', function() {
                    if (self.data && self.data.sourceFile) {
                        window.open('/core/media/media.nl?id=' + self.data.sourceFile, '_blank');
                    }
                });
            }
        },

        loadData: function() {
            var self = this;

            API.get('document', { id: this.docId })
                .then(function(data) {
                    self.data = data;
                    self.render();
                })
                .catch(function(err) {
                    console.error('[Review] Load error:', err);
                    self.showError(err.message);
                });
        },

        render: function() {
            if (!this.data) return;

            var doc = this.data;

            // Update toolbar
            var titleEl = el('#doc-title');
            var badgeEl = el('#doc-type-badge');
            if (titleEl) titleEl.textContent = doc.invoiceNumber || 'Document Review';
            if (badgeEl) badgeEl.textContent = doc.documentTypeText || 'Document';

            // Render preview
            this.renderPreview();

            // Render extraction form
            this.renderExtractionForm();
        },

        renderPreview: function() {
            var viewport = el('#preview-viewport');
            if (!viewport) return;

            if (this.data.fileUrl) {
                viewport.innerHTML = '<iframe src="' + this.data.fileUrl + '" id="doc-preview" style="width:100%;height:100%;border:none;background:white;"></iframe>';
            } else {
                viewport.innerHTML = '<div class="empty-state" style="color:var(--text-inverse)">' +
                    '<div class="empty-icon"><i class="fas fa-file-image"></i></div>' +
                    '<h4>Preview not available</h4>' +
                '</div>';
            }
        },

        renderExtractionForm: function() {
            var self = this;
            var panel = el('#extraction-panel');
            if (!panel) return;

            var doc = this.data;
            var confClass = getConfidenceClass(doc.confidence || 0);
            var anomalies = doc.anomalies || [];

            var html = '';

            // Confidence header
            html += '<div class="form-section">' +
                '<div style="display:flex;align-items:center;gap:16px;padding:16px;background:var(--gray-50);border-radius:8px;margin-bottom:16px;">' +
                    '<div style="width:60px;height:60px;position:relative;">' +
                        '<svg viewBox="0 0 36 36" style="width:100%;height:100%">' +
                            '<circle cx="18" cy="18" r="15.5" fill="none" stroke="var(--gray-200)" stroke-width="3"/>' +
                            '<circle cx="18" cy="18" r="15.5" fill="none" stroke="var(--color-' + (confClass === 'high' ? 'success' : confClass === 'medium' ? 'warning' : 'danger') + ')" stroke-width="3" stroke-dasharray="' + (doc.confidence || 0) + ' 100" transform="rotate(-90 18 18)"/>' +
                        '</svg>' +
                        '<div style="position:absolute;inset:0;display:flex;align-items:center;justify-content:center;font-weight:700;font-size:14px;">' + (doc.confidence || 0) + '</div>' +
                    '</div>' +
                    '<div>' +
                        '<div style="font-weight:600;">' + (confClass === 'high' ? 'High' : confClass === 'medium' ? 'Medium' : 'Low') + ' Confidence</div>' +
                        '<div style="font-size:12px;color:var(--text-secondary);">AI extraction accuracy</div>' +
                    '</div>' +
                '</div>' +
            '</div>';

            // Anomalies
            if (anomalies.length > 0) {
                html += '<div class="form-section">' +
                    anomalies.map(function(a) {
                        return '<div style="display:flex;align-items:center;gap:8px;padding:10px;background:var(--color-warning-bg);border-radius:6px;margin-bottom:8px;">' +
                            '<i class="fas fa-triangle-exclamation" style="color:var(--color-warning)"></i>' +
                            '<span style="font-size:13px;">' + escapeHtml(a.message) + '</span>' +
                        '</div>';
                    }).join('') +
                '</div>';
            }

            // Vendor info
            html += '<div class="form-section">' +
                '<h4>Vendor Information</h4>' +
                '<div class="form-field">' +
                    '<label>Vendor Name</label>' +
                    '<input type="text" id="field-vendor" value="' + escapeHtml(doc.vendorName || '') + '">' +
                '</div>' +
            '</div>';

            // Invoice details
            html += '<div class="form-section">' +
                '<h4>Invoice Details</h4>' +
                '<div class="form-row">' +
                    '<div class="form-field">' +
                        '<label>Invoice Number</label>' +
                        '<input type="text" id="field-invoiceNumber" value="' + escapeHtml(doc.invoiceNumber || '') + '">' +
                    '</div>' +
                    '<div class="form-field">' +
                        '<label>Invoice Date</label>' +
                        '<input type="date" id="field-invoiceDate" value="' + formatDateInput(doc.invoiceDate) + '">' +
                    '</div>' +
                '</div>' +
                '<div class="form-row">' +
                    '<div class="form-field">' +
                        '<label>Due Date</label>' +
                        '<input type="date" id="field-dueDate" value="' + formatDateInput(doc.dueDate) + '">' +
                    '</div>' +
                    '<div class="form-field">' +
                        '<label>PO Number</label>' +
                        '<input type="text" id="field-poNumber" value="' + escapeHtml(doc.poNumber || '') + '">' +
                    '</div>' +
                '</div>' +
            '</div>';

            // Amounts
            html += '<div class="form-section">' +
                '<h4>Amounts</h4>' +
                '<div class="form-row">' +
                    '<div class="form-field">' +
                        '<label>Subtotal</label>' +
                        '<input type="number" step="0.01" id="field-subtotal" value="' + (doc.subtotal || 0) + '">' +
                    '</div>' +
                    '<div class="form-field">' +
                        '<label>Tax</label>' +
                        '<input type="number" step="0.01" id="field-taxAmount" value="' + (doc.taxAmount || 0) + '">' +
                    '</div>' +
                '</div>' +
                '<div class="form-field">' +
                    '<label>Total Amount</label>' +
                    '<input type="number" step="0.01" id="field-totalAmount" value="' + (doc.totalAmount || 0) + '" style="font-weight:600;font-size:18px;">' +
                '</div>' +
            '</div>';

            panel.innerHTML = html;

            // Bind change tracking
            panel.querySelectorAll('input').forEach(function(input) {
                input.addEventListener('change', function() {
                    var field = this.id.replace('field-', '');
                    self.changes[field] = this.value;
                });
            });

            // Auto-calculate total
            var subtotalEl = el('#field-subtotal');
            var taxEl = el('#field-taxAmount');
            var totalEl = el('#field-totalAmount');
            if (subtotalEl && taxEl && totalEl) {
                var calcTotal = function() {
                    var subtotal = parseFloat(subtotalEl.value) || 0;
                    var tax = parseFloat(taxEl.value) || 0;
                    totalEl.value = (subtotal + tax).toFixed(2);
                    self.changes.totalAmount = totalEl.value;
                };
                subtotalEl.addEventListener('input', calcTotal);
                taxEl.addEventListener('input', calcTotal);
            }
        },

        setZoom: function(level) {
            this.zoom = Math.max(0.5, Math.min(3, level));
            var iframe = el('#doc-preview');
            if (iframe) {
                iframe.style.transform = 'scale(' + this.zoom + ')';
                iframe.style.transformOrigin = 'top left';
            }
        },

        approveDocument: function() {
            var self = this;
            if (!confirm('Create transaction from this document?')) return;

            // Save any pending changes first
            var savePromise = Object.keys(this.changes).length > 0
                ? API.put('update', { documentId: this.docId, updates: this.changes })
                : Promise.resolve();

            savePromise
                .then(function() {
                    return API.put('approve', { documentId: self.docId, createTransaction: true });
                })
                .then(function() {
                    UI.toast('Document approved!', 'success');
                    Router.navigate('queue');
                })
                .catch(function(err) {
                    UI.toast('Error: ' + err.message, 'error');
                });
        },

        rejectDocument: function() {
            var self = this;
            var reason = prompt('Reason for rejection:');
            if (!reason) return;

            API.put('reject', { documentId: this.docId, reason: reason })
                .then(function() {
                    UI.toast('Document rejected', 'success');
                    Router.navigate('queue');
                })
                .catch(function(err) {
                    UI.toast('Error: ' + err.message, 'error');
                });
        },

        showError: function(message) {
            var container = el('#view-container');
            if (container) {
                container.innerHTML = '<div class="empty-state" style="padding-top:100px;">' +
                    '<div class="empty-icon error"><i class="fas fa-file-circle-question"></i></div>' +
                    '<h4>Document not found</h4>' +
                    '<p>' + escapeHtml(message) + '</p>' +
                    '<button class="btn btn-primary" id="btn-back-error">Back to Queue</button>' +
                '</div>';

                el('#btn-back-error').addEventListener('click', function() {
                    Router.navigate('queue');
                });
            }
        },

        cleanup: function() {
            this.data = null;
            this.docId = null;
            this.changes = {};
            this.zoom = 1;
        }
    };

    Router.register('review',
        function(params) { ReviewController.init(params); },
        function() { ReviewController.cleanup(); }
    );

    console.log('[View.Review] Loaded');

})();
