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
        captureScriptEnabled: false,

        init: function() {
            renderTemplate('tpl-settings', 'view-container');
            this.bindEvents();
            this.loadFormConfig(this.currentFormType);
            this.loadCaptureScriptStatus();
        },

        bindEvents: function() {
            var self = this;

            // Threshold slider
            var thresholdEl = el('#auto-threshold');
            var thresholdValue = el('#threshold-value');
            if (thresholdEl && thresholdValue) {
                thresholdEl.addEventListener('input', function() {
                    thresholdValue.textContent = this.value + '%';
                });
            }

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
                    self.loadCaptureScriptStatus(); // Reload script status for this transaction type
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

            // Source option selection
            var captureOption = el('#source-option-capture');
            var xmlOption = el('#source-option-xml');

            if (captureOption) {
                captureOption.addEventListener('click', function(e) {
                    if (!e.target.closest('.toggle') && !e.target.closest('button')) {
                        self.selectSourceOption('capture');
                    }
                });
            }

            if (xmlOption) {
                xmlOption.addEventListener('click', function(e) {
                    if (!e.target.closest('button')) {
                        self.selectSourceOption('xml');
                    }
                });
            }

            // Capture script toggle
            var captureToggle = el('#capture-script-toggle');
            if (captureToggle) {
                captureToggle.addEventListener('change', function() {
                    self.toggleCaptureScript(this.checked);
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

            // Show shortcuts
            var shortcutsBtn = el('#btn-show-shortcuts');
            if (shortcutsBtn) {
                shortcutsBtn.addEventListener('click', function() {
                    self.showShortcutsHelp();
                });
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
            var captureOption = el('#source-option-capture');
            var xmlOption = el('#source-option-xml');
            var captureControls = el('#capture-controls');
            var xmlControls = el('#xml-controls');

            if (type === 'capture') {
                captureOption.classList.add('selected');
                xmlOption.classList.remove('selected');
                if (captureControls) captureControls.style.display = 'block';
                if (xmlControls) xmlControls.style.display = 'none';
            } else {
                captureOption.classList.remove('selected');
                xmlOption.classList.add('selected');
                if (captureControls) captureControls.style.display = 'none';
                if (xmlControls) xmlControls.style.display = 'block';
            }
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
        // CAPTURE SCRIPT TOGGLE
        // ==========================================

        // Deployment IDs per transaction type
        DEPLOYMENT_IDS: {
            'vendorbill': 'customdeploy_fc_formlayout_vendorbill',
            'expensereport': 'customdeploy_fc_formlayout_expense',
            'purchaseorder': 'customdeploy_fc_formlayout_po'
        },

        getDeploymentId: function() {
            return this.DEPLOYMENT_IDS[this.currentFormType] || this.DEPLOYMENT_IDS['vendorbill'];
        },

        loadCaptureScriptStatus: function() {
            var self = this;
            var toggle = el('#capture-script-toggle');
            var label = el('#capture-toggle-label');
            var deploymentId = this.getDeploymentId();

            // Show loading state
            if (label) label.textContent = 'Loading status...';
            if (toggle) toggle.disabled = true;

            API.get('scriptstatus', { deploymentId: deploymentId })
                .then(function(result) {
                    self.captureScriptEnabled = result.data && result.data.enabled;
                    if (toggle) {
                        toggle.checked = self.captureScriptEnabled;
                        toggle.disabled = false;
                    }
                    if (label) {
                        label.textContent = self.captureScriptEnabled ?
                            'Capture Enabled for ' + self.currentFormType : 'Capture Disabled';
                    }
                })
                .catch(function() {
                    self.captureScriptEnabled = false;
                    if (toggle) {
                        toggle.checked = false;
                        toggle.disabled = false;
                    }
                    if (label) label.textContent = 'Script Status Unknown';
                });
        },

        toggleCaptureScript: function(enabled) {
            var self = this;
            var toggle = el('#capture-script-toggle');
            var label = el('#capture-toggle-label');
            var deploymentId = this.getDeploymentId();

            if (label) label.textContent = enabled ? 'Enabling...' : 'Disabling...';

            API.put('scriptstatus', {
                deploymentId: deploymentId,
                enabled: enabled
            })
                .then(function() {
                    self.captureScriptEnabled = enabled;
                    if (label) {
                        label.textContent = enabled ?
                            'Capture Enabled for ' + self.currentFormType : 'Capture Disabled';
                    }
                    UI.toast('Capture script ' + (enabled ? 'enabled' : 'disabled') + ' for ' + self.currentFormType, 'success');
                })
                .catch(function(err) {
                    if (toggle) toggle.checked = !enabled;
                    if (label) {
                        label.textContent = !enabled ?
                            'Capture Enabled for ' + self.currentFormType : 'Capture Disabled';
                    }
                    UI.toast('Failed to update script: ' + err.message, 'error');
                });
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

        parseXmlFields: function(container) {
            var self = this;
            var fields = [];

            // Parse <field> elements - ID is a child element <id>FIELDID</id>
            container.querySelectorAll('field').forEach(function(f) {
                // Get ID from <id> child element first, then try scriptid attribute
                var id = self.getXmlText(f, 'id') || f.getAttribute('scriptid') || f.getAttribute('id');

                if (!id) return;

                fields.push({
                    id: id,
                    label: self.getXmlText(f, 'label') || id,
                    visible: self.getXmlText(f, 'visible') !== 'F',
                    mandatory: self.getXmlText(f, 'mandatory') === 'T',
                    displayType: self.getXmlText(f, 'displayType') || 'NORMAL'
                });
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
                    columns.push({
                        id: colId,
                        label: self.getXmlText(col, 'label') || colId,
                        visible: self.getXmlText(col, 'visible') !== 'F'
                    });
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
        },

        renderEditorTab: function(tab, tabIdx) {
            var fieldGroups = tab.fieldGroups || [];
            var fieldCount = 0;
            fieldGroups.forEach(function(g) {
                if (g.fields) fieldCount += g.fields.length;
            });

            var html = '<div class="editor-node editor-tab" data-tab-idx="' + tabIdx + '">';
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

            var html = '<div class="editor-node editor-group" data-tab-idx="' + tabIdx + '" data-group-idx="' + groupIdx + '">';
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

            var html = '<div class="editor-node editor-field' + hiddenClass + '" data-parent="' + parentKey + '" data-field-idx="' + fieldIdx + '">';
            html += '<div class="node-header field-header">' +
                '<i class="fas ' + typeIcon + ' field-type-icon"></i>' +
                '<span class="node-label">' + escapeHtml(field.label || field.id) + '</span>' +
                '<span class="field-id">(' + escapeHtml(field.id) + ')</span>' +
                mandatoryBadge +
                visibilityBadge +
                '<span class="node-meta">' + (field.type || 'text') + '</span>' +
                '<div class="node-actions">' +
                '<button class="btn-icon" data-action="edit-label" data-type="field" data-parent="' + parentKey + '" data-idx="' + fieldIdx + '" title="Edit label">' +
                '<i class="fas fa-pencil"></i>' +
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
            var isHidden = column.visible === false;
            var visibleClass = isHidden ? 'fa-eye-slash' : 'fa-eye';
            var hiddenClass = isHidden ? ' is-hidden' : '';
            var visibilityBadge = isHidden ? '<span class="field-badge hidden-badge">HIDDEN</span>' : '';

            var html = '<div class="editor-node editor-column' + hiddenClass + '" data-sublist-idx="' + sublistIdx + '" data-col-idx="' + colIdx + '">';
            html += '<div class="node-header field-header">' +
                '<i class="fas fa-columns field-type-icon"></i>' +
                '<span class="node-label">' + escapeHtml(column.label || column.id) + '</span>' +
                '<span class="field-id">(' + escapeHtml(column.id) + ')</span>' +
                visibilityBadge +
                '<div class="node-actions">' +
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
                    } else if (action === 'delete') {
                        self.deleteItem(this, type);
                    }
                });
            });
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

            var settings = {
                autoApproveThreshold: parseInt(el('#auto-threshold').value) || 85,
                defaultDocumentType: el('#default-type').value || 'auto',
                duplicateDetection: el('#duplicate-detection').checked,
                amountValidation: el('#amount-validation').checked
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
            var shortcuts = [
                { key: 'A', desc: 'Approve document and go to next' },
                { key: 'R', desc: 'Reject document' },
                { key: 'S', desc: 'Skip to next document' },
                { key: '←/→', desc: 'Navigate between documents' },
                { key: 'Tab', desc: 'Move to next field' },
                { key: 'Ctrl+S', desc: 'Save changes' },
                { key: '+/-', desc: 'Zoom in/out on document' },
                { key: 'Esc', desc: 'Back to document list' },
                { key: '/', desc: 'Show keyboard shortcuts' }
            ];

            var html = shortcuts.map(function(s) {
                return '<div style="display:flex;align-items:center;gap:var(--space-md);padding:var(--space-xs) 0;">' +
                    '<kbd style="min-width:60px;text-align:center;">' + s.key + '</kbd>' +
                    '<span>' + s.desc + '</span>' +
                    '</div>';
            }).join('');

            UI.confirm({
                title: 'Keyboard Shortcuts',
                message: '<div style="font-size:var(--font-size-sm);">' + html + '</div>',
                confirmText: 'Got it',
                showCancel: false
            });
        },

        cleanup: function() {
            this.formConfig = null;
            this.editedConfig = null;
            this.parsedXml = null;
            this.xmlSelections = {};
        }
    };

    Router.register('settings',
        function(params) { SettingsController.init(params); },
        function() { SettingsController.cleanup(); }
    );

    FCDebug.log('[View.Settings] Loaded');

})();
