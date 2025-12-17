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

define(['N/currentRecord', 'N/url', 'N/https'],
function(currentRecord, url, https) {

    // Cache check - only extract once per form per session
    var EXTRACTED_FORMS = {};

    /**
     * Page Init - Extract form layout automatically
     */
    function pageInit(context) {
        console.log('[FC_FormLayoutCapture] pageInit triggered, mode:', context.mode);

        try {
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
            console.error('[FC_FormLayoutCapture] pageInit error:', e.message);
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

            console.log('[FC_FormLayoutCapture] Layout extracted:', layout.tabs.length, 'tabs');

            // Get RESTlet URL
            var restletUrl = url.resolveScript({
                scriptId: 'customscript_fc_router',
                deploymentId: 'customdeploy_fc_router'
            });

            console.log('[FC_FormLayoutCapture] Saving to:', restletUrl);

            // Save to server using XHR (more reliable in client scripts)
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
            console.error('[FC_FormLayoutCapture] Extract error:', e.message);
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

        // Extract main tab with all visible fields
        var mainTab = {
            id: 'main',
            label: 'Main',
            displayOrder: 0,
            fieldGroups: [],
            sublists: []
        };

        // Extract visible fields
        var fields = extractVisibleFields();
        console.log('[FC_FormLayoutCapture] Found', fields.length, 'visible fields');

        if (fields.length > 0) {
            mainTab.fieldGroups.push({
                id: 'primary',
                label: 'Primary Information',
                displayOrder: 0,
                fields: fields
            });
        }

        // Extract sublists
        var sublists = extractSublists();
        console.log('[FC_FormLayoutCapture] Found', sublists.length, 'sublists');

        sublists.forEach(function(sl) {
            mainTab.sublists.push(sl.id);
        });

        layout.tabs.push(mainTab);
        layout.sublists = sublists;

        return layout;
    }

    /**
     * Extract visible fields from the form
     */
    function extractVisibleFields() {
        var fields = [];
        var seen = {};

        // System fields to skip
        var skipFields = ['ntype', 'recordtype', 'nsapiCT', 'customform', 'entryformquerystring',
                         '_csrf', 'wfinstances', 'id', 'sys_id', 'selectedtab', 'type',
                         'baserecordtype', 'nsapiFC', 'nsapiPS', 'nsapiVF', 'nsapiPI',
                         'nsapiSR', 'nsapiLI', 'nsapiVD', 'nsapiRC', 'nsapiPD', 'nlrole',
                         'submitted', 'nextbill', 'nexttransaction'];

        // Find all input elements
        var inputs = document.querySelectorAll('input[id], select[id], textarea[id]');

        inputs.forEach(function(el) {
            var fieldId = getFieldIdFromElement(el);
            if (!fieldId || seen[fieldId]) return;
            if (skipFields.indexOf(fieldId) !== -1) return;
            if (fieldId.indexOf('nsapi') === 0) return;
            if (fieldId.indexOf('sys_') === 0) return;

            // Check if field row is visible
            var row = el.closest('tr');
            if (row) {
                var style = window.getComputedStyle(row);
                if (style.display === 'none') return;
            }

            seen[fieldId] = true;
            fields.push(fieldId);
        });

        return fields;
    }

    /**
     * Get field ID from element
     */
    function getFieldIdFromElement(el) {
        var id = el.id || '';
        if (!id) return null;

        // Clean NetSuite prefixes/suffixes
        return id.replace(/^inpt_/, '')
                 .replace(/^txt_/, '')
                 .replace(/_display$/, '')
                 .replace(/_fs$/, '')
                 .replace(/_val$/, '')
                 .replace(/_formattedValue$/, '');
    }

    /**
     * Extract sublists from the form
     */
    function extractSublists() {
        var sublists = [];

        // Look for sublist tables
        var tables = document.querySelectorAll('table.machine, table.uir-machine-table, [id*="_splits"]');

        tables.forEach(function(table) {
            var sublistId = inferSublistId(table);
            if (!sublistId) return;

            var columns = extractSublistColumns(table);

            sublists.push({
                id: sublistId,
                label: sublistId.charAt(0).toUpperCase() + sublistId.slice(1),
                visibleColumns: columns,
                columnOrder: columns
            });
        });

        return sublists;
    }

    /**
     * Infer sublist ID from table element
     */
    function inferSublistId(table) {
        var id = (table.id || '').toLowerCase();
        var className = (table.className || '').toLowerCase();

        if (id.includes('expense') || className.includes('expense')) return 'expense';
        if (id.includes('item') || className.includes('item')) return 'item';
        if (id.includes('line') || className.includes('line')) return 'line';
        if (id.includes('apply') || className.includes('apply')) return 'apply';

        return null;
    }

    /**
     * Extract visible columns from sublist
     */
    function extractSublistColumns(table) {
        var columns = [];

        var headerRow = table.querySelector('tr.uir-machine-headerrow, thead tr, tr:first-child');
        if (!headerRow) return columns;

        var cells = headerRow.querySelectorAll('td, th');
        cells.forEach(function(cell) {
            var colId = cell.getAttribute('data-ns-column') ||
                       cell.getAttribute('data-column') ||
                       inferColumnId(cell);

            if (colId && colId !== 'delete' && colId !== 'insert') {
                var style = window.getComputedStyle(cell);
                if (style.display !== 'none') {
                    columns.push(colId);
                }
            }
        });

        return columns;
    }

    /**
     * Infer column ID from header cell
     */
    function inferColumnId(cell) {
        var text = (cell.textContent || '').trim().toLowerCase();
        if (!text || text.length > 30) return null;

        var mappings = {
            'account': 'account',
            'amount': 'amount',
            'memo': 'memo',
            'description': 'description',
            'quantity': 'quantity',
            'qty': 'quantity',
            'rate': 'rate',
            'item': 'item',
            'department': 'department',
            'class': 'class',
            'location': 'location',
            'customer': 'customer',
            'tax code': 'taxcode',
            'category': 'category',
            'gross amt': 'grossamt',
            'tax amt': 'tax1amt'
        };

        return mappings[text] || null;
    }

    return {
        pageInit: pageInit
    };
});
