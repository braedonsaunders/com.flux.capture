# Implementation Status Review & Completion Proposal

## Executive Summary

This document reviews the original comprehensive proposal and assesses implementation status. Based on a thorough codebase audit, here's the summary:

| Area | Original Proposal | Current Status | Completion |
|------|------------------|----------------|------------|
| Batch Custom Record Removal | Delete batch record, view, routes | **COMPLETE** | 100% |
| Datasource API Backend | GET /action=datasource endpoint | **COMPLETE** | 100% |
| Datasource Client Integration | Typeahead event handlers, caching | **NOT STARTED** | 0% |
| Form Builder/Settings UI | XML upload, form builder, capture toggle | **MINIMAL** | 15% |
| Flux Config Record | Custom record for form definitions | **COMPLETE** | 100% |
| Form Layout Capture Client Script | Extract layouts from NetSuite forms | **COMPLETE** | 100% |
| Capture Toggle Mechanism | Enable/disable capture from Settings | **NOT STARTED** | 0% |

---

## Part 1: Completed Work

### 1.1 Batch Custom Record Removal (100% Complete)

**Status: FULLY REMOVED**

- `customrecord_dm_batch.xml` - Deleted
- `View.Batch.js` - Deleted
- `app_index.html` - No batch navigation or templates
- `deploy.xml` - No batch references
- `FC_Router.js` - No batch CRUD endpoints

**Remaining (Acceptable):** Field `custrecord_flux_batch_id` exists on document record for filtering/grouping. This is data-level only and doesn't require cleanup.

### 1.2 Datasource API Backend (100% Complete)

**Location:** `FC_Router.js:893-1020`

```javascript
// GET /action=datasource&type=departments&query=&limit=200
function getDatasource(context) {
    var dsType = context.type || context.datasource;
    // Supports: departments, classes, locations, subsidiaries,
    // currencies, terms, taxcodes, expensecategories, customers,
    // employees, vendors, accounts, items
}
```

**Features implemented:**
- All datasource types from proposal
- Search query filtering with pattern matching
- Configurable display formats: 'name', 'number-name', 'id-name'
- Result limiting (default 200, max 1000)
- Sorted results with value/text pairs

### 1.3 Flux Config Custom Record (100% Complete)

**Location:** `src/Objects/customrecord_flux_config.xml`

All fields from proposal implemented:
- `custrecord_flux_cfg_type` - Config type (form_definition, settings, datasource_cache)
- `custrecord_flux_cfg_key` - Config key (vendorbill, expensereport, etc.)
- `custrecord_flux_cfg_form_id` - NetSuite form ID
- `custrecord_flux_cfg_data` - JSON configuration data
- `custrecord_flux_cfg_version` - Version for migrations
- `custrecord_flux_cfg_active` - Active checkbox
- `custrecord_flux_cfg_modified` - Last modified timestamp
- `custrecord_flux_cfg_modified_by` - User who modified
- `custrecord_flux_cfg_source` - Source (xml_upload, client_capture, manual)

### 1.4 Form Layout Capture Client Script (100% Complete)

**Location:** `FC_FormLayoutCapture_CS.js`

**Features implemented:**
- Automatic DOM extraction on pageInit
- Tab detection with multiple selector strategies
- Field group extraction via NetSuite data attributes
- Sublist column detection
- Field metadata capture (type, required, mode)
- Server-side caching via `saveformlayout` endpoint
- Session-level deduplication (EXTRACTED_FORMS cache)

### 1.5 Router Endpoints (100% Complete)

**GET Actions:**
- `datasource` - Fetch any datasource type
- `formschema` - Complete form structure
- `formlayout` - Cached client-extracted layout
- `accounts` - Expense accounts
- `items` - Purchasable items
- `vendors` - Vendor search

**PUT Actions:**
- `formconfig` - Update form schema configuration
- `saveformlayout` - Save client-extracted layout
- `invalidatecache` - Clear cached schemas

**DELETE Actions:**
- `clearcache` - Clear form layout cache

---

## Part 2: Incomplete Work

### 2.1 Typeahead Event Handlers & Datasource Fetching (0% Complete)

**Current State:**
- `View.Review.js:1237-1248` renders typeahead HTML structure for sublist select fields
- `getLookupType()` function exists to map field IDs to datasource types
- **NO event handlers** exist to actually trigger API calls
- **NO CSS styles** for typeahead dropdown

**Proposed Changes:**

#### A. Add Typeahead Event Binding in View.Review.js

