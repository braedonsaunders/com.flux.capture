/**
 * Flux Capture - World-Class Review View Controller
 * Premium document review experience with keyboard shortcuts,
 * vendor search, editable line items, and batch navigation
 */
(function() {
    'use strict';

    // ==========================================
    // KEYBOARD SHORTCUTS CONFIGURATION
    // ==========================================
    var SHORTCUTS = {
        'Tab': { action: 'nextField', description: 'Next field' },
        'Shift+Tab': { action: 'prevField', description: 'Previous field' },
        'KeyA': { action: 'approve', description: 'Approve & next' },
        'KeyR': { action: 'reject', description: 'Reject document' },
        'KeyS': { action: 'skip', description: 'Skip to next' },
        'Escape': { action: 'back', description: 'Back to documents' },
        'ArrowRight': { action: 'nextDoc', description: 'Next document' },
        'ArrowLeft': { action: 'prevDoc', description: 'Previous document' },
        'Slash': { action: 'help', description: 'Show shortcuts' },
        'Equal': { action: 'zoomIn', description: 'Zoom in' },
        'Minus': { action: 'zoomOut', description: 'Zoom out' },
        'Digit0': { action: 'zoomReset', description: 'Reset zoom', ctrl: true }
    };

    // ==========================================
    // SHARED QUEUE STATE (persists across navigation)
    // ==========================================
    var sharedQueueState = {
        queueIds: [],
        lastFetch: 0
    };

    // ==========================================
    // REVIEW CONTROLLER
    // ==========================================
    var ReviewController = {
        data: null,
        docId: null,
        changes: {},
        zoom: 1,
        rotation: 0,
        currentPage: 1,
        totalPages: 1,
        lineItems: [],
        vendorSuggestions: [],
        queueIds: [],
        queueIndex: -1,
        isLoading: false,
        isSaving: false,
        fieldConfidences: {},
        formFields: null, // Dynamic form fields from NetSuite
        transactionType: 'vendorbill', // Default transaction type
        typeaheadTimeout: null, // Debounce timeout for typeahead search

        // ==========================================
        // INITIALIZATION
        // ==========================================
        init: function(params) {
            var self = this;
            this.docId = params && params.docId ? params.docId : null;
            this.changes = {};
            this.zoom = 1;
            this.rotation = 0;
            this.currentPage = 1;
            this.lineItems = [];
            this.formFields = null;
            this.isLoading = true;

            // Restore shared queue state if available (prevents flicker on navigation)
            if (sharedQueueState.queueIds.length > 0) {
                this.queueIds = sharedQueueState.queueIds;
                this.queueIndex = this.docId ? this.queueIds.indexOf(parseInt(this.docId, 10)) : 0;
            }

            if (this.docId) {
                // Navigating to specific doc - render full template immediately
                renderTemplate('tpl-review', 'view-container');
                this.bindEvents();
                this.bindKeyboardShortcuts();

                // Show skeleton state in position indicator until queue loads
                this.showPositionSkeleton();

                // Load queue context for prev/next navigation, then load document
                this.loadQueueContext();
                this.loadData();
            } else {
                // No docId - show centered loading first, then determine what to show
                this.showCenteredLoading();
                this.loadFirstDocument();
            }
        },

        showCenteredLoading: function() {
            var container = el('#view-container');
            if (container) {
                container.innerHTML = '<div class="review-loading-state">' +
                    '<div class="loading-spinner-lg"></div>' +
                    '<p>Loading review queue...</p>' +
                '</div>';
            }
        },

        showPositionSkeleton: function() {
            // If we already have queue data from shared state, update immediately
            if (this.queueIndex >= 0 && this.queueIds.length > 0) {
                var currentEl = el('#position-current');
                var totalEl = el('#position-total');
                if (currentEl) currentEl.textContent = this.queueIndex + 1;
                if (totalEl) totalEl.textContent = this.queueIds.length;
            }
        },

        loadFirstDocument: function() {
            var self = this;

            // Load documents needing review and start with the first one
            API.get('list', { status: '4', pageSize: 100 }) // NEEDS_REVIEW
                .then(function(data) {
                    if (data && data.length > 0) {
                        self.queueIds = data.map(function(d) { return d.id; });
                        // Update shared state
                        sharedQueueState.queueIds = self.queueIds;
                        sharedQueueState.lastFetch = Date.now();

                        self.docId = self.queueIds[0];
                        self.queueIndex = 0;

                        // NOW render the full template and load data
                        renderTemplate('tpl-review', 'view-container');
                        self.bindEvents();
                        self.bindKeyboardShortcuts();
                        self.updateNavigationButtons();
                        self.loadData();

                        // Animate the view in
                        var reviewEl = el('.view-review');
                        if (reviewEl) {
                            reviewEl.classList.add('animate-in');
                        }
                    } else {
                        // No documents to review - show empty state with animation
                        self.showNoDocumentsState();
                    }
                })
                .catch(function(err) {
                    console.error('[Review] Load error:', err);
                    self.showError('Failed to load documents: ' + err.message);
                });
        },

        showNoDocumentsState: function() {
            var container = el('#view-container');
            if (container) {
                container.innerHTML = '<div class="review-empty-state animate-in">' +
                    '<div class="empty-celebration">' +
                        '<div class="celebration-icon">' +
                            '<i class="fas fa-check-circle"></i>' +
                            '<div class="celebration-rings">' +
                                '<div class="ring"></div>' +
                                '<div class="ring"></div>' +
                                '<div class="ring"></div>' +
                            '</div>' +
                        '</div>' +
                        '<h2>All Caught Up!</h2>' +
                        '<p>No documents need review right now.</p>' +
                        '<button class="btn btn-primary btn-lg" id="btn-go-documents">' +
                            '<i class="fas fa-inbox"></i> Go to Documents' +
                        '</button>' +
                    '</div>' +
                '</div>';

                var btn = el('#btn-go-documents');
                if (btn) {
                    btn.addEventListener('click', function() {
                        Router.navigate('documents');
                    });
                }
            }
        },

        // ==========================================
        // DATA LOADING
        // ==========================================
        loadData: function() {
            var self = this;
            this.isLoading = true;
            this.showLoadingState();

            // Load document, form schema, accounts, and items in parallel
            // Using formschema for complete tab/group/field structure
            Promise.all([
                API.get('document', { id: this.docId }),
                API.get('formschema', { transactionType: this.transactionType }),
                API.get('accounts', { accountType: 'Expense' }),
                API.get('items', {})
            ])
                .then(function(results) {
                    var data = results[0];
                    var formSchemaData = results[1];
                    var accountsData = results[2] || [];
                    var itemsData = results[3] || [];

                    self.data = data;
                    self.lineItems = data.lineItems || [];
                    self.fieldConfidences = data.fieldConfidences || {};
                    self.totalPages = data.pageCount || 1;
                    self.formFields = formSchemaData; // Now contains layout, config, etc.

                    // Inject accounts into expense sublist 'account' field
                    // Inject items into item sublist 'item' field
                    self.injectSublistOptions(accountsData, itemsData);

                    self.isLoading = false;
                    self.render();
                })
                .catch(function(err) {
                    console.error('[Review] Load error:', err);
                    self.isLoading = false;
                    self.showError(err.message);
                });
        },

        loadQueueContext: function() {
            var self = this;
            // Load list of documents for prev/next navigation
            API.get('list', { status: '4', pageSize: 100 }) // NEEDS_REVIEW
                .then(function(data) {
                    if (data && data.length > 0) {
                        self.queueIds = data.map(function(d) { return d.id; });
                        self.queueIndex = self.queueIds.indexOf(parseInt(self.docId, 10));

                        // Update shared state for future navigations
                        sharedQueueState.queueIds = self.queueIds;
                        sharedQueueState.lastFetch = Date.now();

                        self.updateNavigationButtons();
                    }
                })
                .catch(function() {
                    // Silent fail - navigation just won't work
                });
        },

        /**
         * Inject accounts and items into sublist field definitions
         * This makes the account and item fields render as dropdowns
         */
        injectSublistOptions: function(accountsData, itemsData) {
            if (!this.formFields || !this.formFields.sublists) return;

            var sublists = this.formFields.sublists;

            sublists.forEach(function(sublist) {
                if (!sublist.fields) return;

                sublist.fields.forEach(function(field) {
                    // Inject accounts into 'account' field on expense sublist
                    if (field.id === 'account' && sublist.id === 'expense' && accountsData.length > 0) {
                        field.type = 'select';
                        field.options = accountsData;
                    }

                    // Inject items into 'item' field on item sublist
                    if (field.id === 'item' && sublist.id === 'item' && itemsData.length > 0) {
                        field.type = 'select';
                        field.options = itemsData;
                    }
                });
            });
        },

        // ==========================================
        // EVENT BINDING
        // ==========================================
        bindEvents: function() {
            var self = this;

            // Back button
            this.on('#btn-back', 'click', function() {
                self.navigateBack();
            });

            // Approve button
            this.on('#btn-approve', 'click', function() {
                self.approveDocument();
            });

            // Reject button
            this.on('#btn-reject', 'click', function() {
                self.rejectDocument();
            });

            // Skip button
            this.on('#btn-skip', 'click', function() {
                self.skipDocument();
            });

            // Save button
            this.on('#btn-save', 'click', function() {
                self.saveChanges();
            });

            // Zoom controls
            this.on('#btn-zoom-in', 'click', function() {
                self.setZoom(self.zoom + 0.25);
            });

            this.on('#btn-zoom-out', 'click', function() {
                self.setZoom(self.zoom - 0.25);
            });

            this.on('#btn-zoom-reset', 'click', function() {
                self.setZoom(1);
            });

            // Rotate controls
            this.on('#btn-rotate', 'click', function() {
                self.rotate();
            });

            // Page navigation
            this.on('#btn-page-prev', 'click', function() {
                self.goToPage(self.currentPage - 1);
            });

            this.on('#btn-page-next', 'click', function() {
                self.goToPage(self.currentPage + 1);
            });

            // Document navigation
            this.on('#btn-doc-prev', 'click', function() {
                self.goToPrevDocument();
            });

            this.on('#btn-doc-next', 'click', function() {
                self.goToNextDocument();
            });

            // Download button
            this.on('#btn-download', 'click', function() {
                if (self.data && self.data.sourceFile) {
                    window.open('/core/media/media.nl?id=' + self.data.sourceFile, '_blank');
                }
            });

            // Show shortcuts help
            this.on('#btn-shortcuts', 'click', function() {
                self.showShortcutsHelp();
            });

            // Panel resizer
            this.initPanelResizer();
        },

        // Preserve resizer width after layout changes (tab switches, etc.)
        preserveResizerWidth: function() {
            var previewPanel = el('#preview-panel');
            var container = el('#review-content');
            if (!previewPanel || !container) return;

            try {
                var savedWidth = localStorage.getItem('fc_preview_width_px');
                if (savedWidth) {
                    var widthPx = parseInt(savedWidth, 10);
                    var containerWidth = container.offsetWidth;
                    // Constrain to valid range
                    widthPx = Math.max(250, Math.min(containerWidth * 0.7, widthPx));
                    // Use flex shorthand: flex-grow: 0, flex-shrink: 0, flex-basis: width
                    previewPanel.style.flex = '0 0 ' + widthPx + 'px';
                    previewPanel.style.width = ''; // Clear any explicit width
                }
            } catch (e) { /* ignore */ }
        },

        initPanelResizer: function() {
            var resizer = el('#panel-resizer');
            var previewPanel = el('#preview-panel');
            var container = el('#review-content');
            var previewViewport = el('#preview-viewport');

            if (!resizer || !previewPanel || !container) return;

            var isResizing = false;
            var startX, startWidth;

            // Create overlay to prevent iframe from stealing events
            var overlay = document.createElement('div');
            overlay.id = 'resize-overlay';
            overlay.style.cssText = 'position:fixed;top:0;left:0;right:0;bottom:0;z-index:9999;cursor:col-resize;display:none;';
            document.body.appendChild(overlay);

            function startResize(e) {
                isResizing = true;
                startX = e.clientX;
                startWidth = previewPanel.offsetWidth;
                resizer.classList.add('dragging');
                overlay.style.display = 'block';
                document.body.style.cursor = 'col-resize';
                document.body.style.userSelect = 'none';
                if (previewViewport) previewViewport.style.pointerEvents = 'none';
                e.preventDefault();
            }

            function doResize(e) {
                if (!isResizing) return;
                e.preventDefault();

                var containerWidth = container.offsetWidth;
                var newWidth = startWidth + (e.clientX - startX);

                // Constrain between 250px and 70% of container
                var minWidth = 250;
                var maxWidth = containerWidth * 0.7;
                newWidth = Math.max(minWidth, Math.min(maxWidth, newWidth));

                // Use flex shorthand for consistent sizing
                previewPanel.style.flex = '0 0 ' + newWidth + 'px';
                previewPanel.style.width = ''; // Clear any explicit width
            }

            function stopResize() {
                if (!isResizing) return;
                isResizing = false;
                resizer.classList.remove('dragging');
                overlay.style.display = 'none';
                document.body.style.cursor = '';
                document.body.style.userSelect = '';
                if (previewViewport) previewViewport.style.pointerEvents = '';

                // Save pixel width to localStorage
                try {
                    var currentWidth = previewPanel.offsetWidth;
                    localStorage.setItem('fc_preview_width_px', currentWidth);
                } catch (e) { /* ignore */ }
            }

            // Mouse events
            resizer.addEventListener('mousedown', startResize);
            document.addEventListener('mousemove', doResize);
            document.addEventListener('mouseup', stopResize);
            overlay.addEventListener('mousemove', doResize);
            overlay.addEventListener('mouseup', stopResize);

            // Set initial width - use saved pixel width or default to 40% of container
            try {
                var containerWidth = container.offsetWidth;
                var savedWidthPx = localStorage.getItem('fc_preview_width_px');
                var widthToUse;

                if (savedWidthPx) {
                    widthToUse = parseInt(savedWidthPx, 10);
                } else {
                    // Default to 40% of container
                    widthToUse = Math.round(containerWidth * 0.4);
                }

                // Ensure width is within reasonable bounds
                var minWidth = 250;
                var maxWidth = Math.round(containerWidth * 0.7);
                widthToUse = Math.max(minWidth, Math.min(maxWidth, widthToUse));

                // Use flex shorthand for consistent sizing
                previewPanel.style.flex = '0 0 ' + widthToUse + 'px';
                previewPanel.style.width = ''; // Clear any explicit width
            } catch (e) {
                // Fallback to default 40%
                previewPanel.style.flex = '0 0 40%';
            }
        },

        on: function(selector, event, handler) {
            var el = document.querySelector(selector);
            if (el) {
                el.addEventListener(event, handler);
            }
        },

        bindKeyboardShortcuts: function() {
            var self = this;

            document.addEventListener('keydown', function(e) {
                // Don't trigger shortcuts when typing in inputs
                if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.tagName === 'SELECT') {
                    // Allow specific shortcuts even in inputs
                    if (e.key === 'Escape') {
                        e.target.blur();
                        return;
                    }
                    // Ctrl+S to save even in inputs
                    if ((e.ctrlKey || e.metaKey) && e.key === 's') {
                        e.preventDefault();
                        self.saveChanges();
                        return;
                    }
                    return;
                }

                var key = e.code || e.key;

                // Handle ? for help (Shift+/)
                if ((e.key === '?' || (e.shiftKey && key === 'Slash'))) {
                    e.preventDefault();
                    self.showShortcutsHelp();
                    return;
                }

                var shortcut = SHORTCUTS[key];
                if (!shortcut) return;

                // Check modifier requirements
                if (shortcut.ctrl && !e.ctrlKey && !e.metaKey) return;

                // Don't trigger action shortcuts if ctrl is pressed (except for zoom reset)
                if (e.ctrlKey && !shortcut.ctrl && key !== 'Digit0') {
                    return;
                }

                e.preventDefault();

                switch (shortcut.action) {
                    case 'nextField': self.focusNextField(1); break;
                    case 'prevField': self.focusNextField(-1); break;
                    case 'approve': self.approveDocument(); break;
                    case 'reject': self.rejectDocument(); break;
                    case 'skip': self.skipDocument(); break;
                    case 'back': self.navigateBack(); break;
                    case 'nextDoc': self.goToNextDocument(); break;
                    case 'prevDoc': self.goToPrevDocument(); break;
                    case 'help': self.showShortcutsHelp(); break;
                    case 'zoomIn': self.setZoom(self.zoom + 0.25); break;
                    case 'zoomOut': self.setZoom(self.zoom - 0.25); break;
                    case 'zoomReset': self.setZoom(1); break;
                }
            });
        },

        // ==========================================
        // RENDERING
        // ==========================================
        render: function() {
            if (!this.data) return;

            // Update toolbar
            this.renderToolbar();

            // Render document preview
            this.renderPreview();

            // Render extraction form
            this.renderExtractionForm();

            // Update Apply All button visibility based on available suggestions
            this.updateApplyAllButton();

            // Update navigation buttons
            this.updateNavigationButtons();

            // Focus first field
            setTimeout(function() {
                var firstInput = document.querySelector('.extraction-panel input:not([type="hidden"])');
                if (firstInput) firstInput.focus();
            }, 100);
        },

        showLoadingState: function() {
            var panel = el('#extraction-panel');
            if (panel) {
                panel.innerHTML = '<div style="display:flex;align-items:center;justify-content:center;height:300px;">' +
                    '<div class="spinner"></div>' +
                    '</div>';
            }
        },

        renderToolbar: function() {
            var doc = this.data;

            // Update title and badge
            var titleEl = el('#doc-title');
            var badgeEl = el('#doc-type-badge');
            if (titleEl) titleEl.textContent = doc.invoiceNumber || doc.name || 'Document Review';
            if (badgeEl) badgeEl.textContent = doc.documentTypeText || 'Invoice';

            // Update queue position indicator
            var positionEl = el('#queue-position');
            var currentEl = el('#position-current');
            var totalEl = el('#position-total');

            if (positionEl && this.queueIndex >= 0 && this.queueIds.length > 0) {
                if (currentEl) currentEl.textContent = this.queueIndex + 1;
                if (totalEl) totalEl.textContent = this.queueIds.length;
                positionEl.style.display = 'flex';
            } else if (positionEl) {
                positionEl.style.display = 'none';
            }

            // Update progress bar
            this.updateProgressBar();
        },

        updateProgressBar: function() {
            var progressBar = el('#review-progress-bar');
            var progressFill = el('#review-progress-fill');

            if (!progressBar || !progressFill) return;

            if (this.queueIds.length > 0 && this.queueIndex >= 0) {
                var progress = ((this.queueIndex + 1) / this.queueIds.length) * 100;
                progressFill.style.width = progress + '%';
                progressBar.style.display = 'block';
            } else {
                progressBar.style.display = 'none';
            }
        },

        renderPreview: function() {
            var self = this;
            var viewport = el('#preview-viewport');
            if (!viewport) return;

            if (this.data.fileUrl) {
                var iframeStyle = 'width:100%;height:100%;border:none;background:white;' +
                    'transform:scale(' + this.zoom + ') rotate(' + this.rotation + 'deg);' +
                    'transform-origin:center center;';

                viewport.innerHTML = '<iframe src="' + this.data.fileUrl + '" id="doc-preview" style="' + iframeStyle + '"></iframe>';
            } else if (this.data.sourceFile) {
                var fileUrl = '/core/media/media.nl?id=' + this.data.sourceFile;
                var iframeStyle = 'width:100%;height:100%;border:none;background:white;' +
                    'transform:scale(' + this.zoom + ') rotate(' + this.rotation + 'deg);' +
                    'transform-origin:center center;';

                viewport.innerHTML = '<iframe src="' + fileUrl + '" id="doc-preview" style="' + iframeStyle + '"></iframe>';
            } else {
                viewport.innerHTML = '<div class="empty-state" style="color:var(--text-inverse);padding:60px;">' +
                    '<div class="empty-icon"><i class="fas fa-file-image"></i></div>' +
                    '<h4>Preview not available</h4>' +
                    '<p>The document file could not be loaded</p>' +
                    '</div>';
            }

            // Update zoom display
            var zoomDisplay = el('#zoom-level');
            if (zoomDisplay) {
                zoomDisplay.textContent = Math.round(this.zoom * 100) + '%';
            }

            // Update page display
            var pageDisplay = el('#page-display');
            if (pageDisplay) {
                pageDisplay.textContent = this.currentPage + ' / ' + this.totalPages;
            }
        },

        renderExtractionForm: function() {
            var self = this;
            var panel = el('#extraction-panel');
            if (!panel) return;

            var doc = this.data;
            var confClass = getConfidenceClass(doc.confidence || 0);
            var anomalies = doc.anomalies || [];
            var formFields = this.formFields || {};
            var bodyFields = formFields.bodyFields || [];
            var sublists = formFields.sublists || [];
            var layout = formFields.layout || {};
            // Tabs can be at formFields.tabs (user config from XML) or layout.tabs (cached layout)
            var tabs = formFields.tabs || layout.tabs || [];
            var config = formFields.config || {};
            var layoutSublists = layout.sublists || [];

            // Merge column order from layout.sublists into schema sublists
            // The layout.sublists contain visibleColumns/columnOrder from DOM extraction
            if (layoutSublists.length > 0) {
                sublists.forEach(function(sl) {
                    var layoutSl = layoutSublists.find(function(lsl) { return lsl.id === sl.id; });
                    if (layoutSl) {
                        // Copy column order info from DOM extraction
                        if (layoutSl.visibleColumns && layoutSl.visibleColumns.length > 0) {
                            sl.visibleColumns = layoutSl.visibleColumns;
                            sl.columnOrder = layoutSl.columnOrder || layoutSl.visibleColumns;
                            console.log('[View.Review] Merged column order for', sl.id, ':', sl.columnOrder.join(', '));
                        }
                    }
                });
            }

            // Get column limit from config (default 10)
            this.sublistColumnLimit = config.sublistColumnLimit || 10;

            var html = '';

            // ========== CONFIDENCE HEADER ==========
            html += '<div class="form-section confidence-section">' +
                '<div class="confidence-header">' +
                    '<div class="confidence-gauge">' +
                        '<svg viewBox="0 0 36 36" class="gauge-svg">' +
                            '<circle cx="18" cy="18" r="15.5" fill="none" stroke="var(--gray-200)" stroke-width="3"/>' +
                            '<circle cx="18" cy="18" r="15.5" fill="none" stroke="var(--color-' + (confClass === 'high' ? 'success' : confClass === 'medium' ? 'warning' : 'danger') + ')" stroke-width="3" stroke-dasharray="' + (doc.confidence || 0) + ' 100" transform="rotate(-90 18 18)"/>' +
                        '</svg>' +
                        '<div class="gauge-value">' + (doc.confidence || 0) + '</div>' +
                    '</div>' +
                    '<div class="confidence-info">' +
                        '<div class="confidence-level ' + confClass + '">' + (confClass === 'high' ? 'High' : confClass === 'medium' ? 'Medium' : 'Low') + ' Confidence</div>' +
                        '<div class="confidence-subtitle">AI extraction accuracy</div>' +
                    '</div>' +
                    '<button class="btn btn-primary btn-sm" id="btn-apply-all-suggestions" style="display:none;" title="Apply all AI suggestions">' +
                        '<i class="fas fa-magic"></i> Apply All' +
                    '</button>' +
                    '<button class="btn btn-ghost btn-sm" id="btn-shortcuts" title="Keyboard Shortcuts">' +
                        '<i class="fas fa-keyboard"></i>' +
                    '</button>' +
                '</div>' +
            '</div>';

            // ========== ANOMALY ALERTS ==========
            if (anomalies.length > 0) {
                html += '<div class="form-section anomaly-section">' +
                    '<div class="anomaly-header"><i class="fas fa-triangle-exclamation"></i> ' + anomalies.length + ' Alert' + (anomalies.length > 1 ? 's' : '') + '</div>' +
                    anomalies.map(function(a) {
                        return '<div class="anomaly-item anomaly-' + a.severity + '">' +
                            '<i class="fas fa-' + (a.severity === 'high' ? 'exclamation-circle' : 'info-circle') + '"></i>' +
                            '<span>' + escapeHtml(a.message) + '</span>' +
                        '</div>';
                    }).join('') +
                '</div>';
            }

            // ========== VENDOR SECTION (entity field with search) ==========
            html += '<div class="form-section">' +
                '<h4><i class="fas fa-building"></i> Vendor</h4>' +
                '<div class="form-field vendor-field">' +
                    '<label>Vendor Name ' + this.renderConfidenceBadge('vendorName') + (this.isFieldMandatory('entity', bodyFields) ? ' <span class="required">*</span>' : '') + '</label>' +
                    '<div class="vendor-search-wrapper">' +
                        '<input type="text" id="field-vendor" class="vendor-input" value="' + escapeHtml(doc.vendorName || '') + '" placeholder="Search or enter vendor name..." autocomplete="off">' +
                        '<div class="vendor-dropdown" id="vendor-dropdown" style="display:none;"></div>' +
                    '</div>' +
                    (doc.vendorId ? '<input type="hidden" id="field-vendorId" value="' + doc.vendorId + '">' : '') +
                    (doc.vendorMatchConfidence ? '<div class="field-match-info"><i class="fas fa-check-circle"></i> Matched with ' + Math.round(doc.vendorMatchConfidence * 100) + '% confidence</div>' : '') +
                '</div>' +
            '</div>';

            // ========== RENDER FORM CONTENT ==========
            // If we have tabs (from user config/XML or cached layout), use tabs/groups
            // Otherwise, render all fields in a flat list

            var hasLayout = tabs && tabs.length > 0;

            if (hasLayout) {
                // ========== RENDER WITH LAYOUT (tabs/groups from user config or DOM extraction) ==========
                var visibleTabs = tabs.filter(function(tab) {
                    var hasGroups = tab.fieldGroups && tab.fieldGroups.some(function(g) {
                        return g.fields && g.fields.some(function(fieldRef) {
                            // Handle both field ID strings and field objects
                            var fieldId = typeof fieldRef === 'object' ? fieldRef.id : fieldRef;
                            var domField = typeof fieldRef === 'object' ? fieldRef : null;

                            // Check schema
                            var field = bodyFields.find(function(f) { return f.id === fieldId; });
                            if (field && field.isDisplay !== false) return true;

                            // Or if DOM says it's visible
                            if (domField && domField.mode !== 'hidden') return true;

                            return false;
                        });
                    });
                    var hasSublists = tab.sublists && tab.sublists.length > 0;
                    return hasGroups || hasSublists;
                });

                // Render tab navigation if multiple tabs
                if (visibleTabs.length > 1) {
                    html += '<div class="form-tabs" id="form-tabs">';
                    visibleTabs.forEach(function(tab, idx) {
                        html += '<button class="form-tab' + (idx === 0 ? ' active' : '') + '" data-tab="' + tab.id + '">' +
                            escapeHtml(tab.label) +
                        '</button>';
                    });
                    html += '</div>';
                }

                // Render tab content panels
                visibleTabs.forEach(function(tab, tabIdx) {
                    var isActiveTab = tabIdx === 0;
                    html += '<div class="form-tab-content' + (isActiveTab ? ' active' : '') + '" data-tab-content="' + tab.id + '">';

                    // Render field groups within this tab
                    if (tab.fieldGroups && tab.fieldGroups.length > 0) {
                        tab.fieldGroups.forEach(function(group) {
                            var groupFields = [];
                            (group.fields || []).forEach(function(fieldRef) {
                                // Handle both field ID strings and field objects from DOM extraction
                                var fieldId = typeof fieldRef === 'object' ? fieldRef.id : fieldRef;
                                var normalizedFieldId = (fieldId || '').toLowerCase();

                                // Skip vendor/entity field - it's rendered specially at the top
                                if (normalizedFieldId === 'entity' || normalizedFieldId === 'vendor') return;

                                // First check if DOM extraction gave us field metadata
                                var domField = typeof fieldRef === 'object' ? fieldRef : null;

                                // Look up in schema bodyFields for full field definition
                                var nsField = bodyFields.find(function(f) { return f.id === fieldId; });

                                if (nsField && nsField.isDisplay !== false) {
                                    // Merge DOM extraction data into schema field
                                    if (domField) {
                                        nsField.label = domField.label || nsField.label;
                                        nsField.type = domField.type || nsField.type;
                                        nsField.mandatory = domField.required || nsField.mandatory;
                                        nsField.isDisplay = domField.mode !== 'hidden';
                                    }
                                    groupFields.push(nsField);
                                } else if (domField && domField.mode !== 'hidden') {
                                    // Field not in schema but visible in DOM - use DOM data
                                    groupFields.push({
                                        id: fieldId,
                                        label: domField.label || fieldId,
                                        type: domField.type || 'text',
                                        mandatory: domField.required || false,
                                        isDisplay: true
                                    });
                                }
                            });

                            if (groupFields.length === 0) return;

                            var icon = self.getGroupIcon(group.id);
                            html += '<div class="form-section field-group" data-group="' + group.id + '">' +
                                '<h4 class="group-header">' +
                                    '<i class="fas ' + icon + '"></i> ' + escapeHtml(group.label) +
                                    '<button class="btn btn-ghost btn-icon btn-xs group-toggle" title="Toggle section">' +
                                        '<i class="fas fa-chevron-up"></i>' +
                                    '</button>' +
                                '</h4>' +
                                '<div class="group-content"><div class="form-grid">';

                            for (var i = 0; i < groupFields.length; i += 2) {
                                html += '<div class="form-row">';
                                html += self.renderNsField(groupFields[i], doc);
                                if (groupFields[i + 1]) {
                                    html += self.renderNsField(groupFields[i + 1], doc);
                                }
                                html += '</div>';
                            }
                            html += '</div></div></div>';
                        });
                    }

                    // Render sublists in this tab
                    // Include orphan sublists (from schema but not in layout) in the first tab
                    var tabSublists = sublists.filter(function(sl) {
                        return (tab.sublists || []).indexOf(sl.id) !== -1;
                    });

                    // For the first tab, also add any sublists from schema that aren't in any tab's layout
                    if (tabIdx === 0) {
                        var allLayoutSublistIds = [];
                        visibleTabs.forEach(function(t) {
                            (t.sublists || []).forEach(function(slId) {
                                if (allLayoutSublistIds.indexOf(slId) === -1) {
                                    allLayoutSublistIds.push(slId);
                                }
                            });
                        });

                        var orphanSublists = sublists.filter(function(sl) {
                            return allLayoutSublistIds.indexOf(sl.id) === -1;
                        });

                        if (orphanSublists.length > 0) {
                            console.log('[View.Review] Adding orphan sublists to first tab:', orphanSublists.map(function(s) { return s.id; }));
                            tabSublists = tabSublists.concat(orphanSublists);
                        }
                    }

                    if (tabSublists.length > 0) {
                        html += self.renderSublists(tabSublists, doc);
                    }

                    html += '</div>'; // close tab content
                });
            } else {
                // ========== NO LAYOUT - Render all fields flat ==========
                // Show notice about missing layout
                var transactionLabel = this.transactionType === 'vendorbill' ? 'Vendor Bill' :
                    this.transactionType === 'expensereport' ? 'Expense Report' :
                    this.transactionType === 'purchaseorder' ? 'Purchase Order' :
                    this.transactionType;

                html += '<div class="layout-notice">' +
                    '<div class="notice-icon"><i class="fas fa-info-circle"></i></div>' +
                    '<div class="notice-content">' +
                        '<strong>Form layout not yet captured</strong>' +
                        '<p>To display fields grouped by tabs as they appear in NetSuite, open any ' + transactionLabel + ' in NetSuite. ' +
                        'The layout will be captured automatically and used for all future documents of this type.</p>' +
                    '</div>' +
                '</div>';

                // Filter visible body fields (exclude entity - handled above)
                var visibleFields = bodyFields.filter(function(f) {
                    return f.id !== 'entity' && f.isDisplay !== false;
                });

                // Sort by displayOrder
                visibleFields.sort(function(a, b) {
                    return (a.displayOrder || 0) - (b.displayOrder || 0);
                });

                // Separate standard fields from custom fields
                var standardFields = visibleFields.filter(function(f) { return !f.isCustom; });
                var customFields = visibleFields.filter(function(f) { return f.isCustom; });

                // Render standard fields section
                if (standardFields.length > 0) {
                    html += '<div class="form-section field-group" data-group="standard">' +
                        '<h4 class="group-header">' +
                            '<i class="fas fa-file-invoice"></i> Transaction Details' +
                            '<button class="btn btn-ghost btn-icon btn-xs group-toggle" title="Toggle section">' +
                                '<i class="fas fa-chevron-up"></i>' +
                            '</button>' +
                        '</h4>' +
                        '<div class="group-content"><div class="form-grid">';

                    for (var i = 0; i < standardFields.length; i += 2) {
                        html += '<div class="form-row">';
                        html += self.renderNsField(standardFields[i], doc);
                        if (standardFields[i + 1]) {
                            html += self.renderNsField(standardFields[i + 1], doc);
                        }
                        html += '</div>';
                    }
                    html += '</div></div></div>';
                }

                // Render custom fields section
                if (customFields.length > 0) {
                    html += '<div class="form-section field-group" data-group="custom">' +
                        '<h4 class="group-header">' +
                            '<i class="fas fa-puzzle-piece"></i> Custom Fields' +
                            '<button class="btn btn-ghost btn-icon btn-xs group-toggle" title="Toggle section">' +
                                '<i class="fas fa-chevron-up"></i>' +
                            '</button>' +
                        '</h4>' +
                        '<div class="group-content"><div class="form-grid">';

                    for (var j = 0; j < customFields.length; j += 2) {
                        html += '<div class="form-row">';
                        html += self.renderNsField(customFields[j], doc);
                        if (customFields[j + 1]) {
                            html += self.renderNsField(customFields[j + 1], doc);
                        }
                        html += '</div>';
                    }
                    html += '</div></div></div>';
                }

                // Render all sublists
                if (sublists.length > 0) {
                    html += self.renderSublists(sublists, doc);
                }
            }


            // ========== AMOUNTS (Always visible) ==========
            html += '<div class="form-section amounts-section">' +
                '<h4><i class="fas fa-calculator"></i> Amounts</h4>' +
                '<div class="form-row">' +
                    '<div class="form-field">' +
                        '<label>Subtotal ' + this.renderConfidenceBadge('subtotal') + '</label>' +
                        '<div class="input-with-prefix">' +
                            '<span class="input-prefix">$</span>' +
                            '<input type="number" step="0.01" id="field-subtotal" value="' + (doc.subtotal || 0).toFixed(2) + '">' +
                        '</div>' +
                    '</div>' +
                    '<div class="form-field">' +
                        '<label>Tax ' + this.renderConfidenceBadge('taxAmount') + '</label>' +
                        '<div class="input-with-prefix">' +
                            '<span class="input-prefix">$</span>' +
                            '<input type="number" step="0.01" id="field-taxAmount" value="' + (doc.taxAmount || 0).toFixed(2) + '">' +
                        '</div>' +
                    '</div>' +
                '</div>' +
                '<div class="form-field total-field">' +
                    '<label>Total Amount ' + this.renderConfidenceBadge('totalAmount') + '</label>' +
                    '<div class="input-with-prefix total-input">' +
                        '<span class="input-prefix">$</span>' +
                        '<input type="number" step="0.01" id="field-totalAmount" value="' + (doc.totalAmount || 0).toFixed(2) + '">' +
                    '</div>' +
                '</div>' +
            '</div>';

            // ========== ACTION BUTTONS ==========
            html += '<div class="form-section action-section">' +
                '<button class="btn btn-secondary btn-block" id="btn-save">' +
                    '<i class="fas fa-save"></i> Save Changes <span class="shortcut-hint">Ctrl+S</span>' +
                '</button>' +
            '</div>';

            panel.innerHTML = html;

            // Initialize line items data structure for each sublist
            this.initSublistData(sublists);

            // Update tab counts
            this.updateTabCounts();

            // ========== BIND FORM EVENTS ==========
            this.bindFormEvents();
            this.bindTabEvents();
        },

        // Get icon for a field group
        getGroupIcon: function(groupId) {
            var icons = {
                'primary': 'fa-file-invoice',
                'classification': 'fa-tags',
                'reference': 'fa-link',
                'accounting': 'fa-credit-card',
                'address': 'fa-map-marker-alt',
                'billing': 'fa-file-invoice-dollar',
                'shipping': 'fa-truck',
                'custom': 'fa-cog',
                'systemnotes': 'fa-info-circle',
                'standard': 'fa-file-invoice',
                'other': 'fa-ellipsis-h'
            };
            return icons[groupId] || 'fa-folder';
        },

        // Render sublists section
        renderSublists: function(sublistsToRender, doc) {
            var self = this;
            var html = '<div class="form-section line-section">' +
                '<h4><i class="fas fa-list"></i> Line Items</h4>';

            // Render sublist tabs if multiple
            if (sublistsToRender.length > 1) {
                html += '<div class="sublist-tabs" id="sublist-tabs-main">';
                sublistsToRender.forEach(function(sl, idx) {
                    var icon = sl.id === 'expense' ? 'receipt' : 'box';
                    html += '<button class="sublist-tab' + (idx === 0 ? ' active' : '') + '" data-sublist="' + sl.id + '">' +
                        '<i class="fas fa-' + icon + '"></i> ' +
                        escapeHtml(sl.label) +
                        '<span class="tab-count" id="count-' + sl.id + '">0</span>' +
                    '</button>';
                });
                html += '</div>';
            }

            // Render each sublist container
            sublistsToRender.forEach(function(sl, idx) {
                var isActive = idx === 0;
                var slType = sl.id === 'expense' ? 'expense' : 'item';
                html += '<div class="sublist-container' + (isActive ? ' active' : '') + '" id="sublist-' + sl.id + '" data-sublist-id="' + sl.id + '">' +
                    '<div class="sublist-toolbar">' +
                        '<button class="btn btn-ghost btn-sm btn-add-line" data-sublist="' + sl.id + '">' +
                            '<i class="fas fa-plus"></i> Add ' + escapeHtml(sl.label.replace(/s$/, '')) +
                        '</button>' +
                    '</div>' +
                    '<div class="line-items-table" id="lines-' + sl.id + '">' +
                        self.renderSublistTable(sl, doc) +
                    '</div>' +
                '</div>';
            });

            html += '</div>';
            return html;
        },

        // Bind tab navigation events
        bindTabEvents: function() {
            var self = this;

            // Form tab navigation
            var formTabs = el('#form-tabs');
            if (formTabs) {
                formTabs.addEventListener('click', function(e) {
                    var tabBtn = e.target.closest('.form-tab');
                    if (!tabBtn) return;

                    var tabId = tabBtn.getAttribute('data-tab');

                    // Update active tab button
                    formTabs.querySelectorAll('.form-tab').forEach(function(t) {
                        t.classList.remove('active');
                    });
                    tabBtn.classList.add('active');

                    // Show corresponding content
                    document.querySelectorAll('.form-tab-content').forEach(function(content) {
                        content.classList.toggle('active', content.getAttribute('data-tab-content') === tabId);
                    });

                    // Preserve resizer width after tab switch
                    self.preserveResizerWidth();
                });
            }

            // Field group collapse/expand
            document.querySelectorAll('.group-toggle').forEach(function(btn) {
                btn.addEventListener('click', function(e) {
                    e.preventDefault();
                    var section = btn.closest('.field-group');
                    if (section) {
                        section.classList.toggle('collapsed');
                        var icon = btn.querySelector('i');
                        if (icon) {
                            icon.classList.toggle('fa-chevron-up');
                            icon.classList.toggle('fa-chevron-down');
                        }
                    }
                });
            });
        },

        // Get field value from extractedData or document fields
        // Handles field mapping, case-insensitive matching, and custom field syntax
        getExtractedFieldValue: function(nsFieldId, docKey, doc, extractedData) {
            var normalizedId = (nsFieldId || '').toLowerCase();

            // First check extractedData (contains all AI-extracted fields)
            if (extractedData) {
                // Direct match
                if (extractedData[nsFieldId] !== undefined) return extractedData[nsFieldId];
                if (extractedData[normalizedId] !== undefined) return extractedData[normalizedId];
                if (extractedData[docKey] !== undefined) return extractedData[docKey];

                // Try lowercase docKey
                var lowerDocKey = (docKey || '').toLowerCase();
                if (extractedData[lowerDocKey] !== undefined) return extractedData[lowerDocKey];

                // Handle custom field syntax [scriptid=custbody_xxx]
                if (nsFieldId.indexOf('[scriptid=') !== -1) {
                    var match = nsFieldId.match(/\[scriptid=([^\]]+)\]/);
                    if (match) {
                        var scriptId = match[1];
                        if (extractedData[scriptId] !== undefined) return extractedData[scriptId];
                    }
                }
            }

            // Fall back to document's fixed fields
            if (doc[docKey] !== undefined) return doc[docKey];
            if (doc[normalizedId] !== undefined) return doc[normalizedId];
            if (doc[nsFieldId] !== undefined) return doc[nsFieldId];

            return '';
        },

        // Find AI-extracted suggestion for a field based on label similarity
        getFieldSuggestion: function(nsFieldId, fieldLabel, extractedData) {
            if (!extractedData || !extractedData._allExtractedFields) return null;

            var allFields = extractedData._allExtractedFields;
            var normalizedLabel = (fieldLabel || '').toLowerCase().replace(/[^a-z0-9]/g, '');
            var normalizedId = (nsFieldId || '').toLowerCase().replace(/[^a-z0-9]/g, '');

            // Direct key match
            if (allFields[normalizedLabel]) {
                return allFields[normalizedLabel];
            }
            if (allFields[normalizedId]) {
                return allFields[normalizedId];
            }

            // Fuzzy match - find similar labels
            var bestMatch = null;
            var bestScore = 0;
            Object.keys(allFields).forEach(function(key) {
                var field = allFields[key];
                var extractedLabel = (field.label || '').toLowerCase().replace(/[^a-z0-9]/g, '');

                // Check for partial matches
                var score = 0;
                if (extractedLabel.indexOf(normalizedLabel) !== -1 || normalizedLabel.indexOf(extractedLabel) !== -1) {
                    score = 0.7;
                }
                if (extractedLabel.indexOf(normalizedId) !== -1 || normalizedId.indexOf(extractedLabel) !== -1) {
                    score = Math.max(score, 0.6);
                }

                if (score > bestScore && score >= 0.6) {
                    bestScore = score;
                    bestMatch = field;
                }
            });

            return bestMatch;
        },

        // Render a NetSuite field directly
        renderNsField: function(nsField, doc) {
            var fieldId = 'field-' + nsField.id;
            var label = nsField.label || nsField.id;
            var isRequired = nsField.mandatory;

            // Map NS field IDs to document data keys
            var fieldMapping = {
                'tranid': 'invoiceNumber',
                'trandate': 'invoiceDate',
                'duedate': 'dueDate',
                'terms': 'paymentTerms',
                'account': 'apAccount',
                'exchangerate': 'exchangeRate'
            };
            var docKey = fieldMapping[nsField.id.toLowerCase()] || nsField.id;

            // Get value - check extractedData first (contains all AI-extracted fields)
            // then fall back to fixed document fields
            var extractedData = doc.extractedData || {};
            var value = this.getExtractedFieldValue(nsField.id, docKey, doc, extractedData);

            // Check for AI suggestion if field is empty
            var suggestion = null;
            if (!value && extractedData._allExtractedFields) {
                suggestion = this.getFieldSuggestion(nsField.id, label, extractedData);
            }

            var html = '<div class="form-field' + (suggestion ? ' has-suggestion' : '') + '">' +
                '<label>' + escapeHtml(label) + ' ' + this.renderConfidenceBadge(docKey) +
                (isRequired ? ' <span class="required">*</span>' : '') + '</label>';

            // Build suggestion button HTML if we have a suggestion
            var suggestionHtml = '';
            if (suggestion && suggestion.value) {
                var displayVal = String(suggestion.value).length > 30 ?
                    String(suggestion.value).substring(0, 30) + '...' :
                    String(suggestion.value);
                var confidence = suggestion.confidence ? Math.round(suggestion.confidence * 100) : 0;
                suggestionHtml = '<button type="button" class="btn-suggestion" ' +
                    'data-field="' + nsField.id + '" ' +
                    'data-value="' + escapeHtml(suggestion.value) + '" ' +
                    'title="AI extracted: ' + escapeHtml(suggestion.label || '') + ' (' + confidence + '% confidence)">' +
                    '<i class="fas fa-magic"></i> Use: "' + escapeHtml(displayVal) + '"' +
                '</button>';
            }

            // Check if field should be disabled (readonly or inline mode)
            var isDisabled = nsField.isDisabled || nsField.isReadonly || nsField.mode === 'inline' ||
                             nsField.displayType === 'DISABLED' || nsField.displayType === 'INLINETEXT';

            // Determine if this is a select field (by type or by known field ID)
            var isSelectType = nsField.type === 'select' || this.isSelectField(nsField.id);

            if (isSelectType && nsField.options && nsField.options.length > 0) {
                // Select with pre-loaded options - render dropdown
                html += '<select id="' + fieldId + '" class="ns-field-select" data-field="' + nsField.id + '"' + (isDisabled ? ' disabled' : '') + (isRequired ? ' required' : '') + '>';
                html += '<option value="">-- Select --</option>';
                nsField.options.forEach(function(opt) {
                    var selected = (String(value) === String(opt.value)) ? ' selected' : '';
                    html += '<option value="' + escapeHtml(opt.value) + '"' + selected + '>' + escapeHtml(opt.text) + '</option>';
                });
                html += '</select>';
            } else if (isSelectType) {
                // Select without pre-loaded options - use typeahead for server-side search
                var lookupType = this.getLookupType(nsField.id);
                var displayValue = doc[docKey + '_display'] || doc[docKey + '_text'] || '';

                if (isDisabled) {
                    // Disabled select - just show display value
                    html += '<input type="text" id="' + fieldId + '" value="' + escapeHtml(displayValue || value) + '" disabled>';
                } else {
                    // Typeahead select for body fields
                    html += '<div class="typeahead-select body-field-typeahead" data-field="' + nsField.id + '" data-lookup="' + lookupType + '">' +
                        '<input type="hidden" id="' + fieldId + '" value="' + escapeHtml(value) + '" data-field="' + nsField.id + '"' + (isRequired ? ' required' : '') + '>' +
                        '<input type="text" class="typeahead-input" id="' + fieldId + '-display" ' +
                            'value="' + escapeHtml(displayValue) + '" placeholder="Search ' + escapeHtml(label) + '..." ' +
                            'data-field="' + nsField.id + '" data-lookup="' + lookupType + '" autocomplete="off">' +
                        '<div class="typeahead-dropdown"></div>' +
                    '</div>';
                }
            } else if (nsField.type === 'date') {
                html += '<input type="date" id="' + fieldId + '" class="ns-field-input" data-field="' + nsField.id + '" value="' + formatDateInput(value) + '"' +
                    (isDisabled ? ' disabled' : '') + (isRequired ? ' required' : '') + '>';
            } else if (nsField.type === 'currency' || nsField.type === 'float') {
                html += '<div class="input-with-prefix">' +
                    '<span class="input-prefix">$</span>' +
                    '<input type="number" step="0.01" id="' + fieldId + '" class="ns-field-input" data-field="' + nsField.id + '" value="' + (parseFloat(value) || 0).toFixed(2) + '"' +
                    (isDisabled ? ' disabled' : '') + (isRequired ? ' required' : '') + '>' +
                '</div>';
            } else if (nsField.type === 'integer') {
                html += '<input type="number" step="1" id="' + fieldId + '" class="ns-field-input" data-field="' + nsField.id + '" value="' + escapeHtml(value) + '"' +
                    (isDisabled ? ' disabled' : '') + (isRequired ? ' required' : '') + '>';
            } else if (nsField.type === 'checkbox') {
                html += '<input type="checkbox" id="' + fieldId + '" class="ns-field-input" data-field="' + nsField.id + '"' +
                    (value ? ' checked' : '') + (isDisabled ? ' disabled' : '') + '>';
            } else if (nsField.type === 'textarea') {
                html += '<textarea id="' + fieldId + '" class="ns-field-input" data-field="' + nsField.id + '" rows="2"' +
                    (isDisabled ? ' disabled' : '') + (isRequired ? ' required' : '') + '>' + escapeHtml(value) + '</textarea>';
            } else {
                html += '<input type="text" id="' + fieldId + '" class="ns-field-input" data-field="' + nsField.id + '" value="' + escapeHtml(value) + '"' +
                    (isDisabled ? ' disabled' : '') + (isRequired ? ' required' : '') + '>';
            }

            // Add suggestion button if available (only for text inputs, not checkboxes or selects with options)
            if (suggestionHtml && nsField.type !== 'checkbox' && !isDisabled) {
                html += suggestionHtml;
            }

            html += '</div>';
            return html;
        },

        // Render a sublist table with its fields
        renderSublistTable: function(sublist, doc) {
            var self = this;
            var sublistId = sublist.id;
            var fields = sublist.fields || [];

            // Get line items for this sublist type (case-insensitive comparison)
            var slType = (sublistId || '').toLowerCase();
            var items = [];
            if (slType === 'expense') {
                items = doc.expenseLines || doc.lineItems || [];
            } else if (slType === 'item') {
                items = doc.itemLines || [];
            }

            // Store in controller for later updates
            if (!this.sublistData) this.sublistData = {};
            this.sublistData[sublistId] = items;

            if (items.length === 0) {
                return '<div class="empty-line-items">' +
                    '<i class="fas fa-' + (sublist.type === 'expense' ? 'receipt' : 'box') + '"></i>' +
                    '<span>No ' + sublist.label.toLowerCase() + ' added</span>' +
                '</div>';
            }

            // Determine visible columns (important fields first)
            var visibleFields = this.getVisibleSublistFields(sublist);

            // Wrap table in scrollable container to prevent overflow
            var html = '<div class="sublist-table-wrapper">' +
                '<table class="line-items sublist-table">' +
                '<thead><tr>';

            visibleFields.forEach(function(f) {
                var width = '';
                if (f.id === 'amount' || f.id === 'rate') width = ' style="width:100px;"';
                else if (f.id === 'quantity') width = ' style="width:70px;"';
                else if (f.id === 'description' || f.id === 'memo') width = ' style="min-width:150px;"';
                html += '<th' + width + '>' + escapeHtml(f.label) + '</th>';
            });
            html += '<th style="width:40px;"></th></tr></thead><tbody>';

            items.forEach(function(item, idx) {
                html += '<tr data-idx="' + idx + '" data-sublist="' + sublistId + '">';
                visibleFields.forEach(function(f) {
                    html += self.renderSublistCell(f, item, idx, sublistId);
                });
                html += '<td><button class="btn btn-ghost btn-icon btn-sm btn-remove-line" data-sublist="' + sublistId + '" title="Remove"><i class="fas fa-times"></i></button></td>';
                html += '</tr>';
            });

            html += '</tbody></table></div>'; // Close wrapper

            // Sublist total
            var total = items.reduce(function(sum, item) { return sum + (parseFloat(item.amount) || 0); }, 0);
            html += '<div class="line-items-total">' + escapeHtml(sublist.label) + ' Total: <strong>$' + total.toFixed(2) + '</strong></div>';

            return html;
        },

        // Get visible fields for a sublist using schema configuration
        getVisibleSublistFields: function(sublist) {
            var self = this;
            // Support both 'columns' (from XML) and 'fields' (from server extraction)
            var fields = sublist.columns || sublist.fields || [];
            var visible = [];

            // Use visibleColumns from schema if available (preferred form configuration)
            var visibleColumns = sublist.visibleColumns || [];
            var columnOrder = sublist.columnOrder || visibleColumns;

            // Filter out columns marked as not visible
            var visibleFieldsFromSchema = fields.filter(function(f) {
                return f.visible !== false;
            });

            if (columnOrder.length > 0) {
                // Use the form's configured column order
                columnOrder.forEach(function(fieldId) {
                    var normalizedId = (fieldId || '').toLowerCase();
                    var field = visibleFieldsFromSchema.find(function(f) {
                        return (f.id || '').toLowerCase() === normalizedId;
                    });
                    if (field) {
                        visible.push(field);
                    }
                });
            } else if (visibleFieldsFromSchema.length > 0) {
                // Use fields marked as visible from schema/XML
                visible = visibleFieldsFromSchema.slice(0, this.sublistColumnLimit || 10);
            } else {
                // Fallback to priority-based ordering based on sublist type or ID
                var priorityOrder = [];
                var slId = (sublist.id || '').toLowerCase();
                var isExpense = sublist.type === 'expense' || slId === 'expense';
                var isItem = sublist.type === 'item' || slId === 'item';

                if (isExpense) {
                    priorityOrder = ['account', 'amount', 'memo', 'department', 'class', 'location', 'customer', 'taxcode', 'grossamt', 'tax1amt'];
                } else if (isItem) {
                    priorityOrder = ['item', 'description', 'quantity', 'units', 'rate', 'amount', 'department', 'class', 'location', 'customer'];
                } else {
                    // Generic fallback for other sublists
                    priorityOrder = ['item', 'description', 'quantity', 'rate', 'amount', 'account', 'memo', 'department', 'class', 'location'];
                }

                priorityOrder.forEach(function(fieldId) {
                    var field = fields.find(function(f) {
                        return (f.id || '').toLowerCase() === fieldId.toLowerCase();
                    });
                    if (field && field.visible !== false && field.isDisplay !== false) {
                        visible.push(field);
                    }
                });

                console.log('[View.Review] Using fallback column order for', sublist.id, '- type:', sublist.type || 'unknown', '- columns:', visible.map(function(f) { return f.id; }).join(', '));
            }

            // Add any custom columns not already included
            fields.forEach(function(f) {
                var isCustom = f.isCustom || (f.id && f.id.indexOf('[') !== -1);
                if (isCustom && f.visible !== false && f.isDisplay !== false && !visible.find(function(v) { return v.id === f.id; })) {
                    visible.push(f);
                }
            });

            // Apply configurable column limit (default 10)
            var limit = this.sublistColumnLimit || 10;
            return visible.slice(0, limit);
        },

        // Render a single cell in the sublist table
        renderSublistCell: function(field, item, idx, sublistId) {
            // Handle both uppercase (from XML) and lowercase field IDs
            var fieldId = field.id;
            var normalizedFieldId = (fieldId || '').toLowerCase();
            var value = item[fieldId] || item[normalizedFieldId] || '';
            var displayValue = item[fieldId + '_display'] || item[normalizedFieldId + '_display'] || '';
            var inputId = 'line-' + sublistId + '-' + idx + '-' + fieldId;

            // Detect if this is a select field (by type or by known field ID)
            var isSelectField = field.type === 'select' || this.isSelectField(normalizedFieldId);

            // Select field with inline options - render simple select dropdown
            if (isSelectField && field.options && field.options.length > 0) {
                var html = '<td class="select-cell">' +
                    '<select class="line-input" id="' + inputId + '" data-field="' + fieldId + '">' +
                    '<option value="">--</option>';
                field.options.forEach(function(opt) {
                    var selected = (String(value) === String(opt.value)) ? ' selected' : '';
                    html += '<option value="' + escapeHtml(opt.value) + '"' + selected + '>' + escapeHtml(opt.text) + '</option>';
                });
                html += '</select></td>';
                return html;
            }
            // Select field requiring API lookup (large list like account, customer, item)
            else if (isSelectField) {
                var lookupType = this.getLookupType(field.id, sublistId);
                var html = '<td class="select-cell">' +
                    '<div class="typeahead-select" data-field="' + field.id + '" data-lookup="' + lookupType + '">' +
                    '<input type="hidden" class="line-input" id="' + inputId + '" value="' + escapeHtml(value) + '" data-field="' + field.id + '">' +
                    '<input type="text" class="typeahead-input line-input" id="' + inputId + '-display" ' +
                        'value="' + escapeHtml(displayValue || value) + '" placeholder="Search ' + escapeHtml(field.label) + '..." ' +
                        'data-field="' + field.id + '" data-lookup="' + lookupType + '" autocomplete="off">' +
                    '<div class="typeahead-dropdown"></div>' +
                    '</div></td>';
                return html;
            }
            // Currency/amount fields
            else if (field.type === 'currency' || field.id === 'amount' || field.id === 'rate') {
                return '<td><input type="number" step="0.01" class="line-input line-amount" id="' + inputId + '" value="' + (parseFloat(value) || 0).toFixed(2) + '" data-field="' + field.id + '"></td>';
            }
            // Integer/quantity fields
            else if (field.type === 'integer' || field.id === 'quantity') {
                return '<td><input type="number" step="1" class="line-input line-qty" id="' + inputId + '" value="' + (parseInt(value) || 0) + '" data-field="' + field.id + '"></td>';
            }
            // Default text input
            else {
                return '<td><input type="text" class="line-input" id="' + inputId + '" value="' + escapeHtml(value) + '" data-field="' + field.id + '"></td>';
            }
        },

        // Determine API lookup type for a field
        getLookupType: function(fieldId, sublistId) {
            var normalizedId = (fieldId || '').toLowerCase();
            if (normalizedId === 'account') return 'accounts';
            if (normalizedId === 'item') return 'items';
            if (normalizedId === 'customer') return 'customers';
            if (normalizedId === 'department') return 'departments';
            if (normalizedId === 'class') return 'classes';
            if (normalizedId === 'location') return 'locations';
            if (normalizedId === 'entity') return 'vendors';
            if (normalizedId === 'job' || normalizedId === 'project') return 'projects';
            if (normalizedId === 'subsidiary') return 'subsidiaries';
            if (normalizedId === 'currency') return 'currencies';
            if (normalizedId === 'terms') return 'terms';
            if (normalizedId === 'taxcode') return 'taxcodes';
            if (normalizedId === 'category' || normalizedId === 'expensecategory') return 'expensecategories';
            if (normalizedId === 'employee') return 'employees';
            if (normalizedId === 'postingperiod') return 'accountingperiods';
            if (normalizedId === 'approvalstatus') return 'approvalstatuses';
            if (normalizedId === 'nextapprover') return 'employees';
            if (normalizedId === 'projecttask') return 'projecttasks';
            return 'generic';
        },

        // Detect if a field should be a select/typeahead based on its ID
        isSelectField: function(fieldId) {
            var normalizedId = (fieldId || '').toLowerCase();
            var selectFields = [
                'account', 'department', 'class', 'location', 'subsidiary',
                'entity', 'customer', 'vendor', 'employee', 'item',
                'currency', 'terms', 'taxcode', 'postingperiod',
                'approvalstatus', 'nextapprover', 'category', 'expensecategory',
                'job', 'project', 'projecttask', 'customform'
            ];
            return selectFields.indexOf(normalizedId) !== -1;
        },

        // Initialize sublist data structure
        initSublistData: function(sublists) {
            var self = this;
            if (!this.sublistData) this.sublistData = {};

            sublists.forEach(function(sl) {
                if (!self.sublistData[sl.id]) {
                    self.sublistData[sl.id] = [];
                }
            });
        },

        // Update tab counts
        updateTabCounts: function() {
            var self = this;
            if (!this.sublistData) return;

            Object.keys(this.sublistData).forEach(function(sublistId) {
                var countEl = el('#count-' + sublistId);
                if (countEl) {
                    countEl.textContent = self.sublistData[sublistId].length;
                }
            });
        },

        // Check if a NetSuite field is mandatory
        isFieldMandatory: function(fieldId, bodyFields) {
            var field = bodyFields.find(function(f) { return f.id === fieldId; });
            return field && field.mandatory;
        },

        renderConfidenceBadge: function(field) {
            var conf = this.fieldConfidences[field];
            if (!conf && conf !== 0) return '';

            var percent = Math.round(conf * 100);
            var confClass = percent >= 85 ? 'high' : percent >= 60 ? 'medium' : 'low';

            return '<span class="field-confidence ' + confClass + '" title="AI Confidence: ' + percent + '%">' + percent + '%</span>';
        },

        bindFormEvents: function() {
            var self = this;

            // Track all field changes
            var panel = el('#extraction-panel');
            if (!panel) return;

            panel.querySelectorAll('input:not(.line-input):not(.line-desc):not(.line-qty):not(.line-price):not(.line-amount), select:not(.line-input)').forEach(function(input) {
                input.addEventListener('change', function() {
                    var field = this.id.replace('field-', '');
                    self.changes[field] = this.value;
                    self.markUnsaved();
                });
            });

            // Vendor search
            var vendorInput = el('#field-vendor');
            if (vendorInput) {
                var searchTimeout;
                vendorInput.addEventListener('input', function() {
                    var query = this.value.trim();
                    clearTimeout(searchTimeout);
                    if (query.length >= 2) {
                        searchTimeout = setTimeout(function() {
                            self.searchVendors(query);
                        }, 300);
                    } else {
                        self.hideVendorDropdown();
                    }
                    self.changes.vendorName = query;
                    self.markUnsaved();
                });

                vendorInput.addEventListener('focus', function() {
                    if (self.vendorSuggestions.length > 0) {
                        self.showVendorDropdown();
                    }
                });

                vendorInput.addEventListener('blur', function() {
                    // Delay hide to allow click on dropdown
                    setTimeout(function() {
                        self.hideVendorDropdown();
                    }, 200);
                });
            }

            // Auto-calculate total from subtotal + tax
            var subtotalEl = el('#field-subtotal');
            var taxEl = el('#field-taxAmount');
            var totalEl = el('#field-totalAmount');

            if (subtotalEl && taxEl && totalEl) {
                var calcTotal = function() {
                    var subtotal = parseFloat(subtotalEl.value) || 0;
                    var tax = parseFloat(taxEl.value) || 0;
                    totalEl.value = (subtotal + tax).toFixed(2);
                    self.changes.totalAmount = totalEl.value;
                    self.markUnsaved();
                };
                subtotalEl.addEventListener('input', calcTotal);
                taxEl.addEventListener('input', calcTotal);
            }

            // ========== SUBLIST TAB SWITCHING (Delegated for dynamic tabs) ==========
            // Use event delegation on all sublist-tabs containers (IDs are now dynamic)
            els('.sublist-tabs').forEach(function(tabsContainer) {
                tabsContainer.addEventListener('click', function(e) {
                    var tab = e.target.closest('.sublist-tab');
                    if (!tab) return;

                    var sublistId = tab.dataset.sublist;
                    var parentTabs = tab.closest('.sublist-tabs');

                    // Update active tab within this tabs container only
                    if (parentTabs) {
                        parentTabs.querySelectorAll('.sublist-tab').forEach(function(t) {
                            t.classList.remove('active');
                        });
                    }
                    tab.classList.add('active');

                    // Find the parent tab content and show the correct sublist container
                    var tabContent = tab.closest('.form-tab-content') || document;
                    tabContent.querySelectorAll('.sublist-container').forEach(function(c) {
                        c.classList.remove('active');
                    });
                    var container = el('#sublist-' + sublistId);
                    if (container) container.classList.add('active');

                    // Preserve resizer width after sublist tab switch
                    self.preserveResizerWidth();
                });
            });

            // ========== LINE ITEM OPERATIONS (Delegated for all sublists) ==========
            // Use querySelectorAll to get ALL line sections (may be multiple across tabs)
            var lineSections = document.querySelectorAll('.line-section');
            lineSections.forEach(function(lineSection) {
                // Add line button clicks
                lineSection.addEventListener('click', function(e) {
                    var addBtn = e.target.closest('.btn-add-line');
                    if (addBtn) {
                        var sublistId = addBtn.dataset.sublist;
                        self.addSublistLine(sublistId);
                        return;
                    }

                    var removeBtn = e.target.closest('.btn-remove-line');
                    if (removeBtn) {
                        var row = removeBtn.closest('tr');
                        if (row) {
                            var idx = parseInt(row.dataset.idx, 10);
                            var sublistId = row.dataset.sublist;
                            self.removeSublistLine(sublistId, idx);
                        }
                        return;
                    }
                });

                // Line input changes
                lineSection.addEventListener('input', function(e) {
                    var input = e.target;
                    if (!input.classList.contains('line-input')) return;

                    var row = input.closest('tr');
                    if (!row) return;

                    var idx = parseInt(row.dataset.idx, 10);
                    var sublistId = row.dataset.sublist;
                    var fieldId = input.dataset.field;
                    var value = input.value;

                    self.updateSublistLine(sublistId, idx, fieldId, value);
                });

                // ========== TYPEAHEAD SEARCH FOR SELECT FIELDS ==========
                lineSection.addEventListener('input', function(e) {
                    var input = e.target;
                    if (!input.classList.contains('typeahead-input')) return;

                    var query = input.value.trim();
                    var wrapper = input.closest('.typeahead-select');
                    var lookupType = input.dataset.lookup;

                    clearTimeout(self.typeaheadTimeout);

                    if (query.length < 2) {
                        self.hideTypeaheadDropdown(wrapper);
                        return;
                    }

                    self.typeaheadTimeout = setTimeout(function() {
                        self.searchDatasource(lookupType, query, wrapper, input);
                    }, 300);
                });

                // Typeahead option selection
                lineSection.addEventListener('click', function(e) {
                    var option = e.target.closest('.typeahead-option');
                    if (!option) return;

                    var wrapper = option.closest('.typeahead-select');
                    self.selectTypeaheadOption(wrapper, option);
                });

                // Hide typeahead on blur
                lineSection.addEventListener('focusout', function(e) {
                    if (!e.target.classList.contains('typeahead-input')) return;

                    setTimeout(function() {
                        var wrapper = e.target.closest('.typeahead-select');
                        self.hideTypeaheadDropdown(wrapper);
                    }, 200);
                });
            });

            // Shortcuts help
            this.on('#btn-shortcuts', 'click', function() {
                self.showShortcutsHelp();
            });

            // ========== BODY FIELD TYPEAHEAD HANDLERS ==========
            this.bindBodyFieldTypeahead();
        },

        // Bind typeahead handlers for body field selects
        bindBodyFieldTypeahead: function() {
            var self = this;
            var panel = el('#extraction-panel');
            if (!panel) return;

            // Typeahead input handler for body fields
            panel.addEventListener('input', function(e) {
                var input = e.target;
                if (!input.classList.contains('typeahead-input')) return;
                // Skip sublist typeaheads (handled separately)
                if (input.closest('.line-section')) return;

                var query = input.value.trim();
                var wrapper = input.closest('.typeahead-select');
                var lookupType = input.dataset.lookup;

                clearTimeout(self.typeaheadTimeout);

                if (query.length < 2) {
                    self.hideTypeaheadDropdown(wrapper);
                    return;
                }

                self.typeaheadTimeout = setTimeout(function() {
                    self.searchDatasource(lookupType, query, wrapper, input);
                }, 300);
            });

            // Typeahead option selection for body fields
            panel.addEventListener('click', function(e) {
                // Handle "Apply All" button click
                var applyAllBtn = e.target.closest('#btn-apply-all-suggestions');
                if (applyAllBtn) {
                    e.preventDefault();
                    self.applyAllSuggestions();
                    return;
                }

                // Handle suggestion button clicks
                var suggestionBtn = e.target.closest('.btn-suggestion');
                if (suggestionBtn) {
                    e.preventDefault();
                    self.applySuggestion(suggestionBtn);
                    return;
                }

                var option = e.target.closest('.typeahead-option');
                if (!option) return;
                // Skip sublist typeaheads
                if (option.closest('.line-section')) return;

                var wrapper = option.closest('.typeahead-select');
                if (wrapper && wrapper.classList.contains('body-field-typeahead')) {
                    self.selectBodyFieldTypeahead(wrapper, option);
                }
            });

            // Hide typeahead on blur for body fields
            panel.addEventListener('focusout', function(e) {
                if (!e.target.classList.contains('typeahead-input')) return;
                if (e.target.closest('.line-section')) return;

                setTimeout(function() {
                    var wrapper = e.target.closest('.typeahead-select');
                    self.hideTypeaheadDropdown(wrapper);
                }, 200);
            });
        },

        // Select typeahead option for body fields
        selectBodyFieldTypeahead: function(wrapper, option) {
            var hiddenInput = wrapper.querySelector('input[type="hidden"]');
            var displayInput = wrapper.querySelector('.typeahead-input');
            var dropdown = wrapper.querySelector('.typeahead-dropdown');

            var value = option.dataset.value;
            var text = option.dataset.text;
            var fieldId = hiddenInput ? hiddenInput.dataset.field : null;

            if (hiddenInput) hiddenInput.value = value;
            if (displayInput) displayInput.value = text;
            if (dropdown) dropdown.style.display = 'none';

            // Track the change
            if (fieldId) {
                this.changes[fieldId] = value;
                this.changes[fieldId + '_display'] = text;
                this.markUnsaved();
            }
        },

        // Apply AI suggestion to a field
        applySuggestion: function(btn) {
            var fieldId = btn.dataset.field;
            var value = btn.dataset.value;
            if (!fieldId || value === undefined) return;

            // Find the input field to update
            var input = el('#field-' + fieldId);
            if (!input) {
                // Try typeahead hidden input
                input = el('input[data-field="' + fieldId + '"]');
            }

            if (input) {
                input.value = value;

                // Also update display input for typeahead fields
                var displayInput = el('#field-' + fieldId + '-display');
                if (displayInput) {
                    displayInput.value = value;
                }

                // Track the change
                this.changes[fieldId] = value;
                this.markUnsaved();

                // Remove the suggestion button and highlight
                var formField = btn.closest('.form-field');
                if (formField) {
                    formField.classList.remove('has-suggestion');
                }
                btn.remove();

                // Update Apply All button visibility
                this.updateApplyAllButton();

                // Show brief success feedback
                UI.toast('Applied: ' + (value.length > 20 ? value.substring(0, 20) + '...' : value), 'success');
            }
        },

        // Apply all AI suggestions at once
        applyAllSuggestions: function() {
            var self = this;
            var buttons = document.querySelectorAll('.btn-suggestion');
            var count = buttons.length;

            if (count === 0) {
                UI.toast('No suggestions to apply', 'info');
                return;
            }

            buttons.forEach(function(btn) {
                var fieldId = btn.dataset.field;
                var value = btn.dataset.value;
                if (!fieldId || value === undefined) return;

                var input = el('#field-' + fieldId);
                if (!input) {
                    input = el('input[data-field="' + fieldId + '"]');
                }

                if (input) {
                    input.value = value;

                    var displayInput = el('#field-' + fieldId + '-display');
                    if (displayInput) {
                        displayInput.value = value;
                    }

                    self.changes[fieldId] = value;

                    var formField = btn.closest('.form-field');
                    if (formField) {
                        formField.classList.remove('has-suggestion');
                    }
                    btn.remove();
                }
            });

            this.markUnsaved();
            this.updateApplyAllButton();
            UI.toast('Applied ' + count + ' suggestion' + (count === 1 ? '' : 's'), 'success');
        },

        // Show/hide the Apply All button based on available suggestions
        updateApplyAllButton: function() {
            var applyAllBtn = el('#btn-apply-all-suggestions');
            if (!applyAllBtn) return;

            var buttons = document.querySelectorAll('.btn-suggestion');
            if (buttons.length > 0) {
                applyAllBtn.style.display = 'inline-flex';
                applyAllBtn.innerHTML = '<i class="fas fa-magic"></i> Apply All (' + buttons.length + ')';
            } else {
                applyAllBtn.style.display = 'none';
            }
        },

        // ==========================================
        // SUBLIST LINE OPERATIONS
        // ==========================================
        addSublistLine: function(sublistId) {
            if (!this.sublistData) this.sublistData = {};
            if (!this.sublistData[sublistId]) this.sublistData[sublistId] = [];

            // Create empty line based on sublist type (normalize to lowercase for comparison)
            var slType = (sublistId || '').toLowerCase();
            var newLine = { amount: 0 };
            if (slType === 'expense') {
                newLine.account = '';
                newLine.memo = '';
            } else if (slType === 'item') {
                newLine.item = '';
                newLine.description = '';
                newLine.quantity = 1;
                newLine.rate = 0;
            }

            this.sublistData[sublistId].push(newLine);
            this.changes[slType + 'Lines'] = this.sublistData[sublistId];
            this.markUnsaved();
            this.refreshSublist(sublistId);
            this.updateTabCounts();
        },

        removeSublistLine: function(sublistId, idx) {
            if (!this.sublistData || !this.sublistData[sublistId]) return;

            var slType = (sublistId || '').toLowerCase();
            this.sublistData[sublistId].splice(idx, 1);
            this.changes[slType + 'Lines'] = this.sublistData[sublistId];
            this.markUnsaved();
            this.refreshSublist(sublistId);
            this.updateTabCounts();
        },

        updateSublistLine: function(sublistId, idx, fieldId, value) {
            if (!this.sublistData || !this.sublistData[sublistId]) return;

            var line = this.sublistData[sublistId][idx];
            if (!line) return;

            // Convert numeric fields
            if (fieldId === 'amount' || fieldId === 'rate' || fieldId === 'quantity') {
                value = parseFloat(value) || 0;
            }

            line[fieldId] = value;

            // Auto-calculate amount for item lines
            if ((fieldId === 'quantity' || fieldId === 'rate') && sublistId === 'item') {
                var qty = parseFloat(line.quantity) || 0;
                var rate = parseFloat(line.rate) || 0;
                line.amount = qty * rate;

                // Update the amount input
                var amountInput = el('#line-' + sublistId + '-' + idx + '-amount');
                if (amountInput) amountInput.value = line.amount.toFixed(2);
            }

            this.changes[sublistId + 'Lines'] = this.sublistData[sublistId];
            this.markUnsaved();
            this.updateSublistTotal(sublistId);
        },

        refreshSublist: function(sublistId) {
            var container = el('#lines-' + sublistId);
            var sublistContainer = el('#sublist-' + sublistId);
            if (!container || !sublistContainer) return;

            // Get the sublist config from form fields (case-insensitive find)
            var formFields = this.formFields || {};
            var sublists = formFields.sublists || [];
            var normalizedId = (sublistId || '').toLowerCase();
            var sublist = sublists.find(function(sl) {
                return (sl.id || '').toLowerCase() === normalizedId;
            });

            if (!sublist) return;

            // Re-render the sublist table
            var items = this.sublistData[sublistId] || [];
            var doc = { expenseLines: [], itemLines: [] };
            doc[normalizedId === 'expense' ? 'expenseLines' : 'itemLines'] = items;

            container.innerHTML = this.renderSublistTable(sublist, doc);
        },

        updateSublistTotal: function(sublistId) {
            if (!this.sublistData || !this.sublistData[sublistId]) return;

            var total = this.sublistData[sublistId].reduce(function(sum, item) {
                return sum + (parseFloat(item.amount) || 0);
            }, 0);

            var totalEl = document.querySelector('#sublist-' + sublistId + ' .line-items-total strong');
            if (totalEl) {
                totalEl.textContent = '$' + total.toFixed(2);
            }
        },

        // ==========================================
        // VENDOR SEARCH
        // ==========================================
        searchVendors: function(query) {
            var self = this;

            API.get('vendors', { query: query })
                .then(function(vendors) {
                    self.vendorSuggestions = vendors || [];
                    if (self.vendorSuggestions.length > 0) {
                        self.showVendorDropdown();
                    } else {
                        self.hideVendorDropdown();
                    }
                })
                .catch(function() {
                    self.hideVendorDropdown();
                });
        },

        showVendorDropdown: function() {
            var dropdown = el('#vendor-dropdown');
            if (!dropdown) return;

            var html = this.vendorSuggestions.map(function(v) {
                return '<div class="vendor-option" data-id="' + v.id + '" data-name="' + escapeHtml(v.companyName || v.entityId) + '">' +
                    '<div class="vendor-option-name">' + escapeHtml(v.companyName || v.entityId) + '</div>' +
                    (v.email ? '<div class="vendor-option-email">' + escapeHtml(v.email) + '</div>' : '') +
                '</div>';
            }).join('');

            dropdown.innerHTML = html;
            dropdown.style.display = 'block';

            // Bind click handlers
            dropdown.querySelectorAll('.vendor-option').forEach(function(opt) {
                opt.addEventListener('click', function() {
                    var id = this.dataset.id;
                    var name = this.dataset.name;
                    var input = el('#field-vendor');
                    var hiddenInput = el('#field-vendorId');

                    if (input) input.value = name;
                    if (hiddenInput) {
                        hiddenInput.value = id;
                    } else {
                        var hidden = document.createElement('input');
                        hidden.type = 'hidden';
                        hidden.id = 'field-vendorId';
                        hidden.value = id;
                        input.parentNode.appendChild(hidden);
                    }

                    ReviewController.changes.vendorName = name;
                    ReviewController.changes.vendorId = id;
                    ReviewController.markUnsaved();
                    ReviewController.hideVendorDropdown();
                });
            });
        },

        hideVendorDropdown: function() {
            var dropdown = el('#vendor-dropdown');
            if (dropdown) dropdown.style.display = 'none';
        },

        // ==========================================
        // TYPEAHEAD SEARCH (for sublist select fields)
        // ==========================================
        searchDatasource: function(type, query, wrapper, input) {
            var self = this;
            var dropdown = wrapper.querySelector('.typeahead-dropdown');
            if (!dropdown) return;

            // Show loading state
            dropdown.innerHTML = '<div class="typeahead-loading"><i class="fas fa-spinner fa-spin"></i> Searching...</div>';
            dropdown.style.display = 'block';

            API.get('datasource', { type: type, query: query, limit: 20 })
                .then(function(result) {
                    var data = result.data || result;
                    self.renderTypeaheadResults(dropdown, data, wrapper, input);
                })
                .catch(function(err) {
                    dropdown.innerHTML = '<div class="typeahead-error">Error loading options</div>';
                });
        },

        renderTypeaheadResults: function(dropdown, results, wrapper, input) {
            if (!results || results.length === 0) {
                dropdown.innerHTML = '<div class="typeahead-empty">No results found</div>';
                return;
            }

            var html = results.map(function(r) {
                return '<div class="typeahead-option" data-value="' + escapeHtml(r.value) + '" data-text="' + escapeHtml(r.text) + '">' +
                    '<span class="typeahead-text">' + escapeHtml(r.text) + '</span>' +
                    '</div>';
            }).join('');

            dropdown.innerHTML = html;
        },

        selectTypeaheadOption: function(wrapper, option) {
            var hiddenInput = wrapper.querySelector('input[type="hidden"]');
            var displayInput = wrapper.querySelector('.typeahead-input');
            var dropdown = wrapper.querySelector('.typeahead-dropdown');

            var value = option.dataset.value;
            var text = option.dataset.text;

            if (hiddenInput) hiddenInput.value = value;
            if (displayInput) displayInput.value = text;
            if (dropdown) dropdown.style.display = 'none';

            // Trigger line update
            var row = wrapper.closest('tr');
            if (row) {
                var idx = parseInt(row.dataset.idx, 10);
                var sublistId = row.dataset.sublist;
                var fieldId = hiddenInput ? hiddenInput.dataset.field : displayInput.dataset.field;
                this.updateSublistLine(sublistId, idx, fieldId, value);

                // Also store the display text
                if (this.sublistData && this.sublistData[sublistId] && this.sublistData[sublistId][idx]) {
                    this.sublistData[sublistId][idx][fieldId + '_display'] = text;
                }
            }

            this.markUnsaved();
        },

        hideTypeaheadDropdown: function(wrapper) {
            if (!wrapper) return;
            var dropdown = wrapper.querySelector('.typeahead-dropdown');
            if (dropdown) dropdown.style.display = 'none';
        },

        // ==========================================
        // DOCUMENT ACTIONS
        // ==========================================
        saveChanges: function() {
            var self = this;
            if (this.isSaving || Object.keys(this.changes).length === 0) return;

            this.isSaving = true;
            var saveBtn = el('#btn-save');
            if (saveBtn) {
                saveBtn.disabled = true;
                saveBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Saving...';
            }

            API.put('update', { documentId: this.docId, updates: this.changes })
                .then(function() {
                    self.changes = {};
                    self.isSaving = false;
                    self.markSaved();
                    UI.toast('Changes saved', 'success');
                    if (saveBtn) {
                        saveBtn.disabled = false;
                        saveBtn.innerHTML = '<i class="fas fa-save"></i> Save Changes <span class="shortcut-hint">Ctrl+S</span>';
                    }
                })
                .catch(function(err) {
                    self.isSaving = false;
                    UI.toast('Error: ' + err.message, 'error');
                    if (saveBtn) {
                        saveBtn.disabled = false;
                        saveBtn.innerHTML = '<i class="fas fa-save"></i> Save Changes <span class="shortcut-hint">Ctrl+S</span>';
                    }
                });
        },

        // Validate all required fields before approval
        validateRequiredFields: function() {
            var result = { valid: true, message: '', focusElement: null };

            // Core required fields - always required
            var vendorName = el('#field-vendor');
            if (!vendorName || !vendorName.value.trim()) {
                return { valid: false, message: 'Vendor name is required', focusElement: vendorName };
            }

            var totalAmount = el('#field-totalAmount');
            if (!totalAmount || parseFloat(totalAmount.value) <= 0) {
                return { valid: false, message: 'Total amount is required', focusElement: totalAmount };
            }

            // Check all fields marked as required
            var requiredInputs = document.querySelectorAll('#extraction-panel input[required], #extraction-panel select[required], #extraction-panel textarea[required]');
            for (var i = 0; i < requiredInputs.length; i++) {
                var input = requiredInputs[i];
                var value = input.value ? input.value.trim() : '';

                // Skip hidden inputs if they have a paired display input (typeahead)
                if (input.type === 'hidden') {
                    var wrapper = input.closest('.typeahead-select');
                    if (wrapper) {
                        var displayInput = wrapper.querySelector('.typeahead-input');
                        if (displayInput && !displayInput.value.trim()) {
                            var label = this.getFieldLabel(input.dataset.field);
                            return { valid: false, message: label + ' is required', focusElement: displayInput };
                        }
                        continue;
                    }
                }

                if (!value) {
                    var fieldId = input.dataset.field || input.id.replace('field-', '');
                    var label = this.getFieldLabel(fieldId);
                    return { valid: false, message: label + ' is required', focusElement: input };
                }
            }

            // Validate select fields have actual selections (not empty option)
            var selectFields = document.querySelectorAll('#extraction-panel select.ns-field-select[required]');
            for (var j = 0; j < selectFields.length; j++) {
                var select = selectFields[j];
                if (!select.value) {
                    var fieldId = select.dataset.field || select.id.replace('field-', '');
                    var label = this.getFieldLabel(fieldId);
                    return { valid: false, message: 'Please select a value for ' + label, focusElement: select };
                }
            }

            return result;
        },

        // Get field label for validation messages
        getFieldLabel: function(fieldId) {
            var formFields = this.formFields || {};
            var bodyFields = formFields.bodyFields || [];
            var field = bodyFields.find(function(f) { return f.id === fieldId; });
            if (field && field.label) return field.label;

            // Fallback - humanize the field ID
            return fieldId.replace(/([A-Z])/g, ' $1')
                         .replace(/^./, function(str) { return str.toUpperCase(); })
                         .replace(/[-_]/g, ' ');
        },

        approveDocument: function() {
            var self = this;

            // Validate all required fields
            var validation = this.validateRequiredFields();
            if (!validation.valid) {
                UI.toast(validation.message, 'warning');
                if (validation.focusElement) {
                    validation.focusElement.focus();
                    // Scroll to make visible if needed
                    validation.focusElement.scrollIntoView({ behavior: 'smooth', block: 'center' });
                }
                return;
            }

            // Save any pending changes first
            var savePromise = Object.keys(this.changes).length > 0
                ? API.put('update', { documentId: this.docId, updates: this.changes })
                : Promise.resolve();

            savePromise
                .then(function() {
                    return API.put('approve', { documentId: self.docId, createTransaction: true });
                })
                .then(function(result) {
                    // Trigger confetti celebration
                    self.triggerConfetti();
                    UI.toast('Document approved! Transaction created.', 'success');

                    // Go to next document or back to documents list
                    if (self.queueIndex >= 0 && self.queueIndex < self.queueIds.length - 1) {
                        self.goToNextDocument();
                    } else {
                        // Last document - celebrate and go back
                        UI.toast('Queue complete! Great work!', 'success');
                        setTimeout(function() {
                            Router.navigate('documents');
                        }, 800);
                    }
                })
                .catch(function(err) {
                    UI.toast('Error: ' + err.message, 'error');
                });
        },

        rejectDocument: function() {
            var self = this;

            // Show rejection modal
            var reason = prompt('Reason for rejection:');
            if (!reason || !reason.trim()) return;

            API.put('reject', { documentId: this.docId, reason: reason.trim() })
                .then(function() {
                    UI.toast('Document rejected', 'success');

                    // Go to next document or back to documents list
                    if (self.queueIndex >= 0 && self.queueIndex < self.queueIds.length - 1) {
                        self.goToNextDocument();
                    } else {
                        Router.navigate('documents');
                    }
                })
                .catch(function(err) {
                    UI.toast('Error: ' + err.message, 'error');
                });
        },

        triggerConfetti: function() {
            // Create confetti burst animation
            var colors = ['#10B981', '#34D399', '#6EE7B7', '#A7F3D0', '#FBBF24'];
            var container = document.body;

            for (var i = 0; i < 30; i++) {
                var confetti = document.createElement('div');
                confetti.className = 'confetti-piece';
                confetti.style.cssText = 'position:fixed;width:10px;height:10px;background:' + colors[i % colors.length] + ';' +
                    'left:' + (Math.random() * 100) + '%;top:-10px;opacity:1;z-index:9999;' +
                    'animation:confetti-fall ' + (1.5 + Math.random()) + 's ease-out forwards;' +
                    'animation-delay:' + (Math.random() * 0.3) + 's;border-radius:2px;' +
                    'transform:rotate(' + (Math.random() * 360) + 'deg);';
                container.appendChild(confetti);

                // Clean up after animation
                setTimeout(function(el) {
                    if (el.parentNode) el.parentNode.removeChild(el);
                }, 2500, confetti);
            }
        },

        // ==========================================
        // NAVIGATION
        // ==========================================
        navigateBack: function() {
            if (Object.keys(this.changes).length > 0) {
                if (!confirm('You have unsaved changes. Discard and go back?')) {
                    return;
                }
            }
            Router.navigate('documents');
        },

        skipDocument: function() {
            // Skip moves to next document without any action
            if (this.queueIndex >= 0 && this.queueIndex < this.queueIds.length - 1) {
                this.goToNextDocument();
            } else {
                // Last document - go back to documents list
                Router.navigate('documents');
            }
        },

        goToNextDocument: function() {
            if (this.queueIndex < 0 || this.queueIndex >= this.queueIds.length - 1) return;

            var nextId = this.queueIds[this.queueIndex + 1];
            Router.navigate('review', { docId: nextId });
        },

        goToPrevDocument: function() {
            if (this.queueIndex <= 0) return;

            var prevId = this.queueIds[this.queueIndex - 1];
            Router.navigate('review', { docId: prevId });
        },

        updateNavigationButtons: function() {
            var prevBtn = el('#btn-doc-prev');
            var nextBtn = el('#btn-doc-next');
            var skipBtn = el('#btn-skip');

            if (prevBtn) {
                prevBtn.disabled = this.queueIndex <= 0;
            }
            if (nextBtn) {
                nextBtn.disabled = this.queueIndex < 0 || this.queueIndex >= this.queueIds.length - 1;
            }
            // Skip is always enabled - goes to next or back to list
            if (skipBtn) {
                skipBtn.disabled = false;
            }

            // Update progress bar when navigation state changes
            this.updateProgressBar();
        },

        // ==========================================
        // PREVIEW CONTROLS
        // ==========================================
        setZoom: function(level) {
            this.zoom = Math.max(0.5, Math.min(3, level));
            var iframe = el('#doc-preview');
            if (iframe) {
                iframe.style.transform = 'scale(' + this.zoom + ') rotate(' + this.rotation + 'deg)';
            }
            var zoomDisplay = el('#zoom-level');
            if (zoomDisplay) {
                zoomDisplay.textContent = Math.round(this.zoom * 100) + '%';
            }
        },

        rotate: function() {
            this.rotation = (this.rotation + 90) % 360;
            var iframe = el('#doc-preview');
            if (iframe) {
                iframe.style.transform = 'scale(' + this.zoom + ') rotate(' + this.rotation + 'deg)';
            }
        },

        goToPage: function(page) {
            if (page < 1 || page > this.totalPages) return;
            this.currentPage = page;
            // Page navigation would require PDF.js or similar
            var pageDisplay = el('#page-display');
            if (pageDisplay) {
                pageDisplay.textContent = this.currentPage + ' / ' + this.totalPages;
            }
        },

        // ==========================================
        // FIELD NAVIGATION
        // ==========================================
        focusNextField: function(direction) {
            var inputs = Array.from(document.querySelectorAll('.extraction-panel input:not([type="hidden"]), .extraction-panel select'));
            var current = document.activeElement;
            var idx = inputs.indexOf(current);

            if (idx === -1) {
                inputs[0].focus();
            } else {
                var nextIdx = idx + direction;
                if (nextIdx >= 0 && nextIdx < inputs.length) {
                    inputs[nextIdx].focus();
                }
            }
        },

        // ==========================================
        // UI STATE
        // ==========================================
        markUnsaved: function() {
            var saveBtn = el('#btn-save');
            if (saveBtn && !saveBtn.classList.contains('has-changes')) {
                saveBtn.classList.add('has-changes');
                saveBtn.innerHTML = '<i class="fas fa-save"></i> Save Changes* <span class="shortcut-hint">Ctrl+S</span>';
            }
        },

        markSaved: function() {
            var saveBtn = el('#btn-save');
            if (saveBtn) {
                saveBtn.classList.remove('has-changes');
                saveBtn.innerHTML = '<i class="fas fa-save"></i> Save Changes <span class="shortcut-hint">Ctrl+S</span>';
            }
        },

        showShortcutsHelp: function() {
            var html = '<div class="shortcuts-modal">' +
                '<div class="shortcuts-content">' +
                    '<h3><i class="fas fa-keyboard"></i> Keyboard Shortcuts</h3>' +
                    '<div class="shortcuts-grid">' +
                        '<div class="shortcut-section">' +
                            '<div class="shortcut-section-title">Actions</div>' +
                            '<div class="shortcut-item"><kbd>A</kbd> <span>Approve & next</span></div>' +
                            '<div class="shortcut-item"><kbd>R</kbd> <span>Reject document</span></div>' +
                            '<div class="shortcut-item"><kbd>S</kbd> <span>Skip to next</span></div>' +
                            '<div class="shortcut-item"><kbd>Esc</kbd> <span>Back to documents</span></div>' +
                        '</div>' +
                        '<div class="shortcut-section">' +
                            '<div class="shortcut-section-title">Navigation</div>' +
                            '<div class="shortcut-item"><kbd>←</kbd> <span>Previous document</span></div>' +
                            '<div class="shortcut-item"><kbd>→</kbd> <span>Next document</span></div>' +
                            '<div class="shortcut-item"><kbd>Tab</kbd> <span>Next field</span></div>' +
                            '<div class="shortcut-item"><kbd>Shift+Tab</kbd> <span>Previous field</span></div>' +
                        '</div>' +
                        '<div class="shortcut-section">' +
                            '<div class="shortcut-section-title">Preview</div>' +
                            '<div class="shortcut-item"><kbd>+</kbd> <span>Zoom in</span></div>' +
                            '<div class="shortcut-item"><kbd>-</kbd> <span>Zoom out</span></div>' +
                            '<div class="shortcut-item"><kbd>Ctrl+0</kbd> <span>Reset zoom</span></div>' +
                        '</div>' +
                        '<div class="shortcut-section">' +
                            '<div class="shortcut-section-title">Other</div>' +
                            '<div class="shortcut-item"><kbd>Ctrl+S</kbd> <span>Save changes</span></div>' +
                            '<div class="shortcut-item"><kbd>?</kbd> <span>Show this help</span></div>' +
                        '</div>' +
                    '</div>' +
                    '<button class="btn btn-primary btn-block" onclick="this.closest(\'.shortcuts-modal\').remove()">Got it!</button>' +
                '</div>' +
            '</div>';

            var modal = document.createElement('div');
            modal.innerHTML = html;
            document.body.appendChild(modal.firstChild);
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

        // ==========================================
        // CLEANUP
        // ==========================================
        cleanup: function() {
            this.data = null;
            this.docId = null;
            this.changes = {};
            this.zoom = 1;
            this.rotation = 0;
            this.lineItems = [];
            this.vendorSuggestions = [];
            this.queueIds = [];
            this.queueIndex = -1;
        }
    };

    // Register the controller
    Router.register('review',
        function(params) { ReviewController.init(params); },
        function() { ReviewController.cleanup(); }
    );

    console.log('[View.Review] World-Class Review Loaded');

})();
