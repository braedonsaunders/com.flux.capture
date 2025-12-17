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
 *
 * This runs invisibly - users don't know it's happening.
 */

define(['N/currentRecord', 'N/url', 'N/https', 'N/runtime', 'N/log'],
function(currentRecord, url, https, runtime, log) {

    // Cache check - only extract once per form per session
    var EXTRACTED_FORMS = {};

    /**
     * Page Init - Extract form layout automatically
     */
    function pageInit(context) {
        try {
            var rec = context.currentRecord;
            var recordType = rec.type;
            var formId = getFormId(rec);

            // Skip if already extracted this session
            var cacheKey = recordType + '_' + (formId || 'default');
            if (EXTRACTED_FORMS[cacheKey]) {
                return;
            }

            // Check server cache first
            checkAndExtractLayout(recordType, formId, cacheKey);

        } catch (e) {
            // Silently fail - don't disrupt user experience
            log.debug('FC_FormLayoutCapture', 'pageInit error: ' + e.message);
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
     * Check if layout exists, extract if not
     */
    function checkAndExtractLayout(recordType, formId, cacheKey) {
        // Get RESTlet URL
        var restletUrl = url.resolveScript({
            scriptId: 'customscript_fc_router',
            deploymentId: 'customdeploy_fc_router'
        });

        // Check if layout already cached
        var checkUrl = restletUrl + '&action=formlayout&transactionType=' + recordType;
        if (formId) {
            checkUrl += '&formId=' + formId;
        }

        https.get.promise({
            url: checkUrl
        }).then(function(response) {
            var result = JSON.parse(response.body);

            // If no layout cached, extract and save
            if (!result.success || !result.data || !result.data.tabs || result.data.tabs.length === 0) {
                // Wait for DOM to fully render
                setTimeout(function() {
                    extractAndSaveLayout(recordType, formId, restletUrl, cacheKey);
                }, 1500);
            } else {
                // Already cached
                EXTRACTED_FORMS[cacheKey] = true;
                log.debug('FC_FormLayoutCapture', 'Layout already cached for ' + cacheKey);
            }

        }).catch(function(e) {
            // If check fails, try to extract anyway
            setTimeout(function() {
                extractAndSaveLayout(recordType, formId, restletUrl, cacheKey);
            }, 1500);
        });
    }

    /**
     * Extract layout from DOM and save to server
     */
    function extractAndSaveLayout(recordType, formId, restletUrl, cacheKey) {
        try {
            var layout = extractFormLayout(recordType, formId);

            if (!layout || !layout.tabs || layout.tabs.length === 0) {
                log.debug('FC_FormLayoutCapture', 'No layout extracted');
                return;
            }

            // Save to server
            https.put.promise({
                url: restletUrl,
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    action: 'saveformlayout',
                    transactionType: recordType,
                    formId: formId,
                    layout: layout
                })
            }).then(function(response) {
                EXTRACTED_FORMS[cacheKey] = true;
                log.audit('FC_FormLayoutCapture', 'Layout saved for ' + recordType + ' form ' + formId);
            }).catch(function(e) {
                log.debug('FC_FormLayoutCapture', 'Save error: ' + e.message);
            });

        } catch (e) {
            log.debug('FC_FormLayoutCapture', 'Extract error: ' + e.message);
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

        // Extract tabs
        layout.tabs = extractTabs();

        // Extract sublists
        layout.sublists = extractSublists();

        return layout;
    }

    /**
     * Extract tabs from the form
     */
    function extractTabs() {
        var tabs = [];

        // NetSuite tabs are in .uir-machine-headerrow or similar containers
        var tabElements = document.querySelectorAll(
            '.uir-machine-headerrow, ' +
            '.machine_headerrow, ' +
            '[data-walkthrough-target^="tab"], ' +
            '.uir_tab'
        );

        if (tabElements.length === 0) {
            // Single tab form - create Main tab
            tabs.push(extractMainTab());
            return tabs;
        }

        tabElements.forEach(function(tabEl, idx) {
            var tabId = tabEl.id || tabEl.getAttribute('data-tab-id') || 'tab_' + idx;
            var tabLabel = getTabLabel(tabEl) || 'Tab ' + (idx + 1);

            tabs.push({
                id: tabId,
                label: tabLabel,
                displayOrder: idx,
                fieldGroups: extractFieldGroups(tabEl),
                sublists: getSublistsInTab(tabEl)
            });
        });

        // If no tabs extracted, create main tab
        if (tabs.length === 0) {
            tabs.push(extractMainTab());
        }

        return tabs;
    }

    /**
     * Extract main tab for single-tab forms
     */
    function extractMainTab() {
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
            fieldGroups: extractFieldGroups(mainContent),
            sublists: getAllSublistIds()
        };
    }

    /**
     * Get tab label
     */
    function getTabLabel(tabEl) {
        var label = tabEl.getAttribute('data-label') || tabEl.getAttribute('title');
        if (!label) {
            var labelEl = tabEl.querySelector('.uir-machine-header-text, .tab-text, a');
            if (labelEl) {
                label = labelEl.textContent.trim();
            }
        }
        return label;
    }

    /**
     * Extract field groups from container
     */
    function extractFieldGroups(container) {
        var groups = [];

        // Look for fieldsets and field group containers
        var groupElements = container.querySelectorAll(
            'fieldset, ' +
            '.uir-field-group, ' +
            '.uir-machine-row-group, ' +
            '[data-field-group]'
        );

        if (groupElements.length === 0) {
            // No explicit groups - create single group
            var allFields = extractFieldsFromContainer(container);
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
            var groupId = groupEl.id || groupEl.getAttribute('data-field-group') || 'group_' + idx;
            var groupLabel = getGroupLabel(groupEl) || 'Group ' + (idx + 1);
            var fields = extractFieldsFromContainer(groupEl);

            if (fields.length > 0) {
                groups.push({
                    id: groupId,
                    label: groupLabel,
                    displayOrder: idx,
                    fields: fields,
                    collapsed: isGroupCollapsed(groupEl)
                });
            }
        });

        return groups;
    }

    /**
     * Get group label
     */
    function getGroupLabel(groupEl) {
        var legend = groupEl.querySelector('legend');
        if (legend) return legend.textContent.trim();

        var header = groupEl.querySelector('.uir-field-group-header, .group-header, h3, h4');
        if (header) return header.textContent.trim();

        return groupEl.getAttribute('data-label') || groupEl.getAttribute('title');
    }

    /**
     * Check if group is collapsed
     */
    function isGroupCollapsed(groupEl) {
        return groupEl.classList.contains('collapsed') ||
               groupEl.classList.contains('uir-collapsed') ||
               groupEl.style.display === 'none';
    }

    /**
     * Extract visible fields from container
     */
    function extractFieldsFromContainer(container) {
        var fields = [];
        var seen = {};

        // System fields to skip
        var skipFields = ['ntype', 'recordtype', 'nsapiCT', 'customform', 'entryformquerystring',
                         '_csrf', 'wfinstances', 'id', 'sys_id', 'selectedtab', 'type',
                         'baserecordtype', 'nsapiFC', 'nsapiPS', 'nsapiVF', 'nsapiPI',
                         'nsapiSR', 'nsapiLI', 'nsapiVD', 'nsapiRC', 'nsapiPD'];

        // Find field elements
        var fieldElements = container.querySelectorAll(
            'input[id], select[id], textarea[id], ' +
            '[data-field-name], .uir-field'
        );

        fieldElements.forEach(function(el) {
            var fieldId = getFieldId(el);
            if (!fieldId || seen[fieldId]) return;
            if (skipFields.indexOf(fieldId) !== -1) return;
            if (fieldId.indexOf('nsapi') === 0) return;

            // Check visibility
            if (!isFieldVisible(el)) return;

            seen[fieldId] = true;
            fields.push(fieldId);
        });

        return fields;
    }

    /**
     * Get field ID from element
     */
    function getFieldId(el) {
        var fieldName = el.getAttribute('data-field-name');
        if (fieldName) return fieldName;

        var id = el.id;
        if (id) {
            // Clean NetSuite prefixes
            return id.replace(/^inpt_/, '')
                     .replace(/^txt_/, '')
                     .replace(/_display$/, '')
                     .replace(/_fs$/, '')
                     .replace(/_val$/, '');
        }

        return el.name;
    }

    /**
     * Check if field is visible
     */
    function isFieldVisible(el) {
        var style = window.getComputedStyle(el);
        if (style.display === 'none' || style.visibility === 'hidden') {
            return false;
        }

        // Check parent row
        var parent = el.closest('tr, .uir-field-wrapper, .field-wrapper');
        if (parent) {
            var parentStyle = window.getComputedStyle(parent);
            if (parentStyle.display === 'none') {
                return false;
            }
        }

        return true;
    }

    /**
     * Extract sublists
     */
    function extractSublists() {
        var sublists = [];

        var sublistElements = document.querySelectorAll(
            '[data-sublist-id], ' +
            '.uir-machine-table, ' +
            '.machine, ' +
            'table.uir-sublist'
        );

        sublistElements.forEach(function(el, idx) {
            var sublistId = el.getAttribute('data-sublist-id') || inferSublistId(el) || 'sublist_' + idx;
            var columns = extractSublistColumns(el);

            sublists.push({
                id: sublistId,
                label: getSublistLabel(el) || sublistId,
                visibleColumns: columns.visible,
                columnOrder: columns.order,
                allColumns: columns.all
            });
        });

        return sublists;
    }

    /**
     * Infer sublist ID from element
     */
    function inferSublistId(el) {
        var id = el.id || '';
        var className = el.className || '';

        if (id.includes('expense') || className.includes('expense')) return 'expense';
        if (id.includes('item') || className.includes('item')) return 'item';
        if (id.includes('line') || className.includes('line')) return 'line';

        return null;
    }

    /**
     * Get sublist label
     */
    function getSublistLabel(el) {
        var header = el.previousElementSibling;
        if (header && header.tagName === 'H3') {
            return header.textContent.trim();
        }

        var caption = el.querySelector('caption');
        if (caption) return caption.textContent.trim();

        return null;
    }

    /**
     * Extract sublist column configuration
     */
    function extractSublistColumns(el) {
        var visible = [];
        var order = [];
        var all = [];

        var headerRow = el.querySelector('thead tr, .uir-machine-headerrow tr, .machine_headerrow tr');
        if (!headerRow) {
            headerRow = el.querySelector('tr:first-child');
        }
        if (!headerRow) return { visible: [], order: [], all: [] };

        var cells = headerRow.querySelectorAll('th, td');
        cells.forEach(function(cell) {
            var colId = cell.getAttribute('data-column') ||
                       cell.getAttribute('data-field') ||
                       inferColumnId(cell);

            if (!colId) return;

            all.push(colId);
            order.push(colId);

            var style = window.getComputedStyle(cell);
            if (style.display !== 'none' && style.visibility !== 'hidden') {
                visible.push(colId);
            }
        });

        return { visible: visible, order: order, all: all };
    }

    /**
     * Infer column ID from header text
     */
    function inferColumnId(cell) {
        var text = (cell.textContent || '').trim().toLowerCase();

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
    }

    /**
     * Get all sublist IDs
     */
    function getAllSublistIds() {
        var sublists = extractSublists();
        return sublists.map(function(sl) { return sl.id; });
    }

    /**
     * Get sublists within a tab
     */
    function getSublistsInTab(tabEl) {
        var ids = [];
        var sublists = tabEl.querySelectorAll(
            '[data-sublist-id], .uir-machine-table, .machine'
        );
        sublists.forEach(function(sl) {
            var id = sl.getAttribute('data-sublist-id') || inferSublistId(sl);
            if (id) ids.push(id);
        });
        return ids;
    }

    return {
        pageInit: pageInit
    };
});