```javascript
// In bindEvents() method, add:
bindTypeaheadEvents: function() {
    var self = this;

    // Delegate input events on typeahead fields
    var container = el('.extraction-panel');
    if (!container) return;

    container.addEventListener('input', function(e) {
        if (!e.target.classList.contains('typeahead-input')) return;

        var input = e.target;
        var wrapper = input.closest('.typeahead-select');
        var lookupType = input.dataset.lookup;
        var query = input.value.trim();

        clearTimeout(self.typeaheadTimeout);

        if (query.length < 2) {
            self.hideTypeaheadDropdown(wrapper);
            return;
        }

        self.typeaheadTimeout = setTimeout(function() {
            self.fetchDatasource(lookupType, query, wrapper);
        }, 300);
    });

    // Handle selection
    container.addEventListener('click', function(e) {
        var option = e.target.closest('.typeahead-option');
        if (!option) return;

        var wrapper = option.closest('.typeahead-select');
        self.selectTypeaheadOption(wrapper, option);
    });

    // Hide on blur
    container.addEventListener('focusout', function(e) {
        if (!e.target.classList.contains('typeahead-input')) return;

        setTimeout(function() {
            var wrapper = e.target.closest('.typeahead-select');
            self.hideTypeaheadDropdown(wrapper);
        }, 200);
    });
},

fetchDatasource: function(type, query, wrapper) {
    var self = this;
    var dropdown = wrapper.querySelector('.typeahead-dropdown');

    dropdown.innerHTML = '<div class="typeahead-loading">Searching...</div>';
    dropdown.classList.add('active');

    API.get('datasource', { type: type, query: query, limit: 20 })
        .then(function(results) {
            self.renderTypeaheadResults(dropdown, results.data || results);
        })
        .catch(function(err) {
            dropdown.innerHTML = '<div class="typeahead-error">Error loading options</div>';
        });
},

renderTypeaheadResults: function(dropdown, results) {
    if (!results || results.length === 0) {
        dropdown.innerHTML = '<div class="typeahead-empty">No results found</div>';
        return;
    }

    var html = results.map(function(r) {
        return '<div class="typeahead-option" data-value="' + escapeHtml(r.value) + '">' +
            '<span class="typeahead-text">' + escapeHtml(r.text) + '</span>' +
            '</div>';
    }).join('');

    dropdown.innerHTML = html;
},

selectTypeaheadOption: function(wrapper, option) {
    var hiddenInput = wrapper.querySelector('input[type="hidden"]');
    var displayInput = wrapper.querySelector('.typeahead-input');
    var dropdown = wrapper.querySelector('.typeahead-dropdown');

    hiddenInput.value = option.dataset.value;
    displayInput.value = option.querySelector('.typeahead-text').textContent;
    dropdown.classList.remove('active');

    // Trigger change event for line item tracking
    this.markUnsaved();
},

hideTypeaheadDropdown: function(wrapper) {
    var dropdown = wrapper.querySelector('.typeahead-dropdown');
    if (dropdown) dropdown.classList.remove('active');
}
```

#### B. Add Typeahead CSS Styles in components.css

```css
/* Typeahead Select Component */
.typeahead-select {
    position: relative;
    width: 100%;
}

.typeahead-input {
    width: 100%;
    padding: 0.5rem;
    border: 1px solid var(--color-border);
    border-radius: var(--radius-sm);
    font-size: 0.875rem;
}

.typeahead-input:focus {
    outline: none;
    border-color: var(--color-primary);
    box-shadow: 0 0 0 2px var(--color-primary-alpha);
}

.typeahead-dropdown {
    display: none;
    position: absolute;
    top: 100%;
    left: 0;
    right: 0;
    max-height: 200px;
    overflow-y: auto;
    background: var(--color-surface);
    border: 1px solid var(--color-border);
    border-radius: var(--radius-sm);
    box-shadow: var(--shadow-lg);
    z-index: 100;
}

.typeahead-dropdown.active {
    display: block;
}

.typeahead-option {
    padding: 0.5rem 0.75rem;
    cursor: pointer;
    font-size: 0.875rem;
}

.typeahead-option:hover {
    background: var(--color-hover);
}

.typeahead-loading,
.typeahead-empty,
.typeahead-error {
    padding: 0.75rem;
    font-size: 0.875rem;
    color: var(--color-text-muted);
    text-align: center;
}

.typeahead-error {
    color: var(--color-danger);
}
```

#### C. Extend Body Field Select Rendering

Update `renderNsField()` (lines 1077-1081) to use typeahead for body select fields without options:

```javascript
} else if (nsField.type === 'select') {
    // Select without inline options - use typeahead for lookup
    var displayValue = doc[docKey + '_display'] || doc[docKey + '_text'] || value || '';
    var lookupType = this.getLookupType(nsField.id, null);

    if (lookupType !== 'generic') {
        // Render typeahead for known lookup types
        html += '<div class="typeahead-select" data-field="' + nsField.id + '" data-lookup="' + lookupType + '">' +
            '<input type="hidden" id="' + fieldId + '" value="' + escapeHtml(value) + '">' +
            '<input type="text" class="typeahead-input" id="' + fieldId + '-display" ' +
                'value="' + escapeHtml(displayValue) + '" placeholder="Search ' + escapeHtml(label) + '..." ' +
                'data-field="' + nsField.id + '" data-lookup="' + lookupType + '" autocomplete="off"' +
                (isDisabled ? ' disabled' : '') + '>' +
            '<div class="typeahead-dropdown"></div>' +
            '</div>';
    } else {
        // Unknown lookup - render as disabled text
        html += '<input type="text" id="' + fieldId + '" value="' + escapeHtml(displayValue) + '" disabled placeholder="(Select field - not editable)">';
    }
}
```

---

### 2.2 Client-Side Datasource Caching (0% Complete)

**Proposed: DatasourceManager in FC.Core.js**

