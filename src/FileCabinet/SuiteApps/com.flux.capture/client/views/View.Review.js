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
        'Enter': { action: 'approve', description: 'Approve & next' },
        'Escape': { action: 'back', description: 'Back to queue' },
        'ArrowRight': { action: 'nextDoc', description: 'Next document', ctrl: true },
        'ArrowLeft': { action: 'prevDoc', description: 'Previous document', ctrl: true },
        'KeyS': { action: 'save', description: 'Save changes', ctrl: true },
        'KeyR': { action: 'reject', description: 'Reject document', ctrl: true },
        'Equal': { action: 'zoomIn', description: 'Zoom in' },
        'Minus': { action: 'zoomOut', description: 'Zoom out' },
        'Digit0': { action: 'zoomReset', description: 'Reset zoom', ctrl: true }
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

        // ==========================================
        // INITIALIZATION
        // ==========================================
        init: function(params) {
            var self = this;
            this.docId = params.docId;
            this.changes = {};
            this.zoom = 1;
            this.rotation = 0;
            this.currentPage = 1;
            this.lineItems = [];
            this.formFields = null;
            this.isLoading = true;

            // Render base template
            renderTemplate('tpl-review', 'view-container');

            // Load queue context for prev/next navigation
            this.loadQueueContext();

            // Bind events and keyboard shortcuts
            this.bindEvents();
            this.bindKeyboardShortcuts();

            if (this.docId) {
                this.loadData();
            } else {
                this.showError('No document ID provided');
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

                var percentage = (newWidth / containerWidth) * 100;
                previewPanel.style.flex = '0 0 ' + percentage + '%';
            }

            function stopResize() {
                if (!isResizing) return;
                isResizing = false;
                resizer.classList.remove('dragging');
                overlay.style.display = 'none';
                document.body.style.cursor = '';
                document.body.style.userSelect = '';
                if (previewViewport) previewViewport.style.pointerEvents = '';

                // Save preference to localStorage
                try {
                    var flexVal = previewPanel.style.flex;
                    var percentMatch = flexVal.match(/([\d.]+)%/);
                    if (percentMatch && percentMatch[1]) {
                        localStorage.setItem('fc_preview_width', percentMatch[1]);
                    }
                } catch (e) { /* ignore */ }
            }

            // Mouse events
            resizer.addEventListener('mousedown', startResize);
            document.addEventListener('mousemove', doResize);
            document.addEventListener('mouseup', stopResize);
            overlay.addEventListener('mousemove', doResize);
            overlay.addEventListener('mouseup', stopResize);

            // Set initial width - use saved preference or default to 40%
            var DEFAULT_PREVIEW_WIDTH = 40;
            try {
                var savedWidth = localStorage.getItem('fc_preview_width');
                var widthToUse = savedWidth ? parseFloat(savedWidth) : DEFAULT_PREVIEW_WIDTH;
                // Ensure width is within reasonable bounds
                widthToUse = Math.max(25, Math.min(70, widthToUse));
                previewPanel.style.flex = '0 0 ' + widthToUse + '%';
            } catch (e) {
                // Fallback to default
                previewPanel.style.flex = '0 0 ' + DEFAULT_PREVIEW_WIDTH + '%';
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
                    if (e.ctrlKey && e.key === 's') {
                        e.preventDefault();
                        self.saveChanges();
                        return;
                    }
                    return;
                }

                var key = e.code || e.key;
                var shortcut = SHORTCUTS[key];

                if (!shortcut) return;

                // Check modifier requirements
                if (shortcut.ctrl && !e.ctrlKey && !e.metaKey) return;
                if (e.ctrlKey && !shortcut.ctrl) {
                    // Some shortcuts need ctrl, some don't
                    if (key === 'ArrowRight' || key === 'ArrowLeft' || key === 'KeyS' || key === 'KeyR' || key === 'Digit0') {
                        // These need ctrl
                    } else {
                        return;
                    }
                }

                e.preventDefault();

                switch (shortcut.action) {
                    case 'nextField': self.focusNextField(1); break;
                    case 'prevField': self.focusNextField(-1); break;
                    case 'approve': self.approveDocument(); break;
                    case 'back': self.navigateBack(); break;
                    case 'nextDoc': self.goToNextDocument(); break;
                    case 'prevDoc': self.goToPrevDocument(); break;
                    case 'save': self.saveChanges(); break;
                    case 'reject': self.rejectDocument(); break;
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

            // Update document counter
            var counterEl = el('#doc-counter');
            if (counterEl && this.queueIndex >= 0) {
                counterEl.textContent = (this.queueIndex + 1) + ' of ' + this.queueIds.length;
                counterEl.style.display = 'inline';
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
            var tabs = layout.tabs || [];
            var config = formFields.config || {};

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
            // If we have a cached layout (from DOM extraction), use tabs/groups
            // Otherwise, render all fields in a flat list

            var hasLayout = layout && layout.tabs && layout.tabs.length > 0;

            if (hasLayout) {
                // ========== RENDER WITH LAYOUT (tabs/groups from DOM extraction) ==========
                var visibleTabs = layout.tabs.filter(function(tab) {
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
                                if (fieldId === 'entity') return;

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
                    var tabSublists = sublists.filter(function(sl) {
                        return (tab.sublists || []).indexOf(sl.id) !== -1;
                    });

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
            var docKey = fieldMapping[nsField.id] || nsField.id;
            var value = doc[docKey] || '';

            var html = '<div class="form-field">' +
                '<label>' + escapeHtml(label) + ' ' + this.renderConfidenceBadge(docKey) +
                (isRequired ? ' <span class="required">*</span>' : '') + '</label>';

            if (nsField.type === 'select' && nsField.options && nsField.options.length > 0) {
                html += '<select id="' + fieldId + '">';
                html += '<option value="">-- Select --</option>';
                nsField.options.forEach(function(opt) {
                    var selected = (String(value) === String(opt.value)) ? ' selected' : '';
                    html += '<option value="' + escapeHtml(opt.value) + '"' + selected + '>' + escapeHtml(opt.text) + '</option>';
                });
                html += '</select>';
            } else if (nsField.type === 'date') {
                html += '<input type="date" id="' + fieldId + '" value="' + formatDateInput(value) + '">';
            } else if (nsField.type === 'currency' || nsField.type === 'float') {
                html += '<div class="input-with-prefix">' +
                    '<span class="input-prefix">$</span>' +
                    '<input type="number" step="0.01" id="' + fieldId + '" value="' + (parseFloat(value) || 0).toFixed(2) + '">' +
                '</div>';
            } else if (nsField.type === 'integer') {
                html += '<input type="number" step="1" id="' + fieldId + '" value="' + escapeHtml(value) + '">';
            } else if (nsField.type === 'checkbox') {
                html += '<input type="checkbox" id="' + fieldId + '"' + (value ? ' checked' : '') + '>';
            } else if (nsField.type === 'textarea') {
                html += '<textarea id="' + fieldId + '" rows="2">' + escapeHtml(value) + '</textarea>';
            } else {
                html += '<input type="text" id="' + fieldId + '" value="' + escapeHtml(value) + '">';
            }

            html += '</div>';
            return html;
        },

        // Render a sublist table with its fields
        renderSublistTable: function(sublist, doc) {
            var self = this;
            var sublistId = sublist.id;
            var fields = sublist.fields || [];

            // Get line items for this sublist type
            var items = [];
            if (sublistId === 'expense') {
                items = doc.expenseLines || doc.lineItems || [];
            } else if (sublistId === 'item') {
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

            var html = '<table class="line-items sublist-table">' +
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

            html += '</tbody></table>';

            // Sublist total
            var total = items.reduce(function(sum, item) { return sum + (parseFloat(item.amount) || 0); }, 0);
            html += '<div class="line-items-total">' + escapeHtml(sublist.label) + ' Total: <strong>$' + total.toFixed(2) + '</strong></div>';

            return html;
        },

        // Get visible fields for a sublist using schema configuration
        getVisibleSublistFields: function(sublist) {
            var self = this;
            var fields = sublist.fields || [];
            var visible = [];

            // Use visibleColumns from schema if available (preferred form configuration)
            var visibleColumns = sublist.visibleColumns || [];
            var columnOrder = sublist.columnOrder || visibleColumns;

            if (columnOrder.length > 0) {
                // Use the form's configured column order
                columnOrder.forEach(function(fieldId) {
                    var field = fields.find(function(f) { return f.id === fieldId; });
                    if (field && field.isDisplay !== false) {
                        visible.push(field);
                    }
                });
            } else {
                // Fallback to priority-based ordering
                var priorityOrder = [];
                if (sublist.type === 'expense') {
                    priorityOrder = ['account', 'amount', 'memo', 'department', 'class', 'location', 'taxcode'];
                } else {
                    priorityOrder = ['item', 'description', 'quantity', 'rate', 'amount', 'department', 'class', 'location'];
                }

                priorityOrder.forEach(function(fieldId) {
                    var field = fields.find(function(f) { return f.id === fieldId; });
                    if (field && field.isDisplay !== false) {
                        visible.push(field);
                    }
                });
            }

            // Add any custom columns not already included
            fields.forEach(function(f) {
                if (f.isCustom && f.isDisplay !== false && !visible.find(function(v) { return v.id === f.id; })) {
                    visible.push(f);
                }
            });

            // Apply configurable column limit (default 10)
            var limit = this.sublistColumnLimit || 10;
            return visible.slice(0, limit);
        },

        // Render a single cell in the sublist table
        renderSublistCell: function(field, item, idx, sublistId) {
            var value = item[field.id] || '';
            var displayValue = item[field.id + '_display'] || ''; // For lookups, store display text
            var inputId = 'line-' + sublistId + '-' + idx + '-' + field.id;

            // Select field with inline options (small list) - render searchable select
            if (field.type === 'select' && field.options && field.options.length > 0) {
                var html = '<td class="select-cell">' +
                    '<div class="searchable-select" data-field="' + field.id + '">' +
                    '<input type="text" class="select-search line-input" id="' + inputId + '-search" ' +
                        'placeholder="Search..." data-field="' + field.id + '" autocomplete="off">' +
                    '<select class="line-input select-hidden" id="' + inputId + '" data-field="' + field.id + '">' +
                    '<option value="">--</option>';
                field.options.forEach(function(opt) {
                    var selected = (String(value) === String(opt.value)) ? ' selected' : '';
                    html += '<option value="' + escapeHtml(opt.value) + '"' + selected + '>' + escapeHtml(opt.text) + '</option>';
                });
                html += '</select>' +
                    '<div class="select-dropdown"></div>' +
                    '</div></td>';
                return html;
            }
            // Select field requiring API lookup (large list like account, customer, item)
            else if (field.type === 'select' && (field.lookupRequired || field.hasOptions)) {
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
            if (fieldId === 'account') return 'accounts';
            if (fieldId === 'item') return 'items';
            if (fieldId === 'customer') return 'customers';
            if (fieldId === 'department') return 'departments';
            if (fieldId === 'class') return 'classes';
            if (fieldId === 'location') return 'locations';
            if (fieldId === 'entity') return 'vendors';
            return 'generic';
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
                });
            });

            // ========== LINE ITEM OPERATIONS (Delegated for all sublists) ==========
            var lineSection = el('.line-section');
            if (lineSection) {
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
            }

            // Shortcuts help
            this.on('#btn-shortcuts', 'click', function() {
                self.showShortcutsHelp();
            });
        },

        // ==========================================
        // SUBLIST LINE OPERATIONS
        // ==========================================
        addSublistLine: function(sublistId) {
            if (!this.sublistData) this.sublistData = {};
            if (!this.sublistData[sublistId]) this.sublistData[sublistId] = [];

            // Create empty line based on sublist type
            var newLine = { amount: 0 };
            if (sublistId === 'expense') {
                newLine.account = '';
                newLine.memo = '';
            } else if (sublistId === 'item') {
                newLine.item = '';
                newLine.description = '';
                newLine.quantity = 1;
                newLine.rate = 0;
            }

            this.sublistData[sublistId].push(newLine);
            this.changes[sublistId + 'Lines'] = this.sublistData[sublistId];
            this.markUnsaved();
            this.refreshSublist(sublistId);
            this.updateTabCounts();
        },

        removeSublistLine: function(sublistId, idx) {
            if (!this.sublistData || !this.sublistData[sublistId]) return;

            this.sublistData[sublistId].splice(idx, 1);
            this.changes[sublistId + 'Lines'] = this.sublistData[sublistId];
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

            // Get the sublist config from form fields
            var formFields = this.formFields || {};
            var sublists = formFields.sublists || [];
            var sublist = sublists.find(function(sl) { return sl.id === sublistId; });

            if (!sublist) return;

            // Re-render the sublist table
            var items = this.sublistData[sublistId] || [];
            var doc = { expenseLines: [], itemLines: [] };
            doc[sublistId === 'expense' ? 'expenseLines' : 'itemLines'] = items;

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

        approveDocument: function() {
            var self = this;

            // Check for required fields
            var vendorName = el('#field-vendor');
            var totalAmount = el('#field-totalAmount');

            if (!vendorName || !vendorName.value.trim()) {
                UI.toast('Vendor name is required', 'warning');
                if (vendorName) vendorName.focus();
                return;
            }

            if (!totalAmount || parseFloat(totalAmount.value) <= 0) {
                UI.toast('Total amount is required', 'warning');
                if (totalAmount) totalAmount.focus();
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
                    UI.toast('Document approved! Transaction created.', 'success');

                    // Go to next document or back to queue
                    if (self.queueIndex >= 0 && self.queueIndex < self.queueIds.length - 1) {
                        self.goToNextDocument();
                    } else {
                        Router.navigate('queue');
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

                    // Go to next document or back to queue
                    if (self.queueIndex >= 0 && self.queueIndex < self.queueIds.length - 1) {
                        self.goToNextDocument();
                    } else {
                        Router.navigate('queue');
                    }
                })
                .catch(function(err) {
                    UI.toast('Error: ' + err.message, 'error');
                });
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
            Router.navigate('queue');
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

            if (prevBtn) {
                prevBtn.disabled = this.queueIndex <= 0;
            }
            if (nextBtn) {
                nextBtn.disabled = this.queueIndex < 0 || this.queueIndex >= this.queueIds.length - 1;
            }
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
                        '<div class="shortcut-item"><kbd>Tab</kbd> <span>Next field</span></div>' +
                        '<div class="shortcut-item"><kbd>Shift+Tab</kbd> <span>Previous field</span></div>' +
                        '<div class="shortcut-item"><kbd>Enter</kbd> <span>Approve & next</span></div>' +
                        '<div class="shortcut-item"><kbd>Esc</kbd> <span>Back to queue</span></div>' +
                        '<div class="shortcut-item"><kbd>Ctrl+S</kbd> <span>Save changes</span></div>' +
                        '<div class="shortcut-item"><kbd>Ctrl+R</kbd> <span>Reject</span></div>' +
                        '<div class="shortcut-item"><kbd>Ctrl+←</kbd> <span>Previous doc</span></div>' +
                        '<div class="shortcut-item"><kbd>Ctrl+→</kbd> <span>Next doc</span></div>' +
                        '<div class="shortcut-item"><kbd>+/-</kbd> <span>Zoom in/out</span></div>' +
                        '<div class="shortcut-item"><kbd>Ctrl+0</kbd> <span>Reset zoom</span></div>' +
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
