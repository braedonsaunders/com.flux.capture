/**
 * Flux Capture - Enhanced Settings View Controller
 * Professional SaaS-style settings with form configuration and hierarchical editor
 */
(function() {
    'use strict';

    var SettingsController = {
        currentFormType: 'vendorbill',
        currentSection: 'source',
        formConfig: null,
        editedConfig: null,
        parsedXml: null,
        xmlSelections: {},
        providerConfig: null,
        currentProvider: 'oci',
        emailInboxConfig: null,

        init: function() {
            renderTemplate('tpl-settings', 'view-container');
            this.bindEvents();
            this.loadGeneralSettings();
            this.loadFormConfig(this.currentFormType);
            this.loadProviderConfig();
        },

        loadGeneralSettings: function() {
            API.get('settings')
                .then(function(result) {
                    var settings = result.data || result;
                    var anomaly = settings.anomalyDetection || {};

                    // Populate form controls with saved values
                    var defaultTypeEl = el('#default-type');
                    if (defaultTypeEl && settings.defaultDocumentType) {
                        defaultTypeEl.value = settings.defaultDocumentType;
                    }

                    var defaultLineSublistEl = el('#default-line-sublist');
                    if (defaultLineSublistEl && settings.defaultLineSublist) {
                        defaultLineSublistEl.value = settings.defaultLineSublist;
                    }

                    var maxPagesEl = el('#max-extraction-pages');
                    if (maxPagesEl && typeof settings.maxExtractionPages !== 'undefined') {
                        maxPagesEl.value = settings.maxExtractionPages;
                    }

                    // Anomaly Detection Settings - Duplicate Detection
                    var setCheckbox = function(id, value) {
                        var elem = el(id);
                        if (elem) elem.checked = value !== false;
                    };
                    var setCheckboxOff = function(id, value) {
                        var elem = el(id);
                        if (elem) elem.checked = value === true;
                    };

                    // Duplicate Detection
                    setCheckbox('#detect-duplicate-invoice', anomaly.detectDuplicateInvoice);
                    setCheckbox('#detect-duplicate-payment', anomaly.detectDuplicatePayment);

                    // Amount Validation
                    setCheckbox('#validate-line-items-total', anomaly.validateLineItemsTotal);
                    setCheckbox('#validate-subtotal-tax', anomaly.validateSubtotalTax);
                    setCheckbox('#validate-positive-amounts', anomaly.validatePositiveAmounts);
                    setCheckboxOff('#detect-round-amounts', anomaly.detectRoundAmounts); // Default OFF
                    setCheckbox('#detect-amount-outlier', anomaly.detectAmountOutlier);

                    // Date Validation
                    setCheckbox('#validate-future-date', anomaly.validateFutureDate);
                    setCheckbox('#validate-due-date-sequence', anomaly.validateDueDateSequence);
                    setCheckbox('#validate-stale-date', anomaly.validateStaleDate);
                    setCheckbox('#detect-unusual-terms', anomaly.detectUnusualTerms);

                    // Vendor Validation
                    setCheckbox('#detect-vendor-not-found', anomaly.detectVendorNotFound);
                    setCheckbox('#detect-low-vendor-confidence', anomaly.detectLowVendorConfidence);
                    setCheckbox('#detect-invoice-format-change', anomaly.detectInvoiceFormatChange);

                    // Required Fields
                    setCheckbox('#require-invoice-number', anomaly.requireInvoiceNumber);
                    setCheckbox('#require-total-amount', anomaly.requireTotalAmount);
                })
                .catch(function(err) {
                    console.warn('Could not load settings:', err);
                });
        },

        bindEvents: function() {
            var self = this;

            // Settings main tabs
            els('.settings-nav-tab').forEach(function(tab) {
                tab.addEventListener('click', function() {
                    var targetTab = this.dataset.settingsTab;
                    self.switchSettingsTab(targetTab);
                });
            });

            // Save button
            var saveBtn = el('#btn-save-settings');
            if (saveBtn) {
                saveBtn.addEventListener('click', function() {
                    self.saveSettings();
                });
            }

            // Clear form layout cache button
            var clearCacheBtn = el('#btn-clear-cache');
            if (clearCacheBtn) {
                clearCacheBtn.addEventListener('click', function() {
                    self.clearFormCache();
                });
            }

            // Clear datasource cache button
            var clearDsBtn = el('#btn-clear-datasource-cache');
            if (clearDsBtn) {
                clearDsBtn.addEventListener('click', function() {
                    self.clearDatasourceCache();
                });
            }

            // Form config tab switching (vendorbill/expensereport)
            els('.config-tab').forEach(function(tab) {
                tab.addEventListener('click', function() {
                    els('.config-tab').forEach(function(t) { t.classList.remove('active'); });
                    this.classList.add('active');
                    self.currentFormType = this.dataset.type;
                    self.loadFormConfig(self.currentFormType);
                });
            });

            // Section tab switching (source/editor)
            els('.section-tab').forEach(function(tab) {
                tab.addEventListener('click', function() {
                    els('.section-tab').forEach(function(t) { t.classList.remove('active'); });
                    this.classList.add('active');
                    self.currentSection = this.dataset.section;
                    self.showSection(self.currentSection);
                });
            });

            // XML source option selection
            var xmlOption = el('#source-option-xml');
            if (xmlOption) {
                xmlOption.addEventListener('click', function(e) {
                    if (!e.target.closest('button')) {
                        self.selectSourceOption('xml');
                    }
                });
            }

            // XML upload handlers
            var xmlInput = el('#xml-file-input');
            var browseBtn = el('#btn-browse-xml');
            var dropZone = el('#xml-drop-zone');

            if (browseBtn && xmlInput) {
                browseBtn.addEventListener('click', function(e) {
                    e.preventDefault();
                    e.stopPropagation();
                    xmlInput.click();
                });
            }

            if (xmlInput) {
                xmlInput.addEventListener('change', function() {
                    if (this.files.length > 0) {
                        self.handleXmlUpload(this.files[0]);
                    }
                });
            }

            if (dropZone) {
                dropZone.addEventListener('dragover', function(e) {
                    e.preventDefault();
                    this.classList.add('drag-over');
                });
                dropZone.addEventListener('dragleave', function() {
                    this.classList.remove('drag-over');
                });
                dropZone.addEventListener('drop', function(e) {
                    e.preventDefault();
                    this.classList.remove('drag-over');
                    if (e.dataTransfer.files.length > 0) {
                        self.handleXmlUpload(e.dataTransfer.files[0]);
                    }
                });
            }

            // XML selection controls
            var selectAllBtn = el('#btn-xml-select-all');
            var selectNoneBtn = el('#btn-xml-select-none');
            var importSelectedBtn = el('#btn-import-selected-xml');

            if (selectAllBtn) {
                selectAllBtn.addEventListener('click', function() {
                    self.selectAllXmlItems(true);
                });
            }
            if (selectNoneBtn) {
                selectNoneBtn.addEventListener('click', function() {
                    self.selectAllXmlItems(false);
                });
            }
            if (importSelectedBtn) {
                importSelectedBtn.addEventListener('click', function() {
                    self.importSelectedXmlConfig();
                });
            }

            // Refresh capture status
            var refreshBtn = el('#btn-refresh-capture');
            if (refreshBtn) {
                refreshBtn.addEventListener('click', function() {
                    self.loadFormConfig(self.currentFormType);
                });
            }

            // Trigger capture (open form)
            var triggerBtn = el('#btn-trigger-capture');
            if (triggerBtn) {
                triggerBtn.addEventListener('click', function() {
                    self.triggerCapture();
                });
            }

            // Form editor controls
            var expandAllBtn = el('#btn-expand-all');
            var collapseAllBtn = el('#btn-collapse-all');
            var resetConfigBtn = el('#btn-reset-config');
            var saveConfigBtn = el('#btn-save-form-config');
            var deleteAllBtn = el('#btn-delete-all');

            if (expandAllBtn) {
                expandAllBtn.addEventListener('click', function() {
                    self.expandAllEditorNodes(true);
                });
            }
            if (collapseAllBtn) {
                collapseAllBtn.addEventListener('click', function() {
                    self.expandAllEditorNodes(false);
                });
            }
            if (deleteAllBtn) {
                deleteAllBtn.addEventListener('click', function() {
                    self.deleteAllItems();
                });
            }
            if (resetConfigBtn) {
                resetConfigBtn.addEventListener('click', function() {
                    self.resetFormConfig();
                });
            }
            if (saveConfigBtn) {
                saveConfigBtn.addEventListener('click', function() {
                    self.saveFormConfig();
                });
            }

            // Form editor search
            var editorSearchInput = el('#editor-search-input');
            var editorSearchClear = el('#editor-search-clear');

            if (editorSearchInput) {
                var searchTimeout = null;
                editorSearchInput.addEventListener('input', function() {
                    var query = this.value.trim();
                    // Debounce search
                    clearTimeout(searchTimeout);
                    searchTimeout = setTimeout(function() {
                        self.filterEditorNodes(query);
                    }, 150);
                    // Show/hide clear button
                    if (editorSearchClear) {
                        editorSearchClear.style.display = query ? 'flex' : 'none';
                    }
                });
            }
            if (editorSearchClear) {
                editorSearchClear.addEventListener('click', function() {
                    var input = el('#editor-search-input');
                    if (input) {
                        input.value = '';
                        self.filterEditorNodes('');
                        this.style.display = 'none';
                        input.focus();
                    }
                });
            }

            // Show shortcuts
            var shortcutsBtn = el('#btn-show-shortcuts');
            if (shortcutsBtn) {
                shortcutsBtn.addEventListener('click', function() {
                    self.showShortcutsHelp();
                });
            }

            // Provider selection
            els('.provider-option').forEach(function(option) {
                option.addEventListener('click', function() {
                    var provider = this.dataset.provider;
                    self.selectProvider(provider);
                });
            });

            // Provider radio buttons
            els('input[name="provider"]').forEach(function(radio) {
                radio.addEventListener('change', function() {
                    self.selectProvider(this.value);
                });
            });

            // Toggle API key visibility
            var toggleApiKeyBtn = el('#btn-toggle-api-key');
            if (toggleApiKeyBtn) {
                toggleApiKeyBtn.addEventListener('click', function() {
                    var input = el('#azure-api-key');
                    var icon = this.querySelector('i');
                    if (input.type === 'password') {
                        input.type = 'text';
                        icon.classList.remove('fa-eye');
                        icon.classList.add('fa-eye-slash');
                    } else {
                        input.type = 'password';
                        icon.classList.remove('fa-eye-slash');
                        icon.classList.add('fa-eye');
                    }
                });
            }

            // Test Azure connection
            var testAzureBtn = el('#btn-test-azure');
            if (testAzureBtn) {
                testAzureBtn.addEventListener('click', function() {
                    self.testAzureConnection();
                });
            }

            // Toggle Mindee API key visibility
            var toggleMindeeApiKeyBtn = el('#btn-toggle-mindee-api-key');
            if (toggleMindeeApiKeyBtn) {
                toggleMindeeApiKeyBtn.addEventListener('click', function() {
                    var input = el('#mindee-api-key');
                    var icon = this.querySelector('i');
                    if (input.type === 'password') {
                        input.type = 'text';
                        icon.classList.remove('fa-eye');
                        icon.classList.add('fa-eye-slash');
                    } else {
                        input.type = 'password';
                        icon.classList.remove('fa-eye-slash');
                        icon.classList.add('fa-eye');
                    }
                });
            }

            // Test Mindee connection
            var testMindeeBtn = el('#btn-test-mindee');
            if (testMindeeBtn) {
                testMindeeBtn.addEventListener('click', function() {
                    self.testMindeeConnection();
                });
            }

            // Save provider settings
            var saveProviderBtn = el('#btn-save-provider');
            if (saveProviderBtn) {
                saveProviderBtn.addEventListener('click', function() {
                    self.saveProviderSettings();
                });
            }

            // Email inbox buttons
            var copyEmailBtn = el('#btn-copy-email');
            if (copyEmailBtn) {
                copyEmailBtn.addEventListener('click', function() {
                    self.copyEmailAddress();
                });
            }

            var refreshEmailBtn = el('#btn-refresh-email-status');
            if (refreshEmailBtn) {
                refreshEmailBtn.addEventListener('click', function() {
                    self.loadEmailInboxStatus();
                });
            }

            var saveEmailBtn = el('#btn-save-email-address');
            if (saveEmailBtn) {
                saveEmailBtn.addEventListener('click', function() {
                    self.saveEmailAddress();
                });
            }

            // ==========================================
            // LLM (AI VERIFICATION) EVENT BINDINGS
            // ==========================================

            // LLM Enable toggle
            var llmEnabledToggle = el('#llm-enabled');
            if (llmEnabledToggle) {
                llmEnabledToggle.addEventListener('change', function() {
                    self.toggleLLMPanel(this.checked);
                });
            }

            // Toggle LLM API key visibility
            var toggleLlmApiKeyBtn = el('#btn-toggle-llm-api-key');
            if (toggleLlmApiKeyBtn) {
                toggleLlmApiKeyBtn.addEventListener('click', function() {
                    var input = el('#llm-api-key');
                    var icon = this.querySelector('i');
                    if (input.type === 'password') {
                        input.type = 'text';
                        icon.classList.remove('fa-eye');
                        icon.classList.add('fa-eye-slash');
                    } else {
                        input.type = 'password';
                        icon.classList.remove('fa-eye-slash');
                        icon.classList.add('fa-eye');
                    }
                });
            }

            // LLM Trigger mode change - show/hide threshold row
            var llmTriggerMode = el('#llm-trigger-mode');
            if (llmTriggerMode) {
                llmTriggerMode.addEventListener('change', function() {
                    var thresholdRow = el('#llm-threshold-row');
                    if (thresholdRow) {
                        thresholdRow.style.display = this.value === 'smart' ? 'flex' : 'none';
                    }
                });
            }

            // Test LLM connection
            var testLlmBtn = el('#btn-test-llm');
            if (testLlmBtn) {
                testLlmBtn.addEventListener('click', function() {
                    self.testLLMConnection();
                });
            }

            // Save LLM settings
            var saveLlmBtn = el('#btn-save-llm');
            if (saveLlmBtn) {
                saveLlmBtn.addEventListener('click', function() {
                    self.saveLLMSettings();
                });
            }

            // Load LLM config on init
            this.loadLLMConfig();
        },

        // ==========================================
        // SETTINGS TAB MANAGEMENT
        // ==========================================

        switchSettingsTab: function(tabId) {
            // Update tab buttons
            els('.settings-nav-tab').forEach(function(tab) {
                tab.classList.toggle('active', tab.dataset.settingsTab === tabId);
            });

            // Update tab panels
            els('.settings-tab-panel').forEach(function(panel) {
                var panelId = panel.id.replace('settings-panel-', '');
                if (panelId === tabId) {
                    panel.classList.add('active');
                    panel.style.display = 'block';
                } else {
                    panel.classList.remove('active');
                    panel.style.display = 'none';
                }
            });

            // Load data for specific tabs on first activation
            if (tabId === 'extraction' && !this.providerConfig) {
                this.loadProviderConfig();
            } else if (tabId === 'forms' && !this.formConfig) {
                this.loadFormConfig(this.currentFormType);
            } else if (tabId === 'email' && !this.emailInboxConfig) {
                this.loadEmailInboxStatus();
            }
        },

        // ==========================================
        // SECTION MANAGEMENT
        // ==========================================

        showSection: function(section) {
            var sourcePanel = el('#section-source');
            var editorPanel = el('#section-editor');

            if (section === 'source') {
                if (sourcePanel) sourcePanel.style.display = 'block';
                if (editorPanel) editorPanel.style.display = 'none';
            } else {
                if (sourcePanel) sourcePanel.style.display = 'none';
                if (editorPanel) editorPanel.style.display = 'block';
                this.renderFormEditor();
            }
        },

        // ==========================================
        // FORM CONFIGURATION
        // ==========================================

        selectSourceOption: function(type) {
            var xmlOption = el('#source-option-xml');
            var xmlControls = el('#xml-controls');

            // XML upload is the only option now
            if (xmlOption) xmlOption.classList.add('selected');
            if (xmlControls) xmlControls.style.display = 'block';
        },

        loadFormConfig: function(type) {
            var self = this;

            API.get('formschema', { transactionType: type })
                .then(function(result) {
                    self.formConfig = result.data || result;
                    self.editedConfig = JSON.parse(JSON.stringify(self.formConfig)); // Deep clone
                    self.updateCaptureStatus();
                    if (self.currentSection === 'editor') {
                        self.renderFormEditor();
                    }
                })
                .catch(function(err) {
                    console.error('Error loading form config:', err);
                    self.formConfig = null;
                    self.editedConfig = null;
                    self.updateCaptureStatus();
                });
        },

        updateCaptureStatus: function() {
            var statusText = el('#capture-status-text');
            var statusIcon = el('#capture-status-icon');

            if (!statusText || !statusIcon) return;

            if (!this.formConfig) {
                statusText.textContent = 'No form configuration found';
                statusIcon.innerHTML = '<i class="fas fa-exclamation-triangle" style="color:var(--color-warning);"></i>';
                return;
            }

            // Check for captured timestamp in multiple locations
            var capturedAt = this.formConfig.capturedAt ||
                            this.formConfig.lastModified ||
                            (this.formConfig.layout && this.formConfig.layout.capturedAt) ||
                            (this.formConfig.layout && this.formConfig.layout.lastModified);

            // Check source for display
            var source = this.formConfig.source ||
                        (this.formConfig.layout && this.formConfig.layout.source) ||
                        'unknown';

            if (capturedAt) {
                var date = new Date(capturedAt);
                var timeAgo = this.getTimeAgo(date);
                var sourceLabel = source === 'client_capture' ? 'captured' :
                                 source === 'xml_upload' ? 'uploaded' :
                                 source === 'manual' ? 'configured' : 'updated';
                statusText.textContent = 'Last ' + sourceLabel + ': ' + timeAgo;
                statusIcon.innerHTML = '<i class="fas fa-check-circle" style="color:var(--color-success);"></i>';
            } else if (this.formConfig.tabs && this.formConfig.tabs.length > 0) {
                statusText.textContent = 'Configuration loaded (using defaults)';
                statusIcon.innerHTML = '<i class="fas fa-info-circle" style="color:var(--color-primary);"></i>';
            } else if (this.formConfig.layout && this.formConfig.layout.tabs) {
                statusText.textContent = 'Layout available (from ' + source + ')';
                statusIcon.innerHTML = '<i class="fas fa-check-circle" style="color:var(--color-success);"></i>';
            } else {
                statusText.textContent = 'No form configuration yet. Upload XML or enable capture.';
                statusIcon.innerHTML = '<i class="fas fa-clock" style="color:var(--text-tertiary);"></i>';
            }
        },

        getTimeAgo: function(date) {
            var now = new Date();
            var diff = now - date;
            var mins = Math.floor(diff / 60000);
            var hours = Math.floor(diff / 3600000);
            var days = Math.floor(diff / 86400000);

            if (mins < 1) return 'just now';
            if (mins < 60) return mins + ' minute' + (mins === 1 ? '' : 's') + ' ago';
            if (hours < 24) return hours + ' hour' + (hours === 1 ? '' : 's') + ' ago';
            if (days < 7) return days + ' day' + (days === 1 ? '' : 's') + ' ago';
            return date.toLocaleDateString();
        },

        // ==========================================
        // XML UPLOAD WITH SELECTION
        // ==========================================

        handleXmlUpload: function(file) {
            var self = this;

            if (!file.name.endsWith('.xml')) {
                UI.toast('Please select an XML file', 'error');
                return;
            }

            var reader = new FileReader();
            reader.onload = function(e) {
                try {
                    self.parsedXml = self.parseFormXml(e.target.result);
                    self.showXmlSelectionPanel();
                } catch (err) {
                    UI.toast('Error parsing XML: ' + err.message, 'error');
                    console.error('XML parse error:', err);
                }
            };
            reader.readAsText(file);
        },

        parseFormXml: function(xmlString) {
            var parser = new DOMParser();
            var doc = parser.parseFromString(xmlString, 'text/xml');

            var parseError = doc.querySelector('parsererror');
            if (parseError) {
                throw new Error('Invalid XML format');
            }

            var form = doc.querySelector('transactionForm');
            if (!form) {
                throw new Error('Not a valid NetSuite form XML (missing transactionForm element)');
            }

            var result = {
                formInfo: {
                    scriptId: form.getAttribute('scriptid'),
                    standard: form.getAttribute('standard'),
                    name: this.getXmlText(form, 'name'),
                    recordType: this.getXmlText(form, 'recordType'),
                    source: 'xml_upload'
                },
                tabs: [],
                sublists: []
            };

            // Parse main fields into first tab
            var mainTab = { id: 'main', label: 'Main', order: 0, fieldGroups: [] };
            var self = this;

            // Parse named field groups in mainFields
            var fieldGroups = doc.querySelectorAll('mainFields > fieldGroup');
            fieldGroups.forEach(function(fg, idx) {
                // Fields are inside <fields position="..."> wrapper
                var fieldsContainer = fg.querySelector('fields');
                if (fieldsContainer) {
                    var fields = self.parseXmlFields(fieldsContainer);
                    if (fields.length > 0) {
                        mainTab.fieldGroups.push({
                            id: fg.getAttribute('scriptid') || 'group_' + idx,
                            label: self.getXmlText(fg, 'label') || 'Field Group ' + (idx + 1),
                            order: idx,
                            visible: self.getXmlText(fg, 'visible') !== 'F',
                            fields: fields
                        });
                    }
                }
            });

            // Parse default field group in mainFields
            var defaultGroup = doc.querySelector('mainFields > defaultFieldGroup');
            if (defaultGroup) {
                var fieldsContainer = defaultGroup.querySelector('fields');
                if (fieldsContainer) {
                    var defaultFields = self.parseXmlFields(fieldsContainer);
                    if (defaultFields.length > 0) {
                        mainTab.fieldGroups.push({
                            id: 'default',
                            label: 'Other Fields',
                            order: 999,
                            visible: true,
                            fields: defaultFields
                        });
                    }
                }
            }

            if (mainTab.fieldGroups.length > 0) {
                result.tabs.push(mainTab);
            }

            // Parse additional tabs
            var tabs = doc.querySelectorAll('tabs > tab');
            tabs.forEach(function(tab, idx) {
                result.tabs.push(self.parseXmlTab(tab, idx + 1));
            });

            // Parse sublists
            var sublists = doc.querySelectorAll('subList');
            sublists.forEach(function(sl) {
                result.sublists.push(self.parseXmlSublist(sl));
            });

            return result;
        },

        getXmlText: function(parent, tagName) {
            var element = parent.querySelector(tagName);
            return element ? element.textContent.trim() : '';
        },

        parseXmlFieldGroup: function(element, order) {
            // Fields are inside <fields position="..."> wrapper
            var fieldsContainer = element.querySelector('fields');
            var fields = fieldsContainer ? this.parseXmlFields(fieldsContainer) : [];

            return {
                id: element.getAttribute('scriptid') || 'group_' + order,
                label: this.getXmlText(element, 'label') || 'Field Group ' + (order + 1),
                order: order,
                visible: this.getXmlText(element, 'visible') !== 'F',
                fields: fields
            };
        },

        // Detect checkbox fields using checkBoxDefault element or naming heuristics
        // NetSuite's form XML doesn't include field type metadata for native fields
        isCheckboxField: function(fieldId, checkBoxDefault) {
            // Explicit checkbox indicator from XML
            if (checkBoxDefault) return true;

            // Normalize field ID (strip scriptid brackets, lowercase)
            var cleanId = (fieldId || '').replace(/^\[.*?scriptid=([^\]]+)\]$/, '$1')
                                         .replace(/^\[.*?\]$/, '')
                                         .toLowerCase();

            // Common checkbox field patterns (exact matches)
            var checkboxPatterns = [
                'paymenthold', 'tobepaid', 'tobeemailed', 'tobeprinted', 'tobefaxed',
                'taxable', 'billable', 'closed', 'complete', 'approved', 'isbasecurrency',
                'landedcostperline', 'excludefromglnumbering', 'ismultishipto'
            ];
            if (checkboxPatterns.indexOf(cleanId) !== -1) return true;

            // Heuristic: fields starting with 'is', 'has', or 'tobe' are typically booleans
            if (/^(is|has|tobe|include|exclude)/.test(cleanId)) return true;

            // Heuristic: fields ending with common boolean suffixes
            if (/(_flag|_yn|_bool|_checkbox)$/.test(cleanId)) return true;

            return false;
        },

        parseXmlFields: function(container) {
            var self = this;
            var fields = [];

            // Parse <field> elements - ID is a child element <id>FIELDID</id>
            container.querySelectorAll('field').forEach(function(f) {
                // Get ID from <id> child element first, then try scriptid attribute
                var id = self.getXmlText(f, 'id') || f.getAttribute('scriptid') || f.getAttribute('id');

                if (!id) return;

                // Detect checkbox type from checkBoxDefault element or known native fields
                var checkBoxDefault = self.getXmlText(f, 'checkBoxDefault');
                var fieldType = self.isCheckboxField(id, checkBoxDefault) ? 'checkbox' : 'text';

                var fieldObj = {
                    id: id,
                    label: self.getXmlText(f, 'label') || id,
                    visible: self.getXmlText(f, 'visible') !== 'F',
                    mandatory: self.getXmlText(f, 'mandatory') === 'T',
                    displayType: self.getXmlText(f, 'displayType') || 'NORMAL',
                    type: fieldType
                };

                // Store checkbox default value if present
                if (checkBoxDefault) {
                    fieldObj.checkBoxDefault = checkBoxDefault;
                }

                fields.push(fieldObj);
            });

            return fields;
        },

        parseXmlTab: function(element, order) {
            var self = this;

            // Tab ID is a child element <id>TABID</id>, not an attribute
            var tabId = this.getXmlText(element, 'id') || element.getAttribute('scriptid') || 'tab_' + order;

            var tab = {
                id: tabId,
                label: this.getXmlText(element, 'label') || 'Tab ' + order,
                order: order,
                fieldGroups: [],
                sublists: []
            };

            // Parse named fieldGroups (may have fields inside or be empty containers)
            element.querySelectorAll('fieldGroups > fieldGroup[scriptid]').forEach(function(fg, idx) {
                var parsed = self.parseXmlFieldGroup(fg, tab.fieldGroups.length);
                if (parsed.fields && parsed.fields.length > 0) {
                    tab.fieldGroups.push(parsed);
                }
            });

            // Parse defaultFieldGroup which contains actual fields in <fields position="...">
            var defaultFieldGroup = element.querySelector('fieldGroups > defaultFieldGroup');
            if (defaultFieldGroup) {
                var fieldsContainer = defaultFieldGroup.querySelector('fields');
                if (fieldsContainer) {
                    var fields = self.parseXmlFields(fieldsContainer);
                    if (fields.length > 0) {
                        tab.fieldGroups.push({
                            id: tabId + '_default',
                            label: 'Fields',
                            order: tab.fieldGroups.length,
                            visible: true,
                            fields: fields
                        });
                    }
                }
            }

            // Also check for fieldGroup elements that directly contain fields
            element.querySelectorAll('fieldGroups > fieldGroup:not([scriptid])').forEach(function(fg) {
                var fieldsContainer = fg.querySelector('fields');
                if (fieldsContainer) {
                    var fields = self.parseXmlFields(fieldsContainer);
                    if (fields.length > 0) {
                        tab.fieldGroups.push({
                            id: tabId + '_group_' + tab.fieldGroups.length,
                            label: self.getXmlText(fg, 'label') || 'Fields',
                            order: tab.fieldGroups.length,
                            visible: self.getXmlText(fg, 'visible') !== 'F',
                            fields: fields
                        });
                    }
                }
            });

            // Parse sublists from <subItems><subList> structure
            element.querySelectorAll('subItems > subList').forEach(function(sl) {
                var slId = self.getXmlText(sl, 'id') || sl.getAttribute('scriptid');
                if (slId) {
                    tab.sublists.push(slId);
                }
            });

            return tab;
        },

        parseXmlSublist: function(element) {
            var self = this;
            var columns = [];

            // Parse columns - look inside <columns> wrapper
            element.querySelectorAll('columns > column').forEach(function(col) {
                var colId = self.getXmlText(col, 'id') || col.getAttribute('scriptid');
                if (colId) {
                    // Detect checkbox type from checkBoxDefault element or known native fields
                    var checkBoxDefault = self.getXmlText(col, 'checkBoxDefault');
                    var colType = self.isCheckboxField(colId, checkBoxDefault) ? 'checkbox' : 'text';

                    var colObj = {
                        id: colId,
                        label: self.getXmlText(col, 'label') || colId,
                        visible: self.getXmlText(col, 'visible') !== 'F',
                        type: colType
                    };

                    // Store checkbox default value if present
                    if (checkBoxDefault) {
                        colObj.checkBoxDefault = checkBoxDefault;
                    }

                    columns.push(colObj);
                }
            });

            // Sublist ID is a child element <id>SUBLISTID</id>
            var sublistId = this.getXmlText(element, 'id') || element.getAttribute('scriptid');

            return {
                id: sublistId,
                label: this.getXmlText(element, 'label') || sublistId,
                columns: columns
            };
        },

        showXmlSelectionPanel: function() {
            var dropZone = el('#xml-drop-zone');
            var selectionPanel = el('#xml-selection-panel');
            var selectionList = el('#xml-selection-list');

            if (dropZone) dropZone.style.display = 'none';
            if (selectionPanel) selectionPanel.style.display = 'block';

            if (!selectionList || !this.parsedXml) return;

            // Initialize selections - all selected by default
            this.xmlSelections = {};
            var html = '';

            // Tabs
            if (this.parsedXml.tabs && this.parsedXml.tabs.length > 0) {
                html += '<div class="xml-selection-group">';
                html += '<div class="selection-group-header"><i class="fas fa-folder"></i> Tabs</div>';

                this.parsedXml.tabs.forEach(function(tab, idx) {
                    var key = 'tab_' + idx;
                    this.xmlSelections[key] = true;

                    var fieldCount = 0;
                    if (tab.fieldGroups) {
                        tab.fieldGroups.forEach(function(g) {
                            if (g.fields) fieldCount += g.fields.length;
                        });
                    }

                    html += '<label class="xml-selection-item">' +
                        '<input type="checkbox" data-key="' + key + '" checked>' +
                        '<span class="item-label">' + escapeHtml(tab.label || tab.id) + '</span>' +
                        '<span class="item-meta">' + fieldCount + ' fields</span>' +
                        '</label>';
                }, this);

                html += '</div>';
            }

            // Sublists
            if (this.parsedXml.sublists && this.parsedXml.sublists.length > 0) {
                html += '<div class="xml-selection-group">';
                html += '<div class="selection-group-header"><i class="fas fa-table"></i> Sublists</div>';

                this.parsedXml.sublists.forEach(function(sl, idx) {
                    var key = 'sublist_' + idx;
                    this.xmlSelections[key] = true;

                    var colCount = sl.columns ? sl.columns.length : 0;

                    html += '<label class="xml-selection-item">' +
                        '<input type="checkbox" data-key="' + key + '" checked>' +
                        '<span class="item-label">' + escapeHtml(sl.label || sl.id) + '</span>' +
                        '<span class="item-meta">' + colCount + ' columns</span>' +
                        '</label>';
                }, this);

                html += '</div>';
            }

            selectionList.innerHTML = html;

            // Bind checkbox events
            var self = this;
            selectionList.querySelectorAll('input[type="checkbox"]').forEach(function(cb) {
                cb.addEventListener('change', function() {
                    self.xmlSelections[this.dataset.key] = this.checked;
                    self.updateXmlSizeEstimate();
                });
            });

            this.updateXmlSizeEstimate();
        },

        selectAllXmlItems: function(selected) {
            var selectionList = el('#xml-selection-list');
            if (!selectionList) return;

            var self = this;
            selectionList.querySelectorAll('input[type="checkbox"]').forEach(function(cb) {
                cb.checked = selected;
                self.xmlSelections[cb.dataset.key] = selected;
            });

            this.updateXmlSizeEstimate();
        },

        updateXmlSizeEstimate: function() {
            var indicator = el('#xml-size-indicator');
            if (!indicator || !this.parsedXml) return;

            // Build selected config
            var selectedConfig = this.buildSelectedConfig();
            var jsonSize = JSON.stringify(selectedConfig).length;
            var sizeKb = (jsonSize / 1024).toFixed(1);

            indicator.innerHTML = '<i class="fas fa-check-circle" style="color:var(--color-success);"></i> Estimated size: ' + sizeKb + ' KB';
        },

        buildSelectedConfig: function() {
            if (!this.parsedXml) return {};

            var config = {
                formInfo: this.parsedXml.formInfo,
                tabs: [],
                sublists: []
            };

            // Include selected tabs
            this.parsedXml.tabs.forEach(function(tab, idx) {
                if (this.xmlSelections['tab_' + idx]) {
                    config.tabs.push(tab);
                }
            }, this);

            // Include selected sublists
            this.parsedXml.sublists.forEach(function(sl, idx) {
                if (this.xmlSelections['sublist_' + idx]) {
                    config.sublists.push(sl);
                }
            }, this);

            return config;
        },

        importSelectedXmlConfig: function() {
            var selectedConfig = this.buildSelectedConfig();
            this.doImportXmlConfig(selectedConfig);
        },

        doImportXmlConfig: function(selectedConfig) {
            var self = this;
            var btn = el('#btn-import-selected-xml');
            if (btn) {
                btn.disabled = true;
                btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Importing...';
            }

            selectedConfig.capturedAt = new Date().toISOString();

            API.put('formconfig', {
                transactionType: this.currentFormType,
                config: selectedConfig,
                source: 'xml_upload'
            }).then(function() {
                if (btn) {
                    btn.disabled = false;
                    btn.innerHTML = '<i class="fas fa-upload"></i> Import Selected';
                }
                UI.toast('Form configuration imported successfully!', 'success');
                self.loadFormConfig(self.currentFormType);

                // Reset XML panel
                var dropZone = el('#xml-drop-zone');
                var selectionPanel = el('#xml-selection-panel');
                if (dropZone) dropZone.style.display = 'block';
                if (selectionPanel) selectionPanel.style.display = 'none';
                self.parsedXml = null;
                self.xmlSelections = {};
            }).catch(function(err) {
                if (btn) {
                    btn.disabled = false;
                    btn.innerHTML = '<i class="fas fa-upload"></i> Import Selected';
                }
                UI.toast('Import failed: ' + err.message, 'error');
            });
        },

        // ==========================================
        // FORM EDITOR - HIERARCHICAL VIEW
        // ==========================================

        renderFormEditor: function() {
            var container = el('#form-editor-container');
            if (!container) return;

            // Capture current expand/collapse state before re-rendering
            var editorState = this.captureEditorState();

            var config = this.editedConfig;
            if (!config) {
                container.innerHTML = '<div class="editor-placeholder">' +
                    '<i class="fas fa-exclamation-triangle"></i>' +
                    '<p>No form configuration loaded. Use "Form Source" to capture or upload a form first.</p>' +
                    '</div>';
                return;
            }

            // Get layout data - tabs can be at config.tabs (user config) or config.layout.tabs (cached)
            var layout = config.layout || {};
            var tabs = config.tabs || layout.tabs || [];
            var sublists = config.sublists || layout.sublists || [];
            var bodyFields = config.bodyFields || [];

            var html = '<div class="form-editor-tree">';

            // Form info header - prefer config.formInfo (user config) over layout.formInfo (cached)
            var formInfo = config.formInfo || layout.formInfo || {};
            html += '<div class="editor-form-header">' +
                '<i class="fas fa-file-invoice"></i>' +
                '<span class="form-name">' + escapeHtml(formInfo.name || this.currentFormType) + '</span>' +
                '<span class="form-type">' + escapeHtml(formInfo.recordType || this.currentFormType) + '</span>' +
                '</div>';

            // Tabs section
            if (tabs.length > 0) {
                html += '<div class="editor-section">';
                html += '<div class="section-header" data-toggle="tabs-section">' +
                    '<i class="fas fa-chevron-down toggle-icon"></i>' +
                    '<i class="fas fa-folder"></i>' +
                    '<span>Tabs (' + tabs.length + ')</span>' +
                    '</div>';
                html += '<div class="section-content" id="tabs-section">';

                tabs.forEach(function(tab, tabIdx) {
                    html += this.renderEditorTab(tab, tabIdx);
                }, this);

                html += '</div></div>';
            }

            // Body fields section (if not in tabs)
            if (bodyFields.length > 0) {
                html += '<div class="editor-section">';
                html += '<div class="section-header" data-toggle="bodyfields-section">' +
                    '<i class="fas fa-chevron-down toggle-icon"></i>' +
                    '<i class="fas fa-list-alt"></i>' +
                    '<span>Body Fields (' + bodyFields.length + ')</span>' +
                    '</div>';
                html += '<div class="section-content" id="bodyfields-section">';

                bodyFields.forEach(function(field, idx) {
                    html += this.renderEditorField(field, 'body', idx);
                }, this);

                html += '</div></div>';
            }

            // Sublists section
            if (sublists.length > 0) {
                html += '<div class="editor-section">';
                html += '<div class="section-header" data-toggle="sublists-section">' +
                    '<i class="fas fa-chevron-down toggle-icon"></i>' +
                    '<i class="fas fa-table"></i>' +
                    '<span>Sublists (' + sublists.length + ')</span>' +
                    '</div>';
                html += '<div class="section-content" id="sublists-section">';

                sublists.forEach(function(sublist, idx) {
                    html += this.renderEditorSublist(sublist, idx);
                }, this);

                html += '</div></div>';
            }

            html += '</div>';
            container.innerHTML = html;

            // Bind editor events
            this.bindEditorEvents(container);

            // Restore expand/collapse state after re-rendering
            this.restoreEditorState(editorState);
        },

        renderEditorTab: function(tab, tabIdx) {
            var fieldGroups = tab.fieldGroups || [];
            var fieldCount = 0;
            fieldGroups.forEach(function(g) {
                if (g.fields) fieldCount += g.fields.length;
            });

            var isHidden = tab.visible === false;
            var hiddenClass = isHidden ? ' is-hidden' : '';

            var html = '<div class="editor-node editor-tab' + hiddenClass + '" data-tab-idx="' + tabIdx + '">';
            html += '<div class="node-header" data-toggle="tab-' + tabIdx + '">' +
                '<i class="fas fa-chevron-right toggle-icon"></i>' +
                '<i class="fas fa-folder-open"></i>' +
                '<span class="node-label">' + escapeHtml(tab.label || tab.id) + '</span>' +
                '<span class="node-meta">' + fieldCount + ' fields</span>' +
                '<div class="node-actions">' +
                '<button class="btn-icon" data-action="edit-label" data-type="tab" data-idx="' + tabIdx + '" title="Edit label">' +
                '<i class="fas fa-pencil"></i>' +
                '</button>' +
                '<button class="btn-icon" data-action="toggle-visible" data-type="tab" data-idx="' + tabIdx + '" title="Toggle visibility">' +
                '<i class="fas ' + (tab.visible !== false ? 'fa-eye' : 'fa-eye-slash') + '"></i>' +
                '</button>' +
                '</div>' +
                '</div>';

            html += '<div class="node-content collapsed" id="tab-' + tabIdx + '">';

            // Field groups within tab
            fieldGroups.forEach(function(group, groupIdx) {
                html += this.renderEditorFieldGroup(group, tabIdx, groupIdx);
            }, this);

            html += '</div></div>';
            return html;
        },

        renderEditorFieldGroup: function(group, tabIdx, groupIdx) {
            var fields = group.fields || [];

            var isHidden = group.visible === false;
            var hiddenClass = isHidden ? ' is-hidden' : '';

            var html = '<div class="editor-node editor-group' + hiddenClass + '" data-tab-idx="' + tabIdx + '" data-group-idx="' + groupIdx + '">';
            html += '<div class="node-header" data-toggle="group-' + tabIdx + '-' + groupIdx + '">' +
                '<i class="fas fa-chevron-right toggle-icon"></i>' +
                '<i class="fas fa-layer-group"></i>' +
                '<span class="node-label">' + escapeHtml(group.label || group.id) + '</span>' +
                '<span class="node-meta">' + fields.length + ' fields</span>' +
                '<div class="node-actions">' +
                '<button class="btn-icon" data-action="edit-label" data-type="group" data-tab-idx="' + tabIdx + '" data-idx="' + groupIdx + '" title="Edit label">' +
                '<i class="fas fa-pencil"></i>' +
                '</button>' +
                '<button class="btn-icon" data-action="toggle-visible" data-type="group" data-tab-idx="' + tabIdx + '" data-idx="' + groupIdx + '" title="Toggle visibility">' +
                '<i class="fas ' + (group.visible !== false ? 'fa-eye' : 'fa-eye-slash') + '"></i>' +
                '</button>' +
                '</div>' +
                '</div>';

            html += '<div class="node-content collapsed" id="group-' + tabIdx + '-' + groupIdx + '">';

            fields.forEach(function(field, fieldIdx) {
                html += this.renderEditorField(field, 'tab-' + tabIdx + '-group-' + groupIdx, fieldIdx);
            }, this);

            html += '</div></div>';
            return html;
        },

        renderEditorField: function(field, parentKey, fieldIdx) {
            var typeIcon = this.getFieldTypeIcon(field.type);
            var isHidden = field.visible === false;
            var visibleClass = isHidden ? 'fa-eye-slash' : 'fa-eye';
            var hiddenClass = isHidden ? ' is-hidden' : '';
            var mandatoryBadge = field.mandatory ? '<span class="field-badge mandatory">Required</span>' : '';
            var visibilityBadge = isHidden ? '<span class="field-badge hidden-badge">HIDDEN</span>' : '';
            var defaultBadge = field.defaultValue ? '<span class="field-badge default-badge">Default</span>' : '';

            var html = '<div class="editor-node editor-field' + hiddenClass + '" draggable="true" data-parent="' + parentKey + '" data-field-idx="' + fieldIdx + '">';
            html += '<div class="node-header field-header">' +
                '<i class="fas fa-grip-vertical drag-handle" title="Drag to reorder"></i>' +
                '<i class="fas ' + typeIcon + ' field-type-icon"></i>' +
                '<span class="node-label">' + escapeHtml(field.label || field.id) + '</span>' +
                '<span class="field-id">(' + escapeHtml(field.id) + ')</span>' +
                mandatoryBadge +
                defaultBadge +
                visibilityBadge +
                '<span class="node-meta">' + (field.type || 'text') + '</span>' +
                '<div class="node-actions">' +
                '<button class="btn-icon" data-action="edit-settings" data-type="field" data-parent="' + parentKey + '" data-idx="' + fieldIdx + '" title="Edit field settings">' +
                '<i class="fas fa-cog"></i>' +
                '</button>' +
                '<button class="btn-icon' + (isHidden ? '' : ' btn-icon-active') + '" data-action="toggle-visible" data-type="field" data-parent="' + parentKey + '" data-idx="' + fieldIdx + '" title="' + (isHidden ? 'Show field' : 'Hide field') + '">' +
                '<i class="fas ' + visibleClass + '"></i>' +
                '</button>' +
                '<button class="btn-icon btn-icon-danger" data-action="delete" data-type="field" data-parent="' + parentKey + '" data-idx="' + fieldIdx + '" title="Delete field">' +
                '<i class="fas fa-trash"></i>' +
                '</button>' +
                '</div>' +
                '</div>';
            html += '</div>';
            return html;
        },

        renderEditorSublist: function(sublist, idx) {
            // Handle both 'columns' (from XML) and 'fields' (from server extraction)
            var columns = sublist.columns || sublist.fields || [];

            var html = '<div class="editor-node editor-sublist" data-sublist-idx="' + idx + '">';
            html += '<div class="node-header" data-toggle="sublist-' + idx + '">' +
                '<i class="fas fa-chevron-right toggle-icon"></i>' +
                '<i class="fas fa-table"></i>' +
                '<span class="node-label">' + escapeHtml(sublist.label || sublist.id) + '</span>' +
                '<span class="node-meta">' + columns.length + ' columns</span>' +
                '<div class="node-actions">' +
                '<button class="btn-icon" data-action="edit-label" data-type="sublist" data-idx="' + idx + '" title="Edit label">' +
                '<i class="fas fa-pencil"></i>' +
                '</button>' +
                '</div>' +
                '</div>';

            html += '<div class="node-content collapsed" id="sublist-' + idx + '">';

            columns.forEach(function(col, colIdx) {
                html += this.renderEditorColumn(col, idx, colIdx);
            }, this);

            html += '</div></div>';
            return html;
        },

        renderEditorColumn: function(column, sublistIdx, colIdx) {
            var typeIcon = this.getFieldTypeIcon(column.type);
            var isHidden = column.visible === false;
            var visibleClass = isHidden ? 'fa-eye-slash' : 'fa-eye';
            var hiddenClass = isHidden ? ' is-hidden' : '';
            var visibilityBadge = isHidden ? '<span class="field-badge hidden-badge">HIDDEN</span>' : '';
            var defaultBadge = column.defaultValue ? '<span class="field-badge default-badge">Default</span>' : '';

            var html = '<div class="editor-node editor-column' + hiddenClass + '" draggable="true" data-sublist-idx="' + sublistIdx + '" data-col-idx="' + colIdx + '">';
            html += '<div class="node-header field-header">' +
                '<i class="fas fa-grip-vertical drag-handle" title="Drag to reorder"></i>' +
                '<i class="fas ' + typeIcon + ' field-type-icon"></i>' +
                '<span class="node-label">' + escapeHtml(column.label || column.id) + '</span>' +
                '<span class="field-id">(' + escapeHtml(column.id) + ')</span>' +
                defaultBadge +
                visibilityBadge +
                '<span class="node-meta">' + (column.type || 'text') + '</span>' +
                '<div class="node-actions">' +
                '<button class="btn-icon" data-action="edit-settings" data-type="column" data-sublist-idx="' + sublistIdx + '" data-idx="' + colIdx + '" title="Edit column settings">' +
                '<i class="fas fa-cog"></i>' +
                '</button>' +
                '<button class="btn-icon' + (isHidden ? '' : ' btn-icon-active') + '" data-action="toggle-visible" data-type="column" data-sublist-idx="' + sublistIdx + '" data-idx="' + colIdx + '" title="' + (isHidden ? 'Show column' : 'Hide column') + '">' +
                '<i class="fas ' + visibleClass + '"></i>' +
                '</button>' +
                '<button class="btn-icon btn-icon-danger" data-action="delete" data-type="column" data-sublist-idx="' + sublistIdx + '" data-idx="' + colIdx + '" title="Delete column">' +
                '<i class="fas fa-trash"></i>' +
                '</button>' +
                '</div>' +
                '</div>';
            html += '</div>';
            return html;
        },

        getFieldTypeIcon: function(type) {
            var icons = {
                'text': 'fa-font',
                'textarea': 'fa-align-left',
                'email': 'fa-envelope',
                'phone': 'fa-phone',
                'url': 'fa-link',
                'integer': 'fa-hashtag',
                'float': 'fa-calculator',
                'currency': 'fa-dollar-sign',
                'percent': 'fa-percent',
                'date': 'fa-calendar',
                'datetime': 'fa-calendar-alt',
                'select': 'fa-list',
                'multiselect': 'fa-list-check',
                'checkbox': 'fa-square-check',
                'radio': 'fa-circle-dot',
                'image': 'fa-image',
                'file': 'fa-file'
            };
            return icons[type] || 'fa-input-text';
        },

        /**
         * Capture the current expand/collapse state of all editor sections
         * @returns {Object} Map of section IDs to their collapsed state
         */
        captureEditorState: function() {
            var container = el('#form-editor-container');
            if (!container) return {};

            var state = {};
            container.querySelectorAll('[data-toggle]').forEach(function(header) {
                var targetId = header.dataset.toggle;
                var content = el('#' + targetId);
                if (content) {
                    state[targetId] = content.classList.contains('collapsed');
                }
            });
            return state;
        },

        /**
         * Restore the expand/collapse state of editor sections
         * @param {Object} state - Map of section IDs to their collapsed state
         */
        restoreEditorState: function(state) {
            var container = el('#form-editor-container');
            if (!container || !state) return;

            Object.keys(state).forEach(function(targetId) {
                var content = el('#' + targetId);
                var header = container.querySelector('[data-toggle="' + targetId + '"]');
                var icon = header ? header.querySelector('.toggle-icon') : null;

                if (content) {
                    var isCollapsed = state[targetId];
                    if (isCollapsed) {
                        content.classList.add('collapsed');
                        if (icon) {
                            icon.classList.remove('fa-chevron-down');
                            icon.classList.add('fa-chevron-right');
                        }
                    } else {
                        content.classList.remove('collapsed');
                        if (icon) {
                            icon.classList.remove('fa-chevron-right');
                            icon.classList.add('fa-chevron-down');
                        }
                    }
                }
            });
        },

        bindEditorEvents: function(container) {
            var self = this;

            // Toggle expand/collapse
            container.querySelectorAll('[data-toggle]').forEach(function(header) {
                header.addEventListener('click', function(e) {
                    if (e.target.closest('.node-actions')) return;

                    var targetId = this.dataset.toggle;
                    var content = el('#' + targetId);
                    var icon = this.querySelector('.toggle-icon');

                    if (content) {
                        content.classList.toggle('collapsed');
                        if (icon) {
                            icon.classList.toggle('fa-chevron-right');
                            icon.classList.toggle('fa-chevron-down');
                        }
                    }
                });
            });

            // Action buttons
            container.querySelectorAll('[data-action]').forEach(function(btn) {
                btn.addEventListener('click', function(e) {
                    e.stopPropagation();
                    var action = this.dataset.action;
                    var type = this.dataset.type;

                    if (action === 'toggle-visible') {
                        self.toggleItemVisibility(this, type);
                    } else if (action === 'edit-label') {
                        self.editItemLabel(this, type);
                    } else if (action === 'edit-settings') {
                        self.editFieldSettings(this, type);
                    } else if (action === 'delete') {
                        self.deleteItem(this, type);
                    }
                });
            });

            // Drag and drop reordering for fields and columns
            this.bindDragReorder(container);
        },

        /**
         * Bind drag-and-drop reordering for editor fields and columns
         */
        bindDragReorder: function(container) {
            var self = this;
            var draggedElement = null;
            var draggedType = null; // 'field' or 'column'

            // Get all draggable field and column nodes
            var draggableNodes = container.querySelectorAll('.editor-field[draggable="true"], .editor-column[draggable="true"]');

            draggableNodes.forEach(function(node) {
                // Drag start
                node.addEventListener('dragstart', function(e) {
                    draggedElement = this;
                    draggedType = this.classList.contains('editor-field') ? 'field' : 'column';

                    // Set data for the drag operation
                    e.dataTransfer.effectAllowed = 'move';
                    e.dataTransfer.setData('text/plain', JSON.stringify({
                        type: draggedType,
                        parent: this.dataset.parent,
                        fieldIdx: this.dataset.fieldIdx,
                        sublistIdx: this.dataset.sublistIdx,
                        colIdx: this.dataset.colIdx
                    }));

                    // Add dragging class for visual feedback
                    setTimeout(function() {
                        draggedElement.classList.add('dragging');
                    }, 0);
                });

                // Drag end
                node.addEventListener('dragend', function(e) {
                    this.classList.remove('dragging');
                    draggedElement = null;
                    draggedType = null;

                    // Remove all drop indicators
                    container.querySelectorAll('.drop-indicator').forEach(function(indicator) {
                        indicator.classList.remove('drop-indicator', 'drop-above', 'drop-below');
                    });
                });

                // Drag over
                node.addEventListener('dragover', function(e) {
                    e.preventDefault();
                    e.dataTransfer.dropEffect = 'move';

                    // Only allow drop on same type of element (field on field, column on column)
                    if (!draggedElement) return;

                    var targetIsField = this.classList.contains('editor-field');
                    var targetIsColumn = this.classList.contains('editor-column');

                    if ((draggedType === 'field' && !targetIsField) ||
                        (draggedType === 'column' && !targetIsColumn)) {
                        return;
                    }

                    // For fields, check they have the same parent
                    if (draggedType === 'field' && this.dataset.parent !== draggedElement.dataset.parent) {
                        return;
                    }

                    // For columns, check they're in the same sublist
                    if (draggedType === 'column' && this.dataset.sublistIdx !== draggedElement.dataset.sublistIdx) {
                        return;
                    }

                    // Calculate drop position (above or below)
                    var rect = this.getBoundingClientRect();
                    var midpoint = rect.top + rect.height / 2;
                    var isAbove = e.clientY < midpoint;

                    // Remove previous indicators
                    container.querySelectorAll('.drop-indicator').forEach(function(el) {
                        el.classList.remove('drop-indicator', 'drop-above', 'drop-below');
                    });

                    // Add indicator to current target
                    this.classList.add('drop-indicator', isAbove ? 'drop-above' : 'drop-below');
                });

                // Drag leave
                node.addEventListener('dragleave', function(e) {
                    this.classList.remove('drop-indicator', 'drop-above', 'drop-below');
                });

                // Drop
                node.addEventListener('drop', function(e) {
                    e.preventDefault();
                    e.stopPropagation();

                    if (!draggedElement || draggedElement === this) {
                        return;
                    }

                    // Parse drag data
                    var dragData;
                    try {
                        dragData = JSON.parse(e.dataTransfer.getData('text/plain'));
                    } catch (err) {
                        return;
                    }

                    // Validate same type
                    var targetIsField = this.classList.contains('editor-field');
                    var targetIsColumn = this.classList.contains('editor-column');

                    if ((dragData.type === 'field' && !targetIsField) ||
                        (dragData.type === 'column' && !targetIsColumn)) {
                        return;
                    }

                    // Calculate drop position
                    var rect = this.getBoundingClientRect();
                    var midpoint = rect.top + rect.height / 2;
                    var insertBefore = e.clientY < midpoint;

                    // Perform the reorder
                    if (dragData.type === 'field') {
                        self.reorderField(dragData.parent, parseInt(dragData.fieldIdx), this.dataset.parent, parseInt(this.dataset.fieldIdx), insertBefore);
                    } else if (dragData.type === 'column') {
                        self.reorderColumn(parseInt(dragData.sublistIdx), parseInt(dragData.colIdx), parseInt(this.dataset.sublistIdx), parseInt(this.dataset.colIdx), insertBefore);
                    }

                    // Remove indicators and re-render
                    container.querySelectorAll('.drop-indicator').forEach(function(el) {
                        el.classList.remove('drop-indicator', 'drop-above', 'drop-below');
                    });

                    self.renderFormEditor();
                });
            });
        },

        /**
         * Reorder a field within its parent container
         */
        reorderField: function(fromParent, fromIdx, toParent, toIdx, insertBefore) {
            // Must be same parent for now
            if (fromParent !== toParent) return;

            var fieldsArray = this.getFieldsArrayForParent(fromParent);
            if (!fieldsArray || fromIdx === toIdx) return;

            // Remove from old position
            var field = fieldsArray.splice(fromIdx, 1)[0];

            // Calculate new position
            var newIdx = toIdx;
            if (fromIdx < toIdx) {
                newIdx = insertBefore ? toIdx - 1 : toIdx;
            } else {
                newIdx = insertBefore ? toIdx : toIdx + 1;
            }

            // Insert at new position
            fieldsArray.splice(newIdx, 0, field);

            FCDebug.log('[View.Settings] Reordered field in', fromParent, 'from', fromIdx, 'to', newIdx);
        },

        /**
         * Get the fields array for a given parent key
         */
        getFieldsArrayForParent: function(parentKey) {
            if (!this.editedConfig) return null;

            // Body fields
            if (parentKey === 'body') {
                return this.editedConfig.bodyFields;
            }

            // Tab-group fields (format: tab-X-group-Y)
            var tabGroupMatch = parentKey.match(/^tab-(\d+)-group-(\d+)$/);
            if (tabGroupMatch) {
                var tabIdx = parseInt(tabGroupMatch[1]);
                var groupIdx = parseInt(tabGroupMatch[2]);

                var layout = this.editedConfig.layout || this.editedConfig;
                var tabs = this.editedConfig.tabs || layout.tabs || [];

                if (tabs[tabIdx] && tabs[tabIdx].fieldGroups && tabs[tabIdx].fieldGroups[groupIdx]) {
                    return tabs[tabIdx].fieldGroups[groupIdx].fields;
                }
            }

            return null;
        },

        /**
         * Reorder a column within its sublist
         */
        reorderColumn: function(fromSublistIdx, fromColIdx, toSublistIdx, toColIdx, insertBefore) {
            // Must be same sublist for now
            if (fromSublistIdx !== toSublistIdx) return;

            var sublists = this.editedConfig.sublists || (this.editedConfig.layout && this.editedConfig.layout.sublists) || [];
            var sublist = sublists[fromSublistIdx];
            if (!sublist) return;

            // Handle both 'columns' (from XML) and 'fields' (from server extraction)
            var columns = sublist.columns || sublist.fields;
            if (!columns || fromColIdx === toColIdx) return;

            // Remove from old position
            var column = columns.splice(fromColIdx, 1)[0];

            // Calculate new position
            var newIdx = toColIdx;
            if (fromColIdx < toColIdx) {
                newIdx = insertBefore ? toColIdx - 1 : toColIdx;
            } else {
                newIdx = insertBefore ? toColIdx : toColIdx + 1;
            }

            // Insert at new position
            columns.splice(newIdx, 0, column);

            // Update columnOrder and visibleColumns to match the new order
            // These are used by View.Review to determine column display order
            var visibleColumns = columns.filter(function(c) { return c.visible !== false; });
            sublist.columnOrder = visibleColumns.map(function(c) { return c.id; });
            sublist.visibleColumns = sublist.columnOrder.slice();

            FCDebug.log('[View.Settings] Reordered column in sublist', fromSublistIdx, 'from', fromColIdx, 'to', newIdx);
        },

        toggleItemVisibility: function(btn, type) {
            var item = this.getConfigItem(btn.dataset, type);
            if (item) {
                item.visible = item.visible === false ? true : false;

                // Update the icon without re-rendering
                var icon = btn.querySelector('i');
                if (icon) {
                    icon.classList.toggle('fa-eye');
                    icon.classList.toggle('fa-eye-slash');
                }

                // Update parent node styling for visibility
                var node = btn.closest('.editor-node');
                if (node) {
                    node.classList.toggle('is-hidden', item.visible === false);
                }

                // Update visibility badge for fields
                if (type === 'field') {
                    var header = btn.closest('.node-header');
                    if (header) {
                        var badge = header.querySelector('.hidden-badge');
                        if (item.visible === false && !badge) {
                            var labelSpan = header.querySelector('.node-label');
                            if (labelSpan) {
                                labelSpan.insertAdjacentHTML('afterend', '<span class="field-badge hidden-badge">HIDDEN</span>');
                            }
                        } else if (item.visible !== false && badge) {
                            badge.remove();
                        }
                    }
                }
            }
        },

        deleteItem: function(btn, type) {
            var self = this;
            var dataset = btn.dataset;

            UI.confirm({
                title: 'Delete ' + type.charAt(0).toUpperCase() + type.slice(1),
                message: 'Are you sure you want to delete this ' + type + '? This cannot be undone.',
                confirmText: 'Delete',
                type: 'danger'
            }).then(function(confirmed) {
                if (confirmed) {
                    self.removeConfigItem(dataset, type);
                    self.renderFormEditor();
                    UI.toast(type.charAt(0).toUpperCase() + type.slice(1) + ' deleted', 'success');
                }
            });
        },

        deleteAllItems: function() {
            var self = this;

            if (!this.editedConfig) {
                UI.toast('No configuration to delete', 'error');
                return;
            }

            UI.confirm({
                title: 'Delete All Items',
                message: 'This will delete ALL tabs, field groups, fields, and sublists from the current configuration. This cannot be undone!',
                confirmText: 'Delete All',
                type: 'danger'
            }).then(function(confirmed) {
                if (confirmed) {
                    var layout = self.editedConfig.layout || self.editedConfig;

                    // Clear all tabs
                    if (layout.tabs) {
                        layout.tabs = [];
                    }

                    // Clear sublists
                    if (self.editedConfig.sublists) {
                        self.editedConfig.sublists = [];
                    } else if (layout.sublists) {
                        layout.sublists = [];
                    }

                    // Clear body fields
                    if (self.editedConfig.bodyFields) {
                        self.editedConfig.bodyFields = [];
                    }

                    self.renderFormEditor();
                    UI.toast('All items deleted', 'success');
                }
            });
        },

        removeConfigItem: function(dataset, type) {
            if (!this.editedConfig) return;

            var layout = this.editedConfig.layout || this.editedConfig;
            var tabs = layout.tabs || [];
            var sublists = this.editedConfig.sublists || layout.sublists || [];
            var bodyFields = this.editedConfig.bodyFields || [];

            if (type === 'field') {
                var parent = dataset.parent;
                var idx = parseInt(dataset.idx);

                if (parent === 'body') {
                    bodyFields.splice(idx, 1);
                } else {
                    var parts = parent.split('-');
                    var tabIdx = parseInt(parts[1]);
                    var groupIdx = parseInt(parts[3]);
                    var tab = tabs[tabIdx];
                    if (tab && tab.fieldGroups && tab.fieldGroups[groupIdx] && tab.fieldGroups[groupIdx].fields) {
                        tab.fieldGroups[groupIdx].fields.splice(idx, 1);
                    }
                }
            } else if (type === 'column') {
                var sublistIdx = parseInt(dataset.sublistIdx);
                var colIdx = parseInt(dataset.idx);
                var sublist = sublists[sublistIdx];
                // Handle both 'columns' (from XML) and 'fields' (from server extraction)
                var cols = sublist && (sublist.columns || sublist.fields);
                if (cols) {
                    cols.splice(colIdx, 1);
                }
            } else if (type === 'group') {
                var tabIdx = parseInt(dataset.tabIdx);
                var groupIdx = parseInt(dataset.idx);
                var tab = tabs[tabIdx];
                if (tab && tab.fieldGroups) {
                    tab.fieldGroups.splice(groupIdx, 1);
                }
            } else if (type === 'sublist') {
                sublists.splice(parseInt(dataset.idx), 1);
            } else if (type === 'tab') {
                tabs.splice(parseInt(dataset.idx), 1);
            }
        },

        editItemLabel: function(btn, type) {
            var self = this;
            var item = this.getConfigItem(btn.dataset, type);
            if (!item) return;

            var currentLabel = item.label || item.id || '';

            UI.prompt('Edit Label', 'Enter new label:', currentLabel, function(newLabel) {
                if (newLabel && newLabel !== currentLabel) {
                    item.label = newLabel;
                    self.renderFormEditor(); // Re-render to show changes
                }
            });
        },

        editFieldSettings: function(btn, type) {
            var self = this;
            var item = this.getConfigItem(btn.dataset, type);
            if (!item || (type !== 'field' && type !== 'column')) return;

            var isColumn = type === 'column';
            var sublistIdx = isColumn ? parseInt(btn.dataset.sublistIdx) : null;
            var fieldId = item.id || '';
            var currentLabel = item.label || fieldId;
            var currentDefault = item.defaultValue || '';
            var currentDefaultText = item.defaultValueText || ''; // Display text for select fields
            var fieldType = item.type || 'text';

            // Check if this is a select/typeahead field
            var isSelectField = this.isSelectField(fieldId) || fieldType === 'select' || fieldType === 'multiselect';

            // Check if this is the posting period field (special handling) - only for header fields
            var isPostingPeriod = !isColumn && fieldId.toLowerCase() === 'postingperiod';

            // Modal title and hint based on type
            var modalTitle = isColumn ? 'Column Settings' : 'Field Settings';
            var hintText = isColumn ?
                'This value will be pre-filled when adding new lines.' :
                'This value will be pre-filled when creating new transactions.';

            // Build modal HTML
            var modalHtml = '<div class="modal-overlay" id="field-settings-modal">' +
                '<div class="modal modal-sm">' +
                    '<div class="modal-header">' +
                        '<h3><i class="fas fa-cog"></i> ' + modalTitle + '</h3>' +
                        '<button class="modal-close" id="close-field-settings">&times;</button>' +
                    '</div>' +
                    '<div class="modal-body">' +
                        '<div class="form-field">' +
                            '<label>' + (isColumn ? 'Column' : 'Field') + ' ID</label>' +
                            '<input type="text" value="' + escapeHtml(fieldId) + '" disabled class="input-disabled">' +
                        '</div>' +
                        '<div class="form-field">' +
                            '<label>Label</label>' +
                            '<input type="text" id="field-label-input" value="' + escapeHtml(currentLabel) + '">' +
                        '</div>' +
                        '<div class="form-field">' +
                            '<label>Default Value</label>';

            if (isPostingPeriod) {
                // Special handling for posting period - add "Use Current Period" option
                var isCurrentPeriod = currentDefault === '__CURRENT_PERIOD__';
                var isSpecificPeriod = currentDefault && !isCurrentPeriod;
                var isNone = !currentDefault;

                modalHtml += '<div class="posting-period-options">' +
                    '<label class="radio-option">' +
                        '<input type="radio" name="period-default-type" value="none"' + (isNone ? ' checked' : '') + '>' +
                        '<span class="radio-text">No default</span>' +
                    '</label>' +
                    '<label class="radio-option">' +
                        '<input type="radio" name="period-default-type" value="current"' + (isCurrentPeriod ? ' checked' : '') + '>' +
                        '<span class="radio-text"><i class="fas fa-calendar-check"></i> Use Current Period</span>' +
                        '<span class="hint-badge">Recommended</span>' +
                    '</label>' +
                    '<div class="radio-option-group">' +
                        '<label class="radio-option">' +
                            '<input type="radio" name="period-default-type" value="specific"' + (isSpecificPeriod ? ' checked' : '') + '>' +
                            '<span class="radio-text">Specific period</span>' +
                        '</label>' +
                        '<div class="radio-sub-option default-value-typeahead" data-field="' + fieldId + '" data-lookup="accountingperiods" id="specific-period-wrapper"' + (!isSpecificPeriod ? ' style="display:none;"' : '') + '>' +
                            '<input type="hidden" id="field-default-value" value="' + (isSpecificPeriod ? escapeHtml(currentDefault) : '') + '">' +
                            '<input type="text" class="typeahead-input" id="field-default-display" value="' + (isSpecificPeriod ? escapeHtml(currentDefaultText || currentDefault) : '') + '" placeholder="Search to select period..." autocomplete="off">' +
                            '<div class="typeahead-dropdown"></div>' +
                        '</div>' +
                    '</div>' +
                '</div>';
            } else if (isSelectField) {
                var lookupType = this.getLookupTypeForField(fieldId);
                modalHtml += '<div class="typeahead-select default-value-typeahead" data-field="' + fieldId + '" data-lookup="' + lookupType + '">' +
                    '<input type="hidden" id="field-default-value" value="' + escapeHtml(currentDefault) + '">' +
                    '<input type="text" class="typeahead-input" id="field-default-display" ' +
                        'style="background: #ffffff !important; border: 1px solid #ddd;" ' +
                        'value="' + escapeHtml(currentDefaultText || currentDefault) + '" placeholder="Search to select default..." autocomplete="off">' +
                    '<div class="typeahead-dropdown" style="background: #ffffff;"></div>' +
                '</div>';
            } else if (fieldType === 'date') {
                modalHtml += '<input type="date" id="field-default-value" value="' + escapeHtml(currentDefault) + '">';
            } else if (fieldType === 'checkbox') {
                var isChecked = currentDefault === 'T' || currentDefault === true || currentDefault === 'true';
                modalHtml += '<label class="checkbox-label">' +
                    '<input type="checkbox" id="field-default-value"' + (isChecked ? ' checked' : '') + '>' +
                    ' Default to checked' +
                '</label>';
            } else {
                modalHtml += '<input type="text" id="field-default-value" value="' + escapeHtml(currentDefault) + '" placeholder="Enter default value...">';
            }

            modalHtml += '<p class="field-hint">' + hintText + '</p>' +
                        '</div>' +
                    '</div>' +
                    '<div class="modal-footer">' +
                        '<button class="btn btn-ghost" id="cancel-field-settings">Cancel</button>' +
                        '<button class="btn btn-primary" id="save-field-settings">Save Changes</button>' +
                    '</div>' +
                '</div>' +
            '</div>';

            // Add modal to DOM
            document.body.insertAdjacentHTML('beforeend', modalHtml);

            var modal = el('#field-settings-modal');
            var closeBtn = el('#close-field-settings');
            var cancelBtn = el('#cancel-field-settings');
            var saveBtn = el('#save-field-settings');

            // Trigger visibility animation after DOM insert
            requestAnimationFrame(function() {
                modal.classList.add('visible');
            });

            // Close modal handlers
            var closeModal = function() {
                modal.classList.remove('visible');
                setTimeout(function() {
                    if (modal) modal.remove();
                }, 200);
            };

            closeBtn.addEventListener('click', closeModal);
            cancelBtn.addEventListener('click', closeModal);
            modal.addEventListener('click', function(e) {
                if (e.target === modal) closeModal();
            });

            // Save handler
            saveBtn.addEventListener('click', function() {
                var newLabel = el('#field-label-input').value.trim();
                var defaultValueInput = el('#field-default-value');
                var defaultDisplayInput = el('#field-default-display');
                var newDefault;
                var newDefaultText;

                if (isPostingPeriod) {
                    // Handle posting period radio buttons
                    var selectedType = modal.querySelector('input[name="period-default-type"]:checked');
                    if (selectedType) {
                        if (selectedType.value === 'current') {
                            newDefault = '__CURRENT_PERIOD__';
                            newDefaultText = 'Current Period';
                        } else if (selectedType.value === 'specific') {
                            newDefault = defaultValueInput ? defaultValueInput.value : '';
                            newDefaultText = defaultDisplayInput ? defaultDisplayInput.value : '';
                        } else {
                            // 'none' - clear the default
                            newDefault = '';
                            newDefaultText = '';
                        }
                    }
                } else if (fieldType === 'checkbox') {
                    newDefault = defaultValueInput.checked ? 'T' : 'F';
                } else {
                    newDefault = defaultValueInput ? defaultValueInput.value : '';
                    newDefaultText = defaultDisplayInput ? defaultDisplayInput.value : '';
                }

                // Get employeeData if present (for employee/nextapprover fields)
                var employeeData = null;
                if (defaultValueInput && defaultValueInput.dataset.employeeData) {
                    try {
                        employeeData = JSON.parse(defaultValueInput.dataset.employeeData);
                    } catch (e) {
                        // Ignore parse errors
                    }
                }

                // Update the layout item
                if (newLabel) item.label = newLabel;
                if (newDefault) {
                    item.defaultValue = newDefault;
                    if (newDefaultText && (isSelectField || isPostingPeriod)) {
                        item.defaultValueText = newDefaultText;
                    }
                    if (employeeData) {
                        item.employeeData = employeeData;
                    }
                } else {
                    delete item.defaultValue;
                    delete item.defaultValueText;
                    delete item.employeeData;
                }

                if (isColumn) {
                    // For columns: also update sublistFields (used by Review page)
                    var sublistFields = self.editedConfig.sublistFields || {};
                    var layout = self.editedConfig.layout || self.editedConfig;
                    var sublists = self.editedConfig.sublists || layout.sublists || [];
                    var sublist = sublists[sublistIdx];
                    var sublistId = sublist ? sublist.id : null;

                    if (sublistId && sublistFields[sublistId]) {
                        var slField = sublistFields[sublistId].find(function(f) { return f.id === fieldId; });
                        if (slField) {
                            if (newLabel) slField.label = newLabel;
                            if (newDefault) {
                                slField.defaultValue = newDefault;
                                if (newDefaultText && isSelectField) {
                                    slField.defaultValueText = newDefaultText;
                                }
                                if (employeeData) {
                                    slField.employeeData = employeeData;
                                }
                            } else {
                                delete slField.defaultValue;
                                delete slField.defaultValueText;
                                delete slField.employeeData;
                            }
                        }
                    }
                } else {
                    // For header fields: also update the corresponding field in bodyFields (used by Review page)
                    var bodyFields = self.editedConfig.bodyFields || [];
                    var bodyField = bodyFields.find(function(f) { return f.id === fieldId; });
                    if (bodyField) {
                        if (newLabel) bodyField.label = newLabel;
                        if (newDefault) {
                            bodyField.defaultValue = newDefault;
                            if (newDefaultText && (isSelectField || isPostingPeriod)) {
                                bodyField.defaultValueText = newDefaultText;
                            }
                            if (employeeData) {
                                bodyField.employeeData = employeeData;
                            }
                        } else {
                            delete bodyField.defaultValue;
                            delete bodyField.defaultValueText;
                            delete bodyField.employeeData;
                        }
                    }
                }

                self.renderFormEditor();
                closeModal();
            });

            // Setup posting period radio handlers
            if (isPostingPeriod) {
                var periodRadios = modal.querySelectorAll('input[name="period-default-type"]');
                var specificWrapper = el('#specific-period-wrapper');
                periodRadios.forEach(function(radio) {
                    radio.addEventListener('change', function() {
                        if (this.value === 'specific') {
                            specificWrapper.style.display = 'block';
                        } else {
                            specificWrapper.style.display = 'none';
                        }
                    });
                });
                // Setup typeahead for specific period selection
                self.setupDefaultValueTypeahead(modal, fieldId);
            } else if (isSelectField) {
                // Setup typeahead for other select fields
                self.setupDefaultValueTypeahead(modal, fieldId);
            }
        },

        setupDefaultValueTypeahead: function(modal, fieldId) {
            var self = this;
            var wrapper = modal.querySelector('.default-value-typeahead');
            if (!wrapper) return;

            var input = wrapper.querySelector('.typeahead-input');
            var hiddenInput = wrapper.querySelector('input[type="hidden"]');
            var dropdown = wrapper.querySelector('.typeahead-dropdown');
            var lookupType = wrapper.dataset.lookup;
            var debounceTimer = null;

            input.addEventListener('input', function() {
                var query = this.value.trim();
                if (query.length < 2) {
                    dropdown.style.display = 'none';
                    return;
                }

                clearTimeout(debounceTimer);
                debounceTimer = setTimeout(function() {
                    self.fetchTypeaheadOptions(lookupType, query, function(options) {
                        if (options.length === 0) {
                            dropdown.style.display = 'none';
                            return;
                        }

                        dropdown.innerHTML = options.map(function(opt) {
                            var dataAttrs = 'data-value="' + escapeHtml(opt.value) + '" data-text="' + escapeHtml(opt.text) + '"';
                            // Include employeeData as JSON data attribute for employee/nextapprover fields
                            if (opt.employeeData) {
                                dataAttrs += ' data-employee-data="' + escapeHtml(JSON.stringify(opt.employeeData)) + '"';
                            }
                            return '<div class="typeahead-option" ' + dataAttrs + '>' +
                                escapeHtml(opt.text) + '</div>';
                        }).join('');
                        dropdown.style.display = 'block';
                    });
                }, 300);
            });

            // Handle option selection
            dropdown.addEventListener('click', function(e) {
                var option = e.target.closest('.typeahead-option');
                if (option) {
                    hiddenInput.value = option.dataset.value;
                    input.value = option.dataset.text;
                    // Store employeeData if present
                    if (option.dataset.employeeData) {
                        hiddenInput.dataset.employeeData = option.dataset.employeeData;
                    } else {
                        delete hiddenInput.dataset.employeeData;
                    }
                    dropdown.style.display = 'none';
                }
            });

            // Close on blur
            input.addEventListener('blur', function() {
                setTimeout(function() {
                    dropdown.style.display = 'none';
                }, 200);
            });
        },

        fetchTypeaheadOptions: function(lookupType, query, callback) {
            API.get('datasource', { type: lookupType, query: query, limit: 100 }).then(function(response) {
                var data = response.data || response;
                var options = Array.isArray(data) ? data : (data.options || data.results || []);
                // Normalize to { value, text, employeeData } format
                var normalized = options.map(function(opt) {
                    var result = {
                        value: opt.value || opt.id || opt.internalid,
                        text: opt.text || opt.name || opt.label || opt.value
                    };
                    // Preserve employeeData if present (for employee/nextapprover fields)
                    if (opt.employeeData) {
                        result.employeeData = opt.employeeData;
                    }
                    return result;
                });
                // Sort options alphabetically by text
                normalized.sort(function(a, b) {
                    return (a.text || '').localeCompare(b.text || '');
                });
                callback(normalized);
            }).catch(function() {
                callback([]);
            });
        },

        getLookupTypeForField: function(fieldId) {
            var id = (fieldId || '').toLowerCase();
            if (id === 'entity' || id === 'vendor') return 'vendors';
            if (id === 'subsidiary') return 'subsidiaries';
            if (id === 'department') return 'departments';
            if (id === 'class') return 'classes';
            if (id === 'location') return 'locations';
            if (id === 'account') return 'accounts';
            if (id === 'terms') return 'terms';
            if (id === 'currency') return 'currencies';
            if (id === 'postingperiod') return 'accountingperiods';
            if (id === 'employee' || id === 'nextapprover') return 'employees';
            if (id === 'approvalstatus') return 'approvalstatuses';
            if (id === 'item') return 'items';
            if (id === 'customer') return 'customers';
            if (id === 'job' || id === 'project') return 'projects';
            if (id === 'taxcode') return 'taxcodes';
            if (id === 'category' || id === 'expensecategory') return 'expensecategories';
            if (id === 'projecttask') return 'projecttasks';
            return 'generic';
        },

        isSelectField: function(fieldId) {
            var id = (fieldId || '').toLowerCase();
            var selectFields = [
                'entity', 'vendor', 'subsidiary', 'department', 'class', 'location',
                'account', 'terms', 'currency', 'postingperiod', 'employee', 'nextapprover',
                'approvalstatus', 'item', 'customer', 'nexus', 'taxcode', 'expenseaccount', 'salesrep'
            ];
            return selectFields.indexOf(id) !== -1 || id.indexOf('custbody') === 0;
        },

        getConfigItem: function(dataset, type) {
            if (!this.editedConfig) return null;

            var layout = this.editedConfig.layout || this.editedConfig;
            var tabs = layout.tabs || [];
            var sublists = this.editedConfig.sublists || layout.sublists || [];
            var bodyFields = this.editedConfig.bodyFields || [];

            if (type === 'tab') {
                return tabs[parseInt(dataset.idx)];
            } else if (type === 'group') {
                var tab = tabs[parseInt(dataset.tabIdx)];
                return tab && tab.fieldGroups ? tab.fieldGroups[parseInt(dataset.idx)] : null;
            } else if (type === 'field') {
                var parent = dataset.parent;
                if (parent === 'body') {
                    return bodyFields[parseInt(dataset.idx)];
                } else {
                    var parts = parent.split('-');
                    var tabIdx = parseInt(parts[1]);
                    var groupIdx = parseInt(parts[3]);
                    var tab = tabs[tabIdx];
                    if (tab && tab.fieldGroups && tab.fieldGroups[groupIdx]) {
                        return tab.fieldGroups[groupIdx].fields[parseInt(dataset.idx)];
                    }
                }
            } else if (type === 'sublist') {
                return sublists[parseInt(dataset.idx)];
            } else if (type === 'column') {
                var sublist = sublists[parseInt(dataset.sublistIdx)];
                // Handle both 'columns' (from XML) and 'fields' (from server extraction)
                var cols = sublist && (sublist.columns || sublist.fields);
                return cols ? cols[parseInt(dataset.idx)] : null;
            }
            return null;
        },

        expandAllEditorNodes: function(expand) {
            var container = el('#form-editor-container');
            if (!container) return;

            // Expand/collapse section content (Tabs, Body Fields, Sublists sections)
            container.querySelectorAll('.section-content').forEach(function(content) {
                if (expand) {
                    content.classList.remove('collapsed');
                } else {
                    content.classList.add('collapsed');
                }
            });

            // Expand/collapse node content (individual tabs, groups, sublists)
            container.querySelectorAll('.node-content').forEach(function(content) {
                if (expand) {
                    content.classList.remove('collapsed');
                } else {
                    content.classList.add('collapsed');
                }
            });

            // Update all toggle icons
            container.querySelectorAll('.toggle-icon').forEach(function(icon) {
                icon.classList.remove('fa-chevron-right', 'fa-chevron-down');
                icon.classList.add(expand ? 'fa-chevron-down' : 'fa-chevron-right');
            });
        },

        filterEditorNodes: function(query) {
            var container = el('#form-editor-container');
            if (!container) return;

            // Clear previous search state
            container.querySelectorAll('.search-match, .search-hidden').forEach(function(node) {
                node.classList.remove('search-match', 'search-hidden');
            });

            // If no query, show all and collapse to default state
            if (!query) {
                container.querySelectorAll('.section-content').forEach(function(content) {
                    content.classList.remove('collapsed');
                });
                container.querySelectorAll('.node-content').forEach(function(content) {
                    content.classList.add('collapsed');
                });
                container.querySelectorAll('.section-header .toggle-icon').forEach(function(icon) {
                    icon.classList.remove('fa-chevron-right');
                    icon.classList.add('fa-chevron-down');
                });
                container.querySelectorAll('.node-header .toggle-icon').forEach(function(icon) {
                    icon.classList.remove('fa-chevron-down');
                    icon.classList.add('fa-chevron-right');
                });
                return;
            }

            var lowerQuery = query.toLowerCase();
            var matchedNodes = new Set();

            // Find all matching field/column nodes (leaf nodes)
            container.querySelectorAll('.editor-field, .editor-column').forEach(function(node) {
                var label = node.querySelector('.node-label');
                var fieldId = node.querySelector('.field-id');
                var text = '';

                if (label) text += label.textContent.toLowerCase();
                if (fieldId) text += ' ' + fieldId.textContent.toLowerCase();

                if (text.indexOf(lowerQuery) !== -1) {
                    node.classList.add('search-match');
                    matchedNodes.add(node);

                    // Mark all parent nodes as having a match
                    var parent = node.parentElement;
                    while (parent && parent !== container) {
                        if (parent.classList.contains('editor-node') ||
                            parent.classList.contains('section-content') ||
                            parent.classList.contains('node-content')) {
                            matchedNodes.add(parent);
                        }
                        parent = parent.parentElement;
                    }
                }
            });

            // Also check tabs, groups, and sublist names
            container.querySelectorAll('.editor-tab, .editor-group, .editor-sublist').forEach(function(node) {
                var label = node.querySelector(':scope > .node-header .node-label');
                if (label && label.textContent.toLowerCase().indexOf(lowerQuery) !== -1) {
                    node.classList.add('search-match');
                    matchedNodes.add(node);

                    // Mark all parent nodes
                    var parent = node.parentElement;
                    while (parent && parent !== container) {
                        if (parent.classList.contains('editor-node') ||
                            parent.classList.contains('section-content') ||
                            parent.classList.contains('node-content')) {
                            matchedNodes.add(parent);
                        }
                        parent = parent.parentElement;
                    }
                }
            });

            // Hide non-matching leaf nodes
            container.querySelectorAll('.editor-field, .editor-column').forEach(function(node) {
                if (!matchedNodes.has(node)) {
                    node.classList.add('search-hidden');
                }
            });

            // Hide non-matching parent nodes (tabs, groups, sublists) that have no matching children
            container.querySelectorAll('.editor-tab, .editor-group, .editor-sublist').forEach(function(node) {
                if (!matchedNodes.has(node)) {
                    node.classList.add('search-hidden');
                }
            });

            // Expand all sections that have matches
            container.querySelectorAll('.section-content').forEach(function(content) {
                var hasMatch = content.querySelector('.search-match') ||
                               content.querySelector('.editor-node:not(.search-hidden)');
                if (hasMatch) {
                    content.classList.remove('collapsed');
                    var header = content.previousElementSibling;
                    if (header && header.classList.contains('section-header')) {
                        var icon = header.querySelector('.toggle-icon');
                        if (icon) {
                            icon.classList.remove('fa-chevron-right');
                            icon.classList.add('fa-chevron-down');
                        }
                    }
                } else {
                    content.classList.add('collapsed');
                }
            });

            // Expand parent nodes that contain matches
            container.querySelectorAll('.node-content').forEach(function(content) {
                var hasMatch = content.querySelector('.search-match') ||
                               content.querySelector('.editor-node:not(.search-hidden)');
                if (hasMatch) {
                    content.classList.remove('collapsed');
                    var header = content.previousElementSibling;
                    if (header && header.classList.contains('node-header')) {
                        var icon = header.querySelector('.toggle-icon');
                        if (icon) {
                            icon.classList.remove('fa-chevron-right');
                            icon.classList.add('fa-chevron-down');
                        }
                    }
                } else {
                    content.classList.add('collapsed');
                }
            });
        },

        resetFormConfig: function() {
            var self = this;
            UI.confirm({
                title: 'Reset Configuration',
                message: 'This will reset all changes and reload the original configuration. Continue?',
                confirmText: 'Reset',
                type: 'warning'
            }).then(function(confirmed) {
                if (confirmed) {
                    self.loadFormConfig(self.currentFormType);
                    UI.toast('Configuration reset', 'info');
                }
            });
        },

        saveFormConfig: function() {
            var self = this;

            if (!this.editedConfig) {
                UI.toast('No configuration to save', 'error');
                return;
            }

            var btn = el('#btn-save-form-config');
            if (btn) {
                btn.disabled = true;
                btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Saving...';
            }

            // Add metadata
            this.editedConfig.capturedAt = new Date().toISOString();

            API.put('formconfig', {
                transactionType: this.currentFormType,
                config: this.editedConfig,
                source: 'manual'
            }).then(function() {
                if (btn) {
                    btn.disabled = false;
                    btn.innerHTML = '<i class="fas fa-save"></i> Save Configuration';
                }
                UI.toast('Form configuration saved successfully!', 'success');
                self.formConfig = JSON.parse(JSON.stringify(self.editedConfig));
            }).catch(function(err) {
                if (btn) {
                    btn.disabled = false;
                    btn.innerHTML = '<i class="fas fa-save"></i> Save Configuration';
                }
                UI.toast('Save failed: ' + err.message, 'error');
            });
        },

        // ==========================================
        // CAPTURE TRIGGER
        // ==========================================

        triggerCapture: function() {
            var urls = {
                'vendorbill': '/app/accounting/transactions/vendbill.nl?whence=',
                'expensereport': '/app/accounting/transactions/exprept.nl?whence=',
                'purchaseorder': '/app/accounting/transactions/purchord.nl?whence='
            };

            var url = urls[this.currentFormType];
            if (url) {
                window.open(url, '_blank');
                UI.toast('Opening NetSuite form. The layout will be captured when the page loads (if script is enabled).', 'info');
            } else {
                UI.toast('Unknown transaction type', 'error');
            }
        },

        // ==========================================
        // CACHE MANAGEMENT
        // ==========================================

        clearFormCache: function() {
            var btn = el('#btn-clear-cache');
            var statusRow = el('#cache-status');
            var statusText = el('#cache-status-text');

            if (btn) {
                btn.disabled = true;
                btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Clearing...';
            }

            API.delete('clearcache', { cacheType: 'formlayout' })
                .then(function() {
                    if (btn) {
                        btn.disabled = false;
                        btn.innerHTML = '<i class="fas fa-trash-alt"></i> Clear Cache';
                    }
                    if (statusRow) statusRow.style.display = 'block';
                    if (statusText) {
                        statusText.innerHTML = '<i class="fas fa-check-circle" style="color:var(--color-success);"></i> ' +
                            'Form layout cache cleared. Layouts will be recaptured on next form load.';
                    }
                    UI.toast('Form layout cache cleared!', 'success');
                })
                .catch(function(err) {
                    if (btn) {
                        btn.disabled = false;
                        btn.innerHTML = '<i class="fas fa-trash-alt"></i> Clear Cache';
                    }
                    if (statusRow) statusRow.style.display = 'block';
                    if (statusText) {
                        statusText.innerHTML = '<i class="fas fa-exclamation-circle" style="color:var(--color-danger);"></i> ' +
                            'Error: ' + (err.message || 'Failed to clear cache');
                    }
                    UI.toast('Error clearing cache: ' + err.message, 'error');
                });
        },

        clearDatasourceCache: function() {
            var btn = el('#btn-clear-datasource-cache');

            if (btn) {
                btn.disabled = true;
                btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Clearing...';
            }

            API.delete('clearcache', { cacheType: 'datasource' })
                .then(function() {
                    if (btn) {
                        btn.disabled = false;
                        btn.innerHTML = '<i class="fas fa-list"></i> Clear Lists';
                    }
                    UI.toast('Datasource cache cleared! Lists will refresh on next use.', 'success');
                })
                .catch(function(err) {
                    if (btn) {
                        btn.disabled = false;
                        btn.innerHTML = '<i class="fas fa-list"></i> Clear Lists';
                    }
                    UI.toast('Error clearing datasource cache: ' + err.message, 'error');
                });
        },

        // ==========================================
        // SETTINGS PERSISTENCE
        // ==========================================

        saveSettings: function() {
            var self = this;
            var btn = el('#btn-save-settings');

            var getChecked = function(id) {
                var elem = el(id);
                return elem ? elem.checked : true;
            };

            var maxPagesVal = el('#max-extraction-pages') ? parseInt(el('#max-extraction-pages').value, 10) : 0;
            var settings = {
                defaultDocumentType: el('#default-type').value || 'auto',
                defaultLineSublist: el('#default-line-sublist') ? el('#default-line-sublist').value : 'auto',
                maxExtractionPages: isNaN(maxPagesVal) ? 0 : maxPagesVal,
                // Anomaly Detection Settings (grouped)
                anomalyDetection: {
                    // Duplicate Detection
                    detectDuplicateInvoice: getChecked('#detect-duplicate-invoice'),
                    detectDuplicatePayment: getChecked('#detect-duplicate-payment'),
                    // Amount Validation
                    validateLineItemsTotal: getChecked('#validate-line-items-total'),
                    validateSubtotalTax: getChecked('#validate-subtotal-tax'),
                    validatePositiveAmounts: getChecked('#validate-positive-amounts'),
                    detectRoundAmounts: getChecked('#detect-round-amounts'),
                    detectAmountOutlier: getChecked('#detect-amount-outlier'),
                    // Date Validation
                    validateFutureDate: getChecked('#validate-future-date'),
                    validateDueDateSequence: getChecked('#validate-due-date-sequence'),
                    validateStaleDate: getChecked('#validate-stale-date'),
                    detectUnusualTerms: getChecked('#detect-unusual-terms'),
                    // Vendor Validation
                    detectVendorNotFound: getChecked('#detect-vendor-not-found'),
                    detectLowVendorConfidence: getChecked('#detect-low-vendor-confidence'),
                    detectInvoiceFormatChange: getChecked('#detect-invoice-format-change'),
                    // Required Fields
                    requireInvoiceNumber: getChecked('#require-invoice-number'),
                    requireTotalAmount: getChecked('#require-total-amount')
                }
            };

            if (btn) {
                btn.disabled = true;
                btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Saving...';
            }

            API.put('settings', settings)
                .then(function() {
                    if (btn) {
                        btn.disabled = false;
                        btn.innerHTML = '<i class="fas fa-check"></i> Save Changes';
                    }
                    UI.toast('Settings saved successfully!', 'success');
                })
                .catch(function(err) {
                    if (btn) {
                        btn.disabled = false;
                        btn.innerHTML = '<i class="fas fa-check"></i> Save Changes';
                    }
                    UI.toast('Error saving settings: ' + err.message, 'error');
                });
        },

        // ==========================================
        // HELP
        // ==========================================

        showShortcutsHelp: function() {
            UI.showKeyboardShortcuts();
        },

        // ==========================================
        // PROVIDER MANAGEMENT
        // ==========================================

        loadProviderConfig: function() {
            var self = this;

            API.get('providerconfig')
                .then(function(result) {
                    self.providerConfig = result.data || result || {};
                    self.currentProvider = self.providerConfig.providerType || 'oci';
                    self.updateProviderUI();
                })
                .catch(function(err) {
                    console.error('Error loading provider config:', err);
                    self.providerConfig = { providerType: 'oci' };
                    self.currentProvider = 'oci';
                    self.updateProviderUI();
                });
        },

        updateProviderUI: function() {
            var config = this.providerConfig || {};

            // Update radio buttons and selection state
            var ociRadio = el('#provider-radio-oci');
            var azureRadio = el('#provider-radio-azure');
            var mindeeRadio = el('#provider-radio-mindee');
            var ociOption = el('#provider-oci');
            var azureOption = el('#provider-azure');
            var mindeeOption = el('#provider-mindee');
            var azurePanel = el('#azure-config-panel');
            var mindeePanel = el('#mindee-config-panel');

            // Reset all selections first
            if (ociRadio) ociRadio.checked = false;
            if (azureRadio) azureRadio.checked = false;
            if (mindeeRadio) mindeeRadio.checked = false;
            if (ociOption) ociOption.classList.remove('selected');
            if (azureOption) azureOption.classList.remove('selected');
            if (mindeeOption) mindeeOption.classList.remove('selected');
            if (azurePanel) azurePanel.style.display = 'none';
            if (mindeePanel) mindeePanel.style.display = 'none';

            // Set the current provider
            if (this.currentProvider === 'azure') {
                if (azureRadio) azureRadio.checked = true;
                if (azureOption) azureOption.classList.add('selected');
                if (azurePanel) azurePanel.style.display = 'block';
            } else if (this.currentProvider === 'mindee') {
                if (mindeeRadio) mindeeRadio.checked = true;
                if (mindeeOption) mindeeOption.classList.add('selected');
                if (mindeePanel) mindeePanel.style.display = 'block';
            } else {
                // Default to OCI
                if (ociRadio) ociRadio.checked = true;
                if (ociOption) ociOption.classList.add('selected');
            }

            // Populate Azure config if present
            if (config.azure) {
                var endpointInput = el('#azure-endpoint');
                var apiKeyInput = el('#azure-api-key');
                var modelSelect = el('#azure-model');

                if (endpointInput && config.azure.endpoint) {
                    endpointInput.value = config.azure.endpoint;
                }
                if (apiKeyInput && config.azure._hasApiKey) {
                    // Show masked placeholder for existing key
                    apiKeyInput.placeholder = 'API key configured (enter new to replace)';
                }
                if (modelSelect && config.azure.defaultModel) {
                    modelSelect.value = config.azure.defaultModel;
                }

                // Update Azure status
                this.updateAzureStatus(config.azure);
            }

            // Populate Mindee config if present
            if (config.mindee) {
                var mindeeApiKeyInput = el('#mindee-api-key');
                var mindeeDocTypeSelect = el('#mindee-doc-type');

                if (mindeeApiKeyInput && config.mindee._hasApiKey) {
                    // Show masked placeholder for existing key
                    mindeeApiKeyInput.placeholder = 'API key configured (enter new to replace)';
                }
                if (mindeeDocTypeSelect && config.mindee.defaultDocumentType) {
                    mindeeDocTypeSelect.value = config.mindee.defaultDocumentType;
                }

                // Update Mindee status
                this.updateMindeeStatus(config.mindee);
            }
        },

        updateAzureStatus: function(azureConfig) {
            var statusEl = el('#azure-status');
            if (!statusEl) return;

            if (azureConfig && azureConfig.endpoint && azureConfig._hasApiKey) {
                statusEl.innerHTML = '<i class="fas fa-check-circle" style="color:var(--color-success);"></i> <span>Configured</span>';
            } else if (azureConfig && (azureConfig.endpoint || azureConfig._hasApiKey)) {
                statusEl.innerHTML = '<i class="fas fa-exclamation-triangle" style="color:var(--color-warning);"></i> <span>Incomplete configuration</span>';
            } else {
                statusEl.innerHTML = '<i class="fas fa-exclamation-circle" style="color:var(--color-warning);"></i> <span>Configuration required</span>';
            }
        },

        updateMindeeStatus: function(mindeeConfig) {
            var statusEl = el('#mindee-status');
            if (!statusEl) return;

            if (mindeeConfig && mindeeConfig._hasApiKey) {
                statusEl.innerHTML = '<i class="fas fa-check-circle" style="color:var(--color-success);"></i> <span>Configured</span>';
            } else {
                statusEl.innerHTML = '<i class="fas fa-exclamation-circle" style="color:var(--color-warning);"></i> <span>Configuration required</span>';
            }
        },

        selectProvider: function(provider) {
            var self = this;
            this.currentProvider = provider;

            // Update UI
            var ociOption = el('#provider-oci');
            var azureOption = el('#provider-azure');
            var mindeeOption = el('#provider-mindee');
            var ociRadio = el('#provider-radio-oci');
            var azureRadio = el('#provider-radio-azure');
            var mindeeRadio = el('#provider-radio-mindee');
            var azurePanel = el('#azure-config-panel');
            var mindeePanel = el('#mindee-config-panel');

            // Helper to animate panel in
            function showPanel(panel) {
                if (!panel) return;
                panel.style.display = 'block';
                panel.style.opacity = '0';
                panel.style.transform = 'translateY(-10px)';
                requestAnimationFrame(function() {
                    panel.style.transition = 'opacity 0.3s ease, transform 0.3s ease';
                    panel.style.opacity = '1';
                    panel.style.transform = 'translateY(0)';
                });
            }

            // Reset all selections
            if (ociRadio) ociRadio.checked = false;
            if (azureRadio) azureRadio.checked = false;
            if (mindeeRadio) mindeeRadio.checked = false;
            if (ociOption) ociOption.classList.remove('selected');
            if (azureOption) azureOption.classList.remove('selected');
            if (mindeeOption) mindeeOption.classList.remove('selected');
            if (azurePanel) azurePanel.style.display = 'none';
            if (mindeePanel) mindeePanel.style.display = 'none';

            if (provider === 'azure') {
                if (azureRadio) azureRadio.checked = true;
                if (azureOption) azureOption.classList.add('selected');
                showPanel(azurePanel);

                // Populate Azure fields from saved config if available
                if (self.providerConfig && self.providerConfig.azure) {
                    var config = self.providerConfig.azure;
                    var endpointInput = el('#azure-endpoint');
                    var apiKeyInput = el('#azure-api-key');
                    var modelSelect = el('#azure-model');

                    if (endpointInput && config.endpoint) {
                        endpointInput.value = config.endpoint;
                    }
                    if (apiKeyInput && config._hasApiKey) {
                        apiKeyInput.placeholder = 'API key configured (enter new to replace)';
                    }
                    if (modelSelect && config.defaultModel) {
                        modelSelect.value = config.defaultModel;
                    }
                    self.updateAzureStatus(config);
                }
            } else if (provider === 'mindee') {
                if (mindeeRadio) mindeeRadio.checked = true;
                if (mindeeOption) mindeeOption.classList.add('selected');
                showPanel(mindeePanel);

                // Populate Mindee fields from saved config if available
                if (self.providerConfig && self.providerConfig.mindee) {
                    var mindeeConfig = self.providerConfig.mindee;
                    var mindeeApiKeyInput = el('#mindee-api-key');
                    var mindeeDocTypeSelect = el('#mindee-doc-type');

                    if (mindeeApiKeyInput && mindeeConfig._hasApiKey) {
                        mindeeApiKeyInput.placeholder = 'API key configured (enter new to replace)';
                    }
                    if (mindeeDocTypeSelect && mindeeConfig.defaultDocumentType) {
                        mindeeDocTypeSelect.value = mindeeConfig.defaultDocumentType;
                    }
                    self.updateMindeeStatus(mindeeConfig);
                }
            } else {
                // Default to OCI
                if (ociRadio) ociRadio.checked = true;
                if (ociOption) ociOption.classList.add('selected');
            }
        },

        testAzureConnection: function() {
            var self = this;
            var btn = el('#btn-test-azure');
            var resultEl = el('#azure-test-result');

            var endpoint = (el('#azure-endpoint').value || '').trim();
            var apiKey = (el('#azure-api-key').value || '').trim();

            // Validate inputs
            if (!endpoint) {
                if (resultEl) {
                    resultEl.innerHTML = '<i class="fas fa-times-circle" style="color:var(--color-danger);"></i> Please enter endpoint';
                }
                return;
            }

            // If no new API key entered, check if we have existing
            if (!apiKey && !(this.providerConfig && this.providerConfig.azure && this.providerConfig.azure._hasApiKey)) {
                if (resultEl) {
                    resultEl.innerHTML = '<i class="fas fa-times-circle" style="color:var(--color-danger);"></i> Please enter API key';
                }
                return;
            }

            // Show loading
            if (btn) {
                btn.disabled = true;
                btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Testing...';
            }
            if (resultEl) {
                resultEl.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Testing connection...';
            }

            // Build test config - use new key if provided, otherwise test with existing
            var testConfig = {
                endpoint: endpoint,
                apiKey: apiKey || null, // null means use existing encrypted key
                defaultModel: el('#azure-model').value || 'prebuilt-invoice'
            };

            API.post('testprovider', { providerType: 'azure', config: testConfig })
                .then(function() {
                    // API.post resolves on success (returns data.data)
                    if (btn) {
                        btn.disabled = false;
                        btn.innerHTML = '<i class="fas fa-plug"></i> Test Connection';
                    }

                    if (resultEl) {
                        resultEl.innerHTML = '<i class="fas fa-check-circle" style="color:var(--color-success);"></i> Connection successful!';
                    }
                    UI.toast('Azure connection test successful!', 'success');
                })
                .catch(function(err) {
                    if (btn) {
                        btn.disabled = false;
                        btn.innerHTML = '<i class="fas fa-plug"></i> Test Connection';
                    }
                    if (resultEl) {
                        resultEl.innerHTML = '<i class="fas fa-times-circle" style="color:var(--color-danger);"></i> ' + (err.message || 'Test failed');
                    }
                    UI.toast('Connection test failed: ' + err.message, 'error');
                });
        },

        testMindeeConnection: function() {
            var self = this;
            var btn = el('#btn-test-mindee');
            var resultEl = el('#mindee-test-result');

            var apiKey = (el('#mindee-api-key').value || '').trim();

            // If no new API key entered, check if we have existing
            if (!apiKey && !(this.providerConfig && this.providerConfig.mindee && this.providerConfig.mindee._hasApiKey)) {
                if (resultEl) {
                    resultEl.innerHTML = '<i class="fas fa-times-circle" style="color:var(--color-danger);"></i> Please enter API key';
                }
                return;
            }

            // Show loading
            if (btn) {
                btn.disabled = true;
                btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Testing...';
            }
            if (resultEl) {
                resultEl.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Testing connection...';
            }

            // Build test config - use new key if provided, otherwise test with existing
            var testConfig = {
                apiKey: apiKey || null, // null means use existing encrypted key
                defaultDocumentType: el('#mindee-doc-type').value || 'invoice',
                _useSavedApiKey: !apiKey && this.providerConfig && this.providerConfig.mindee && this.providerConfig.mindee._hasApiKey
            };

            API.post('testprovider', { providerType: 'mindee', config: testConfig })
                .then(function() {
                    // API.post resolves on success (returns data.data)
                    if (btn) {
                        btn.disabled = false;
                        btn.innerHTML = '<i class="fas fa-plug"></i> Test Connection';
                    }

                    if (resultEl) {
                        resultEl.innerHTML = '<i class="fas fa-check-circle" style="color:var(--color-success);"></i> Connection successful!';
                    }
                    UI.toast('Mindee connection test successful!', 'success');
                })
                .catch(function(err) {
                    if (btn) {
                        btn.disabled = false;
                        btn.innerHTML = '<i class="fas fa-plug"></i> Test Connection';
                    }

                    if (resultEl) {
                        resultEl.innerHTML = '<i class="fas fa-times-circle" style="color:var(--color-danger);"></i> ' + (err.message || 'Connection failed');
                    }
                    UI.toast('Connection test failed: ' + err.message, 'error');
                });
        },

        saveProviderSettings: function() {
            var self = this;
            var btn = el('#btn-save-provider');

            // Build config
            var config = {
                providerType: this.currentProvider
            };

            // Add Azure config if selected
            if (this.currentProvider === 'azure') {
                var endpoint = (el('#azure-endpoint').value || '').trim();
                var apiKey = (el('#azure-api-key').value || '').trim();
                var model = el('#azure-model').value || 'prebuilt-invoice';

                if (!endpoint) {
                    UI.toast('Please enter Azure endpoint', 'error');
                    return;
                }

                // Only require API key if not already configured
                if (!apiKey && !(this.providerConfig && this.providerConfig.azure && this.providerConfig.azure._hasApiKey)) {
                    UI.toast('Please enter Azure API key', 'error');
                    return;
                }

                config.azure = {
                    endpoint: endpoint,
                    defaultModel: model
                };

                // Only include API key if a new one was entered
                if (apiKey) {
                    config.azure.apiKey = apiKey;
                } else if (this.providerConfig && this.providerConfig.azure && this.providerConfig.azure._hasApiKey) {
                    // Preserve existing API key
                    config.azure._preserveExistingApiKey = true;
                }
            }

            // Add Mindee config if selected
            if (this.currentProvider === 'mindee') {
                var mindeeApiKey = (el('#mindee-api-key').value || '').trim();
                var docType = el('#mindee-doc-type').value || 'invoice';

                // Only require API key if not already configured
                if (!mindeeApiKey && !(this.providerConfig && this.providerConfig.mindee && this.providerConfig.mindee._hasApiKey)) {
                    UI.toast('Please enter Mindee API key', 'error');
                    return;
                }

                config.mindee = {
                    defaultDocumentType: docType
                };

                // Only include API key if a new one was entered
                if (mindeeApiKey) {
                    config.mindee.apiKey = mindeeApiKey;
                } else if (this.providerConfig && this.providerConfig.mindee && this.providerConfig.mindee._hasApiKey) {
                    // Preserve existing API key
                    config.mindee._preserveExistingApiKey = true;
                }
            }

            // Show loading
            if (btn) {
                btn.disabled = true;
                btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Saving...';
            }

            API.put('providerconfig', config)
                .then(function() {
                    // API.put resolves on success (returns data.data which may be null)
                    if (btn) {
                        btn.disabled = false;
                        btn.innerHTML = '<i class="fas fa-save"></i> Save Provider Settings';
                    }

                    UI.toast('Provider settings saved successfully!', 'success');

                    // Update local config
                    self.providerConfig = config;

                    // Handle Azure API key field update
                    if (config.azure && config.azure.apiKey) {
                        self.providerConfig.azure._hasApiKey = true;
                        // Clear password field
                        var azureApiKeyInput = el('#azure-api-key');
                        if (azureApiKeyInput) {
                            azureApiKeyInput.value = '';
                            azureApiKeyInput.placeholder = 'API key configured (enter new to replace)';
                        }
                    }

                    // Handle Mindee API key field update
                    if (config.mindee && config.mindee.apiKey) {
                        self.providerConfig.mindee._hasApiKey = true;
                        // Clear password field
                        var mindeeApiKeyInput = el('#mindee-api-key');
                        if (mindeeApiKeyInput) {
                            mindeeApiKeyInput.value = '';
                            mindeeApiKeyInput.placeholder = 'API key configured (enter new to replace)';
                        }
                    }

                    // Update status displays
                    if (self.providerConfig.azure) {
                        self.updateAzureStatus(self.providerConfig.azure);
                    }
                    if (self.providerConfig.mindee) {
                        self.updateMindeeStatus(self.providerConfig.mindee);
                    }
                })
                .catch(function(err) {
                    if (btn) {
                        btn.disabled = false;
                        btn.innerHTML = '<i class="fas fa-save"></i> Save Provider Settings';
                    }
                    UI.toast('Failed to save provider settings: ' + err.message, 'error');
                });
        },

        // ==========================================
        // EMAIL INBOX MANAGEMENT
        // ==========================================

        loadEmailInboxStatus: function() {
            var self = this;
            var statusEl = el('#email-inbox-status');
            var addressPanel = el('#email-address-panel');
            var setupPanel = el('#email-setup-panel');

            // Show loading state
            if (statusEl) {
                statusEl.innerHTML = '<div class="email-status-loading">' +
                    '<i class="fas fa-spinner fa-spin"></i>' +
                    '<span>Loading email inbox status...</span>' +
                    '</div>';
                statusEl.style.display = 'block';
            }
            if (addressPanel) addressPanel.style.display = 'none';
            if (setupPanel) setupPanel.style.display = 'none';

            API.get('emailInboxStatus')
                .then(function(result) {
                    self.emailInboxConfig = result.data || result || {};

                    if (statusEl) statusEl.style.display = 'none';

                    if (self.emailInboxConfig.enabled && self.emailInboxConfig.emailAddress) {
                        // Show the email address panel
                        self.showEmailAddressPanel(self.emailInboxConfig);
                    } else {
                        // Show setup instructions
                        self.showEmailSetupPanel();
                    }
                })
                .catch(function(err) {
                    console.error('Error loading email inbox status:', err);
                    // On error, show the setup panel with the email address construction
                    self.showEmailSetupPanel();
                });
        },

        showEmailAddressPanel: function(config) {
            var addressPanel = el('#email-address-panel');
            var setupPanel = el('#email-setup-panel');
            var statusEl = el('#email-inbox-status');

            if (statusEl) statusEl.style.display = 'none';
            if (setupPanel) setupPanel.style.display = 'none';
            if (addressPanel) addressPanel.style.display = 'block';

            // Set the email address
            var addressInput = el('#email-capture-address');
            if (addressInput && config.emailAddress) {
                addressInput.value = config.emailAddress;
            }

            // Update stats if available
            var docsToday = el('#email-docs-today');
            var docsTotal = el('#email-docs-total');

            if (docsToday) {
                docsToday.textContent = config.documentsToday !== undefined ? config.documentsToday : '-';
            }
            if (docsTotal) {
                docsTotal.textContent = config.documentsTotal !== undefined ? config.documentsTotal : '-';
            }
        },

        showEmailSetupPanel: function() {
            var addressPanel = el('#email-address-panel');
            var setupPanel = el('#email-setup-panel');
            var statusEl = el('#email-inbox-status');

            if (statusEl) statusEl.style.display = 'none';
            if (addressPanel) addressPanel.style.display = 'none';
            if (setupPanel) setupPanel.style.display = 'block';
        },

        copyEmailAddress: function() {
            var addressInput = el('#email-capture-address');
            if (!addressInput || !addressInput.value) {
                UI.toast('No email address to copy', 'warning');
                return;
            }

            // Try to use the Clipboard API
            if (navigator.clipboard && navigator.clipboard.writeText) {
                navigator.clipboard.writeText(addressInput.value)
                    .then(function() {
                        UI.toast('Email address copied to clipboard', 'success');
                    })
                    .catch(function() {
                        // Fallback to select and copy
                        addressInput.select();
                        document.execCommand('copy');
                        UI.toast('Email address copied to clipboard', 'success');
                    });
            } else {
                // Fallback for older browsers
                addressInput.select();
                document.execCommand('copy');
                UI.toast('Email address copied to clipboard', 'success');
            }
        },

        saveEmailAddress: function() {
            var self = this;
            var emailInput = el('#email-address-input');
            var saveBtn = el('#btn-save-email-address');

            if (!emailInput || !emailInput.value.trim()) {
                UI.toast('Please enter an email address', 'warning');
                return;
            }

            var emailAddress = emailInput.value.trim();

            // Basic validation
            if (emailAddress.indexOf('@') === -1 || emailAddress.indexOf('netsuite.com') === -1) {
                UI.toast('Please enter a valid NetSuite email capture address', 'error');
                return;
            }

            // Disable button during save
            if (saveBtn) {
                saveBtn.disabled = true;
                saveBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Saving...';
            }

            API.put('emailInboxConfig', { emailAddress: emailAddress })
                .then(function(result) {
                    if (saveBtn) {
                        saveBtn.disabled = false;
                        saveBtn.innerHTML = '<i class="fas fa-save"></i> Save';
                    }

                    UI.toast('Email address saved successfully', 'success');

                    // Update config and refresh display
                    self.emailInboxConfig = {
                        enabled: true,
                        emailAddress: emailAddress
                    };
                    self.showEmailAddressPanel(self.emailInboxConfig);
                })
                .catch(function(err) {
                    if (saveBtn) {
                        saveBtn.disabled = false;
                        saveBtn.innerHTML = '<i class="fas fa-save"></i> Save';
                    }
                    UI.toast('Failed to save: ' + (err.message || 'Unknown error'), 'error');
                });
        },

        // ==========================================
        // LLM (AI VERIFICATION) SETTINGS
        // ==========================================

        llmConfig: null,

        loadLLMConfig: function() {
            var self = this;

            API.get('llmconfig')
                .then(function(result) {
                    var config = result.data || result;
                    self.llmConfig = config;

                    // Update UI with loaded config
                    var enabledToggle = el('#llm-enabled');
                    var apiKeyInput = el('#llm-api-key');
                    var triggerModeSelect = el('#llm-trigger-mode');
                    var thresholdInput = el('#llm-smart-threshold');
                    var maxPagesInput = el('#llm-max-pages');
                    var thresholdRow = el('#llm-threshold-row');
                    var configPanel = el('#llm-config-panel');

                    if (enabledToggle) {
                        enabledToggle.checked = config.enabled === true;
                    }

                    if (configPanel) {
                        configPanel.style.display = config.enabled ? 'block' : 'none';
                    }

                    if (apiKeyInput && config._hasApiKey) {
                        apiKeyInput.placeholder = 'API key configured (enter new to replace)';
                    }

                    if (triggerModeSelect && config.triggerMode) {
                        triggerModeSelect.value = config.triggerMode;
                    }

                    if (thresholdRow) {
                        thresholdRow.style.display = config.triggerMode === 'smart' ? 'flex' : 'none';
                    }

                    if (thresholdInput && config.smartThreshold) {
                        thresholdInput.value = Math.round(config.smartThreshold * 100);
                    }

                    if (maxPagesInput && config.maxPages) {
                        maxPagesInput.value = config.maxPages;
                    }
                })
                .catch(function(err) {
                    console.warn('Could not load LLM config:', err);
                });
        },

        toggleLLMPanel: function(enabled) {
            var configPanel = el('#llm-config-panel');
            if (configPanel) {
                if (enabled) {
                    configPanel.style.display = 'block';
                    configPanel.style.opacity = '0';
                    configPanel.style.transform = 'translateY(-10px)';
                    requestAnimationFrame(function() {
                        configPanel.style.transition = 'opacity 0.3s ease, transform 0.3s ease';
                        configPanel.style.opacity = '1';
                        configPanel.style.transform = 'translateY(0)';
                    });
                } else {
                    configPanel.style.display = 'none';
                }
            }
        },

        testLLMConnection: function() {
            var self = this;
            var btn = el('#btn-test-llm');
            var resultEl = el('#llm-test-result');
            var apiKey = (el('#llm-api-key').value || '').trim();

            // Determine if we should use the saved key
            var useSavedKey = false;
            if (!apiKey && self.llmConfig && self.llmConfig._hasApiKey) {
                useSavedKey = true;
            }

            if (!apiKey && !useSavedKey) {
                if (resultEl) {
                    resultEl.innerHTML = '<i class="fas fa-times-circle" style="color:var(--color-danger);"></i> Please enter an API key';
                }
                return;
            }

            // Show loading state
            if (btn) {
                btn.disabled = true;
                btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Testing...';
            }
            if (resultEl) {
                resultEl.innerHTML = '';
            }

            var requestData = useSavedKey ? { useSavedKey: true } : { apiKey: apiKey };

            API.post('testllm', requestData)
                .then(function(result) {
                    if (btn) {
                        btn.disabled = false;
                        btn.innerHTML = '<i class="fas fa-plug"></i> Test Connection';
                    }

                    console.log('[LLM Test] Response:', JSON.stringify(result));

                    // API.post returns data.data directly, so result IS the data object
                    // Check if connected is truthy in the unwrapped data
                    var isSuccess = result && result.connected;

                    if (isSuccess) {
                        var modelInfo = result.availableModels ? result.availableModels + ' models available' : '';
                        if (resultEl) {
                            resultEl.innerHTML = '<i class="fas fa-check-circle" style="color:var(--color-success);"></i> Connected' +
                                (modelInfo ? ' - ' + modelInfo : '');
                        }
                    } else {
                        // Should not typically reach here since API.post throws on error
                        // But handle edge case where connected is false/missing
                        var errorMsg = (result && result.message) || 'Connection failed';
                        if (resultEl) {
                            resultEl.innerHTML = '<i class="fas fa-times-circle" style="color:var(--color-danger);"></i> ' + errorMsg;
                        }
                    }
                })
                .catch(function(err) {
                    console.error('[LLM Test] Error:', err);
                    if (btn) {
                        btn.disabled = false;
                        btn.innerHTML = '<i class="fas fa-plug"></i> Test Connection';
                    }
                    if (resultEl) {
                        resultEl.innerHTML = '<i class="fas fa-times-circle" style="color:var(--color-danger);"></i> ' +
                            (err.message || 'Connection failed');
                    }
                });
        },

        saveLLMSettings: function() {
            var self = this;
            var btn = el('#btn-save-llm');

            var enabled = el('#llm-enabled')?.checked || false;
            var apiKey = (el('#llm-api-key')?.value || '').trim();
            var triggerMode = el('#llm-trigger-mode')?.value || 'smart';
            var smartThreshold = parseInt(el('#llm-smart-threshold')?.value || '70', 10) / 100;
            var maxPages = parseInt(el('#llm-max-pages')?.value || '20', 10);

            // Validate if enabling
            if (enabled && !apiKey && !(self.llmConfig && self.llmConfig._hasApiKey)) {
                UI.toast('API key is required to enable AI Verification', 'warning');
                return;
            }

            // Disable button during save
            if (btn) {
                btn.disabled = true;
                btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Saving...';
            }

            var configData = {
                enabled: enabled,
                triggerMode: triggerMode,
                smartThreshold: smartThreshold,
                maxPages: maxPages,
                _preserveApiKey: !apiKey && self.llmConfig && self.llmConfig._hasApiKey
            };

            // Only include API key if a new one was entered
            if (apiKey) {
                configData.apiKey = apiKey;
            }

            API.put('llmconfig', configData)
                .then(function(result) {
                    if (btn) {
                        btn.disabled = false;
                        btn.innerHTML = '<i class="fas fa-save"></i> Save AI Verification Settings';
                    }

                    UI.toast('AI Verification settings saved', 'success');

                    // Clear API key input after save
                    var apiKeyInput = el('#llm-api-key');
                    if (apiKeyInput && apiKey) {
                        apiKeyInput.value = '';
                        apiKeyInput.placeholder = 'API key configured (enter new to replace)';
                    }

                    // Update local config
                    self.llmConfig = {
                        enabled: enabled,
                        triggerMode: triggerMode,
                        smartThreshold: smartThreshold,
                        maxPages: maxPages,
                        _hasApiKey: !!(apiKey || (self.llmConfig && self.llmConfig._hasApiKey))
                    };
                })
                .catch(function(err) {
                    if (btn) {
                        btn.disabled = false;
                        btn.innerHTML = '<i class="fas fa-save"></i> Save AI Verification Settings';
                    }
                    UI.toast('Failed to save: ' + (err.message || 'Unknown error'), 'error');
                });
        },

        cleanup: function() {
            this.formConfig = null;
            this.editedConfig = null;
            this.parsedXml = null;
            this.xmlSelections = {};
            this.emailInboxConfig = null;
            this.llmConfig = null;
        }
    };

    Router.register('settings',
        function(params) { SettingsController.init(params); },
        function() { SettingsController.cleanup(); }
    );

    FCDebug.log('[View.Settings] Loaded');

})();