```javascript
// Add to FC.Core.js
var DatasourceManager = {
    cache: {},
    cacheExpiry: {},
    TTL: 5 * 60 * 1000, // 5 minutes

    get: function(type, options) {
        options = options || {};
        var cacheKey = type + '_' + (options.query || '');

        // Check cache validity
        if (this.cache[cacheKey] && this.cacheExpiry[cacheKey] > Date.now()) {
            return Promise.resolve(this.cache[cacheKey]);
        }

        var self = this;
        return API.get('datasource', {
            type: type,
            query: options.query,
            limit: options.limit || 200
        }).then(function(result) {
            var data = result.data || result;
            // Only cache non-search results
            if (!options.query) {
                self.cache[cacheKey] = data;
                self.cacheExpiry[cacheKey] = Date.now() + self.TTL;
            }
            return data;
        });
    },

    preload: function(types) {
        var self = this;
        return Promise.all(types.map(function(type) {
            return self.get(type);
        }));
    },

    invalidate: function(type) {
        var prefix = type ? type + '_' : '';
        Object.keys(this.cache).forEach(function(key) {
            if (!type || key.indexOf(prefix) === 0) {
                delete DatasourceManager.cache[key];
                delete DatasourceManager.cacheExpiry[key];
            }
        });
    }
};

// Export
window.DatasourceManager = DatasourceManager;
```

**Preload on Form Load in View.Review.js:**

```javascript
// In loadData() after getting form schema:
loadData: function() {
    var self = this;

    Promise.all([
        API.get('document', { id: this.docId }),
        API.get('formschema', { transactionType: this.transactionType }),
        // Preload common datasources
        DatasourceManager.preload(['accounts', 'departments', 'classes', 'locations'])
    ]).then(function(results) {
        self.document = results[0].data;
        self.formFields = results[1].data;
        self.render();
    });
}
```

---

### 2.3 Settings UI - Form Configuration (15% Complete)

**Current State:**
- Basic threshold slider
- Cache clear button
- **Missing:** Form configuration section, XML upload, form builder, capture toggle

**Proposed: Enhanced Settings Template**

Add to `app_index.html` after the Cache Management card:

```html
<!-- Form Configuration Section -->
<div class="settings-card settings-card-large">
    <div class="settings-card-header">
        <i class="fas fa-file-invoice"></i>
        <div>
            <h3>Form Configuration</h3>
            <p>Configure how transaction forms render in Review</p>
        </div>
    </div>
    <div class="settings-card-body">
        <!-- Transaction Type Tabs -->
        <div class="form-config-tabs">
            <button class="config-tab active" data-type="vendorbill">Vendor Bill</button>
            <button class="config-tab" data-type="expensereport">Expense Report</button>
        </div>

        <!-- Configuration Panel -->
        <div class="form-config-panel" id="form-config-panel">
            <!-- Source Selection -->
            <div class="config-source-section">
                <h4>Form Definition Source</h4>

                <!-- Option 1: Auto Capture -->
                <div class="source-option">
                    <input type="radio" name="form-source" value="capture" id="source-capture">
                    <label for="source-capture">
                        <i class="fas fa-magic"></i>
                        <div>
                            <span class="source-title">Automatic Capture</span>
                            <span class="source-desc">Client script extracts layout from NetSuite forms</span>
                        </div>
                    </label>
                    <div class="capture-controls" id="capture-controls" style="display:none;">
                        <div class="capture-status">
                            <span class="status-icon" id="capture-status-icon"><i class="fas fa-check-circle"></i></span>
                            <span id="capture-status-text">Last captured: Never</span>
                        </div>
                        <div class="capture-actions">
                            <button class="btn btn-sm btn-secondary" id="btn-enable-capture">
                                <i class="fas fa-play"></i> Enable Capture
                            </button>
                            <button class="btn btn-sm btn-primary" id="btn-trigger-capture">
                                <i class="fas fa-external-link-alt"></i> Open Form
                            </button>
                        </div>
                    </div>
                </div>

                <!-- Option 2: XML Upload -->
                <div class="source-option">
                    <input type="radio" name="form-source" value="xml" id="source-xml">
                    <label for="source-xml">
                        <i class="fas fa-file-code"></i>
                        <div>
                            <span class="source-title">Upload Form XML</span>
                            <span class="source-desc">Upload NetSuite form definition XML</span>
                        </div>
                    </label>
                    <div class="xml-controls" id="xml-controls" style="display:none;">
                        <div class="file-upload-zone" id="xml-drop-zone">
                            <i class="fas fa-cloud-upload-alt"></i>
                            <p>Drag & drop form XML or <button class="btn-link" id="btn-browse-xml">browse</button></p>
                            <input type="file" accept=".xml" id="xml-file-input" hidden>
                        </div>
                        <div class="xml-preview" id="xml-preview" style="display:none;">
                            <div class="xml-info" id="xml-info"></div>
                            <button class="btn btn-primary" id="btn-import-xml">Import Form</button>
                        </div>
                    </div>
                </div>

                <!-- Option 3: Manual -->
                <div class="source-option">
                    <input type="radio" name="form-source" value="manual" id="source-manual">
                    <label for="source-manual">
                        <i class="fas fa-edit"></i>
                        <div>
                            <span class="source-title">Manual Configuration</span>
                            <span class="source-desc">Manually configure fields, groups, and tabs</span>
                        </div>
                    </label>
                    <div class="manual-controls" id="manual-controls" style="display:none;">
                        <button class="btn btn-secondary" id="btn-open-builder">
                            <i class="fas fa-tools"></i> Open Form Builder
                        </button>
                    </div>
                </div>
            </div>

            <!-- Current Form Preview -->
            <div class="form-preview-section">
                <h4>Current Configuration</h4>
                <div class="form-preview" id="form-preview">
                    <div class="preview-placeholder">
                        <i class="fas fa-file-alt"></i>
                        <p>Select a transaction type to view configuration</p>
                    </div>
                </div>
            </div>
        </div>
    </div>
</div>

<!-- Form Builder Modal -->
<div class="modal" id="form-builder-modal">
    <div class="modal-content modal-xl">
        <div class="modal-header">
            <h3><i class="fas fa-tools"></i> Form Builder</h3>
            <button class="btn btn-ghost btn-icon" id="btn-close-builder">
                <i class="fas fa-times"></i>
            </button>
        </div>
        <div class="modal-body">
            <div class="form-builder-layout">
                <!-- Tabs Panel -->
                <div class="builder-panel">
                    <div class="panel-header">
                        <h4>Tabs</h4>
                        <button class="btn btn-sm btn-ghost" id="btn-add-tab">
                            <i class="fas fa-plus"></i>
                        </button>
                    </div>
                    <div class="sortable-list" id="builder-tabs"></div>
                </div>

                <!-- Field Groups Panel -->
                <div class="builder-panel">
                    <div class="panel-header">
                        <h4>Field Groups</h4>
                        <button class="btn btn-sm btn-ghost" id="btn-add-group">
                            <i class="fas fa-plus"></i>
                        </button>
                    </div>
                    <div class="sortable-list" id="builder-groups"></div>
                </div>

                <!-- Fields Panel -->
                <div class="builder-panel builder-panel-wide">
                    <div class="panel-header">
                        <h4>Fields</h4>
                        <button class="btn btn-sm btn-ghost" id="btn-add-field">
                            <i class="fas fa-plus"></i>
                        </button>
                    </div>
                    <div class="field-list" id="builder-fields"></div>
                </div>

                <!-- Sublists Panel -->
                <div class="builder-panel">
                    <div class="panel-header">
                        <h4>Sublists</h4>
                    </div>
                    <div class="sublist-list" id="builder-sublists"></div>
                </div>
            </div>
        </div>
        <div class="modal-footer">
            <button class="btn btn-secondary" id="btn-cancel-builder">Cancel</button>
            <button class="btn btn-primary" id="btn-save-builder">
                <i class="fas fa-save"></i> Save Configuration
            </button>
        </div>
    </div>
</div>
```

