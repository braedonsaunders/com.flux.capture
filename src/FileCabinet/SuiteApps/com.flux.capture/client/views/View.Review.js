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
        'KeyX': { action: 'reprocess', description: 'Reprocess document' },
        'KeyV': { action: 'splitView', description: 'Toggle split view' },
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
        formData: null, // User-edited form state - source of truth for saving
        hasUnsavedChanges: false,
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
        accountsData: [], // Cached accounts for sublist dropdowns
        itemsData: [], // Cached items for sublist dropdowns
        settings: null, // General app settings (defaultLineSublist, etc.)

        // Smart Auto-Coding suggestions
        codingSuggestions: {
            headerDefaults: {},
            lineItemSuggestions: [],
            meta: { hasLearning: false }
        },
        suggestionsApplied: false,

        // ==========================================
        // EXTRACTION POOL STATE
        // ==========================================
        extractionPool: {
            unmatched: [],      // Unmatched extracted fields
            applied: [],        // Applied items (for undo)
            panelExpanded: false,
            filterCategory: 'all',
            searchQuery: '',
            selectedCardId: null,
            dragActive: false,
            showAnnotations: false
        },

        // PDF.js state
        pdfDoc: null,
        pdfPage: null,
        pdfCanvas: null,
        pdfContext: null,
        pdfScale: 1.5,
        annotationOverlay: null,

        // Quick assign palette state
        quickAssignOpen: false,
        quickAssignTargetField: null,

        // Document type ID to transaction type mapping
        // 1: Invoice, 3: Credit Memo, 4: Expense Report, 5: Purchase Order
        DOC_TYPE_TO_TRANSACTION: {
            '1': 'vendorbill',
            '3': 'vendorcredit',    // Credit Memo
            '4': 'expensereport',
            '5': 'purchaseorder'
        },

        /**
         * Get the transaction type for a document type ID
         * @param {string|number} docType - Document type ID (1-5)
         * @returns {string} Transaction type (vendorbill, expensereport, etc.)
         */
        getTransactionType: function(docType) {
            return this.DOC_TYPE_TO_TRANSACTION[String(docType)] || 'vendorbill';
        },

        // ==========================================
        // INITIALIZATION
        // ==========================================
        init: function(params) {
            var self = this;
            this.docId = params && params.docId ? params.docId : null;
            this.changes = {};
            this.formData = null;
            this.hasUnsavedChanges = false;
            this.zoom = 1;
            this.rotation = 0;
            this.currentPage = 1;
            this.lineItems = [];
            this.formFields = null;
            this.transactionType = 'vendorbill'; // Reset to default, will be set from document
            this.accountsData = [];
            this.itemsData = [];
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

            // Load documents needing review and start with the first one (oldest first)
            API.get('list', { status: '4', pageSize: 100, sortDir: 'asc' }) // NEEDS_REVIEW
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

            // First load the document to get its type, then load form schema for that type
            API.get('document', { id: this.docId })
                .then(function(data) {
                    self.data = data;
                    self.lineItems = data.lineItems || [];
                    self.fieldConfidences = data.fieldConfidences || {};
                    self.totalPages = data.pageCount || 1;

                    // Derive transaction type from document's documentType
                    self.transactionType = self.getTransactionType(data.documentType);

                    // Now load form schema for the correct transaction type, plus accounts, items, and settings
                    return Promise.all([
                        API.get('formschema', { transactionType: self.transactionType }),
                        API.get('accounts', { accountType: 'Expense' }),
                        API.get('accounts', { accountType: 'COGS' }),
                        API.get('items', {}),
                        API.get('settings')
                    ]);
                })
                .then(function(results) {
                    var formSchemaData = results[0];
                    var expenseAccountsData = results[1] || [];
                    var cogsAccountsData = results[2] || [];
                    var itemsData = results[3] || [];
                    var settingsData = results[4] || {};

                    self.formFields = formSchemaData; // Now contains layout, config, etc.
                    self.expenseAccountsData = expenseAccountsData; // Expense accounts for expense sublist
                    self.cogsAccountsData = cogsAccountsData; // COGS accounts for item sublist
                    self.itemsData = itemsData; // Cache for document type changes
                    self.settings = settingsData.data || settingsData; // General app settings

                    // Inject accounts into expense sublist 'account' field
                    // Inject items into item sublist 'item' field
                    self.injectSublistOptions(expenseAccountsData, cogsAccountsData, itemsData);

                    // Initialize formData from server or create from extractedData
                    self.initializeFormData();

                    self.isLoading = false;
                    self.render();

                    // Fetch coding suggestions if vendor is already set
                    if (self.data && self.data.vendorId) {
                        self.fetchCodingSuggestions(self.data.vendorId);
                    }
                })
                .catch(function(err) {
                    console.error('[Review] Load error:', err);
                    self.isLoading = false;
                    self.showError(err.message);
                });
        },

        loadQueueContext: function() {
            var self = this;
            // Load list of documents for prev/next navigation (oldest first)
            API.get('list', { status: '4', pageSize: 100, sortDir: 'asc' }) // NEEDS_REVIEW
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
        injectSublistOptions: function(expenseAccountsData, cogsAccountsData, itemsData) {
            if (!this.formFields || !this.formFields.sublists) return;

            var sublists = this.formFields.sublists;

            sublists.forEach(function(sublist) {
                if (!sublist.fields) return;

                sublist.fields.forEach(function(field) {
                    // 'account' field (vendor bill sublists) → COGS + Expense accounts
                    if (field.id === 'account') {
                        field.type = 'select';
                        field.options = [].concat(cogsAccountsData || [], expenseAccountsData || []);
                    }

                    // 'expenseaccount' field (expense report) → Expense accounts only
                    if (field.id === 'expenseaccount' && expenseAccountsData.length > 0) {
                        field.type = 'select';
                        field.options = expenseAccountsData;
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
        // CONTENT TRANSITION ANIMATIONS
        // ==========================================

        /**
         * Trigger initial load animation (content slides in)
         */
        animateInitialLoad: function() {
            var content = el('#review-content');
            if (content) {
                content.classList.remove('exiting', 'entering');
                content.classList.add('initial-load');
            }
        },

        /**
         * Trigger content enter animation after data is loaded
         */
        animateContentEnter: function() {
            var content = el('#review-content');
            if (content) {
                content.classList.remove('exiting', 'initial-load');
                content.classList.add('entering');
            }
        },

        /**
         * Internal document transition - slides content out, loads new doc, slides new content in
         * @param {number} newDocId - Document ID to load
         */
        transitionToDocument: function(newDocId) {
            var self = this;
            var content = el('#review-content');

            // Start exit animation
            if (content) {
                content.classList.remove('entering', 'initial-load');
                content.classList.add('exiting');
            }

            // Update URL without triggering router navigation
            if (window.history && window.history.replaceState) {
                var newUrl = window.location.pathname + window.location.search.replace(/docId=\d+/, 'docId=' + newDocId);
                if (window.location.search.indexOf('docId=') === -1) {
                    newUrl = window.location.pathname + '?docId=' + newDocId;
                }
                window.history.replaceState({ docId: newDocId }, '', newUrl);
            }

            // Update state
            this.docId = newDocId;
            this.queueIndex = this.queueIds.indexOf(parseInt(newDocId, 10));
            this.changes = {};
            this.formData = null;
            this.hasUnsavedChanges = false;
            this.zoom = 1;
            this.rotation = 0;
            this.currentPage = 1;
            this.lineItems = [];
            this.pdfDoc = null;
            this.pdfPage = null;
            this.isLoading = true;

            // Reset coding suggestions
            this.codingSuggestions = {
                headerDefaults: {},
                lineItemSuggestions: [],
                meta: { hasLearning: false }
            };
            this.suggestionsApplied = false;

            // Reset extraction pool
            this.extractionPool = {
                unmatched: [],
                applied: [],
                panelExpanded: false,
                filterCategory: 'all',
                searchQuery: '',
                selectedCardId: null,
                dragActive: false,
                showAnnotations: this.extractionPool.showAnnotations // Preserve toggle state
            };

            // Update navigation buttons immediately
            this.updateNavigationButtons();

            // Wait for exit animation, then load and render new content
            setTimeout(function() {
                // Load new document data
                API.get('document', { id: newDocId })
                    .then(function(data) {
                        self.data = data;
                        self.transactionType = self.getTransactionType(data.documentType);

                        // Load form schema and supporting data
                        return Promise.all([
                            API.get('formschema', { transactionType: self.transactionType }),
                            API.get('accounts', { accountType: 'Expense' }),
                            API.get('accounts', { accountType: 'COGS' }),
                            API.get('items', {}),
                            API.get('settings')
                        ]);
                    })
                    .then(function(results) {
                        self.formFields = results[0];
                        self.expenseAccountsData = results[1] || [];
                        self.cogsAccountsData = results[2] || [];
                        self.itemsData = results[3] || [];
                        self.settings = results[4] && results[4].data ? results[4].data : results[4] || {};

                        self.injectSublistOptions(self.expenseAccountsData, self.cogsAccountsData, self.itemsData);
                        self.initializeFormData();

                        self.isLoading = false;

                        // Render new content
                        self.renderToolbar();
                        self.renderPreview();
                        self.renderExtractionForm();

                        // Animate content in
                        self.animateContentEnter();

                        // Fetch coding suggestions if vendor is set
                        if (self.data && self.data.vendorId) {
                            self.fetchCodingSuggestions(self.data.vendorId);
                        }
                    })
                    .catch(function(err) {
                        console.error('[Review] Transition error:', err);
                        self.isLoading = false;
                        self.animateContentEnter();
                        self.showError(err.message);
                    });
            }, 300); // Match slideOut animation duration
        },

        /**
         * Initialize formData from server-saved data or create from extractedData
         * formData is the source of truth for form values and transaction creation
         */
        initializeFormData: function() {
            var doc = this.data;

            // If formData exists from server, use it
            if (doc.formData && typeof doc.formData === 'object') {
                this.formData = doc.formData;
                FCDebug.log('[FormData] Loaded from server:', this.formData);
                return;
            }

            // Otherwise, initialize from extractedData and document fields
            var extractedData = doc.extractedData || {};
            var bodyFields = {};

            // Map extracted/document fields to NS field IDs
            // These are the common mappings between our extraction and NS fields
            var fieldMappings = {
                'entity': ['vendor', 'vendorId'],
                'tranid': ['invoiceNumber', 'tranid'],
                'trandate': ['invoiceDate', 'trandate'],
                'duedate': ['dueDate', 'duedate'],
                'currency': ['currency'],
                'memo': ['memo', 'description'],
                'terms': ['paymentTerms', 'terms']
            };

            // Populate bodyFields from extractedData using mappings
            Object.keys(fieldMappings).forEach(function(nsFieldId) {
                var sourceKeys = fieldMappings[nsFieldId];
                for (var i = 0; i < sourceKeys.length; i++) {
                    var key = sourceKeys[i];
                    var value = extractedData[key] || doc[key];
                    if (value !== undefined && value !== null && value !== '') {
                        bodyFields[nsFieldId] = value;
                        // Also store display text if available
                        var displayKey = key + '_display';
                        if (extractedData[displayKey] || doc[displayKey]) {
                            bodyFields[nsFieldId + '_display'] = extractedData[displayKey] || doc[displayKey];
                        }
                        break;
                    }
                }
            });

            // Handle vendor specially - need both ID and display name
            if (doc.vendor) {
                bodyFields.entity = doc.vendor;
                bodyFields.entity_display = doc.vendorName || '';
            }

            // Initialize sublists from lineItems
            var sublists = {
                expense: [],
                item: []
            };

            // Parse existing line items into sublists
            // Use defaultLineSublist setting: 'auto' (detect), 'expense', or 'item'
            var defaultSublist = (this.settings && this.settings.defaultLineSublist) || 'auto';
            var lineItems = doc.lineItems || [];
            if (Array.isArray(lineItems) && lineItems.length > 0) {
                lineItems.forEach(function(line) {
                    // Determine which sublist based on setting and line content
                    if (defaultSublist === 'item') {
                        // Force all lines to item sublist
                        sublists.item.push(line);
                    } else if (defaultSublist === 'expense') {
                        // Force all lines to expense sublist
                        sublists.expense.push(line);
                    } else {
                        // Auto-detect: if line has 'item' field populated, use item sublist
                        if (line.item) {
                            sublists.item.push(line);
                        } else {
                            sublists.expense.push(line);
                        }
                    }
                });
            }

            // Build formData structure
            this.formData = {
                bodyFields: bodyFields,
                sublists: sublists,
                _meta: {
                    transactionType: this.transactionType,
                    initializedFrom: 'extractedData',
                    initializedAt: new Date().toISOString()
                }
            };

            FCDebug.log('[FormData] Initialized from extractedData:', this.formData);
        },

        /**
         * Collect current form state from DOM into formData structure
         * Call this before saving to ensure formData reflects current UI state
         */
        collectFormData: function() {
            var self = this;
            var bodyFields = {};
            var sublists = {};

            // Collect body fields
            var panel = el('#extraction-panel');
            if (panel) {
                // Regular inputs and selects
                panel.querySelectorAll('input[data-field], select[data-field], textarea[data-field]').forEach(function(input) {
                    var fieldId = input.dataset.field;
                    if (!fieldId) return;

                    // Skip sublist inputs (they have different data attributes)
                    if (input.closest('.sublist-table')) return;

                    var value = input.value;

                    // Handle checkboxes
                    if (input.type === 'checkbox') {
                        value = input.checked ? 'T' : 'F';
                    }

                    // Store the value
                    bodyFields[fieldId] = value;
                });

                // Collect typeahead display values
                panel.querySelectorAll('.typeahead-select[data-field]').forEach(function(wrapper) {
                    var fieldId = wrapper.dataset.field;
                    var hiddenInput = wrapper.querySelector('input[type="hidden"]');
                    var displayInput = wrapper.querySelector('.typeahead-input');

                    if (hiddenInput && hiddenInput.value) {
                        bodyFields[fieldId] = hiddenInput.value;
                    }
                    if (displayInput && displayInput.value) {
                        bodyFields[fieldId + '_display'] = displayInput.value;
                    }
                });

                // Collect vendor field (special handling - no data-field attribute)
                var vendorInput = el('#field-vendor');
                var vendorIdInput = el('#field-vendorId');
                if (vendorInput) {
                    bodyFields.entity_display = vendorInput.value || '';
                }
                if (vendorIdInput) {
                    bodyFields.entity = vendorIdInput.value || '';
                }
            }

            // Collect sublist data from sublistData (already tracked)
            if (this.sublistData) {
                Object.keys(this.sublistData).forEach(function(sublistId) {
                    var normalizedId = sublistId.toLowerCase();
                    sublists[normalizedId] = self.sublistData[sublistId] || [];
                });
            }

            // Merge tracked changes into bodyFields
            // This ensures any programmatically tracked changes are included
            if (this.changes) {
                Object.keys(this.changes).forEach(function(key) {
                    // Map change keys to bodyField keys
                    if (key === 'vendorName') {
                        bodyFields.entity_display = self.changes[key];
                    } else if (key === 'vendorId') {
                        bodyFields.entity = self.changes[key];
                    } else {
                        // For other changes, use as-is
                        bodyFields[key] = self.changes[key];
                    }
                });
            }

            // Update formData
            this.formData = this.formData || {};
            this.formData.bodyFields = bodyFields;
            this.formData.sublists = sublists;
            this.formData._meta = this.formData._meta || {};
            this.formData._meta.transactionType = this.transactionType;
            this.formData._meta.collectedAt = new Date().toISOString();

            FCDebug.log('[FormData] Collected from DOM:', this.formData);
            return this.formData;
        },

        // ==========================================
        // EVENT BINDING
        // ==========================================
        bindEvents: function() {
            var self = this;

            // Document type dropdown
            this.on('#doc-type-badge', 'click', function(e) {
                e.stopPropagation();
                var dropdown = el('#doc-type-dropdown');
                if (dropdown) dropdown.classList.toggle('open');
            });

            this.on('#doc-type-options', 'click', function(e) {
                var option = e.target.closest('.doc-type-option');
                if (!option) return;

                var newType = option.dataset.type;
                var newTypeText = option.textContent;
                self.changeDocumentType(newType, newTypeText);

                var dropdown = el('#doc-type-dropdown');
                if (dropdown) dropdown.classList.remove('open');
            });

            // Close dropdown when clicking outside
            document.addEventListener('click', function(e) {
                if (!e.target.closest('#doc-type-dropdown')) {
                    var dropdown = el('#doc-type-dropdown');
                    if (dropdown) dropdown.classList.remove('open');
                }
                // Close transform dropdowns when clicking outside
                if (!e.target.closest('.transform-dropdown')) {
                    document.querySelectorAll('.transform-dropdown.open').forEach(function(d) {
                        d.classList.remove('open');
                    });
                }
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

            // Reprocess button
            this.on('#btn-reprocess', 'click', function() {
                self.reprocessDocument();
            });

            // Note: Save button (#btn-save) is bound in bindFormEvents()
            // because it's rendered dynamically in renderExtractionForm()

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

            // View mode toggle (split view)
            this.on('#btn-view-mode', 'click', function() {
                self.toggleSplitView();
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
                if (self.data && self.data.fileUrl) {
                    // Use the actual file URL from NetSuite
                    window.open(self.data.fileUrl, '_blank');
                } else if (self.data && self.data.sourceFile) {
                    // Fallback to NetSuite media URL format
                    window.open('/core/media/media.nl?id=' + self.data.sourceFile + '&c=' + (window.companyId || ''), '_blank');
                } else {
                    UI.toast('No file available for download', 'warning');
                }
            });

            // Keyboard shortcuts button
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
                    // Cmd/Ctrl+Shift+V for Quick Assign palette (when in an input field)
                    if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key === 'v') {
                        e.preventDefault();
                        self.openQuickAssignPalette(e.target);
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
                    case 'reprocess': self.reprocessDocument(); break;
                    case 'splitView': self.toggleSplitView(); break;
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

            // Auto-select subsidiary if only one exists
            this.autoSelectSingleOptions();

            // Animate content in (initial load)
            this.animateInitialLoad();

            // Focus first field
            setTimeout(function() {
                var firstInput = document.querySelector('.extraction-panel input:not([type="hidden"])');
                if (firstInput) firstInput.focus();
            }, 100);
        },

        // Auto-select fields that only have one option (like subsidiary in single-sub accounts)
        // Also resolves posting period to current period when configured
        autoSelectSingleOptions: function() {
            var self = this;

            // Check for subsidiary field that needs auto-select
            var subsidiaryField = el('#field-subsidiary');
            var subsidiaryDisplay = el('#field-subsidiary-display');

            // Only auto-select if field exists and is empty
            if (subsidiaryField && !subsidiaryField.value && subsidiaryDisplay) {
                API.get('datasource', { type: 'subsidiaries' }).then(function(response) {
                    var data = response.data || response;
                    var options = data.options || data;
                    var defaultValue = data.defaultValue;

                    // If defaultValue is set (means only one subsidiary), auto-select it
                    if (defaultValue && options && options.length === 1) {
                        var option = options[0];
                        subsidiaryField.value = option.value;
                        subsidiaryDisplay.value = option.text;
                        // Note: Don't track as change - this is auto-initialization, not user edit
                    }
                }).catch(function() {
                    // Ignore errors - not critical
                });
            }

            // Auto-select current period for posting period field
            this.resolveCurrentPeriodDefault();
        },

        // Resolve posting period to current period when configured with __CURRENT_PERIOD__ or no default
        resolveCurrentPeriodDefault: function() {
            var self = this;

            // Find posting period field that needs current period resolution
            var periodWrapper = document.querySelector('.typeahead-select[data-needs-current-period="true"]');
            if (!periodWrapper) return;

            var periodField = periodWrapper.querySelector('input[type="hidden"]');
            var periodDisplay = periodWrapper.querySelector('.typeahead-input');

            // Only resolve if field exists and is empty
            if (!periodField || periodField.value || !periodDisplay) return;

            // Fetch current period from API
            API.get('datasource', { type: 'accountingperiods' }).then(function(response) {
                var data = response.data || response;
                var currentPeriod = data.currentPeriod;

                // If we have a current period, auto-select it
                if (currentPeriod && currentPeriod.value) {
                    periodField.value = currentPeriod.value;
                    periodDisplay.value = currentPeriod.text;
                    // Note: Don't track as change - this is auto-initialization, not user edit
                    // Remove the data attribute since we've resolved it
                    periodWrapper.removeAttribute('data-needs-current-period');
                }
            }).catch(function() {
                // Ignore errors - not critical
            });
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

            // Update document type badge
            var badgeText = el('#doc-type-badge .badge-text');
            if (badgeText) badgeText.textContent = doc.documentTypeText || 'Invoice';

            // Mark current document type as selected
            var currentType = String(doc.documentType || '1');
            var options = document.querySelectorAll('.doc-type-option');
            options.forEach(function(opt) {
                opt.classList.toggle('selected', opt.dataset.type === currentType);
            });

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

            var fileUrl = this.data.fileUrl || (this.data.sourceFile ? '/core/media/media.nl?id=' + this.data.sourceFile : null);

            if (fileUrl && typeof pdfjsLib !== 'undefined') {
                // Use PDF.js for rendering with annotation support
                this.renderPdfWithAnnotations(viewport, fileUrl);
            } else if (fileUrl) {
                // Fallback to iframe if PDF.js not available
                var iframeStyle = 'width:100%;height:100%;border:none;background:white;' +
                    'transform:scale(' + this.zoom + ') rotate(' + this.rotation + 'deg);' +
                    'transform-origin:center center;';
                viewport.innerHTML = '<iframe src="' + fileUrl + '#toolbar=0" id="doc-preview" style="' + iframeStyle + '"></iframe>';
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

        // ==========================================
        // PDF.JS RENDERING WITH ANNOTATIONS
        // ==========================================
        renderPdfWithAnnotations: function(viewport, fileUrl) {
            var self = this;

            // Create container structure - wrap canvas and overlay in a positioned wrapper
            viewport.innerHTML = '<div class="pdf-container" id="pdf-container">' +
                '<div class="pdf-loading"><div class="loading-spinner"></div><span>Loading document...</span></div>' +
                '<div class="pdf-page-wrapper" id="pdf-page-wrapper">' +
                    '<canvas id="pdf-canvas"></canvas>' +
                    '<div class="annotation-overlay" id="annotation-overlay"></div>' +
                '</div>' +
            '</div>';

            var container = el('#pdf-container');
            var canvas = el('#pdf-canvas');
            var loadingEl = viewport.querySelector('.pdf-loading');

            if (!canvas) return;

            this.pdfCanvas = canvas;
            this.pdfContext = canvas.getContext('2d');
            this.annotationOverlay = el('#annotation-overlay');

            // Load the PDF
            var loadingTask = pdfjsLib.getDocument(fileUrl);
            loadingTask.promise.then(function(pdf) {
                self.pdfDoc = pdf;
                self.totalPages = pdf.numPages;

                // Update page display
                var pageDisplay = el('#page-display');
                if (pageDisplay) {
                    pageDisplay.textContent = self.currentPage + ' / ' + self.totalPages;
                }

                // Render the first page
                self.renderPdfPage(self.currentPage);

                // Hide loading
                if (loadingEl) loadingEl.style.display = 'none';

            }).catch(function(error) {
                console.error('[PDF.js] Error loading PDF:', error);
                // Fallback to iframe
                viewport.innerHTML = '<iframe src="' + fileUrl + '#toolbar=0" id="doc-preview" ' +
                    'style="width:100%;height:100%;border:none;background:white;"></iframe>';
            });
        },

        renderPdfPage: function(pageNum) {
            var self = this;
            if (!this.pdfDoc) return;

            this.pdfDoc.getPage(pageNum).then(function(page) {
                self.pdfPage = page;

                // Calculate scale to fit container
                var container = el('#pdf-container');
                var containerWidth = container ? container.clientWidth - 40 : 600;
                var originalViewport = page.getViewport({ scale: 1 });
                var baseScale = (containerWidth / originalViewport.width) * self.zoom;

                var viewport = page.getViewport({ scale: baseScale, rotation: self.rotation });

                // Handle high DPI displays (Retina, etc.) for crisp rendering
                var dpr = window.devicePixelRatio || 1;

                // Set canvas dimensions - scale up for DPI
                self.pdfCanvas.width = Math.floor(viewport.width * dpr);
                self.pdfCanvas.height = Math.floor(viewport.height * dpr);

                // Set CSS dimensions to display at correct size
                self.pdfCanvas.style.width = viewport.width + 'px';
                self.pdfCanvas.style.height = viewport.height + 'px';

                // Scale the context to match DPI
                self.pdfContext.setTransform(dpr, 0, 0, dpr, 0, 0);

                // Set annotation overlay dimensions
                if (self.annotationOverlay) {
                    self.annotationOverlay.style.width = viewport.width + 'px';
                    self.annotationOverlay.style.height = viewport.height + 'px';
                }

                // Render the page
                var renderContext = {
                    canvasContext: self.pdfContext,
                    viewport: viewport
                };

                page.render(renderContext).promise.then(function() {
                    // Render annotations after page is rendered
                    if (self.extractionPool.showAnnotations) {
                        self.renderExtractionAnnotations(viewport);
                    }
                });
            });
        },

        // ==========================================
        // EXTRACTION ANNOTATIONS ON DOCUMENT
        // ==========================================
        renderExtractionAnnotations: function(pdfViewport) {
            var self = this;
            if (!this.annotationOverlay) return;

            // Clear existing annotations
            this.annotationOverlay.innerHTML = '';

            var extractedData = this.data.extractedData || {};
            var allFields = extractedData._allExtractedFields || {};

            // Get matched field IDs to distinguish matched vs unmatched
            var matchedFieldIds = this.getMatchedFieldIds();

            // Standard page dimensions in inches (letter size)
            var PAGE_WIDTH_INCHES = 8.5;
            var PAGE_HEIGHT_INCHES = 11;

            Object.keys(allFields).forEach(function(key) {
                var field = allFields[key];
                if (!field.position) return;

                var pos = field.position;
                var isMatched = matchedFieldIds.indexOf(key) !== -1;

                // Create annotation box
                var box = document.createElement('div');
                box.className = 'extraction-annotation ' + (isMatched ? 'matched' : 'unmatched');
                box.dataset.fieldKey = key;
                box.dataset.fieldValue = field.value || '';
                box.dataset.fieldLabel = field.label || key;

                // Get raw position values (handle both width/height and w/h property names)
                var rawX = pos.x || 0;
                var rawY = pos.y || 0;
                var rawW = pos.width || pos.w || 0.5;
                var rawH = pos.height || pos.h || 0.1;

                // Detect coordinate system and convert to pixel coordinates
                // If values > 1, they're likely in inches (Azure) or points (PDF)
                // If values <= 1, they're normalized (0-1)
                var x, y, w, h;

                if (rawX > 1 || rawY > 1 || rawW > 1 || rawH > 1) {
                    // Coordinates are in inches - convert to viewport pixels
                    // Scale: viewport pixels / page inches
                    var scaleX = pdfViewport.width / PAGE_WIDTH_INCHES;
                    var scaleY = pdfViewport.height / PAGE_HEIGHT_INCHES;

                    x = rawX * scaleX;
                    y = rawY * scaleY;
                    w = rawW * scaleX;
                    h = rawH * scaleY;
                } else {
                    // Coordinates are normalized (0-1)
                    x = rawX * pdfViewport.width;
                    y = rawY * pdfViewport.height;
                    w = rawW * pdfViewport.width;
                    h = rawH * pdfViewport.height;
                }

                // Clamp to viewport bounds
                x = Math.max(0, Math.min(x, pdfViewport.width - 20));
                y = Math.max(0, Math.min(y, pdfViewport.height - 16));
                w = Math.max(20, Math.min(w, pdfViewport.width - x));
                h = Math.max(16, Math.min(h, pdfViewport.height - y));

                box.style.left = x + 'px';
                box.style.top = y + 'px';
                box.style.width = w + 'px';
                box.style.height = h + 'px';

                // Add tooltip
                box.title = (field.label || key) + ': ' + (field.value || '') + (isMatched ? ' (Matched)' : ' (Drag to assign)');

                // Make unmatched annotations draggable
                if (!isMatched) {
                    box.draggable = true;
                    box.style.cursor = 'grab';

                    box.addEventListener('dragstart', function(e) {
                        self.extractionPool.dragActive = true;
                        e.dataTransfer.effectAllowed = 'copy';
                        e.dataTransfer.setData('text/plain', JSON.stringify({
                            key: key,
                            value: field.value || '',
                            id: 'annotation_' + key
                        }));
                        box.classList.add('dragging');
                        document.body.classList.add('extraction-dragging');
                    });

                    box.addEventListener('dragend', function() {
                        self.extractionPool.dragActive = false;
                        box.classList.remove('dragging');
                        document.body.classList.remove('extraction-dragging');
                        document.querySelectorAll('.form-field.drop-target').forEach(function(f) {
                            f.classList.remove('drop-target', 'drop-hover');
                        });
                    });

                    // Click handler as alternative
                    box.addEventListener('click', function(e) {
                        e.stopPropagation();
                        self.showAnnotationAssignPopover(box, field, key);
                    });
                }

                self.annotationOverlay.appendChild(box);
            });
        },

        showAnnotationAssignPopover: function(box, field, key) {
            var self = this;

            // Remove any existing popover
            var existing = document.querySelector('.annotation-popover');
            if (existing) existing.remove();

            // Create popover
            var popover = document.createElement('div');
            popover.className = 'annotation-popover';
            popover.innerHTML = '<div class="popover-header">' +
                '<span class="popover-label">' + escapeHtml(field.label || key) + '</span>' +
                '<span class="popover-confidence">' + Math.round((field.confidence || 0) * 100) + '%</span>' +
            '</div>' +
            '<div class="popover-value">"' + escapeHtml(String(field.value || '').substring(0, 50)) + '"</div>' +
            '<div class="popover-assign">' +
                '<label>Assign to:</label>' +
                '<select class="popover-field-select" id="popover-field-select">' +
                    '<option value="">-- Select field --</option>' +
                '</select>' +
            '</div>' +
            '<div class="popover-actions">' +
                '<button class="btn btn-sm btn-ghost popover-cancel">Cancel</button>' +
                '<button class="btn btn-sm btn-primary popover-apply" disabled>Apply</button>' +
            '</div>';

            // Position popover near the box
            var rect = box.getBoundingClientRect();
            popover.style.position = 'fixed';
            popover.style.left = rect.right + 10 + 'px';
            popover.style.top = rect.top + 'px';
            popover.style.zIndex = '10001';

            document.body.appendChild(popover);

            // Populate field select with form fields
            var select = popover.querySelector('#popover-field-select');
            this.populateFieldSelect(select);

            // Enable apply button when field selected
            select.addEventListener('change', function() {
                popover.querySelector('.popover-apply').disabled = !this.value;
            });

            // Cancel button
            popover.querySelector('.popover-cancel').addEventListener('click', function() {
                popover.remove();
            });

            // Apply button
            popover.querySelector('.popover-apply').addEventListener('click', function() {
                var targetFieldId = select.value;
                if (targetFieldId) {
                    self.applyExtractionToField(key, field, targetFieldId);
                    popover.remove();
                }
            });

            // Close on click outside
            setTimeout(function() {
                document.addEventListener('click', function closePopover(e) {
                    if (!popover.contains(e.target) && !box.contains(e.target)) {
                        popover.remove();
                        document.removeEventListener('click', closePopover);
                    }
                });
            }, 100);
        },

        populateFieldSelect: function(select) {
            var self = this;
            var formFields = this.formFields || {};
            var bodyFields = formFields.bodyFields || [];
            var layout = formFields.layout || {};
            var tabs = formFields.tabs || layout.tabs || [];

            // Helper to add a field option
            function addFieldOption(parent, fieldId, label) {
                var option = document.createElement('option');
                option.value = fieldId;
                option.textContent = label || fieldId;
                parent.appendChild(option);
            }

            // Add vendor field first (always at top)
            addFieldOption(select, 'vendor', 'Vendor');

            // If we have tabs with field groups, mirror that structure
            if (tabs.length > 0) {
                tabs.forEach(function(tab) {
                    // Skip tabs without field groups
                    if (!tab.fieldGroups || tab.fieldGroups.length === 0) return;

                    // Create optgroup for each tab
                    var tabGroup = document.createElement('optgroup');
                    tabGroup.label = '── ' + (tab.label || tab.id) + ' ──';
                    var hasFields = false;

                    tab.fieldGroups.forEach(function(group) {
                        if (group.visible === false) return;

                        var fields = group.fields || [];
                        fields.forEach(function(fieldRef) {
                            var fieldId = typeof fieldRef === 'object' ? fieldRef.id : fieldRef;
                            if (!fieldId || fieldId.toLowerCase() === 'entity' || fieldId.toLowerCase() === 'vendor') return;

                            // Look up field in bodyFields for label
                            var nsField = bodyFields.find(function(f) { return f.id === fieldId; });
                            var label = (nsField && nsField.label) || (typeof fieldRef === 'object' && fieldRef.label) || fieldId;

                            // Skip hidden fields
                            if (nsField && nsField.isDisplay === false) return;

                            addFieldOption(tabGroup, fieldId, label);
                            hasFields = true;
                        });
                    });

                    if (hasFields) {
                        select.appendChild(tabGroup);
                    }
                });
            } else {
                // Fallback: group by common categories
                var amounts = document.createElement('optgroup');
                amounts.label = '── Amounts ──';
                addFieldOption(amounts, 'subtotal', 'Subtotal');
                addFieldOption(amounts, 'taxAmount', 'Tax Amount');
                addFieldOption(amounts, 'totalAmount', 'Total Amount');
                select.appendChild(amounts);

                var dates = document.createElement('optgroup');
                dates.label = '── Dates ──';
                addFieldOption(dates, 'invoiceDate', 'Invoice Date');
                addFieldOption(dates, 'dueDate', 'Due Date');
                select.appendChild(dates);

                var refs = document.createElement('optgroup');
                refs.label = '── References ──';
                addFieldOption(refs, 'invoiceNumber', 'Invoice Number');
                addFieldOption(refs, 'poNumber', 'PO Number');
                select.appendChild(refs);

                // Add remaining body fields
                if (bodyFields.length > 0) {
                    var other = document.createElement('optgroup');
                    other.label = '── Other Fields ──';
                    var standardIds = ['vendor', 'entity', 'subtotal', 'taxamount', 'totalamount',
                        'invoicedate', 'duedate', 'invoicenumber', 'ponumber'];
                    var hasOther = false;

                    bodyFields.forEach(function(field) {
                        if (field.isDisplay === false) return;
                        if (standardIds.indexOf(field.id.toLowerCase()) !== -1) return;

                        addFieldOption(other, field.id, field.label || field.id);
                        hasOther = true;
                    });

                    if (hasOther) {
                        select.appendChild(other);
                    }
                }
            }
        },

        getMatchedFieldIds: function() {
            // Return list of field keys that have been matched to form fields
            var matched = [];
            var extractedData = this.data.extractedData || {};
            var doc = this.data || {};

            // Standard mapped fields (these are extracted and mapped to specific form fields)
            var standardFields = ['vendor', 'vendorname', 'vendorName', 'invoicenumber', 'invoiceNumber',
                'invoicedate', 'invoiceDate', 'duedate', 'dueDate', 'subtotal', 'taxamount', 'taxAmount',
                'totalamount', 'totalAmount', 'ponumber', 'poNumber', 'currency'];

            standardFields.forEach(function(f) {
                // Check both extractedData and doc for the field
                if (extractedData[f] !== undefined && extractedData[f] !== '' && extractedData[f] !== null) {
                    matched.push(f.toLowerCase());
                }
                if (doc[f] !== undefined && doc[f] !== '' && doc[f] !== null) {
                    matched.push(f.toLowerCase());
                }
            });

            // Only mark additional fields as matched if they were explicitly mapped to form fields
            // Do NOT mark all extractedData keys as matched - that would hide everything in extraction pool
            // Instead, only mark fields that have corresponding form field inputs on the page
            var formFieldInputs = document.querySelectorAll('#extraction-panel [id^="field-"]');
            formFieldInputs.forEach(function(input) {
                var fieldId = input.id.replace('field-', '').toLowerCase();
                if (matched.indexOf(fieldId) === -1) {
                    matched.push(fieldId);
                }
            });

            // Include extraction keys that have been applied via drag/drop
            var self = this;
            if (this.extractionPool && this.extractionPool.applied) {
                this.extractionPool.applied.forEach(function(item) {
                    if (item.extractionKey && matched.indexOf(item.extractionKey) === -1) {
                        matched.push(item.extractionKey);
                    }
                });
            }

            // Remove duplicates
            return matched.filter(function(item, pos) {
                return matched.indexOf(item) === pos;
            });
        },

        toggleAnnotations: function() {
            this.extractionPool.showAnnotations = !this.extractionPool.showAnnotations;

            var btn = el('#btn-toggle-annotations');
            if (btn) {
                btn.classList.toggle('active', this.extractionPool.showAnnotations);
            }

            if (this.pdfPage && this.pdfCanvas) {
                // Use CSS dimensions (not canvas.width which includes DPI scaling)
                var cssWidth = parseFloat(this.pdfCanvas.style.width) || this.pdfCanvas.clientWidth;
                var viewport = this.pdfPage.getViewport({
                    scale: cssWidth / this.pdfPage.getViewport({ scale: 1 }).width,
                    rotation: this.rotation
                });
                if (this.extractionPool.showAnnotations) {
                    this.renderExtractionAnnotations(viewport);
                } else {
                    if (this.annotationOverlay) {
                        this.annotationOverlay.innerHTML = '';
                    }
                }
            }
        },

        renderExtractionForm: function() {
            var self = this;
            var panel = el('#extraction-panel');
            if (!panel) return;

            var doc = this.data;
            // Normalize confidence: may be stored as decimal (0-1) or percentage (0-100)
            var rawConf = parseFloat(doc.confidence) || 0;
            var normalizedConfidence = rawConf <= 1 ? Math.round(rawConf * 100) : Math.round(rawConf);
            var confClass = getConfidenceClass(normalizedConfidence);
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
                            FCDebug.log('[View.Review] Merged column order for', sl.id, ':', sl.columnOrder.join(', '));
                        }
                    }
                });
            }

            // Get column limit from config (default 10)
            this.sublistColumnLimit = config.sublistColumnLimit || 10;

            var html = '';

            // ========== INFO ALERT - How extraction works ==========
            html += '<div class="extraction-info-alert">' +
                '<i class="fas fa-lightbulb"></i>' +
                '<div class="info-content">' +
                    '<strong>AI-Extracted Data</strong> ' +
                    '<span>Review the extracted values below. Click any field to edit, then Save to create the transaction in NetSuite.</span>' +
                '</div>' +
            '</div>';

            // ========== COMPACT STATUS BAR (Confidence + Alerts) ==========
            html += '<div class="form-section status-bar-section">' +
                '<div class="status-bar">' +
                    '<div class="status-item confidence-status ' + confClass + '">' +
                        '<span class="status-value">' + normalizedConfidence + '%</span>' +
                        '<span class="status-label">' + (confClass === 'high' ? 'High' : confClass === 'medium' ? 'Medium' : 'Low') + '</span>' +
                    '</div>' +
                    (anomalies.length > 0 ?
                        '<div class="status-item alert-status" id="alert-status-toggle">' +
                            '<i class="fas fa-triangle-exclamation"></i>' +
                            '<span class="status-value">' + anomalies.length + '</span>' +
                            '<span class="status-label">Alert' + (anomalies.length > 1 ? 's' : '') + '</span>' +
                            '<i class="fas fa-chevron-down alert-chevron"></i>' +
                        '</div>' : '') +
                    '<div class="status-spacer"></div>' +
                    '<button class="btn btn-ghost btn-sm" id="btn-shortcuts" title="Keyboard Shortcuts">' +
                        '<i class="fas fa-keyboard"></i>' +
                    '</button>' +
                '</div>' +
                (anomalies.length > 0 ?
                    '<div class="alert-details" id="alert-details" style="display:none;">' +
                        anomalies.map(function(a) {
                            return '<div class="alert-detail-item alert-' + a.severity + '">' +
                                '<i class="fas fa-' + (a.severity === 'high' ? 'exclamation-circle' : 'info-circle') + '"></i>' +
                                '<span>' + escapeHtml(a.message) + '</span>' +
                            '</div>';
                        }).join('') +
                    '</div>' : '') +
            '</div>';

            // ========== EXTRACTION POOL PANEL ==========
            // Compute unmatched extractions
            this.computeUnmatchedExtractions();
            var unmatchedCount = this.extractionPool.unmatched.length;

            if (unmatchedCount > 0) {
                html += this.renderExtractionPoolPanel();
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
                    // Skip tabs marked as not visible
                    if (tab.visible === false) return false;

                    // Check if tab has any visible groups with visible fields
                    var hasGroups = tab.fieldGroups && tab.fieldGroups.some(function(g) {
                        // Skip groups marked as not visible
                        if (g.visible === false) return false;

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
                            // Skip groups marked as not visible in form config
                            if (group.visible === false) return;

                            var groupFields = [];
                            (group.fields || []).forEach(function(fieldRef) {
                                // Handle both field ID strings and field objects from DOM extraction
                                var fieldId = typeof fieldRef === 'object' ? fieldRef.id : fieldRef;
                                var normalizedFieldId = (fieldId || '').toLowerCase();

                                // Skip vendor/entity field (rendered specially at top) and customform (internal NS field)
                                if (normalizedFieldId === 'entity' || normalizedFieldId === 'vendor' || normalizedFieldId === 'customform') return;

                                // First check if DOM extraction gave us field metadata
                                var domField = typeof fieldRef === 'object' ? fieldRef : null;

                                // Look up in schema bodyFields for full field definition
                                var nsField = bodyFields.find(function(f) { return f.id === fieldId; });

                                // Check both isDisplay (schema) and visible (user config) flags
                                var fieldVisible = nsField && nsField.isDisplay !== false && nsField.visible !== false;
                                // Also check DOM field if it has visibility set
                                var domFieldVisible = domField && domField.visible !== false && domField.mode !== 'hidden';

                                if (fieldVisible) {
                                    // Merge DOM extraction data into schema field
                                    if (domField) {
                                        nsField.label = domField.label || nsField.label;
                                        nsField.type = domField.type || nsField.type;
                                        nsField.mandatory = domField.required || nsField.mandatory;
                                        nsField.isDisplay = domField.mode !== 'hidden' && domField.visible !== false;
                                        // Merge default values from layout field config
                                        if (domField.defaultValue) nsField.defaultValue = domField.defaultValue;
                                        if (domField.defaultValueText) nsField.defaultValueText = domField.defaultValueText;
                                    }
                                    groupFields.push(nsField);
                                } else if (domFieldVisible) {
                                    // Field not in schema but visible in DOM - use DOM data
                                    var newField = {
                                        id: fieldId,
                                        label: domField.label || fieldId,
                                        type: domField.type || 'text',
                                        mandatory: domField.required || false,
                                        isDisplay: true
                                    };
                                    // Copy default values from layout field config
                                    if (domField.defaultValue) newField.defaultValue = domField.defaultValue;
                                    if (domField.defaultValueText) newField.defaultValueText = domField.defaultValueText;
                                    groupFields.push(newField);
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

                            // Render fields directly in form-grid (CSS grid handles 2-column layout)
                            // Full-width fields will span both columns via grid-column: span 2
                            for (var i = 0; i < groupFields.length; i++) {
                                html += self.renderNsField(groupFields[i], doc);
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
                            FCDebug.log('[View.Review] Adding orphan sublists to first tab:', orphanSublists.map(function(s) { return s.id; }));
                            tabSublists = tabSublists.concat(orphanSublists);
                        }
                    }

                    if (tabSublists.length > 0) {
                        html += self.renderSublists(tabSublists, doc);
                    }

                    html += '</div>'; // close tab content
                });
            } else {
                // ========== NO LAYOUT - Show setup notice only ==========
                var transactionLabel = this.transactionType === 'vendorbill' ? 'Vendor Bill' :
                    this.transactionType === 'expensereport' ? 'Expense Report' :
                    this.transactionType === 'purchaseorder' ? 'Purchase Order' :
                    this.transactionType === 'vendorcredit' ? 'Vendor Credit' :
                    this.transactionType;

                html += '<div class="layout-notice">' +
                    '<div class="notice-icon"><i class="fas fa-cog"></i></div>' +
                    '<div class="notice-content">' +
                        '<strong>Form not configured for ' + transactionLabel + '</strong>' +
                        '<p>Go to <strong>Settings</strong> and upload a NetSuite form XML file to configure ' +
                        'which fields and tabs appear for this document type.</p>' +
                        '<a href="#settings" class="btn btn-primary btn-sm" style="margin-top: 8px;">' +
                            '<i class="fas fa-cog"></i> Go to Settings' +
                        '</a>' +
                    '</div>' +
                '</div>';
                // No fields rendered - user must configure form in Settings first
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

            // ========== BIND EXTRACTION POOL EVENTS ==========
            this.bindExtractionPoolEvents();
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
            var html = '<div class="form-section line-section">';

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
                    '<div class="line-items-table" id="lines-' + sl.id + '">' +
                        self.renderSublistTable(sl, doc) +
                    '</div>' +
                    '<div class="sublist-footer">' +
                        '<button class="btn btn-ghost btn-sm btn-add-line" data-sublist="' + sl.id + '">' +
                            '<i class="fas fa-plus"></i> Add Row' +
                        '</button>' +
                        self.renderTransformDropdown(sl.id, slType) +
                    '</div>' +
                '</div>';
            });

            html += '</div>';
            return html;
        },

        // Render transform dropdown menu for sublist footer
        renderTransformDropdown: function(sublistId, slType) {
            var isExpense = slType === 'expense';
            var groupByField = isExpense ? 'account' : 'item';
            var groupByLabel = isExpense ? 'Account' : 'Item';
            var groupByIcon = isExpense ? 'fa-book' : 'fa-box';

            return '<div class="transform-dropdown" id="transform-dropdown-' + sublistId + '">' +
                '<button class="btn btn-ghost btn-sm btn-transform" data-sublist="' + sublistId + '">' +
                    '<i class="fas fa-wand-magic-sparkles"></i> Transform ' +
                    '<i class="fas fa-chevron-down transform-arrow"></i>' +
                '</button>' +
                '<div class="transform-menu">' +
                    '<div class="transform-section">' +
                        '<div class="transform-section-label">Consolidate</div>' +
                        '<div class="transform-option" data-action="collapse" data-sublist="' + sublistId + '">' +
                            '<i class="fas fa-compress"></i> Collapse to One Line' +
                        '</div>' +
                    '</div>' +
                    '<div class="transform-section">' +
                        '<div class="transform-section-label">Group By</div>' +
                        '<div class="transform-option" data-action="by-' + groupByField + '" data-sublist="' + sublistId + '">' +
                            '<i class="fas ' + groupByIcon + '"></i> By ' + groupByLabel +
                        '</div>' +
                        '<div class="transform-option" data-action="by-department" data-sublist="' + sublistId + '">' +
                            '<i class="fas fa-sitemap"></i> By Department' +
                        '</div>' +
                        '<div class="transform-option" data-action="by-class" data-sublist="' + sublistId + '">' +
                            '<i class="fas fa-tags"></i> By Class' +
                        '</div>' +
                        '<div class="transform-option" data-action="by-location" data-sublist="' + sublistId + '">' +
                            '<i class="fas fa-map-marker-alt"></i> By Location' +
                        '</div>' +
                    '</div>' +
                    '<div class="transform-section">' +
                        '<div class="transform-section-label">Distribute</div>' +
                        '<div class="transform-option" data-action="split-equal" data-sublist="' + sublistId + '">' +
                            '<i class="fas fa-divide"></i> Split Equally...' +
                        '</div>' +
                        '<div class="transform-option" data-action="apply-defaults" data-sublist="' + sublistId + '">' +
                            '<i class="fas fa-fill-drip"></i> Apply Header Defaults' +
                        '</div>' +
                    '</div>' +
                    '<div class="transform-divider"></div>' +
                    '<div class="transform-option" data-action="duplicate-all" data-sublist="' + sublistId + '">' +
                        '<i class="fas fa-copy"></i> Duplicate All Lines' +
                    '</div>' +
                    '<div class="transform-option transform-danger" data-action="clear-all" data-sublist="' + sublistId + '">' +
                        '<i class="fas fa-trash"></i> Clear All Lines' +
                    '</div>' +
                '</div>' +
            '</div>' +
            '<button class="btn btn-ghost btn-sm btn-undo-transform" id="btn-undo-' + sublistId + '" data-sublist="' + sublistId + '" style="display:none;" title="Undo last transform">' +
                '<i class="fas fa-undo"></i> Undo' +
            '</button>';
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

        // Get field value - checks formData first (user edits), then extractedData (AI), then doc fields
        // Handles field mapping, case-insensitive matching, and custom field syntax
        getExtractedFieldValue: function(nsFieldId, docKey, doc, extractedData) {
            var normalizedId = (nsFieldId || '').toLowerCase();
            var lowerDocKey = (docKey || '').toLowerCase();

            // FIRST: Check formData.bodyFields (user-edited values - highest priority)
            if (this.formData && this.formData.bodyFields) {
                var bodyFields = this.formData.bodyFields;
                if (bodyFields[nsFieldId] !== undefined && bodyFields[nsFieldId] !== '') return bodyFields[nsFieldId];
                if (bodyFields[normalizedId] !== undefined && bodyFields[normalizedId] !== '') return bodyFields[normalizedId];
                if (bodyFields[docKey] !== undefined && bodyFields[docKey] !== '') return bodyFields[docKey];
                if (bodyFields[lowerDocKey] !== undefined && bodyFields[lowerDocKey] !== '') return bodyFields[lowerDocKey];
            }

            // SECOND: Check extractedData (AI-extracted fields)
            if (extractedData) {
                // Direct match
                if (extractedData[nsFieldId] !== undefined) return extractedData[nsFieldId];
                if (extractedData[normalizedId] !== undefined) return extractedData[normalizedId];
                if (extractedData[docKey] !== undefined) return extractedData[docKey];

                // Try lowercase docKey
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

            // THIRD: Fall back to document's fixed fields
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
            var isFullWidth = this.isFullWidthField(nsField.id, nsField.type);

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
            // then fall back to fixed document fields, then default value from field schema
            var extractedData = doc.extractedData || {};
            var value = this.getExtractedFieldValue(nsField.id, docKey, doc, extractedData);

            // Track if we're using default value (for display text handling)
            var usingDefaultValue = false;

            // Check if this is posting period with dynamic current period default
            var isPostingPeriod = nsField.id.toLowerCase() === 'postingperiod';
            var useCurrentPeriod = isPostingPeriod && nsField.defaultValue === '__CURRENT_PERIOD__';

            // If no value found, use default value from field schema
            // (skip __CURRENT_PERIOD__ special value - it will be resolved asynchronously)
            if (!value && nsField.defaultValue && !useCurrentPeriod) {
                value = nsField.defaultValue;
                usingDefaultValue = true;
            }

            // Track default value text for select fields (to show display name)
            var defaultValueText = nsField.defaultValueText || '';

            // Mark posting period for async resolution if using current period default
            var needsCurrentPeriodResolution = isPostingPeriod && !value && (useCurrentPeriod || !nsField.defaultValue);

            // Check for AI suggestion if field is empty
            var suggestion = null;
            if (!value && extractedData._allExtractedFields) {
                suggestion = this.getFieldSuggestion(nsField.id, label, extractedData);
            }

            var html = '<div class="form-field' + (suggestion ? ' has-suggestion' : '') + (isFullWidth ? ' full-width' : '') + (isRequired ? ' is-required' : '') + '">' +
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

            // Get inferred field type for proper rendering
            var inferredType = this.getInferredFieldType(nsField);

            if (inferredType === 'select' && nsField.options && nsField.options.length > 0) {
                // Select with pre-loaded options - render dropdown
                html += '<select id="' + fieldId + '" class="ns-field-select" data-field="' + nsField.id + '"' + (isDisabled ? ' disabled' : '') + (isRequired ? ' required' : '') + '>';
                html += '<option value="">-- Select --</option>';
                nsField.options.forEach(function(opt) {
                    var selected = (String(value) === String(opt.value)) ? ' selected' : '';
                    html += '<option value="' + escapeHtml(opt.value) + '"' + selected + '>' + escapeHtml(opt.text) + '</option>';
                });
                html += '</select>';
            } else if (inferredType === 'select') {
                // Select without pre-loaded options - use typeahead for server-side search
                var lookupType = this.getLookupType(nsField.id);
                // Get display value: formData first (user edits), then default, then doc
                var displayValue = '';
                if (this.formData && this.formData.bodyFields) {
                    displayValue = this.formData.bodyFields[nsField.id + '_display'] || '';
                }
                if (!displayValue) {
                    displayValue = usingDefaultValue ? defaultValueText : (doc[docKey + '_display'] || doc[docKey + '_text'] || '');
                }

                if (isDisabled) {
                    // Disabled select - just show display value
                    html += '<input type="text" id="' + fieldId + '" value="' + escapeHtml(displayValue || value) + '" disabled>';
                } else {
                    // Typeahead select for body fields
                    // Add data-needs-current-period for posting period fields that need async resolution
                    var currentPeriodAttr = needsCurrentPeriodResolution ? ' data-needs-current-period="true"' : '';
                    html += '<div class="typeahead-select body-field-typeahead" data-field="' + nsField.id + '" data-lookup="' + lookupType + '"' + currentPeriodAttr + '>' +
                        '<input type="hidden" id="' + fieldId + '" value="' + escapeHtml(value) + '" data-field="' + nsField.id + '"' + (isRequired ? ' required' : '') + '>' +
                        '<input type="text" class="typeahead-input" id="' + fieldId + '-display" ' +
                            'value="' + escapeHtml(displayValue) + '" placeholder="Search ' + escapeHtml(label) + '..." ' +
                            'data-field="' + nsField.id + '" data-lookup="' + lookupType + '" autocomplete="off">' +
                        '<div class="typeahead-dropdown"></div>' +
                    '</div>';
                }
            } else if (inferredType === 'date') {
                html += '<input type="date" id="' + fieldId + '" class="ns-field-input" data-field="' + nsField.id + '" value="' + formatDateInput(value) + '"' +
                    (isDisabled ? ' disabled' : '') + (isRequired ? ' required' : '') + '>';
            } else if (inferredType === 'currency' || inferredType === 'float') {
                html += '<div class="input-with-prefix">' +
                    '<span class="input-prefix">$</span>' +
                    '<input type="number" step="0.01" id="' + fieldId + '" class="ns-field-input" data-field="' + nsField.id + '" value="' + (parseFloat(value) || 0).toFixed(2) + '"' +
                    (isDisabled ? ' disabled' : '') + (isRequired ? ' required' : '') + '>' +
                '</div>';
            } else if (inferredType === 'integer') {
                html += '<input type="number" step="1" id="' + fieldId + '" class="ns-field-input" data-field="' + nsField.id + '" value="' + escapeHtml(value) + '"' +
                    (isDisabled ? ' disabled' : '') + (isRequired ? ' required' : '') + '>';
            } else if (inferredType === 'checkbox') {
                var isChecked = value === true || value === 'T' || value === 'true' || value === '1';
                html += '<input type="checkbox" id="' + fieldId + '" class="ns-field-input" data-field="' + nsField.id + '"' +
                    (isChecked ? ' checked' : '') + (isDisabled ? ' disabled' : '') + '>';
            } else if (inferredType === 'textarea') {
                html += '<textarea id="' + fieldId + '" class="ns-field-input" data-field="' + nsField.id + '" rows="3"' +
                    (isDisabled ? ' disabled' : '') + (isRequired ? ' required' : '') + '>' + escapeHtml(value) + '</textarea>';
            } else {
                html += '<input type="text" id="' + fieldId + '" class="ns-field-input" data-field="' + nsField.id + '" value="' + escapeHtml(value) + '"' +
                    (isDisabled ? ' disabled' : '') + (isRequired ? ' required' : '') + '>';
            }

            // Add suggestion button if available (only for text inputs, not checkboxes or selects with options)
            if (suggestionHtml && inferredType !== 'checkbox' && inferredType !== 'select' && !isDisabled) {
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

            // FIRST: Check formData.sublists (saved user edits - highest priority)
            if (this.formData && this.formData.sublists && this.formData.sublists[slType]) {
                items = this.formData.sublists[slType];
            }
            // SECOND: Fall back to document data
            else if (slType === 'expense') {
                items = doc.expenseLines || doc.lineItems || [];
            } else if (slType === 'item') {
                items = doc.itemLines || [];
            }

            // Store in controller for later updates
            if (!this.sublistData) this.sublistData = {};

            // Always have at least one blank row
            if (items.length === 0) {
                items = [{}]; // Add one empty row
            }
            this.sublistData[sublistId] = items;

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

                FCDebug.log('[View.Review] Using fallback column order for', sublist.id, '- type:', sublist.type || 'unknown', '- columns:', visible.map(function(f) { return f.id; }).join(', '));
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

            // Apply default value if no value exists and field has a default
            if (!value && field.defaultValue) {
                value = field.defaultValue;
                displayValue = field.defaultValueText || value;
            }
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
            // Checkbox fields - handle same as header-level checkboxes
            else if (field.type === 'checkbox' || this.isCheckboxField(normalizedFieldId, field.type)) {
                var isChecked = value === 'T' || value === true || value === 'true' || value === '1';
                return '<td class="checkbox-cell"><label class="checkbox-label">' +
                    '<input type="checkbox" class="line-input line-checkbox" id="' + inputId + '" ' +
                    'data-field="' + fieldId + '"' + (isChecked ? ' checked' : '') + '>' +
                    '</label></td>';
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

        // Detect date fields by ID or type
        isDateField: function(fieldId, fieldType) {
            if (fieldType === 'date' || fieldType === 'DATE') return true;
            var normalizedId = (fieldId || '').toLowerCase();
            var dateFields = [
                'trandate', 'duedate', 'startdate', 'enddate', 'shipdate',
                'expectedclosedate', 'datecreated', 'lastmodifieddate',
                'createddate', 'closeddate', 'invoicedate', 'orderdate'
            ];
            return dateFields.indexOf(normalizedId) !== -1 || normalizedId.indexOf('date') !== -1;
        },

        // Detect checkbox fields
        isCheckboxField: function(fieldId, fieldType) {
            var ft = (fieldType || '').toLowerCase();
            // NetSuite returns 'checkbox', '_checkbox', or sometimes just contains 'checkbox'
            if (ft === 'checkbox' || ft === '_checkbox' || ft.indexOf('checkbox') !== -1) return true;
            var normalizedId = (fieldId || '').toLowerCase();
            // Common checkbox field patterns
            var checkboxFields = [
                'isadvanced', 'isperson', 'isbudgetapproved', 'istaxable', 'isbillable',
                'isresidential', 'isactive', 'isinactive', 'isdefault', 'isprimary',
                'taxable', 'billable', 'closed', 'complete', 'approved'
            ];
            if (checkboxFields.indexOf(normalizedId) !== -1) return true;
            // Fields starting with 'is' or 'has' are typically booleans
            return normalizedId.indexOf('is') === 0 || normalizedId.indexOf('has') === 0;
        },

        // Check if field should render full width (not in 2-column layout)
        isFullWidthField: function(fieldId, fieldType) {
            var ft = (fieldType || '').toLowerCase();
            // Textareas and long text fields should be full width
            if (ft === 'textarea' || ft === 'richtext' || ft === 'longtext' || ft === 'clobtext') return true;
            var normalizedId = (fieldId || '').toLowerCase();
            var fullWidthFields = ['memo', 'message', 'description', 'notes', 'comments', 'address'];
            return fullWidthFields.some(function(f) { return normalizedId.indexOf(f) !== -1; });
        },

        // Detect currency/amount fields
        isCurrencyField: function(fieldId, fieldType) {
            if (fieldType === 'currency' || fieldType === 'CURRENCY') return true;
            var normalizedId = (fieldId || '').toLowerCase();
            var currencyFields = [
                'amount', 'total', 'subtotal', 'taxtotal', 'rate', 'cost',
                'price', 'balance', 'credit', 'debit', 'exchangerate'
            ];
            return currencyFields.some(function(cf) { return normalizedId.indexOf(cf) !== -1; });
        },

        // Detect long text fields
        isLongTextField: function(fieldId, fieldType) {
            if (fieldType === 'textarea' || fieldType === 'TEXTAREA' ||
                fieldType === 'richtext' || fieldType === 'RICHTEXT' ||
                fieldType === 'longtext' || fieldType === 'LONGTEXT' ||
                fieldType === 'clobtext' || fieldType === 'CLOBTEXT') return true;
            var normalizedId = (fieldId || '').toLowerCase();
            var longFields = ['memo', 'message', 'description', 'notes', 'comments', 'address'];
            return longFields.some(function(lf) { return normalizedId.indexOf(lf) !== -1; });
        },

        // Get inferred field type for rendering
        getInferredFieldType: function(nsField) {
            var fieldId = nsField.id || '';
            var fieldType = nsField.type || '';

            if (this.isSelectField(fieldId)) return 'select';
            if (this.isDateField(fieldId, fieldType)) return 'date';
            if (this.isCheckboxField(fieldId, fieldType)) return 'checkbox';
            if (this.isCurrencyField(fieldId, fieldType)) return 'currency';
            if (this.isLongTextField(fieldId, fieldType)) return 'textarea';
            if (fieldType === 'integer' || fieldType === 'INTEGER') return 'integer';

            return fieldType || 'text';
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
                    // Count only rows that have actual data (not blank placeholder rows)
                    var items = self.sublistData[sublistId] || [];
                    var filledCount = items.filter(function(item) {
                        // Check if row has any meaningful data
                        return Object.keys(item).some(function(key) {
                            var val = item[key];
                            return val !== undefined && val !== null && val !== '' && val !== 0;
                        });
                    }).length;
                    countEl.textContent = filledCount;
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

            // Confidence may be stored as decimal (0-1) or percentage (0-100)
            var rawConf = parseFloat(conf) || 0;
            var percent = rawConf <= 1 ? Math.round(rawConf * 100) : Math.round(rawConf);
            var confClass = percent >= 85 ? 'high' : percent >= 60 ? 'medium' : 'low';

            return '<span class="field-confidence ' + confClass + '" title="AI Confidence: ' + percent + '%">' + percent + '%</span>';
        },

        bindFormEvents: function() {
            var self = this;

            // Save button - must be bound here because it's rendered in renderExtractionForm()
            var saveBtn = el('#btn-save');
            if (saveBtn) {
                saveBtn.addEventListener('click', function() {
                    self.saveChanges();
                });
            }

            // Toggle alert details
            var alertToggle = el('#alert-status-toggle');
            if (alertToggle) {
                alertToggle.onclick = function() {
                    var details = el('#alert-details');
                    var chevron = alertToggle.querySelector('.alert-chevron');
                    if (details) {
                        var isHidden = details.style.display === 'none';
                        details.style.display = isHidden ? 'block' : 'none';
                        if (chevron) {
                            chevron.classList.toggle('fa-chevron-down', !isHidden);
                            chevron.classList.toggle('fa-chevron-up', isHidden);
                        }
                    }
                };
            }

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

                // Keyboard navigation for vendor dropdown
                vendorInput.addEventListener('keydown', function(e) {
                    var dropdown = el('#vendor-dropdown');
                    if (!dropdown || dropdown.style.display === 'none') return;

                    var options = dropdown.querySelectorAll('.vendor-option');
                    if (options.length === 0) return;

                    var highlighted = dropdown.querySelector('.vendor-option.highlighted');
                    var currentIdx = highlighted ? Array.prototype.indexOf.call(options, highlighted) : -1;

                    if (e.key === 'ArrowDown') {
                        e.preventDefault();
                        if (highlighted) highlighted.classList.remove('highlighted');
                        var nextIdx = currentIdx < options.length - 1 ? currentIdx + 1 : 0;
                        options[nextIdx].classList.add('highlighted');
                        options[nextIdx].scrollIntoView({ block: 'nearest' });
                    } else if (e.key === 'ArrowUp') {
                        e.preventDefault();
                        if (highlighted) highlighted.classList.remove('highlighted');
                        var prevIdx = currentIdx > 0 ? currentIdx - 1 : options.length - 1;
                        options[prevIdx].classList.add('highlighted');
                        options[prevIdx].scrollIntoView({ block: 'nearest' });
                    } else if (e.key === 'Enter' && highlighted) {
                        e.preventDefault();
                        highlighted.click();
                    } else if (e.key === 'Escape') {
                        e.preventDefault();
                        self.hideVendorDropdown();
                    }
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

                    // Transform dropdown toggle
                    var transformBtn = e.target.closest('.btn-transform');
                    if (transformBtn) {
                        e.stopPropagation();
                        var dropdown = transformBtn.closest('.transform-dropdown');
                        if (dropdown) {
                            // Close other open dropdowns first
                            document.querySelectorAll('.transform-dropdown.open').forEach(function(d) {
                                if (d !== dropdown) d.classList.remove('open');
                            });
                            dropdown.classList.toggle('open');
                        }
                        return;
                    }

                    // Transform option click
                    var transformOption = e.target.closest('.transform-option');
                    if (transformOption) {
                        var action = transformOption.dataset.action;
                        var sublistId = transformOption.dataset.sublist;
                        var dropdown = transformOption.closest('.transform-dropdown');
                        if (dropdown) dropdown.classList.remove('open');
                        self.transformSublist(sublistId, action);
                        return;
                    }

                    // Undo transform button
                    var undoBtn = e.target.closest('.btn-undo-transform');
                    if (undoBtn) {
                        var sublistId = undoBtn.dataset.sublist;
                        self.undoTransform(sublistId);
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

                // Checkbox change events (checkboxes don't fire 'input' events)
                lineSection.addEventListener('change', function(e) {
                    var input = e.target;
                    if (!input.classList.contains('line-checkbox')) return;

                    var row = input.closest('tr');
                    if (!row) return;

                    var idx = parseInt(row.dataset.idx, 10);
                    var sublistId = row.dataset.sublist;
                    var fieldId = input.dataset.field;
                    var value = input.checked;

                    self.updateSublistLine(sublistId, idx, fieldId, value, true);
                });

                // ========== TYPEAHEAD SEARCH FOR SELECT FIELDS ==========
                lineSection.addEventListener('input', function(e) {
                    var input = e.target;
                    if (!input.classList.contains('typeahead-input')) return;

                    var query = input.value.trim();
                    var wrapper = input.closest('.typeahead-select');
                    var lookupType = input.dataset.lookup;
                    var row = input.closest('tr');
                    var sublistId = row ? (row.dataset.sublist || '').toLowerCase() : '';
                    var fieldId = (input.dataset.field || '').toLowerCase();

                    clearTimeout(self.typeaheadTimeout);

                    if (query.length < 2) {
                        self.hideTypeaheadDropdown(wrapper);
                        return;
                    }

                    // Determine account type based on field
                    var options = {};
                    if (lookupType === 'accounts') {
                        // 'account' field (vendor bill) → COGS + Expense (no filter)
                        // 'expenseaccount' field (expense report) → Expense only
                        if (fieldId === 'expenseaccount') {
                            options.accountType = 'Expense';
                        }
                        // For 'account' field, don't set accountType - returns all accounts
                    }

                    self.typeaheadTimeout = setTimeout(function() {
                        self.searchDatasource(lookupType, query, wrapper, input, options);
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

                // Keyboard navigation for typeahead
                lineSection.addEventListener('keydown', function(e) {
                    var input = e.target;
                    if (!input.classList.contains('typeahead-input')) return;

                    var wrapper = input.closest('.typeahead-select');
                    var dropdown = wrapper ? wrapper.querySelector('.typeahead-dropdown') : null;
                    if (!dropdown || dropdown.style.display === 'none') return;

                    var options = dropdown.querySelectorAll('.typeahead-option');
                    if (options.length === 0) return;

                    var highlighted = dropdown.querySelector('.typeahead-option.highlighted');
                    var currentIdx = highlighted ? Array.prototype.indexOf.call(options, highlighted) : -1;

                    if (e.key === 'ArrowDown') {
                        e.preventDefault();
                        if (highlighted) highlighted.classList.remove('highlighted');
                        var nextIdx = (currentIdx + 1) % options.length;
                        options[nextIdx].classList.add('highlighted');
                        options[nextIdx].scrollIntoView({ block: 'nearest' });
                    } else if (e.key === 'ArrowUp') {
                        e.preventDefault();
                        if (highlighted) highlighted.classList.remove('highlighted');
                        var prevIdx = currentIdx <= 0 ? options.length - 1 : currentIdx - 1;
                        options[prevIdx].classList.add('highlighted');
                        options[prevIdx].scrollIntoView({ block: 'nearest' });
                    } else if (e.key === 'Enter') {
                        e.preventDefault();
                        if (highlighted) {
                            self.selectTypeaheadOption(wrapper, highlighted);
                        } else if (options.length > 0) {
                            self.selectTypeaheadOption(wrapper, options[0]);
                        }
                    } else if (e.key === 'Escape') {
                        self.hideTypeaheadDropdown(wrapper);
                    }
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
                var fieldId = (input.dataset.field || '').toLowerCase();

                clearTimeout(self.typeaheadTimeout);

                if (query.length < 2) {
                    self.hideTypeaheadDropdown(wrapper);
                    return;
                }

                // Determine options based on field
                var options = {};
                if (lookupType === 'accounts' && fieldId === 'account') {
                    // Body-level account field on vendor bill = AP accounts
                    options.accountType = 'AcctPay';
                }

                self.typeaheadTimeout = setTimeout(function() {
                    self.searchDatasource(lookupType, query, wrapper, input, options);
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

            // Keyboard navigation for body field typeahead
            panel.addEventListener('keydown', function(e) {
                var input = e.target;
                if (!input.classList.contains('typeahead-input')) return;
                if (input.closest('.line-section')) return;

                var wrapper = input.closest('.typeahead-select');
                var dropdown = wrapper ? wrapper.querySelector('.typeahead-dropdown') : null;
                if (!dropdown || dropdown.style.display === 'none') return;

                var options = dropdown.querySelectorAll('.typeahead-option');
                if (options.length === 0) return;

                var highlighted = dropdown.querySelector('.typeahead-option.highlighted');
                var currentIdx = highlighted ? Array.prototype.indexOf.call(options, highlighted) : -1;

                if (e.key === 'ArrowDown') {
                    e.preventDefault();
                    if (highlighted) highlighted.classList.remove('highlighted');
                    var nextIdx = (currentIdx + 1) % options.length;
                    options[nextIdx].classList.add('highlighted');
                    options[nextIdx].scrollIntoView({ block: 'nearest' });
                } else if (e.key === 'ArrowUp') {
                    e.preventDefault();
                    if (highlighted) highlighted.classList.remove('highlighted');
                    var prevIdx = currentIdx <= 0 ? options.length - 1 : currentIdx - 1;
                    options[prevIdx].classList.add('highlighted');
                    options[prevIdx].scrollIntoView({ block: 'nearest' });
                } else if (e.key === 'Enter') {
                    e.preventDefault();
                    if (highlighted) {
                        self.selectBodyFieldTypeahead(wrapper, highlighted);
                    } else if (options.length > 0) {
                        self.selectBodyFieldTypeahead(wrapper, options[0]);
                    }
                } else if (e.key === 'Escape') {
                    self.hideTypeaheadDropdown(wrapper);
                }
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

            // Create empty line using schema (includes defaults from field config)
            var newLine = this.createEmptyLine(sublistId);

            this.sublistData[sublistId].push(newLine);
            var slType = (sublistId || '').toLowerCase();
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

        updateSublistLine: function(sublistId, idx, fieldId, value, isCheckbox) {
            if (!this.sublistData || !this.sublistData[sublistId]) return;

            var line = this.sublistData[sublistId][idx];
            if (!line) return;

            // Convert numeric fields
            if (fieldId === 'amount' || fieldId === 'rate' || fieldId === 'quantity') {
                value = parseFloat(value) || 0;
            }
            // Convert checkbox values to T/F format (same as header-level checkboxes)
            else if (isCheckbox) {
                value = (value === true || value === 'true' || value === 'on') ? 'T' : 'F';
            }

            line[fieldId] = value;

            // Auto-calculate amount when quantity or rate changes, but only if all three columns are visible
            // This allows the feature to work on any sublist that displays quantity, rate, and amount
            // Amount can still be manually overridden by directly editing the amount field
            var normalizedFieldId = (fieldId || '').toLowerCase();
            if ((normalizedFieldId === 'quantity' || normalizedFieldId === 'rate') && this.hasAutoCalculateColumns(sublistId, idx)) {
                // Get quantity and rate values - check all case variants (lowercase, Capitalized, UPPERCASE)
                var qty = parseFloat(line.quantity) || parseFloat(line.Quantity) || parseFloat(line.QUANTITY) || 0;
                var rate = parseFloat(line.rate) || parseFloat(line.Rate) || parseFloat(line.RATE) || 0;
                var calculatedAmount = qty * rate;

                // Update all possible case variants in the line data
                line.amount = calculatedAmount;
                line.Amount = calculatedAmount;
                line.AMOUNT = calculatedAmount;

                // Find and update the amount input in the DOM (case-insensitive search)
                var container = el('#sublist-' + sublistId);
                if (container) {
                    var row = container.querySelector('tr[data-idx="' + idx + '"]');
                    if (row) {
                        // Find amount input by checking data-field attribute case-insensitively
                        var amountInput = Array.from(row.querySelectorAll('.line-input')).find(function(input) {
                            return (input.dataset.field || '').toLowerCase() === 'amount';
                        });
                        if (amountInput) amountInput.value = calculatedAmount.toFixed(2);
                    }
                }
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
        // TRANSFORM OPERATIONS
        // ==========================================

        // Undo state for transforms (simple single-level, lost on reload)
        transformUndoState: null,

        // Get sublist schema for field type detection
        getSublistSchema: function(sublistId) {
            var sublists = (this.formFields || {}).sublists || [];
            var normalizedId = (sublistId || '').toLowerCase();
            return sublists.find(function(sl) {
                return (sl.id || '').toLowerCase() === normalizedId;
            }) || { fields: [] };
        },

        // Check if sublist has quantity, rate, and amount columns all visible
        // Uses DOM inspection to find inputs by data-field attribute (case-insensitive)
        hasAutoCalculateColumns: function(sublistId, rowIdx) {
            var container = el('#sublist-' + sublistId);
            if (!container) return false;

            // Find inputs by data-field attribute (case-insensitive check)
            var inputs = container.querySelectorAll('tr[data-idx="' + rowIdx + '"] .line-input');
            var fieldIds = [];
            inputs.forEach(function(input) {
                var fid = (input.dataset.field || '').toLowerCase();
                if (fid) fieldIds.push(fid);
            });

            return fieldIds.indexOf('quantity') !== -1 &&
                   fieldIds.indexOf('rate') !== -1 &&
                   fieldIds.indexOf('amount') !== -1;
        },

        // Check if field is numeric (currency or integer type)
        isNumericField: function(fieldId, sublistId) {
            var schema = this.getSublistSchema(sublistId);
            var normalizedFieldId = (fieldId || '').toLowerCase();
            var field = (schema.fields || []).find(function(f) {
                return (f.id || '').toLowerCase() === normalizedFieldId;
            });
            if (field && (field.type === 'currency' || field.type === 'integer')) return true;
            // Fallback for common numeric fields
            var numericIds = ['amount', 'rate', 'quantity', 'grossamt', 'tax1amt', 'units'];
            return numericIds.indexOf(normalizedFieldId) !== -1;
        },

        // Store undo state before transform
        storeUndoState: function(sublistId) {
            this.transformUndoState = {
                sublistId: sublistId,
                lines: JSON.parse(JSON.stringify(this.sublistData[sublistId] || []))
            };
            // Show undo button
            var undoBtn = el('#btn-undo-' + sublistId);
            if (undoBtn) undoBtn.style.display = 'inline-flex';
        },

        // Undo last transform
        undoTransform: function(sublistId) {
            if (!this.transformUndoState || this.transformUndoState.sublistId !== sublistId) {
                UI.toast('Nothing to undo', 'info');
                return;
            }

            var restoredLines = this.transformUndoState.lines;
            this.sublistData[sublistId] = restoredLines;
            var slType = (sublistId || '').toLowerCase();
            this.changes[slType + 'Lines'] = restoredLines;

            // Also update formData.sublists so renderSublistTable picks up the changes
            if (this.formData && this.formData.sublists) {
                this.formData.sublists[slType] = restoredLines;
            }

            this.transformUndoState = null;

            // Hide undo button
            var undoBtn = el('#btn-undo-' + sublistId);
            if (undoBtn) undoBtn.style.display = 'none';

            this.markUnsaved();
            this.refreshSublist(sublistId);
            this.updateTabCounts();
            UI.toast('Transform undone', 'success');
        },

        // Main transform dispatcher
        transformSublist: function(sublistId, action) {
            var lines = this.sublistData[sublistId] || [];
            if (lines.length === 0 && action !== 'clear-all') {
                UI.toast('No lines to transform', 'info');
                return;
            }

            // Store undo state BEFORE transform
            this.storeUndoState(sublistId);

            var newLines = [];
            var self = this;

            switch (action) {
                case 'collapse':
                    newLines = this.collapseLines(lines, sublistId);
                    UI.toast('Collapsed to ' + newLines.length + ' line', 'success');
                    break;
                case 'by-department':
                    newLines = this.groupLinesBy(lines, 'department', sublistId);
                    UI.toast('Grouped into ' + newLines.length + ' lines by department', 'success');
                    break;
                case 'by-class':
                    newLines = this.groupLinesBy(lines, 'class', sublistId);
                    UI.toast('Grouped into ' + newLines.length + ' lines by class', 'success');
                    break;
                case 'by-location':
                    newLines = this.groupLinesBy(lines, 'location', sublistId);
                    UI.toast('Grouped into ' + newLines.length + ' lines by location', 'success');
                    break;
                case 'by-account':
                    newLines = this.groupLinesBy(lines, 'account', sublistId);
                    UI.toast('Grouped into ' + newLines.length + ' lines by account', 'success');
                    break;
                case 'by-item':
                    newLines = this.groupLinesBy(lines, 'item', sublistId);
                    UI.toast('Grouped into ' + newLines.length + ' lines by item', 'success');
                    break;
                case 'apply-defaults':
                    this.applyDefaultsToLines(sublistId);
                    UI.toast('Applied header defaults to lines', 'success');
                    return; // Already handles refresh
                case 'duplicate-all':
                    newLines = lines.concat(JSON.parse(JSON.stringify(lines)));
                    UI.toast('Duplicated ' + lines.length + ' lines', 'success');
                    break;
                case 'clear-all':
                    if (!confirm('Clear all line items? This can be undone.')) {
                        this.transformUndoState = null; // Cancel undo state
                        var undoBtn = el('#btn-undo-' + sublistId);
                        if (undoBtn) undoBtn.style.display = 'none';
                        return;
                    }
                    newLines = [this.createEmptyLine(sublistId)];
                    UI.toast('Cleared all lines', 'success');
                    break;
                case 'split-equal':
                    this.showSplitDialog(sublistId);
                    return; // Dialog handles the rest
                default:
                    UI.toast('Unknown transform action', 'error');
                    return;
            }

            this.sublistData[sublistId] = newLines;
            var slType = (sublistId || '').toLowerCase();
            this.changes[slType + 'Lines'] = newLines;

            // Also update formData.sublists so renderSublistTable picks up the changes
            if (this.formData && this.formData.sublists) {
                this.formData.sublists[slType] = newLines;
            }

            this.markUnsaved();
            this.refreshSublist(sublistId);
            this.updateTabCounts();
        },

        // Collapse all lines into one, preserving all dynamic fields
        collapseLines: function(lines, sublistId) {
            if (lines.length === 0) return [this.createEmptyLine(sublistId)];
            if (lines.length === 1) return JSON.parse(JSON.stringify(lines));

            var self = this;
            var collapsed = {};

            // Collect all unique keys from all lines
            var allKeys = {};
            lines.forEach(function(line) {
                Object.keys(line).forEach(function(k) { allKeys[k] = true; });
            });

            Object.keys(allKeys).forEach(function(key) {
                // Skip display value keys - handle with their parent
                if (key.indexOf('_display') !== -1) return;

                if (self.isNumericField(key, sublistId)) {
                    // Sum numeric fields
                    collapsed[key] = lines.reduce(function(sum, l) {
                        return sum + (parseFloat(l[key]) || 0);
                    }, 0);
                } else {
                    // For non-numeric: collect unique non-empty values
                    var values = lines.map(function(l) { return l[key]; }).filter(function(v) {
                        return v !== undefined && v !== null && v !== '';
                    });
                    var unique = [];
                    values.forEach(function(v) {
                        if (unique.indexOf(v) === -1) unique.push(v);
                    });

                    if (unique.length === 1) {
                        // All same - keep single value and its display value
                        collapsed[key] = unique[0];
                        var dispKey = key + '_display';
                        var dispVals = lines.map(function(l) { return l[dispKey]; }).filter(function(v) {
                            return v !== undefined && v !== null && v !== '';
                        });
                        if (dispVals.length > 0) collapsed[dispKey] = dispVals[0];
                    } else if (key === 'memo' || key === 'description') {
                        // Merge text fields with semicolon
                        collapsed[key] = unique.join('; ');
                    }
                    // Other fields with mixed values: leave empty (user decides)
                }
            });

            return [collapsed];
        },

        // Group lines by a specific field, preserving all dynamic fields
        groupLinesBy: function(lines, groupField, sublistId) {
            var self = this;
            var groups = {};
            var displayKey = groupField + '_display';

            lines.forEach(function(line) {
                var key = line[groupField] || '__empty__';

                if (!groups[key]) {
                    // Clone first line as base (preserves all custom fields)
                    groups[key] = JSON.parse(JSON.stringify(line));
                    // Reset numeric fields to start fresh accumulation
                    Object.keys(groups[key]).forEach(function(fieldId) {
                        if (fieldId.indexOf('_display') !== -1) return;
                        if (self.isNumericField(fieldId, sublistId)) {
                            groups[key][fieldId] = parseFloat(line[fieldId]) || 0;
                        }
                    });
                } else {
                    // Merge subsequent lines - sum numeric fields only
                    Object.keys(line).forEach(function(fieldId) {
                        if (fieldId.indexOf('_display') !== -1) return;
                        if (self.isNumericField(fieldId, sublistId)) {
                            groups[key][fieldId] = (parseFloat(groups[key][fieldId]) || 0) +
                                                   (parseFloat(line[fieldId]) || 0);
                        }
                    });
                }
            });

            return Object.keys(groups).map(function(k) { return groups[k]; });
        },

        // Apply header-level defaults to all lines missing those values
        applyDefaultsToLines: function(sublistId) {
            var bodyFields = (this.formData && this.formData.bodyFields) || {};
            var defaults = {
                department: bodyFields.department || bodyFields.Department || '',
                class: bodyFields['class'] || bodyFields.Class || '',
                location: bodyFields.location || bodyFields.Location || ''
            };

            // Also get display values
            var displayDefaults = {
                department_display: bodyFields.department_display || bodyFields.Department_display || '',
                class_display: bodyFields.class_display || bodyFields.Class_display || '',
                location_display: bodyFields.location_display || bodyFields.Location_display || ''
            };

            var lines = this.sublistData[sublistId] || [];
            var appliedCount = 0;

            lines.forEach(function(line) {
                Object.keys(defaults).forEach(function(field) {
                    if (!line[field] && defaults[field]) {
                        line[field] = defaults[field];
                        var dispKey = field + '_display';
                        if (displayDefaults[dispKey]) {
                            line[dispKey] = displayDefaults[dispKey];
                        }
                        appliedCount++;
                    }
                });
            });

            var slType = (sublistId || '').toLowerCase();
            this.changes[slType + 'Lines'] = lines;

            // Also update formData.sublists so renderSublistTable picks up the changes
            if (this.formData && this.formData.sublists) {
                this.formData.sublists[slType] = lines;
            }

            this.markUnsaved();
            this.refreshSublist(sublistId);
        },

        // Create empty line from schema (dynamic field aware with default values)
        createEmptyLine: function(sublistId) {
            var schema = this.getSublistSchema(sublistId);
            var line = {};
            // Support both 'columns' (from XML) and 'fields' (from server extraction)
            var fields = schema.columns || schema.fields || [];

            fields.forEach(function(f) {
                // Apply default value from field config if available
                if (f.defaultValue !== undefined && f.defaultValue !== '') {
                    line[f.id] = f.defaultValue;
                    // Also store display text for select fields
                    if (f.defaultValueText) {
                        line[f.id + '_display'] = f.defaultValueText;
                    }
                } else if (f.type === 'currency' || f.type === 'integer') {
                    line[f.id] = 0;
                } else {
                    line[f.id] = '';
                }
            });

            // Ensure minimum required fields exist (only if not already set by defaults)
            if (!line.hasOwnProperty('amount')) line.amount = 0;

            // Add common fields based on sublist type (only if not already set by defaults)
            var slType = (sublistId || '').toLowerCase();
            if (slType === 'expense') {
                if (!line.hasOwnProperty('account')) line.account = '';
                if (!line.hasOwnProperty('memo')) line.memo = '';
            } else if (slType === 'item') {
                if (!line.hasOwnProperty('item')) line.item = '';
                if (!line.hasOwnProperty('description')) line.description = '';
                if (!line.hasOwnProperty('quantity')) line.quantity = 1;
                if (!line.hasOwnProperty('rate')) line.rate = 0;
            }

            return line;
        },

        // Show split equally dialog
        showSplitDialog: function(sublistId) {
            var self = this;
            var lines = this.sublistData[sublistId] || [];
            var total = lines.reduce(function(sum, l) {
                return sum + (parseFloat(l.amount) || 0);
            }, 0);

            // Create dialog overlay
            var overlay = document.createElement('div');
            overlay.className = 'split-dialog-overlay';
            overlay.id = 'split-dialog-overlay';
            overlay.innerHTML =
                '<div class="split-dialog">' +
                    '<h4><i class="fas fa-divide"></i> Split Equally</h4>' +
                    '<div class="split-dialog-body">' +
                        '<label for="split-count">Number of lines to create:</label>' +
                        '<input type="number" id="split-count" min="2" max="100" value="2" autofocus>' +
                        '<small>Total amount ($' + total.toFixed(2) + ') will be divided equally</small>' +
                    '</div>' +
                    '<div class="split-dialog-actions">' +
                        '<button class="btn btn-ghost btn-sm" id="split-cancel">Cancel</button>' +
                        '<button class="btn btn-primary btn-sm" id="split-confirm">Split</button>' +
                    '</div>' +
                '</div>';

            document.body.appendChild(overlay);

            // Focus input
            var input = el('#split-count');
            if (input) {
                input.focus();
                input.select();
            }

            // Bind events
            el('#split-cancel').addEventListener('click', function() {
                overlay.remove();
                // Cancel undo state since we stored it before showing dialog
                self.transformUndoState = null;
                var undoBtn = el('#btn-undo-' + sublistId);
                if (undoBtn) undoBtn.style.display = 'none';
            });

            el('#split-confirm').addEventListener('click', function() {
                var count = parseInt(input.value) || 2;
                if (count < 2) count = 2;
                if (count > 100) count = 100;

                overlay.remove();
                self.executeSplit(sublistId, count);
            });

            // Enter key to confirm
            input.addEventListener('keydown', function(e) {
                if (e.key === 'Enter') {
                    el('#split-confirm').click();
                } else if (e.key === 'Escape') {
                    el('#split-cancel').click();
                }
            });

            // Click outside to close
            overlay.addEventListener('click', function(e) {
                if (e.target === overlay) {
                    el('#split-cancel').click();
                }
            });
        },

        // Execute split equally operation
        executeSplit: function(sublistId, count) {
            var lines = this.sublistData[sublistId] || [];
            var total = lines.reduce(function(sum, l) {
                return sum + (parseFloat(l.amount) || 0);
            }, 0);

            var amountPerLine = Math.round((total / count) * 100) / 100; // Round to 2 decimals
            var remainder = Math.round((total - (amountPerLine * count)) * 100) / 100;

            var newLines = [];
            var baseLine = lines.length > 0 ? JSON.parse(JSON.stringify(lines[0])) : this.createEmptyLine(sublistId);

            // Clear numeric values from base line except the split amount
            var self = this;
            Object.keys(baseLine).forEach(function(key) {
                if (key.indexOf('_display') !== -1) return;
                if (self.isNumericField(key, sublistId) && key !== 'quantity') {
                    baseLine[key] = 0;
                }
            });

            for (var i = 0; i < count; i++) {
                var newLine = JSON.parse(JSON.stringify(baseLine));
                newLine.amount = amountPerLine;
                // Add remainder to first line
                if (i === 0 && remainder !== 0) {
                    newLine.amount = Math.round((amountPerLine + remainder) * 100) / 100;
                }
                // Update rate if it's an item line with quantity
                if (newLine.quantity && newLine.quantity > 0) {
                    newLine.rate = newLine.amount / newLine.quantity;
                }
                newLines.push(newLine);
            }

            this.sublistData[sublistId] = newLines;
            var slType = (sublistId || '').toLowerCase();
            this.changes[slType + 'Lines'] = newLines;

            // Also update formData.sublists so renderSublistTable picks up the changes
            if (this.formData && this.formData.sublists) {
                this.formData.sublists[slType] = newLines;
            }

            this.markUnsaved();
            this.refreshSublist(sublistId);
            this.updateTabCounts();
            UI.toast('Split into ' + count + ' lines of $' + amountPerLine.toFixed(2) + ' each', 'success');
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

                    // Fetch coding suggestions for this vendor
                    ReviewController.fetchCodingSuggestions(id);
                });
            });
        },

        hideVendorDropdown: function() {
            var dropdown = el('#vendor-dropdown');
            if (dropdown) dropdown.style.display = 'none';
        },

        // ==========================================
        // SMART AUTO-CODING SUGGESTIONS
        // ==========================================

        /**
         * Fetch coding suggestions for a vendor based on learned patterns
         * @param {string|number} vendorId - The vendor ID
         */
        fetchCodingSuggestions: function(vendorId) {
            var self = this;
            if (!vendorId) return;

            // Build line items array from current form data
            var lineItems = [];
            if (this.formData && this.formData.sublists) {
                var sublists = this.formData.sublists;
                var lines = sublists.expense || sublists.item || [];
                lines.forEach(function(line) {
                    lineItems.push({
                        description: line.memo || line.description || '',
                        account: line.account || '',
                        department: line.department || '',
                        class: line.class || '',
                        location: line.location || ''
                    });
                });
            }

            API.get('codingSuggestions', {
                vendorId: vendorId,
                lineItems: JSON.stringify(lineItems)
            }).then(function(result) {
                if (result && result.meta && result.meta.hasLearning) {
                    self.codingSuggestions = result;
                    self.suggestionsApplied = false;
                    self.showSuggestionsIndicator();
                    FCDebug.log('[AutoCoding] Suggestions loaded:', result);
                } else {
                    self.codingSuggestions = { headerDefaults: {}, lineItemSuggestions: [], meta: { hasLearning: false } };
                }
            }).catch(function(err) {
                FCDebug.log('[AutoCoding] Error fetching suggestions:', err);
            });
        },

        /**
         * Show indicator that suggestions are available
         */
        showSuggestionsIndicator: function() {
            // Remove existing indicator
            var existing = el('#suggestions-indicator');
            if (existing) existing.remove();

            // Count available suggestions
            var headerCount = Object.keys(this.codingSuggestions.headerDefaults || {}).length;
            var lineCount = (this.codingSuggestions.lineItemSuggestions || []).filter(function(l) {
                return l.account || l.department || l.class || l.location;
            }).length;

            if (headerCount === 0 && lineCount === 0) return;

            // Add indicator after vendor section
            var vendorSection = el('.vendor-field');
            if (!vendorSection) return;

            var indicator = document.createElement('div');
            indicator.id = 'suggestions-indicator';
            indicator.className = 'suggestions-indicator';
            indicator.innerHTML =
                '<div class="suggestions-banner">' +
                    '<i class="fas fa-magic"></i>' +
                    '<span class="suggestions-text">' +
                        '<strong>Smart Coding Available</strong> - ' +
                        (headerCount > 0 ? headerCount + ' header field' + (headerCount > 1 ? 's' : '') : '') +
                        (headerCount > 0 && lineCount > 0 ? ', ' : '') +
                        (lineCount > 0 ? lineCount + ' line suggestion' + (lineCount > 1 ? 's' : '') : '') +
                    '</span>' +
                    '<button type="button" class="btn btn-sm btn-primary" id="btn-apply-suggestions">' +
                        '<i class="fas fa-check"></i> Apply All' +
                    '</button>' +
                    '<button type="button" class="btn btn-sm btn-ghost" id="btn-dismiss-suggestions">' +
                        '<i class="fas fa-times"></i>' +
                    '</button>' +
                '</div>';

            vendorSection.parentNode.insertBefore(indicator, vendorSection.nextSibling);

            // Bind events
            var applyBtn = el('#btn-apply-suggestions');
            var dismissBtn = el('#btn-dismiss-suggestions');

            if (applyBtn) {
                applyBtn.addEventListener('click', function() {
                    ReviewController.applySuggestions();
                });
            }
            if (dismissBtn) {
                dismissBtn.addEventListener('click', function() {
                    indicator.remove();
                });
            }
        },

        /**
         * Apply all coding suggestions to the form
         */
        applySuggestions: function() {
            var self = this;
            var applied = 0;

            // Apply header defaults
            var headerDefaults = this.codingSuggestions.headerDefaults || {};
            Object.keys(headerDefaults).forEach(function(field) {
                var suggestion = headerDefaults[field];
                if (!suggestion || !suggestion.value) return;

                // Find the field element
                var fieldEl = el('#field-' + field) || el('[name="' + field + '"]');
                if (fieldEl && !fieldEl.value) {
                    fieldEl.value = suggestion.value;
                    self.changes[field] = suggestion.value;

                    // Update formData
                    if (self.formData && self.formData.bodyFields) {
                        self.formData.bodyFields[field] = suggestion.value;
                    }

                    // Add visual indicator
                    fieldEl.classList.add('field-suggested');
                    applied++;
                }
            });

            // Apply line item suggestions
            var lineSuggestions = this.codingSuggestions.lineItemSuggestions || [];
            lineSuggestions.forEach(function(lineSugg, index) {
                if (!lineSugg) return;

                // Apply account suggestion
                if (lineSugg.account && lineSugg.account.accountId) {
                    var accountField = el('#line-account-' + index);
                    if (accountField && !accountField.value) {
                        accountField.value = lineSugg.account.accountId;
                        accountField.classList.add('field-suggested');
                        applied++;

                        // Update formData
                        if (self.formData && self.formData.sublists) {
                            var sublists = self.formData.sublists;
                            var lines = sublists.expense || sublists.item || [];
                            if (lines[index]) {
                                lines[index].account = lineSugg.account.accountId;
                            }
                        }
                    }
                }

                // Apply department suggestion
                if (lineSugg.department && lineSugg.department.id) {
                    var deptField = el('#line-department-' + index);
                    if (deptField && !deptField.value) {
                        deptField.value = lineSugg.department.id;
                        deptField.classList.add('field-suggested');
                        applied++;
                    }
                }

                // Apply class suggestion
                if (lineSugg.class && lineSugg.class.id) {
                    var classField = el('#line-class-' + index);
                    if (classField && !classField.value) {
                        classField.value = lineSugg.class.id;
                        classField.classList.add('field-suggested');
                        applied++;
                    }
                }

                // Apply location suggestion
                if (lineSugg.location && lineSugg.location.id) {
                    var locField = el('#line-location-' + index);
                    if (locField && !locField.value) {
                        locField.value = lineSugg.location.id;
                        locField.classList.add('field-suggested');
                        applied++;
                    }
                }
            });

            this.suggestionsApplied = true;
            this.markUnsaved();

            // Remove the indicator
            var indicator = el('#suggestions-indicator');
            if (indicator) indicator.remove();

            // Show success message
            if (applied > 0) {
                UI.toast('Applied ' + applied + ' coding suggestion' + (applied > 1 ? 's' : ''), 'success');
            } else {
                UI.toast('No empty fields to fill', 'info');
            }
        },

        // ==========================================
        // TYPEAHEAD SEARCH (for sublist select fields)
        // ==========================================
        searchDatasource: function(type, query, wrapper, input, options) {
            var self = this;
            var dropdown = wrapper.querySelector('.typeahead-dropdown');
            if (!dropdown) return;

            // Show loading state
            dropdown.innerHTML = '<div class="typeahead-loading"><i class="fas fa-spinner fa-spin"></i> Searching...</div>';
            dropdown.style.display = 'block';

            // Build API params
            var params = { type: type, query: query, limit: 20 };
            if (options && options.accountType) {
                params.accountType = options.accountType;
            }

            API.get('datasource', params)
                .then(function(result) {
                    var data = result.data || result;
                    // Handle both formats: array or { options: [], defaultValue }
                    var options = Array.isArray(data) ? data : (data.options || data);
                    self.renderTypeaheadResults(dropdown, options, wrapper, input);
                })
                .catch(function(err) {
                    dropdown.innerHTML = '<div class="typeahead-error">Error loading options</div>';
                });
        },

        renderTypeaheadResults: function(dropdown, results, wrapper, input) {
            // Handle both array and object with options
            var options = Array.isArray(results) ? results : (results.options || results);
            if (!options || options.length === 0) {
                dropdown.innerHTML = '<div class="typeahead-empty">No results found</div>';
                return;
            }

            var html = options.map(function(r) {
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
            if (this.isSaving) return;

            // Collect current form state from DOM
            var formData = this.collectFormData();

            // Check if there's anything to save
            if (!formData || (!formData.bodyFields && !formData.sublists)) {
                UI.toast('No changes to save', 'info');
                return;
            }

            this.isSaving = true;
            var saveBtn = el('#btn-save');
            if (saveBtn) {
                saveBtn.disabled = true;
                saveBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Saving...';
            }

            API.put('update', { documentId: this.docId, formData: formData })
                .then(function() {
                    self.changes = {};
                    self.hasUnsavedChanges = false;
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

        reprocessDocument: function() {
            var self = this;

            if (!confirm('Reprocess this document? This will clear extraction data and re-run AI processing.')) {
                return;
            }

            API.post('reprocess', { documentId: this.docId })
                .then(function() {
                    UI.toast('Document queued for reprocessing', 'success');

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

        changeDocumentType: function(newType, newTypeText) {
            var self = this;

            // Update local data
            this.data.documentType = newType;
            this.data.documentTypeText = newTypeText;

            // Update UI immediately - badge text
            var badgeText = el('#doc-type-badge .badge-text');
            if (badgeText) badgeText.textContent = newTypeText;

            // Update dropdown selected state
            var options = document.querySelectorAll('.doc-type-option');
            options.forEach(function(opt) {
                opt.classList.toggle('selected', opt.dataset.type === String(newType));
            });

            // Mark as changed
            this.changes['documentType'] = newType;
            this.markUnsaved();

            // Derive the new transaction type
            var newTransactionType = this.getTransactionType(newType);

            // If transaction type is changing, we need to reload the form schema
            if (newTransactionType !== this.transactionType) {
                this.transactionType = newTransactionType;

                // Show loading state
                this.showLoadingState();
                UI.toast('Loading ' + newTypeText + ' form...', 'info');

                // Fetch the new form schema
                API.get('formschema', { transactionType: newTransactionType })
                    .then(function(formSchemaData) {
                        self.formFields = formSchemaData;

                        // Re-inject accounts and items into the new form schema
                        self.injectSublistOptions(self.expenseAccountsData, self.cogsAccountsData, self.itemsData);

                        // Re-render the extraction form with new document type form
                        self.renderExtractionForm();
                        self.updateApplyAllButton();
                        self.bindBodyFieldTypeahead();

                        UI.toast(newTypeText + ' form loaded', 'success');
                    })
                    .catch(function(err) {
                        console.error('[Review] Failed to load form schema:', err);
                        UI.toast('Failed to load ' + newTypeText + ' form', 'error');
                        // Still render with existing form fields
                        self.renderExtractionForm();
                    });
            } else {
                // Same transaction type, just re-render
                this.renderExtractionForm();
                this.updateApplyAllButton();
                this.bindBodyFieldTypeahead();
            }
        },

        goToNextDocument: function() {
            if (this.queueIndex < 0 || this.queueIndex >= this.queueIds.length - 1) return;

            var nextId = this.queueIds[this.queueIndex + 1];
            // Use internal transition to keep toolbar/divider static with skeleton loaders
            this.transitionToDocument(nextId);
        },

        goToPrevDocument: function() {
            if (this.queueIndex <= 0) return;

            var prevId = this.queueIds[this.queueIndex - 1];
            // Use internal transition to keep toolbar/divider static with skeleton loaders
            this.transitionToDocument(prevId);
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

            // Update zoom display
            var zoomDisplay = el('#zoom-level');
            if (zoomDisplay) {
                zoomDisplay.textContent = Math.round(this.zoom * 100) + '%';
            }

            // If using PDF.js, re-render the page at new zoom
            if (this.pdfDoc && this.pdfPage) {
                this.renderPdfPage(this.currentPage);
            } else {
                // Fallback to iframe transform
                var iframe = el('#doc-preview');
                if (iframe) {
                    iframe.style.transform = 'scale(' + this.zoom + ') rotate(' + this.rotation + 'deg)';
                }
            }
        },

        rotate: function() {
            this.rotation = (this.rotation + 90) % 360;

            // If using PDF.js, re-render the page with new rotation
            if (this.pdfDoc && this.pdfPage) {
                this.renderPdfPage(this.currentPage);
            } else {
                // Fallback to iframe transform
                var iframe = el('#doc-preview');
                if (iframe) {
                    iframe.style.transform = 'scale(' + this.zoom + ') rotate(' + this.rotation + 'deg)';
                }
            }
        },

        toggleSplitView: function() {
            var viewReview = el('.view-review');
            var btn = el('#btn-view-mode');
            if (!viewReview) return;

            var isSplitView = viewReview.classList.toggle('split-view');

            // Toggle button active state
            if (btn) {
                btn.classList.toggle('active', isSplitView);
            }

            // If entering split view, restructure the DOM
            if (isSplitView) {
                this.setupSplitViewDom();
            } else {
                this.restoreNormalViewDom();
            }

            // Store preference
            localStorage.setItem('fluxReviewSplitView', isSplitView ? 'true' : 'false');
        },

        setupSplitViewDom: function() {
            var self = this;
            var reviewContent = el('#review-content');
            var previewPanel = el('#preview-panel');
            var extractionPanel = el('#extraction-panel');
            var resizer = el('#panel-resizer');

            if (!reviewContent || !previewPanel || !extractionPanel) return;

            // Create top section wrapper (2/3 height)
            var topSection = document.createElement('div');
            topSection.className = 'review-top-section';
            topSection.id = 'review-top-section';

            // Move preview and extraction panel to top section
            topSection.appendChild(previewPanel);
            if (resizer) topSection.appendChild(resizer);
            topSection.appendChild(extractionPanel);

            // Create vertical resizer between top and bottom sections
            var vResizer = document.createElement('div');
            vResizer.className = 'split-view-v-resizer';
            vResizer.id = 'split-view-v-resizer';
            vResizer.title = 'Drag to resize';
            var vHandle = document.createElement('div');
            vHandle.className = 'resizer-handle';
            vResizer.appendChild(vHandle);

            // Create bottom section for sublists (1/3 height)
            var bottomSection = document.createElement('div');
            bottomSection.className = 'review-bottom-section';
            bottomSection.id = 'review-bottom-section';

            // Move ALL sublists to bottom section (not clone)
            // Use querySelectorAll because there may be multiple .line-section elements across tabs
            // Store original parent tab ID so we can restore to correct location later
            var sublistSections = extractionPanel.querySelectorAll('.line-section');
            sublistSections.forEach(function(sublistSection) {
                var parentTabContent = sublistSection.closest('.form-tab-content');
                if (parentTabContent) {
                    sublistSection.dataset.originalTabContent = parentTabContent.getAttribute('data-tab-content');
                }
                bottomSection.appendChild(sublistSection);
            });

            // Add sections to review content
            reviewContent.appendChild(topSection);
            reviewContent.appendChild(vResizer);
            reviewContent.appendChild(bottomSection);

            // Switch main form area to first tab
            var firstTab = extractionPanel.querySelector('.extraction-tabs .tab-btn');
            if (firstTab && !firstTab.classList.contains('active')) {
                firstTab.click();
            }

            // Rebind sublist events for moved elements
            this.bindSublistEvents(bottomSection);

            // Initialize split view resizers
            this.initSplitViewResizers();
        },

        initSplitViewResizers: function() {
            var self = this;

            // Horizontal resizer (left/right between preview and extraction in top section)
            var hResizer = el('#panel-resizer');
            var previewPanel = el('#preview-panel');
            var topSection = el('#review-top-section');
            var previewViewport = el('#preview-viewport');

            // Vertical resizer (top/bottom between top section and bottom section)
            var vResizer = el('#split-view-v-resizer');
            var bottomSection = el('#review-bottom-section');
            var reviewContent = el('#review-content');

            // Create overlay to prevent iframe from stealing events
            var overlay = document.createElement('div');
            overlay.id = 'split-resize-overlay';
            overlay.style.cssText = 'position:fixed;top:0;left:0;right:0;bottom:0;z-index:9999;display:none;';
            document.body.appendChild(overlay);

            // Store reference for cleanup
            this.splitViewOverlay = overlay;

            // === Horizontal Resizer (left/right) ===
            if (hResizer && previewPanel && topSection) {
                var hIsResizing = false;
                var hStartX, hStartWidth;

                function startHResize(e) {
                    hIsResizing = true;
                    hStartX = e.clientX;
                    hStartWidth = previewPanel.offsetWidth;
                    hResizer.classList.add('dragging');
                    overlay.style.display = 'block';
                    overlay.style.cursor = 'col-resize';
                    document.body.style.cursor = 'col-resize';
                    document.body.style.userSelect = 'none';
                    if (previewViewport) previewViewport.style.pointerEvents = 'none';
                    e.preventDefault();
                }

                function doHResize(e) {
                    if (!hIsResizing) return;
                    e.preventDefault();

                    var containerWidth = topSection.offsetWidth;
                    var newWidth = hStartWidth + (e.clientX - hStartX);

                    // Constrain between 250px and 70% of container
                    var minWidth = 250;
                    var maxWidth = containerWidth * 0.7;
                    newWidth = Math.max(minWidth, Math.min(maxWidth, newWidth));

                    // Use flex shorthand for consistent sizing
                    previewPanel.style.flex = '0 0 ' + newWidth + 'px';
                    previewPanel.style.width = '';
                }

                function stopHResize() {
                    if (!hIsResizing) return;
                    hIsResizing = false;
                    hResizer.classList.remove('dragging');
                    overlay.style.display = 'none';
                    document.body.style.cursor = '';
                    document.body.style.userSelect = '';
                    if (previewViewport) previewViewport.style.pointerEvents = '';

                    // Save pixel width to localStorage
                    try {
                        var currentWidth = previewPanel.offsetWidth;
                        localStorage.setItem('fc_splitview_h_width_px', currentWidth);
                    } catch (e) { /* ignore */ }
                }

                hResizer.addEventListener('mousedown', startHResize);
                document.addEventListener('mousemove', doHResize);
                document.addEventListener('mouseup', stopHResize);
                overlay.addEventListener('mousemove', doHResize);
                overlay.addEventListener('mouseup', stopHResize);

                // Store references for cleanup
                this.splitViewHResizeHandlers = {
                    startHResize: startHResize,
                    doHResize: doHResize,
                    stopHResize: stopHResize
                };

                // Restore saved width
                try {
                    var savedWidth = localStorage.getItem('fc_splitview_h_width_px');
                    if (savedWidth) {
                        var widthPx = parseInt(savedWidth, 10);
                        var containerWidth = topSection.offsetWidth;
                        widthPx = Math.max(250, Math.min(containerWidth * 0.7, widthPx));
                        previewPanel.style.flex = '0 0 ' + widthPx + 'px';
                        previewPanel.style.width = '';
                    }
                } catch (e) { /* ignore */ }
            }

            // === Vertical Resizer (top/bottom) ===
            if (vResizer && topSection && bottomSection && reviewContent) {
                var vIsResizing = false;
                var vStartY, vStartTopHeight;

                function startVResize(e) {
                    vIsResizing = true;
                    vStartY = e.clientY;
                    vStartTopHeight = topSection.offsetHeight;
                    vResizer.classList.add('dragging');
                    overlay.style.display = 'block';
                    overlay.style.cursor = 'row-resize';
                    document.body.style.cursor = 'row-resize';
                    document.body.style.userSelect = 'none';
                    if (previewViewport) previewViewport.style.pointerEvents = 'none';
                    e.preventDefault();
                }

                function doVResize(e) {
                    if (!vIsResizing) return;
                    e.preventDefault();

                    var containerHeight = reviewContent.offsetHeight;
                    var newTopHeight = vStartTopHeight + (e.clientY - vStartY);

                    // Constrain between 200px and 80% of container
                    var minHeight = 200;
                    var maxHeight = containerHeight * 0.8;
                    newTopHeight = Math.max(minHeight, Math.min(maxHeight, newTopHeight));

                    // Use flex shorthand for consistent sizing
                    topSection.style.flex = '0 0 ' + newTopHeight + 'px';
                    bottomSection.style.flex = '1';
                }

                function stopVResize() {
                    if (!vIsResizing) return;
                    vIsResizing = false;
                    vResizer.classList.remove('dragging');
                    overlay.style.display = 'none';
                    document.body.style.cursor = '';
                    document.body.style.userSelect = '';
                    if (previewViewport) previewViewport.style.pointerEvents = '';

                    // Save pixel height to localStorage
                    try {
                        var currentHeight = topSection.offsetHeight;
                        localStorage.setItem('fc_splitview_v_height_px', currentHeight);
                    } catch (e) { /* ignore */ }
                }

                vResizer.addEventListener('mousedown', startVResize);
                document.addEventListener('mousemove', doVResize);
                document.addEventListener('mouseup', stopVResize);
                overlay.addEventListener('mousemove', doVResize);
                overlay.addEventListener('mouseup', stopVResize);

                // Store references for cleanup
                this.splitViewVResizeHandlers = {
                    startVResize: startVResize,
                    doVResize: doVResize,
                    stopVResize: stopVResize
                };

                // Restore saved height
                try {
                    var savedHeight = localStorage.getItem('fc_splitview_v_height_px');
                    if (savedHeight) {
                        var heightPx = parseInt(savedHeight, 10);
                        var containerHeight = reviewContent.offsetHeight;
                        heightPx = Math.max(200, Math.min(containerHeight * 0.8, heightPx));
                        topSection.style.flex = '0 0 ' + heightPx + 'px';
                        bottomSection.style.flex = '1';
                    }
                } catch (e) { /* ignore */ }
            }
        },

        cleanupSplitViewResizers: function() {
            // Remove overlay
            if (this.splitViewOverlay) {
                this.splitViewOverlay.remove();
                this.splitViewOverlay = null;
            }

            // Remove horizontal resizer event listeners
            var hResizer = el('#panel-resizer');
            if (hResizer && this.splitViewHResizeHandlers) {
                hResizer.removeEventListener('mousedown', this.splitViewHResizeHandlers.startHResize);
                document.removeEventListener('mousemove', this.splitViewHResizeHandlers.doHResize);
                document.removeEventListener('mouseup', this.splitViewHResizeHandlers.stopHResize);
                this.splitViewHResizeHandlers = null;
            }

            // Remove vertical resizer event listeners
            var vResizer = el('#split-view-v-resizer');
            if (vResizer && this.splitViewVResizeHandlers) {
                vResizer.removeEventListener('mousedown', this.splitViewVResizeHandlers.startVResize);
                document.removeEventListener('mousemove', this.splitViewVResizeHandlers.doVResize);
                document.removeEventListener('mouseup', this.splitViewVResizeHandlers.stopVResize);
                this.splitViewVResizeHandlers = null;
            }
        },

        bindSublistEvents: function(container) {
            var self = this;
            if (!container) return;

            // Sublist tab switching
            container.querySelectorAll('.sublist-tabs').forEach(function(tabsContainer) {
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

                    // Show the correct sublist container
                    container.querySelectorAll('.sublist-container').forEach(function(c) {
                        c.classList.remove('active');
                    });
                    var sublistContainer = container.querySelector('#sublist-' + sublistId);
                    if (sublistContainer) sublistContainer.classList.add('active');
                });
            });

            // Line item add button
            container.querySelectorAll('.btn-add-line').forEach(function(btn) {
                btn.addEventListener('click', function() {
                    var sublistId = this.closest('.sublist-container').id.replace('sublist-', '');
                    self.addLineItem(sublistId);
                });
            });

            // Line item delete buttons (delegated)
            container.querySelectorAll('.sublist-table tbody').forEach(function(tbody) {
                tbody.addEventListener('click', function(e) {
                    var deleteBtn = e.target.closest('.btn-delete-line');
                    if (deleteBtn) {
                        var row = deleteBtn.closest('tr');
                        var sublistId = tbody.closest('.sublist-container').id.replace('sublist-', '');
                        var lineIdx = Array.from(tbody.querySelectorAll('tr')).indexOf(row);
                        self.deleteLineItem(sublistId, lineIdx);
                    }
                });
            });

            // Line input changes (delegated event handling like the main sublist rendering)
            container.querySelectorAll('.sublist-table tbody').forEach(function(tbody) {
                var sublistContainer = tbody.closest('.sublist-container');
                var sublistId = sublistContainer ? sublistContainer.id.replace('sublist-', '') : '';

                // Handle regular input changes
                tbody.addEventListener('input', function(e) {
                    var input = e.target;
                    if (!input.classList.contains('line-input')) return;

                    var row = input.closest('tr');
                    if (!row) return;

                    var idx = parseInt(row.dataset.idx, 10);
                    var fieldId = input.dataset.field;
                    var value = input.value;

                    self.updateSublistLine(sublistId, idx, fieldId, value);
                });

                // Handle checkbox changes
                tbody.addEventListener('change', function(e) {
                    var input = e.target;
                    if (!input.classList.contains('line-checkbox')) return;

                    var row = input.closest('tr');
                    if (!row) return;

                    var idx = parseInt(row.dataset.idx, 10);
                    var fieldId = input.dataset.field;
                    var value = input.checked;

                    self.updateSublistLine(sublistId, idx, fieldId, value, true);
                });
            });
        },

        restoreNormalViewDom: function() {
            var reviewContent = el('#review-content');
            var topSection = el('#review-top-section');
            var bottomSection = el('#review-bottom-section');
            var vResizer = el('#split-view-v-resizer');
            var previewPanel = el('#preview-panel');
            var extractionPanel = el('#extraction-panel');
            var resizer = el('#panel-resizer');

            if (!reviewContent || !topSection) return;

            // Clean up split view resizers event listeners
            this.cleanupSplitViewResizers();

            // Move ALL sublist sections back to their original parent tab content
            // Use the stored data-original-tab-content attribute to find correct parent
            if (bottomSection && extractionPanel) {
                var sublistSections = bottomSection.querySelectorAll('.line-section');

                sublistSections.forEach(function(sublistSection) {
                    var originalTabId = sublistSection.dataset.originalTabContent;
                    var originalParent = null;

                    // Try to find the original parent tab content
                    if (originalTabId) {
                        originalParent = extractionPanel.querySelector('.form-tab-content[data-tab-content="' + originalTabId + '"]');
                    }

                    if (originalParent) {
                        // Restore to original tab content - append at the end of the tab
                        originalParent.appendChild(sublistSection);
                    } else {
                        // Fallback: insert before amounts section
                        var amountsSection = extractionPanel.querySelector('.amounts-section');
                        if (amountsSection) {
                            extractionPanel.insertBefore(sublistSection, amountsSection);
                        } else {
                            var actionSection = extractionPanel.querySelector('.action-section');
                            if (actionSection) {
                                extractionPanel.insertBefore(sublistSection, actionSection);
                            } else {
                                extractionPanel.appendChild(sublistSection);
                            }
                        }
                    }

                    // Clean up the data attribute
                    delete sublistSection.dataset.originalTabContent;
                });
            }

            // Move panels back to review content
            reviewContent.appendChild(previewPanel);
            if (resizer) reviewContent.appendChild(resizer);
            reviewContent.appendChild(extractionPanel);

            // Remove the split view sections and vertical resizer
            if (topSection) topSection.remove();
            if (vResizer) vResizer.remove();
            if (bottomSection) bottomSection.remove();
        },

        goToPage: function(page) {
            if (page < 1 || page > this.totalPages) return;
            this.currentPage = page;

            // Update page display
            var pageDisplay = el('#page-display');
            if (pageDisplay) {
                pageDisplay.textContent = this.currentPage + ' / ' + this.totalPages;
            }

            // If using PDF.js, render the new page
            if (this.pdfDoc) {
                this.renderPdfPage(this.currentPage);
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
                            '<div class="shortcut-item"><kbd>Ctrl+Shift+V</kbd> <span>Quick assign palette</span></div>' +
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
                    '<button class="btn btn-primary" id="btn-back-error"><i class="fas fa-upload"></i> Upload Documents</button>' +
                '</div>';

                el('#btn-back-error').addEventListener('click', function() {
                    Router.navigate('ingest');
                });
            }
        },

        // ==========================================
        // EXTRACTION POOL SYSTEM
        // ==========================================

        /**
         * Compute unmatched extractions from _allExtractedFields
         * Shows all extracted fields that haven't been matched to standard form fields
         */
        computeUnmatchedExtractions: function() {
            var self = this;
            var doc = this.data;
            var extractedData = doc.extractedData || {};
            var allFields = extractedData._allExtractedFields || {};

            // Debug logging
            FCDebug.log('[ExtractionPool] extractedData keys:', Object.keys(extractedData));
            FCDebug.log('[ExtractionPool] _allExtractedFields keys:', Object.keys(allFields));

            // Get the field IDs that are already matched to form fields
            var matchedIds = this.getMatchedFieldIds();
            FCDebug.log('[ExtractionPool] Matched field IDs:', matchedIds);

            // Track what's already been applied this session
            var appliedKeys = this.extractionPool.applied.map(function(a) { return a.extractionKey; });

            this.extractionPool.unmatched = [];

            // Process _allExtractedFields - these are the raw OCR extractions
            Object.keys(allFields).forEach(function(key) {
                var normalizedKey = key.toLowerCase();

                // Skip if already matched to a form field or applied this session
                if (matchedIds.indexOf(normalizedKey) !== -1) return;
                if (appliedKeys.indexOf(key) !== -1) return;

                var field = allFields[key];
                var fieldValue = field.value !== undefined ? field.value : field;

                // Skip empty values
                if (fieldValue === null || fieldValue === undefined || fieldValue === '') return;

                // Handle both object format {label, value, confidence} and plain values
                var label = field.label || key;
                var value = fieldValue;
                var confidence = field.confidence || 0.5;
                var position = field.position || null;

                // If it's a plain value (not object with label/value structure)
                if (typeof field !== 'object' || (!field.label && !field.value)) {
                    value = field;
                    confidence = 0.5;
                }

                self.extractionPool.unmatched.push({
                    id: 'extract_' + key,
                    key: key,
                    label: label,
                    value: value,
                    confidence: confidence,
                    position: position,
                    category: self.categorizeExtraction({ label: label, value: value })
                });
            });

            // Sort by confidence descending
            this.extractionPool.unmatched.sort(function(a, b) {
                return (b.confidence || 0) - (a.confidence || 0);
            });

            FCDebug.log('[ExtractionPool] Found', this.extractionPool.unmatched.length, 'unmatched extractions:',
                this.extractionPool.unmatched.map(function(u) { return u.label + ': ' + u.value; }));
        },

        /**
         * Categorize an extraction by type
         */
        categorizeExtraction: function(field) {
            var value = String(field.value || '');
            var label = String(field.label || '').toLowerCase();

            // Check for amounts
            if (/^\$?[\d,]+\.?\d*$/.test(value.trim()) || label.indexOf('amount') !== -1 ||
                label.indexOf('total') !== -1 || label.indexOf('price') !== -1) {
                return 'amounts';
            }

            // Check for dates
            if (/^\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4}$/.test(value.trim()) ||
                label.indexOf('date') !== -1) {
                return 'dates';
            }

            // Check for references
            if (label.indexOf('number') !== -1 || label.indexOf('ref') !== -1 ||
                label.indexOf('po') !== -1 || label.indexOf('invoice') !== -1 ||
                /^[A-Z]{2,}[\-\d]+/.test(value.trim())) {
                return 'references';
            }

            return 'text';
        },

        /**
         * Render the Extraction Pool panel
         */
        renderExtractionPoolPanel: function() {
            var self = this;
            var unmatched = this.extractionPool.unmatched;
            var isExpanded = this.extractionPool.panelExpanded;
            var filterCategory = this.extractionPool.filterCategory;

            // Filter by category if not 'all'
            var filteredItems = filterCategory === 'all' ? unmatched :
                unmatched.filter(function(item) { return item.category === filterCategory; });

            // Filter by search query
            var searchQuery = (this.extractionPool.searchQuery || '').toLowerCase();
            if (searchQuery) {
                filteredItems = filteredItems.filter(function(item) {
                    return item.label.toLowerCase().indexOf(searchQuery) !== -1 ||
                           String(item.value).toLowerCase().indexOf(searchQuery) !== -1;
                });
            }

            var html = '<div class="extraction-pool-panel' + (isExpanded ? ' expanded' : ' collapsed') + '" id="extraction-pool-panel">' +
                '<div class="pool-header" id="pool-header">' +
                    '<div class="pool-title">' +
                        '<i class="fas fa-layer-group"></i>' +
                        '<span>Additional Extracted Fields</span>' +
                        '<span class="pool-count">' + unmatched.length + '</span>' +
                    '</div>' +
                    '<div class="pool-actions">' +
                        '<button class="btn btn-ghost btn-sm" id="btn-toggle-annotations" title="Show extractions on document">' +
                            '<i class="fas fa-highlighter"></i>' +
                        '</button>' +
                        '<button class="btn btn-ghost btn-sm pool-toggle" id="pool-toggle">' +
                            '<i class="fas fa-chevron-' + (isExpanded ? 'up' : 'down') + '"></i>' +
                        '</button>' +
                    '</div>' +
                '</div>';

            if (isExpanded) {
                html += '<div class="pool-toolbar">' +
                    '<div class="pool-search">' +
                        '<i class="fas fa-search"></i>' +
                        '<input type="text" id="pool-search-input" placeholder="Search extractions..." value="' + escapeHtml(searchQuery) + '">' +
                    '</div>' +
                    '<div class="pool-filters">' +
                        '<button class="pool-filter-btn' + (filterCategory === 'all' ? ' active' : '') + '" data-category="all">All</button>' +
                        '<button class="pool-filter-btn' + (filterCategory === 'amounts' ? ' active' : '') + '" data-category="amounts"><i class="fas fa-dollar-sign"></i></button>' +
                        '<button class="pool-filter-btn' + (filterCategory === 'dates' ? ' active' : '') + '" data-category="dates"><i class="fas fa-calendar"></i></button>' +
                        '<button class="pool-filter-btn' + (filterCategory === 'references' ? ' active' : '') + '" data-category="references"><i class="fas fa-hashtag"></i></button>' +
                        '<button class="pool-filter-btn' + (filterCategory === 'text' ? ' active' : '') + '" data-category="text"><i class="fas fa-font"></i></button>' +
                    '</div>' +
                '</div>' +
                '<div class="pool-cards" id="pool-cards">';

                if (filteredItems.length === 0) {
                    html += '<div class="pool-empty">' +
                        '<i class="fas fa-filter-circle-xmark"></i>' +
                        '<span>No matching extractions</span>' +
                    '</div>';
                } else {
                    filteredItems.forEach(function(item) {
                        var confClass = item.confidence >= 0.85 ? 'high' : item.confidence >= 0.6 ? 'medium' : 'low';
                        var displayValue = String(item.value).length > 40 ?
                            String(item.value).substring(0, 40) + '...' : item.value;

                        html += '<div class="pool-card" draggable="true" ' +
                            'data-extraction-id="' + item.id + '" ' +
                            'data-extraction-key="' + escapeHtml(item.key) + '" ' +
                            'data-extraction-value="' + escapeHtml(item.value) + '">' +
                            '<div class="pool-card-header">' +
                                '<span class="pool-card-label">' + escapeHtml(item.label) + '</span>' +
                                '<span class="pool-card-confidence conf-' + confClass + '">' + Math.round(item.confidence * 100) + '%</span>' +
                            '</div>' +
                            '<div class="pool-card-value">' + escapeHtml(displayValue) + '</div>' +
                            '<div class="pool-card-actions">' +
                                '<button class="btn btn-ghost btn-xs pool-card-copy" title="Copy value"><i class="fas fa-copy"></i></button>' +
                                '<button class="btn btn-ghost btn-xs pool-card-locate" title="Find in document"><i class="fas fa-crosshairs"></i></button>' +
                                '<button class="btn btn-ghost btn-xs pool-card-dismiss" title="Dismiss"><i class="fas fa-times"></i></button>' +
                            '</div>' +
                        '</div>';
                    });
                }

                html += '</div>'; // close pool-cards
            }

            html += '</div>'; // close extraction-pool-panel

            return html;
        },

        /**
         * Apply an extraction value to a form field
         */
        applyExtractionToField: function(extractionKey, extractionData, targetFieldId) {
            var self = this;
            var value = extractionData.value;

            // Find the target field input - try multiple selectors
            var input = el('#field-' + targetFieldId);
            if (!input) {
                // Try finding by data-field attribute (non-hidden first)
                input = document.querySelector('input:not([type="hidden"])[data-field="' + targetFieldId + '"]');
            }
            if (!input) {
                // Try any element with data-field
                input = document.querySelector('[data-field="' + targetFieldId + '"]');
            }

            if (!input) {
                UI.toast('Could not find field: ' + targetFieldId, 'error');
                return;
            }

            // Get field label for tracking
            var fieldLabel = targetFieldId;
            var formField = input.closest('.form-field');
            if (formField) {
                var labelEl = formField.querySelector('label');
                if (labelEl) {
                    fieldLabel = labelEl.textContent.replace(/[*%\d]/g, '').trim();
                }
            }

            // Store previous value for undo
            var previousValue = input.value;

            // Apply the value - handle typeahead displays too
            input.value = value;

            // If this is a typeahead field, also update the display input
            var typeaheadWrapper = input.closest('.typeahead-select');
            if (typeaheadWrapper) {
                var displayInput = typeaheadWrapper.querySelector('.typeahead-display');
                if (displayInput) {
                    displayInput.value = value;
                }
            }

            input.dispatchEvent(new Event('change', { bubbles: true }));
            input.dispatchEvent(new Event('input', { bubbles: true }));

            // Track this application
            this.extractionPool.applied.push({
                extractionKey: extractionKey,
                fromLabel: extractionData.label || extractionKey,
                fromValue: value,
                targetFieldId: targetFieldId,
                toLabel: fieldLabel,
                previousValue: previousValue,
                timestamp: Date.now()
            });

            // Remove from unmatched
            this.extractionPool.unmatched = this.extractionPool.unmatched.filter(function(item) {
                return item.key !== extractionKey;
            });

            // Update UI
            this.markUnsaved();
            UI.toast('Applied "' + String(value).substring(0, 30) + '" to ' + fieldLabel, 'success');

            // Refresh extraction pool display
            this.refreshExtractionPool();

            // Update annotations if showing - always refresh to show green status
            if (this.extractionPool.showAnnotations && this.pdfPage) {
                // Use CSS dimensions (not canvas.width which includes DPI scaling)
                var cssWidth = parseFloat(this.pdfCanvas.style.width) || this.pdfCanvas.clientWidth;
                var viewport = this.pdfPage.getViewport({
                    scale: cssWidth / this.pdfPage.getViewport({ scale: 1 }).width,
                    rotation: this.rotation
                });
                this.renderExtractionAnnotations(viewport);
            }
        },

        /**
         * Undo an applied item
         */
        undoAppliedItem: function(index) {
            var applied = this.extractionPool.applied[index];
            if (!applied) return;

            // Restore previous value
            var input = el('#field-' + applied.targetFieldId);
            if (!input) {
                input = document.querySelector('[data-field="' + applied.targetFieldId + '"]');
            }

            if (input) {
                input.value = applied.previousValue || '';
                input.dispatchEvent(new Event('change', { bubbles: true }));
            }

            // Re-add to unmatched pool
            this.extractionPool.unmatched.push({
                id: 'extract_' + applied.extractionKey,
                key: applied.extractionKey,
                label: applied.fromLabel,
                value: applied.fromValue,
                confidence: 0.5,
                category: 'text'
            });

            // Remove from applied
            this.extractionPool.applied.splice(index, 1);

            UI.toast('Undone: ' + applied.fromLabel, 'info');
            this.refreshExtractionPool();
        },

        /**
         * Refresh extraction pool display
         */
        refreshExtractionPool: function() {
            var poolPanel = el('#extraction-pool-panel');

            // Re-render pool panel
            if (poolPanel) {
                var newPoolHtml = this.renderExtractionPoolPanel();
                var tempDiv = document.createElement('div');
                tempDiv.innerHTML = newPoolHtml;
                poolPanel.parentNode.replaceChild(tempDiv.firstChild, poolPanel);
            }

            // Re-bind events
            this.bindExtractionPoolEvents();
        },

        /**
         * Bind extraction pool events
         */
        bindExtractionPoolEvents: function() {
            var self = this;

            // Pool toggle
            var toggleBtn = el('#pool-toggle');
            if (toggleBtn) {
                toggleBtn.onclick = function() {
                    self.extractionPool.panelExpanded = !self.extractionPool.panelExpanded;
                    self.refreshExtractionPool();
                };
            }

            // Pool header toggle (click anywhere on header)
            var poolHeader = el('#pool-header');
            if (poolHeader) {
                poolHeader.onclick = function(e) {
                    if (e.target.closest('.pool-actions')) return; // Don't toggle when clicking actions
                    self.extractionPool.panelExpanded = !self.extractionPool.panelExpanded;
                    self.refreshExtractionPool();
                };
            }

            // Toggle annotations button
            var annotBtn = el('#btn-toggle-annotations');
            if (annotBtn) {
                annotBtn.onclick = function(e) {
                    e.stopPropagation();
                    self.toggleAnnotations();
                };
            }

            // Search input
            var searchInput = el('#pool-search-input');
            if (searchInput) {
                searchInput.oninput = function() {
                    self.extractionPool.searchQuery = this.value;
                    self.refreshExtractionPool();
                };
            }

            // Filter buttons
            document.querySelectorAll('.pool-filter-btn').forEach(function(btn) {
                btn.onclick = function() {
                    self.extractionPool.filterCategory = this.dataset.category;
                    self.refreshExtractionPool();
                };
            });

            // Auto-scroll during drag - use document-level listener with capture
            var scrollInterval = null;
            var extractionPanel = el('#extraction-panel');

            function startAutoScroll(panel, direction, speed) {
                if (scrollInterval) return; // Already scrolling
                scrollInterval = setInterval(function() {
                    panel.scrollTop += direction * speed;
                }, 16);
            }

            function stopAutoScroll() {
                if (scrollInterval) {
                    clearInterval(scrollInterval);
                    scrollInterval = null;
                }
            }

            // Use document-level dragover with capture to handle scroll regardless of target
            if (extractionPanel) {
                document.addEventListener('dragover', function(e) {
                    if (!self.extractionPool.dragActive) return;

                    var rect = extractionPanel.getBoundingClientRect();
                    var y = e.clientY;
                    var x = e.clientX;
                    var scrollZone = 80;

                    // Only scroll if mouse is within the extraction panel's x bounds
                    if (x >= rect.left && x <= rect.right) {
                        if (y < rect.top + scrollZone && y >= rect.top) {
                            startAutoScroll(extractionPanel, -1, 8);
                        } else if (y > rect.bottom - scrollZone && y <= rect.bottom) {
                            startAutoScroll(extractionPanel, 1, 8);
                        } else {
                            stopAutoScroll();
                        }
                    } else {
                        stopAutoScroll();
                    }
                }, true); // Use capture phase

                document.addEventListener('dragend', function() {
                    stopAutoScroll();
                }, true);
            }

            // Card drag events
            document.querySelectorAll('.pool-card').forEach(function(card) {
                card.ondragstart = function(e) {
                    self.extractionPool.dragActive = true;
                    e.dataTransfer.effectAllowed = 'copy';
                    e.dataTransfer.setData('text/plain', JSON.stringify({
                        key: card.dataset.extractionKey,
                        value: card.dataset.extractionValue,
                        id: card.dataset.extractionId
                    }));
                    card.classList.add('dragging');
                    document.body.classList.add('extraction-dragging');
                };

                card.ondragend = function() {
                    self.extractionPool.dragActive = false;
                    card.classList.remove('dragging');
                    document.body.classList.remove('extraction-dragging');
                    stopAutoScroll();
                    document.querySelectorAll('.form-field.drop-target').forEach(function(f) {
                        f.classList.remove('drop-target', 'drop-hover');
                    });
                };

                // Card action buttons
                var copyBtn = card.querySelector('.pool-card-copy');
                if (copyBtn) {
                    copyBtn.onclick = function(e) {
                        e.stopPropagation();
                        navigator.clipboard.writeText(card.dataset.extractionValue);
                        UI.toast('Copied to clipboard', 'success');
                    };
                }

                var locateBtn = card.querySelector('.pool-card-locate');
                if (locateBtn) {
                    locateBtn.onclick = function(e) {
                        e.stopPropagation();
                        // Enable annotations and highlight this field
                        if (!self.extractionPool.showAnnotations) {
                            self.toggleAnnotations();
                        }
                        // Scroll to the annotation
                        var annotation = document.querySelector('.extraction-annotation[data-field-key="' + card.dataset.extractionKey + '"]');
                        if (annotation) {
                            annotation.scrollIntoView({ behavior: 'smooth', block: 'center' });
                            annotation.classList.add('highlight-pulse');
                            setTimeout(function() { annotation.classList.remove('highlight-pulse'); }, 2000);
                        }
                    };
                }

                var dismissBtn = card.querySelector('.pool-card-dismiss');
                if (dismissBtn) {
                    dismissBtn.onclick = function(e) {
                        e.stopPropagation();
                        var key = card.dataset.extractionKey;
                        self.extractionPool.unmatched = self.extractionPool.unmatched.filter(function(item) {
                            return item.key !== key;
                        });
                        self.refreshExtractionPool();
                    };
                }

                // Click to select (alternative to drag)
                card.onclick = function(e) {
                    if (e.target.closest('.pool-card-actions')) return;

                    // Toggle selection
                    var wasSelected = card.classList.contains('selected');
                    document.querySelectorAll('.pool-card.selected').forEach(function(c) {
                        c.classList.remove('selected');
                    });

                    if (!wasSelected) {
                        card.classList.add('selected');
                        self.extractionPool.selectedCardId = card.dataset.extractionId;
                        document.body.classList.add('extraction-selecting');
                    } else {
                        self.extractionPool.selectedCardId = null;
                        document.body.classList.remove('extraction-selecting');
                    }
                };
            });

            // Form field drop targets
            document.querySelectorAll('.form-field').forEach(function(field) {
                field.ondragenter = function(e) {
                    if (!self.extractionPool.dragActive) return;
                    e.preventDefault();
                    field.classList.add('drop-target', 'drop-hover');
                };

                field.ondragover = function(e) {
                    if (!self.extractionPool.dragActive) return;
                    e.preventDefault();
                    e.dataTransfer.dropEffect = 'copy';
                };

                field.ondragleave = function(e) {
                    // Only remove classes if we're actually leaving the field (not moving to a child)
                    var relatedTarget = e.relatedTarget;
                    if (!relatedTarget || !field.contains(relatedTarget)) {
                        field.classList.remove('drop-target', 'drop-hover');
                    }
                };

                field.ondrop = function(e) {
                    e.preventDefault();
                    e.stopPropagation();
                    field.classList.remove('drop-target', 'drop-hover');

                    try {
                        var rawData = e.dataTransfer.getData('text/plain');
                        if (!rawData) {
                            console.warn('[ExtractionPool] No data in drop event');
                            return;
                        }
                        var data = JSON.parse(rawData);

                        // Find the primary input (skip hidden inputs for typeahead)
                        var input = field.querySelector('input:not([type="hidden"]), select, textarea');
                        if (!input) {
                            input = field.querySelector('input, select, textarea');
                        }

                        if (!input) {
                            console.warn('[ExtractionPool] No input found in field');
                            return;
                        }

                        if (!data.key) {
                            console.warn('[ExtractionPool] No key in dropped data');
                            return;
                        }

                        // Find extraction data - try both key match and id match
                        var extractionData = self.extractionPool.unmatched.find(function(item) {
                            return item.key === data.key || item.id === data.id;
                        });

                        if (!extractionData) {
                            // If not found, create from dropped data
                            extractionData = {
                                key: data.key,
                                value: data.value,
                                label: data.key
                            };
                        }

                        var fieldId = input.dataset.field || input.id.replace('field-', '');
                        self.applyExtractionToField(data.key, extractionData, fieldId);

                    } catch (err) {
                        console.error('[ExtractionPool] Drop error:', err);
                        UI.toast('Failed to apply extraction', 'error');
                    }
                };

                // Click to assign when card is selected
                field.onclick = function(e) {
                    if (!self.extractionPool.selectedCardId) return;
                    if (e.target.closest('input, select, textarea, button')) return;

                    var selectedCard = document.querySelector('.pool-card.selected');
                    if (selectedCard) {
                        var input = field.querySelector('input, select, textarea');
                        if (input) {
                            var key = selectedCard.dataset.extractionKey;
                            var extractionData = self.extractionPool.unmatched.find(function(item) {
                                return item.key === key;
                            });
                            if (extractionData) {
                                var fieldId = input.dataset.field || input.id.replace('field-', '');
                                self.applyExtractionToField(key, extractionData, fieldId);
                            }
                        }

                        // Deselect
                        selectedCard.classList.remove('selected');
                        self.extractionPool.selectedCardId = null;
                        document.body.classList.remove('extraction-selecting');
                    }
                };
            });

            // Sublist cell drop targets - use event delegation on line-section for persistence across re-renders
            var lineSections = document.querySelectorAll('.line-section');
            lineSections.forEach(function(lineSection) {
                // Prevent default drop on inputs to stop raw text insertion
                lineSection.addEventListener('dragover', function(e) {
                    if (!self.extractionPool.dragActive) return;
                    var cell = e.target.closest('td');
                    var input = e.target.closest('.line-input, .line-desc, .line-qty, .line-price, .line-amount');
                    if (cell || input) {
                        e.preventDefault();
                        e.dataTransfer.dropEffect = 'copy';
                        var targetCell = cell || (input ? input.closest('td') : null);
                        if (targetCell && !targetCell.classList.contains('drop-hover')) {
                            // Remove hover from other cells first
                            lineSection.querySelectorAll('td.drop-hover').forEach(function(c) {
                                c.classList.remove('drop-target', 'drop-hover');
                            });
                            targetCell.classList.add('drop-target', 'drop-hover');
                        }
                    }
                }, true);

                lineSection.addEventListener('dragleave', function(e) {
                    var cell = e.target.closest('td');
                    if (cell) {
                        var relatedTarget = e.relatedTarget;
                        if (!relatedTarget || !cell.contains(relatedTarget)) {
                            cell.classList.remove('drop-target', 'drop-hover');
                        }
                    }
                }, true);

                lineSection.addEventListener('drop', function(e) {
                    var cell = e.target.closest('td');
                    var input = e.target.closest('.line-input, .line-desc, .line-qty, .line-price, .line-amount') ||
                                (cell ? cell.querySelector('.line-input, .line-desc, .line-qty, .line-price, .line-amount, input, select') : null);

                    if (!input) return;

                    e.preventDefault();
                    e.stopPropagation();

                    // Clear all hover states
                    lineSection.querySelectorAll('td.drop-hover').forEach(function(c) {
                        c.classList.remove('drop-target', 'drop-hover');
                    });

                    try {
                        var rawData = e.dataTransfer.getData('text/plain');
                        if (!rawData) return;

                        var data = JSON.parse(rawData);
                        var value = data.value || '';

                        // Apply value directly to the input
                        input.value = value;
                        input.dispatchEvent(new Event('change', { bubbles: true }));
                        input.dispatchEvent(new Event('input', { bubbles: true }));

                        // Track this as applied for annotation updates
                        if (data.key) {
                            self.extractionPool.applied.push({
                                extractionKey: data.key,
                                fromLabel: data.key,
                                fromValue: value,
                                targetFieldId: input.id || 'sublist-cell',
                                toLabel: 'Line Item',
                                previousValue: '',
                                timestamp: Date.now()
                            });

                            // Remove from unmatched
                            self.extractionPool.unmatched = self.extractionPool.unmatched.filter(function(item) {
                                return item.key !== data.key;
                            });

                            // Refresh to update annotations
                            self.refreshExtractionPool();
                            if (self.extractionPool.showAnnotations && self.pdfPage) {
                                var cssWidth = parseFloat(self.pdfCanvas.style.width) || self.pdfCanvas.clientWidth;
                                var viewport = self.pdfPage.getViewport({
                                    scale: cssWidth / self.pdfPage.getViewport({ scale: 1 }).width,
                                    rotation: self.rotation
                                });
                                self.renderExtractionAnnotations(viewport);
                            }
                        }

                        UI.toast('Applied to line item', 'success');
                    } catch (err) {
                        console.error('[ExtractionPool] Sublist drop error:', err);
                    }
                }, true);
            });
        },

        // ==========================================
        // QUICK ASSIGN PALETTE (Cmd+Shift+V)
        // ==========================================
        openQuickAssignPalette: function(targetField) {
            var self = this;

            // Close if already open
            this.closeQuickAssignPalette();

            if (this.extractionPool.unmatched.length === 0) {
                UI.toast('No unmatched extractions available', 'info');
                return;
            }

            this.quickAssignOpen = true;
            this.quickAssignTargetField = targetField;

            // Get field label
            var fieldLabel = 'field';
            var formField = targetField.closest('.form-field');
            if (formField) {
                var label = formField.querySelector('label');
                if (label) fieldLabel = label.textContent.replace(/[*%\d]/g, '').trim();
            }

            // Create palette
            var palette = document.createElement('div');
            palette.className = 'quick-assign-palette';
            palette.id = 'quick-assign-palette';
            palette.innerHTML = '<div class="palette-overlay"></div>' +
                '<div class="palette-content">' +
                    '<div class="palette-header">' +
                        '<span>Assign to: <strong>' + escapeHtml(fieldLabel) + '</strong></span>' +
                        '<button class="btn btn-ghost btn-xs palette-close"><i class="fas fa-times"></i></button>' +
                    '</div>' +
                    '<div class="palette-search">' +
                        '<i class="fas fa-search"></i>' +
                        '<input type="text" id="palette-search-input" placeholder="Filter extractions..." autofocus>' +
                    '</div>' +
                    '<div class="palette-items" id="palette-items">' +
                        this.renderPaletteItems('') +
                    '</div>' +
                    '<div class="palette-footer">' +
                        '<span><kbd>↑</kbd><kbd>↓</kbd> Navigate</span>' +
                        '<span><kbd>Enter</kbd> Select</span>' +
                        '<span><kbd>Esc</kbd> Cancel</span>' +
                    '</div>' +
                '</div>';

            document.body.appendChild(palette);

            // Focus search
            var searchInput = el('#palette-search-input');
            if (searchInput) {
                searchInput.focus();

                searchInput.oninput = function() {
                    var items = el('#palette-items');
                    if (items) {
                        items.innerHTML = self.renderPaletteItems(this.value);
                        self.bindPaletteItemEvents();
                    }
                };

                searchInput.onkeydown = function(e) {
                    self.handlePaletteKeydown(e);
                };
            }

            // Close button
            palette.querySelector('.palette-close').onclick = function() {
                self.closeQuickAssignPalette();
            };

            // Overlay click
            palette.querySelector('.palette-overlay').onclick = function() {
                self.closeQuickAssignPalette();
            };

            this.bindPaletteItemEvents();
        },

        renderPaletteItems: function(filter) {
            var self = this;
            var items = this.extractionPool.unmatched;
            var filterLower = (filter || '').toLowerCase();

            if (filterLower) {
                items = items.filter(function(item) {
                    return item.label.toLowerCase().indexOf(filterLower) !== -1 ||
                           String(item.value).toLowerCase().indexOf(filterLower) !== -1;
                });
            }

            if (items.length === 0) {
                return '<div class="palette-empty">No matching extractions</div>';
            }

            var html = '';
            items.slice(0, 10).forEach(function(item, idx) {
                var confClass = item.confidence >= 0.85 ? 'high' : item.confidence >= 0.6 ? 'medium' : 'low';
                html += '<div class="palette-item' + (idx === 0 ? ' selected' : '') + '" ' +
                    'data-key="' + escapeHtml(item.key) + '" data-index="' + idx + '">' +
                    '<div class="palette-item-value">' + escapeHtml(String(item.value).substring(0, 50)) + '</div>' +
                    '<div class="palette-item-meta">' +
                        '<span class="palette-item-label">from: ' + escapeHtml(item.label) + '</span>' +
                        '<span class="palette-item-conf conf-' + confClass + '">' + Math.round(item.confidence * 100) + '%</span>' +
                    '</div>' +
                '</div>';
            });

            return html;
        },

        bindPaletteItemEvents: function() {
            var self = this;
            document.querySelectorAll('.palette-item').forEach(function(item) {
                item.onclick = function() {
                    self.selectPaletteItem(item);
                };

                item.onmouseenter = function() {
                    document.querySelectorAll('.palette-item.selected').forEach(function(i) {
                        i.classList.remove('selected');
                    });
                    item.classList.add('selected');
                };
            });
        },

        handlePaletteKeydown: function(e) {
            var items = document.querySelectorAll('.palette-item');
            var selected = document.querySelector('.palette-item.selected');
            var selectedIdx = selected ? parseInt(selected.dataset.index, 10) : -1;

            if (e.key === 'ArrowDown') {
                e.preventDefault();
                var nextIdx = Math.min(selectedIdx + 1, items.length - 1);
                items.forEach(function(item, idx) {
                    item.classList.toggle('selected', idx === nextIdx);
                });
                items[nextIdx]?.scrollIntoView({ block: 'nearest' });
            } else if (e.key === 'ArrowUp') {
                e.preventDefault();
                var prevIdx = Math.max(selectedIdx - 1, 0);
                items.forEach(function(item, idx) {
                    item.classList.toggle('selected', idx === prevIdx);
                });
                items[prevIdx]?.scrollIntoView({ block: 'nearest' });
            } else if (e.key === 'Enter') {
                e.preventDefault();
                if (selected) {
                    this.selectPaletteItem(selected);
                }
            } else if (e.key === 'Escape') {
                this.closeQuickAssignPalette();
            }
        },

        selectPaletteItem: function(item) {
            var key = item.dataset.key;
            var extractionData = this.extractionPool.unmatched.find(function(i) {
                return i.key === key;
            });

            if (extractionData && this.quickAssignTargetField) {
                var fieldId = this.quickAssignTargetField.dataset.field ||
                    this.quickAssignTargetField.id.replace('field-', '');
                this.applyExtractionToField(key, extractionData, fieldId);
            }

            this.closeQuickAssignPalette();
        },

        closeQuickAssignPalette: function() {
            var palette = el('#quick-assign-palette');
            if (palette) {
                palette.remove();
            }
            this.quickAssignOpen = false;
            this.quickAssignTargetField = null;
        },

        // ==========================================
        // GHOST TEXT SUGGESTIONS
        // ==========================================
        getGhostSuggestion: function(fieldId, fieldLabel) {
            var unmatched = this.extractionPool.unmatched;
            if (!unmatched || unmatched.length === 0) return null;

            var normalizedLabel = (fieldLabel || '').toLowerCase().replace(/[^a-z0-9]/g, '');
            var normalizedId = (fieldId || '').toLowerCase().replace(/[^a-z0-9]/g, '');

            // Find best match
            var bestMatch = null;
            var bestScore = 0;

            unmatched.forEach(function(item) {
                var itemLabel = (item.label || '').toLowerCase().replace(/[^a-z0-9]/g, '');

                // Score based on label similarity
                var score = 0;
                if (itemLabel === normalizedLabel || itemLabel === normalizedId) {
                    score = 1.0;
                } else if (itemLabel.indexOf(normalizedLabel) !== -1 || normalizedLabel.indexOf(itemLabel) !== -1) {
                    score = 0.7;
                } else if (itemLabel.indexOf(normalizedId) !== -1 || normalizedId.indexOf(itemLabel) !== -1) {
                    score = 0.6;
                }

                // Boost by confidence
                score *= (0.5 + item.confidence * 0.5);

                if (score > bestScore && score >= 0.4) {
                    bestScore = score;
                    bestMatch = item;
                }
            });

            return bestMatch;
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
            this.codingSuggestions = { headerDefaults: {}, lineItemSuggestions: [], meta: { hasLearning: false } };
            this.suggestionsApplied = false;
        }
    };

    // Register the controller
    Router.register('review',
        function(params) { ReviewController.init(params); },
        function() { ReviewController.cleanup(); }
    );

    FCDebug.log('[View.Review] World-Class Review Loaded');

})();
