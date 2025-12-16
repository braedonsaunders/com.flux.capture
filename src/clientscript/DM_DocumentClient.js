/**
 * @NApiVersion 2.1
 * @NScriptType ClientScript
 * @NModuleScope SameAccount
 * 
 * DocuMind - Document Client Script
 * Provides enhanced client-side interactions for document capture
 */

define(['N/currentRecord', 'N/record', 'N/search', 'N/url', 'N/https', 'N/ui/dialog', 'N/ui/message'],
    function(currentRecord, record, search, url, https, dialog, message) {

    /**
     * Page initialization
     */
    function pageInit(context) {
        const rec = context.currentRecord;
        const mode = context.mode;
        
        console.log('DocuMind: Page initialized in', mode, 'mode');
        
        if (mode === 'view') {
            // Initialize view mode features
            initializeViewMode(rec);
        }
        
        if (mode === 'edit' || mode === 'create') {
            // Initialize edit mode features
            initializeEditMode(rec);
        }
        
        // Initialize tooltips
        initializeTooltips();
        
        // Initialize keyboard shortcuts
        initializeKeyboardShortcuts();
    }

    /**
     * Field change handler
     */
    function fieldChanged(context) {
        const rec = context.currentRecord;
        const fieldId = context.fieldId;
        
        switch (fieldId) {
            case 'custrecord_dm_vendor':
                handleVendorChange(rec);
                break;
                
            case 'custrecord_dm_total_amount':
                handleAmountChange(rec);
                break;
                
            case 'custrecord_dm_document_type':
                handleDocTypeChange(rec);
                break;
                
            case 'custrecord_dm_po_number':
                handlePOChange(rec);
                break;
                
            case 'custrecord_dm_source_file':
                handleFileChange(rec);
                break;
        }
    }

    /**
     * Line initialization
     */
    function lineInit(context) {
        // Prepare line for editing
    }

    /**
     * Validate field
     */
    function validateField(context) {
        const rec = context.currentRecord;
        const fieldId = context.fieldId;
        
        switch (fieldId) {
            case 'custrecord_dm_invoice_number':
                return validateInvoiceNumber(rec);
                
            case 'custrecord_dm_total_amount':
                return validateAmount(rec, fieldId);
                
            case 'custrecord_dm_invoice_date':
                return validateDate(rec, fieldId);
        }
        
        return true;
    }

    /**
     * Validate line
     */
    function validateLine(context) {
        const rec = context.currentRecord;
        const sublistId = context.sublistId;
        
        if (sublistId === 'custrecord_dm_line_items') {
            return validateLineItem(rec);
        }
        
        return true;
    }

    /**
     * Save record validation
     */
    function saveRecord(context) {
        const rec = context.currentRecord;
        
        // Validate required fields
        if (!validateRequiredFields(rec)) {
            return false;
        }
        
        // Validate line items total
        if (!validateLineItemsTotal(rec)) {
            return false;
        }
        
        // Check for unresolved anomalies
        if (!confirmAnomalies(rec)) {
            return false;
        }
        
        return true;
    }

    /**
     * Sublist change handler
     */
    function sublistChanged(context) {
        const rec = context.currentRecord;
        const sublistId = context.sublistId;
        
        if (sublistId === 'recmachcustrecord_dm_line_parent') {
            recalculateTotal(rec);
        }
    }

    // ==================== Custom Button Functions ====================

    /**
     * Process document button handler
     * Called from custom button on record
     */
    window.dmProcessDocument = function() {
        const rec = currentRecord.get();
        const docId = rec.id;
        
        dialog.confirm({
            title: 'Process Document',
            message: 'Are you sure you want to process this document? This will send it for AI extraction.'
        }).then(function(result) {
            if (result) {
                processDocument(docId);
            }
        });
    };

    /**
     * Review document button handler
     */
    window.dmReviewDocument = function() {
        const rec = currentRecord.get();
        const docId = rec.id;
        
        // Open review suitelet
        const reviewUrl = url.resolveScript({
            scriptId: 'customscript_dm_main_suitelet',
            deploymentId: 'customdeploy_dm_main_suitelet',
            params: {
                action: 'review',
                documentId: docId
            }
        });
        
        window.open(reviewUrl, '_blank');
    };

    /**
     * Reprocess document button handler
     */
    window.dmReprocessDocument = function() {
        const rec = currentRecord.get();
        const docId = rec.id;
        
        dialog.confirm({
            title: 'Reprocess Document',
            message: 'This will clear existing extraction data and reprocess the document. Continue?'
        }).then(function(result) {
            if (result) {
                reprocessDocument(docId);
            }
        });
    };

    /**
     * View transaction button handler
     */
    window.dmViewTransaction = function() {
        const rec = currentRecord.get();
        const transactionId = rec.getValue('custrecord_dm_created_transaction');
        
        if (transactionId) {
            const transUrl = url.resolveRecord({
                recordType: 'vendorbill', // This should be dynamic based on doc type
                recordId: transactionId
            });
            
            window.open(transUrl, '_blank');
        } else {
            showMessage('error', 'No transaction found for this document.');
        }
    };

    // ==================== Helper Functions ====================

    /**
     * Initialize view mode features
     */
    function initializeViewMode(rec) {
        // Add confidence meter animation
        animateConfidenceMeter();
        
        // Highlight anomaly fields
        highlightAnomalyFields(rec);
    }

    /**
     * Initialize edit mode features
     */
    function initializeEditMode(rec) {
        // Setup auto-save
        setupAutoSave();
        
        // Initialize smart suggestions
        initializeSmartSuggestions(rec);
    }

    /**
     * Handle vendor change
     */
    function handleVendorChange(rec) {
        const vendorId = rec.getValue('custrecord_dm_vendor');
        
        if (!vendorId) return;
        
        // Fetch vendor defaults
        fetchVendorDefaults(vendorId).then(function(defaults) {
            // Auto-fill payment terms
            if (defaults.terms && !rec.getValue('custrecord_dm_payment_terms')) {
                rec.setValue({
                    fieldId: 'custrecord_dm_payment_terms',
                    value: defaults.terms
                });
            }
            
            // Auto-fill currency
            if (defaults.currency && !rec.getValue('custrecord_dm_currency')) {
                rec.setValue({
                    fieldId: 'custrecord_dm_currency',
                    value: defaults.currency
                });
            }
            
            // Show vendor history
            showVendorHistory(vendorId);
        });
    }

    /**
     * Handle amount change
     */
    function handleAmountChange(rec) {
        const totalAmount = rec.getValue('custrecord_dm_total_amount');
        const subtotal = rec.getValue('custrecord_dm_subtotal') || 0;
        const tax = rec.getValue('custrecord_dm_tax_amount') || 0;
        
        const calculatedTotal = subtotal + tax;
        
        if (totalAmount && calculatedTotal && Math.abs(totalAmount - calculatedTotal) > 0.01) {
            showMessage('warning', `Total (${totalAmount}) doesn't match subtotal + tax (${calculatedTotal.toFixed(2)})`);
        }
    }

    /**
     * Handle document type change
     */
    function handleDocTypeChange(rec) {
        const docType = rec.getValue('custrecord_dm_document_type');
        
        // Show/hide fields based on document type
        const expenseFields = ['custrecord_dm_employee', 'custrecord_dm_expense_category'];
        const invoiceFields = ['custrecord_dm_vendor', 'custrecord_dm_po_number'];
        
        if (docType === 'EXPENSE_REPORT') {
            toggleFields(expenseFields, true);
            toggleFields(invoiceFields, false);
        } else {
            toggleFields(expenseFields, false);
            toggleFields(invoiceFields, true);
        }
    }

    /**
     * Handle PO number change
     */
    function handlePOChange(rec) {
        const poNumber = rec.getValue('custrecord_dm_po_number');
        
        if (!poNumber) return;
        
        // Search for matching PO
        searchPurchaseOrder(poNumber).then(function(poData) {
            if (poData) {
                showMessage('info', `Found PO: ${poData.tranid} - Vendor: ${poData.vendorName}`);
                
                // Suggest vendor if not set
                if (!rec.getValue('custrecord_dm_vendor') && poData.vendor) {
                    dialog.confirm({
                        title: 'Vendor Match',
                        message: `Set vendor to ${poData.vendorName} based on PO?`
                    }).then(function(result) {
                        if (result) {
                            rec.setValue({
                                fieldId: 'custrecord_dm_vendor',
                                value: poData.vendor
                            });
                        }
                    });
                }
            }
        });
    }

    /**
     * Handle file change
     */
    function handleFileChange(rec) {
        const fileId = rec.getValue('custrecord_dm_source_file');
        
        if (!fileId) return;
        
        // Validate file type
        validateFileType(fileId).then(function(valid) {
            if (!valid) {
                rec.setValue({
                    fieldId: 'custrecord_dm_source_file',
                    value: ''
                });
                showMessage('error', 'Invalid file type. Supported: PDF, PNG, JPG, TIFF, GIF, BMP');
            }
        });
    }

    /**
     * Validate invoice number format
     */
    function validateInvoiceNumber(rec) {
        const invoiceNum = rec.getValue('custrecord_dm_invoice_number');
        
        if (!invoiceNum) return true;
        
        // Check for duplicate
        const vendorId = rec.getValue('custrecord_dm_vendor');
        
        if (vendorId) {
            const isDuplicate = checkDuplicateInvoice(vendorId, invoiceNum, rec.id);
            
            if (isDuplicate) {
                showMessage('warning', 'An invoice with this number already exists for this vendor.');
            }
        }
        
        return true;
    }

    /**
     * Validate amount
     */
    function validateAmount(rec, fieldId) {
        const amount = rec.getValue(fieldId);
        
        if (amount !== null && amount < 0) {
            showMessage('error', 'Amount cannot be negative.');
            return false;
        }
        
        return true;
    }

    /**
     * Validate date
     */
    function validateDate(rec, fieldId) {
        const dateValue = rec.getValue(fieldId);
        
        if (!dateValue) return true;
        
        const today = new Date();
        const maxFutureDays = 30;
        const maxPastDays = 365;
        
        const diffDays = Math.floor((dateValue - today) / (1000 * 60 * 60 * 24));
        
        if (diffDays > maxFutureDays) {
            showMessage('warning', 'Invoice date is more than 30 days in the future.');
        }
        
        if (diffDays < -maxPastDays) {
            showMessage('warning', 'Invoice date is more than a year old.');
        }
        
        return true;
    }

    /**
     * Validate line item
     */
    function validateLineItem(rec) {
        const amount = rec.getCurrentSublistValue({
            sublistId: 'recmachcustrecord_dm_line_parent',
            fieldId: 'custrecord_dm_line_amount'
        });
        
        if (!amount || amount <= 0) {
            showMessage('error', 'Line amount must be greater than zero.');
            return false;
        }
        
        return true;
    }

    /**
     * Validate required fields
     */
    function validateRequiredFields(rec) {
        const status = rec.getValue('custrecord_dm_status');
        
        // Only validate for approval
        if (status !== 'approved') return true;
        
        const required = [
            { id: 'custrecord_dm_vendor', name: 'Vendor' },
            { id: 'custrecord_dm_invoice_number', name: 'Invoice Number' },
            { id: 'custrecord_dm_invoice_date', name: 'Invoice Date' },
            { id: 'custrecord_dm_total_amount', name: 'Total Amount' }
        ];
        
        const missing = [];
        
        required.forEach(function(field) {
            if (!rec.getValue(field.id)) {
                missing.push(field.name);
            }
        });
        
        if (missing.length > 0) {
            showMessage('error', 'Missing required fields: ' + missing.join(', '));
            return false;
        }
        
        return true;
    }

    /**
     * Validate line items total matches document total
     */
    function validateLineItemsTotal(rec) {
        const docTotal = rec.getValue('custrecord_dm_total_amount');
        
        if (!docTotal) return true;
        
        const lineCount = rec.getLineCount({ sublistId: 'recmachcustrecord_dm_line_parent' });
        let lineTotal = 0;
        
        for (let i = 0; i < lineCount; i++) {
            const amount = rec.getSublistValue({
                sublistId: 'recmachcustrecord_dm_line_parent',
                fieldId: 'custrecord_dm_line_amount',
                line: i
            });
            lineTotal += parseFloat(amount) || 0;
        }
        
        const tolerance = 0.02 * docTotal; // 2% tolerance
        
        if (Math.abs(docTotal - lineTotal) > tolerance) {
            return dialog.confirm({
                title: 'Amount Mismatch',
                message: `Document total (${docTotal.toFixed(2)}) differs from line items total (${lineTotal.toFixed(2)}). Continue anyway?`
            });
        }
        
        return true;
    }

    /**
     * Confirm anomalies before save
     */
    function confirmAnomalies(rec) {
        const anomaliesStr = rec.getValue('custrecord_dm_anomalies');
        
        if (!anomaliesStr) return true;
        
        const anomalies = JSON.parse(anomaliesStr);
        const highSeverity = anomalies.filter(function(a) { return a.severity === 'high'; });
        
        if (highSeverity.length > 0) {
            return dialog.confirm({
                title: 'High Severity Anomalies',
                message: `This document has ${highSeverity.length} high severity anomalies. Are you sure you want to save?`
            });
        }
        
        return true;
    }

    /**
     * Recalculate total from line items
     */
    function recalculateTotal(rec) {
        const lineCount = rec.getLineCount({ sublistId: 'recmachcustrecord_dm_line_parent' });
        let total = 0;
        
        for (let i = 0; i < lineCount; i++) {
            const amount = rec.getSublistValue({
                sublistId: 'recmachcustrecord_dm_line_parent',
                fieldId: 'custrecord_dm_line_amount',
                line: i
            });
            total += parseFloat(amount) || 0;
        }
        
        // Update calculated total display
        const calcTotalField = document.getElementById('custpage_calculated_total');
        if (calcTotalField) {
            calcTotalField.innerHTML = total.toFixed(2);
        }
    }

    /**
     * Process document via API
     */
    function processDocument(docId) {
        showLoadingMessage('Processing document...');
        
        const apiUrl = url.resolveScript({
            scriptId: 'customscript_dm_api',
            deploymentId: 'customdeploy_dm_api'
        });
        
        https.post.promise({
            url: apiUrl,
            body: JSON.stringify({
                action: 'process',
                documentId: docId
            }),
            headers: {
                'Content-Type': 'application/json'
            }
        }).then(function(response) {
            hideLoadingMessage();
            const result = JSON.parse(response.body);
            
            if (result.success) {
                showMessage('confirmation', 'Document queued for processing.');
                setTimeout(function() {
                    location.reload();
                }, 2000);
            } else {
                showMessage('error', result.error || 'Processing failed.');
            }
        }).catch(function(error) {
            hideLoadingMessage();
            showMessage('error', 'Error: ' + error.message);
        });
    }

    /**
     * Reprocess document
     */
    function reprocessDocument(docId) {
        showLoadingMessage('Reprocessing document...');
        
        const apiUrl = url.resolveScript({
            scriptId: 'customscript_dm_api',
            deploymentId: 'customdeploy_dm_api'
        });
        
        https.post.promise({
            url: apiUrl,
            body: JSON.stringify({
                action: 'reprocess',
                documentId: docId
            }),
            headers: {
                'Content-Type': 'application/json'
            }
        }).then(function(response) {
            hideLoadingMessage();
            const result = JSON.parse(response.body);
            
            if (result.success) {
                showMessage('confirmation', 'Document queued for reprocessing.');
                setTimeout(function() {
                    location.reload();
                }, 2000);
            } else {
                showMessage('error', result.error || 'Reprocessing failed.');
            }
        }).catch(function(error) {
            hideLoadingMessage();
            showMessage('error', 'Error: ' + error.message);
        });
    }

    /**
     * Fetch vendor defaults
     */
    function fetchVendorDefaults(vendorId) {
        return new Promise(function(resolve) {
            try {
                const vendorLookup = search.lookupFields({
                    type: search.Type.VENDOR,
                    id: vendorId,
                    columns: ['terms', 'currency']
                });
                
                resolve({
                    terms: vendorLookup.terms[0] ? vendorLookup.terms[0].value : null,
                    currency: vendorLookup.currency[0] ? vendorLookup.currency[0].value : null
                });
            } catch (e) {
                resolve({});
            }
        });
    }

    /**
     * Show vendor history tooltip
     */
    function showVendorHistory(vendorId) {
        // Search recent bills from vendor
        search.create({
            type: search.Type.VENDOR_BILL,
            filters: [
                ['entity', 'is', vendorId],
                'AND',
                ['mainline', 'is', 'T']
            ],
            columns: [
                search.createColumn({ name: 'trandate', sort: search.Sort.DESC }),
                'tranid',
                'total'
            ]
        }).run().getRange({ start: 0, end: 5 }).then(function(results) {
            if (results.length > 0) {
                let historyHtml = '<div style="padding: 10px; background: #f0f9ff; border-radius: 4px; margin-top: 8px;">';
                historyHtml += '<strong>Recent Bills:</strong><br>';
                
                results.forEach(function(r) {
                    historyHtml += `${r.getValue('tranid')} - $${r.getValue('total')} (${r.getValue('trandate')})<br>`;
                });
                
                historyHtml += '</div>';
                
                // Display in vendor field help
                const vendorField = document.getElementById('custrecord_dm_vendor_fs_lbl_uir_label');
                if (vendorField) {
                    const helpDiv = document.createElement('div');
                    helpDiv.innerHTML = historyHtml;
                    vendorField.parentNode.appendChild(helpDiv);
                }
            }
        });
    }

    /**
     * Search for purchase order
     */
    function searchPurchaseOrder(poNumber) {
        return new Promise(function(resolve) {
            search.create({
                type: search.Type.PURCHASE_ORDER,
                filters: [
                    ['numbertext', 'contains', poNumber],
                    'AND',
                    ['mainline', 'is', 'T']
                ],
                columns: ['entity', 'tranid', 'total', 'status']
            }).run().getRange({ start: 0, end: 1 }).then(function(results) {
                if (results.length > 0) {
                    const po = results[0];
                    resolve({
                        id: po.id,
                        tranid: po.getValue('tranid'),
                        vendor: po.getValue('entity'),
                        vendorName: po.getText('entity'),
                        total: po.getValue('total'),
                        status: po.getText('status')
                    });
                } else {
                    resolve(null);
                }
            }).catch(function() {
                resolve(null);
            });
        });
    }

    /**
     * Validate file type
     */
    function validateFileType(fileId) {
        return new Promise(function(resolve) {
            try {
                const fileLookup = search.lookupFields({
                    type: 'file',
                    id: fileId,
                    columns: ['filetype']
                });
                
                const allowedTypes = ['PDF', 'PNGIMAGE', 'JPGIMAGE', 'TIFFIMAGE', 'GIFIMAGE', 'BMPIMAGE'];
                const fileType = fileLookup.filetype;
                
                resolve(allowedTypes.includes(fileType));
            } catch (e) {
                resolve(false);
            }
        });
    }

    /**
     * Check for duplicate invoice
     */
    function checkDuplicateInvoice(vendorId, invoiceNum, currentDocId) {
        let isDuplicate = false;
        
        search.create({
            type: 'customrecord_dm_captured_document',
            filters: [
                ['custrecord_dm_vendor', 'is', vendorId],
                'AND',
                ['custrecord_dm_invoice_number', 'is', invoiceNum],
                'AND',
                ['internalid', 'noneof', currentDocId || '@NONE@']
            ]
        }).run().getRange({ start: 0, end: 1 }).forEach(function() {
            isDuplicate = true;
        });
        
        return isDuplicate;
    }

    /**
     * Toggle field visibility
     */
    function toggleFields(fieldIds, show) {
        fieldIds.forEach(function(fieldId) {
            const fieldContainer = document.getElementById(fieldId + '_fs');
            if (fieldContainer) {
                fieldContainer.style.display = show ? '' : 'none';
            }
        });
    }

    /**
     * Initialize tooltips
     */
    function initializeTooltips() {
        // Add tooltips to confidence-related fields
        const confidenceField = document.getElementById('custrecord_dm_confidence_score_fs');
        if (confidenceField) {
            confidenceField.title = 'AI confidence in extraction accuracy (0-100%)';
        }
    }

    /**
     * Initialize keyboard shortcuts
     */
    function initializeKeyboardShortcuts() {
        document.addEventListener('keydown', function(e) {
            // Ctrl+Shift+P - Process document
            if (e.ctrlKey && e.shiftKey && e.key === 'P') {
                e.preventDefault();
                if (typeof window.dmProcessDocument === 'function') {
                    window.dmProcessDocument();
                }
            }
            
            // Ctrl+Shift+R - Review document
            if (e.ctrlKey && e.shiftKey && e.key === 'R') {
                e.preventDefault();
                if (typeof window.dmReviewDocument === 'function') {
                    window.dmReviewDocument();
                }
            }
        });
    }

    /**
     * Animate confidence meter
     */
    function animateConfidenceMeter() {
        const meter = document.querySelector('.dm-confidence-meter');
        if (meter) {
            meter.style.transition = 'stroke-dashoffset 1s ease-out';
        }
    }

    /**
     * Highlight fields with anomalies
     */
    function highlightAnomalyFields(rec) {
        const anomaliesStr = rec.getValue('custrecord_dm_anomalies');
        if (!anomaliesStr) return;
        
        const anomalies = JSON.parse(anomaliesStr);
        
        const fieldMap = {
            'duplicate_invoice': 'custrecord_dm_invoice_number',
            'amount_anomaly': 'custrecord_dm_total_amount',
            'date_anomaly': 'custrecord_dm_invoice_date',
            'vendor_mismatch': 'custrecord_dm_vendor'
        };
        
        anomalies.forEach(function(anomaly) {
            const fieldId = fieldMap[anomaly.type];
            if (fieldId) {
                const field = document.getElementById(fieldId + '_fs');
                if (field) {
                    field.style.backgroundColor = anomaly.severity === 'high' ? '#fee2e2' : '#fef3c7';
                    field.style.borderLeft = '3px solid ' + (anomaly.severity === 'high' ? '#ef4444' : '#f59e0b');
                }
            }
        });
    }

    /**
     * Setup auto-save functionality
     */
    function setupAutoSave() {
        // Auto-save draft every 2 minutes
        let autoSaveTimer = null;
        
        document.addEventListener('input', function() {
            if (autoSaveTimer) clearTimeout(autoSaveTimer);
            
            autoSaveTimer = setTimeout(function() {
                saveDraft();
            }, 120000); // 2 minutes
        });
    }

    /**
     * Save draft to local storage
     */
    function saveDraft() {
        try {
            const rec = currentRecord.get();
            const draftData = {
                vendor: rec.getValue('custrecord_dm_vendor'),
                invoiceNumber: rec.getValue('custrecord_dm_invoice_number'),
                totalAmount: rec.getValue('custrecord_dm_total_amount'),
                savedAt: new Date().toISOString()
            };
            
            localStorage.setItem('dm_draft_' + rec.id, JSON.stringify(draftData));
            console.log('DocuMind: Draft saved');
        } catch (e) {
            console.error('DocuMind: Draft save failed', e);
        }
    }

    /**
     * Initialize smart suggestions
     */
    function initializeSmartSuggestions(rec) {
        // Vendor suggestions based on extracted text
        const extractedText = rec.getValue('custrecord_dm_extracted_text');
        if (extractedText) {
            // Could implement smart vendor suggestion logic here
        }
    }

    /**
     * Show message to user
     */
    function showMessage(type, msg) {
        message.create({
            type: message.Type[type.toUpperCase()] || message.Type.INFORMATION,
            title: 'DocuMind',
            message: msg,
            duration: 5000
        }).show();
    }

    /**
     * Show loading message
     */
    function showLoadingMessage(msg) {
        const loadingDiv = document.createElement('div');
        loadingDiv.id = 'dm-loading';
        loadingDiv.innerHTML = `
            <div style="position: fixed; top: 0; left: 0; right: 0; bottom: 0; background: rgba(0,0,0,0.5); z-index: 10000; display: flex; align-items: center; justify-content: center;">
                <div style="background: white; padding: 24px; border-radius: 8px; display: flex; align-items: center; gap: 12px;">
                    <div style="width: 24px; height: 24px; border: 3px solid #e2e8f0; border-top-color: #6366f1; border-radius: 50%; animation: spin 1s linear infinite;"></div>
                    <span>${msg}</span>
                </div>
            </div>
            <style>@keyframes spin { to { transform: rotate(360deg); } }</style>
        `;
        document.body.appendChild(loadingDiv);
    }

    /**
     * Hide loading message
     */
    function hideLoadingMessage() {
        const loadingDiv = document.getElementById('dm-loading');
        if (loadingDiv) {
            loadingDiv.remove();
        }
    }

    return {
        pageInit: pageInit,
        fieldChanged: fieldChanged,
        lineInit: lineInit,
        validateField: validateField,
        validateLine: validateLine,
        saveRecord: saveRecord,
        sublistChanged: sublistChanged
    };
});