---

### 2.4 View.Settings.js - Form Configuration Controller (0% Complete)

**Proposed: Enhanced Settings Controller**

```javascript
/**
 * Flux Capture - Enhanced Settings View Controller
 */
(function() {
    'use strict';

    var SettingsController = {
        currentFormType: 'vendorbill',
        formConfig: null,

        init: function() {
            renderTemplate('tpl-settings', 'view-container');
            this.bindEvents();
            this.loadFormConfig(this.currentFormType);
        },

        bindEvents: function() {
            var self = this;

            // Existing threshold slider
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

            // Clear cache button
            var clearCacheBtn = el('#btn-clear-cache');
            if (clearCacheBtn) {
                clearCacheBtn.addEventListener('click', function() {
                    self.clearFormCache();
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

            // Source radio buttons
            els('input[name="form-source"]').forEach(function(radio) {
                radio.addEventListener('change', function() {
                    self.updateSourceControls(this.value);
                });
            });

            // XML upload handlers
            var xmlInput = el('#xml-file-input');
            var browseBtn = el('#btn-browse-xml');
            var dropZone = el('#xml-drop-zone');

            if (browseBtn && xmlInput) {
                browseBtn.addEventListener('click', function(e) {
                    e.preventDefault();
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

            // Enable capture button
            var enableCaptureBtn = el('#btn-enable-capture');
            if (enableCaptureBtn) {
                enableCaptureBtn.addEventListener('click', function() {
                    self.enableCapture();
                });
            }

            // Trigger capture button
            var triggerCaptureBtn = el('#btn-trigger-capture');
            if (triggerCaptureBtn) {
                triggerCaptureBtn.addEventListener('click', function() {
                    self.triggerCapture();
                });
            }

            // Open form builder
            var builderBtn = el('#btn-open-builder');
            if (builderBtn) {
                builderBtn.addEventListener('click', function() {
                    self.openFormBuilder();
                });
            }

            // Close form builder
            var closeBuilderBtn = el('#btn-close-builder');
            var cancelBuilderBtn = el('#btn-cancel-builder');
            [closeBuilderBtn, cancelBuilderBtn].forEach(function(btn) {
                if (btn) {
                    btn.addEventListener('click', function() {
                        self.closeFormBuilder();
                    });
                }
            });

            // Save form builder
            var saveBuilderBtn = el('#btn-save-builder');
            if (saveBuilderBtn) {
                saveBuilderBtn.addEventListener('click', function() {
                    self.saveFormBuilder();
                });
            }
        },

        // ==========================================
        // FORM CONFIGURATION
        // ==========================================

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
                });
        },

        updateSourceControls: function(source) {
            // Hide all controls
            el('#capture-controls').style.display = 'none';
            el('#xml-controls').style.display = 'none';
            el('#manual-controls').style.display = 'none';

            // Show selected source controls
            if (source === 'capture') {
                el('#capture-controls').style.display = 'block';
            } else if (source === 'xml') {
                el('#xml-controls').style.display = 'block';
            } else if (source === 'manual') {
                el('#manual-controls').style.display = 'block';
            }
        },

        updateCaptureStatus: function() {
            var statusText = el('#capture-status-text');
            var statusIcon = el('#capture-status-icon');

            if (!this.formConfig || !this.formConfig.capturedAt) {
                statusText.textContent = 'Last captured: Never';
                statusIcon.innerHTML = '<i class="fas fa-exclamation-circle" style="color:var(--color-warning);"></i>';
            } else {
                var date = new Date(this.formConfig.capturedAt);
                statusText.textContent = 'Last captured: ' + date.toLocaleDateString();
                statusIcon.innerHTML = '<i class="fas fa-check-circle" style="color:var(--color-success);"></i>';
            }
        },

        renderFormPreview: function() {
            var preview = el('#form-preview');
            if (!preview) return;

            if (!this.formConfig || !this.formConfig.tabs) {
                preview.innerHTML = '<div class="preview-placeholder">' +
                    '<i class="fas fa-file-alt"></i>' +
                    '<p>No form configuration found</p>' +
                    '</div>';
                return;
            }

            var html = '<div class="form-preview-content">';

            // Show tabs
            html += '<div class="preview-tabs">';
            this.formConfig.tabs.forEach(function(tab) {
                html += '<span class="preview-tab">' + escapeHtml(tab.label || tab.id) + '</span>';
            });
            html += '</div>';

            // Show field count
            var fieldCount = 0;
            var sublistCount = 0;
            this.formConfig.tabs.forEach(function(tab) {
                if (tab.fieldGroups) {
                    tab.fieldGroups.forEach(function(g) {
                        if (g.fields) fieldCount += g.fields.length;
                    });
                }
                if (tab.sublists) sublistCount += tab.sublists.length;
            });

            html += '<div class="preview-stats">' +
                '<span><i class="fas fa-list"></i> ' + fieldCount + ' fields</span>' +
                '<span><i class="fas fa-table"></i> ' + sublistCount + ' sublists</span>' +
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
                }
            };
            reader.readAsText(file);
        },

        parseFormXml: function(xmlString) {
            var parser = new DOMParser();
            var doc = parser.parseFromString(xmlString, 'text/xml');

            // Check for parse errors
            var parseError = doc.querySelector('parsererror');
            if (parseError) {
                throw new Error('Invalid XML format');
            }

            var form = doc.querySelector('transactionForm');
            if (!form) {
                throw new Error('Not a valid NetSuite form XML');
            }

            var result = {
                formInfo: {
                    scriptId: form.getAttribute('scriptid'),
                    standard: form.getAttribute('standard'),
                    name: this.getElementText(form, 'name'),
                    recordType: this.getElementText(form, 'recordType'),
                    source: 'xml_upload'
                },
                tabs: [],
                sublists: []
            };

            // Parse main fields into first tab
            var mainTab = { id: 'main', label: 'Main', order: 0, fieldGroups: [] };

            var fieldGroups = doc.querySelectorAll('mainFields > fieldGroup');
            var self = this;
            fieldGroups.forEach(function(fg, idx) {
                mainTab.fieldGroups.push(self.parseFieldGroup(fg, idx));
            });

            result.tabs.push(mainTab);

            // Parse additional tabs
            var tabs = doc.querySelectorAll('tabs > tab');
            tabs.forEach(function(tab, idx) {
                result.tabs.push(self.parseTab(tab, idx + 1));
            });

            // Parse sublists
            var sublists = doc.querySelectorAll('subList');
            sublists.forEach(function(sl) {
                result.sublists.push(self.parseSublist(sl));
            });

            return result;
        },

        getElementText: function(parent, tagName) {
            var el = parent.querySelector(tagName);
            return el ? el.textContent : '';
        },

        parseFieldGroup: function(element, order) {
            var fields = [];
            var self = this;

            element.querySelectorAll('field').forEach(function(f) {
                fields.push(self.parseField(f));
            });

            return {
                id: element.getAttribute('scriptid') || 'group_' + order,
                label: this.getElementText(element, 'label') || 'Group ' + (order + 1),
                order: order,
                visible: this.getElementText(element, 'visible') !== 'F',
                fields: fields
            };
        },

        parseField: function(element) {
            var id = element.querySelector('[scriptid]');
            return {
                id: id ? id.getAttribute('scriptid') : element.getAttribute('id'),
                label: this.getElementText(element, 'label'),
                visible: this.getElementText(element, 'visible') !== 'F',
                mandatory: this.getElementText(element, 'mandatory') === 'T',
                displayType: this.getElementText(element, 'displayType') || 'NORMAL'
            };
        },

        parseTab: function(element, order) {
            return {
                id: element.getAttribute('scriptid') || 'tab_' + order,
                label: this.getElementText(element, 'label'),
                order: order
            };
        },

        parseSublist: function(element) {
            var columns = [];
            var self = this;

            element.querySelectorAll('column').forEach(function(col) {
                columns.push({
                    id: col.getAttribute('scriptid') || self.getElementText(col, 'id'),
                    label: self.getElementText(col, 'label'),
                    visible: self.getElementText(col, 'visible') !== 'F'
                });
            });

            return {
                id: element.getAttribute('scriptid'),
                label: this.getElementText(element, 'label'),
                columns: columns
            };
        },

        showXmlPreview: function() {
            var preview = el('#xml-preview');
            var info = el('#xml-info');

            if (!this.parsedXml) return;

            info.innerHTML = '<p><strong>Form:</strong> ' + escapeHtml(this.parsedXml.formInfo.name) + '</p>' +
                '<p><strong>Record Type:</strong> ' + escapeHtml(this.parsedXml.formInfo.recordType) + '</p>' +
                '<p><strong>Tabs:</strong> ' + this.parsedXml.tabs.length + '</p>' +
                '<p><strong>Sublists:</strong> ' + this.parsedXml.sublists.length + '</p>';

            preview.style.display = 'block';
        },

        importXmlConfig: function() {
            var self = this;

            if (!this.parsedXml) {
                UI.toast('No XML to import', 'error');
                return;
            }

            API.put('formconfig', {
                transactionType: this.currentFormType,
                config: this.parsedXml
            }).then(function() {
                UI.toast('Form configuration imported!', 'success');
                self.loadFormConfig(self.currentFormType);
                el('#xml-preview').style.display = 'none';
            }).catch(function(err) {
                UI.toast('Import failed: ' + err.message, 'error');
            });
        },

        // ==========================================
        // CAPTURE TOGGLE
        // ==========================================

        enableCapture: function() {
            var self = this;
            var btn = el('#btn-enable-capture');

            btn.disabled = true;
            btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Enabling...';

            API.put('formconfig', {
                transactionType: this.currentFormType,
                captureEnabled: true
            }).then(function() {
                btn.disabled = false;
                btn.innerHTML = '<i class="fas fa-check"></i> Capture Enabled';
                UI.toast('Capture enabled. Open a ' + self.currentFormType + ' form in NetSuite.', 'success');
            }).catch(function(err) {
                btn.disabled = false;
                btn.innerHTML = '<i class="fas fa-play"></i> Enable Capture';
                UI.toast('Error: ' + err.message, 'error');
            });
        },

        triggerCapture: function() {
            // Open NetSuite form in new tab to trigger capture
            var urls = {
                'vendorbill': '/app/accounting/transactions/vendbill.nl?whence=',
                'expensereport': '/app/accounting/transactions/exprept.nl?whence='
            };

            var url = urls[this.currentFormType];
            if (url) {
                window.open(url, '_blank');
                UI.toast('Opening NetSuite form. Layout will be captured automatically.', 'info');
            }
        },

        // ==========================================
        // FORM BUILDER
        // ==========================================

        openFormBuilder: function() {
            var modal = el('#form-builder-modal');
            if (modal) {
                modal.classList.add('active');
                this.renderFormBuilder();
            }
        },

        closeFormBuilder: function() {
            var modal = el('#form-builder-modal');
            if (modal) {
                modal.classList.remove('active');
            }
        },

        renderFormBuilder: function() {
            // Render current config into builder panels
            var tabsList = el('#builder-tabs');
            var groupsList = el('#builder-groups');
            var fieldsList = el('#builder-fields');
            var sublistsList = el('#builder-sublists');

            if (!this.formConfig) {
                tabsList.innerHTML = '<div class="empty-message">No configuration loaded</div>';
                return;
            }

            // Render tabs
            var tabsHtml = '';
            this.formConfig.tabs.forEach(function(tab) {
                tabsHtml += '<div class="builder-item" data-id="' + tab.id + '">' +
                    '<span class="drag-handle"><i class="fas fa-grip-vertical"></i></span>' +
                    '<span class="item-label">' + escapeHtml(tab.label || tab.id) + '</span>' +
                    '<button class="btn btn-ghost btn-sm"><i class="fas fa-edit"></i></button>' +
                    '</div>';
            });
            tabsList.innerHTML = tabsHtml || '<div class="empty-message">No tabs</div>';

            // Render sublists
            var sublistsHtml = '';
            if (this.formConfig.sublists) {
                this.formConfig.sublists.forEach(function(sl) {
                    sublistsHtml += '<div class="builder-item" data-id="' + sl.id + '">' +
                        '<span class="item-label">' + escapeHtml(sl.label || sl.id) + '</span>' +
                        '<span class="item-meta">' + (sl.columns ? sl.columns.length : 0) + ' columns</span>' +
                        '</div>';
                });
            }
            sublistsList.innerHTML = sublistsHtml || '<div class="empty-message">No sublists</div>';
        },

        saveFormBuilder: function() {
            // Collect builder data and save
            var self = this;

            // For now, just close and refresh
            UI.toast('Form builder save coming soon', 'info');
            this.closeFormBuilder();
        },

        // ==========================================
        // EXISTING METHODS
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
                .then(function(result) {
                    if (btn) {
                        btn.disabled = false;
                        btn.innerHTML = '<i class="fas fa-trash-alt"></i> Clear Cache';
                    }
                    if (statusRow) statusRow.style.display = 'block';
                    if (statusText) {
                        statusText.innerHTML = '<i class="fas fa-check-circle" style="color:var(--color-success);"></i> ' +
                            'Cache cleared successfully. Form layouts will be re-extracted on next form load.';
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

        saveSettings: function() {
            // Collect all settings
            var settings = {
                autoApproveThreshold: parseInt(el('#auto-threshold').value) || 85,
                defaultDocumentType: el('#default-type').value || 'auto',
                duplicateDetection: el('#duplicate-detection').checked,
                amountValidation: el('#amount-validation').checked
            };

            API.put('settings', settings)
                .then(function() {
                    UI.toast('Settings saved!', 'success');
                })
                .catch(function(err) {
                    UI.toast('Error saving settings: ' + err.message, 'error');
                });
        },

        cleanup: function() {
            // Close any open modals
            this.closeFormBuilder();
        }
    };

    Router.register('settings',
        function(params) { SettingsController.init(params); },
        function() { SettingsController.cleanup(); }
    );

    console.log('[View.Settings] Loaded');

})();
```

