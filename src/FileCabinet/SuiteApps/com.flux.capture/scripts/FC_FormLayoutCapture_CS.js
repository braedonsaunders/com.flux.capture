/**
 * @NApiVersion 2.1
 * @NScriptType ClientScript
 * @NModuleScope Public
 *
 * FC_FormLayoutCapture_CS.js - Automatic Form Layout Extraction
 *
 * Deployed on transaction forms (vendorbill, expensereport, purchaseorder)
 * Automatically extracts form layout (tabs, groups, fields, visibility)
 * on pageInit and sends to Flux Capture API for caching.
 */

define(['N/currentRecord', 'N/url'],
function(currentRecord, url) {
    'use strict';

    // Cache check - only extract once per form per session
    var EXTRACTED_FORMS = {};

    // System/internal fields to always skip
    var SKIP_FIELDS = [
        'ntype', 'recordtype', 'nsapiCT', 'customform', 'entryformquerystring',
        '_csrf', 'wfinstances', 'id', 'sys_id', 'selectedtab', 'type',
        'baserecordtype', 'nsapiFC', 'nsapiPS', 'nsapiVF', 'nsapiPI',
        'nsapiSR', 'nsapiLI', 'nsapiVD', 'nsapiRC', 'nsapiPD', 'nlrole',
        'submitted', 'nextbill', 'nexttransaction', 'void', 'voided',
        'nlapiSR', 'nlapiPI', 'nlapiVF', 'nlapiPS', 'nlapiFC', 'nlapiVD',
        'nlapiLI', 'nlapiRC', 'wfPI', 'wfVF', 'wfFC', 'wfPS', 'wfSR',
        'nkey', 'nsapiPI2', 'externalid', 'isinactive', 'internalid',
        'whence', 'wfSR', 'selectedtab', 'e', 'l', 'cf', 'prevdate',
        'currentrecord', 'memdoc', 'undefined'
    ];

    // Patterns for system field IDs
    var SKIP_PATTERNS = [
        /^nsapi/i, /^sys_/i, /^wf[A-Z]/, /^nlapi/i, /^_/, /^hddn/i,
        /^sps/, /^nlmulti/, /^machine\d/, /^row\d/, /^intr_/,
        /recmachcustrecord/, /recmachine/, /^cmb_/, /^popup_/
    ];

    /**
     * Page Init - Extract form layout automatically
     */
    function pageInit(context) {
        try {
            console.log('[FC_FormLayoutCapture] === SCRIPT LOADED ===');
            console.log('[FC_FormLayoutCapture] pageInit triggered, mode:', context.mode);

            var rec = context.currentRecord;
            var recordType = rec.type;
            var formId = getFormId(rec);

            console.log('[FC_FormLayoutCapture] Record type:', recordType, 'Form ID:', formId);

            // Skip if already extracted this session
            var cacheKey = recordType + '_' + (formId || 'default');
            if (EXTRACTED_FORMS[cacheKey]) {
                console.log('[FC_FormLayoutCapture] Already extracted this session:', cacheKey);
                return;
            }

            // Wait for DOM to render, then extract
            setTimeout(function() {
                extractAndSaveLayout(recordType, formId, cacheKey);
            }, 2000);

        } catch (e) {
            console.error('[FC_FormLayoutCapture] pageInit error:', e);
        }
    }

    /**
     * Get form ID from record
     */
    function getFormId(rec) {
        try {
            return rec.getValue({ fieldId: 'customform' });
        } catch (e) {
            return null;
        }
    }

    /**
     * Extract layout from DOM and save to server
     */
    function extractAndSaveLayout(recordType, formId, cacheKey) {
        try {
            console.log('[FC_FormLayoutCapture] Extracting layout...');

            var layout = extractFormLayout(recordType, formId);

            if (!layout || !layout.tabs || layout.tabs.length === 0) {
                console.log('[FC_FormLayoutCapture] No layout extracted');
                return;
            }

            // Log extracted fields for debugging
            console.log('[FC_FormLayoutCapture] === EXTRACTION SUMMARY ===');
            layout.tabs.forEach(function(tab) {
                console.log('[FC_FormLayoutCapture] Tab:', tab.label);
                tab.fieldGroups.forEach(function(group) {
                    console.log('[FC_FormLayoutCapture]   Group:', group.label, '(' + group.fields.length + ' fields)');
                    group.fields.forEach(function(f) {
                        var info = f.id + ' [' + f.type + ']';
                        if (f.required) info += ' *required*';
                        if (f.mode === 'view') info += ' (readonly)';
                        console.log('[FC_FormLayoutCapture]     -', info, ':', f.label);
                    });
                });
                if (tab.sublists && tab.sublists.length > 0) {
                    console.log('[FC_FormLayoutCapture]   Tab sublists:', tab.sublists.join(', '));
                }
            });
            console.log('[FC_FormLayoutCapture] Sublists found:', layout.sublists.length);
            layout.sublists.forEach(function(sl) {
                console.log('[FC_FormLayoutCapture]   Sublist:', sl.id, '- Columns:', sl.visibleColumns.join(', '));
            });

            // Get RESTlet URL
            var restletUrl = url.resolveScript({
                scriptId: 'customscript_fc_router',
                deploymentId: 'customdeploy_fc_router'
            });

            console.log('[FC_FormLayoutCapture] Saving to:', restletUrl);

            // Save to server using XHR
            var xhr = new XMLHttpRequest();
            xhr.open('PUT', restletUrl, true);
            xhr.setRequestHeader('Content-Type', 'application/json');
            xhr.onreadystatechange = function() {
                if (xhr.readyState === 4) {
                    if (xhr.status === 200) {
                        EXTRACTED_FORMS[cacheKey] = true;
                        console.log('[FC_FormLayoutCapture] Layout saved successfully');
                    } else {
                        console.error('[FC_FormLayoutCapture] Save failed:', xhr.status, xhr.responseText);
                    }
                }
            };
            xhr.send(JSON.stringify({
                action: 'saveformlayout',
                transactionType: recordType,
                formId: formId,
                layout: layout
            }));

        } catch (e) {
            console.error('[FC_FormLayoutCapture] Extract error:', e);
        }
    }

    /**
     * Extract form layout from DOM
     */
    function extractFormLayout(recordType, formId) {
        var layout = {
            tabs: [],
            sublists: [],
            extractedAt: new Date().toISOString(),
            formId: formId,
            recordType: recordType
        };

        // Find NetSuite's main form
        var mainForm = document.querySelector('form[name="main_form"], #main_form');
        if (!mainForm) {
            mainForm = document.body;
        }

        // Extract tabs from NetSuite tab structure
        var tabs = extractTabs(mainForm);

        if (tabs.length === 0) {
            // No tabs found - create a single main tab
            // First try to extract field groups
            var fieldGroups = extractFieldGroups(mainForm);

            // If no field groups found, extract all fields into a default group
            if (fieldGroups.length === 0) {
                var fields = extractFieldsFromContainer(mainForm);
                fieldGroups = [{
                    id: 'primary',
                    label: 'Primary Information',
                    displayOrder: 0,
                    collapsed: false,
                    fields: fields
                }];
            }

            tabs.push({
                id: 'main',
                label: 'Main',
                displayOrder: 0,
                fieldGroups: fieldGroups,
                sublists: []
            });
        }

        // Extract sublists
        var sublists = extractSublists(mainForm);

        // Add sublist IDs to appropriate tabs
        if (tabs.length > 0 && sublists.length > 0) {
            tabs[0].sublists = sublists.map(function(sl) { return sl.id; });
        }

        layout.tabs = tabs;
        layout.sublists = sublists;

        return layout;
    }

    /**
     * Extract tabs from NetSuite form
     */
    function extractTabs(container) {
        var tabs = [];

        // NetSuite tab links
        var tabLinks = container.querySelectorAll('.uir-machine-headerrow a, .tabBnt, .uir_tab, [id^="maintab"]');

        if (tabLinks.length === 0) {
            return tabs; // No tabs, will use default
        }

        tabLinks.forEach(function(link, idx) {
            var tabLabel = (link.textContent || '').trim();
            if (!tabLabel || tabLabel.length > 50) return;

            var tabId = link.id || 'tab_' + idx;

            // Find the tab content
            var tabContent = findTabContent(tabId, container);

            // Extract field groups within this tab
            var fieldGroups = tabContent ? extractFieldGroups(tabContent) : [];

            // If no field groups found, create a default one with all fields
            if (fieldGroups.length === 0 && tabContent) {
                var fields = extractFieldsFromContainer(tabContent);
                fieldGroups = [{
                    id: 'group_' + idx,
                    label: tabLabel,
                    displayOrder: 0,
                    collapsed: false,
                    fields: fields
                }];
            }

            tabs.push({
                id: tabId,
                label: tabLabel,
                displayOrder: idx,
                fieldGroups: fieldGroups,
                sublists: []
            });
        });

        return tabs;
    }

    /**
     * Extract field groups from container using data attributes
     * NetSuite field groups have data-nsps-type="fieldgroup" and data-nsps-label
     */
    function extractFieldGroups(container) {
        var fieldGroups = [];

        // Find field group headers
        var groupHeaders = container.querySelectorAll('[data-nsps-type="fieldgroup"]');

        console.log('[FC_FormLayoutCapture] Found', groupHeaders.length, 'field groups');

        groupHeaders.forEach(function(header, idx) {
            var groupLabel = header.getAttribute('data-nsps-label') || 'Group ' + (idx + 1);
            var groupId = header.getAttribute('data-nsps-id') || header.id || 'fieldgroup_' + idx;
            var isCollapsed = header.getAttribute('aria-expanded') === 'false';

            // Find the content row that follows this group header
            // NetSuite uses tr.uir-fieldgroup-content with id="tr_" + header.id
            var contentRow = null;
            if (header.id) {
                contentRow = container.querySelector('#tr_' + header.id);
            }
            if (!contentRow) {
                // Try to find the next sibling row
                var parentRow = header.closest('tr');
                if (parentRow) {
                    contentRow = parentRow.nextElementSibling;
                }
            }

            // Extract fields from this group's content
            var fields = [];
            if (contentRow) {
                fields = extractFieldsFromContainer(contentRow);
            }

            console.log('[FC_FormLayoutCapture] Group:', groupLabel, '| Fields:', fields.length, '| Collapsed:', isCollapsed);

            fieldGroups.push({
                id: groupId,
                label: groupLabel,
                displayOrder: idx,
                collapsed: isCollapsed,
                fields: fields
            });
        });

        return fieldGroups;
    }

    /**
     * Find tab content container
     */
    function findTabContent(tabId, container) {
        // Try common NetSuite patterns
        var content = container.querySelector('[data-tab="' + tabId + '"], #' + tabId + '_content, #' + tabId + 'div');
        return content;
    }

    /**
     * Extract fields from a container using NetSuite's data attributes
     * Returns array of field objects with id, label, type, required, mode
     */
    function extractFieldsFromContainer(container) {
        var fields = [];
        var seen = {};

        // NetSuite wraps each field in a div with data attributes
        // data-field-name = field ID (e.g., "entity", "trandate", "memo")
        // data-nsps-label = display label (e.g., "Vendor", "Date", "Memo")
        // data-field-type = field type (select, date, text, currency, checkbox, textarea)
        // data-required = "true" or "false"
        // data-mode = "edit" or "view"
        var fieldWrappers = container.querySelectorAll('div.uir-field-wrapper[data-field-name]');

        console.log('[FC_FormLayoutCapture] Found', fieldWrappers.length, 'field wrappers with data-field-name');

        fieldWrappers.forEach(function(wrapper) {
            var fieldId = wrapper.getAttribute('data-field-name');
            if (!fieldId || seen[fieldId]) return;
            if (shouldSkipField(fieldId)) return;

            // Check visibility
            if (!isElementVisible(wrapper)) return;

            var fieldLabel = wrapper.getAttribute('data-nsps-label') || fieldId;
            var fieldType = wrapper.getAttribute('data-field-type') || 'text';
            var isRequired = wrapper.getAttribute('data-required') === 'true';
            var mode = wrapper.getAttribute('data-mode') || 'edit';

            seen[fieldId] = true;
            fields.push({
                id: fieldId,
                label: fieldLabel,
                type: fieldType,
                required: isRequired,
                mode: mode
            });

            console.log('[FC_FormLayoutCapture] Field:', fieldId, '| Label:', fieldLabel, '| Type:', fieldType, '| Required:', isRequired);
        });

        // Fallback: if no data attributes found, try legacy extraction
        if (fields.length === 0) {
            console.log('[FC_FormLayoutCapture] No data-field-name wrappers found, trying legacy extraction...');
            fields = extractFieldsLegacy(container);
        }

        console.log('[FC_FormLayoutCapture] Extracted', fields.length, 'fields');
        return fields;
    }

    /**
     * Legacy field extraction for older NetSuite versions
     */
    function extractFieldsLegacy(container) {
        var fields = [];
        var seen = {};

        var inputs = container.querySelectorAll('input[id]:not([type="hidden"]), select[id], textarea[id]');
        inputs.forEach(function(input) {
            var fieldId = cleanFieldId(input.id);
            if (!fieldId || seen[fieldId]) return;
            if (shouldSkipField(fieldId)) return;

            var row = input.closest('tr');
            if (row && !isElementVisible(row)) return;
            if (!isElementVisible(input)) return;

            // Try to find label
            var labelText = null;
            if (row) {
                var labelCell = row.querySelector('td.labelSpanEdit, td.labeltd, .uir-label');
                if (labelCell) {
                    labelText = getLabelText(labelCell);
                }
            }

            seen[fieldId] = true;
            fields.push({
                id: fieldId,
                label: labelText || fieldId,
                type: 'text',
                required: false,
                mode: 'edit'
            });
        });

        return fields;
    }

    /**
     * Extract label text from a label cell (legacy fallback)
     */
    function getLabelText(labelCell) {
        if (!labelCell) return null;

        var text = '';
        labelCell.childNodes.forEach(function(node) {
            if (node.nodeType === Node.TEXT_NODE) {
                text += node.textContent;
            } else if (node.nodeType === Node.ELEMENT_NODE) {
                var tagName = node.tagName.toLowerCase();
                if (tagName === 'span' && !node.classList.contains('help')) {
                    text += node.textContent;
                }
            }
        });

        text = text.trim();
        text = text.replace(/[\*:]+$/, '').trim();

        return text || null;
    }

    /**
     * Check if element is visible
     */
    function isElementVisible(el) {
        if (!el) return false;

        // Check for hidden attribute
        if (el.hidden) return false;

        // Check inline style
        if (el.style.display === 'none' || el.style.visibility === 'hidden') return false;

        // Check computed style
        var style = window.getComputedStyle(el);
        if (style.display === 'none' || style.visibility === 'hidden') return false;

        // Check dimensions (0 width/height usually means hidden)
        var rect = el.getBoundingClientRect();
        if (rect.width === 0 && rect.height === 0) return false;

        return true;
    }

    /**
     * Clean field ID from NetSuite prefixes/suffixes
     */
    function cleanFieldId(id) {
        if (!id) return null;

        return id.replace(/^inpt_/, '')
                 .replace(/^txt_/, '')
                 .replace(/^hddn_/, '')
                 .replace(/_display$/, '')
                 .replace(/_fs$/, '')
                 .replace(/_fs_lkp$/, '')
                 .replace(/_val$/, '')
                 .replace(/_formattedValue$/, '')
                 .replace(/_send$/, '');
    }

    /**
     * Check if field should be skipped
     */
    function shouldSkipField(fieldId) {
        if (!fieldId) return true;

        // Check exact matches
        if (SKIP_FIELDS.indexOf(fieldId.toLowerCase()) !== -1) return true;

        // Check patterns
        for (var i = 0; i < SKIP_PATTERNS.length; i++) {
            if (SKIP_PATTERNS[i].test(fieldId)) return true;
        }

        return false;
    }

    /**
     * Extract sublists from the form
     */
    function extractSublists(container) {
        var sublists = [];
        var seen = {};

        console.log('[FC_FormLayoutCapture] Looking for sublists...');

        // NetSuite sublists have data-nsps-type="sublist" attribute on the table
        var sublistTables = container.querySelectorAll('table[data-nsps-type="sublist"]');
        console.log('[FC_FormLayoutCapture] Found', sublistTables.length, 'tables with data-nsps-type="sublist"');

        sublistTables.forEach(function(table) {
            // Get sublist ID from data attribute
            var sublistId = table.getAttribute('data-nsps-id');
            if (!sublistId || seen[sublistId]) return;

            seen[sublistId] = true;

            var columns = extractSublistColumns(table);
            console.log('[FC_FormLayoutCapture] Sublist', sublistId, 'columns:', columns);

            sublists.push({
                id: sublistId,
                label: sublistId.charAt(0).toUpperCase() + sublistId.slice(1),
                visibleColumns: columns,
                columnOrder: columns
            });
        });

        // Fallback: look for tables with _splits suffix (e.g., expense_splits, item_splits)
        if (sublists.length === 0) {
            console.log('[FC_FormLayoutCapture] No sublists found via data attribute, trying ID patterns...');

            var splitsTables = container.querySelectorAll('table[id$="_splits"]');
            splitsTables.forEach(function(table) {
                var sublistId = inferSublistId(table);
                if (!sublistId || seen[sublistId]) return;

                seen[sublistId] = true;

                var columns = extractSublistColumns(table);
                console.log('[FC_FormLayoutCapture] Sublist (fallback)', sublistId, 'columns:', columns);

                sublists.push({
                    id: sublistId,
                    label: sublistId.charAt(0).toUpperCase() + sublistId.slice(1),
                    visibleColumns: columns,
                    columnOrder: columns
                });
            });
        }

        return sublists;
    }

    /**
     * Infer sublist ID from table element
     */
    function inferSublistId(elem) {
        var id = (elem.id || '').toLowerCase();

        // Extract from _splits pattern (e.g., expense_splits -> expense)
        var splitsMatch = id.match(/^([a-z]+)_splits$/);
        if (splitsMatch) return splitsMatch[1];

        // Direct ID patterns
        if (id.includes('expense')) return 'expense';
        if (id.includes('item')) return 'item';
        if (id.includes('apply')) return 'apply';
        if (id.includes('line')) return 'line';

        return null;
    }

    /**
     * Extract visible columns from sublist header
     */
    function extractSublistColumns(table) {
        var columns = [];
        var seen = {};

        // Find header row - NetSuite uses uir-machine-headerrow class
        var headerRow = table.querySelector('tr.uir-machine-headerrow, thead tr');
        if (!headerRow) {
            // Try first row with multiple cells
            headerRow = table.querySelector('tr');
        }
        if (!headerRow) return columns;

        console.log('[FC_FormLayoutCapture] Extracting columns from header row');

        var cells = headerRow.querySelectorAll('td, th');
        cells.forEach(function(cell, idx) {
            // Skip if not visible
            if (!isElementVisible(cell)) return;

            // NetSuite puts column info in data-label or data-nsps-label attributes
            var colLabel = cell.getAttribute('data-label') ||
                          cell.getAttribute('data-nsps-label');

            var colId = null;

            if (colLabel) {
                // Convert label to column ID (e.g., "Account" -> "account")
                colId = colLabel.toLowerCase().replace(/\s+/g, '').replace(/[^a-z0-9]/gi, '');
                console.log('[FC_FormLayoutCapture] Column from data-label:', colLabel, '->', colId);
            }

            // Fallback to other data attributes
            if (!colId) {
                colId = cell.getAttribute('data-ns-tooltip') ||
                       cell.getAttribute('data-field') ||
                       cell.getAttribute('data-column');
            }

            // Last resort: infer from text content
            if (!colId) {
                colId = inferColumnIdFromHeader(cell);
            }

            // Skip empty or already seen columns
            if (colId && !seen[colId]) {
                seen[colId] = true;
                columns.push(colId);
            }
        });

        return columns;
    }

    /**
     * Infer column ID from header cell text
     */
    function inferColumnIdFromHeader(cell) {
        var text = (cell.textContent || '').trim().toLowerCase();
        if (!text || text.length > 40) return null;

        // Skip system columns
        if (text === '' || text === 'add' || text === 'insert' || text === 'delete') return null;

        var mappings = {
            'account': 'account',
            'expense account': 'account',
            'amount': 'amount',
            'memo': 'memo',
            'description': 'description',
            'quantity': 'quantity',
            'qty': 'quantity',
            'rate': 'rate',
            'item': 'item',
            'department': 'department',
            'dept': 'department',
            'class': 'class',
            'location': 'location',
            'customer': 'customer',
            'customer:job': 'customer',
            'tax code': 'taxcode',
            'category': 'category',
            'gross amt': 'grossamt',
            'tax amt': 'tax1amt',
            'net amount': 'amount',
            'date': 'expensedate',
            'currency': 'currency',
            'exchange rate': 'exchangerate',
            'receipt': 'receipt',
            'billable': 'isbillable',
            'reimbursable': 'isreimbursable'
        };

        return mappings[text] || text.replace(/\s+/g, '').replace(/[^a-z0-9]/gi, '');
    }

    return {
        pageInit: pageInit
    };
});
