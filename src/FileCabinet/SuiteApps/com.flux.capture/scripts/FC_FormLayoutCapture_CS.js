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

define(['N/currentRecord', 'N/url', '/SuiteApps/com.flux.capture/lib/FC_Debug'],
function(currentRecord, url, fcDebug) {
    'use strict';

    // Debug logging helper - gates console.log behind debug mode
    function debugLog() {
        if (fcDebug && fcDebug.isDebugMode && fcDebug.isDebugMode()) {
            console.log.apply(console, arguments);
        }
    }

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
            debugLog('[FC_FormLayoutCapture] === SCRIPT LOADED ===');
            debugLog('[FC_FormLayoutCapture] pageInit triggered, mode:', context.mode);

            var rec = context.currentRecord;
            var recordType = rec.type;
            var formId = getFormId(rec);

            debugLog('[FC_FormLayoutCapture] Record type:', recordType, 'Form ID:', formId);

            // Skip if already extracted this session
            var cacheKey = recordType + '_' + (formId || 'default');
            if (EXTRACTED_FORMS[cacheKey]) {
                debugLog('[FC_FormLayoutCapture] Already extracted this session:', cacheKey);
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
            debugLog('[FC_FormLayoutCapture] Extracting layout...');

            var layout = extractFormLayout(recordType, formId);

            if (!layout || !layout.tabs || layout.tabs.length === 0) {
                debugLog('[FC_FormLayoutCapture] No layout extracted');
                return;
            }

            // Log extracted fields for debugging
            debugLog('[FC_FormLayoutCapture] === EXTRACTION SUMMARY ===');
            layout.tabs.forEach(function(tab) {
                debugLog('[FC_FormLayoutCapture] Tab:', tab.label);
                tab.fieldGroups.forEach(function(group) {
                    debugLog('[FC_FormLayoutCapture]   Group:', group.label, '(' + group.fields.length + ' fields)');
                    group.fields.forEach(function(f) {
                        var info = f.id + ' [' + f.type + ']';
                        if (f.required) info += ' *required*';
                        if (f.mode === 'view') info += ' (readonly)';
                        debugLog('[FC_FormLayoutCapture]     -', info, ':', f.label);
                    });
                });
                if (tab.sublists && tab.sublists.length > 0) {
                    debugLog('[FC_FormLayoutCapture]   Tab sublists:', tab.sublists.join(', '));
                }
            });
            debugLog('[FC_FormLayoutCapture] Sublists found:', layout.sublists.length);
            layout.sublists.forEach(function(sl) {
                debugLog('[FC_FormLayoutCapture]   Sublist:', sl.id, '- Columns:', sl.visibleColumns.join(', '));
            });

            // Get RESTlet URL
            var restletUrl = url.resolveScript({
                scriptId: 'customscript_fc_router',
                deploymentId: 'customdeploy_fc_router'
            });

            debugLog('[FC_FormLayoutCapture] Saving to:', restletUrl);

            // Save to server using XHR
            var xhr = new XMLHttpRequest();
            xhr.open('PUT', restletUrl, true);
            xhr.setRequestHeader('Content-Type', 'application/json');
            xhr.onreadystatechange = function() {
                if (xhr.readyState === 4) {
                    if (xhr.status === 200) {
                        EXTRACTED_FORMS[cacheKey] = true;
                        debugLog('[FC_FormLayoutCapture] Layout saved successfully');
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

        debugLog('[FC_FormLayoutCapture] Found', groupHeaders.length, 'field groups');

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

            debugLog('[FC_FormLayoutCapture] Group:', groupLabel, '| Fields:', fields.length, '| Collapsed:', isCollapsed);

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

        debugLog('[FC_FormLayoutCapture] Found', fieldWrappers.length, 'field wrappers with data-field-name');

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

            debugLog('[FC_FormLayoutCapture] Field:', fieldId, '| Label:', fieldLabel, '| Type:', fieldType, '| Required:', isRequired);
        });

        // Fallback: if no data attributes found, try legacy extraction
        if (fields.length === 0) {
            debugLog('[FC_FormLayoutCapture] No data-field-name wrappers found, trying legacy extraction...');
            fields = extractFieldsLegacy(container);
        }

        debugLog('[FC_FormLayoutCapture] Extracted', fields.length, 'fields');
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

        debugLog('[FC_FormLayoutCapture] Looking for sublists...');

        // Search in entire document as sublists may be outside main form container
        var searchRoot = document;

        // Method 1: NetSuite sublists with data-nsps-type="sublist" attribute
        var sublistTables = searchRoot.querySelectorAll('table[data-nsps-type="sublist"]');
        debugLog('[FC_FormLayoutCapture] Method 1 - data-nsps-type: Found', sublistTables.length, 'tables');

        sublistTables.forEach(function(table) {
            var sublistId = table.getAttribute('data-nsps-id');
            if (!sublistId || seen[sublistId]) return;

            seen[sublistId] = true;
            var columns = extractSublistColumns(table);
            debugLog('[FC_FormLayoutCapture] Sublist', sublistId, 'columns:', columns.length);

            // Skip sublists with no valid columns (e.g., still loading)
            // Server-side schema will provide column definitions for these
            if (columns.length === 0) {
                debugLog('[FC_FormLayoutCapture] Skipping sublist', sublistId, '- no valid columns (may be loading)');
                return;
            }

            sublists.push({
                id: sublistId,
                label: sublistId.charAt(0).toUpperCase() + sublistId.slice(1),
                visibleColumns: columns,
                columnOrder: columns
            });
        });

        // Method 2: Tables with _splits suffix (e.g., expense_splits, item_splits)
        if (sublists.length === 0) {
            var splitsTables = searchRoot.querySelectorAll('table[id$="_splits"]');
            debugLog('[FC_FormLayoutCapture] Method 2 - _splits suffix: Found', splitsTables.length, 'tables');

            splitsTables.forEach(function(table) {
                var sublistId = inferSublistId(table);
                if (!sublistId || seen[sublistId]) return;

                seen[sublistId] = true;
                var columns = extractSublistColumns(table);
                debugLog('[FC_FormLayoutCapture] Sublist (splits)', sublistId, 'columns:', columns.length);

                sublists.push({
                    id: sublistId,
                    label: sublistId.charAt(0).toUpperCase() + sublistId.slice(1),
                    visibleColumns: columns,
                    columnOrder: columns
                });
            });
        }

        // Method 3: Look for machine tables (common NetSuite pattern)
        if (sublists.length === 0) {
            var machineTables = searchRoot.querySelectorAll('table.uir-machine-table, div.uir-machine-table-container table');
            debugLog('[FC_FormLayoutCapture] Method 3 - uir-machine-table: Found', machineTables.length, 'tables');

            machineTables.forEach(function(table) {
                // Check for header row to confirm it's a sublist
                var headerRow = table.querySelector('tr.uir-machine-headerrow');
                if (!headerRow) return;

                var sublistId = inferSublistId(table) || inferSublistFromTable(table);
                if (!sublistId || seen[sublistId]) return;

                seen[sublistId] = true;
                var columns = extractSublistColumns(table);
                debugLog('[FC_FormLayoutCapture] Sublist (machine)', sublistId, 'columns:', columns.length);

                sublists.push({
                    id: sublistId,
                    label: sublistId.charAt(0).toUpperCase() + sublistId.slice(1),
                    visibleColumns: columns,
                    columnOrder: columns
                });
            });
        }

        // Method 4: Look for any table with header row containing data-label attributes
        if (sublists.length === 0) {
            var allTables = searchRoot.querySelectorAll('table');
            debugLog('[FC_FormLayoutCapture] Method 4 - scanning all tables:', allTables.length, 'tables');

            allTables.forEach(function(table) {
                // Must have data-label cells in header
                var dataLabelCells = table.querySelectorAll('tr:first-child td[data-label], tr:first-child th[data-label]');
                if (dataLabelCells.length < 2) return; // Need at least 2 columns

                var sublistId = inferSublistId(table) || inferSublistFromTable(table);
                if (!sublistId || seen[sublistId]) return;

                seen[sublistId] = true;
                var columns = extractSublistColumns(table);
                debugLog('[FC_FormLayoutCapture] Sublist (data-label)', sublistId, 'columns:', columns.length);

                sublists.push({
                    id: sublistId,
                    label: sublistId.charAt(0).toUpperCase() + sublistId.slice(1),
                    visibleColumns: columns,
                    columnOrder: columns
                });
            });
        }

        debugLog('[FC_FormLayoutCapture] Total sublists found:', sublists.length);
        return sublists;
    }

    /**
     * Infer sublist ID from table content (fallback)
     */
    function inferSublistFromTable(table) {
        var headers = table.querySelectorAll('td[data-label], th[data-label], td.listheadertextb');
        var headerText = '';
        headers.forEach(function(h) {
            headerText += ' ' + (h.getAttribute('data-label') || h.textContent || '').toLowerCase();
        });

        if (headerText.includes('expense') || headerText.includes('receipt')) return 'expense';
        if (headerText.includes('item') || headerText.includes('quantity')) return 'item';
        if (headerText.includes('amount') && headerText.includes('account')) return 'expense';

        return null;
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
     * Note: Don't filter by visibility - hidden sublists still have valid column structure
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

        debugLog('[FC_FormLayoutCapture] Extracting columns from header row');

        var cells = headerRow.querySelectorAll('td, th');
        cells.forEach(function(cell, idx) {
            // Don't filter by visibility - hidden sublists still have valid columns
            // Just skip cells with display:none inline style
            if (cell.style.display === 'none') return;

            // NetSuite puts column info in data-label or data-nsps-label attributes
            var colLabel = cell.getAttribute('data-label') ||
                          cell.getAttribute('data-nsps-label');

            var colId = null;

            if (colLabel) {
                // Convert label to column ID (e.g., "Account" -> "account")
                colId = colLabel.toLowerCase().replace(/\s+/g, '').replace(/[^a-z0-9]/gi, '');
                debugLog('[FC_FormLayoutCapture] Column from data-label:', colLabel, '->', colId);
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

            // Skip empty, already seen, or placeholder columns
            if (colId && !seen[colId]) {
                // Skip NetSuite loading placeholders
                if (colId === 'loading' || colId === 'loadingpleasewait') {
                    debugLog('[FC_FormLayoutCapture] Skipping placeholder column:', colId);
                    return;
                }
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

        // Skip system columns and loading placeholders
        if (text === '' || text === 'add' || text === 'insert' || text === 'delete') return null;
        if (text === 'loading' || text === 'loading...' || text.indexOf('please wait') !== -1) return null;

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
