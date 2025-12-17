/**
 * FormLayoutExtractor - Client-side DOM extraction for NetSuite forms
 *
 * Extracts the actual form layout (tabs, groups, fields, visibility) from
 * a rendered NetSuite transaction form.
 *
 * Usage:
 * 1. Load this script on a NetSuite transaction form page
 * 2. Call FormLayoutExtractor.extract() to get the layout
 * 3. Send to saveformlayout API endpoint
 */
(function(global) {
    'use strict';

    var FormLayoutExtractor = {

        /**
         * Extract complete form layout from current page DOM
         * @returns {Object} Layout structure with tabs, groups, fields
         */
        extract: function() {
            var layout = {
                tabs: [],
                sublists: [],
                extractedAt: new Date().toISOString(),
                formId: this.getFormId(),
                recordType: this.getRecordType()
            };

            // Extract tabs
            layout.tabs = this.extractTabs();

            // Extract sublists
            layout.sublists = this.extractSublists();

            return layout;
        },

        /**
         * Get the form ID from the page
         */
        getFormId: function() {
            // Try multiple methods to get form ID
            var formField = document.getElementById('customform');
            if (formField) {
                return formField.value;
            }

            // Try from URL
            var urlParams = new URLSearchParams(window.location.search);
            var cf = urlParams.get('cf') || urlParams.get('customform');
            if (cf) return cf;

            // Try from hidden field
            var hiddenForm = document.querySelector('input[name="customform"]');
            if (hiddenForm) return hiddenForm.value;

            return null;
        },

        /**
         * Get the record type from the page
         */
        getRecordType: function() {
            // Try from URL
            var urlParams = new URLSearchParams(window.location.search);
            var recType = urlParams.get('rectype') || urlParams.get('type');
            if (recType) return recType.toLowerCase();

            // Try from page context
            if (typeof nlapiGetRecordType === 'function') {
                try {
                    return nlapiGetRecordType();
                } catch (e) {}
            }

            // Try to infer from URL path
            var path = window.location.pathname;
            if (path.includes('vendorbill')) return 'vendorbill';
            if (path.includes('expensereport')) return 'expensereport';
            if (path.includes('vendorcredit')) return 'vendorcredit';
            if (path.includes('purchaseorder')) return 'purchaseorder';

            return null;
        },

        /**
         * Extract all tabs from the form
         */
        extractTabs: function() {
            var tabs = [];
            var tabIdx = 0;

            // NetSuite uses different tab structures - try multiple selectors
            var tabContainers = document.querySelectorAll(
                '.uir-machine-headerrow, ' +
                '.machine_headerrow, ' +
                '[data-tab-id], ' +
                '.uir_tab'
            );

            // If no machine tabs, look for the main content areas
            if (tabContainers.length === 0) {
                // Single tab form - extract as "Main" tab
                var mainTab = this.extractMainTab();
                if (mainTab) {
                    tabs.push(mainTab);
                }
                return tabs;
            }

            // Extract each tab
            tabContainers.forEach(function(tabEl, idx) {
                var tabId = tabEl.getAttribute('data-tab-id') ||
                           tabEl.id ||
                           'tab_' + idx;

                var tabLabel = this.getTabLabel(tabEl) || 'Tab ' + (idx + 1);

                var tab = {
                    id: tabId,
                    label: tabLabel,
                    displayOrder: idx,
                    fieldGroups: this.extractFieldGroups(tabEl),
                    sublists: this.getSublistsInTab(tabEl)
                };

                tabs.push(tab);
            }.bind(this));

            // If no tabs found, create default Main tab
            if (tabs.length === 0) {
                tabs.push(this.extractMainTab());
            }

            return tabs;
        },

        /**
         * Extract the main tab when there's no tab structure
         */
        extractMainTab: function() {
            var mainContent = document.querySelector(
                '#main_form, ' +
                '.uir-machine-table-container, ' +
                '#div__body, ' +
                'form[name="main_form"]'
            ) || document.body;

            return {
                id: 'main',
                label: 'Main',
                displayOrder: 0,
                fieldGroups: this.extractFieldGroups(mainContent),
                sublists: this.getAllSublistIds()
            };
        },

        /**
         * Get tab label from tab element
         */
        getTabLabel: function(tabEl) {
            // Try various label sources
            var label = tabEl.getAttribute('data-tab-label') ||
                       tabEl.getAttribute('title');

            if (!label) {
                var labelEl = tabEl.querySelector('.uir-machine-header-text, .tab-text, a');
                if (labelEl) {
                    label = labelEl.textContent.trim();
                }
            }

            return label;
        },

        /**
         * Extract field groups within a container
         */
        extractFieldGroups: function(container) {
            var groups = [];
            var groupIdx = 0;

            // Look for fieldsets and field group containers
            var groupElements = container.querySelectorAll(
                'fieldset, ' +
                '.uir-field-group, ' +
                '.uir-machine-row-group, ' +
                '[data-field-group]'
            );

            if (groupElements.length === 0) {
                // No explicit groups - create one group with all fields
                var allFields = this.extractFieldsFromContainer(container);
                if (allFields.length > 0) {
                    groups.push({
                        id: 'main_fields',
                        label: 'Fields',
                        displayOrder: 0,
                        fields: allFields
                    });
                }
                return groups;
            }

            groupElements.forEach(function(groupEl, idx) {
                var groupId = groupEl.getAttribute('data-field-group') ||
                             groupEl.id ||
                             'group_' + idx;

                var groupLabel = this.getGroupLabel(groupEl) || 'Group ' + (idx + 1);
                var fields = this.extractFieldsFromContainer(groupEl);

                if (fields.length > 0) {
                    groups.push({
                        id: groupId,
                        label: groupLabel,
                        displayOrder: idx,
                        fields: fields,
                        collapsed: this.isGroupCollapsed(groupEl)
                    });
                }
            }.bind(this));

            return groups;
        },

        /**
         * Get group label
         */
        getGroupLabel: function(groupEl) {
            var legend = groupEl.querySelector('legend');
            if (legend) return legend.textContent.trim();

            var header = groupEl.querySelector('.uir-field-group-header, .group-header, h3, h4');
            if (header) return header.textContent.trim();

            return groupEl.getAttribute('data-label') || groupEl.getAttribute('title');
        },

        /**
         * Check if a group is collapsed
         */
        isGroupCollapsed: function(groupEl) {
            return groupEl.classList.contains('collapsed') ||
                   groupEl.classList.contains('uir-collapsed') ||
                   groupEl.style.display === 'none';
        },

        /**
         * Extract fields from a container
         */
        extractFieldsFromContainer: function(container) {
            var fields = [];
            var seenFields = {};

            // Find all field elements
            var fieldElements = container.querySelectorAll(
                '[data-field-name], ' +
                'input[id^="inpt_"], ' +
                'input[name], ' +
                'select[id], ' +
                'textarea[id], ' +
                '.uir-field'
            );

            fieldElements.forEach(function(fieldEl) {
                var fieldId = this.getFieldId(fieldEl);
                if (!fieldId || seenFields[fieldId]) return;

                // Skip system fields
                if (this.isSystemField(fieldId)) return;

                // Check visibility
                var isVisible = this.isFieldVisible(fieldEl);

                seenFields[fieldId] = true;
                fields.push(fieldId);
            }.bind(this));

            return fields;
        },

        /**
         * Get field ID from element
         */
        getFieldId: function(fieldEl) {
            // Try data attribute first
            var fieldName = fieldEl.getAttribute('data-field-name');
            if (fieldName) return fieldName;

            // Try ID
            var id = fieldEl.id;
            if (id) {
                // Clean up NetSuite's ID prefixes
                id = id.replace(/^inpt_/, '')
                       .replace(/^txt_/, '')
                       .replace(/_display$/, '')
                       .replace(/_fs$/, '')
                       .replace(/_val$/, '');
                return id;
            }

            // Try name
            return fieldEl.name;
        },

        /**
         * Check if field is a system field to skip
         */
        isSystemField: function(fieldId) {
            var systemFields = [
                'ntype', 'nsapiCT', 'recordtype', 'customform',
                'entryformquerystring', '_csrf', 'wfinstances',
                'id', 'sys_id', 'selectedtab', 'type'
            ];
            return systemFields.indexOf(fieldId) !== -1;
        },

        /**
         * Check if a field is visible
         */
        isFieldVisible: function(fieldEl) {
            // Check computed style
            var style = window.getComputedStyle(fieldEl);
            if (style.display === 'none' || style.visibility === 'hidden') {
                return false;
            }

            // Check parent visibility
            var parent = fieldEl.closest('tr, .uir-field-wrapper, .field-wrapper');
            if (parent) {
                var parentStyle = window.getComputedStyle(parent);
                if (parentStyle.display === 'none') {
                    return false;
                }
            }

            return true;
        },

        /**
         * Extract sublist configurations
         */
        extractSublists: function() {
            var sublists = [];

            // Find sublist containers
            var sublistElements = document.querySelectorAll(
                '[data-sublist-id], ' +
                '.uir-machine-table, ' +
                '.machine, ' +
                'table.uir-sublist'
            );

            sublistElements.forEach(function(sublistEl, idx) {
                var sublistId = sublistEl.getAttribute('data-sublist-id') ||
                               this.inferSublistId(sublistEl) ||
                               'sublist_' + idx;

                var columns = this.extractSublistColumns(sublistEl);

                sublists.push({
                    id: sublistId,
                    label: this.getSublistLabel(sublistEl) || sublistId,
                    visibleColumns: columns.visible,
                    columnOrder: columns.order,
                    allColumns: columns.all
                });
            }.bind(this));

            return sublists;
        },

        /**
         * Infer sublist ID from element
         */
        inferSublistId: function(sublistEl) {
            var id = sublistEl.id;
            if (id) {
                if (id.includes('expense')) return 'expense';
                if (id.includes('item')) return 'item';
                if (id.includes('line')) return 'line';
            }

            var className = sublistEl.className;
            if (className.includes('expense')) return 'expense';
            if (className.includes('item')) return 'item';

            return null;
        },

        /**
         * Get sublist label
         */
        getSublistLabel: function(sublistEl) {
            var header = sublistEl.previousElementSibling;
            if (header && header.tagName === 'H3') {
                return header.textContent.trim();
            }

            var caption = sublistEl.querySelector('caption');
            if (caption) return caption.textContent.trim();

            return null;
        },

        /**
         * Extract sublist column configuration
         */
        extractSublistColumns: function(sublistEl) {
            var visible = [];
            var order = [];
            var all = [];

            // Find header row
            var headerRow = sublistEl.querySelector('thead tr, .uir-machine-headerrow, .machine_headerrow tr');
            if (!headerRow) {
                headerRow = sublistEl.querySelector('tr:first-child');
            }

            if (!headerRow) return { visible: [], order: [], all: [] };

            var cells = headerRow.querySelectorAll('th, td');
            cells.forEach(function(cell, idx) {
                var colId = cell.getAttribute('data-column') ||
                           cell.getAttribute('data-field') ||
                           this.inferColumnId(cell);

                if (!colId) return;

                all.push(colId);
                order.push(colId);

                // Check if column is visible
                var style = window.getComputedStyle(cell);
                if (style.display !== 'none' && style.visibility !== 'hidden') {
                    visible.push(colId);
                }
            }.bind(this));

            return { visible: visible, order: order, all: all };
        },

        /**
         * Infer column ID from header cell
         */
        inferColumnId: function(cell) {
            var text = cell.textContent.trim().toLowerCase();

            // Common column mappings
            var mappings = {
                'account': 'account',
                'amount': 'amount',
                'memo': 'memo',
                'description': 'description',
                'quantity': 'quantity',
                'qty': 'quantity',
                'rate': 'rate',
                'price': 'rate',
                'item': 'item',
                'department': 'department',
                'dept': 'department',
                'class': 'class',
                'location': 'location',
                'loc': 'location',
                'customer': 'customer',
                'tax code': 'taxcode',
                'tax': 'taxcode'
            };

            return mappings[text] || null;
        },

        /**
         * Get all sublist IDs on the page
         */
        getAllSublistIds: function() {
            var ids = [];
            var sublists = this.extractSublists();
            sublists.forEach(function(sl) {
                ids.push(sl.id);
            });
            return ids;
        },

        /**
         * Get sublist IDs within a tab element
         */
        getSublistsInTab: function(tabEl) {
            var ids = [];
            var sublists = tabEl.querySelectorAll(
                '[data-sublist-id], .uir-machine-table, .machine'
            );
            sublists.forEach(function(sl) {
                var id = sl.getAttribute('data-sublist-id') || this.inferSublistId(sl);
                if (id) ids.push(id);
            }.bind(this));
            return ids;
        },

        /**
         * Save extracted layout to server
         * @param {string} apiUrl - The API endpoint URL
         * @param {Object} layout - The extracted layout (optional, will extract if not provided)
         */
        saveToServer: function(apiUrl, layout) {
            layout = layout || this.extract();

            return fetch(apiUrl, {
                method: 'PUT',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    action: 'saveformlayout',
                    transactionType: layout.recordType,
                    formId: layout.formId,
                    layout: layout
                })
            })
            .then(function(response) {
                return response.json();
            })
            .then(function(data) {
                console.log('Layout saved:', data);
                return data;
            })
            .catch(function(error) {
                console.error('Error saving layout:', error);
                throw error;
            });
        }
    };

    // Export
    if (typeof module !== 'undefined' && module.exports) {
        module.exports = FormLayoutExtractor;
    } else {
        global.FormLayoutExtractor = FormLayoutExtractor;
    }

})(typeof window !== 'undefined' ? window : this);
