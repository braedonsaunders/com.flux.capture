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
                    var fieldList = group.fields.map(function(f) {
                        return typeof f === 'object' ? f.id + ' (' + f.label + ')' : f;
                    }).join(', ');
                    console.log('[FC_FormLayoutCapture]   Group:', group.label, '- Fields:', fieldList);
                });
                console.log('[FC_FormLayoutCapture]   Sublists:', tab.sublists.join(', '));
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
            var fields = extractFieldsFromContainer(mainForm);
            tabs.push({
                id: 'main',
                label: 'Main',
                displayOrder: 0,
                fieldGroups: [{
                    id: 'primary',
                    label: 'Primary Information',
                    displayOrder: 0,
                    fields: fields
                }],
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
            var fields = tabContent ? extractFieldsFromContainer(tabContent) : [];

            tabs.push({
                id: tabId,
                label: tabLabel,
                displayOrder: idx,
                fieldGroups: [{
                    id: 'group_' + idx,
                    label: tabLabel,
                    displayOrder: 0,
                    fields: fields
                }],
                sublists: []
            });
        });

        return tabs;
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
     * Extract fields from a container - only visible, user-facing fields
     * Returns array of {id, label} objects
     */
    function extractFieldsFromContainer(container) {
        var fields = [];
        var seen = {};

        // Look for labeled fields - these are the real form fields
        // NetSuite puts field labels in specific table cells
        var labelCells = container.querySelectorAll('td.labelSpanEdit, td.labeltd, .uir-label, span.smallgraytextnolink');

        labelCells.forEach(function(labelCell) {
            // Find the input associated with this label
            var row = labelCell.closest('tr');
            if (!row) return;

            // Check row visibility
            if (!isElementVisible(row)) return;

            // Find input in the same row or next cell
            var input = row.querySelector('input[id]:not([type="hidden"]), select[id], textarea[id]');
            if (!input) return;

            var fieldId = cleanFieldId(input.id);
            if (!fieldId || seen[fieldId]) return;
            if (shouldSkipField(fieldId)) return;

            // Verify the input is visible
            if (!isElementVisible(input)) return;

            // Get the label text
            var labelText = getLabelText(labelCell);

            seen[fieldId] = true;
            fields.push({
                id: fieldId,
                label: labelText || fieldId
            });
        });

        // If no labeled fields found, fall back to finding inputs in visible rows
        if (fields.length === 0) {
            var inputs = container.querySelectorAll('input[id]:not([type="hidden"]), select[id], textarea[id]');
            inputs.forEach(function(input) {
                var fieldId = cleanFieldId(input.id);
                if (!fieldId || seen[fieldId]) return;
                if (shouldSkipField(fieldId)) return;

                // Must be in a visible table row
                var row = input.closest('tr');
                if (row && !isElementVisible(row)) return;
                if (!isElementVisible(input)) return;

                // Try to find label from row
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
                    label: labelText || fieldId
                });
            });
        }

        console.log('[FC_FormLayoutCapture] Extracted fields from container:', fields.map(function(f) { return f.id; }));
        return fields;
    }

    /**
     * Extract label text from a label cell
     */
    function getLabelText(labelCell) {
        if (!labelCell) return null;

        // Get direct text content, excluding child elements that might have other text
        var text = '';
        labelCell.childNodes.forEach(function(node) {
            if (node.nodeType === Node.TEXT_NODE) {
                text += node.textContent;
            } else if (node.nodeType === Node.ELEMENT_NODE) {
                // Include span text but skip help icons, etc.
                var tagName = node.tagName.toLowerCase();
                if (tagName === 'span' && !node.classList.contains('help')) {
                    text += node.textContent;
                }
            }
        });

        text = text.trim();
        // Remove trailing colon and asterisk (required marker)
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

        // NetSuite uses various patterns for sublist containers
        // Look for the div containers that wrap sublist tables
        var sublistContainers = container.querySelectorAll(
            'div[id$="_splits"], ' +                    // expense_splits, item_splits
            'div[id$="machine"], ' +                    // Various machine divs
            'div.uir-machine, ' +                       // Machine class
            'table.uir-machine-table, ' +              // Machine tables
            'div[id*="expense"], ' +                   // Expense-related
            'div[id*="item"], ' +                      // Item-related
            'div[id*="line"]'                          // Line-related
        );

        console.log('[FC_FormLayoutCapture] Found', sublistContainers.length, 'potential sublist containers');

        sublistContainers.forEach(function(elem) {
            var sublistId = inferSublistId(elem);
            if (!sublistId || seen[sublistId]) return;

            // Find the actual table within this container
            var table = elem.tagName === 'TABLE' ? elem : elem.querySelector('table');
            if (!table) {
                console.log('[FC_FormLayoutCapture] No table found in container:', elem.id);
                return;
            }

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

        // Also try to find sublists by looking for specific NetSuite sublist patterns
        if (sublists.length === 0) {
            console.log('[FC_FormLayoutCapture] No sublists found with primary selectors, trying fallback...');

            // Look for any table with machine header row
            var machineTables = container.querySelectorAll('table');
            machineTables.forEach(function(table) {
                var headerRow = table.querySelector('tr.uir-machine-headerrow, tr.machineheaderrow');
                if (!headerRow) return;

                var sublistId = inferSublistId(table) || inferSublistFromTable(table);
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
        var className = (elem.className || '').toLowerCase();

        // Direct ID patterns
        if (id.includes('expense_splits') || id.includes('expenseline') || id.includes('expense_machine')) return 'expense';
        if (id.includes('item_splits') || id.includes('itemline') || id.includes('item_machine')) return 'item';
        if (id.includes('apply_machine') || id.includes('apply_splits')) return 'apply';
        if (id.includes('line_machine') || id.includes('line_splits')) return 'line';
        if (id.includes('expense')) return 'expense';
        if (id.includes('item')) return 'item';
        if (id.includes('apply')) return 'apply';
        if (id.includes('line')) return 'line';

        return null;
    }

    /**
     * Infer sublist ID from table content (fallback)
     */
    function inferSublistFromTable(table) {
        // Look at header cells to determine sublist type
        var headers = table.querySelectorAll('th, td.listheadertextb');
        var headerText = '';
        headers.forEach(function(h) {
            headerText += ' ' + (h.textContent || '').toLowerCase();
        });

        if (headerText.includes('expense') || headerText.includes('receipt')) return 'expense';
        if (headerText.includes('item') || headerText.includes('quantity')) return 'item';
        if (headerText.includes('amount') && headerText.includes('account')) return 'expense';

        return null;
    }

    /**
     * Extract visible columns from sublist header
     */
    function extractSublistColumns(table) {
        var columns = [];
        var seen = {};

        // Find header row
        var headerRow = table.querySelector('tr.uir-machine-headerrow, thead tr');
        if (!headerRow) {
            // Try first row with multiple cells
            headerRow = table.querySelector('tr');
        }
        if (!headerRow) return columns;

        var cells = headerRow.querySelectorAll('td, th');
        cells.forEach(function(cell, idx) {
            // Skip if not visible
            if (!isElementVisible(cell)) return;

            // Get column ID from data attribute or infer from text
            var colId = cell.getAttribute('data-ns-tooltip') ||
                       cell.getAttribute('data-field') ||
                       cell.getAttribute('data-column');

            if (!colId) {
                colId = inferColumnIdFromHeader(cell);
            }

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
