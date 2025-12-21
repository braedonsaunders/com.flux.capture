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
            this.validationRules = this.initializeRules();
        }

        /**
         * Initialize validation rules
         */
        initializeRules() {
            return [
                // Amount validation rules
                {
                    name: 'subtotal_tax_total',
                    fields: ['subtotal', 'taxAmount', 'totalAmount'],
                    validate: (fields) => this.validateSubtotalTaxTotal(fields),
                    severity: Severity.WARNING
                },
                {
                    name: 'line_items_total',
                    fields: ['lineItems', 'subtotal', 'totalAmount'],
                    validate: (fields, context) => this.validateLineItemsTotal(fields, context),
                    severity: Severity.WARNING
                },
                {
                    name: 'positive_amounts',
                    fields: ['totalAmount', 'subtotal'],
                    validate: (fields) => this.validatePositiveAmounts(fields),
                    severity: Severity.WARNING
                },

                // Date validation rules
                {
                    name: 'due_after_invoice',
                    fields: ['invoiceDate', 'dueDate'],
                    validate: (fields) => this.validateDueDateAfterInvoice(fields),
                    severity: Severity.WARNING
                },
                {
                    name: 'invoice_not_future',
                    fields: ['invoiceDate'],
                    validate: (fields) => this.validateInvoiceDateNotFuture(fields),
                    severity: Severity.ERROR
                },
                {
                    name: 'reasonable_date_range',
                    fields: ['invoiceDate'],
                    validate: (fields) => this.validateReasonableDateRange(fields),
                    severity: Severity.WARNING
                },

                // Required field validation
                {
                    name: 'required_for_invoice',
                    fields: ['invoiceNumber', 'totalAmount'],
                    validate: (fields, context) => this.validateRequiredFields(fields, context),
                    severity: Severity.ERROR
                },

                // Suspicious value detection
                {
                    name: 'benford_law',
                    fields: ['totalAmount'],
                    validate: (fields) => this.validateBenfordLaw(fields),
                    severity: Severity.INFO
                },
                {
                    name: 'round_number_check',
                    fields: ['totalAmount', 'taxAmount'],
                    validate: (fields) => this.validateRoundNumbers(fields),
                    severity: Severity.INFO
                }
            ];
        }

        /**
         * Validate all fields
         * @param {Object} extraction - Extracted document data
         * @param {Object} context - Validation context (enableAmountValidation, etc.)
         * @returns {Object} Validation result
         */
        validate(extraction, context = {}) {
            const issues = [];
            const fields = extraction.fields || {};
            const enableAmountValidation = context.enableAmountValidation !== false;

            // Add line items to fields for validation
            const allFields = {
                ...fields,
                lineItems: extraction.lineItems || []
            };

            // Amount validation rules that can be disabled
            const amountRules = ['subtotal_tax_total', 'line_items_total', 'positive_amounts'];

            // Run all validation rules
            for (const rule of this.validationRules) {
                // Skip amount validation rules if disabled
                if (!enableAmountValidation && amountRules.includes(rule.name)) {
                    continue;
                }

                // Check if required fields exist
                const hasRequiredFields = rule.fields.some(f =>
                    allFields[f] !== null && allFields[f] !== undefined
                );

                if (hasRequiredFields) {
                    const ruleIssues = rule.validate(allFields, context);
                    if (ruleIssues && ruleIssues.length > 0) {
                        ruleIssues.forEach(issue => {
                            issues.push({
                                ...issue,
                                rule: rule.name,
                                severity: issue.severity || rule.severity
                            });
                        });
                    }
                }
            }

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
        validateLineItemsTotal(fields, context) {
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
                    suggestion: 'Verify document type (invoice vs credit memo)'
                });
            }

            if (fields.subtotal !== undefined && fields.subtotal < 0) {
                issues.push({
                    type: IssueType.VALUE_SUSPICIOUS,
                    message: 'Subtotal is negative',
                    field: 'subtotal',
                    value: fields.subtotal
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
                    suggestion: 'Date format may be incorrect (MM/DD vs DD/MM)'
                });
            }

            return issues;
        }

        /**
         * Validate date is within reasonable range
         */
        validateReasonableDateRange(fields) {
            const issues = [];

            const invoiceDate = this.parseDate(fields.invoiceDate);
            if (!invoiceDate) return issues;

            const today = new Date();
            const fiveYearsAgo = new Date(today.getFullYear() - 5, 0, 1);

            if (invoiceDate < fiveYearsAgo) {
                issues.push({
                    type: IssueType.DATE_INVALID,
                    message: `Invoice date (${this.formatDate(invoiceDate)}) is more than 5 years old`,
                    field: 'invoiceDate',
                    severity: Severity.WARNING,
                    suggestion: 'Verify year is correct'
                });
            }

            return issues;
        }

        /**
         * Validate required fields
         */
        validateRequiredFields(fields, context) {
            const issues = [];

            // Invoice number is required
            if (!fields.invoiceNumber) {
                issues.push({
                    type: IssueType.MISSING_REQUIRED,
                    message: 'Invoice number not detected',
                    field: 'invoiceNumber',
                    severity: Severity.WARNING
                });
            }

            // Total amount is required
            if (!fields.totalAmount || fields.totalAmount === 0) {
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
         * Benford's Law check for suspicious amounts
         */
        validateBenfordLaw(fields) {
            const issues = [];

            const amount = fields.totalAmount;
            if (!amount || amount < 1000) return issues;

            const firstDigit = parseInt(String(Math.floor(Math.abs(amount)))[0]);

            // Benford's Law: smaller digits (1-3) should be more common as first digits
            // Digits 7, 8, 9 as first digit occur only ~12% of the time naturally
            if (firstDigit >= 7 && amount > 10000) {
                issues.push({
                    type: IssueType.VALUE_SUSPICIOUS,
                    message: `Amount ${amount.toFixed(2)} has unusual first digit pattern (Benford's Law check)`,
                    field: 'totalAmount',
                    severity: Severity.INFO,
                    firstDigit: firstDigit,
                    suggestion: 'Statistically unusual but not necessarily wrong'
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
                        suggestion: 'Round amounts may indicate estimates or potential fraud'
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