---

### 2.5 Capture Toggle in Client Script (0% Complete)

**Proposed: Add captureEnabled check to FC_FormLayoutCapture_CS.js**

```javascript
// Add at the beginning of pageInit():
function pageInit(context) {
    try {
        console.log('[FC_FormLayoutCapture] pageInit triggered');

        var rec = context.currentRecord;
        var recordType = rec.type;

        // Check if capture is enabled for this record type
        if (!isCaptureEnabled(recordType)) {
            console.log('[FC_FormLayoutCapture] Capture disabled for', recordType);
            return;
        }

        // ... rest of existing code
    } catch (e) {
        console.error('[FC_FormLayoutCapture] pageInit error:', e);
    }
}

/**
 * Check if capture is enabled for this record type
 */
function isCaptureEnabled(recordType) {
    try {
        // Make synchronous request to check capture status
        var restletUrl = url.resolveScript({
            scriptId: 'customscript_fc_router',
            deploymentId: 'customdeploy_fc_router'
        });

        var xhr = new XMLHttpRequest();
        xhr.open('GET', restletUrl + '&action=captureEnabled&type=' + recordType, false);
        xhr.send();

        if (xhr.status === 200) {
            var result = JSON.parse(xhr.responseText);
            return result.enabled === true;
        }

        // Default to enabled if check fails
        return true;
    } catch (e) {
        console.error('[FC_FormLayoutCapture] isCaptureEnabled error:', e);
        return true; // Default to enabled on error
    }
}
```

