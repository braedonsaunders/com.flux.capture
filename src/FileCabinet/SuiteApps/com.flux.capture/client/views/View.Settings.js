/**
 * Flux Capture - Enhanced Settings View Controller
 * Professional SaaS-style settings with form configuration
 */
(function() {
    'use strict';

    var SettingsController = {
        currentFormType: 'vendorbill',
        formConfig: null,
        parsedXml: null,

        init: function() {
            renderTemplate('tpl-settings', 'view-container');
            this.bindEvents();
            this.loadFormConfig(this.currentFormType);
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

            // Form config tab switching
            els('.config-tab').forEach(function(tab) {
                tab.addEventListener('click', function() {
                    els('.config-tab').forEach(function(t) { t.classList.remove('active'); });
                    this.classList.add('active');
                    self.currentFormType = this.dataset.type;
                    self.loadFormConfig(self.currentFormType);
                });
            });

            // Source option selection
            var captureOption = el('#source-option-capture');
            var xmlOption = el('#source-option-xml');

            if (captureOption) {
                captureOption.addEventListener('click', function() {
                    self.selectSourceOption('capture');
                });
            }

            if (xmlOption) {
                xmlOption.addEventListener('click', function() {
                    self.selectSourceOption('xml');
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

            // Import XML button
            var importBtn = el('#btn-import-xml');
            if (importBtn) {
                importBtn.addEventListener('click', function() {
                    self.importXmlConfig();
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

            // Show shortcuts
            var shortcutsBtn = el('#btn-show-shortcuts');
            if (shortcutsBtn) {
                shortcutsBtn.addEventListener('click', function() {
                    self.showShortcutsHelp();
                });
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
                captureControls.style.display = 'block';
                xmlControls.style.display = 'none';
            } else {
                captureOption.classList.remove('selected');
                xmlOption.classList.add('selected');
                captureControls.style.display = 'none';
                xmlControls.style.display = 'block';
            }
        },

        loadFormConfig: function(type) {
            var self = this;

            API.get('formschema', { transactionType: type })
                .then(function(result) {
                    self.formConfig = result.data || result;
                    self.renderFormPreview();
                    self.updateCaptureStatus();
                })
                .catch(function(err) {
                    console.error('Error loading form config:', err);
                    self.formConfig = null;
                    self.renderFormPreview();
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
            } else if (this.formConfig.capturedAt || this.formConfig.lastModified) {
                var date = new Date(this.formConfig.capturedAt || this.formConfig.lastModified);
                var timeAgo = this.getTimeAgo(date);
                statusText.textContent = 'Last captured: ' + timeAgo;
                statusIcon.innerHTML = '<i class="fas fa-check-circle" style="color:var(--color-success);"></i>';
            } else if (this.formConfig.tabs && this.formConfig.tabs.length > 0) {
                statusText.textContent = 'Configuration loaded (using defaults)';
                statusIcon.innerHTML = '<i class="fas fa-info-circle" style="color:var(--color-primary);"></i>';
            } else {
                statusText.textContent = 'No layout captured yet';
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

        renderFormPreview: function() {
            var preview = el('#form-preview');
            if (!preview) return;

            if (!this.formConfig || (!this.formConfig.tabs && !this.formConfig.bodyFields)) {
                preview.innerHTML = '<div class="preview-placeholder">' +
                    '<i class="fas fa-file-alt"></i>' +
                    '<p>No form configuration found for this transaction type.<br>Open a ' + this.currentFormType + ' form in NetSuite to capture the layout.</p>' +
                    '</div>';
                return;
            }

            var html = '<div class="form-preview-content">';

            // Show tabs
            var tabs = this.formConfig.tabs || [];
            if (tabs.length > 0) {
                html += '<div class="preview-tabs">';
                tabs.forEach(function(tab) {
                    html += '<span class="preview-tab">' + escapeHtml(tab.label || tab.id) + '</span>';
                });
                html += '</div>';
            }

            // Count fields and sublists
            var fieldCount = 0;
            var sublistCount = 0;

            if (this.formConfig.bodyFields) {
                fieldCount = this.formConfig.bodyFields.length;
            }

            tabs.forEach(function(tab) {
                if (tab.fieldGroups) {
                    tab.fieldGroups.forEach(function(g) {
                        if (g.fields) fieldCount += g.fields.length;
                    });
                }
                if (tab.sublists) sublistCount += tab.sublists.length;
            });

            if (this.formConfig.sublists) {
                sublistCount = this.formConfig.sublists.length;
            }

            html += '<div class="preview-stats">' +
                '<span><i class="fas fa-list-alt"></i> ' + fieldCount + ' fields</span>' +
                '<span><i class="fas fa-table"></i> ' + sublistCount + ' sublists</span>' +
                '<span><i class="fas fa-folder"></i> ' + tabs.length + ' tabs</span>' +
                '</div>';

            // Show source
            var source = this.formConfig.source || 'automatic';
            html += '<div style="margin-top:var(--space-sm);font-size:var(--font-size-xs);color:var(--text-tertiary);">' +
                '<i class="fas fa-info-circle"></i> Source: ' + source +
                '</div>';

            html += '</div>';
            preview.innerHTML = html;
        },

        // ==========================================
        // XML UPLOAD
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
                    self.showXmlPreview();
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

            var fieldGroups = doc.querySelectorAll('mainFields > fieldGroup');
            fieldGroups.forEach(function(fg, idx) {
                mainTab.fieldGroups.push(self.parseXmlFieldGroup(fg, idx));
            });

            // Parse default field group
            var defaultGroup = doc.querySelector('mainFields > defaultFieldGroup');
            if (defaultGroup) {
                var defaultFields = self.parseXmlFields(defaultGroup);
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
            var el = parent.querySelector(tagName);
            return el ? el.textContent.trim() : '';
        },

        parseXmlFieldGroup: function(element, order) {
            var fields = this.parseXmlFields(element);

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

            container.querySelectorAll('field').forEach(function(f) {
                var scriptIdEl = f.querySelector('[scriptid]');
                var id = scriptIdEl ? scriptIdEl.getAttribute('scriptid') : f.getAttribute('id');

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
            var tab = {
                id: element.getAttribute('scriptid') || 'tab_' + order,
                label: this.getXmlText(element, 'label') || 'Tab ' + order,
                order: order,
                fieldGroups: [],
                sublists: []
            };

            // Parse field groups within tab
            element.querySelectorAll('fieldGroup').forEach(function(fg, idx) {
                tab.fieldGroups.push(self.parseXmlFieldGroup(fg, idx));
            });

            // Note which sublists are in this tab
            element.querySelectorAll('subList').forEach(function(sl) {
                var slId = sl.getAttribute('scriptid');
                if (slId) tab.sublists.push(slId);
            });

            return tab;
        },

        parseXmlSublist: function(element) {
            var self = this;
            var columns = [];

            element.querySelectorAll('column').forEach(function(col) {
                columns.push({
                    id: col.getAttribute('scriptid') || self.getXmlText(col, 'id'),
                    label: self.getXmlText(col, 'label'),
                    visible: self.getXmlText(col, 'visible') !== 'F'
                });
            });

            return {
                id: element.getAttribute('scriptid'),
                label: this.getXmlText(element, 'label'),
                columns: columns
            };
        },

        showXmlPreview: function() {
            var preview = el('#xml-preview');
            var info = el('#xml-info');

            if (!this.parsedXml || !preview || !info) return;

            var fieldCount = 0;
            this.parsedXml.tabs.forEach(function(tab) {
                if (tab.fieldGroups) {
                    tab.fieldGroups.forEach(function(g) {
                        if (g.fields) fieldCount += g.fields.length;
                    });
                }
            });

            info.innerHTML = '<p><strong>Form Name:</strong> ' + escapeHtml(this.parsedXml.formInfo.name || 'Unknown') + '</p>' +
                '<p><strong>Record Type:</strong> ' + escapeHtml(this.parsedXml.formInfo.recordType || 'Unknown') + '</p>' +
                '<p><strong>Tabs:</strong> ' + this.parsedXml.tabs.length + '</p>' +
                '<p><strong>Fields:</strong> ' + fieldCount + '</p>' +
                '<p><strong>Sublists:</strong> ' + this.parsedXml.sublists.length + '</p>';

            preview.style.display = 'block';
        },

        importXmlConfig: function() {
            var self = this;

            if (!this.parsedXml) {
                UI.toast('No XML file loaded', 'error');
                return;
            }

            var btn = el('#btn-import-xml');
            if (btn) {
                btn.disabled = true;
                btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Importing...';
            }

            API.put('formconfig', {
                transactionType: this.currentFormType,
                config: this.parsedXml
            }).then(function() {
                if (btn) {
                    btn.disabled = false;
                    btn.innerHTML = '<i class="fas fa-upload"></i> Import Form Definition';
                }
                UI.toast('Form configuration imported successfully!', 'success');
                self.loadFormConfig(self.currentFormType);
                el('#xml-preview').style.display = 'none';
                self.parsedXml = null;
            }).catch(function(err) {
                if (btn) {
                    btn.disabled = false;
                    btn.innerHTML = '<i class="fas fa-upload"></i> Import Form Definition';
                }
                UI.toast('Import failed: ' + err.message, 'error');
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
                UI.toast('Opening NetSuite form. The layout will be captured automatically when the page loads.', 'info');
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

            UI.confirm(
                '<div style="font-size:var(--font-size-sm);">' + html + '</div>',
                'Keyboard Shortcuts',
                { confirmText: 'Got it', showCancel: false }
            );
        },

        cleanup: function() {
            this.formConfig = null;
            this.parsedXml = null;
        }
    };

    Router.register('settings',
        function(params) { SettingsController.init(params); },
        function() { SettingsController.cleanup(); }
    );

    console.log('[View.Settings] Loaded');

})();
