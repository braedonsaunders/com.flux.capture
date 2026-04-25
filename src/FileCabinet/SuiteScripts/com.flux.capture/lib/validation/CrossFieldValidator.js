/**
 * @NApiVersion 2.1
 * @NModuleScope Public
 * @module FluxCapture/Validation/CrossFieldValidator
 *
 * Cross-Field Validator
 * Validates extracted fields against each other for consistency and accuracy
 */

define(['N/log'], function(log) {
    'use strict';

    /**
     * Validation severity levels
     */
    const Severity = Object.freeze({
        ERROR: 'error',     // Critical - likely extraction error
        WARNING: 'warning', // Suspicious but possible
        INFO: 'info'        // Informational
    });

    /**
     * Validation issue types
     */
    const IssueType = Object.freeze({
        AMOUNT_MISMATCH: 'amount_mismatch',
        DATE_INVALID: 'date_invalid',
        DATE_SEQUENCE: 'date_sequence',
        MISSING_REQUIRED: 'missing_required',
        DUPLICATE: 'duplicate',
        VALUE_SUSPICIOUS: 'value_suspicious',
        LINE_ITEM_MISMATCH: 'line_item_mismatch',
        FORMAT_INCONSISTENT: 'format_inconsistent'
    });

    /**
     * Cross-Field Validator
     * Validates relationships between extracted fields
     */
    class CrossFieldValidator {
        constructor() {
            // Rules are now dynamically filtered based on settings
        }

        /**
         * Validate all fields
         * @param {Object} extraction - Extracted document data
         * @param {Object} settings - Anomaly detection settings from FC_Engine
         * @returns {Object} Validation result
         */
        validate(extraction, settings = {}) {
            const issues = [];
            const fields = extraction.fields || {};

            // Add line items to fields for validation
            const allFields = {
                ...fields,
                lineItems: extraction.lineItems || []
            };

            // Amount validation rules
            if (settings.validateSubtotalTax !== false) {
                const subtotalIssues = this.validateSubtotalTaxTotal(allFields);
                issues.push(...subtotalIssues);
            }

            if (settings.validateLineItemsTotal !== false) {
                const lineItemIssues = this.validateLineItemsTotal(allFields);
                issues.push(...lineItemIssues);
            }

            if (settings.validatePositiveAmounts !== false) {
                const positiveIssues = this.validatePositiveAmounts(allFields);
                issues.push(...positiveIssues);
            }

            if (settings.detectRoundAmounts === true) { // Default OFF
                const roundIssues = this.validateRoundNumbers(allFields);
                issues.push(...roundIssues);
            }

            // Date validation rules
            if (settings.validateFutureDate !== false) {
                const futureIssues = this.validateInvoiceDateNotFuture(allFields);
                issues.push(...futureIssues);
            }

            if (settings.validateDueDateSequence !== false) {
                const sequenceIssues = this.validateDueDateAfterInvoice(allFields);
                issues.push(...sequenceIssues);
            }

            if (settings.validateStaleDate !== false) {
                const staleIssues = this.validateReasonableDateRange(allFields);
                issues.push(...staleIssues);
            }

            // Required fields validation
            const requiredIssues = this.validateRequiredFields(allFields, settings);
            issues.push(...requiredIssues);

            // Calculate overall validity
            const errors = issues.filter(i => i.severity === Severity.ERROR);
            const warnings = issues.filter(i => i.severity === Severity.WARNING);

            const result = {
                valid: errors.length === 0,
                issues: issues,
                summary: {
                    errors: errors.length,
                    warnings: warnings.length,
                    info: issues.length - errors.length - warnings.length
                }
            };

            log.debug('CrossFieldValidator.validate', {
                valid: result.valid,
                errors: result.summary.errors,
                warnings: result.summary.warnings
            });

            return result;
        }

        /**
         * Validate subtotal + tax = total
         */
        validateSubtotalTaxTotal(fields) {
            const issues = [];

            const subtotal = fields.subtotal || 0;
            const taxAmount = fields.taxAmount || 0;
            const totalAmount = fields.totalAmount || 0;

            // Skip if we don't have total
            if (!totalAmount) return issues;

            // Skip if we don't have components
            if (!subtotal && !taxAmount) return issues;

            const calculated = subtotal + taxAmount;
            const diff = Math.abs(totalAmount - calculated);
            const diffPercent = totalAmount > 0 ? (diff / totalAmount) * 100 : 0;

            // Allow small rounding differences (0.5%)
            if (diff > 0.01 && diffPercent > 0.5) {
                issues.push({
                    type: IssueType.AMOUNT_MISMATCH,
                    message: `Subtotal (${subtotal.toFixed(2)}) + Tax (${taxAmount.toFixed(2)}) = ${calculated.toFixed(2)}, but Total is ${totalAmount.toFixed(2)}`,
                    expected: calculated,
                    actual: totalAmount,
                    difference: diff,
                    differencePercent: diffPercent.toFixed(2),
                    severity: Severity.WARNING,
                    suggestion: diffPercent < 10 ?
                        'May be rounding or additional fees' :
                        'Likely extraction error - verify amounts'
                });
            }

            return issues;
        }

        /**
         * Validate line items sum matches subtotal/total
         */
        validateLineItemsTotal(fields) {
            const issues = [];

            const lineItems = fields.lineItems || [];
            if (lineItems.length === 0) return issues;

            const lineItemsTotal = lineItems.reduce((sum, item) =>
                sum + (item.amount || 0), 0
            );

            // Compare to subtotal first (before tax)
            const subtotal = fields.subtotal || 0;
            const totalAmount = fields.totalAmount || 0;

            // Compare to subtotal if available
            if (subtotal > 0) {
                const diff = Math.abs(lineItemsTotal - subtotal);
                const diffPercent = (diff / subtotal) * 100;

                if (diff > 0.01 && diffPercent > 5) {
                    issues.push({
                        type: IssueType.LINE_ITEM_MISMATCH,
                        message: `Line items total (${lineItemsTotal.toFixed(2)}) differs from subtotal (${subtotal.toFixed(2)})`,
                        severity: diffPercent > 20 ? Severity.WARNING : Severity.INFO,
                        expected: subtotal,
                        actual: lineItemsTotal,
                        differencePercent: diffPercent.toFixed(2),
                        suggestion: 'Some line items may not have been extracted'
                    });
                }
            }
            // Otherwise compare to total (less accurate due to tax)
            else if (totalAmount > 0) {
                const diff = Math.abs(lineItemsTotal - totalAmount);
                const diffPercent = (diff / totalAmount) * 100;

                // More tolerance when comparing to total (tax variance)
                if (diff > 0.01 && diffPercent > 15) {
                    issues.push({
                        type: IssueType.LINE_ITEM_MISMATCH,
                        message: `Line items total (${lineItemsTotal.toFixed(2)}) differs from invoice total (${totalAmount.toFixed(2)})`,
                        severity: Severity.INFO,
                        expected: totalAmount,
                        actual: lineItemsTotal,
                        differencePercent: diffPercent.toFixed(2),
                        suggestion: 'Difference may be tax or fees not in line items'
                    });
                }
            }

            return issues;
        }

        /**
         * Validate amounts are positive (for invoices)
         */
        validatePositiveAmounts(fields) {
            const issues = [];

            if (fields.totalAmount !== undefined && fields.totalAmount < 0) {
                issues.push({
                    type: IssueType.VALUE_SUSPICIOUS,
                    message: 'Total amount is negative - may be a credit memo',
                    field: 'totalAmount',
                    value: fields.totalAmount,
                    severity: Severity.WARNING,
                    suggestion: 'Verify document type (invoice vs credit memo)'
                });
            }

            if (fields.subtotal !== undefined && fields.subtotal < 0) {
                issues.push({
                    type: IssueType.VALUE_SUSPICIOUS,
                    message: 'Subtotal is negative',
                    field: 'subtotal',
                    value: fields.subtotal,
                    severity: Severity.WARNING
                });
            }

            return issues;
        }

        /**
         * Validate due date is after invoice date
         */
        validateDueDateAfterInvoice(fields) {
            const issues = [];

            const invoiceDate = this.parseDate(fields.invoiceDate);
            const dueDate = this.parseDate(fields.dueDate);

            if (!invoiceDate || !dueDate) return issues;

            if (dueDate < invoiceDate) {
                issues.push({
                    type: IssueType.DATE_SEQUENCE,
                    message: `Due date (${this.formatDate(dueDate)}) is before invoice date (${this.formatDate(invoiceDate)})`,
                    fields: ['invoiceDate', 'dueDate'],
                    severity: Severity.WARNING,
                    suggestion: 'Dates may be swapped or in wrong format'
                });
            }

            // Check for unusually long payment terms (> 120 days)
            const daysDiff = (dueDate - invoiceDate) / (1000 * 60 * 60 * 24);
            if (daysDiff > 120) {
                issues.push({
                    type: IssueType.VALUE_SUSPICIOUS,
                    message: `Payment terms of ${Math.round(daysDiff)} days is unusually long`,
                    severity: Severity.INFO,
                    fields: ['dueDate']
                });
            }

            return issues;
        }

        /**
         * Validate invoice date is not in the future
         */
        validateInvoiceDateNotFuture(fields) {
            const issues = [];

            const invoiceDate = this.parseDate(fields.invoiceDate);
            if (!invoiceDate) return issues;

            const today = new Date();
            today.setHours(23, 59, 59, 999);

            // Allow a few days grace for timezone issues
            const futureThreshold = new Date(today.getTime() + 3 * 24 * 60 * 60 * 1000);

            if (invoiceDate > futureThreshold) {
                issues.push({
                    type: IssueType.DATE_INVALID,
                    message: `Invoice date (${this.formatDate(invoiceDate)}) is in the future`,
                    field: 'invoiceDate',
                    severity: Severity.ERROR,
                    suggestion: 'Date format may be incorrect (MM/DD vs DD/MM)'
                });
            }

            return issues;
        }

        /**
         * Validate date is within reasonable range (not stale)
         */
        validateReasonableDateRange(fields) {
            const issues = [];

            const invoiceDate = this.parseDate(fields.invoiceDate);
            if (!invoiceDate) return issues;

            const today = new Date();
            const oneYearAgo = new Date(today.getFullYear() - 1, today.getMonth(), today.getDate());

            if (invoiceDate < oneYearAgo) {
                issues.push({
                    type: IssueType.DATE_INVALID,
                    message: `Invoice date (${this.formatDate(invoiceDate)}) is more than 1 year old`,
                    field: 'invoiceDate',
                    severity: Severity.WARNING,
                    suggestion: 'Verify date is correct - invoice may be stale'
                });
            }

            return issues;
        }

        /**
         * Validate required fields (respects settings)
         */
        validateRequiredFields(fields, settings) {
            const issues = [];

            // Invoice number is required (if setting enabled)
            if (settings.requireInvoiceNumber !== false && !fields.invoiceNumber) {
                issues.push({
                    type: IssueType.MISSING_REQUIRED,
                    message: 'Invoice number not detected',
                    field: 'invoiceNumber',
                    severity: Severity.WARNING
                });
            }

            // Total amount is required (if setting enabled)
            if (settings.requireTotalAmount !== false && (!fields.totalAmount || fields.totalAmount === 0)) {
                issues.push({
                    type: IssueType.MISSING_REQUIRED,
                    message: 'Total amount not detected or is zero',
                    field: 'totalAmount',
                    severity: Severity.ERROR
                });
            }

            return issues;
        }

        /**
         * Check for suspiciously round numbers
         */
        validateRoundNumbers(fields) {
            const issues = [];

            const checkRound = (value, fieldName) => {
                if (!value || value < 100) return;

                // Check if amount is exactly round (no cents, divisible by 100)
                const isExactlyRound = value % 100 === 0 && value >= 1000;

                if (isExactlyRound) {
                    issues.push({
                        type: IssueType.VALUE_SUSPICIOUS,
                        message: `${fieldName} of ${value.toFixed(2)} is a round number`,
                        field: fieldName,
                        severity: Severity.INFO,
                        suggestion: 'Round amounts may indicate estimates'
                    });
                }
            };

            checkRound(fields.totalAmount, 'totalAmount');
            // Don't check tax - tax amounts are often round

            return issues;
        }

        /**
         * Parse date from various formats
         */
        parseDate(value) {
            if (!value) return null;
            if (value instanceof Date) return value;

            try {
                const date = new Date(value);
                if (!isNaN(date.getTime())) return date;
            } catch (e) {
                // Ignore
            }

            return null;
        }

        /**
         * Format date for display
         */
        formatDate(date) {
            if (!date) return 'N/A';
            return date.toLocaleDateString();
        }

        /**
         * Get validation issue types enum
         */
        static get IssueType() {
            return IssueType;
        }

        /**
         * Get severity enum
         */
        static get Severity() {
            return Severity;
        }
    }

    return {
        CrossFieldValidator: CrossFieldValidator,
        IssueType: IssueType,
        Severity: Severity
    };
});