**Add Router Endpoint:**

```javascript
// In FC_Router.js GET handler:
case 'captureEnabled':
    result = getCaptureEnabled(context.type);
    break;

// New function:
function getCaptureEnabled(recordType) {
    try {
        var config = query.runSuiteQL({
            query: "SELECT custrecord_flux_cfg_data FROM customrecord_flux_config " +
                   "WHERE custrecord_flux_cfg_type = 'settings' " +
                   "AND custrecord_flux_cfg_key = 'capture_" + recordType + "' " +
                   "AND custrecord_flux_cfg_active = 'T'"
        }).asMappedResults();

        if (config.length > 0 && config[0].custrecord_flux_cfg_data) {
            var data = JSON.parse(config[0].custrecord_flux_cfg_data);
            return Response.success({ enabled: data.enabled !== false });
        }

        // Default to enabled
        return Response.success({ enabled: true });
    } catch (e) {
        log.error('getCaptureEnabled Error', e);
        return Response.success({ enabled: true });
    }
}
```

---

### 2.6 Form Builder CSS Styles (0% Complete)

**Add to components.css:**

```css
/* ====================================
   SETTINGS - FORM CONFIGURATION
   ==================================== */

.settings-card-large {
    grid-column: span 2;
}

.form-config-tabs {
    display: flex;
    gap: 0.5rem;
    margin-bottom: 1.5rem;
    padding-bottom: 1rem;
    border-bottom: 1px solid var(--color-border);
}

.config-tab {
    padding: 0.5rem 1rem;
    background: transparent;
    border: 1px solid var(--color-border);
    border-radius: var(--radius-md);
    cursor: pointer;
    font-size: 0.875rem;
    transition: all 0.2s;
}

.config-tab:hover {
    background: var(--color-hover);
}

.config-tab.active {
    background: var(--color-primary);
    border-color: var(--color-primary);
    color: white;
}

.config-source-section h4 {
    margin-bottom: 1rem;
    font-size: 0.875rem;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    color: var(--color-text-muted);
}

.source-option {
    padding: 1rem;
    border: 1px solid var(--color-border);
    border-radius: var(--radius-md);
    margin-bottom: 0.75rem;
}

.source-option label {
    display: flex;
    align-items: flex-start;
    gap: 0.75rem;
    cursor: pointer;
}

.source-option label i {
    font-size: 1.25rem;
    color: var(--color-primary);
    margin-top: 0.125rem;
}

.source-title {
    display: block;
    font-weight: 600;
}

.source-desc {
    display: block;
    font-size: 0.875rem;
    color: var(--color-text-muted);
}

.capture-controls,
.xml-controls,
.manual-controls {
    margin-top: 1rem;
    padding-top: 1rem;
    border-top: 1px solid var(--color-border);
}

.capture-status {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    margin-bottom: 0.75rem;
}

.capture-actions {
    display: flex;
    gap: 0.5rem;
}

/* File Upload Zone */
.file-upload-zone {
    border: 2px dashed var(--color-border);
    border-radius: var(--radius-md);
    padding: 2rem;
    text-align: center;
    transition: all 0.2s;
}

.file-upload-zone:hover,
.file-upload-zone.drag-over {
    border-color: var(--color-primary);
    background: var(--color-primary-alpha);
}

.file-upload-zone i {
    font-size: 2rem;
    color: var(--color-text-muted);
    margin-bottom: 0.5rem;
}

.xml-preview {
    margin-top: 1rem;
    padding: 1rem;
    background: var(--color-surface-alt);
    border-radius: var(--radius-md);
}

/* Form Preview */
.form-preview-section {
    margin-top: 1.5rem;
    padding-top: 1.5rem;
    border-top: 1px solid var(--color-border);
}

.form-preview-section h4 {
    margin-bottom: 1rem;
    font-size: 0.875rem;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    color: var(--color-text-muted);
}

.form-preview {
    padding: 1rem;
    background: var(--color-surface-alt);
    border-radius: var(--radius-md);
    min-height: 100px;
}

.preview-placeholder {
    text-align: center;
    color: var(--color-text-muted);
}

.preview-placeholder i {
    font-size: 2rem;
    margin-bottom: 0.5rem;
}

.preview-tabs {
    display: flex;
    gap: 0.5rem;
    margin-bottom: 1rem;
}

.preview-tab {
    padding: 0.25rem 0.75rem;
    background: var(--color-surface);
    border: 1px solid var(--color-border);
    border-radius: var(--radius-sm);
    font-size: 0.75rem;
}

.preview-stats {
    display: flex;
    gap: 1rem;
    font-size: 0.875rem;
    color: var(--color-text-muted);
}

.preview-stats i {
    margin-right: 0.25rem;
}

/* ====================================
   FORM BUILDER MODAL
   ==================================== */

.modal-xl .modal-content {
    max-width: 1200px;
    width: 90vw;
}

.form-builder-layout {
    display: grid;
    grid-template-columns: 1fr 1fr 2fr 1fr;
    gap: 1rem;
    min-height: 500px;
}

.builder-panel {
    background: var(--color-surface-alt);
    border-radius: var(--radius-md);
    overflow: hidden;
}

.builder-panel-wide {
    grid-column: span 1;
}

.panel-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 0.75rem 1rem;
    background: var(--color-surface);
    border-bottom: 1px solid var(--color-border);
}

.panel-header h4 {
    margin: 0;
    font-size: 0.875rem;
}

.sortable-list,
.field-list,
.sublist-list {
    padding: 0.5rem;
    max-height: 400px;
    overflow-y: auto;
}

.builder-item {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    padding: 0.5rem 0.75rem;
    background: var(--color-surface);
    border: 1px solid var(--color-border);
    border-radius: var(--radius-sm);
    margin-bottom: 0.5rem;
    cursor: grab;
}

.builder-item:hover {
    border-color: var(--color-primary);
}

.drag-handle {
    color: var(--color-text-muted);
    cursor: grab;
}

.item-label {
    flex: 1;
    font-size: 0.875rem;
}

.item-meta {
    font-size: 0.75rem;
    color: var(--color-text-muted);
}

.empty-message {
    padding: 1rem;
    text-align: center;
    color: var(--color-text-muted);
    font-size: 0.875rem;
}
```

