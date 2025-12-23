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
        'KeyA': { action: 'approve', description: 'Approve & create' },
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
        entitySuggestions: [],
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

        // Image preview state
        imageElement: null,
        imageNaturalWidth: null,
        imageNaturalHeight: null,
        imageBaseWidth: null,

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

            // Refresh review badge when entering review tab
            if (window.updateReviewBadge) {
                window.updateReviewBadge();
            }

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

                    // Auto-load PO match data for vendor bills
                    if (self.transactionType === 'vendorbill' && self.data && self.data.vendorId) {
                        self.loadPOMatchData();
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
            this.imageElement = null;
            this.imageNaturalWidth = null;
            this.imageNaturalHeight = null;
            this.imageBaseWidth = null;
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

                        // Auto-select single options (like subsidiary) and resolve posting period
                        self.autoSelectSingleOptions();

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

            // Collect body fields from extraction panel
            var panel = el('#extraction-panel');
            if (panel) {
                // Regular inputs and selects with data-field attribute
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
            }

            // Collect entity field globally (special handling - no data-field attribute)
            // This works regardless of whether extraction panel exists
            var entityInput = el('#field-entity');
            var entityIdInput = el('#field-entityId');
            if (entityInput && entityInput.value) {
                bodyFields.entity_display = entityInput.value;
            }
            if (entityIdInput && entityIdInput.value) {
                bodyFields.entity = entityIdInput.value;
            }

            // Also check document-level data for entity (fallback if DOM not populated)
            if (!bodyFields.entity && this.data) {
                if (this.data.vendorId) {
                    bodyFields.entity = this.data.vendorId;
                } else if (this.data.employeeId) {
                    bodyFields.entity = this.data.employeeId;
                }
            }

            // Collect sublist data from sublistData (already tracked)
            // Filter out empty/default rows that have no meaningful data
            if (this.sublistData) {
                console.log('[Flux] collectFormData - sublistData keys:', Object.keys(this.sublistData));
                Object.keys(this.sublistData).forEach(function(sublistId) {
                    var normalizedId = sublistId.toLowerCase();
                    var lines = self.sublistData[sublistId] || [];

                    console.log('[Flux] collectFormData - sublist "' + sublistId + '" has ' + lines.length + ' lines');
                    if (lines.length > 0) {
                        console.log('[Flux] collectFormData - first line keys:', Object.keys(lines[0]));
                        console.log('[Flux] collectFormData - first line data:', JSON.stringify(lines[0]));
                    }

                    // Filter out empty lines
                    var nonEmptyLines = lines.filter(function(line) {
                        return self.isSublistLinePopulated(normalizedId, line);
                    });

                    console.log('[Flux] collectFormData - after filter: ' + nonEmptyLines.length + ' non-empty lines');
                    sublists[normalizedId] = nonEmptyLines;
                });
            } else {
                console.log('[Flux] collectFormData - NO sublistData!');
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
                    } else if (key === 'employeeName') {
                        bodyFields.entity_display = self.changes[key];
                    } else if (key === 'employeeId') {
                        bodyFields.entity = self.changes[key];
                    } else {
                        // For other changes, use as-is
                        bodyFields[key] = self.changes[key];
                    }
                });
            }

            // Merge with existing formData to preserve fields not in DOM
            // This handles cases where fields were previously saved but not currently rendered
            if (this.formData && this.formData.bodyFields) {
                var existingFields = this.formData.bodyFields;
                Object.keys(existingFields).forEach(function(key) {
                    // Only use existing value if we didn't collect a value from DOM
                    if (bodyFields[key] === undefined || bodyFields[key] === '') {
                        if (existingFields[key] !== undefined && existingFields[key] !== '') {
                            bodyFields[key] = existingFields[key];
                        }
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

            // Debug logging
            console.log('[Flux] collectFormData - panel exists:', !!panel);
            console.log('[Flux] collectFormData - entityInput:', entityInput ? entityInput.value : 'NOT FOUND');
            console.log('[Flux] collectFormData - entityIdInput:', entityIdInput ? entityIdInput.value : 'NOT FOUND');
            console.log('[Flux] collectFormData - this.changes:', this.changes);
            console.log('[Flux] collectFormData - bodyFields:', bodyFields);

            FCDebug.log('[FormData] Collected from DOM:', this.formData);
            return this.formData;
        },

        // ==========================================
        // EVENT BINDING
        // ==========================================
        bindEvents: function() {
            var self = this;

            // Check if events already bound to this DOM (prevents duplicate handlers)
            var toolbar = el('.review-toolbar');
            if (toolbar && toolbar._eventsBound) return;
            if (toolbar) toolbar._eventsBound = true;

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

            // Keyboard shortcuts for Transform Hub
            document.addEventListener('keydown', function(e) {
                // Escape to close Transform Hub
                if (e.key === 'Escape') {
                    var openDropdown = document.querySelector('.transform-dropdown.open');
                    if (openDropdown) {
                        openDropdown.classList.remove('open');
                        e.preventDefault();
                        return;
                    }
                }

                // Quick keyboard shortcuts when Transform Hub is open
                var openDropdown = document.querySelector('.transform-dropdown.open');
                if (openDropdown) {
                    var action = null;
                    var sublistId = openDropdown.id.replace('transform-dropdown-', '');

                    switch (e.key.toLowerCase()) {
                        case 'c': action = 'collapse'; break;
                        case '1': action = openDropdown.querySelector('[data-action^="by-account"], [data-action^="by-item"]') ?
                                    openDropdown.querySelector('[data-action^="by-account"], [data-action^="by-item"]').dataset.action : null; break;
                        case '2': action = 'by-department'; break;
                        case '3': action = 'by-class'; break;
                        case '4': action = 'by-location'; break;
                        case 's': action = 'split-equal'; break;
                        case 'd': action = 'apply-defaults'; break;
                    }

                    if (action) {
                        openDropdown.classList.remove('open');
                        self.transformSublist(sublistId, action);
                        e.preventDefault();
                    }
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

            // Prevent binding keyboard shortcuts multiple times
            if (this._keyboardShortcutsBound) return;
            this._keyboardShortcutsBound = true;

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

            // Check if file is an image based on URL or file extension
            var isImage = this.isImageFile(fileUrl);

            if (fileUrl && isImage) {
                // Render image with zoom/pan support
                this.renderImageWithZoom(viewport, fileUrl);
            } else if (fileUrl && typeof pdfjsLib !== 'undefined') {
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

        // Check if a URL points to an image file
        isImageFile: function(url) {
            if (!url) return false;
            var imageExtensions = /\.(jpg|jpeg|png|gif|webp|bmp|tiff|tif)(\?|#|$)/i;
            return imageExtensions.test(url);
        },

        // Render image with zoom and pan support (similar to PDF rendering)
        renderImageWithZoom: function(viewport, fileUrl) {
            var self = this;

            // Clear any previous PDF state
            this.pdfDoc = null;
            this.imageElement = null;

            // Store the viewport width for consistent zoom calculations
            // Use preview-viewport width, not pdf-container (which has width: max-content)
            this.imageBaseWidth = viewport.clientWidth - 40;

            // Create container structure similar to PDF
            viewport.innerHTML = '<div class="pdf-container" id="pdf-container">' +
                '<div class="pdf-loading"><div class="loading-spinner"></div><span>Loading image...</span></div>' +
                '<div class="pdf-pages-container" id="pdf-pages-container"></div>' +
            '</div>';

            var pagesContainer = el('#pdf-pages-container');
            var loadingEl = viewport.querySelector('.pdf-loading');

            if (!pagesContainer) return;

            // Store reference for scroll handling
            this.pdfPagesContainer = pagesContainer;
            this.pageElements = [];
            this.totalPages = 1;
            this.currentPage = 1;

            // Create image element
            var img = new Image();
            img.onload = function() {
                // Hide loading
                if (loadingEl) loadingEl.style.display = 'none';

                // Store original dimensions
                self.imageNaturalWidth = img.naturalWidth;
                self.imageNaturalHeight = img.naturalHeight;

                // Render the image at current zoom level
                self.renderImagePage(img, pagesContainer);

                // Setup pan handler (only once per viewport)
                if (!viewport._panHandlerAttached) {
                    self.setupPanHandler(viewport);
                    viewport._panHandlerAttached = true;
                }
                self.updatePanCursor();

                // Update page display
                var pageDisplay = el('#page-display');
                if (pageDisplay) {
                    pageDisplay.textContent = '1 / 1';
                }
            };

            img.onerror = function() {
                console.error('[Image] Error loading image:', fileUrl);
                // Fallback to iframe
                viewport.innerHTML = '<iframe src="' + fileUrl + '" id="doc-preview" ' +
                    'style="width:100%;height:100%;border:none;background:white;"></iframe>';
            };

            img.src = fileUrl;
            this.imageElement = img;
        },

        // Render image at current zoom level
        renderImagePage: function(img, pagesContainer) {
            var self = this;
            if (!pagesContainer) pagesContainer = this.pdfPagesContainer;
            if (!pagesContainer) return;

            // Clear existing content
            pagesContainer.innerHTML = '';
            this.pageElements = [];

            // Use stored base width for consistent zoom calculations
            var baseWidth = this.imageBaseWidth || 600;

            // Calculate the scale to fit the base width at zoom=1
            var fitScale = baseWidth / this.imageNaturalWidth;

            // Apply zoom to get final dimensions
            var scaledWidth = this.imageNaturalWidth * fitScale * this.zoom;
            var scaledHeight = this.imageNaturalHeight * fitScale * this.zoom;

            // Apply rotation to dimensions
            var displayWidth = scaledWidth;
            var displayHeight = scaledHeight;
            if (this.rotation === 90 || this.rotation === 270) {
                displayWidth = scaledHeight;
                displayHeight = scaledWidth;
            }

            // Create page wrapper (same structure as PDF)
            var pageWrapper = document.createElement('div');
            pageWrapper.className = 'pdf-page-wrapper';
            pageWrapper.dataset.page = 1;
            pageWrapper.style.width = displayWidth + 'px';
            pageWrapper.style.height = displayHeight + 'px';
            pageWrapper.style.overflow = 'hidden';

            // Create image element
            var imgEl = document.createElement('img');
            imgEl.src = img.src;
            imgEl.className = 'image-preview-content';
            imgEl.style.width = scaledWidth + 'px';
            imgEl.style.height = scaledHeight + 'px';
            imgEl.style.display = 'block';
            imgEl.style.transform = 'rotate(' + this.rotation + 'deg)';
            imgEl.style.transformOrigin = 'center center';

            // Adjust position for rotation
            if (this.rotation === 90) {
                imgEl.style.transform = 'rotate(90deg) translateY(-100%)';
                imgEl.style.transformOrigin = 'top left';
            } else if (this.rotation === 180) {
                imgEl.style.transform = 'rotate(180deg)';
                imgEl.style.transformOrigin = 'center center';
            } else if (this.rotation === 270) {
                imgEl.style.transform = 'rotate(270deg) translateX(-100%)';
                imgEl.style.transformOrigin = 'top left';
            }

            // Create annotation overlay for this page (for extraction annotations)
            var annotationOverlay = document.createElement('div');
            annotationOverlay.className = 'annotation-overlay';
            annotationOverlay.dataset.page = 1;
            annotationOverlay.style.width = displayWidth + 'px';
            annotationOverlay.style.height = displayHeight + 'px';

            // Append elements
            pageWrapper.appendChild(imgEl);
            pageWrapper.appendChild(annotationOverlay);
            pagesContainer.appendChild(pageWrapper);

            // Store reference
            this.pageElements.push({
                wrapper: pageWrapper,
                image: imgEl,
                overlay: annotationOverlay,
                pageNum: 1,
                viewport: {
                    width: displayWidth,
                    height: displayHeight
                }
            });

            // Render annotations if enabled
            if (this.extractionPool.showAnnotations) {
                this.renderPageAnnotations(1, annotationOverlay, {
                    width: displayWidth,
                    height: displayHeight
                });
            }
        },

        // ==========================================
        // PDF.JS RENDERING WITH ANNOTATIONS
        // ==========================================
        renderPdfWithAnnotations: function(viewport, fileUrl) {
            var self = this;

            // Clear any previous image state
            this.imageElement = null;
            this.imageNaturalWidth = null;
            this.imageNaturalHeight = null;
            this.imageBaseWidth = null;

            // Create container structure for continuous scrolling - all pages in one scrollable container
            viewport.innerHTML = '<div class="pdf-container" id="pdf-container">' +
                '<div class="pdf-loading"><div class="loading-spinner"></div><span>Loading document...</span></div>' +
                '<div class="pdf-pages-container" id="pdf-pages-container"></div>' +
            '</div>';

            var container = el('#pdf-container');
            var pagesContainer = el('#pdf-pages-container');
            var loadingEl = viewport.querySelector('.pdf-loading');

            if (!pagesContainer) return;

            // Store reference for scroll handling
            this.pdfPagesContainer = pagesContainer;
            this.pageElements = []; // Track page wrapper elements for scroll detection

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

                // Render all pages
                self.renderAllPdfPages().then(function() {
                    // Hide loading after all pages rendered
                    if (loadingEl) loadingEl.style.display = 'none';

                    // Setup scroll listener to track current page
                    self.setupPdfScrollListener();
                });

            }).catch(function(error) {
                console.error('[PDF.js] Error loading PDF:', error);
                // Fallback to iframe
                viewport.innerHTML = '<iframe src="' + fileUrl + '#toolbar=0" id="doc-preview" ' +
                    'style="width:100%;height:100%;border:none;background:white;"></iframe>';
            });
        },

        renderAllPdfPages: function() {
            var self = this;
            var promises = [];

            // Clear existing pages
            this.pdfPagesContainer.innerHTML = '';
            this.pageElements = [];

            for (var i = 1; i <= this.totalPages; i++) {
                promises.push(this.renderSinglePdfPage(i));
            }

            return Promise.all(promises);
        },

        renderSinglePdfPage: function(pageNum) {
            var self = this;
            if (!this.pdfDoc) return Promise.resolve();

            return this.pdfDoc.getPage(pageNum).then(function(page) {
                // Calculate scale to fit container
                var container = el('#pdf-container');
                var containerWidth = container ? container.clientWidth - 40 : 600;
                var originalViewport = page.getViewport({ scale: 1 });
                var baseScale = (containerWidth / originalViewport.width) * self.zoom;

                var viewport = page.getViewport({ scale: baseScale, rotation: self.rotation });

                // Create page wrapper
                var pageWrapper = document.createElement('div');
                pageWrapper.className = 'pdf-page-wrapper';
                pageWrapper.dataset.page = pageNum;

                // Create canvas for this page
                var canvas = document.createElement('canvas');
                canvas.className = 'pdf-page-canvas';

                // Create annotation overlay for this page
                var annotationOverlay = document.createElement('div');
                annotationOverlay.className = 'annotation-overlay';
                annotationOverlay.dataset.page = pageNum;

                // Handle high DPI displays (Retina, etc.) for crisp rendering
                var dpr = window.devicePixelRatio || 1;

                // Set canvas dimensions - scale up for DPI
                canvas.width = Math.floor(viewport.width * dpr);
                canvas.height = Math.floor(viewport.height * dpr);

                // Set CSS dimensions to display at correct size
                canvas.style.width = viewport.width + 'px';
                canvas.style.height = viewport.height + 'px';

                // Set annotation overlay dimensions
                annotationOverlay.style.width = viewport.width + 'px';
                annotationOverlay.style.height = viewport.height + 'px';

                // Append elements
                pageWrapper.appendChild(canvas);
                pageWrapper.appendChild(annotationOverlay);
                self.pdfPagesContainer.appendChild(pageWrapper);

                // Store reference
                self.pageElements.push({
                    wrapper: pageWrapper,
                    canvas: canvas,
                    overlay: annotationOverlay,
                    pageNum: pageNum,
                    viewport: viewport
                });

                // Get context and scale for DPI
                var ctx = canvas.getContext('2d');
                ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

                // Render the page
                var renderContext = {
                    canvasContext: ctx,
                    viewport: viewport
                };

                return page.render(renderContext).promise.then(function() {
                    // Render annotations for this page if enabled
                    if (self.extractionPool.showAnnotations) {
                        self.renderPageAnnotations(pageNum, annotationOverlay, viewport);
                    }
                });
            });
        },

        setupPdfScrollListener: function() {
            var self = this;
            var previewViewport = el('#preview-viewport');
            if (!previewViewport) return;

            // Debounce scroll events
            var scrollTimeout = null;

            previewViewport.addEventListener('scroll', function() {
                if (scrollTimeout) clearTimeout(scrollTimeout);
                scrollTimeout = setTimeout(function() {
                    self.updateCurrentPageFromScroll();
                }, 50);
            });

            // Setup pan/drag functionality
            this.setupPanHandler(previewViewport);
        },

        setupPanHandler: function(viewport) {
            var self = this;
            var isPanning = false;
            var startX, startY, scrollLeft, scrollTop;

            viewport.addEventListener('mousedown', function(e) {
                // Only pan when zoomed in and not clicking on interactive elements
                if (self.zoom <= 1) return;
                if (e.target.closest('button, input, select, textarea, a, .extraction-annotation')) return;

                isPanning = true;
                viewport.classList.add('is-panning');
                startX = e.pageX - viewport.offsetLeft;
                startY = e.pageY - viewport.offsetTop;
                scrollLeft = viewport.scrollLeft;
                scrollTop = viewport.scrollTop;
                e.preventDefault();
            });

            viewport.addEventListener('mousemove', function(e) {
                if (!isPanning) return;

                var x = e.pageX - viewport.offsetLeft;
                var y = e.pageY - viewport.offsetTop;
                var walkX = (x - startX) * 1.5; // Multiplier for faster panning
                var walkY = (y - startY) * 1.5;

                viewport.scrollLeft = scrollLeft - walkX;
                viewport.scrollTop = scrollTop - walkY;
            });

            viewport.addEventListener('mouseup', function() {
                isPanning = false;
                viewport.classList.remove('is-panning');
            });

            viewport.addEventListener('mouseleave', function() {
                isPanning = false;
                viewport.classList.remove('is-panning');
            });

            // Update cursor based on zoom level
            this.updatePanCursor();
        },

        updatePanCursor: function() {
            var viewport = el('#preview-viewport');
            if (!viewport) return;

            if (this.zoom > 1) {
                viewport.classList.add('can-pan');
            } else {
                viewport.classList.remove('can-pan');
            }
        },

        updateCurrentPageFromScroll: function() {
            var previewViewport = el('#preview-viewport');
            if (!previewViewport || !this.pageElements.length) return;

            var viewportRect = previewViewport.getBoundingClientRect();
            var viewportMiddle = viewportRect.top + viewportRect.height / 2;

            // Find which page is most visible (closest to viewport middle)
            var closestPage = 1;
            var closestDistance = Infinity;

            for (var i = 0; i < this.pageElements.length; i++) {
                var pageEl = this.pageElements[i];
                var rect = pageEl.wrapper.getBoundingClientRect();
                var pageMiddle = rect.top + rect.height / 2;
                var distance = Math.abs(pageMiddle - viewportMiddle);

                if (distance < closestDistance) {
                    closestDistance = distance;
                    closestPage = pageEl.pageNum;
                }
            }

            // Update current page if changed
            if (this.currentPage !== closestPage) {
                this.currentPage = closestPage;
                var pageDisplay = el('#page-display');
                if (pageDisplay) {
                    pageDisplay.textContent = this.currentPage + ' / ' + this.totalPages;
                }
            }
        },

        // Legacy single page render - kept for compatibility but now re-renders all pages
        renderPdfPage: function(pageNum) {
            var self = this;
            if (!this.pdfDoc) return;

            // For continuous scrolling, re-render all pages when zoom/rotation changes
            if (this.pdfPagesContainer) {
                this.renderAllPdfPages().then(function() {
                    // Scroll to the current page after re-render
                    self.scrollToPage(pageNum);
                });
            }
        },

        scrollToPage: function(pageNum) {
            if (!this.pageElements || pageNum < 1 || pageNum > this.pageElements.length) return;

            var pageEl = this.pageElements[pageNum - 1];
            if (pageEl && pageEl.wrapper) {
                pageEl.wrapper.scrollIntoView({ behavior: 'smooth', block: 'start' });
            }
        },

        renderPageAnnotations: function(pageNum, overlayEl, pdfViewport) {
            var self = this;
            if (!overlayEl) return;

            // Clear existing annotations on this page
            overlayEl.innerHTML = '';

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

                // Check if this annotation belongs to this page
                // Default to page 1 if no page specified
                var fieldPage = pos.page || 1;
                if (fieldPage !== pageNum) return;

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
                var x, y, w, h;

                if (rawX > 1 || rawY > 1 || rawW > 1 || rawH > 1) {
                    // Coordinates are in inches - convert to viewport pixels
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

                overlayEl.appendChild(box);
            });
        },

        // ==========================================
        // EXTRACTION ANNOTATIONS ON DOCUMENT
        // ==========================================
        renderExtractionAnnotations: function(pdfViewport) {
            var self = this;

            // For multi-page continuous scrolling, render annotations on each page
            if (this.pageElements && this.pageElements.length > 0) {
                this.pageElements.forEach(function(pageEl) {
                    self.renderPageAnnotations(pageEl.pageNum, pageEl.overlay, pageEl.viewport);
                });
                return;
            }

            // Fallback for legacy single-page mode
            if (!this.annotationOverlay) return;
            this.annotationOverlay.innerHTML = '';
            this.renderPageAnnotations(1, this.annotationOverlay, pdfViewport);
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

            document.querySelectorAll('#btn-toggle-annotations').forEach(function(btn) {
                btn.classList.toggle('active', this.extractionPool.showAnnotations);
            }, this);

            // Multi-page (primary) path uses stored page overlays
            if (this.pageElements && this.pageElements.length > 0) {
                if (this.extractionPool.showAnnotations) {
                    this.pageElements.forEach(function(pageEl) {
                        this.renderPageAnnotations(pageEl.pageNum, pageEl.overlay, pageEl.viewport);
                    }, this);
                } else {
                    this.pageElements.forEach(function(pageEl) {
                        pageEl.overlay.innerHTML = '';
                    });
                }
                return;
            }

            // Legacy single-page fallback
            if (this.pdfPage && this.pdfCanvas) {
                // Use CSS dimensions (not canvas.width which includes DPI scaling)
                var cssWidth = parseFloat(this.pdfCanvas.style.width) || this.pdfCanvas.clientWidth;
                var viewport = this.pdfPage.getViewport({
                    scale: cssWidth / this.pdfPage.getViewport({ scale: 1 }).width,
                    rotation: this.rotation
                });
                if (this.extractionPool.showAnnotations) {
                    this.renderExtractionAnnotations(viewport);
                } else if (this.annotationOverlay) {
                    this.annotationOverlay.innerHTML = '';
                }
            }
        },

        renderExtractionForm: function() {
            var self = this;
            var panel = el('#extraction-panel');
            if (!panel) return;

            var doc = this.data;
            var extractedData = doc.extractedData || {};
            // Normalize confidence: may be stored as decimal (0-1) or percentage (0-100)
            var rawConf = parseFloat(doc.confidence) || 0;
            var baseConfidence = rawConf <= 1 ? Math.round(rawConf * 100) : Math.round(rawConf);

            // Check for AI-adjusted confidence score (merged OCR + AI verification)
            var aiAdjustedConf = extractedData.confidence && extractedData.confidence.adjusted;
            var isAiAdjusted = aiAdjustedConf !== undefined && aiAdjustedConf !== null;
            // Use adjusted confidence when AI verification has run, otherwise use base OCR confidence
            var normalizedConfidence = isAiAdjusted ? Math.round(aiAdjustedConf) : baseConfidence;
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

            // ========== UNIFIED REVIEW HEADER ==========
            // Compute unmatched extractions for header
            this.computeUnmatchedExtractions();
            var unmatchedCount = this.extractionPool.unmatched.length;

            // AI Verification data
            var aiVerification = doc.aiVerification || extractedData.aiVerification || null;
            var hasAiVerification = aiVerification && aiVerification.verified;
            var aiCorrections = (aiVerification && aiVerification.corrections) || [];
            var aiMissedFields = (aiVerification && aiVerification.missedFields) || [];
            var aiLineItemIssues = (aiVerification && aiVerification.lineItemIssues) || [];
            var aiTotalIssues = aiCorrections.length + aiMissedFields.length + aiLineItemIssues.length;
            var aiAccuracy = aiVerification && aiVerification.accuracy ? Math.round(aiVerification.accuracy * 100) : 0;
            // Enhanced AI verification data
            var aiRiskScore = (aiVerification && aiVerification.riskScore) || 'low';
            var aiRecommendation = (aiVerification && aiVerification.recommendation) || null;
            var aiMathValidation = (aiVerification && aiVerification.mathValidation) || null;
            var aiPaymentTerms = (aiVerification && aiVerification.paymentTerms) || null;
            var aiInsights = (aiVerification && aiVerification.insights) || [];
            var aiSummary = (aiVerification && aiVerification.summary) || null;

            // Use unified alerts from AI if available (AI consolidates system alerts + its own findings)
            // Fall back to original anomalies if AI verification didn't run
            var unifiedAlerts = (aiVerification && aiVerification.alerts) || [];
            var displayAlerts = hasAiVerification && unifiedAlerts.length > 0 ? unifiedAlerts : anomalies;

            // Calculate total alerts
            var totalAlerts = displayAlerts.length + aiCorrections.length + aiMissedFields.length + aiLineItemIssues.length;
            var hasAlerts = totalAlerts > 0;
            var hasHighSeverity = displayAlerts.some(function(a) { return a.severity === 'high' || a.severity === 'critical'; });

            html += '<div class="review-header">' +
                '<div class="review-header-bar">' +
                    // Confidence indicator (uses merged AI+OCR score when AI verification is enabled)
                    '<div class="header-metric confidence-metric ' + confClass + (isAiAdjusted ? ' ai-adjusted' : '') + '">' +
                        '<div class="metric-ring ' + confClass + '">' +
                            '<svg viewBox="0 0 36 36">' +
                                '<circle cx="18" cy="18" r="15.9" fill="none" stroke="currentColor" stroke-opacity="0.15" stroke-width="3"/>' +
                                '<circle cx="18" cy="18" r="15.9" fill="none" stroke="currentColor" stroke-width="3" ' +
                                    'stroke-dasharray="' + normalizedConfidence + ' 100" stroke-linecap="round" transform="rotate(-90 18 18)"/>' +
                            '</svg>' +
                            '<span class="metric-value">' + normalizedConfidence + '</span>' +
                        '</div>' +
                        '<span class="metric-label">' + (isAiAdjusted ? '<i class="fas fa-sparkles"></i> AI ' : '') + 'Confidence</span>' +
                    '</div>' +
                    // Unified Alerts indicator (anomalies + AI issues combined)
                    (hasAlerts ?
                        '<div class="header-metric alert-metric' + (hasHighSeverity ? ' has-critical' : '') + '" id="alert-status-toggle">' +
                            '<div class="metric-icon alert-icon">' +
                                '<i class="fas fa-' + (hasHighSeverity ? 'exclamation-triangle' : 'bell') + '"></i>' +
                                '<span class="metric-badge">' + totalAlerts + '</span>' +
                            '</div>' +
                            '<span class="metric-label">Alert' + (totalAlerts > 1 ? 's' : '') + '</span>' +
                            '<i class="fas fa-chevron-down metric-chevron"></i>' +
                        '</div>' : '') +
                    // PO Matching indicator (subtle integration)
                    this.renderPOMatchIndicator(doc) +
                    // Spacer
                    '<div class="header-spacer"></div>' +
                    // Additional fields indicator (if any)
                    (unmatchedCount > 0 ?
                        '<div class="header-metric pool-metric" id="pool-header-toggle">' +
                            '<div class="metric-icon pool-icon">' +
                                '<i class="fas fa-layer-group"></i>' +
                                '<span class="metric-badge">' + unmatchedCount + '</span>' +
                            '</div>' +
                            '<span class="metric-label">Extra Fields</span>' +
                            '<i class="fas fa-chevron-down metric-chevron"></i>' +
                        '</div>' : '') +
                '</div>' +
                // Unified Alerts dropdown (combines anomalies + AI verification)
                (hasAlerts ?
                    '<div class="header-dropdown alert-dropdown unified-alerts" id="alert-details" style="display:none;">' +
                        // Compact AI summary bar (if verified)
                        (hasAiVerification ?
                            '<div class="alerts-summary-bar">' +
                                '<div class="summary-left">' +
                                    '<span class="summary-badge accuracy"><i class="fas fa-bullseye"></i> ' + aiAccuracy + '%</span>' +
                                    '<span class="summary-badge risk-' + aiRiskScore + '">' +
                                        '<i class="fas fa-' + (aiRiskScore === 'critical' || aiRiskScore === 'high' ? 'exclamation-triangle' : aiRiskScore === 'medium' ? 'exclamation-circle' : 'shield-check') + '"></i> ' +
                                        aiRiskScore.charAt(0).toUpperCase() + aiRiskScore.slice(1) +
                                    '</span>' +
                                    (aiRecommendation ? '<span class="summary-badge rec-' + aiRecommendation + '">' +
                                        '<i class="fas fa-' + (aiRecommendation === 'approve' ? 'thumbs-up' : aiRecommendation === 'reject' ? 'thumbs-down' : 'search') + '"></i> ' +
                                        aiRecommendation.charAt(0).toUpperCase() + aiRecommendation.slice(1) +
                                    '</span>' : '') +
                                '</div>' +
                                (aiSummary ? '<div class="summary-text">' + escapeHtml(aiSummary) + '</div>' : '') +
                            '</div>' : '') +
                        // Unified alerts list - all items in one consistent format
                        '<div class="alerts-list">' +
                            // Auto-applied corrections (shown as success)
                            ((aiVerification && aiVerification.autoApplied && aiVerification.autoApplied.length > 0) ?
                                aiVerification.autoApplied.map(function(applied) {
                                    return '<div class="alert-row alert-applied">' +
                                        '<div class="alert-icon"><i class="fas fa-check-circle"></i></div>' +
                                        '<div class="alert-body">' +
                                            '<div class="alert-title">Auto-corrected: ' + escapeHtml(applied.field || 'Field') + '</div>' +
                                            '<div class="alert-detail">' +
                                                (applied.oldValue ? '<span class="old-val">' + escapeHtml(String(applied.oldValue)) + '</span> → ' : '') +
                                                '<span class="new-val">' + escapeHtml(String(applied.value || '')) + '</span>' +
                                            '</div>' +
                                            (applied.reason ? '<div class="alert-reason">' + escapeHtml(applied.reason) + '</div>' : '') +
                                        '</div>' +
                                        '<div class="alert-tag tag-applied">Applied</div>' +
                                    '</div>';
                                }).join('') : '') +
                            // Math validation error (critical)
                            (hasAiVerification && aiMathValidation && !aiMathValidation.isValid ?
                                '<div class="alert-row alert-critical">' +
                                    '<div class="alert-icon"><i class="fas fa-calculator"></i></div>' +
                                    '<div class="alert-body">' +
                                        '<div class="alert-title">Math Validation Failed</div>' +
                                        '<div class="alert-detail math-breakdown">' +
                                            '<span>Lines: $' + (aiMathValidation.lineItemsSum || '?') + '</span>' +
                                            '<span>Tax: $' + (aiMathValidation.taxAmount || '?') + '</span>' +
                                            '<span>Total: $' + (aiMathValidation.totalOnDoc || '?') + '</span>' +
                                            '<span class="discrepancy">Δ $' + (aiMathValidation.discrepancy || '0') + '</span>' +
                                        '</div>' +
                                    '</div>' +
                                    '<div class="alert-tag tag-critical">Critical</div>' +
                                '</div>' : '') +
                            // AI Corrections (suggestions to accept)
                            aiCorrections.map(function(c, idx) {
                                var severity = c.impact === 'high' ? 'high' : c.impact === 'medium' ? 'medium' : 'low';
                                return '<div class="alert-row alert-actionable alert-' + severity + ' ai-correction-item" data-correction-idx="' + idx + '">' +
                                    '<div class="alert-icon"><i class="fas fa-pen"></i></div>' +
                                    '<div class="alert-body">' +
                                        '<div class="alert-title">' + escapeHtml(c.field || 'Unknown') + '</div>' +
                                        '<div class="alert-detail">' +
                                            '<span class="old-val">' + escapeHtml(String(c.extracted || '')) + '</span>' +
                                            '<i class="fas fa-arrow-right"></i>' +
                                            '<span class="new-val">' + escapeHtml(String(c.correct || '')) + '</span>' +
                                        '</div>' +
                                        (c.reason ? '<div class="alert-reason">' + escapeHtml(c.reason) + '</div>' : '') +
                                    '</div>' +
                                    '<div class="alert-actions">' +
                                        '<button class="btn-action btn-accept btn-accept-correction" data-field="' + escapeHtml(c.field || '') + '" data-value="' + escapeHtml(String(c.correct || '')) + '" title="Accept"><i class="fas fa-check"></i></button>' +
                                        '<button class="btn-action btn-dismiss btn-ignore-correction" title="Dismiss"><i class="fas fa-times"></i></button>' +
                                    '</div>' +
                                '</div>';
                            }).join('') +
                            // AI Missed Fields (suggestions to add)
                            aiMissedFields.map(function(m, idx) {
                                var importance = m.importance === 'critical' ? 'high' : m.importance === 'important' ? 'medium' : 'low';
                                return '<div class="alert-row alert-actionable alert-' + importance + ' ai-missed-item" data-missed-idx="' + idx + '">' +
                                    '<div class="alert-icon"><i class="fas fa-plus"></i></div>' +
                                    '<div class="alert-body">' +
                                        '<div class="alert-title">Missing: ' + escapeHtml(m.field || 'Unknown') + '</div>' +
                                        '<div class="alert-detail"><span class="new-val">' + escapeHtml(String(m.value || '')) + '</span></div>' +
                                        (m.location ? '<div class="alert-reason"><i class="fas fa-map-marker-alt"></i> ' + escapeHtml(m.location) + '</div>' : '') +
                                    '</div>' +
                                    '<div class="alert-actions">' +
                                        '<button class="btn-action btn-accept btn-add-missed" data-field="' + escapeHtml(m.field || '') + '" data-value="' + escapeHtml(String(m.value || '')) + '" title="Add"><i class="fas fa-plus"></i></button>' +
                                        '<button class="btn-action btn-dismiss btn-ignore-missed" title="Dismiss"><i class="fas fa-times"></i></button>' +
                                    '</div>' +
                                '</div>';
                            }).join('') +
                            // AI Line Item Issues
                            aiLineItemIssues.map(function(li) {
                                var icon = li.type === 'missing' ? 'minus-circle' : li.type === 'extra' ? 'plus-circle' : li.type === 'calculation_error' ? 'calculator' : 'exclamation-circle';
                                return '<div class="alert-row alert-medium">' +
                                    '<div class="alert-icon"><i class="fas fa-' + icon + '"></i></div>' +
                                    '<div class="alert-body">' +
                                        '<div class="alert-title">Line Item ' + (li.lineNumber ? '#' + li.lineNumber + ' ' : '') + '- ' + escapeHtml(li.type || 'Issue') + '</div>' +
                                        '<div class="alert-detail">' + escapeHtml(li.description || '') + '</div>' +
                                        (li.impact ? '<div class="alert-reason">' + escapeHtml(li.impact) + '</div>' : '') +
                                    '</div>' +
                                    '<div class="alert-tag tag-lineitem">Line Item</div>' +
                                '</div>';
                            }).join('') +
                            // Unified Alerts (consolidated by AI or original system alerts)
                            displayAlerts.map(function(a) {
                                var sev = a.severity || 'medium';
                                var icon = sev === 'high' || sev === 'critical' ? 'exclamation-triangle' : sev === 'medium' ? 'exclamation-circle' : 'info-circle';
                                return '<div class="alert-row alert-' + sev + '">' +
                                    '<div class="alert-icon"><i class="fas fa-' + icon + '"></i></div>' +
                                    '<div class="alert-body">' +
                                        '<div class="alert-title">' + escapeHtml(a.message) + '</div>' +
                                        (a.action ? '<div class="alert-reason"><i class="fas fa-hand-point-right"></i> ' + escapeHtml(a.action) + '</div>' : '') +
                                    '</div>' +
                                    '<div class="alert-tag tag-' + sev + '">' + sev.charAt(0).toUpperCase() + sev.slice(1) + '</div>' +
                                '</div>';
                            }).join('') +
                            // Payment Terms (info)
                            (hasAiVerification && aiPaymentTerms && aiPaymentTerms.detected ?
                                '<div class="alert-row alert-info">' +
                                    '<div class="alert-icon"><i class="fas fa-calendar-check"></i></div>' +
                                    '<div class="alert-body">' +
                                        '<div class="alert-title">Payment Terms: ' + escapeHtml(aiPaymentTerms.detected) + '</div>' +
                                        '<div class="alert-detail payment-info">' +
                                            (aiPaymentTerms.dueDate ? '<span>Due: ' + escapeHtml(aiPaymentTerms.dueDate) + '</span>' : '') +
                                            (aiPaymentTerms.daysUntilDue !== null ? '<span>' + aiPaymentTerms.daysUntilDue + ' days</span>' : '') +
                                            (aiPaymentTerms.earlyPayDiscount ? '<span class="discount"><i class="fas fa-tag"></i> ' + escapeHtml(aiPaymentTerms.earlyPayDiscount) + '</span>' : '') +
                                        '</div>' +
                                    '</div>' +
                                    '<div class="alert-tag tag-info">Info</div>' +
                                '</div>' : '') +
                            // AI Insights
                            aiInsights.map(function(insight) {
                                return '<div class="alert-row alert-insight">' +
                                    '<div class="alert-icon"><i class="fas fa-lightbulb"></i></div>' +
                                    '<div class="alert-body">' +
                                        '<div class="alert-title">' + escapeHtml(insight) + '</div>' +
                                    '</div>' +
                                    '<div class="alert-tag tag-insight">Insight</div>' +
                                '</div>';
                            }).join('') +
                        '</div>' +
                    '</div>' : '') +
                // Extraction pool dropdown
                (unmatchedCount > 0 ? this.renderExtractionPoolDropdown() : '') +
                // PO Match dropdown (shown when PO indicator is clicked)
                this.renderPOMatchDropdown(doc) +
            '</div>';

            // ========== ENTITY SECTION (vendor for bills, employee for expense reports) ==========
            var isEntityRequired = this.isFieldMandatory('entity', bodyFields);
            var isExpenseReport = this.transactionType === 'expensereport';

            if (isExpenseReport) {
                // Employee field for expense reports
                html += '<div class="form-section">' +
                    '<div class="form-field entity-field employee-field' + (isEntityRequired ? ' is-required' : '') + '">' +
                        '<label>Employee Name ' + (isEntityRequired ? ' <span class="required">*</span>' : '') + '</label>' +
                        '<div class="entity-search-wrapper">' +
                            '<input type="text" id="field-entity" class="entity-input" value="' + escapeHtml(doc.employeeName || '') + '" placeholder="Search or enter employee name..." autocomplete="off">' +
                            '<div class="entity-dropdown" id="entity-dropdown" style="display:none;"></div>' +
                        '</div>' +
                        (doc.employeeId ? '<input type="hidden" id="field-entityId" value="' + doc.employeeId + '">' : '') +
                    '</div>' +
                '</div>';
            } else {
                // Vendor field for vendor bills, credits, POs
                html += '<div class="form-section">' +
                    '<div class="form-field entity-field vendor-field' + (isEntityRequired ? ' is-required' : '') + '">' +
                        '<label>Vendor Name ' + this.renderConfidenceBadge('vendorName') + (isEntityRequired ? ' <span class="required">*</span>' : '') + '</label>' +
                        '<div class="entity-search-wrapper">' +
                            '<input type="text" id="field-entity" class="entity-input" value="' + escapeHtml(doc.vendorName || '') + '" placeholder="Search or enter vendor name..." autocomplete="off">' +
                            '<div class="entity-dropdown" id="entity-dropdown" style="display:none;"></div>' +
                        '</div>' +
                        (doc.vendorId ? '<input type="hidden" id="field-entityId" value="' + doc.vendorId + '">' : '') +
                        (doc.vendorMatchConfidence ? '<div class="field-match-info"><i class="fas fa-check-circle"></i> Matched with ' + Math.round(doc.vendorMatchConfidence * 100) + '% confidence</div>' : '') +
                    '</div>' +
                '</div>';
            }

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
                                        // Schema type from NetSuite is authoritative - only use layout type as fallback
                                        nsField.type = nsField.type || domField.type;
                                        nsField.mandatory = domField.mandatory || domField.required || nsField.mandatory;
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
                                        mandatory: domField.mandatory || domField.required || false,
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
            var isSubtotalRequired = this.isFieldMandatory('subtotal', bodyFields);
            var isTaxRequired = this.isFieldMandatory('taxAmount', bodyFields) || this.isFieldMandatory('taxtotal', bodyFields);
            var isTotalRequired = this.isFieldMandatory('totalAmount', bodyFields) || this.isFieldMandatory('usertotal', bodyFields) || this.isFieldMandatory('total', bodyFields);
            html += '<div class="amounts-summary-card">' +
                '<div class="amounts-header">' +
                    '<div class="amounts-header-icon"><i class="fas fa-receipt"></i></div>' +
                    '<span class="amounts-header-title">Summary</span>' +
                '</div>' +
                '<div class="amounts-body">' +
                    '<div class="amounts-line-items">' +
                        '<div class="amount-row' + (isSubtotalRequired ? ' is-required' : '') + '">' +
                            '<div class="amount-label">' +
                                '<span class="amount-label-text">Subtotal</span>' +
                                this.renderConfidenceBadge('subtotal') +
                                (isSubtotalRequired ? '<span class="required">*</span>' : '') +
                            '</div>' +
                            '<div class="amount-value">' +
                                '<span class="currency-symbol">$</span>' +
                                '<input type="number" step="0.01" id="field-subtotal" data-field="subtotal" value="' + (doc.subtotal || 0).toFixed(2) + '">' +
                            '</div>' +
                        '</div>' +
                        '<div class="amount-row' + (isTaxRequired ? ' is-required' : '') + '">' +
                            '<div class="amount-label">' +
                                '<span class="amount-label-text">Tax</span>' +
                                this.renderConfidenceBadge('taxAmount') +
                                (isTaxRequired ? '<span class="required">*</span>' : '') +
                            '</div>' +
                            '<div class="amount-value">' +
                                '<span class="currency-symbol">$</span>' +
                                '<input type="number" step="0.01" id="field-taxAmount" data-field="taxtotal" value="' + (doc.taxAmount || 0).toFixed(2) + '">' +
                            '</div>' +
                        '</div>' +
                    '</div>' +
                    '<div class="amounts-divider"></div>' +
                    '<div class="amount-total-row' + (isTotalRequired ? ' is-required' : '') + '">' +
                        '<div class="amount-total-label">' +
                            '<span class="amount-total-label-text">Total</span>' +
                            this.renderConfidenceBadge('totalAmount') +
                            (isTotalRequired ? '<span class="required">*</span>' : '') +
                        '</div>' +
                        '<div class="amount-total-value">' +
                            '<span class="currency-symbol">$</span>' +
                            '<input type="number" step="0.01" id="field-totalAmount" data-field="total" value="' + (doc.totalAmount || 0).toFixed(2) + '">' +
                        '</div>' +
                    '</div>' +
                '</div>' +
            '</div>';

            // ========== ACTION BUTTONS ==========
            var hasUnsavedChanges = this.changes && Object.keys(this.changes).length > 0;
            html += '<div class="form-section action-section">' +
                '<button class="btn btn-secondary btn-block' + (hasUnsavedChanges ? ' has-changes' : '') + '" id="btn-save">' +
                    '<i class="fas fa-save"></i> Save Changes' + (hasUnsavedChanges ? '*' : '') + ' <span class="shortcut-hint">Ctrl+S</span>' +
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
            this.bindSublistColumnEvents();

            // ========== BIND EXTRACTION POOL EVENTS ==========
            this.bindExtractionPoolEvents();

            // ========== REFRESH SPLIT VIEW DOM ==========
            // If in split view mode, move newly rendered sublists to bottom section
            this.refreshSplitViewDom();
        },

        /**
         * Refresh split view DOM after re-rendering extraction form
         * Moves newly rendered sublists to the bottom section and rebinds events
         */
        refreshSplitViewDom: function() {
            var self = this;
            var viewReview = el('.view-review');
            var bottomSection = el('#review-bottom-section');
            var extractionPanel = el('#extraction-panel');

            // Only proceed if we're in split view mode and DOM elements exist
            if (!viewReview || !viewReview.classList.contains('split-view')) return;
            if (!bottomSection || !extractionPanel) return;

            // Clear existing sublists from bottom section (they're from previous document)
            var oldSublistSections = bottomSection.querySelectorAll('.line-section');
            oldSublistSections.forEach(function(section) {
                section.remove();
            });

            // Move new sublists from extraction panel to bottom section
            var newSublistSections = extractionPanel.querySelectorAll('.line-section');
            newSublistSections.forEach(function(sublistSection) {
                var parentTabContent = sublistSection.closest('.form-tab-content');
                if (parentTabContent) {
                    sublistSection.dataset.originalTabContent = parentTabContent.getAttribute('data-tab-content');
                }
                bottomSection.appendChild(sublistSection);
            });

            // Rebind sublist events for the moved elements
            this.bindSublistEvents(bottomSection);
            this.bindSublistColumnEvents();
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
                    '<i class="fas fa-wand-magic-sparkles"></i>' +
                    '<span class="transform-text">Transform</span>' +
                    '<i class="fas fa-chevron-down transform-arrow"></i>' +
                '</button>' +
                '<div class="transform-hub">' +
                    '<div class="transform-hub-inner">' +
                        // Row 1: Group By + Consolidate + Split
                        '<div class="transform-pod">' +
                            '<div class="transform-pod-header">' +
                                '<div class="transform-pod-icon group"><i class="fas fa-layer-group"></i></div>' +
                                '<span class="transform-pod-title">Group</span>' +
                            '</div>' +
                            '<div class="transform-option" data-action="by-' + groupByField + '" data-sublist="' + sublistId + '">' +
                                '<i class="fas ' + groupByIcon + '"></i>' + groupByLabel +
                                '<span class="transform-option-key">1</span>' +
                            '</div>' +
                            '<div class="transform-option" data-action="by-department" data-sublist="' + sublistId + '">' +
                                '<i class="fas fa-sitemap"></i>Department' +
                                '<span class="transform-option-key">2</span>' +
                            '</div>' +
                            '<div class="transform-option" data-action="by-class" data-sublist="' + sublistId + '">' +
                                '<i class="fas fa-tags"></i>Class' +
                                '<span class="transform-option-key">3</span>' +
                            '</div>' +
                            '<div class="transform-option" data-action="by-location" data-sublist="' + sublistId + '">' +
                                '<i class="fas fa-map-marker-alt"></i>Location' +
                                '<span class="transform-option-key">4</span>' +
                            '</div>' +
                        '</div>' +
                        '<div class="transform-pod">' +
                            '<div class="transform-pod-header">' +
                                '<div class="transform-pod-icon consolidate"><i class="fas fa-compress"></i></div>' +
                                '<span class="transform-pod-title">Merge</span>' +
                            '</div>' +
                            '<div class="transform-option" data-action="collapse" data-sublist="' + sublistId + '">' +
                                '<i class="fas fa-compress"></i>Collapse All' +
                                '<span class="transform-option-key">C</span>' +
                            '</div>' +
                            '<div class="transform-option" data-action="duplicate-all" data-sublist="' + sublistId + '">' +
                                '<i class="fas fa-copy"></i>Duplicate All' +
                            '</div>' +
                        '</div>' +
                        '<div class="transform-pod">' +
                            '<div class="transform-pod-header">' +
                                '<div class="transform-pod-icon split"><i class="fas fa-divide"></i></div>' +
                                '<span class="transform-pod-title">Split</span>' +
                            '</div>' +
                            '<div class="transform-option" data-action="split-equal" data-sublist="' + sublistId + '">' +
                                '<i class="fas fa-divide"></i>Split Equally' +
                                '<span class="transform-option-key">S</span>' +
                            '</div>' +
                            '<div class="transform-option" data-action="apply-defaults" data-sublist="' + sublistId + '">' +
                                '<i class="fas fa-fill-drip"></i>Apply Defaults' +
                                '<span class="transform-option-key">D</span>' +
                            '</div>' +
                        '</div>' +
                        // Row 2: Distribute + Actions
                        '<div class="transform-pod">' +
                            '<div class="transform-pod-header">' +
                                '<div class="transform-pod-icon distribute"><i class="fas fa-share-alt"></i></div>' +
                                '<span class="transform-pod-title">Distribute</span>' +
                            '</div>' +
                            '<div class="transform-option" data-action="distribute-department" data-sublist="' + sublistId + '">' +
                                '<i class="fas fa-sitemap"></i>By Department' +
                            '</div>' +
                            '<div class="transform-option" data-action="distribute-class" data-sublist="' + sublistId + '">' +
                                '<i class="fas fa-tags"></i>By Class' +
                            '</div>' +
                            '<div class="transform-option" data-action="distribute-location" data-sublist="' + sublistId + '">' +
                                '<i class="fas fa-map-marker-alt"></i>By Location' +
                            '</div>' +
                        '</div>' +
                        '<div class="transform-pod">' +
                            '<div class="transform-pod-header">' +
                                '<div class="transform-pod-icon actions"><i class="fas fa-bolt"></i></div>' +
                                '<span class="transform-pod-title">Danger</span>' +
                            '</div>' +
                            '<div class="transform-option transform-danger" data-action="clear-all" data-sublist="' + sublistId + '">' +
                                '<i class="fas fa-trash"></i>Clear All Lines' +
                            '</div>' +
                        '</div>' +
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

            // Load persisted column settings from localStorage
            var columnSettings = this.getSublistColumnSettings(sublistId);
            var sortState = columnSettings.sort || { field: null, direction: 'asc' };

            // Sort items if sort state exists
            if (sortState.field && items.length > 1) {
                items = this.sortSublistItems(items, sortState.field, sortState.direction);
                this.sublistData[sublistId] = items;
            }

            // Wrap table in scrollable container to prevent overflow
            var html = '<div class="sublist-table-wrapper" data-sublist="' + sublistId + '">' +
                '<table class="line-items sublist-table" data-sublist="' + sublistId + '">' +
                '<thead><tr>';

            visibleFields.forEach(function(f) {
                var widthStyle = '';
                var savedWidth = columnSettings.widths && columnSettings.widths[f.id];
                if (savedWidth) {
                    widthStyle = ' style="width:' + savedWidth + 'px;"';
                } else if (f.id === 'amount' || f.id === 'rate') {
                    widthStyle = ' style="width:100px;"';
                } else if (f.id === 'quantity') {
                    widthStyle = ' style="width:70px;"';
                } else if (f.id === 'description' || f.id === 'memo') {
                    widthStyle = ' style="min-width:150px;"';
                }

                var sortClass = '';
                var sortIcon = '<i class="fas fa-sort sort-icon"></i>';
                if (sortState.field === f.id) {
                    sortClass = ' sorted ' + sortState.direction;
                    sortIcon = sortState.direction === 'asc'
                        ? '<i class="fas fa-sort-up sort-icon active"></i>'
                        : '<i class="fas fa-sort-down sort-icon active"></i>';
                }

                html += '<th class="sortable-header resizable-header' + sortClass + '" data-field="' + f.id + '" data-sublist="' + sublistId + '"' + widthStyle + '>' +
                    '<div class="th-content">' +
                        '<span class="th-label">' + escapeHtml(f.label) + '</span>' +
                        sortIcon +
                    '</div>' +
                    '<div class="resize-handle" data-field="' + f.id + '"></div>' +
                '</th>';
            });
            html += '<th class="action-col" style="width:40px;"></th></tr></thead><tbody>';

            items.forEach(function(item, idx) {
                html += '<tr data-idx="' + idx + '" data-sublist="' + sublistId + '">';
                visibleFields.forEach(function(f) {
                    html += self.renderSublistCell(f, item, idx, sublistId);
                });
                html += '<td><button class="btn btn-ghost btn-icon btn-sm btn-remove-line" data-sublist="' + sublistId + '" title="Remove" tabindex="-1"><i class="fas fa-times"></i></button></td>';
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

            // Only apply column limit for fallback ordering (when no explicit config)
            // When columnOrder is set (from XML/schema), show ALL configured columns
            if (columnOrder.length === 0 && visibleFieldsFromSchema.length === 0) {
                var limit = this.sublistColumnLimit || 10;
                return visible.slice(0, limit);
            }

            return visible;
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

            // Fill handle element - appears on cell hover/focus
            var fillHandle = '<div class="fill-handle" title="Drag to fill cells below"></div>' +
                '<button type="button" class="fill-menu-btn" title="Fill options" tabindex="-1"><i class="fas fa-ellipsis-v"></i></button>';

            // Detect if this is a select field (by type or by known field ID)
            var isSelectField = field.type === 'select' || this.isSelectField(normalizedFieldId);

            // Select field with inline options - render simple select dropdown
            if (isSelectField && field.options && field.options.length > 0) {
                var html = '<td class="select-cell fill-cell" data-field="' + fieldId + '" data-row="' + idx + '" data-sublist="' + sublistId + '">' +
                    '<select class="line-input" id="' + inputId + '" data-field="' + fieldId + '">' +
                    '<option value="">--</option>';
                field.options.forEach(function(opt) {
                    var selected = (String(value) === String(opt.value)) ? ' selected' : '';
                    html += '<option value="' + escapeHtml(opt.value) + '"' + selected + '>' + escapeHtml(opt.text) + '</option>';
                });
                html += '</select>' + fillHandle + '</td>';
                return html;
            }
            // Select field requiring API lookup (large list like account, customer, item)
            else if (isSelectField) {
                var lookupType = this.getLookupType(field.id, sublistId);
                var html = '<td class="select-cell fill-cell" data-field="' + field.id + '" data-row="' + idx + '" data-sublist="' + sublistId + '">' +
                    '<div class="typeahead-select" data-field="' + field.id + '" data-lookup="' + lookupType + '">' +
                    '<input type="hidden" class="line-input" id="' + inputId + '" value="' + escapeHtml(value) + '" data-field="' + field.id + '">' +
                    '<input type="text" class="typeahead-input line-input" id="' + inputId + '-display" ' +
                        'value="' + escapeHtml(displayValue || value) + '" placeholder="Search ' + escapeHtml(field.label) + '..." ' +
                        'data-field="' + field.id + '" data-lookup="' + lookupType + '" autocomplete="off">' +
                    '<div class="typeahead-dropdown"></div>' +
                    '</div>' + fillHandle + '</td>';
                return html;
            }
            // Currency/amount fields
            else if (field.type === 'currency' || field.id === 'amount' || field.id === 'rate') {
                return '<td class="fill-cell" data-field="' + field.id + '" data-row="' + idx + '" data-sublist="' + sublistId + '">' +
                    '<input type="number" step="0.01" class="line-input line-amount" id="' + inputId + '" value="' + (parseFloat(value) || 0).toFixed(2) + '" data-field="' + field.id + '">' +
                    fillHandle + '</td>';
            }
            // Integer/quantity fields
            else if (field.type === 'integer' || field.id === 'quantity') {
                return '<td class="fill-cell" data-field="' + field.id + '" data-row="' + idx + '" data-sublist="' + sublistId + '">' +
                    '<input type="number" step="1" class="line-input line-qty" id="' + inputId + '" value="' + (parseInt(value) || 0) + '" data-field="' + field.id + '">' +
                    fillHandle + '</td>';
            }
            // Checkbox fields - handle same as header-level checkboxes
            else if (field.type === 'checkbox' || this.isCheckboxField(normalizedFieldId, field.type)) {
                var isChecked = value === 'T' || value === true || value === 'true' || value === '1';
                return '<td class="checkbox-cell fill-cell" data-field="' + fieldId + '" data-row="' + idx + '" data-sublist="' + sublistId + '">' +
                    '<label class="checkbox-label">' +
                    '<input type="checkbox" class="line-input line-checkbox" id="' + inputId + '" ' +
                    'data-field="' + fieldId + '"' + (isChecked ? ' checked' : '') + '>' +
                    '</label>' + fillHandle + '</td>';
            }
            // Default text input
            else {
                return '<td class="fill-cell" data-field="' + field.id + '" data-row="' + idx + '" data-sublist="' + sublistId + '">' +
                    '<input type="text" class="line-input" id="' + inputId + '" value="' + escapeHtml(value) + '" data-field="' + field.id + '">' +
                    fillHandle + '</td>';
            }
        },

        // Determine API lookup type for a field
        getLookupType: function(fieldId, sublistId) {
            var normalizedId = (fieldId || '').toLowerCase();
            if (normalizedId === 'account') return 'accounts';
            if (normalizedId === 'expenseaccount') return 'expenseaccounts'; // Expense accounts only
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
            if (normalizedId === 'acctcorpcardexp') return 'accounts';
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
                'expenseaccount', // Expense account field on expense reports
                'job', 'project', 'projecttask', 'customform', 'acctcorpcardexp'
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

        // Get the focusable input element from a cell
        getInputInCell: function(cell) {
            if (!cell) return null;
            // For typeahead cells, get the visible input (typeahead-input), not the hidden one
            var typeaheadInput = cell.querySelector('.typeahead-input');
            if (typeaheadInput) return typeaheadInput;
            // For regular cells, get the line-input
            var lineInput = cell.querySelector('.line-input');
            return lineInput;
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

            // Toggle unified alerts dropdown (contains both anomalies and AI verification)
            var alertToggle = el('#alert-status-toggle');
            if (alertToggle) {
                alertToggle.onclick = function(e) {
                    e.stopPropagation();
                    var details = el('#alert-details');
                    var poolDropdown = el('#pool-dropdown');
                    var chevron = alertToggle.querySelector('.metric-chevron');

                    // Close pool dropdown if open
                    if (poolDropdown && poolDropdown.style.display !== 'none') {
                        poolDropdown.style.display = 'none';
                        var poolToggle = el('#pool-header-toggle');
                        if (poolToggle) {
                            var poolChevron = poolToggle.querySelector('.metric-chevron');
                            if (poolChevron) {
                                poolChevron.classList.remove('fa-chevron-up');
                                poolChevron.classList.add('fa-chevron-down');
                            }
                        }
                    }

                    if (details) {
                        var isHidden = details.style.display === 'none';
                        details.style.display = isHidden ? 'block' : 'none';
                        alertToggle.classList.toggle('active', isHidden);
                        if (chevron) {
                            chevron.classList.toggle('fa-chevron-down', !isHidden);
                            chevron.classList.toggle('fa-chevron-up', isHidden);
                        }
                    }
                };

                // Bind AI correction/missed field actions (now inside unified alerts)
                self.bindAIVerificationEvents();
            }

            // Toggle pool dropdown in unified header
            var poolToggle = el('#pool-header-toggle');
            if (poolToggle) {
                poolToggle.onclick = function(e) {
                    e.stopPropagation();
                    var dropdown = el('#pool-dropdown');
                    var alertDetails = el('#alert-details');
                    var chevron = poolToggle.querySelector('.metric-chevron');

                    // Close alert dropdown if open
                    if (alertDetails && alertDetails.style.display !== 'none') {
                        alertDetails.style.display = 'none';
                        var alertToggleEl = el('#alert-status-toggle');
                        if (alertToggleEl) {
                            alertToggleEl.classList.remove('active');
                            var alertChevron = alertToggleEl.querySelector('.metric-chevron');
                            if (alertChevron) {
                                alertChevron.classList.remove('fa-chevron-up');
                                alertChevron.classList.add('fa-chevron-down');
                            }
                        }
                    }

                    if (dropdown) {
                        var isHidden = dropdown.style.display === 'none';
                        dropdown.style.display = isHidden ? 'block' : 'none';
                        poolToggle.classList.toggle('active', isHidden);
                        if (chevron) {
                            chevron.classList.toggle('fa-chevron-down', !isHidden);
                            chevron.classList.toggle('fa-chevron-up', isHidden);
                        }
                    }
                };

                // Bind chip actions within pool dropdown
                self.bindPoolChipEvents();
            }

            // Toggle PO match dropdown in unified header
            var poToggle = el('#po-match-toggle');
            if (poToggle) {
                poToggle.onclick = function(e) {
                    e.stopPropagation();
                    var dropdown = el('#po-dropdown');
                    var alertDetails = el('#alert-details');
                    var poolDropdown = el('#pool-dropdown');
                    var chevron = poToggle.querySelector('.metric-chevron');

                    // Close other dropdowns if open
                    if (alertDetails && alertDetails.style.display !== 'none') {
                        alertDetails.style.display = 'none';
                        var alertToggleEl = el('#alert-status-toggle');
                        if (alertToggleEl) {
                            alertToggleEl.classList.remove('active');
                            var alertChevron = alertToggleEl.querySelector('.metric-chevron');
                            if (alertChevron) {
                                alertChevron.classList.remove('fa-chevron-up');
                                alertChevron.classList.add('fa-chevron-down');
                            }
                        }
                    }
                    if (poolDropdown && poolDropdown.style.display !== 'none') {
                        poolDropdown.style.display = 'none';
                        var poolToggleEl = el('#pool-header-toggle');
                        if (poolToggleEl) {
                            poolToggleEl.classList.remove('active');
                            var poolChevron = poolToggleEl.querySelector('.metric-chevron');
                            if (poolChevron) {
                                poolChevron.classList.remove('fa-chevron-up');
                                poolChevron.classList.add('fa-chevron-down');
                            }
                        }
                    }

                    if (dropdown) {
                        var isHidden = dropdown.style.display === 'none';
                        dropdown.style.display = isHidden ? 'block' : 'none';
                        poToggle.classList.toggle('active', isHidden);
                        if (chevron) {
                            chevron.classList.toggle('fa-chevron-down', !isHidden);
                            chevron.classList.toggle('fa-chevron-up', isHidden);
                        }

                        // Load PO match data when first opened
                        if (isHidden && (!self.data.poCandidates || self.data.poCandidates.length === 0)) {
                            self.loadPOMatchData();
                        }
                    }
                };

                // Bind PO dropdown events
                self.bindPODropdownEvents();
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

            // Entity search (vendors for bills, employees for expense reports)
            var entityInput = el('#field-entity');
            var isExpenseReport = self.transactionType === 'expensereport';
            if (entityInput) {
                var searchTimeout;
                entityInput.addEventListener('input', function() {
                    var query = this.value.trim();
                    clearTimeout(searchTimeout);
                    if (query.length >= 2) {
                        searchTimeout = setTimeout(function() {
                            self.searchEntity(query);
                        }, 300);
                    } else {
                        self.hideEntityDropdown();
                    }
                    if (isExpenseReport) {
                        self.changes.employeeName = query;
                    } else {
                        self.changes.vendorName = query;
                    }
                    self.markUnsaved();
                });

                entityInput.addEventListener('focus', function() {
                    if (self.entitySuggestions && self.entitySuggestions.length > 0) {
                        self.showEntityDropdown();
                    }
                });

                entityInput.addEventListener('blur', function() {
                    // Delay hide to allow click on dropdown
                    setTimeout(function() {
                        self.hideEntityDropdown();
                    }, 200);
                });

                // Keyboard navigation for entity dropdown
                entityInput.addEventListener('keydown', function(e) {
                    var dropdown = el('#entity-dropdown');
                    if (!dropdown || dropdown.style.display === 'none') return;

                    var options = dropdown.querySelectorAll('.entity-option');
                    if (options.length === 0) return;

                    var highlighted = dropdown.querySelector('.entity-option.highlighted');
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
                        self.hideEntityDropdown();
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
                    var searchType = lookupType;
                    if (lookupType === 'expenseaccounts') {
                        // 'expenseaccount' field → Expense accounts only
                        searchType = 'accounts';
                        options.accountType = 'Expense';
                    } else if (lookupType === 'accounts') {
                        // 'acctcorpcardexp' field → Credit Card accounts only
                        if (fieldId === 'acctcorpcardexp') {
                            options.accountType = 'CCard';
                        }
                        // For 'account' field, don't set accountType - returns all accounts
                    }

                    self.typeaheadTimeout = setTimeout(function() {
                        self.searchDatasource(searchType, query, wrapper, input, options);
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

            // ========== BODY FIELD TYPEAHEAD HANDLERS ==========
            this.bindBodyFieldTypeahead();

            // ========== SMART FILL (Column Copy) HANDLERS ==========
            this.bindSmartFill();
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
                var searchType = lookupType;
                if (lookupType === 'accounts' && fieldId === 'account') {
                    // Body-level account field on vendor bill = AP accounts
                    options.accountType = 'AcctPay';
                } else if (lookupType === 'expenseaccounts') {
                    // 'expenseaccount' field → Expense accounts only
                    searchType = 'accounts';
                    options.accountType = 'Expense';
                }
                if (lookupType === 'accounts' && fieldId === 'acctcorpcardexp') {
                    // Corporate card expense account = Credit Card accounts only
                    options.accountType = 'CCard';
                }

                self.typeaheadTimeout = setTimeout(function() {
                    self.searchDatasource(searchType, query, wrapper, input, options);
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
            var employeeData = null;

            // Parse employeeData if present (for employee/nextapprover fields)
            if (option.dataset.employeeData) {
                try {
                    employeeData = JSON.parse(option.dataset.employeeData);
                } catch (e) {
                    // Ignore parse errors
                }
            }

            if (hiddenInput) hiddenInput.value = value;
            if (displayInput) displayInput.value = text;
            if (dropdown) dropdown.style.display = 'none';

            // Track the change
            if (fieldId) {
                this.changes[fieldId] = value;
                this.changes[fieldId + '_display'] = text;
                if (employeeData) {
                    this.changes[fieldId + '_employeeData'] = employeeData;
                }
                this.markUnsaved();
            }
        },

        // ==========================================
        // SMART FILL - Column Value Copy Feature
        // ==========================================

        // Undo state for fill operations
        fillUndoState: null,

        // Active fill state during drag
        fillDragState: null,

        // Bind Smart Fill event handlers
        bindSmartFill: function() {
            var self = this;
            var lineSections = document.querySelectorAll('.line-section');

            lineSections.forEach(function(lineSection) {
                // ========== FILL HANDLE DOUBLE-CLICK (auto-fill all below) ==========
                lineSection.addEventListener('dblclick', function(e) {
                    var fillHandle = e.target.closest('.fill-handle');
                    if (!fillHandle) return;

                    e.preventDefault();
                    var cell = fillHandle.closest('.fill-cell');
                    if (!cell) return;

                    self.fillDown(cell, true);
                });

                // ========== FILL HANDLE DRAG ==========
                lineSection.addEventListener('mousedown', function(e) {
                    var fillHandle = e.target.closest('.fill-handle');
                    if (!fillHandle) return;

                    e.preventDefault();
                    var cell = fillHandle.closest('.fill-cell');
                    if (!cell) return;

                    self.startFillDrag(cell, e);
                });

                // ========== FILL MENU BUTTON ==========
                lineSection.addEventListener('click', function(e) {
                    var menuBtn = e.target.closest('.fill-menu-btn');
                    if (!menuBtn) return;

                    e.preventDefault();
                    e.stopPropagation();
                    var cell = menuBtn.closest('.fill-cell');
                    if (!cell) return;

                    self.showFillPopover(cell);
                });

                // ========== KEYBOARD SHORTCUTS ==========
                lineSection.addEventListener('keydown', function(e) {
                    // Only handle when focused on a line input
                    var input = e.target.closest('.line-input');
                    if (!input) return;

                    var cell = input.closest('.fill-cell');
                    if (!cell) return;

                    // Ctrl+D - Fill down to next row
                    if (e.ctrlKey && e.key === 'd') {
                        e.preventDefault();
                        self.fillDown(cell, false);
                        return;
                    }

                    // Ctrl+Shift+D - Fill down to all rows
                    if (e.ctrlKey && e.shiftKey && e.key === 'D') {
                        e.preventDefault();
                        self.fillDown(cell, true);
                        return;
                    }

                    // ========== ARROW KEY NAVIGATION ==========
                    // Skip if typeahead dropdown is open (arrow keys navigate dropdown)
                    var wrapper = input.closest('.typeahead-select');
                    if (wrapper) {
                        var dropdown = wrapper.querySelector('.typeahead-dropdown');
                        if (dropdown && dropdown.style.display !== 'none' && dropdown.children.length > 0) {
                            return; // Let existing typeahead handler deal with it
                        }
                    }

                    var row = cell.closest('tr');
                    var table = row.closest('table');
                    var rows = table.querySelectorAll('tbody tr');
                    var cells = row.querySelectorAll('.fill-cell');
                    var cellIndex = Array.prototype.indexOf.call(cells, cell);
                    var rowIndex = Array.prototype.indexOf.call(rows, row);

                    // Tab key - move to next cell in table
                    if (e.key === 'Tab' && !e.ctrlKey && !e.metaKey) {
                        var nextInput = null;

                        if (e.shiftKey) {
                            // Shift+Tab - move backwards
                            if (cellIndex > 0) {
                                nextInput = self.getInputInCell(cells[cellIndex - 1]);
                            } else if (rowIndex > 0) {
                                var prevRow = rows[rowIndex - 1];
                                var prevCells = prevRow.querySelectorAll('.fill-cell');
                                if (prevCells.length > 0) {
                                    nextInput = self.getInputInCell(prevCells[prevCells.length - 1]);
                                }
                            }
                        } else {
                            // Tab - move forwards
                            if (cellIndex < cells.length - 1) {
                                nextInput = self.getInputInCell(cells[cellIndex + 1]);
                            } else if (rowIndex < rows.length - 1) {
                                var nextRow = rows[rowIndex + 1];
                                var nextCells = nextRow.querySelectorAll('.fill-cell');
                                if (nextCells.length > 0) {
                                    nextInput = self.getInputInCell(nextCells[0]);
                                }
                            }
                        }

                        if (nextInput) {
                            e.preventDefault();
                            nextInput.focus();
                            if (nextInput.select) nextInput.select();
                        }
                        return;
                    }

                    // Arrow keys for navigation
                    if (e.key === 'ArrowRight' && !e.ctrlKey && !e.metaKey) {
                        // Only navigate if cursor is at end of input or input is not a text field
                        var isAtEnd = input.type !== 'text' || input.selectionStart === input.value.length;
                        if (isAtEnd && cellIndex < cells.length - 1) {
                            e.preventDefault();
                            var nextInput = self.getInputInCell(cells[cellIndex + 1]);
                            if (nextInput) {
                                nextInput.focus();
                                if (nextInput.select) nextInput.select();
                            }
                        }
                        return;
                    }

                    if (e.key === 'ArrowLeft' && !e.ctrlKey && !e.metaKey) {
                        // Only navigate if cursor is at start of input or input is not a text field
                        var isAtStart = input.type !== 'text' || input.selectionStart === 0;
                        if (isAtStart && cellIndex > 0) {
                            e.preventDefault();
                            var prevInput = self.getInputInCell(cells[cellIndex - 1]);
                            if (prevInput) {
                                prevInput.focus();
                                if (prevInput.select) prevInput.select();
                            }
                        }
                        return;
                    }

                    if (e.key === 'ArrowDown' && !e.ctrlKey && !e.metaKey) {
                        if (rowIndex < rows.length - 1) {
                            e.preventDefault();
                            var nextRow = rows[rowIndex + 1];
                            var nextCells = nextRow.querySelectorAll('.fill-cell');
                            if (nextCells[cellIndex]) {
                                var nextInput = self.getInputInCell(nextCells[cellIndex]);
                                if (nextInput) {
                                    nextInput.focus();
                                    if (nextInput.select) nextInput.select();
                                }
                            }
                        }
                        return;
                    }

                    if (e.key === 'ArrowUp' && !e.ctrlKey && !e.metaKey) {
                        if (rowIndex > 0) {
                            e.preventDefault();
                            var prevRow = rows[rowIndex - 1];
                            var prevCells = prevRow.querySelectorAll('.fill-cell');
                            if (prevCells[cellIndex]) {
                                var prevInput = self.getInputInCell(prevCells[cellIndex]);
                                if (prevInput) {
                                    prevInput.focus();
                                    if (prevInput.select) prevInput.select();
                                }
                            }
                        }
                        return;
                    }

                    // Enter key - move to next row, same column
                    if (e.key === 'Enter' && !e.ctrlKey && !e.metaKey && !e.shiftKey) {
                        // Skip for typeahead inputs (Enter selects option)
                        if (input.classList.contains('typeahead-input')) return;

                        if (rowIndex < rows.length - 1) {
                            e.preventDefault();
                            var nextRow = rows[rowIndex + 1];
                            var nextCells = nextRow.querySelectorAll('.fill-cell');
                            if (nextCells[cellIndex]) {
                                var nextInput = self.getInputInCell(nextCells[cellIndex]);
                                if (nextInput) {
                                    nextInput.focus();
                                    if (nextInput.select) nextInput.select();
                                }
                            }
                        }
                        return;
                    }
                });
            });

            // Global mouse move/up for fill drag
            document.addEventListener('mousemove', function(e) {
                if (!self.fillDragState) return;
                self.updateFillDrag(e);
            });

            document.addEventListener('mouseup', function(e) {
                if (!self.fillDragState) return;
                self.endFillDrag(e);
            });

            // Close popover on outside click
            document.addEventListener('click', function(e) {
                if (!e.target.closest('.fill-popover') && !e.target.closest('.fill-menu-btn')) {
                    self.hideFillPopover();
                }
            });

            // Close popover on Escape
            document.addEventListener('keydown', function(e) {
                if (e.key === 'Escape') {
                    self.hideFillPopover();
                }
            });
        },

        // Start fill drag operation
        startFillDrag: function(sourceCell, e) {
            var sublistId = sourceCell.dataset.sublist;
            var fieldId = sourceCell.dataset.field;
            var sourceRow = parseInt(sourceCell.dataset.row, 10);

            // Get the source value
            var valueData = this.getCellValue(sourceCell);

            this.fillDragState = {
                sourceCell: sourceCell,
                sublistId: sublistId,
                fieldId: fieldId,
                sourceRow: sourceRow,
                valueData: valueData,
                targetRows: [],
                indicator: null
            };

            // Mark source cell
            sourceCell.classList.add('fill-source');

            // Create indicator element
            var indicator = document.createElement('div');
            indicator.className = 'fill-indicator';
            indicator.style.left = (e.clientX + 12) + 'px';
            indicator.style.top = (e.clientY + 12) + 'px';
            indicator.textContent = '0 rows';
            document.body.appendChild(indicator);
            this.fillDragState.indicator = indicator;

            // Prevent text selection during drag
            document.body.style.userSelect = 'none';
        },

        // Update fill drag (mouse move)
        updateFillDrag: function(e) {
            var state = this.fillDragState;
            if (!state) return;

            // Update indicator position
            if (state.indicator) {
                state.indicator.style.left = (e.clientX + 12) + 'px';
                state.indicator.style.top = (e.clientY + 12) + 'px';
            }

            // Find the cell under cursor
            var elemUnder = document.elementFromPoint(e.clientX, e.clientY);
            var cellUnder = elemUnder ? elemUnder.closest('.fill-cell') : null;

            // Clear previous targets
            document.querySelectorAll('.fill-target').forEach(function(el) {
                el.classList.remove('fill-target');
            });
            document.querySelectorAll('.fill-target-row').forEach(function(el) {
                el.classList.remove('fill-target-row');
            });

            state.targetRows = [];

            if (!cellUnder) {
                if (state.indicator) state.indicator.textContent = '0 rows';
                return;
            }

            // Must be same sublist and same field
            if (cellUnder.dataset.sublist !== state.sublistId ||
                cellUnder.dataset.field !== state.fieldId) {
                if (state.indicator) state.indicator.textContent = '0 rows';
                return;
            }

            var targetRow = parseInt(cellUnder.dataset.row, 10);
            if (isNaN(targetRow) || targetRow <= state.sourceRow) {
                if (state.indicator) state.indicator.textContent = '0 rows';
                return;
            }

            // Highlight all rows from source+1 to target
            var container = document.querySelector('#sublist-' + state.sublistId);
            if (!container) return;

            for (var i = state.sourceRow + 1; i <= targetRow; i++) {
                var row = container.querySelector('tr[data-idx="' + i + '"]');
                if (row) {
                    row.classList.add('fill-target-row');
                    var cell = row.querySelector('.fill-cell[data-field="' + state.fieldId + '"]');
                    if (cell) {
                        cell.classList.add('fill-target');
                        state.targetRows.push(i);
                    }
                }
            }

            // Update indicator
            var count = state.targetRows.length;
            if (state.indicator) {
                state.indicator.textContent = count + ' row' + (count === 1 ? '' : 's');
            }
        },

        // End fill drag (mouse up)
        endFillDrag: function(e) {
            var state = this.fillDragState;
            if (!state) return;

            // Remove indicator
            if (state.indicator) {
                state.indicator.remove();
            }

            // Remove visual states
            document.body.style.userSelect = '';
            state.sourceCell.classList.remove('fill-source');
            document.querySelectorAll('.fill-target').forEach(function(el) {
                el.classList.remove('fill-target');
            });
            document.querySelectorAll('.fill-target-row').forEach(function(el) {
                el.classList.remove('fill-target-row');
            });

            // Apply fill if we have targets
            if (state.targetRows.length > 0) {
                this.applyFill(state.sublistId, state.fieldId, state.valueData, state.targetRows);
            }

            this.fillDragState = null;
        },

        // Get value data from a cell (handles all types)
        getCellValue: function(cell) {
            var result = { value: '', display: '', isCheckbox: false, employeeData: null };

            // Check for checkbox
            var checkbox = cell.querySelector('.line-checkbox');
            if (checkbox) {
                result.value = checkbox.checked ? 'T' : 'F';
                result.isCheckbox = true;
                return result;
            }

            // Check for typeahead (select with API lookup)
            var typeahead = cell.querySelector('.typeahead-select');
            if (typeahead) {
                var hiddenInput = typeahead.querySelector('input[type="hidden"]');
                var displayInput = typeahead.querySelector('.typeahead-input');
                result.value = hiddenInput ? hiddenInput.value : '';
                result.display = displayInput ? displayInput.value : '';

                // Check for employee data
                var fieldId = cell.dataset.field;
                var row = cell.closest('tr');
                var sublistId = cell.dataset.sublist;
                if (row && this.sublistData && this.sublistData[sublistId]) {
                    var idx = parseInt(row.dataset.idx, 10);
                    var lineData = this.sublistData[sublistId][idx];
                    if (lineData && lineData[fieldId + '_employeeData']) {
                        result.employeeData = lineData[fieldId + '_employeeData'];
                    }
                }
                return result;
            }

            // Check for regular select
            var select = cell.querySelector('select.line-input');
            if (select) {
                result.value = select.value;
                result.display = select.options[select.selectedIndex] ?
                    select.options[select.selectedIndex].text : '';
                return result;
            }

            // Default: regular input
            var input = cell.querySelector('.line-input');
            if (input) {
                result.value = input.value;
            }

            return result;
        },

        // Set value in a cell (handles all types)
        setCellValue: function(cell, valueData) {
            var fieldId = cell.dataset.field;
            var row = cell.closest('tr');
            var sublistId = cell.dataset.sublist;
            var idx = row ? parseInt(row.dataset.idx, 10) : -1;

            // Handle checkbox
            var checkbox = cell.querySelector('.line-checkbox');
            if (checkbox) {
                checkbox.checked = valueData.value === 'T';
                this.updateSublistLine(sublistId, idx, fieldId, valueData.value === 'T', true);
                return;
            }

            // Handle typeahead
            var typeahead = cell.querySelector('.typeahead-select');
            if (typeahead) {
                var hiddenInput = typeahead.querySelector('input[type="hidden"]');
                var displayInput = typeahead.querySelector('.typeahead-input');
                if (hiddenInput) hiddenInput.value = valueData.value;
                if (displayInput) displayInput.value = valueData.display || valueData.value;

                // Update sublist data
                if (this.sublistData && this.sublistData[sublistId] && this.sublistData[sublistId][idx]) {
                    this.sublistData[sublistId][idx][fieldId] = valueData.value;
                    this.sublistData[sublistId][idx][fieldId + '_display'] = valueData.display || valueData.value;
                    if (valueData.employeeData) {
                        this.sublistData[sublistId][idx][fieldId + '_employeeData'] = valueData.employeeData;
                    }
                }
                this.changes[sublistId + 'Lines'] = this.sublistData[sublistId];
                this.markUnsaved();
                return;
            }

            // Handle select
            var select = cell.querySelector('select.line-input');
            if (select) {
                select.value = valueData.value;
                this.updateSublistLine(sublistId, idx, fieldId, valueData.value);
                return;
            }

            // Handle regular input
            var input = cell.querySelector('.line-input');
            if (input) {
                input.value = valueData.value;
                this.updateSublistLine(sublistId, idx, fieldId, valueData.value);
            }
        },

        // Apply fill to target rows
        applyFill: function(sublistId, fieldId, valueData, targetRows) {
            var self = this;

            // Store undo state
            var prevValues = [];
            var container = document.querySelector('#sublist-' + sublistId);
            if (!container) return;

            targetRows.forEach(function(rowIdx) {
                var cell = container.querySelector('.fill-cell[data-field="' + fieldId + '"][data-row="' + rowIdx + '"]');
                if (cell) {
                    prevValues.push({
                        row: rowIdx,
                        value: self.getCellValue(cell)
                    });
                }
            });

            this.fillUndoState = {
                sublistId: sublistId,
                fieldId: fieldId,
                prevValues: prevValues,
                newValue: valueData
            };

            // Apply the fill
            targetRows.forEach(function(rowIdx) {
                var cell = container.querySelector('.fill-cell[data-field="' + fieldId + '"][data-row="' + rowIdx + '"]');
                if (cell) {
                    self.setCellValue(cell, valueData);

                    // Brief highlight animation
                    cell.style.transition = 'background 0.3s ease';
                    cell.style.background = 'rgba(99, 102, 241, 0.15)';
                    setTimeout(function() {
                        cell.style.background = '';
                        cell.style.transition = '';
                    }, 300);
                }
            });

            // Show toast with undo
            var count = targetRows.length;
            this.showFillToast('Filled ' + count + ' row' + (count === 1 ? '' : 's'));
        },

        // Fill down from current cell
        fillDown: function(sourceCell, fillAll) {
            var sublistId = sourceCell.dataset.sublist;
            var fieldId = sourceCell.dataset.field;
            var sourceRow = parseInt(sourceCell.dataset.row, 10);
            var valueData = this.getCellValue(sourceCell);

            if (!this.sublistData || !this.sublistData[sublistId]) return;

            var totalRows = this.sublistData[sublistId].length;
            var targetRows = [];

            if (fillAll) {
                // Fill to all rows below
                for (var i = sourceRow + 1; i < totalRows; i++) {
                    targetRows.push(i);
                }
            } else {
                // Fill to next row only
                if (sourceRow + 1 < totalRows) {
                    targetRows.push(sourceRow + 1);
                }
            }

            if (targetRows.length > 0) {
                this.applyFill(sublistId, fieldId, valueData, targetRows);
            }
        },

        // Fill all rows in column
        fillAllRows: function(cell) {
            var sublistId = cell.dataset.sublist;
            var fieldId = cell.dataset.field;
            var sourceRow = parseInt(cell.dataset.row, 10);
            var valueData = this.getCellValue(cell);

            if (!this.sublistData || !this.sublistData[sublistId]) return;

            var totalRows = this.sublistData[sublistId].length;
            var targetRows = [];

            for (var i = 0; i < totalRows; i++) {
                if (i !== sourceRow) {
                    targetRows.push(i);
                }
            }

            if (targetRows.length > 0) {
                this.applyFill(sublistId, fieldId, valueData, targetRows);
            }
            this.hideFillPopover();
        },

        // Fill rows below current cell
        fillRowsBelow: function(cell) {
            this.fillDown(cell, true);
            this.hideFillPopover();
        },

        // Fill empty cells only
        fillEmptyCells: function(cell) {
            var self = this;
            var sublistId = cell.dataset.sublist;
            var fieldId = cell.dataset.field;
            var valueData = this.getCellValue(cell);

            if (!this.sublistData || !this.sublistData[sublistId]) return;

            var container = document.querySelector('#sublist-' + sublistId);
            if (!container) return;

            var totalRows = this.sublistData[sublistId].length;
            var targetRows = [];
            var sourceRow = parseInt(cell.dataset.row, 10);

            for (var i = 0; i < totalRows; i++) {
                if (i === sourceRow) continue;

                var targetCell = container.querySelector('.fill-cell[data-field="' + fieldId + '"][data-row="' + i + '"]');
                if (targetCell) {
                    var cellValue = this.getCellValue(targetCell);
                    if (!cellValue.value || cellValue.value === '' || cellValue.value === '0' || cellValue.value === '0.00') {
                        targetRows.push(i);
                    }
                }
            }

            if (targetRows.length > 0) {
                this.applyFill(sublistId, fieldId, valueData, targetRows);
            } else {
                UI.toast('No empty cells to fill', 'info');
            }
            this.hideFillPopover();
        },

        // Undo last fill operation
        undoFill: function() {
            var self = this;
            var state = this.fillUndoState;
            if (!state) {
                UI.toast('Nothing to undo', 'info');
                return;
            }

            var container = document.querySelector('#sublist-' + state.sublistId);
            if (!container) return;

            state.prevValues.forEach(function(pv) {
                var cell = container.querySelector('.fill-cell[data-field="' + state.fieldId + '"][data-row="' + pv.row + '"]');
                if (cell) {
                    self.setCellValue(cell, pv.value);
                }
            });

            UI.toast('Fill undone', 'success');
            this.fillUndoState = null;
        },

        // Show fill popover menu
        showFillPopover: function(cell) {
            var self = this;

            // Remove any existing popover
            this.hideFillPopover();

            var popover = document.createElement('div');
            popover.className = 'fill-popover';
            popover.innerHTML =
                '<div class="fill-popover-header">Fill Options</div>' +
                '<button type="button" class="fill-popover-option" data-action="all">' +
                    '<i class="fas fa-arrows-alt-v"></i> Apply to all rows' +
                '</button>' +
                '<button type="button" class="fill-popover-option" data-action="below">' +
                    '<i class="fas fa-arrow-down"></i> Apply to rows below' +
                    '<span class="shortcut">Ctrl+Shift+D</span>' +
                '</button>' +
                '<button type="button" class="fill-popover-option" data-action="empty">' +
                    '<i class="fas fa-border-none"></i> Apply to empty cells only' +
                '</button>' +
                '<div class="fill-popover-divider"></div>' +
                '<button type="button" class="fill-popover-option" data-action="undo">' +
                    '<i class="fas fa-undo"></i> Undo last fill' +
                '</button>';

            cell.appendChild(popover);

            // Position adjustment if needed
            requestAnimationFrame(function() {
                popover.classList.add('visible');
            });

            // Handle clicks
            popover.addEventListener('click', function(e) {
                var option = e.target.closest('.fill-popover-option');
                if (!option) return;

                var action = option.dataset.action;
                switch (action) {
                    case 'all':
                        self.fillAllRows(cell);
                        break;
                    case 'below':
                        self.fillRowsBelow(cell);
                        break;
                    case 'empty':
                        self.fillEmptyCells(cell);
                        break;
                    case 'undo':
                        self.undoFill();
                        self.hideFillPopover();
                        break;
                }
            });
        },

        // Hide fill popover
        hideFillPopover: function() {
            var existing = document.querySelector('.fill-popover');
            if (existing) {
                existing.classList.remove('visible');
                setTimeout(function() {
                    if (existing.parentNode) {
                        existing.parentNode.removeChild(existing);
                    }
                }, 150);
            }
        },

        // Show toast with undo button for fill operations
        showFillToast: function(message) {
            var self = this;

            // Create custom toast with undo
            var toastContainer = document.querySelector('.toast-container');
            if (!toastContainer) {
                toastContainer = document.createElement('div');
                toastContainer.className = 'toast-container';
                document.body.appendChild(toastContainer);
            }

            var toast = document.createElement('div');
            toast.className = 'toast toast-success';
            toast.innerHTML =
                '<span>' + message + '</span>' +
                '<button type="button" class="toast-undo">Undo</button>';

            toastContainer.appendChild(toast);

            // Handle undo click
            var undoBtn = toast.querySelector('.toast-undo');
            undoBtn.addEventListener('click', function() {
                self.undoFill();
                toast.remove();
            });

            // Auto-remove after 5 seconds
            setTimeout(function() {
                toast.style.opacity = '0';
                toast.style.transform = 'translateX(100%)';
                setTimeout(function() {
                    if (toast.parentNode) toast.remove();
                }, 300);
            }, 5000);

            // Animate in
            requestAnimationFrame(function() {
                toast.style.opacity = '1';
                toast.style.transform = 'translateX(0)';
            });
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
                case 'distribute-department':
                    this.showDistributeByModal(sublistId, 'department');
                    return; // Modal handles the rest
                case 'distribute-class':
                    this.showDistributeByModal(sublistId, 'class');
                    return; // Modal handles the rest
                case 'distribute-location':
                    this.showDistributeByModal(sublistId, 'location');
                    return; // Modal handles the rest
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

        /**
         * Check if a sublist line has meaningful data (not just defaults)
         * Used to filter out empty placeholder rows before saving
         * @param {string} sublistId - The sublist type (expense, item, etc.)
         * @param {object} line - The line data object
         * @returns {boolean} - True if line has meaningful data
         */
        isSublistLinePopulated: function(sublistId, line) {
            if (!line) return false;

            var slType = (sublistId || '').toLowerCase();

            // Check for common meaningful data fields that indicate a populated line
            // These fields apply to any sublist type
            var hasAmount = line.amount && parseFloat(line.amount) !== 0;
            var hasDescription = line.description && String(line.description).trim() !== '';
            var hasMemo = line.memo && String(line.memo).trim() !== '';
            var hasQuantity = line.quantity && parseFloat(line.quantity) !== 0;
            var hasCustomer = line.customer && String(line.customer).trim() !== '';
            var hasProject = (line.project && String(line.project).trim() !== '') ||
                             (line.job && String(line.job).trim() !== '');

            // For expense lines: check account/category OR any meaningful data (case-insensitive)
            if (slType === 'expense') {
                var hasAccount = (line.account || line.ACCOUNT) && String(line.account || line.ACCOUNT).trim() !== '';
                var hasExpenseAccount = (line.expenseaccount || line.EXPENSEACCOUNT) && String(line.expenseaccount || line.EXPENSEACCOUNT).trim() !== '';
                var hasCategory = (line.category || line.CATEGORY) && String(line.category || line.CATEGORY).trim() !== '';
                var hasExpenseCategory = (line.expensecategory || line.EXPENSECATEGORY) && String(line.expensecategory || line.EXPENSECATEGORY).trim() !== '';
                return hasAccount || hasExpenseAccount || hasCategory || hasExpenseCategory ||
                       hasAmount || hasDescription || hasMemo || hasCustomer || hasProject;
            }

            // For item lines: check item OR any meaningful data
            if (slType === 'item') {
                var hasItem = line.item && String(line.item).trim() !== '';
                return hasItem || hasAmount || hasDescription || hasMemo || hasQuantity || hasCustomer || hasProject;
            }

            // For other sublists: check if any non-default value exists
            // A line is populated if it has any non-empty string value or non-zero number
            var hasData = Object.keys(line).some(function(key) {
                // Skip display fields and internal fields
                if (key.indexOf('_display') !== -1 || key.indexOf('_') === 0) return false;

                var val = line[key];
                if (typeof val === 'string' && val.trim() !== '') return true;
                if (typeof val === 'number' && val !== 0) return true;
                return false;
            });

            return hasData;
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

        // Show distribute by modal for department/class/location
        showDistributeByModal: function(sublistId, fieldType) {
            var self = this;
            var lines = this.sublistData[sublistId] || [];
            var total = lines.reduce(function(sum, l) {
                return sum + (parseFloat(l.amount) || 0);
            }, 0);

            // Determine datasource type and labels
            var dsType, fieldLabel, fieldIcon;
            switch (fieldType) {
                case 'department':
                    dsType = 'departments';
                    fieldLabel = 'Department';
                    fieldIcon = 'fa-sitemap';
                    break;
                case 'class':
                    dsType = 'classes';
                    fieldLabel = 'Class';
                    fieldIcon = 'fa-tags';
                    break;
                case 'location':
                    dsType = 'locations';
                    fieldLabel = 'Location';
                    fieldIcon = 'fa-map-marker-alt';
                    break;
                default:
                    UI.toast('Unknown field type', 'error');
                    return;
            }

            // Show loading overlay
            var overlay = document.createElement('div');
            overlay.className = 'distribute-dialog-overlay';
            overlay.id = 'distribute-dialog-overlay';
            overlay.innerHTML =
                '<div class="distribute-dialog">' +
                    '<div class="distribute-dialog-loading">' +
                        '<i class="fas fa-spinner fa-spin"></i> Loading ' + fieldLabel + 's...' +
                    '</div>' +
                '</div>';
            document.body.appendChild(overlay);

            // Fetch the options from the datasource API
            API.get('datasource', { type: dsType })
                .then(function(response) {
                    var options = response.options || response.data || response || [];

                    if (!options || options.length === 0) {
                        overlay.remove();
                        self.transformUndoState = null;
                        var undoBtn = el('#btn-undo-' + sublistId);
                        if (undoBtn) undoBtn.style.display = 'none';
                        UI.toast('No ' + fieldLabel.toLowerCase() + 's available to distribute by', 'warning');
                        return;
                    }

                    // Build modal content
                    var optionsHtml = options.map(function(opt, idx) {
                        var optValue = opt.value || opt.id || '';
                        var optText = opt.text || opt.name || opt.label || optValue;
                        return '<div class="distribute-row" data-value="' + escapeHtml(optValue) + '" data-text="' + escapeHtml(optText) + '">' +
                            '<div class="distribute-row-check">' +
                                '<input type="checkbox" id="dist-check-' + idx + '" class="distribute-checkbox" data-value="' + escapeHtml(optValue) + '">' +
                            '</div>' +
                            '<div class="distribute-row-label">' +
                                '<label for="dist-check-' + idx + '">' + escapeHtml(optText) + '</label>' +
                            '</div>' +
                            '<div class="distribute-row-percent">' +
                                '<input type="number" class="distribute-percent" data-value="' + escapeHtml(optValue) + '" ' +
                                    'min="0" max="100" step="0.01" value="0" disabled placeholder="%">' +
                                '<span class="percent-sign">%</span>' +
                            '</div>' +
                            '<div class="distribute-row-amount">' +
                                '<span class="distribute-amount" data-value="' + escapeHtml(optValue) + '">$0.00</span>' +
                            '</div>' +
                        '</div>';
                    }).join('');

                    var dialogHtml =
                        '<div class="distribute-dialog">' +
                            '<div class="distribute-dialog-header">' +
                                '<h4><i class="fas ' + fieldIcon + '"></i> Distribute by ' + fieldLabel + '</h4>' +
                                '<button class="distribute-close" id="distribute-close">&times;</button>' +
                            '</div>' +
                            '<div class="distribute-dialog-info">' +
                                '<div class="distribute-total">' +
                                    '<span class="distribute-total-label">Total Amount:</span>' +
                                    '<span class="distribute-total-value">$' + total.toFixed(2) + '</span>' +
                                '</div>' +
                                '<div class="distribute-summary">' +
                                    '<span class="distribute-allocated-label">Allocated:</span>' +
                                    '<span class="distribute-allocated-value" id="distribute-allocated">0%</span>' +
                                    '<span class="distribute-remaining" id="distribute-remaining">(100% remaining)</span>' +
                                '</div>' +
                            '</div>' +
                            '<div class="distribute-dialog-body">' +
                                '<div class="distribute-header-row">' +
                                    '<div class="distribute-row-check"></div>' +
                                    '<div class="distribute-row-label">' + fieldLabel + '</div>' +
                                    '<div class="distribute-row-percent">Percent</div>' +
                                    '<div class="distribute-row-amount">Amount</div>' +
                                '</div>' +
                                '<div class="distribute-options">' + optionsHtml + '</div>' +
                            '</div>' +
                            '<div class="distribute-dialog-actions">' +
                                '<button class="btn btn-ghost btn-sm" id="distribute-cancel">Cancel</button>' +
                                '<button class="btn btn-ghost btn-sm" id="distribute-equal">Distribute Equally</button>' +
                                '<button class="btn btn-primary btn-sm" id="distribute-confirm" disabled>Apply Distribution</button>' +
                            '</div>' +
                        '</div>';

                    overlay.innerHTML = dialogHtml;

                    // Bind events
                    var updateTotals = function() {
                        var totalPercent = 0;
                        overlay.querySelectorAll('.distribute-percent:not(:disabled)').forEach(function(input) {
                            totalPercent += parseFloat(input.value) || 0;
                        });

                        var allocatedEl = el('#distribute-allocated');
                        var remainingEl = el('#distribute-remaining');
                        var confirmBtn = el('#distribute-confirm');

                        if (allocatedEl) allocatedEl.textContent = totalPercent.toFixed(2) + '%';
                        if (remainingEl) {
                            var remaining = 100 - totalPercent;
                            remainingEl.textContent = '(' + remaining.toFixed(2) + '% remaining)';
                            remainingEl.classList.toggle('over-allocated', remaining < 0);
                            remainingEl.classList.toggle('fully-allocated', Math.abs(remaining) < 0.01);
                        }

                        // Enable confirm button only when allocated is 100%
                        if (confirmBtn) {
                            var isValid = Math.abs(totalPercent - 100) < 0.01;
                            confirmBtn.disabled = !isValid;
                        }

                        // Update individual amounts
                        overlay.querySelectorAll('.distribute-percent').forEach(function(input) {
                            var value = input.dataset.value;
                            var percent = parseFloat(input.value) || 0;
                            var amount = (total * percent / 100);
                            var amountEl = overlay.querySelector('.distribute-amount[data-value="' + value + '"]');
                            if (amountEl) {
                                amountEl.textContent = '$' + amount.toFixed(2);
                            }
                        });
                    };

                    // Checkbox change handler
                    overlay.querySelectorAll('.distribute-checkbox').forEach(function(checkbox) {
                        checkbox.addEventListener('change', function() {
                            var value = this.dataset.value;
                            var percentInput = overlay.querySelector('.distribute-percent[data-value="' + value + '"]');
                            if (percentInput) {
                                percentInput.disabled = !this.checked;
                                if (!this.checked) {
                                    percentInput.value = 0;
                                }
                                updateTotals();
                            }
                        });
                    });

                    // Percent input change handler
                    overlay.querySelectorAll('.distribute-percent').forEach(function(input) {
                        input.addEventListener('input', updateTotals);
                        input.addEventListener('change', updateTotals);
                    });

                    // Distribute equally button
                    el('#distribute-equal').addEventListener('click', function() {
                        var checked = overlay.querySelectorAll('.distribute-checkbox:checked');
                        if (checked.length === 0) {
                            UI.toast('Please select at least one ' + fieldLabel.toLowerCase() + ' first', 'warning');
                            return;
                        }
                        var equalPercent = Math.round((100 / checked.length) * 100) / 100;
                        var remainder = 100 - (equalPercent * checked.length);

                        checked.forEach(function(cb, idx) {
                            var percentInput = overlay.querySelector('.distribute-percent[data-value="' + cb.dataset.value + '"]');
                            if (percentInput) {
                                var pct = equalPercent;
                                if (idx === 0) pct = Math.round((equalPercent + remainder) * 100) / 100;
                                percentInput.value = pct;
                            }
                        });
                        updateTotals();
                    });

                    // Close button
                    var closeModal = function() {
                        overlay.remove();
                        self.transformUndoState = null;
                        var undoBtn = el('#btn-undo-' + sublistId);
                        if (undoBtn) undoBtn.style.display = 'none';
                    };

                    el('#distribute-close').addEventListener('click', closeModal);
                    el('#distribute-cancel').addEventListener('click', closeModal);

                    // Click outside to close
                    overlay.addEventListener('click', function(e) {
                        if (e.target === overlay) closeModal();
                    });

                    // Escape to close
                    var escHandler = function(e) {
                        if (e.key === 'Escape') {
                            closeModal();
                            document.removeEventListener('keydown', escHandler);
                        }
                    };
                    document.addEventListener('keydown', escHandler);

                    // Confirm button
                    el('#distribute-confirm').addEventListener('click', function() {
                        var distribution = [];
                        overlay.querySelectorAll('.distribute-checkbox:checked').forEach(function(cb) {
                            var value = cb.dataset.value;
                            var row = cb.closest('.distribute-row');
                            var text = row ? row.dataset.text : value;
                            var percentInput = overlay.querySelector('.distribute-percent[data-value="' + value + '"]');
                            var percent = parseFloat(percentInput.value) || 0;
                            if (percent > 0) {
                                distribution.push({
                                    value: value,
                                    text: text,
                                    percent: percent
                                });
                            }
                        });

                        if (distribution.length === 0) {
                            UI.toast('Please configure at least one distribution', 'warning');
                            return;
                        }

                        overlay.remove();
                        document.removeEventListener('keydown', escHandler);
                        self.executeDistribution(sublistId, fieldType, distribution, total);
                    });
                })
                .catch(function(err) {
                    overlay.remove();
                    self.transformUndoState = null;
                    var undoBtn = el('#btn-undo-' + sublistId);
                    if (undoBtn) undoBtn.style.display = 'none';
                    UI.toast('Failed to load ' + fieldLabel.toLowerCase() + 's: ' + (err.message || err), 'error');
                });
        },

        // Execute distribution operation
        executeDistribution: function(sublistId, fieldType, distribution, total) {
            var self = this;
            var lines = this.sublistData[sublistId] || [];

            // Use first line as template (or create empty if no lines)
            var baseLine = lines.length > 0 ? JSON.parse(JSON.stringify(lines[0])) : this.createEmptyLine(sublistId);

            // Clear numeric values from base line (except quantity which we preserve if present)
            Object.keys(baseLine).forEach(function(key) {
                if (key.indexOf('_display') !== -1) return;
                if (self.isNumericField(key, sublistId) && key !== 'quantity') {
                    baseLine[key] = 0;
                }
            });

            // Clear the distribution field from the base line
            baseLine[fieldType] = '';
            baseLine[fieldType + '_display'] = '';

            var newLines = [];
            var totalAllocated = 0;

            distribution.forEach(function(dist, idx) {
                var amount = Math.round((total * dist.percent / 100) * 100) / 100;

                // Handle rounding on last line to ensure exact total
                if (idx === distribution.length - 1) {
                    amount = Math.round((total - totalAllocated) * 100) / 100;
                }
                totalAllocated += amount;

                var newLine = JSON.parse(JSON.stringify(baseLine));
                newLine.amount = amount;
                newLine[fieldType] = dist.value;
                newLine[fieldType + '_display'] = dist.text;

                // Update rate if it's an item line with quantity
                if (newLine.quantity && newLine.quantity > 0) {
                    newLine.rate = newLine.amount / newLine.quantity;
                }

                newLines.push(newLine);
            });

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

            var fieldLabel = fieldType.charAt(0).toUpperCase() + fieldType.slice(1);
            UI.toast('Distributed $' + total.toFixed(2) + ' across ' + newLines.length + ' ' + fieldLabel.toLowerCase() + 's', 'success');
        },

        // ==========================================
        // ENTITY SEARCH (vendors for bills, employees for expense reports)
        // ==========================================
        searchEntity: function(query) {
            var self = this;
            var isExpenseReport = this.transactionType === 'expensereport';

            if (isExpenseReport) {
                // Search employees
                API.get('datasource', { type: 'employees', query: query })
                    .then(function(response) {
                        var data = response.data || response;
                        self.entitySuggestions = data.options || data || [];
                        if (self.entitySuggestions.length > 0) {
                            self.showEntityDropdown();
                        } else {
                            self.hideEntityDropdown();
                        }
                    })
                    .catch(function() {
                        self.hideEntityDropdown();
                    });
            } else {
                // Search vendors
                API.get('vendors', { query: query })
                    .then(function(vendors) {
                        self.entitySuggestions = (vendors || []).map(function(v) {
                            return {
                                value: v.id,
                                text: v.companyName || v.entityId,
                                email: v.email
                            };
                        });
                        if (self.entitySuggestions.length > 0) {
                            self.showEntityDropdown();
                        } else {
                            self.hideEntityDropdown();
                        }
                    })
                    .catch(function() {
                        self.hideEntityDropdown();
                    });
            }
        },

        showEntityDropdown: function() {
            var dropdown = el('#entity-dropdown');
            if (!dropdown) return;

            var isExpenseReport = this.transactionType === 'expensereport';

            var html = this.entitySuggestions.map(function(e) {
                return '<div class="entity-option" data-id="' + e.value + '" data-name="' + escapeHtml(e.text) + '">' +
                    '<div class="entity-option-name">' + escapeHtml(e.text) + '</div>' +
                    (e.email ? '<div class="entity-option-email">' + escapeHtml(e.email) + '</div>' : '') +
                '</div>';
            }).join('');

            dropdown.innerHTML = html;
            dropdown.style.display = 'block';

            // Bind click handlers
            var self = this;
            dropdown.querySelectorAll('.entity-option').forEach(function(opt) {
                opt.addEventListener('click', function() {
                    var id = this.dataset.id;
                    var name = this.dataset.name;
                    var input = el('#field-entity');
                    var hiddenInput = el('#field-entityId');

                    if (input) input.value = name;
                    if (hiddenInput) {
                        hiddenInput.value = id;
                    } else {
                        var hidden = document.createElement('input');
                        hidden.type = 'hidden';
                        hidden.id = 'field-entityId';
                        hidden.value = id;
                        input.parentNode.appendChild(hidden);
                    }

                    if (isExpenseReport) {
                        ReviewController.changes.employeeName = name;
                        ReviewController.changes.employeeId = id;
                    } else {
                        ReviewController.changes.vendorName = name;
                        ReviewController.changes.vendorId = id;
                        // Fetch coding suggestions for this vendor
                        ReviewController.fetchCodingSuggestions(id);
                    }
                    ReviewController.markUnsaved();
                    ReviewController.hideEntityDropdown();
                });
            });
        },

        hideEntityDropdown: function() {
            var dropdown = el('#entity-dropdown');
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

            // Add indicator after entity section
            var entitySection = el('.entity-field');
            if (!entitySection) return;

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

            entitySection.parentNode.insertBefore(indicator, entitySection.nextSibling);

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

        // Position dropdown using fixed positioning to avoid container clipping
        positionDropdown: function(dropdown, input) {
            if (!dropdown || !input) {
                FCDebug.log('[Typeahead] positionDropdown: missing dropdown or input');
                return;
            }

            // Check if inside a sublist table
            var isInSublist = input.closest('.sublist-table');
            FCDebug.log('[Typeahead] positionDropdown: isInSublist =', !!isInSublist);

            if (!isInSublist) return; // Use default CSS positioning for non-sublist

            // Get input position
            var rect = input.getBoundingClientRect();
            var viewportHeight = window.innerHeight;
            var viewportWidth = window.innerWidth;

            FCDebug.log('[Typeahead] Input rect:', rect.left, rect.top, rect.width, rect.height);

            // Calculate available space below and above
            var spaceBelow = viewportHeight - rect.bottom - 10;
            var spaceAbove = rect.top - 10;

            // Determine dropdown height (max 220px)
            var dropdownHeight = Math.min(220, Math.max(spaceBelow, spaceAbove));

            // Ensure minimum width
            var dropdownWidth = Math.max(200, rect.width);

            // Position dropdown with fixed positioning
            dropdown.style.position = 'fixed';
            dropdown.style.width = dropdownWidth + 'px';
            dropdown.style.minWidth = '200px';
            dropdown.style.left = Math.min(rect.left, viewportWidth - dropdownWidth - 10) + 'px';
            dropdown.style.right = 'auto'; // Override CSS right: 0
            dropdown.style.maxHeight = dropdownHeight + 'px';
            dropdown.style.zIndex = '10001'; // Ensure it's on top

            // Show above or below depending on space
            if (spaceBelow >= 150 || spaceBelow >= spaceAbove) {
                // Show below
                dropdown.style.top = rect.bottom + 2 + 'px';
                dropdown.style.bottom = 'auto';
                FCDebug.log('[Typeahead] Positioned below at top:', rect.bottom + 2);
            } else {
                // Show above
                dropdown.style.bottom = (viewportHeight - rect.top + 2) + 'px';
                dropdown.style.top = 'auto';
                FCDebug.log('[Typeahead] Positioned above at bottom:', viewportHeight - rect.top + 2);
            }
        },

        searchDatasource: function(type, query, wrapper, input, options) {
            var self = this;
            FCDebug.log('[Typeahead] searchDatasource called:', type, query);

            var dropdown = wrapper ? wrapper.querySelector('.typeahead-dropdown') : null;
            if (!dropdown) {
                FCDebug.log('[Typeahead] ERROR: dropdown not found in wrapper');
                return;
            }

            FCDebug.log('[Typeahead] Found dropdown element');

            // Show loading state
            dropdown.innerHTML = '<div class="typeahead-loading"><i class="fas fa-spinner fa-spin"></i> Searching...</div>';
            dropdown.style.display = 'block';

            FCDebug.log('[Typeahead] Set display block, positioning...');

            // Position dropdown using fixed positioning to avoid container clipping
            this.positionDropdown(dropdown, input);

            // Build API params
            var params = { type: type, query: query, limit: 100 };
            if (options && options.accountType) {
                params.accountType = options.accountType;
            }

            API.get('datasource', params)
                .then(function(result) {
                    var data = result.data || result;
                    // Handle both formats: array or { options: [], defaultValue }
                    var opts = Array.isArray(data) ? data : (data.options || data);
                    self.renderTypeaheadResults(dropdown, opts, wrapper, input);
                    // Ensure dropdown is visible and positioned after content render
                    dropdown.style.display = 'block';
                    self.positionDropdown(dropdown, input);
                })
                .catch(function(err) {
                    dropdown.innerHTML = '<div class="typeahead-error">Error loading options</div>';
                    dropdown.style.display = 'block';
                });
        },

        renderTypeaheadResults: function(dropdown, results, wrapper, input) {
            FCDebug.log('[Typeahead] renderTypeaheadResults called with', results ? results.length : 0, 'results');

            // Handle both array and object with options
            var options = Array.isArray(results) ? results : (results.options || results);
            if (!options || options.length === 0) {
                dropdown.innerHTML = '<div class="typeahead-empty">No results found</div>';
                FCDebug.log('[Typeahead] No results to render');
                return;
            }

            // Sort options alphabetically by text
            options = options.slice().sort(function(a, b) {
                return (a.text || '').localeCompare(b.text || '');
            });

            var html = options.map(function(r) {
                var dataAttrs = 'data-value="' + escapeHtml(r.value) + '" data-text="' + escapeHtml(r.text) + '"';
                // Include employeeData as JSON data attribute for employee/nextapprover fields
                if (r.employeeData) {
                    dataAttrs += ' data-employee-data="' + escapeHtml(JSON.stringify(r.employeeData)) + '"';
                }
                return '<div class="typeahead-option" ' + dataAttrs + '>' +
                    '<span class="typeahead-text">' + escapeHtml(r.text) + '</span>' +
                    '</div>';
            }).join('');

            dropdown.innerHTML = html;
            FCDebug.log('[Typeahead] Rendered', options.length, 'options, dropdown HTML length:', html.length);
        },

        selectTypeaheadOption: function(wrapper, option) {
            var hiddenInput = wrapper.querySelector('input[type="hidden"]');
            var displayInput = wrapper.querySelector('.typeahead-input');
            var dropdown = wrapper.querySelector('.typeahead-dropdown');

            var value = option.dataset.value;
            var text = option.dataset.text;
            var employeeData = null;

            // Parse employeeData if present
            if (option.dataset.employeeData) {
                try {
                    employeeData = JSON.parse(option.dataset.employeeData);
                } catch (e) {
                    // Ignore parse errors
                }
            }

            if (hiddenInput) hiddenInput.value = value;
            if (displayInput) displayInput.value = text;
            if (dropdown) dropdown.style.display = 'none';

            // Trigger line update
            var row = wrapper.closest('tr');
            var self = this;
            if (row) {
                var idx = parseInt(row.dataset.idx, 10);
                var sublistId = row.dataset.sublist;
                var fieldId = hiddenInput ? hiddenInput.dataset.field : displayInput.dataset.field;
                this.updateSublistLine(sublistId, idx, fieldId, value);

                // Also store the display text and employeeData
                if (this.sublistData && this.sublistData[sublistId] && this.sublistData[sublistId][idx]) {
                    this.sublistData[sublistId][idx][fieldId + '_display'] = text;
                    if (employeeData) {
                        this.sublistData[sublistId][idx][fieldId + '_employeeData'] = employeeData;
                    }
                }

                // Auto-populate expense account when category changes
                var normalizedFieldId = (fieldId || '').toLowerCase();
                if (normalizedFieldId === 'category' || normalizedFieldId === 'expensecategory') {
                    this.fetchCategoryExpenseAccount(value, function(expenseAccountData) {
                        if (expenseAccountData && expenseAccountData.value) {
                            // Update the expenseaccount field in this row
                            self.updateSublistLine(sublistId, idx, 'expenseaccount', expenseAccountData.value);
                            if (self.sublistData && self.sublistData[sublistId] && self.sublistData[sublistId][idx]) {
                                self.sublistData[sublistId][idx].expenseaccount = expenseAccountData.value;
                                self.sublistData[sublistId][idx].expenseaccount_display = expenseAccountData.text;
                            }

                            // Update the DOM input if visible
                            var expenseAccountInput = row.querySelector('input[data-field="expenseaccount"]');
                            var expenseAccountDisplay = row.querySelector('.typeahead-input[data-field="expenseaccount"]');
                            if (expenseAccountInput) expenseAccountInput.value = expenseAccountData.value;
                            if (expenseAccountDisplay) expenseAccountDisplay.value = expenseAccountData.text;
                        }
                    });
                }
            } else {
                // Header field - store employeeData in bodyFieldData
                var fieldId = hiddenInput ? hiddenInput.dataset.field : (displayInput ? displayInput.dataset.field : null);
                if (fieldId && this.bodyFieldData) {
                    this.bodyFieldData[fieldId + '_display'] = text;
                    if (employeeData) {
                        this.bodyFieldData[fieldId + '_employeeData'] = employeeData;
                    }
                }
            }

            this.markUnsaved();
        },

        hideTypeaheadDropdown: function(wrapper) {
            if (!wrapper) return;
            var dropdown = wrapper.querySelector('.typeahead-dropdown');
            if (dropdown) dropdown.style.display = 'none';
        },

        // Fetch expense account associated with an expense category
        fetchCategoryExpenseAccount: function(categoryId, callback) {
            if (!categoryId) {
                callback(null);
                return;
            }

            // Call API to get expense category details including expense account
            API.get('expensecategory', { id: categoryId })
                .then(function(result) {
                    if (result && result.expenseAccount) {
                        callback({
                            value: result.expenseAccount,
                            text: result.expenseAccountName || result.expenseAccount
                        });
                    } else {
                        callback(null);
                    }
                })
                .catch(function(err) {
                    FCDebug.log('[View.Review] Error fetching expense category:', err);
                    callback(null);
                });
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
            var isExpenseReport = this.transactionType === 'expensereport';

            // Core required fields - always required (vendor for bills, employee for expense reports)
            var entityName = el('#field-entity');
            if (!entityName || !entityName.value.trim()) {
                var entityLabel = isExpenseReport ? 'Employee' : 'Vendor';
                return { valid: false, message: entityLabel + ' name is required', focusElement: entityName };
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

            // Validate all required fields (client-side)
            var validation = this.validateRequiredFields();
            if (!validation.valid) {
                UI.toast(validation.message, 'warning');
                if (validation.focusElement) {
                    validation.focusElement.focus();
                    validation.focusElement.scrollIntoView({ behavior: 'smooth', block: 'center' });
                }
                return;
            }

            // Show processing state
            var approveBtn = el('#btn-approve');
            var approveBtnText = approveBtn ? approveBtn.querySelector('.btn-text') : null;
            var approveBtnIcon = approveBtn ? approveBtn.querySelector('i') : null;
            if (approveBtn) {
                approveBtn.disabled = true;
                if (approveBtnIcon) approveBtnIcon.className = 'fas fa-spinner fa-spin';
                if (approveBtnText) approveBtnText.textContent = 'Creating Transaction...';
            }

            // Always save current form state before approval to ensure transaction uses latest data
            var formData = this.collectFormData();

            // Log collected form data for debugging
            console.log('[Flux] Collected formData for approval:', JSON.stringify(formData, null, 2));

            API.put('update', { documentId: this.docId, formData: formData })
                .then(function() {
                    return API.put('approve', {
                        documentId: self.docId,
                        createTransaction: true,
                        transactionType: self.transactionType
                    });
                })
                .then(function(result) {
                    // Trigger confetti celebration
                    self.triggerConfetti();

                    // Build success message
                    var message = 'Transaction #' + result.transactionId + ' created!';
                    if (result.fileAttached) {
                        message += ' Document attached.';
                    }
                    UI.toast(message, 'success');

                    // Remove current doc from queue if it was deleted
                    if (result.documentDeleted && self.queueIds && self.queueIds.length > 0) {
                        var currentIdx = self.queueIds.indexOf(String(self.docId));
                        if (currentIdx > -1) {
                            self.queueIds.splice(currentIdx, 1);
                            // Adjust queue index if needed
                            if (self.queueIndex > currentIdx) {
                                self.queueIndex--;
                            }
                        }
                    }

                    // Go to next document or back to documents list
                    if (self.queueIndex >= 0 && self.queueIndex < self.queueIds.length - 1) {
                        self.goToNextDocument();
                    } else {
                        // Last document - celebrate and go back
                        if (self.queueIds && self.queueIds.length > 0) {
                            UI.toast('Queue complete! Great work!', 'success');
                        }
                        setTimeout(function() {
                            Router.navigate('documents');
                        }, 800);
                    }
                })
                .catch(function(err) {
                    // Reset button state
                    if (approveBtn) {
                        approveBtn.disabled = false;
                        if (approveBtnIcon) approveBtnIcon.className = 'fas fa-check';
                        if (approveBtnText) approveBtnText.textContent = 'Approve & Create';
                    }

                    // Handle errors with persistent modal
                    var errors = (err.details && err.details.errors) || err.errors;
                    var warnings = (err.details && err.details.warnings) || err.warnings;

                    // If no structured errors but we have an error message, show it in the modal
                    if ((!errors || errors.length === 0) && err.message) {
                        errors = [{ field: null, message: err.message }];
                    }

                    if (errors && Array.isArray(errors) && errors.length > 0) {
                        self.showValidationErrorsModal(errors, warnings || []);
                    } else {
                        UI.toast('Error: ' + (err.message || 'Unknown error'), 'error');
                    }
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

        /**
         * Show validation errors in the header bar (expandable section)
         * @param {Array} errors - Array of error objects with field and message
         * @param {Array} warnings - Array of warning objects with field and message
         */
        showValidationErrorsModal: function(errors, warnings) {
            var self = this;
            var headerBar = el('.review-header-bar');
            if (!headerBar) return;

            // Remove any existing errors section
            var existingToggle = el('#error-status-toggle');
            var existingDropdown = el('#error-details');
            if (existingToggle) existingToggle.remove();
            if (existingDropdown) existingDropdown.remove();

            // Build error list HTML
            var errorListHtml = errors.map(function(err) {
                return '<div class="alert-item error-item">' +
                    '<i class="fas fa-times-circle"></i>' +
                    '<span class="alert-message">' + escapeHtml(err.message) + '</span>' +
                    (err.field ? '<button class="btn-goto-field" data-field="' + escapeHtml(err.field) + '">Go to field</button>' : '') +
                '</div>';
            }).join('');

            var warningListHtml = warnings && warnings.length > 0 ? warnings.map(function(warn) {
                return '<div class="alert-item warning-item">' +
                    '<i class="fas fa-exclamation-triangle"></i>' +
                    '<span class="alert-message">' + escapeHtml(warn.message) + '</span>' +
                '</div>';
            }).join('') : '';

            var totalCount = errors.length + (warnings ? warnings.length : 0);

            // Create the error toggle (insert after alerts or at start)
            var errorToggleHtml = '<div class="header-metric error-metric has-errors" id="error-status-toggle">' +
                '<div class="metric-icon error-icon">' +
                    '<i class="fas fa-times-circle"></i>' +
                    '<span class="metric-badge">' + totalCount + '</span>' +
                '</div>' +
                '<span class="metric-label">Error' + (totalCount > 1 ? 's' : '') + '</span>' +
                '<i class="fas fa-chevron-up metric-chevron"></i>' +
            '</div>';

            // Create the dropdown
            var dropdownHtml = '<div class="header-dropdown error-dropdown" id="error-details">' +
                '<div class="alerts-section">' +
                    '<div class="alert-category">' +
                        '<div class="category-header"><i class="fas fa-times-circle text-danger"></i> Validation Errors</div>' +
                        errorListHtml +
                    '</div>' +
                    (warningListHtml ? '<div class="alert-category">' +
                        '<div class="category-header"><i class="fas fa-exclamation-triangle text-warning"></i> Warnings</div>' +
                        warningListHtml +
                    '</div>' : '') +
                '</div>' +
            '</div>';

            // Insert after alert toggle or at beginning of header bar
            var alertToggle = el('#alert-status-toggle');
            if (alertToggle) {
                alertToggle.insertAdjacentHTML('afterend', errorToggleHtml);
            } else {
                var confidenceMetric = headerBar.querySelector('.confidence-metric');
                if (confidenceMetric) {
                    confidenceMetric.insertAdjacentHTML('afterend', errorToggleHtml);
                } else {
                    headerBar.insertAdjacentHTML('afterbegin', errorToggleHtml);
                }
            }

            // Insert dropdown after header bar
            headerBar.insertAdjacentHTML('afterend', dropdownHtml);

            // Bind toggle
            var errorToggle = el('#error-status-toggle');
            var errorDetails = el('#error-details');

            if (errorToggle && errorDetails) {
                errorToggle.onclick = function(e) {
                    e.stopPropagation();
                    var chevron = errorToggle.querySelector('.metric-chevron');
                    if (errorDetails.style.display === 'none') {
                        errorDetails.style.display = 'block';
                        if (chevron) {
                            chevron.classList.remove('fa-chevron-down');
                            chevron.classList.add('fa-chevron-up');
                        }
                    } else {
                        errorDetails.style.display = 'none';
                        if (chevron) {
                            chevron.classList.remove('fa-chevron-up');
                            chevron.classList.add('fa-chevron-down');
                        }
                    }
                };
            }

            // Bind go-to-field buttons
            if (errorDetails) {
                errorDetails.querySelectorAll('.btn-goto-field').forEach(function(btn) {
                    btn.addEventListener('click', function() {
                        var fieldId = this.dataset.field;
                        // Parse sublist field format: expense[0].account or item[2].quantity
                        var sublistMatch = fieldId.match(/^(\w+)\[(\d+)\]\.(\w+)$/);
                        if (sublistMatch) {
                            var sublistName = sublistMatch[1];
                            var rowIdx = sublistMatch[2];
                            var fieldName = sublistMatch[3];

                            // First, activate the correct sublist tab if needed
                            var sublistTab = el('.sublist-tab[data-sublist="' + sublistName + '"]');
                            if (sublistTab && !sublistTab.classList.contains('active')) {
                                sublistTab.click();
                            }

                            // Find the specific cell or input
                            var targetCell = el('[data-sublist="' + sublistName + '"][data-idx="' + rowIdx + '"] [data-field="' + fieldName + '"]') ||
                                             el('tr[data-sublist="' + sublistName + '"][data-idx="' + rowIdx + '"] td[data-field="' + fieldName + '"]');
                            if (targetCell) {
                                var input = targetCell.querySelector('input, select');
                                if (input) {
                                    input.focus();
                                    input.scrollIntoView({ behavior: 'smooth', block: 'center' });
                                } else {
                                    targetCell.scrollIntoView({ behavior: 'smooth', block: 'center' });
                                }
                            } else {
                                // Fallback: scroll to the sublist container
                                var sublistContainer = el('.sublist-container[data-sublist-id="' + sublistName + '"]') ||
                                                       el('#sublist-' + sublistName);
                                if (sublistContainer) {
                                    sublistContainer.scrollIntoView({ behavior: 'smooth', block: 'center' });
                                }
                            }
                        } else {
                            // Body field - try to find by ID
                            var fieldEl = el('#field-' + fieldId);
                            if (fieldEl) {
                                fieldEl.focus();
                                fieldEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
                            }
                        }
                    });
                });
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

            // Update pan cursor state
            this.updatePanCursor();

            // If using PDF.js, re-render the page at new zoom
            if (this.pdfDoc) {
                this.renderPdfPage(this.currentPage);
            } else if (this.imageElement && this.imageNaturalWidth) {
                // Re-render image at new zoom level
                this.renderImagePage(this.imageElement);
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
            if (this.pdfDoc) {
                this.renderPdfPage(this.currentPage);
            } else if (this.imageElement && this.imageNaturalWidth) {
                // Re-render image with new rotation
                this.renderImagePage(this.imageElement);
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
            this.bindSublistColumnEvents();

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

                // ========== TYPEAHEAD SEARCH FOR SELECT FIELDS ==========
                tbody.addEventListener('input', function(e) {
                    var input = e.target;
                    if (!input.classList.contains('typeahead-input')) return;

                    var query = input.value.trim();
                    var wrapper = input.closest('.typeahead-select');
                    var lookupType = input.dataset.lookup;
                    var row = input.closest('tr');
                    var fieldId = (input.dataset.field || '').toLowerCase();

                    clearTimeout(self.typeaheadTimeout);

                    if (query.length < 2) {
                        self.hideTypeaheadDropdown(wrapper);
                        return;
                    }

                    // Determine account type based on field
                    var options = {};
                    var searchType = lookupType;
                    if (lookupType === 'expenseaccounts') {
                        searchType = 'accounts';
                        options.accountType = 'Expense';
                    } else if (lookupType === 'accounts') {
                        if (fieldId === 'acctcorpcardexp') {
                            options.accountType = 'CCard';
                        }
                    }

                    self.typeaheadTimeout = setTimeout(function() {
                        self.searchDatasource(searchType, query, wrapper, input, options);
                    }, 300);
                });

                // Typeahead option selection
                tbody.addEventListener('click', function(e) {
                    var option = e.target.closest('.typeahead-option');
                    if (!option) return;

                    var wrapper = option.closest('.typeahead-select');
                    self.selectTypeaheadOption(wrapper, option);
                });

                // Hide typeahead on blur
                tbody.addEventListener('focusout', function(e) {
                    if (!e.target.classList.contains('typeahead-input')) return;

                    setTimeout(function() {
                        var wrapper = e.target.closest('.typeahead-select');
                        self.hideTypeaheadDropdown(wrapper);
                    }, 200);
                });

                // Keyboard navigation for typeahead
                tbody.addEventListener('keydown', function(e) {
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
                        var nextIdx = currentIdx < options.length - 1 ? currentIdx + 1 : 0;
                        options[nextIdx].classList.add('highlighted');
                        options[nextIdx].scrollIntoView({ block: 'nearest' });
                    } else if (e.key === 'ArrowUp') {
                        e.preventDefault();
                        if (highlighted) highlighted.classList.remove('highlighted');
                        var prevIdx = currentIdx > 0 ? currentIdx - 1 : options.length - 1;
                        options[prevIdx].classList.add('highlighted');
                        options[prevIdx].scrollIntoView({ block: 'nearest' });
                    } else if (e.key === 'Enter') {
                        e.preventDefault();
                        if (highlighted) {
                            self.selectTypeaheadOption(wrapper, highlighted);
                        }
                    } else if (e.key === 'Escape') {
                        self.hideTypeaheadDropdown(wrapper);
                    }
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

            // For continuous scrolling, scroll to the page
            if (this.pdfDoc && this.pageElements) {
                this.scrollToPage(this.currentPage);
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
            UI.showKeyboardShortcuts();
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

        // ==================== PO MATCHING UI ====================

        /**
         * Render the PO matching indicator in the header bar
         * Subtle integration - only shows when relevant
         */
        renderPOMatchIndicator: function(doc) {
            // Only show for vendor bills and similar transaction types (not expense reports)
            if (this.transactionType === 'expensereport') {
                return '';
            }

            // Check if there's a PO number extracted or existing match
            var hasPONumber = doc.poNumber || (doc.extractedData && doc.extractedData.poNumber);
            var hasMatch = doc.matchedPO || doc.poMatchStatus;
            var matchScore = doc.poMatchScore ? Math.round(parseFloat(doc.poMatchScore) * 100) : 0;
            var matchStatus = parseInt(doc.poMatchStatus) || 0;

            // PO Match Status: 1=Pending, 2=Matched, 3=Partial, 4=Exception, 5=No PO, 6=Manual
            var statusInfo = this.getPOMatchStatusInfo(matchStatus, matchScore, hasPONumber);

            // If no PO data at all and no extracted PO number, just show search option
            if (!hasPONumber && !hasMatch && matchStatus === 0) {
                return '<div class="header-metric po-metric po-none" id="po-match-toggle" title="Link to Purchase Order">' +
                    '<div class="metric-icon po-icon">' +
                        '<i class="fas fa-file-invoice"></i>' +
                    '</div>' +
                    '<span class="metric-label">Link PO</span>' +
                    '<i class="fas fa-chevron-down metric-chevron"></i>' +
                '</div>';
            }

            return '<div class="header-metric po-metric ' + statusInfo.cssClass + '" id="po-match-toggle" title="' + statusInfo.tooltip + '">' +
                '<div class="metric-icon po-icon">' +
                    '<i class="fas fa-' + statusInfo.icon + '"></i>' +
                    (matchScore > 0 && matchStatus !== 5 ? '<span class="metric-badge po-badge">' + matchScore + '</span>' : '') +
                '</div>' +
                '<span class="metric-label">' + statusInfo.label + '</span>' +
                '<i class="fas fa-chevron-down metric-chevron"></i>' +
            '</div>';
        },

        /**
         * Get status info for PO match display
         */
        getPOMatchStatusInfo: function(status, score, hasPONumber) {
            var info = {
                icon: 'file-invoice',
                label: 'PO Match',
                cssClass: 'po-pending',
                tooltip: 'Click to view PO matching details'
            };

            switch (status) {
                case 2: // Matched
                    info.icon = 'link';
                    info.label = 'PO Linked';
                    info.cssClass = 'po-matched';
                    info.tooltip = 'Invoice matched to Purchase Order (' + score + '% confidence)';
                    break;
                case 3: // Partial
                    info.icon = 'unlink';
                    info.label = 'Partial';
                    info.cssClass = 'po-partial';
                    info.tooltip = 'Partial match - review recommended';
                    break;
                case 4: // Exception
                    info.icon = 'exclamation-circle';
                    info.label = 'Exception';
                    info.cssClass = 'po-exception';
                    info.tooltip = 'PO matching exception - manual review required';
                    break;
                case 5: // No PO
                    info.icon = 'file-invoice';
                    info.label = 'No PO';
                    info.cssClass = 'po-none';
                    info.tooltip = 'No purchase order linked';
                    break;
                case 6: // Manual
                    info.icon = 'user-check';
                    info.label = 'Manual';
                    info.cssClass = 'po-matched';
                    info.tooltip = 'Manually matched to Purchase Order';
                    break;
                default: // Pending or unknown
                    if (hasPONumber) {
                        info.icon = 'search';
                        info.label = 'Find PO';
                        info.cssClass = 'po-pending';
                        info.tooltip = 'PO reference found - click to match';
                    }
                    break;
            }

            return info;
        },

        /**
         * Render the PO match dropdown panel
         */
        renderPOMatchDropdown: function(doc) {
            if (this.transactionType === 'expensereport') {
                return '';
            }

            var poNumber = doc.poNumber || (doc.extractedData && doc.extractedData.poNumber) || '';
            var matchStatus = parseInt(doc.poMatchStatus) || 0;
            var matchedPO = doc.matchedPO;
            var matchedPONumber = doc.matchedPONumber || '';
            var matchScore = doc.poMatchScore ? Math.round(parseFloat(doc.poMatchScore) * 100) : 0;
            var variance = doc.poVariance || 0;
            var candidates = doc.poCandidates || [];

            var html = '<div class="header-dropdown po-dropdown" id="po-dropdown" style="display:none;">';

            // Header with extracted PO reference
            html += '<div class="po-dropdown-header">' +
                '<div class="po-header-left">' +
                    '<i class="fas fa-file-invoice"></i>' +
                    '<span class="po-header-title">Purchase Order Matching</span>' +
                '</div>' +
                (poNumber ? '<span class="po-extracted-ref" title="Extracted from invoice">Ref: ' + escapeHtml(poNumber) + '</span>' : '') +
            '</div>';

            // Current match status
            if (matchedPO && matchStatus !== 5) {
                var varianceClass = variance > 0 ? 'variance-over' : (variance < 0 ? 'variance-under' : 'variance-ok');
                html += '<div class="po-current-match">' +
                    '<div class="po-match-info">' +
                        '<a href="/app/accounting/transactions/purchord.nl?id=' + matchedPO + '" target="_blank" class="po-link">' +
                            '<i class="fas fa-external-link-alt"></i> ' + escapeHtml(matchedPONumber) +
                        '</a>' +
                        '<span class="po-match-score">' + matchScore + '% match</span>' +
                    '</div>' +
                    (variance !== 0 ? '<div class="po-variance ' + varianceClass + '">' +
                        '<i class="fas fa-' + (variance > 0 ? 'arrow-up' : 'arrow-down') + '"></i> ' +
                        '$' + Math.abs(variance).toFixed(2) + ' variance' +
                    '</div>' : '<div class="po-variance variance-ok"><i class="fas fa-check"></i> Exact match</div>') +
                    '<div class="po-match-actions">' +
                        '<button class="btn btn-sm btn-ghost" id="btn-po-rematch" title="Find different PO">' +
                            '<i class="fas fa-sync-alt"></i> Rematch' +
                        '</button>' +
                        '<button class="btn btn-sm btn-ghost" id="btn-po-clear" title="Remove PO link">' +
                            '<i class="fas fa-unlink"></i> Unlink' +
                        '</button>' +
                    '</div>' +
                '</div>';
            } else {
                // Show search/match interface
                html += '<div class="po-search-section">' +
                    '<div class="po-search-wrapper">' +
                        '<input type="text" id="po-search-input" class="po-search-input" ' +
                            'placeholder="Search by PO number..." value="' + escapeHtml(poNumber) + '">' +
                        '<button class="btn btn-sm btn-primary" id="btn-po-search">' +
                            '<i class="fas fa-search"></i>' +
                        '</button>' +
                    '</div>' +
                '</div>';
            }

            // Candidates list
            html += '<div class="po-candidates-section" id="po-candidates-container">';
            if (candidates.length > 0) {
                html += '<div class="po-candidates-header">Suggested matches</div>';
                html += '<div class="po-candidates-list">';
                candidates.forEach(function(c) {
                    var isSelected = matchedPO && c.id == matchedPO;
                    html += '<div class="po-candidate' + (isSelected ? ' selected' : '') + '" data-po-id="' + c.id + '">' +
                        '<div class="po-candidate-main">' +
                            '<span class="po-candidate-number">' + escapeHtml(c.poNumber) + '</span>' +
                            '<span class="po-candidate-score">' + c.score + '%</span>' +
                        '</div>' +
                        '<div class="po-candidate-details">' +
                            '<span class="po-candidate-total">$' + (c.total || 0).toFixed(2) + '</span>' +
                            '<span class="po-candidate-date">' + (c.poDate || '') + '</span>' +
                        '</div>' +
                        (c.amountVariance !== null ? '<div class="po-candidate-variance">' +
                            'Var: ' + (c.amountVariance >= 0 ? '+' : '') + '$' + (c.amountVariance || 0).toFixed(2) +
                        '</div>' : '') +
                    '</div>';
                });
                html += '</div>';
            } else if (!matchedPO) {
                html += '<div class="po-candidates-empty">' +
                    '<i class="fas fa-search"></i>' +
                    '<p>Click search or enter a PO number to find matches</p>' +
                '</div>';
            }
            html += '</div>';

            // Loading state placeholder
            html += '<div class="po-loading" id="po-loading" style="display:none;">' +
                '<div class="loading-spinner"></div>' +
                '<span>Finding matches...</span>' +
            '</div>';

            html += '</div>';

            return html;
        },

        /**
         * Load PO match data for current document
         */
        loadPOMatchData: function() {
            var self = this;
            var loadingEl = el('#po-loading');
            var candidatesContainer = el('#po-candidates-container');

            if (loadingEl) loadingEl.style.display = 'flex';
            if (candidatesContainer) candidatesContainer.style.display = 'none';

            API.get('pomatch', { id: this.docId })
                .then(function(result) {
                    if (loadingEl) loadingEl.style.display = 'none';
                    if (candidatesContainer) candidatesContainer.style.display = 'block';

                    if (result && result.candidates) {
                        self.data.poCandidates = result.candidates;
                        self.data.poMatchStatus = result.matchStatus;
                        self.data.poMatchScore = result.matchScore;
                        self.updatePOCandidatesUI(result.candidates);
                    }

                    // Update the header indicator
                    self.updatePOIndicator(result);
                })
                .catch(function(err) {
                    if (loadingEl) loadingEl.style.display = 'none';
                    if (candidatesContainer) candidatesContainer.style.display = 'block';
                    console.error('[PO Match] Error:', err);
                    UI.toast('Failed to load PO matches', 'error');
                });
        },

        /**
         * Update PO candidates in the UI
         */
        updatePOCandidatesUI: function(candidates) {
            var container = el('#po-candidates-container');
            if (!container) return;

            if (!candidates || candidates.length === 0) {
                container.innerHTML = '<div class="po-candidates-empty">' +
                    '<i class="fas fa-inbox"></i>' +
                    '<p>No matching POs found for this vendor</p>' +
                '</div>';
                return;
            }

            var matchedPO = this.data.matchedPO;
            var html = '<div class="po-candidates-header">Suggested matches (' + candidates.length + ')</div>';
            html += '<div class="po-candidates-list">';

            candidates.forEach(function(c) {
                var isSelected = matchedPO && c.id == matchedPO;
                html += '<div class="po-candidate' + (isSelected ? ' selected' : '') + '" data-po-id="' + c.id + '">' +
                    '<div class="po-candidate-main">' +
                        '<span class="po-candidate-number">' + escapeHtml(c.poNumber) + '</span>' +
                        '<span class="po-candidate-score">' + c.score + '%</span>' +
                    '</div>' +
                    '<div class="po-candidate-details">' +
                        '<span class="po-candidate-total">$' + (c.total || 0).toFixed(2) + '</span>' +
                        '<span class="po-candidate-date">' + (c.poDate || '') + '</span>' +
                    '</div>' +
                    (c.amountVariance !== null ? '<div class="po-candidate-variance ' +
                        (c.amountVariance > 0 ? 'over' : (c.amountVariance < 0 ? 'under' : 'ok')) + '">' +
                        (c.amountVariance >= 0 ? '+' : '') + '$' + (c.amountVariance || 0).toFixed(2) +
                    '</div>' : '') +
                '</div>';
            });

            html += '</div>';
            container.innerHTML = html;

            // Rebind click events
            this.bindPOCandidateClicks();
        },

        /**
         * Update the PO indicator in the header
         */
        updatePOIndicator: function(matchResult) {
            var indicator = el('#po-match-toggle');
            if (!indicator) return;

            var status = matchResult.matchStatus || 0;
            var score = matchResult.topMatch ? matchResult.topMatch.score : 0;
            var hasPONumber = this.data.poNumber || (this.data.extractedData && this.data.extractedData.poNumber);
            var statusInfo = this.getPOMatchStatusInfo(status, score, hasPONumber);

            // Update classes
            indicator.className = 'header-metric po-metric ' + statusInfo.cssClass;
            indicator.title = statusInfo.tooltip;

            // Update content
            var iconEl = indicator.querySelector('.metric-icon i');
            var labelEl = indicator.querySelector('.metric-label');
            var badgeEl = indicator.querySelector('.metric-badge');

            if (iconEl) iconEl.className = 'fas fa-' + statusInfo.icon;
            if (labelEl) labelEl.textContent = statusInfo.label;

            if (score > 0 && status !== 5) {
                if (badgeEl) {
                    badgeEl.textContent = score;
                    badgeEl.style.display = '';
                } else {
                    var metricIcon = indicator.querySelector('.metric-icon');
                    if (metricIcon) {
                        metricIcon.insertAdjacentHTML('beforeend', '<span class="metric-badge po-badge">' + score + '</span>');
                    }
                }
            } else if (badgeEl) {
                badgeEl.style.display = 'none';
            }
        },

        /**
         * Bind PO candidate click events
         */
        bindPOCandidateClicks: function() {
            var self = this;
            var candidates = document.querySelectorAll('.po-candidate');

            candidates.forEach(function(candidateEl) {
                candidateEl.addEventListener('click', function() {
                    var poId = this.getAttribute('data-po-id');
                    self.confirmPOMatch(poId);
                });
            });
        },

        /**
         * Confirm PO match selection
         */
        confirmPOMatch: function(poId) {
            var self = this;

            // Mark as saving
            UI.toast('Linking to PO...', 'info');

            API.put('confirmmatch', { id: this.docId, poId: poId })
                .then(function(result) {
                    if (result && result.confirmed) {
                        self.data.matchedPO = poId;
                        self.data.poMatchStatus = 6; // Manual

                        // Find the PO number from candidates
                        var candidate = (self.data.poCandidates || []).find(function(c) {
                            return c.id == poId;
                        });
                        if (candidate) {
                            self.data.matchedPONumber = candidate.poNumber;
                            self.data.poMatchScore = candidate.score / 100;
                        }

                        UI.toast('Successfully linked to PO', 'success');

                        // Refresh the dropdown UI
                        self.refreshPODropdown();
                        self.updatePOIndicator({ matchStatus: 6, topMatch: { score: 100 } });
                    }
                })
                .catch(function(err) {
                    console.error('[PO Match] Confirm error:', err);
                    UI.toast('Failed to link PO: ' + err.message, 'error');
                });
        },

        /**
         * Clear PO match
         */
        clearPOMatch: function() {
            var self = this;

            API.put('clearmatch', { id: this.docId })
                .then(function(result) {
                    if (result && result.cleared) {
                        self.data.matchedPO = null;
                        self.data.matchedPONumber = '';
                        self.data.poMatchStatus = 5;
                        self.data.poMatchScore = 0;

                        UI.toast('PO link removed', 'success');

                        self.refreshPODropdown();
                        self.updatePOIndicator({ matchStatus: 5 });
                    }
                })
                .catch(function(err) {
                    console.error('[PO Match] Clear error:', err);
                    UI.toast('Failed to clear PO link', 'error');
                });
        },

        /**
         * Refresh the PO dropdown content
         */
        refreshPODropdown: function() {
            var dropdown = el('#po-dropdown');
            if (dropdown) {
                dropdown.innerHTML = '';
                // Re-render the dropdown content
                var content = this.renderPOMatchDropdown(this.data);
                // Extract inner content (remove outer div)
                var temp = document.createElement('div');
                temp.innerHTML = content;
                var innerContent = temp.querySelector('.po-dropdown');
                if (innerContent) {
                    dropdown.innerHTML = innerContent.innerHTML;
                }
                this.bindPODropdownEvents();
            }
        },

        /**
         * Bind PO dropdown events
         */
        bindPODropdownEvents: function() {
            var self = this;

            // Rematch button
            var rematchBtn = el('#btn-po-rematch');
            if (rematchBtn) {
                rematchBtn.addEventListener('click', function(e) {
                    e.stopPropagation();
                    self.loadPOMatchData();
                });
            }

            // Clear button
            var clearBtn = el('#btn-po-clear');
            if (clearBtn) {
                clearBtn.addEventListener('click', function(e) {
                    e.stopPropagation();
                    self.clearPOMatch();
                });
            }

            // Search button
            var searchBtn = el('#btn-po-search');
            if (searchBtn) {
                searchBtn.addEventListener('click', function(e) {
                    e.stopPropagation();
                    self.loadPOMatchData();
                });
            }

            // Search input enter key
            var searchInput = el('#po-search-input');
            if (searchInput) {
                searchInput.addEventListener('keypress', function(e) {
                    if (e.key === 'Enter') {
                        e.preventDefault();
                        self.loadPOMatchData();
                    }
                });
            }

            // Candidate clicks
            this.bindPOCandidateClicks();
        },

        /**
         * Render the Extraction Pool as a compact dropdown for the unified header
         */
        renderExtractionPoolDropdown: function() {
            return '<div class="header-dropdown pool-dropdown" id="pool-dropdown" style="display:none;">' +
                this.renderPoolDropdownContent() +
            '</div>';
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
            if (this.extractionPool.showAnnotations) {
                if (this.pageElements && this.pageElements.length > 0) {
                    // Multi-page mode - each page has its own viewport stored
                    this.renderExtractionAnnotations();
                } else if (this.pdfPage && this.pdfCanvas) {
                    // Legacy single-page mode
                    var cssWidth = parseFloat(this.pdfCanvas.style.width) || this.pdfCanvas.clientWidth;
                    var viewport = this.pdfPage.getViewport({
                        scale: cssWidth / this.pdfPage.getViewport({ scale: 1 }).width,
                        rotation: this.rotation
                    });
                    this.renderExtractionAnnotations(viewport);
                }
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

            // Re-render pool panel (legacy)
            if (poolPanel) {
                var newPoolHtml = this.renderExtractionPoolPanel();
                var tempDiv = document.createElement('div');
                tempDiv.innerHTML = newPoolHtml;
                poolPanel.parentNode.replaceChild(tempDiv.firstChild, poolPanel);
            }

            // Re-bind events
            this.bindExtractionPoolEvents();

            // Also refresh unified header pool dropdown
            this.refreshPoolDropdown();
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
            document.querySelectorAll('#btn-toggle-annotations').forEach(function(btn) {
                btn.onclick = function(e) {
                    e.stopPropagation();
                    self.toggleAnnotations();
                };
            });

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
                            if (self.extractionPool.showAnnotations) {
                                if (self.pageElements && self.pageElements.length > 0) {
                                    // Multi-page mode - each page has its own viewport stored
                                    self.renderExtractionAnnotations();
                                } else if (self.pdfPage && self.pdfCanvas) {
                                    // Legacy single-page mode
                                    var cssWidth = parseFloat(self.pdfCanvas.style.width) || self.pdfCanvas.clientWidth;
                                    var viewport = self.pdfPage.getViewport({
                                        scale: cssWidth / self.pdfPage.getViewport({ scale: 1 }).width,
                                        rotation: self.rotation
                                    });
                                    self.renderExtractionAnnotations(viewport);
                                }
                            }
                        }

                        UI.toast('Applied to line item', 'success');
                    } catch (err) {
                        console.error('[ExtractionPool] Sublist drop error:', err);
                    }
                }, true);
            });
        },

        /**
         * Bind AI verification panel events (accept corrections, add missed fields)
         */
        bindAIVerificationEvents: function() {
            var self = this;
            var alertDropdown = el('#alert-details');
            if (!alertDropdown) return;

            // Accept correction buttons
            alertDropdown.querySelectorAll('.btn-accept-correction').forEach(function(btn) {
                btn.onclick = function(e) {
                    e.stopPropagation();
                    var field = btn.dataset.field;
                    var value = btn.dataset.value;

                    if (field && value) {
                        self.applyAICorrection(field, value);
                        // Transform the row to show applied state
                        var row = btn.closest('.alert-row');
                        if (row) {
                            row.classList.remove('alert-actionable', 'alert-high', 'alert-medium', 'alert-low');
                            row.classList.add('alert-applied');
                            row.innerHTML = '<div class="alert-icon"><i class="fas fa-check-circle"></i></div>' +
                                '<div class="alert-body"><div class="alert-title">Applied: ' + field + '</div></div>' +
                                '<div class="alert-tag tag-applied">Applied</div>';
                        }
                    }
                };
            });

            // Ignore correction buttons
            alertDropdown.querySelectorAll('.btn-ignore-correction').forEach(function(btn) {
                btn.onclick = function(e) {
                    e.stopPropagation();
                    var row = btn.closest('.alert-row');
                    if (row) {
                        row.style.height = row.offsetHeight + 'px';
                        row.style.overflow = 'hidden';
                        row.style.transition = 'all 0.2s ease';
                        requestAnimationFrame(function() {
                            row.style.height = '0';
                            row.style.opacity = '0';
                            row.style.padding = '0';
                            row.style.margin = '0';
                        });
                        setTimeout(function() { row.remove(); self.updateAlertBadgeCount(); }, 200);
                    }
                };
            });

            // Add missed field buttons
            alertDropdown.querySelectorAll('.btn-add-missed').forEach(function(btn) {
                btn.onclick = function(e) {
                    e.stopPropagation();
                    var field = btn.dataset.field;
                    var value = btn.dataset.value;

                    if (field && value) {
                        self.applyAICorrection(field, value);
                        // Transform the row to show applied state
                        var row = btn.closest('.alert-row');
                        if (row) {
                            row.classList.remove('alert-actionable', 'alert-high', 'alert-medium', 'alert-low');
                            row.classList.add('alert-applied');
                            row.innerHTML = '<div class="alert-icon"><i class="fas fa-check-circle"></i></div>' +
                                '<div class="alert-body"><div class="alert-title">Added: ' + field + '</div></div>' +
                                '<div class="alert-tag tag-applied">Applied</div>';
                        }
                    }
                };
            });

            // Ignore missed field buttons
            alertDropdown.querySelectorAll('.btn-ignore-missed').forEach(function(btn) {
                btn.onclick = function(e) {
                    e.stopPropagation();
                    var row = btn.closest('.alert-row');
                    if (row) {
                        row.style.height = row.offsetHeight + 'px';
                        row.style.overflow = 'hidden';
                        row.style.transition = 'all 0.2s ease';
                        requestAnimationFrame(function() {
                            row.style.height = '0';
                            row.style.opacity = '0';
                            row.style.padding = '0';
                            row.style.margin = '0';
                        });
                        setTimeout(function() { row.remove(); self.updateAlertBadgeCount(); }, 200);
                    }
                };
            });
        },

        /**
         * Apply an AI correction to a form field
         */
        applyAICorrection: function(fieldName, value) {
            var self = this;

            // Map common AI field names to form field IDs
            var fieldMapping = {
                'invoiceNumber': 'tranid',
                'invoiceDate': 'trandate',
                'dueDate': 'duedate',
                'totalAmount': 'total',
                'subtotal': 'subtotal',
                'taxAmount': 'taxtotal',
                'poNumber': 'custbody_po_number',
                'purchaseOrderNumber': 'custbody_po_number',
                'vendorName': 'vendor',
                'memo': 'memo'
            };

            var formFieldId = fieldMapping[fieldName] || fieldName;

            // Try to find and update the field
            var input = el('#field-' + formFieldId);
            if (!input) {
                // Try data-field attribute
                input = document.querySelector('[data-field="' + formFieldId + '"]');
            }

            if (input) {
                input.value = value;
                input.classList.add('ai-corrected');
                self.changes[formFieldId] = value;
                self.markUnsaved();

                // Flash effect to show the change
                input.style.backgroundColor = 'var(--color-success-light, #d4edda)';
                setTimeout(function() {
                    input.style.backgroundColor = '';
                }, 1500);

                UI.toast('Applied AI correction to ' + fieldName, 'success');
            } else {
                // Field not found - might be a custom field
                UI.toast('Field "' + fieldName + '" not found in form', 'warning');
            }

            self.updateAlertBadgeCount();
        },

        /**
         * Update the alert badge count after accepting/ignoring items
         */
        updateAlertBadgeCount: function() {
            var alertDropdown = el('#alert-details');
            if (!alertDropdown) return;

            // Count remaining actionable items (not applied)
            var actionableRows = alertDropdown.querySelectorAll('.alert-row.alert-actionable').length;
            var alertRows = alertDropdown.querySelectorAll('.alert-row.alert-high, .alert-row.alert-medium, .alert-row.alert-critical').length;
            var totalRemaining = actionableRows + alertRows;

            var toggle = el('#alert-status-toggle');
            var badge = toggle ? toggle.querySelector('.metric-badge') : null;
            var label = toggle ? toggle.querySelector('.metric-label') : null;

            if (totalRemaining === 0) {
                // All issues resolved
                if (badge) badge.textContent = '0';
                if (label) label.textContent = 'Verified';
                if (toggle) {
                    toggle.classList.remove('has-critical');
                    toggle.classList.add('verified-ok');
                }
            } else if (badge) {
                badge.textContent = totalRemaining;
            }
        },

        /**
         * Bind pool chip events in the unified header dropdown
         */
        bindPoolChipEvents: function() {
            var self = this;

            document.querySelectorAll('.pool-chip').forEach(function(chip) {
                // Drag support
                chip.ondragstart = function(e) {
                    self.extractionPool.dragActive = true;
                    e.dataTransfer.effectAllowed = 'copy';
                    e.dataTransfer.setData('text/plain', JSON.stringify({
                        key: chip.dataset.extractionKey,
                        value: chip.dataset.extractionValue,
                        id: chip.dataset.extractionId
                    }));
                    chip.classList.add('dragging');
                    document.body.classList.add('extraction-dragging');
                };

                chip.ondragend = function() {
                    self.extractionPool.dragActive = false;
                    chip.classList.remove('dragging');
                    document.body.classList.remove('extraction-dragging');
                    document.querySelectorAll('.form-field.drop-target').forEach(function(f) {
                        f.classList.remove('drop-target', 'drop-hover');
                    });
                };

                // Locate button
                var locateBtn = chip.querySelector('.chip-locate');
                if (locateBtn) {
                    locateBtn.onclick = function(e) {
                        e.stopPropagation();
                        if (!self.extractionPool.showAnnotations) {
                            self.toggleAnnotations();
                        }
                        var annotation = document.querySelector('.extraction-annotation[data-field-key="' + chip.dataset.extractionKey + '"]');
                        if (annotation) {
                            annotation.scrollIntoView({ behavior: 'smooth', block: 'center' });
                            annotation.classList.add('highlight-pulse');
                            setTimeout(function() { annotation.classList.remove('highlight-pulse'); }, 2000);
                        }
                    };
                }

                // Dismiss button
                var dismissBtn = chip.querySelector('.chip-dismiss');
                if (dismissBtn) {
                    dismissBtn.onclick = function(e) {
                        e.stopPropagation();
                        var key = chip.dataset.extractionKey;
                        self.extractionPool.unmatched = self.extractionPool.unmatched.filter(function(item) {
                            return item.key !== key;
                        });
                        self.refreshPoolDropdown();
                    };
                }

                // Click to select
                chip.onclick = function(e) {
                    if (e.target.closest('.chip-action')) return;

                    var wasSelected = chip.classList.contains('selected');
                    document.querySelectorAll('.pool-chip.selected').forEach(function(c) {
                        c.classList.remove('selected');
                    });

                    if (!wasSelected) {
                        chip.classList.add('selected');
                        self.extractionPool.selectedCardId = chip.dataset.extractionId;
                        document.body.classList.add('extraction-selecting');
                    } else {
                        self.extractionPool.selectedCardId = null;
                        document.body.classList.remove('extraction-selecting');
                    }
                };
            });

            // Toggle annotations button
            document.querySelectorAll('#btn-toggle-annotations').forEach(function(btn) {
                btn.onclick = function() {
                    self.toggleAnnotations();
                };
            });
        },

        /**
         * Refresh the pool dropdown in unified header
         */
        refreshPoolDropdown: function() {
            var dropdown = el('#pool-dropdown');
            if (dropdown) {
                // Re-render the dropdown content
                dropdown.innerHTML = this.renderPoolDropdownContent();

                // Keep annotation toggle state after re-render
                dropdown.querySelectorAll('#btn-toggle-annotations').forEach(function(btn) {
                    btn.classList.toggle('active', this.extractionPool.showAnnotations);
                }, this);
            }

            // Update badge count
            var badge = document.querySelector('#pool-header-toggle .metric-badge');
            if (badge) {
                badge.textContent = this.extractionPool.unmatched.length;
            }

            // Hide toggle if no more items
            if (this.extractionPool.unmatched.length === 0) {
                var toggle = el('#pool-header-toggle');
                if (toggle) toggle.style.display = 'none';
                if (dropdown) dropdown.style.display = 'none';
            }

            this.bindPoolChipEvents();
        },

        /**
         * Render just the inner content of the pool dropdown
         */
        renderPoolDropdownContent: function() {
            var self = this;
            var unmatched = this.extractionPool.unmatched;

            var html = '<div class="pool-dropdown-content">';

            if (unmatched.length === 0) {
                html += '<div class="dropdown-empty">' +
                    '<i class="fas fa-check-circle"></i>' +
                    '<span>All fields matched</span>' +
                '</div>';
            } else {
                html += '<div class="pool-chips" id="pool-chips">';
                unmatched.forEach(function(item) {
                    var confClass = item.confidence >= 0.85 ? 'high' : item.confidence >= 0.6 ? 'medium' : 'low';
                    var displayValue = String(item.value).length > 25 ?
                        String(item.value).substring(0, 25) + '...' : item.value;

                    html += '<div class="pool-chip" draggable="true" ' +
                        'data-extraction-id="' + item.id + '" ' +
                        'data-extraction-key="' + escapeHtml(item.key) + '" ' +
                        'data-extraction-value="' + escapeHtml(item.value) + '">' +
                        '<span class="chip-label">' + escapeHtml(item.label) + '</span>' +
                        '<span class="chip-value">' + escapeHtml(displayValue) + '</span>' +
                        '<span class="chip-conf conf-' + confClass + '">' + Math.round(item.confidence * 100) + '%</span>' +
                        '<button class="chip-action chip-locate" title="Find in document"><i class="fas fa-crosshairs"></i></button>' +
                        '<button class="chip-action chip-dismiss" title="Dismiss"><i class="fas fa-times"></i></button>' +
                    '</div>';
                });
                html += '</div>';
            }

            html += '</div>' +
                '<div class="pool-dropdown-footer">' +
                    '<button class="btn btn-ghost btn-sm" id="btn-toggle-annotations">' +
                        '<i class="fas fa-highlighter"></i> Highlight on Document' +
                    '</button>' +
                '</div>';

            return html;
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
        // SUBLIST COLUMN SETTINGS (Sort, Resize, Persist)
        // ==========================================

        // Get column settings from localStorage
        getSublistColumnSettings: function(sublistId) {
            try {
                var key = 'fc_sublist_cols_' + (this.transactionType || 'vendorbill') + '_' + sublistId;
                var stored = localStorage.getItem(key);
                if (stored) {
                    return JSON.parse(stored);
                }
            } catch (e) {
                FCDebug.log('[View.Review] Error loading column settings:', e);
            }
            return { widths: {}, sort: { field: null, direction: 'asc' } };
        },

        // Save column settings to localStorage
        saveSublistColumnSettings: function(sublistId, settings) {
            try {
                var key = 'fc_sublist_cols_' + (this.transactionType || 'vendorbill') + '_' + sublistId;
                localStorage.setItem(key, JSON.stringify(settings));
            } catch (e) {
                FCDebug.log('[View.Review] Error saving column settings:', e);
            }
        },

        // Sort sublist items by field
        sortSublistItems: function(items, fieldId, direction) {
            if (!items || items.length < 2) return items;

            var sorted = items.slice(); // Clone array
            sorted.sort(function(a, b) {
                var aVal = a[fieldId] || a[fieldId.toLowerCase()] || '';
                var bVal = b[fieldId] || b[fieldId.toLowerCase()] || '';

                // Try numeric comparison first
                var aNum = parseFloat(aVal);
                var bNum = parseFloat(bVal);
                if (!isNaN(aNum) && !isNaN(bNum)) {
                    return direction === 'asc' ? aNum - bNum : bNum - aNum;
                }

                // String comparison
                aVal = String(aVal).toLowerCase();
                bVal = String(bVal).toLowerCase();
                if (aVal < bVal) return direction === 'asc' ? -1 : 1;
                if (aVal > bVal) return direction === 'asc' ? 1 : -1;
                return 0;
            });

            return sorted;
        },

        // Bind sublist column events (sorting and resizing)
        bindSublistColumnEvents: function() {
            var self = this;

            // Only bind once using document-level event delegation
            if (this._sublistColumnEventsBound) return;
            this._sublistColumnEventsBound = true;

            // Use direct event listeners on all elements (not delegated via .on())
            // because .on() only binds to the first matching element

            // Sort on header click - use event delegation from document
            document.addEventListener('click', function(e) {
                var th = e.target.closest('.sortable-header');
                if (!th) return;

                // Ignore if clicking on resize handle
                if (e.target.classList.contains('resize-handle')) return;

                var fieldId = th.dataset.field;
                var sublistId = th.dataset.sublist;
                if (!fieldId || !sublistId) return;

                // Get current settings
                var settings = self.getSublistColumnSettings(sublistId);
                var currentSort = settings.sort || { field: null, direction: 'asc' };

                // Toggle direction if same field, otherwise default to asc
                var newDirection = 'asc';
                if (currentSort.field === fieldId) {
                    newDirection = currentSort.direction === 'asc' ? 'desc' : 'asc';
                }

                // Save new sort state
                settings.sort = { field: fieldId, direction: newDirection };
                self.saveSublistColumnSettings(sublistId, settings);

                // Re-render the sublist
                self.rerenderSublist(sublistId);
            });

            // Resize on drag - use event delegation from document
            document.addEventListener('mousedown', function(e) {
                if (!e.target.classList.contains('resize-handle')) return;

                e.preventDefault();
                e.stopPropagation();

                var handle = e.target;
                var th = handle.closest('th');
                if (!th) return;

                var fieldId = th.dataset.field;
                var sublistId = th.dataset.sublist;
                var table = th.closest('.sublist-table');
                if (!table) return;

                var startX = e.clientX;
                var startWidth = th.offsetWidth;

                // Add resizing class for cursor
                th.classList.add('resizing');
                document.body.style.cursor = 'col-resize';
                document.body.style.userSelect = 'none';

                function onMouseMove(e) {
                    var diff = e.clientX - startX;
                    var newWidth = Math.max(50, startWidth + diff);
                    th.style.width = newWidth + 'px';
                }

                function onMouseUp(e) {
                    document.removeEventListener('mousemove', onMouseMove);
                    document.removeEventListener('mouseup', onMouseUp);

                    th.classList.remove('resizing');
                    document.body.style.cursor = '';
                    document.body.style.userSelect = '';

                    // Save the new width
                    var settings = self.getSublistColumnSettings(sublistId);
                    if (!settings.widths) settings.widths = {};
                    settings.widths[fieldId] = th.offsetWidth;
                    self.saveSublistColumnSettings(sublistId, settings);
                }

                document.addEventListener('mousemove', onMouseMove);
                document.addEventListener('mouseup', onMouseUp);
            });
        },

        // Re-render a specific sublist (after sort, etc.)
        rerenderSublist: function(sublistId) {
            var self = this;
            var container = document.querySelector('.sublist-container[data-sublist="' + sublistId + '"]');
            if (!container) return;

            // Find the sublist definition
            var sublists = (this.formFields && this.formFields.sublists) || [];
            var sublist = sublists.find(function(sl) {
                return (sl.id || '').toLowerCase() === sublistId.toLowerCase();
            });

            if (!sublist) return;

            // Re-render table HTML
            var tableWrapper = container.querySelector('.sublist-table-wrapper');
            if (tableWrapper) {
                var newHtml = this.renderSublistTable(sublist, this.data);
                // Extract just the table wrapper content
                var temp = document.createElement('div');
                temp.innerHTML = newHtml;
                var newWrapper = temp.querySelector('.sublist-table-wrapper');
                var newTotal = temp.querySelector('.line-items-total');

                if (newWrapper) {
                    tableWrapper.innerHTML = newWrapper.innerHTML;
                }

                // Update total too
                var totalEl = container.querySelector('.line-items-total');
                if (totalEl && newTotal) {
                    totalEl.innerHTML = newTotal.innerHTML;
                }
            }

            // Re-bind sublist events
            this.bindSublistEvents();
            this.bindSublistColumnEvents();
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
            this.entitySuggestions = [];
            this.queueIds = [];
            this.queueIndex = -1;
            this.codingSuggestions = { headerDefaults: {}, lineItemSuggestions: [], meta: { hasLearning: false } };
            this.suggestionsApplied = false;
            // Smart Fill cleanup
            this.fillUndoState = null;
            this.fillDragState = null;
            this.hideFillPopover();
            // Image preview cleanup
            this.imageElement = null;
            this.imageNaturalWidth = null;
            this.imageNaturalHeight = null;
            this.imageBaseWidth = null;
        }
    };

    // Register the controller
    Router.register('review',
        function(params) { ReviewController.init(params); },
        function() { ReviewController.cleanup(); }
    );

    FCDebug.log('[View.Review] World-Class Review Loaded');

})();