---

## Part 3: Implementation Plan

### Phase 1: Typeahead & Datasource Client Integration
**Priority: HIGH** | **Effort: Medium**

1. Add typeahead event binding in `View.Review.js`
2. Add CSS styles for typeahead dropdown
3. Update body field select rendering to use typeahead
4. Add DatasourceManager to FC.Core.js
5. Test with accounts, departments, classes, locations

**Files Modified:**
- `View.Review.js` - Add ~150 lines
- `components.css` - Add ~60 lines
- `FC.Core.js` - Add ~50 lines

### Phase 2: Settings UI - Form Configuration
**Priority: MEDIUM** | **Effort: High**

1. Add form configuration section to `tpl-settings` template
2. Enhance `View.Settings.js` with form config methods
3. Implement XML parser (client-side)
4. Add form preview rendering
5. Add basic form builder modal
6. Add CSS styles

**Files Modified:**
- `app_index.html` - Add ~120 lines to template
- `View.Settings.js` - Rewrite to ~400 lines
- `components.css` - Add ~200 lines

### Phase 3: Capture Toggle System
**Priority: LOW** | **Effort: Low**

1. Add `captureEnabled` endpoint to FC_Router.js
2. Update FC_FormLayoutCapture_CS.js with toggle check
3. Wire up enable/disable buttons in Settings

**Files Modified:**
- `FC_Router.js` - Add ~30 lines
- `FC_FormLayoutCapture_CS.js` - Add ~25 lines

---

## Summary

| Phase | Description | Status | Files | Est. Lines |
|-------|-------------|--------|-------|------------|
| 1 | Typeahead Client Integration | TODO | 3 | ~260 |
| 2 | Settings UI Form Config | TODO | 3 | ~720 |
| 3 | Capture Toggle System | TODO | 2 | ~55 |

**Total New Code:** ~1,035 lines
**Total Files Modified:** 6 files

The backend infrastructure (datasource API, config record, form capture) is **fully complete**. The remaining work is entirely **client-side UI/UX enhancements** to expose the existing functionality through the Settings interface.
