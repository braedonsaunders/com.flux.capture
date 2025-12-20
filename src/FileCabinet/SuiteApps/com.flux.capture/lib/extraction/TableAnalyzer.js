/**
 * @NApiVersion 2.1
 * @NModuleScope Public
 * @module FluxCapture/Extraction/TableAnalyzer
 *
 * Smart Table Analyzer v4.1
 * Intelligent column detection, multi-row item handling, and line item extraction
 *
 * v4.1 Improvements:
 * - Enhanced memo extraction: scans ALL row cells for text-heavy content
 * - Uses DESCRIPTION column as memo fallback when no dedicated MEMO column
 * - Aggressive text field scanning for memo content
 * - Better memo population from any available text fields
 *
 * v4.0 Improvements:
 * - FORWARD-LOOKING row association: captures item codes/descriptions from rows AFTER anchor
 * - Math validation: validates qty × rate = amount, flags/corrects mismatches
 * - Enhanced European number format parsing (1.234,56 format)
 * - OCR error correction for common mistakes ($→S, O→0, etc.)
 * - Improved amount parsing with format auto-detection
 *
 * v3.1 Improvements:
 * - Fixed backward-lookback to always capture item codes from orphan rows
 * - Combines descriptions from orphan rows when item code is merged
 * - Handles multi-row line items where first row has item code but no amount
 *
 * v3.0 Improvements:
 * - Comprehensive diagnostic logging system for troubleshooting
 * - Position-aware summary detection (must be in bottom 25%)
 * - Less aggressive filtering (accepts $0 amounts, short descriptions)
 * - Quantity-aware conditional summary patterns
 *
 * v2.0 Improvements:
 * - Two-pass row classification for better line item detection
 * - Description content analysis to extract embedded memos
 * - Reduced aggressive filtering with explicit warnings
 * - Better multi-row grouping using proximity
 */

define(['N/log', '../FC_Debug'], function(log, fcDebug) {
    'use strict';

    /**
     * Column semantic types
     */
    const ColumnType = Object.freeze({
        ITEM_CODE: 'ITEM_CODE',
        DESCRIPTION: 'DESCRIPTION',
        MEMO: 'MEMO',
        QUANTITY: 'QUANTITY',
        UNIT: 'UNIT',
        UNIT_PRICE: 'UNIT_PRICE',
        AMOUNT: 'AMOUNT',
        TAX: 'TAX',
        DISCOUNT: 'DISCOUNT',
        DATE: 'DATE',
        UNKNOWN: 'UNKNOWN'
    });

    /**
     * Patterns to detect memo content within description text
     */
    const MEMO_EXTRACTION_PATTERNS = [
        // Explicit memo prefixes
        { pattern: /\b(?:memo|note|remark|comment|instruction)s?\s*[:\-]\s*(.+)$/i, group: 1 },
        { pattern: /^\s*(?:memo|note|remark|comment|instruction)s?\s*[:\-]\s*(.+)/i, group: 1 },
        // Parenthetical notes at end
        { pattern: /\s*\(([^)]{10,})\)\s*$/i, group: 1, minLength: 10 },
        // Dash or colon separated trailing notes
        { pattern: /\s+[-–—]\s+([A-Z][^.]+\.?)$/i, group: 1, minLength: 15 },
        // "Special:" or "Note:" style
        { pattern: /\bspecial\s*[:\-]\s*(.+)$/i, group: 1 },
        { pattern: /\bref(?:erence)?\s*[:\-]\s*(.+)$/i, group: 1 },
        // Multi-line where second part is note-like
        { pattern: /^(.+?)\n\s*(?:note|memo|remark)?\s*[:\-]?\s*([A-Z].{10,})$/im, group: 2 }
    ];

    /**
     * Keywords that indicate a row is likely a memo/note continuation
     */
    const MEMO_ROW_INDICATORS = [
        /^note\s*:/i, /^memo\s*:/i, /^remark\s*:/i, /^comment\s*:/i,
        /^special\s+instruction/i, /^please\s+/i, /^attention\s*:/i,
        /^important\s*:/i, /^ref\s*:/i, /^reference\s*:/i,
        /^\*\s*/, /^•\s*/, /^-\s+[A-Z]/
    ];

    /**
     * Smart Table Analyzer v3.0
     * Uses multiple signals to identify columns and extract line items
     *
     * v3.0 Improvements:
     * - Fixed overly strict filtering (accepts $0 amounts, calculates from qty*rate)
     * - Position-aware summary row detection (must be in bottom 25%)
     * - Context-aware row classification
     * - Better column detection sampling (not just first 10 rows)
     * - Provider-agnostic design
     * - Comprehensive diagnostic logging for debugging
     */
    class TableAnalyzer {
        constructor(amountParser) {
            this.amountParser = amountParser;
            this.warnings = []; // Track extraction warnings
            this.diagnostics = []; // Track detailed diagnostic info
            this.initializePatterns();
        }

        /**
         * Add diagnostic entry for debugging
         */
        addDiagnostic(stage, message, data = {}) {
            this.diagnostics.push({
                stage: stage,
                message: message,
                timestamp: new Date().toISOString(),
                ...data
            });
        }

        /**
         * Log diagnostics to fcDebug (audit level for visibility)
         */
        logDiagnostics(tableIndex = 0) {
            fcDebug.debugAudit(`TableAnalyzer.DIAG[${tableIndex}]`, '========== TABLE EXTRACTION DIAGNOSTICS ==========');
            this.diagnostics.forEach((d, i) => {
                const dataStr = Object.keys(d).filter(k => !['stage', 'message', 'timestamp'].includes(k)).length > 0
                    ? ' | ' + JSON.stringify(Object.fromEntries(Object.entries(d).filter(([k]) => !['stage', 'message', 'timestamp'].includes(k))))
                    : '';
                fcDebug.debugAudit(`TableAnalyzer.DIAG[${tableIndex}][${i}]`, `[${d.stage}] ${d.message}${dataStr}`);
            });
        }

        /**
         * Reset warnings and diagnostics for new analysis
         */
        resetWarnings() {
            this.warnings = [];
            this.diagnostics = [];
        }

        /**
         * Add a warning about extraction issues
         */
        addWarning(type, message, details = {}) {
            this.warnings.push({
                type: type,
                message: message,
                ...details
            });
        }

        initializePatterns() {
            // v4.0: Expanded header patterns for column detection
            // Added many more variations based on real-world invoice formats
            this.HEADER_PATTERNS = {
                [ColumnType.ITEM_CODE]: [
                    /^(item|sku|part|product)\s*(code|no\.?|#|number|id)?$/i,
                    /^code$/i, /^sku$/i, /^part\s*#?$/i, /^stock\s*#?$/i,
                    /^article\s*(no\.?|#|number)?$/i,                    // European
                    /^catalog\s*(no\.?|#)?$/i,                           // Catalog
                    /^ref(\.|erence)?\s*(no\.?|#|code)?$/i,              // Reference
                    /^model\s*(no\.?|#)?$/i,                             // Model number
                    /^p\/n$/i, /^pn$/i,                                  // Part number abbreviations
                    /^material\s*(no\.?|#|code)?$/i,                     // SAP style
                    /^vendor\s*(part|sku|code)$/i,                       // Vendor part
                    /^mfg\s*(part|code|#)$/i, /^mfr\s*(part|#)$/i,       // Manufacturer part
                    /^upc$/i, /^ean$/i, /^isbn$/i, /^asin$/i,            // Standard codes
                    /^line\s*#?$/i, /^#$/i, /^no\.?$/i,                  // Line number (often item code)
                    /^s\.?\s*no\.?$/i, /^sr\.?\s*no\.?$/i,               // Serial number
                    /^item\s*$/i                                         // Just "item" can be code
                ],
                [ColumnType.DESCRIPTION]: [
                    /^desc(ription)?$/i, /^item$/i, /^product$/i, /^service$/i,
                    /^particulars$/i, /^details$/i, /^name$/i,
                    /^goods$/i, /^materials?$/i,
                    /^product\s*(name|desc(ription)?)?$/i,              // Product variations
                    /^item\s*desc(ription)?$/i,                          // Item description
                    /^service\s*desc(ription)?$/i,                       // Service description
                    /^line\s*desc(ription)?$/i,                          // Line description
                    /^work\s*desc(ription)?$/i,                          // Work description
                    /^spec(ification)?s?$/i,                             // Specifications
                    /^item\s*\/\s*desc(ription)?$/i,                     // Item / Description
                    /^product\s*\/\s*service$/i,                         // Product / Service
                    /^description\s*of\s*(goods|services?|items?)$/i,   // Full description label
                    /^what$/i,                                           // Simple "What"
                    /^activity$/i,                                       // Activity
                    /^task$/i,                                           // Task
                    /^labor$/i, /^labour$/i                              // Labor
                ],
                [ColumnType.MEMO]: [
                    /^memo$/i, /^notes?$/i, /^remarks?$/i, /^comments?$/i,
                    /^line\s*(memo|note)s?$/i, /^item\s*(memo|note)s?$/i,
                    /^additional\s*(info|notes?)$/i, /^instructions?$/i,
                    /^special\s*instructions?$/i,                        // Special instructions
                    /^internal\s*(memo|notes?)$/i,                       // Internal notes
                    /^vendor\s*(memo|notes?)$/i                          // Vendor notes
                ],
                [ColumnType.QUANTITY]: [
                    /^qty$/i, /^quantity$/i, /^units?$/i, /^count$/i,
                    /^pcs$/i, /^pieces?$/i, /^no\.?\s*of/i, /^ordered$/i,
                    /^qty\.?$/i,                                         // Qty.
                    /^qnty$/i,                                           // Alternate spelling
                    /^q'?ty$/i,                                          // Q'ty (Japanese style)
                    /^shipped$/i, /^delivered$/i, /^received$/i,        // Shipping quantities
                    /^ord(ered)?\s*qty$/i,                               // Ordered quantity
                    /^ship\s*qty$/i,                                     // Ship quantity
                    /^hours?$/i, /^hrs?\.?$/i,                           // Hours for services
                    /^days?$/i,                                          // Days
                    /^amount$/i                                          // Sometimes "Amount" means quantity
                ],
                [ColumnType.UNIT]: [
                    /^unit$/i, /^uom$/i, /^u\/m$/i, /^measure$/i,
                    /^unit\s*of\s*measure$/i,
                    /^um$/i,                                             // UM abbreviation
                    /^pack$/i, /^package$/i,                             // Package
                    /^size$/i,                                           // Size
                    /^type$/i                                            // Type (sometimes unit)
                ],
                [ColumnType.UNIT_PRICE]: [
                    /^(unit\s*)?(price|rate|cost)$/i, /^each$/i,
                    /^rate$/i, /^unit\s*cost$/i, /^price\s*per$/i,
                    /^\$\s*\/\s*unit$/i,
                    /^price$/i,                                          // Just "Price"
                    /^cost$/i,                                           // Just "Cost"
                    /^unit\s*rate$/i,                                    // Unit rate
                    /^list\s*price$/i,                                   // List price
                    /^sell\s*price$/i,                                   // Sell price
                    /^net\s*price$/i,                                    // Net price
                    /^per\s*unit$/i,                                     // Per unit
                    /^\$\s*each$/i,                                      // $ each
                    /^rate\s*\/\s*hr$/i, /^hourly\s*rate$/i,             // Hourly rate
                    /^daily\s*rate$/i,                                   // Daily rate
                    /^single\s*price$/i                                  // Single price
                ],
                [ColumnType.AMOUNT]: [
                    /^amount$/i, /^(line\s*)?total$/i, /^extended$/i,
                    /^ext\.?$/i, /^sum$/i, /^value$/i,
                    /^line\s*amount$/i, /^ext\.?\s*price$/i,
                    /^total\s*price$/i,                                  // Total price
                    /^net\s*amount$/i,                                   // Net amount
                    /^gross\s*amount$/i,                                 // Gross amount
                    /^ext(ended)?\s*amount$/i,                           // Extended amount
                    /^line\s*total$/i,                                   // Line total
                    /^item\s*total$/i,                                   // Item total
                    /^subtotal$/i,                                       // Subtotal (per line)
                    /^totale$/i,                                         // Italian
                    /^montant$/i, /^prix$/i,                             // French
                    /^betrag$/i, /^summe$/i,                             // German
                    /^importe$/i,                                        // Spanish
                    /^amt$/i,                                            // Amt abbreviation
                    /^charge$/i, /^fee$/i                                // Charge/Fee
                ],
                [ColumnType.TAX]: [
                    /^tax$/i, /^vat$/i, /^gst$/i, /^hst$/i,
                    /^tax\s*amount$/i, /^tax\s*%$/i,
                    /^pst$/i, /^qst$/i,                                  // Canadian provincial taxes
                    /^sales\s*tax$/i,                                    // Sales tax
                    /^tax\s*rate$/i,                                     // Tax rate
                    /^vat\s*%$/i, /^vat\s*rate$/i,                        // VAT rate
                    /^mwst$/i, /^ust$/i,                                 // German VAT
                    /^tva$/i,                                            // French VAT
                    /^iva$/i,                                            // Spanish/Italian VAT
                    /^igst$/i, /^cgst$/i, /^sgst$/i                      // Indian GST
                ],
                [ColumnType.DISCOUNT]: [
                    /^discount$/i, /^disc\.?$/i, /^disc\s*%$/i,
                    /^savings?$/i,
                    /^less$/i,                                           // Less (discount)
                    /^rebate$/i,                                         // Rebate
                    /^reduction$/i,                                      // Reduction
                    /^allowance$/i,                                      // Allowance
                    /^disc(ount)?\s*amount$/i,                           // Discount amount
                    /^%\s*off$/i, /^off$/i                               // % off
                ],
                [ColumnType.DATE]: [
                    /^date$/i, /^ship\s*date$/i, /^delivery$/i,
                    /^delivery\s*date$/i,                                // Delivery date
                    /^ship(ping)?\s*date$/i,                             // Shipping date
                    /^service\s*date$/i,                                 // Service date
                    /^order\s*date$/i,                                   // Order date
                    /^line\s*date$/i,                                    // Line date
                    /^exp(iry)?\s*date$/i,                               // Expiry date
                    /^period$/i                                          // Period
                ]
            };

            // v4.0: Enhanced data patterns for inferring column types
            this.DATA_PATTERNS = {
                [ColumnType.ITEM_CODE]: /^[A-Z0-9][\w\-\/\.]{1,20}$/i,   // More flexible item codes
                [ColumnType.QUANTITY]: /^-?\d{1,5}([.,]\d{1,3})?$/,      // Allow negative, larger quantities
                [ColumnType.UNIT_PRICE]: /^[\$€£¥]?\s*-?\d{1,7}[.,]\d{2}$/, // More currencies, larger prices
                [ColumnType.AMOUNT]: /^[\$€£¥]?\s*-?\d{1,10}[.,]\d{2}$/,    // Allow larger amounts
                [ColumnType.DATE]: /\d{1,4}[\-\/\.]\d{1,2}[\-\/\.]\d{1,4}/ // More date formats
            };

            // Summary row indicators - STRICT patterns only
            // Position check is now required in addition to pattern match
            this.SUMMARY_PATTERNS = [
                /^sub\s*total$/i, /^subtotal$/i,
                /^grand\s*total$/i,
                /^total\s*(amount|due|payable)?\s*$/i,
                /^amount\s*(due|payable|owing)$/i,
                /^balance\s*(due|forward)?$/i,
                /^net\s*(amount|total|due)$/i,
                /^gross\s*(amount|total)$/i
            ];

            // These patterns ONLY match if NO quantity is present
            // (because "tax", "shipping", "discount" can be legitimate line items)
            this.SUMMARY_PATTERNS_NO_QTY = [
                /^tax$/i, /^vat$/i, /^gst$/i, /^hst$/i, /^pst$/i,
                /^shipping$/i, /^freight$/i, /^delivery$/i,
                /^discount$/i, /^adjustment$/i
            ];
        }

        /**
         * Analyze a table and extract structured data
         * @param {Object} table - Table from N/documentCapture
         * @param {Object} context - Extraction context
         * @returns {Object} Analyzed table with column types and line items
         */
        analyze(table, context = {}) {
            // Reset warnings and diagnostics for this analysis
            this.resetWarnings();

            const tableIndex = context.tableIndex || 0;

            if (!table) {
                this.addDiagnostic('INPUT', 'No table provided - returning empty result');
                return { columns: [], lineItems: [], confidence: 0, warnings: [], diagnostics: this.diagnostics };
            }

            // ===== DIAGNOSTIC: Log raw table input =====
            this.addDiagnostic('INPUT', 'Starting table analysis', {
                hasHeaderRows: !!(table.headerRows && table.headerRows.length),
                headerRowCount: table.headerRows?.length || 0,
                hasBodyRows: !!(table.bodyRows && table.bodyRows.length),
                bodyRowCount: table.bodyRows?.length || 0,
                hasFooterRows: !!(table.footerRows && table.footerRows.length),
                footerRowCount: table.footerRows?.length || 0,
                tableConfidence: table.confidence
            });

            // Log first header row content
            if (table.headerRows && table.headerRows.length > 0) {
                const headerCells = this._extractCellTexts(table.headerRows[0]);
                this.addDiagnostic('INPUT', `Header row content: [${headerCells.join(' | ')}]`);
            }

            // Log sample of body rows
            if (table.bodyRows && table.bodyRows.length > 0) {
                const sampleCount = Math.min(3, table.bodyRows.length);
                for (let i = 0; i < sampleCount; i++) {
                    const rowCells = this._extractCellTexts(table.bodyRows[i]);
                    this.addDiagnostic('INPUT', `Body row[${i}]: [${rowCells.join(' | ')}]`);
                }
                if (table.bodyRows.length > 3) {
                    this.addDiagnostic('INPUT', `... and ${table.bodyRows.length - 3} more body rows`);
                }
            }

            // Step 1: Extract raw structure
            const structure = this.extractStructure(table);
            this.addDiagnostic('STRUCTURE', 'Extracted table structure', {
                headers: structure.headers.length,
                body: structure.body.length,
                footer: structure.footer.length
            });

            // Step 2: Identify columns
            const columns = this.identifyColumns(structure);
            this.addDiagnostic('COLUMNS', 'Column identification complete', {
                columnCount: columns.length,
                columns: columns.map(c => ({
                    idx: c.index,
                    type: c.type,
                    conf: c.confidence?.toFixed(2),
                    header: c.headerText?.substring(0, 20),
                    positional: c._positionalGuess || false
                }))
            });

            // Check if we found key columns
            const hasDescriptionCol = columns.some(c => c.type === ColumnType.DESCRIPTION);
            const hasAmountCol = columns.some(c => c.type === ColumnType.AMOUNT);
            const hasQuantityCol = columns.some(c => c.type === ColumnType.QUANTITY);
            const hasMemoColumn = columns.some(c => c.type === ColumnType.MEMO);

            this.addDiagnostic('COLUMNS', 'Key column detection', {
                DESCRIPTION: hasDescriptionCol,
                AMOUNT: hasAmountCol,
                QUANTITY: hasQuantityCol,
                MEMO: hasMemoColumn
            });

            if (!hasDescriptionCol) {
                this.addDiagnostic('COLUMNS', 'WARNING: No DESCRIPTION column identified');
            }
            if (!hasAmountCol) {
                this.addDiagnostic('COLUMNS', 'WARNING: No AMOUNT column identified');
            }

            if (!hasMemoColumn) {
                this.addWarning('memo_column_not_found',
                    'No dedicated memo column detected. Memos may be embedded in descriptions.',
                    { willExtractFromDescription: true }
                );
            }

            // Step 3: Extract line items using two-pass classification
            this.addDiagnostic('EXTRACTION', 'Starting two-pass line item extraction');
            const lineItems = this.extractLineItemsTwoPass(structure, columns, context);
            this.addDiagnostic('EXTRACTION', `Extracted ${lineItems.length} raw line items`);

            // Log each raw line item
            lineItems.forEach((item, i) => {
                this.addDiagnostic('EXTRACTION', `Raw item[${i}]`, {
                    desc: item.description?.substring(0, 40),
                    code: item.itemCode,
                    qty: item.quantity,
                    rate: item.unitPrice,
                    amt: item.amount,
                    memo: item.memo?.substring(0, 30)
                });
            });

            // Step 4: Post-process and validate (less aggressive filtering)
            this.addDiagnostic('POSTPROCESS', 'Starting post-processing');
            const processed = this.postProcess(lineItems, columns);
            this.addDiagnostic('POSTPROCESS', 'Post-processing complete', {
                validItems: processed.lineItems.length,
                skippedItems: processed.skippedItems.length,
                totalFromItems: processed.totalFromItems,
                confidence: processed.confidence?.toFixed(2)
            });

            // Log skipped items with reasons
            if (processed.skippedItems.length > 0) {
                processed.skippedItems.forEach((item, i) => {
                    this.addDiagnostic('POSTPROCESS', `SKIPPED[${i}]: ${item.reason}`, {
                        desc: item.description?.substring(0, 40),
                        code: item.itemCode,
                        amt: item.amount,
                        qty: item.quantity
                    });
                });
            }

            // Final summary
            this.addDiagnostic('RESULT', '===== FINAL RESULT =====', {
                lineItemCount: processed.lineItems.length,
                skippedCount: processed.skippedItems.length,
                warningCount: this.warnings.length,
                confidence: processed.confidence?.toFixed(2),
                totalFromItems: processed.totalFromItems
            });

            // Log all diagnostics
            this.logDiagnostics(tableIndex);

            // Also log concise summary at audit level
            fcDebug.debugAudit('TableAnalyzer.SUMMARY', JSON.stringify({
                table: tableIndex,
                bodyRows: structure.body.length,
                columnsFound: columns.filter(c => c.type !== ColumnType.UNKNOWN).length,
                lineItems: processed.lineItems.length,
                skipped: processed.skippedItems.length,
                confidence: processed.confidence?.toFixed(2)
            }));

            return {
                columns: columns,
                lineItems: processed.lineItems,
                confidence: processed.confidence,
                totalFromItems: processed.totalFromItems,
                warnings: this.warnings,
                skippedItems: processed.skippedItems || [],
                diagnostics: this.diagnostics
            };
        }

        /**
         * Helper to extract cell texts from a row for logging
         */
        _extractCellTexts(row) {
            if (!row) return [];
            const cells = Array.isArray(row) ? row : (row.cells || []);
            return cells.map(c => {
                const text = this.getCellText(c);
                return text.length > 25 ? text.substring(0, 22) + '...' : text;
            });
        }

        /**
         * Extract raw table structure
         */
        extractStructure(table) {
            const structure = {
                headers: [],
                body: [],
                footer: []
            };

            // Extract headers
            if (table.headerRows && table.headerRows.length > 0) {
                structure.headers = table.headerRows.map(row => this.extractRow(row));
            }

            // Extract body
            if (table.bodyRows && table.bodyRows.length > 0) {
                structure.body = table.bodyRows.map(row => this.extractRow(row));
            }

            // Extract footer
            if (table.footerRows && table.footerRows.length > 0) {
                structure.footer = table.footerRows.map(row => this.extractRow(row));
            }

            // If no explicit headers, check if first body row looks like headers
            if (structure.headers.length === 0 && structure.body.length > 1) {
                const firstRow = structure.body[0];
                if (this.looksLikeHeaderRow(firstRow)) {
                    structure.headers = [structure.body.shift()];
                }
            }

            return structure;
        }

        /**
         * Extract cells from a row
         */
        extractRow(row) {
            if (!row) return [];

            let cells;
            if (Array.isArray(row)) {
                cells = row;
            } else if (row.cells && Array.isArray(row.cells)) {
                cells = row.cells;
            } else {
                return [];
            }

            return cells.map(cell => ({
                text: this.getCellText(cell),
                confidence: cell?.confidence || 0.7
            }));
        }

        /**
         * Get text from a cell
         */
        getCellText(cell) {
            if (!cell) return '';
            if (typeof cell === 'string') return cell.trim();
            if (typeof cell === 'number') return String(cell);
            return (cell.text || cell.value || cell.content || '').toString().trim();
        }

        /**
         * Check if a row looks like a header row
         */
        looksLikeHeaderRow(row) {
            if (!row || row.length < 2) return false;

            let headerMatches = 0;
            const allPatterns = Object.values(this.HEADER_PATTERNS).flat();

            for (const cell of row) {
                const text = cell.text || '';
                if (allPatterns.some(p => p.test(text))) {
                    headerMatches++;
                }
            }

            return headerMatches >= 2 || headerMatches / row.length >= 0.3;
        }

        /**
         * Identify column types using headers and data patterns
         */
        identifyColumns(structure) {
            const columnCount = Math.max(
                structure.headers[0]?.length || 0,
                structure.body[0]?.length || 0
            );

            if (columnCount === 0) return [];

            const columns = [];

            for (let i = 0; i < columnCount; i++) {
                const column = {
                    index: i,
                    type: ColumnType.UNKNOWN,
                    confidence: 0,
                    headerText: structure.headers[0]?.[i]?.text || ''
                };

                // Try to identify from header
                const headerType = this.identifyFromHeader(column.headerText);
                if (headerType.type !== ColumnType.UNKNOWN) {
                    column.type = headerType.type;
                    column.confidence = headerType.confidence;
                } else {
                    // Try to identify from data patterns
                    const dataType = this.identifyFromData(structure.body, i);
                    column.type = dataType.type;
                    column.confidence = dataType.confidence * 0.8; // Lower confidence for data-based
                }

                // Apply positional heuristics
                this.applyPositionalHeuristics(column, i, columnCount);

                columns.push(column);
            }

            // Resolve conflicts (e.g., multiple DESCRIPTION columns)
            this.resolveColumnConflicts(columns);

            return columns;
        }

        /**
         * Identify column type from header text
         */
        identifyFromHeader(headerText) {
            if (!headerText) return { type: ColumnType.UNKNOWN, confidence: 0 };

            const normalized = headerText.trim();

            for (const [type, patterns] of Object.entries(this.HEADER_PATTERNS)) {
                for (const pattern of patterns) {
                    if (pattern.test(normalized)) {
                        return { type, confidence: 0.9 };
                    }
                }
            }

            return { type: ColumnType.UNKNOWN, confidence: 0 };
        }

        /**
         * Identify column type from data patterns
         * v3.0: Sample from beginning, middle, AND end of table
         */
        identifyFromData(bodyRows, colIndex) {
            if (!bodyRows || bodyRows.length === 0) {
                return { type: ColumnType.UNKNOWN, confidence: 0 };
            }

            // Sample from beginning, middle, and end of table (not just first 10)
            const totalRows = bodyRows.length;
            const sampleIndices = new Set();

            // First 10 rows
            for (let i = 0; i < Math.min(10, totalRows); i++) {
                sampleIndices.add(i);
            }

            // Middle rows (5 from center)
            const midStart = Math.max(0, Math.floor(totalRows / 2) - 2);
            for (let i = midStart; i < Math.min(midStart + 5, totalRows); i++) {
                sampleIndices.add(i);
            }

            // Last 5 rows (but not summary rows typically)
            const endStart = Math.max(0, totalRows - 7);
            for (let i = endStart; i < totalRows - 2; i++) { // Skip last 2 (likely totals)
                sampleIndices.add(i);
            }

            const samples = [...sampleIndices]
                .map(i => bodyRows[i]?.[colIndex]?.text || '')
                .filter(v => v.length > 0);

            if (samples.length === 0) {
                return { type: ColumnType.UNKNOWN, confidence: 0 };
            }

            // Count matches for each type
            const typeCounts = {};

            for (const sample of samples) {
                for (const [type, pattern] of Object.entries(this.DATA_PATTERNS)) {
                    if (pattern.test(sample)) {
                        typeCounts[type] = (typeCounts[type] || 0) + 1;
                    }
                }
            }

            // Check for text-heavy column (likely DESCRIPTION)
            // v3.0: Lower threshold from 70% to 50% for better detection
            const textSamples = samples.filter(s =>
                s.length >= 4 && /[a-zA-Z]{2,}/.test(s)
            );
            if (textSamples.length / samples.length >= 0.5) {
                typeCounts[ColumnType.DESCRIPTION] = textSamples.length;
            }

            // Find best match
            let bestType = ColumnType.UNKNOWN;
            let bestCount = 0;

            for (const [type, count] of Object.entries(typeCounts)) {
                if (count > bestCount) {
                    bestCount = count;
                    bestType = type;
                }
            }

            return {
                type: bestType,
                confidence: bestCount / samples.length
            };
        }

        /**
         * Apply positional heuristics to column identification
         * v3.0: Lower confidence for positional guesses - these should be last resort
         */
        applyPositionalHeuristics(column, index, totalColumns) {
            // Only apply if still UNKNOWN and confidence is 0
            if (column.type !== ColumnType.UNKNOWN || column.confidence > 0) {
                return;
            }

            // First column is often item code or description
            if (index === 0) {
                column.type = ColumnType.ITEM_CODE;
                column.confidence = 0.3; // Low confidence - positional guess
                column._positionalGuess = true;
            }

            // Second column is often description if first is code
            if (index === 1) {
                column.type = ColumnType.DESCRIPTION;
                column.confidence = 0.35;
                column._positionalGuess = true;
            }

            // Last column is usually amount
            if (index === totalColumns - 1) {
                column.type = ColumnType.AMOUNT;
                column.confidence = 0.4; // Slightly higher - last column is often amount
                column._positionalGuess = true;
            }

            // Second to last is often unit price
            if (index === totalColumns - 2) {
                column.type = ColumnType.UNIT_PRICE;
                column.confidence = 0.3;
                column._positionalGuess = true;
            }
        }

        /**
         * Resolve conflicts when multiple columns have same type
         */
        resolveColumnConflicts(columns) {
            // Ensure only one DESCRIPTION column (prefer higher confidence or earlier)
            const descCols = columns.filter(c => c.type === ColumnType.DESCRIPTION);
            if (descCols.length > 1) {
                descCols.sort((a, b) => b.confidence - a.confidence);
                descCols.slice(1).forEach(c => {
                    c.type = ColumnType.UNKNOWN;
                });
            }

            // Ensure only one AMOUNT column (prefer last, highest confidence)
            const amtCols = columns.filter(c => c.type === ColumnType.AMOUNT);
            if (amtCols.length > 1) {
                // Prefer the rightmost amount column
                amtCols.slice(0, -1).forEach(c => {
                    c.type = ColumnType.UNIT_PRICE; // Probably unit price
                });
            }
        }

        /**
         * Extract line items from table body
         */
        extractLineItems(structure, columns, context) {
            const items = [];
            let currentItem = null;

            for (let rowIndex = 0; rowIndex < structure.body.length; rowIndex++) {
                const row = structure.body[rowIndex];
                const rowType = this.classifyRow(row, columns);

                if (rowType === 'SUMMARY') {
                    // Skip summary rows
                    continue;
                }

                if (rowType === 'NEW_ITEM' || rowType === 'SINGLE_ITEM') {
                    // Save previous item
                    if (currentItem && currentItem.description) {
                        items.push(currentItem);
                    }
                    // Start new item
                    currentItem = this.createLineItem(row, columns, context);
                    // v4.1: Enhanced memo extraction
                    this.enhanceMemoExtraction(currentItem, row, columns);
                } else if (rowType === 'CONTINUATION' && currentItem) {
                    // Append to current item
                    this.appendToLineItem(currentItem, row, columns);
                } else {
                    // Ambiguous row - try to determine if it's a new item
                    const hasAmount = this.rowHasAmount(row, columns);
                    if (hasAmount) {
                        if (currentItem && currentItem.description) {
                            items.push(currentItem);
                        }
                        currentItem = this.createLineItem(row, columns, context);
                        // v4.1: Enhanced memo extraction
                        this.enhanceMemoExtraction(currentItem, row, columns);
                    } else if (currentItem) {
                        this.appendToLineItem(currentItem, row, columns);
                    }
                }
            }

            // Don't forget last item
            if (currentItem && currentItem.description) {
                items.push(currentItem);
            }

            return items;
        }

        /**
         * TWO-PASS LINE ITEM EXTRACTION (v3.0)
         * Pass 1: Identify all "anchor" rows (rows with amounts) with position context
         * Pass 2: Associate description-only rows with nearest anchor
         * This prevents losing line items when amount and description are on different rows
         *
         * v3.0: Position-aware summary detection - rows must be in bottom 25% to be summary
         */
        extractLineItemsTwoPass(structure, columns, context) {
            const items = [];
            const body = structure.body || [];

            if (body.length === 0) return items;

            const totalRows = body.length;

            // PASS 1: Identify anchor rows (rows with monetary amounts) WITH position context
            const rowAnalysis = body.map((row, idx) => {
                const analysis = this.analyzeRow(row, columns, idx);
                // Add position context for summary detection
                analysis.rowPosition = idx / totalRows; // 0.0 to 1.0
                analysis.isInSummaryZone = idx >= totalRows * 0.75; // Bottom 25%
                return analysis;
            });

            // PASS 2: Group rows into line items
            let currentItem = null;
            let itemStartIdx = -1;

            for (let i = 0; i < rowAnalysis.length; i++) {
                const analysis = rowAnalysis[i];
                const row = body[i];

                // Log row analysis for diagnostics
                this.addDiagnostic('ROW_ANALYSIS', `Row[${i}] analysis`, {
                    desc: (analysis.descriptionText || '').substring(0, 30),
                    hasDesc: analysis.hasDescription,
                    hasCode: analysis.hasItemCode,
                    hasAmt: analysis.hasAmount,
                    amt: (analysis.amountText || '').substring(0, 15),
                    hasQty: analysis.hasQuantity,
                    qty: analysis.quantity,
                    isSummary: analysis.isSummary,
                    position: `${(analysis.rowPosition * 100).toFixed(0)}%`,
                    inSummaryZone: analysis.isInSummaryZone
                });

                // v3.0: Position-aware summary detection
                // Only skip as summary if: matches pattern AND (in summary zone OR has no quantity)
                if (analysis.isSummary) {
                    // If has quantity, it's likely a real line item regardless of name
                    if (analysis.hasQuantity && analysis.quantity > 0) {
                        // NOT a summary - it's a line item named "Total", "Tax", etc.
                        this.addDiagnostic('ROW_DECISION', `Row[${i}] KEEP: Summary-like name BUT has quantity=${analysis.quantity}`, {
                            desc: analysis.descriptionText
                        });
                        // Fall through to process as line item
                    }
                    // If NOT in summary zone (top 75% of table), keep it
                    else if (!analysis.isInSummaryZone) {
                        this.addDiagnostic('ROW_DECISION', `Row[${i}] KEEP: Summary-like name BUT not in summary zone (${(analysis.rowPosition * 100).toFixed(0)}%)`, {
                            desc: analysis.descriptionText
                        });
                        // Fall through to process as line item
                    }
                    // Otherwise it's truly a summary row - skip it
                    else {
                        this.addDiagnostic('ROW_DECISION', `Row[${i}] SKIP: Summary row (pattern + zone + no qty)`, {
                            desc: analysis.descriptionText,
                            amt: analysis.amountText
                        });
                        continue;
                    }
                }

                // Is this an anchor row (has amount)?
                if (analysis.hasAmount) {
                    // Save previous item if exists
                    if (currentItem) {
                        // Extract memo from description before saving
                        this.extractMemoFromDescription(currentItem);
                        items.push(currentItem);
                        this.addDiagnostic('ITEM_CREATED', `Saved line item (before new anchor)`, {
                            desc: currentItem.description?.substring(0, 40),
                            amt: currentItem.amount,
                            memo: currentItem.memo?.substring(0, 30) || '[empty]'
                        });
                    }

                    // Start new item from this anchor row
                    currentItem = this.createLineItem(row, columns, context);
                    // v4.1: Enhanced memo extraction - scan row cells for text content
                    this.enhanceMemoExtraction(currentItem, row, columns);
                    itemStartIdx = i;
                    this.addDiagnostic('ROW_DECISION', `Row[${i}] NEW_ANCHOR: Starting new line item`, {
                        desc: currentItem.description?.substring(0, 40),
                        amt: currentItem.amount,
                        qty: currentItem.quantity,
                        memo: currentItem.memo?.substring(0, 30)
                    });

                    // v3.1: Always look backwards for orphan rows that may have item codes or descriptions
                    // This handles multi-row line items where first row has item code but no amount
                    {
                        let foundItemCode = !!currentItem.itemCode;
                        let prependDesc = '';
                        let gotItemCodeFromOrphan = false;
                        const itemCodeCol = columns.find(c => c.type === ColumnType.ITEM_CODE);
                        const descCol = columns.find(c => c.type === ColumnType.DESCRIPTION);

                        for (let j = i - 1; j >= 0; j--) {
                            const prevAnalysis = rowAnalysis[j];
                            // Stop if we hit another anchor, summary, or used row
                            if (prevAnalysis.hasAmount || prevAnalysis.isSummary || prevAnalysis.used) break;

                            const prevRow = body[j];

                            // Grab item code if we don't have one and prev row has one
                            if (!foundItemCode && prevAnalysis.hasItemCode && itemCodeCol) {
                                const prevItemCode = prevRow[itemCodeCol.index]?.text || '';
                                if (prevItemCode) {
                                    currentItem.itemCode = prevItemCode;
                                    foundItemCode = true;
                                    gotItemCodeFromOrphan = true;
                                    this.addDiagnostic('BACKWARD_MERGE', `Grabbed item code "${prevItemCode}" from orphan row[${j}]`);
                                }
                            }

                            // Grab description from orphan row to prepend
                            if (prevAnalysis.hasDescription && descCol) {
                                const prevDesc = prevRow[descCol.index]?.text || '';
                                if (prevDesc) {
                                    prependDesc = prevDesc + (prependDesc ? ' ' + prependDesc : '');
                                }
                            }

                            prevAnalysis.used = true;
                        }

                        // Prepend captured descriptions if:
                        // 1. Anchor row lacks or has short description, OR
                        // 2. We grabbed an item code from orphan row (descriptions are clearly related)
                        if (prependDesc && (gotItemCodeFromOrphan || !currentItem.description || currentItem.description.length < 3)) {
                            currentItem.description = prependDesc + (currentItem.description ? ' ' + currentItem.description : '');
                            this.addDiagnostic('BACKWARD_MERGE', `Prepended description from orphan rows: "${prependDesc.substring(0, 40)}"`);
                        }
                    }

                    // v4.0: FORWARD-LOOKING row association
                    // Look AHEAD for orphan rows that may have item codes or descriptions
                    // This handles cases where item code appears AFTER the amount row
                    {
                        let appendDesc = '';
                        let gotItemCodeForward = false;
                        const itemCodeCol = columns.find(c => c.type === ColumnType.ITEM_CODE);
                        const descCol = columns.find(c => c.type === ColumnType.DESCRIPTION);

                        // Look forward at the next few rows (limit to 3 to avoid over-merging)
                        for (let j = i + 1; j < Math.min(i + 4, rowAnalysis.length); j++) {
                            const nextAnalysis = rowAnalysis[j];

                            // Stop if we hit another anchor, summary, or already used row
                            if (nextAnalysis.hasAmount || nextAnalysis.isSummary || nextAnalysis.used) break;

                            const nextRow = body[j];

                            // Grab item code if we don't have one and next row has one
                            if (!currentItem.itemCode && nextAnalysis.hasItemCode && itemCodeCol) {
                                const nextItemCode = nextRow[itemCodeCol.index]?.text || '';
                                if (nextItemCode) {
                                    currentItem.itemCode = nextItemCode;
                                    gotItemCodeForward = true;
                                    this.addDiagnostic('FORWARD_MERGE', `Grabbed item code "${nextItemCode}" from forward row[${j}]`);
                                }
                            }

                            // Grab description from forward orphan row to append
                            if (nextAnalysis.hasDescription && descCol) {
                                const nextDesc = nextRow[descCol.index]?.text || '';
                                if (nextDesc) {
                                    // Check if this looks like a continuation (not a new item)
                                    const looksLikeContinuation = !nextAnalysis.hasItemCode ||
                                        nextDesc.length < 50 ||
                                        /^[a-z]/.test(nextDesc) || // Starts lowercase
                                        /^[-–—•*]/.test(nextDesc); // Bullet point

                                    if (looksLikeContinuation || gotItemCodeForward) {
                                        appendDesc += (appendDesc ? ' ' : '') + nextDesc;
                                        nextAnalysis.used = true;
                                    }
                                }
                            }

                            // If we grabbed something useful, mark as used
                            if (gotItemCodeForward) {
                                nextAnalysis.used = true;
                            }
                        }

                        // Append captured forward descriptions if we got any
                        if (appendDesc) {
                            currentItem.description = (currentItem.description || '') + ' ' + appendDesc;
                            this.addDiagnostic('FORWARD_MERGE', `Appended description from forward rows: "${appendDesc.substring(0, 40)}"`);
                        }
                    }
                }
                // This is a non-anchor row (no amount)
                else if (currentItem) {
                    // Check if this looks like a memo row
                    if (this.isMemoRow(analysis.descriptionText)) {
                        // Append to memo instead of description
                        const memoText = analysis.descriptionText;
                        currentItem.memo = currentItem.memo
                            ? currentItem.memo + ' ' + memoText
                            : memoText;
                        analysis.used = true;
                        this.addDiagnostic('ROW_DECISION', `Row[${i}] MEMO: Appended as memo to current item`, {
                            memo: memoText?.substring(0, 40)
                        });
                    }
                    // Regular continuation - append to description
                    else if (analysis.hasDescription) {
                        this.appendToLineItem(currentItem, row, columns);
                        analysis.used = true;
                        this.addDiagnostic('ROW_DECISION', `Row[${i}] CONTINUATION: Appended to current item`, {
                            text: analysis.descriptionText?.substring(0, 40)
                        });
                    }
                    else {
                        this.addDiagnostic('ROW_DECISION', `Row[${i}] IGNORED: No amount, no description, has current item`);
                    }
                }
                // No current item and no amount - could be a line item missing amount
                else if (analysis.hasDescription && analysis.hasQuantity) {
                    // Has description and quantity but no amount - might be valid
                    currentItem = this.createLineItem(row, columns, context);
                    // v4.1: Enhanced memo extraction
                    this.enhanceMemoExtraction(currentItem, row, columns);
                    currentItem._needsAmountReview = true;
                    this.addDiagnostic('ROW_DECISION', `Row[${i}] NEW_NO_AMOUNT: Has desc+qty but no amount`, {
                        desc: analysis.descriptionText?.substring(0, 40),
                        qty: analysis.quantity,
                        memo: currentItem.memo?.substring(0, 30)
                    });
                    this.addWarning('line_item_missing_amount',
                        `Line item "${analysis.descriptionText.substring(0, 50)}..." has quantity but no amount`,
                        { rowIndex: i, quantity: analysis.quantityText }
                    );
                }
                else {
                    // Row has nothing useful or no current item to attach to
                    this.addDiagnostic('ROW_DECISION', `Row[${i}] ORPHAN: No amount, no current item, insufficient data`, {
                        hasDesc: analysis.hasDescription,
                        hasQty: analysis.hasQuantity
                    });
                }
            }

            // Don't forget the last item
            if (currentItem) {
                this.extractMemoFromDescription(currentItem);
                items.push(currentItem);
                this.addDiagnostic('ITEM_CREATED', `Saved final line item`, {
                    desc: currentItem.description?.substring(0, 40),
                    amt: currentItem.amount,
                    memo: currentItem.memo?.substring(0, 30) || '[empty]'
                });
            }

            // v4.1: Log memo extraction summary
            const itemsWithMemo = items.filter(i => i.memo && i.memo.length > 0).length;
            this.addDiagnostic('EXTRACTION', `Two-pass extraction complete: ${items.length} items created, ${itemsWithMemo} with memo`);

            return items;
        }

        /**
         * Analyze a single row for classification
         * v3.0: Parse quantity as number for better summary detection
         */
        analyzeRow(row, columns, rowIndex) {
            const descCol = columns.find(c => c.type === ColumnType.DESCRIPTION);
            const amtCol = columns.find(c => c.type === ColumnType.AMOUNT);
            const qtyCol = columns.find(c => c.type === ColumnType.QUANTITY);
            const memoCol = columns.find(c => c.type === ColumnType.MEMO);
            const itemCodeCol = columns.find(c => c.type === ColumnType.ITEM_CODE);

            const descText = descCol ? (row[descCol.index]?.text || '') : '';
            const amtText = amtCol ? (row[amtCol.index]?.text || '') : '';
            const qtyText = qtyCol ? (row[qtyCol.index]?.text || '') : '';
            const memoText = memoCol ? (row[memoCol.index]?.text || '') : '';
            const itemCodeText = itemCodeCol ? (row[itemCodeCol.index]?.text || '') : '';

            // Check for amount - must have digits and look like currency
            const hasAmount = amtText && /\d+[.,]?\d*/.test(amtText) && amtText.trim().length > 0;

            // Check for description - meaningful text (v3.0: allow single char if has itemCode)
            const hasDescription = descText && descText.trim().length >= 1;
            const hasItemCode = itemCodeText && itemCodeText.trim().length >= 1;

            // Parse quantity as number for better decision making
            const quantityValue = this.parseQuantity(qtyText);
            const hasQuantity = quantityValue !== null && quantityValue > 0;

            // Check if this is a summary row (using new patterns)
            const isSummary = this.isSummaryRow(descText, hasQuantity);

            // Count empty cells
            const emptyCells = row.filter(c => !c.text || c.text.trim() === '').length;
            const sparseness = emptyCells / row.length;

            return {
                rowIndex,
                descriptionText: descText,
                amountText: amtText,
                quantityText: qtyText,
                memoText: memoText,
                itemCodeText: itemCodeText,
                hasDescription,
                hasItemCode,
                hasAmount,
                hasQuantity,
                quantity: quantityValue,
                isSummary,
                sparseness,
                used: false // Track if row has been consumed
            };
        }

        /**
         * Check if a row's text indicates it's a memo/note
         */
        isMemoRow(text) {
            if (!text || text.length < 3) return false;
            return MEMO_ROW_INDICATORS.some(pattern => pattern.test(text));
        }

        /**
         * Extract embedded memo from description field
         * v4.1: Enhanced to always populate memo from description when empty
         * Modifies item in place
         */
        extractMemoFromDescription(item) {
            if (!item.description) return;

            const MEMO_MIN_LENGTH = 10;           // Minimum text length to use as memo
            const SUBSTANTIAL_DESC_LENGTH = 15;   // Description length to consider "substantial"

            // If there's already a substantial memo, don't overwrite
            if (item.memo && item.memo.trim().length >= MEMO_MIN_LENGTH) {
                return;
            }

            let foundPatternMatch = false;

            // First, try to extract memo using patterns
            for (const patternDef of MEMO_EXTRACTION_PATTERNS) {
                const match = item.description.match(patternDef.pattern);
                if (match && match[patternDef.group]) {
                    const extractedMemo = match[patternDef.group].trim();

                    // Check minimum length if specified
                    if (patternDef.minLength && extractedMemo.length < patternDef.minLength) {
                        continue;
                    }

                    // Set memo
                    item.memo = item.memo
                        ? item.memo + ' ' + extractedMemo
                        : extractedMemo;

                    // Remove memo from description (keep the main part)
                    item.description = item.description
                        .replace(patternDef.pattern, '')
                        .replace(/\s+/g, ' ')
                        .trim();

                    fcDebug.debug('TableAnalyzer.extractMemoFromDescription', {
                        extractedMemo: extractedMemo.substring(0, 50),
                        remainingDesc: item.description.substring(0, 50)
                    });

                    foundPatternMatch = true;
                    break; // Only extract once per pattern
                }
            }

            // v4.1: FALLBACK - If still no memo and description is substantial, use it as memo
            // This ensures memo is ALWAYS populated when we have description text
            if (!item.memo && item.description && item.description.trim().length >= SUBSTANTIAL_DESC_LENGTH) {
                item.memo = item.description.trim();
                fcDebug.debug('TableAnalyzer.extractMemoFromDescription', {
                    action: 'FALLBACK: Using full description as memo',
                    memo: item.memo.substring(0, 50)
                });
            }

            // v4.1: Even if description is short, use it as memo if we have nothing
            if (!item.memo && item.description && item.description.trim().length >= 5) {
                item.memo = item.description.trim();
                fcDebug.debug('TableAnalyzer.extractMemoFromDescription', {
                    action: 'Using short description as memo',
                    memo: item.memo
                });
            }
        }

        /**
         * v4.1: Enhanced memo extraction - scans all row cells for text-heavy content
         * This method is more aggressive than extractMemoFromDescription and should be
         * called after createLineItem to populate memo from any available text
         *
         * Priority order:
         * 1. Dedicated MEMO column (already handled in createLineItem)
         * 2. DESCRIPTION column content (if no memo yet and description is substantial)
         * 3. Any other cell with significant text content
         *
         * @param {Object} item - Line item to enhance
         * @param {Array} row - Raw row data
         * @param {Array} columns - Column definitions
         */
        enhanceMemoExtraction(item, row, columns) {
            // Skip if already have substantial memo
            if (item.memo && item.memo.trim().length >= 10) {
                return;
            }

            const MIN_MEMO_LENGTH = 5;         // Minimum text length to consider as memo
            const LONG_TEXT_THRESHOLD = 20;    // Text longer than this is "substantial"

            // Track columns we should skip (amount, quantity, etc. - not memo candidates)
            const skipTypes = new Set([
                ColumnType.AMOUNT, ColumnType.UNIT_PRICE, ColumnType.QUANTITY,
                ColumnType.TAX, ColumnType.DISCOUNT, ColumnType.DATE, ColumnType.UNIT
            ]);

            // Find all text-heavy cells in the row
            const textCandidates = [];

            for (let i = 0; i < row.length; i++) {
                const cell = row[i];
                const text = (cell?.text || '').trim();

                if (!text || text.length < MIN_MEMO_LENGTH) continue;

                // Find the column definition for this cell
                const column = columns.find(c => c.index === i);

                // Skip numeric columns
                if (column && skipTypes.has(column.type)) continue;

                // Skip if it's the item code (short identifiers, not memo)
                if (column?.type === ColumnType.ITEM_CODE) continue;

                // Skip if text looks like a pure number/amount
                if (/^[\d,.\s$€£¥-]+$/.test(text)) continue;

                textCandidates.push({
                    index: i,
                    text: text,
                    length: text.length,
                    columnType: column?.type || ColumnType.UNKNOWN,
                    isMemoColumn: column?.type === ColumnType.MEMO,
                    isDescColumn: column?.type === ColumnType.DESCRIPTION
                });
            }

            // Sort by priority: MEMO column > DESCRIPTION column > longest text
            textCandidates.sort((a, b) => {
                if (a.isMemoColumn && !b.isMemoColumn) return -1;
                if (!a.isMemoColumn && b.isMemoColumn) return 1;
                if (a.isDescColumn && !b.isDescColumn) return -1;
                if (!a.isDescColumn && b.isDescColumn) return 1;
                return b.length - a.length; // Longer text first
            });

            // If no memo yet, try to populate from candidates
            if (!item.memo || item.memo.trim().length < MIN_MEMO_LENGTH) {
                for (const candidate of textCandidates) {
                    // Skip if this is already the item's description (to avoid duplication)
                    if (candidate.isDescColumn && candidate.text === item.description) {
                        // BUT: if description is substantial, use it as memo too
                        if (candidate.text.length >= LONG_TEXT_THRESHOLD) {
                            item.memo = candidate.text;
                            fcDebug.debug('enhanceMemoExtraction', `Using description as memo: "${candidate.text.substring(0, 40)}..."`);
                        }
                        continue;
                    }

                    // Use this candidate as memo
                    if (candidate.text.length >= MIN_MEMO_LENGTH) {
                        item.memo = candidate.text;
                        this.addDiagnostic('MEMO_ENHANCED', `Extracted memo from ${candidate.columnType} column`, {
                            memo: candidate.text.substring(0, 50),
                            source: candidate.columnType
                        });
                        break;
                    }
                }
            }

            // FALLBACK: If STILL no memo, use description as memo if it's substantial
            if ((!item.memo || item.memo.trim().length < MIN_MEMO_LENGTH) &&
                item.description && item.description.trim().length >= LONG_TEXT_THRESHOLD) {
                item.memo = item.description;
                this.addDiagnostic('MEMO_FALLBACK', `Using description as memo (fallback)`, {
                    memo: item.description.substring(0, 50)
                });
            }

            // Clean up memo if extracted
            if (item.memo) {
                item.memo = item.memo.trim().replace(/\s+/g, ' ');
            }
        }

        /**
         * Classify a row as new item, continuation, or summary
         */
        classifyRow(row, columns) {
            const descCol = columns.find(c => c.type === ColumnType.DESCRIPTION);
            const amtCol = columns.find(c => c.type === ColumnType.AMOUNT);
            const qtyCol = columns.find(c => c.type === ColumnType.QUANTITY);

            const descText = descCol ? (row[descCol.index]?.text || '') : '';
            const amtText = amtCol ? (row[amtCol.index]?.text || '') : '';
            const qtyText = qtyCol ? (row[qtyCol.index]?.text || '') : '';

            // Check for summary row
            if (this.isSummaryRow(descText)) {
                return 'SUMMARY';
            }

            // Has amount -> likely a complete line item
            if (amtText && /\d/.test(amtText)) {
                if (qtyText && /\d/.test(qtyText)) {
                    return 'SINGLE_ITEM'; // Has both qty and amount
                }
                return 'NEW_ITEM';
            }

            // Has description but no amount -> continuation or start of multi-row
            if (descText && descText.length >= 3) {
                // Check if mostly empty except description
                const emptyCells = row.filter(c => !c.text || c.text.trim() === '').length;
                if (emptyCells >= row.length * 0.6) {
                    return 'CONTINUATION';
                }
            }

            return 'UNKNOWN';
        }

        /**
         * Check if description indicates a summary row
         * v3.0: Uses hasQuantity to avoid false positives on items named "Tax", "Shipping", etc.
         */
        isSummaryRow(description, hasQuantity = false) {
            if (!description) return false;
            const normalized = description.toLowerCase().trim();

            // Strict patterns always indicate summary (regardless of quantity)
            if (this.SUMMARY_PATTERNS.some(p => p.test(normalized))) {
                return true;
            }

            // Conditional patterns only match if NO quantity present
            // (Tax, Shipping, Discount can be real line items if they have quantity)
            if (!hasQuantity && this.SUMMARY_PATTERNS_NO_QTY.some(p => p.test(normalized))) {
                return true;
            }

            return false;
        }

        /**
         * Check if row has a valid amount
         */
        rowHasAmount(row, columns) {
            const amtCol = columns.find(c => c.type === ColumnType.AMOUNT);
            if (!amtCol) return false;

            const amtText = row[amtCol.index]?.text || '';
            return /\d+[.,]\d{2}/.test(amtText);
        }

        /**
         * Create a line item from a row
         */
        createLineItem(row, columns, context) {
            const item = {
                itemCode: null,
                description: '',
                memo: null,
                quantity: null,
                unit: null,
                unitPrice: null,
                amount: null,
                tax: null,
                discount: null,
                confidence: 0.7
            };

            let confidenceSum = 0;
            let confidenceCount = 0;

            for (const column of columns) {
                const cell = row[column.index];
                const text = cell?.text || '';

                if (!text) continue;

                switch (column.type) {
                    case ColumnType.ITEM_CODE:
                        item.itemCode = text;
                        break;
                    case ColumnType.DESCRIPTION:
                        item.description = text;
                        break;
                    case ColumnType.MEMO:
                        item.memo = text;
                        break;
                    case ColumnType.QUANTITY:
                        item.quantity = this.parseQuantity(text);
                        break;
                    case ColumnType.UNIT:
                        item.unit = text;
                        break;
                    case ColumnType.UNIT_PRICE:
                        if (this.amountParser) {
                            const parsed = this.amountParser.parse(text, context);
                            item.unitPrice = parsed.amount;
                        } else {
                            item.unitPrice = this.parseSimpleAmount(text);
                        }
                        break;
                    case ColumnType.AMOUNT:
                        if (this.amountParser) {
                            const parsed = this.amountParser.parse(text, context);
                            item.amount = parsed.amount;
                        } else {
                            item.amount = this.parseSimpleAmount(text);
                        }
                        break;
                    case ColumnType.TAX:
                        item.tax = this.parseSimpleAmount(text);
                        break;
                    case ColumnType.DISCOUNT:
                        item.discount = this.parseSimpleAmount(text);
                        break;
                }

                if (cell?.confidence) {
                    confidenceSum += cell.confidence;
                    confidenceCount++;
                }
            }

            if (confidenceCount > 0) {
                item.confidence = confidenceSum / confidenceCount;
            }

            // Calculate amount if missing but we have qty and price
            if (!item.amount && item.quantity && item.unitPrice) {
                item.amount = Math.round(item.quantity * item.unitPrice * 100) / 100;
                item.amountCalculated = true;
            }

            return item;
        }

        /**
         * Append continuation row to existing line item
         * v4.1: Enhanced to also scan for memo content in continuation rows
         */
        appendToLineItem(item, row, columns) {
            const descCol = columns.find(c => c.type === ColumnType.DESCRIPTION);
            if (descCol) {
                const addText = row[descCol.index]?.text || '';
                if (addText) {
                    item.description += ' ' + addText;
                }
            }

            // Also append memo text if present from dedicated MEMO column
            const memoCol = columns.find(c => c.type === ColumnType.MEMO);
            if (memoCol) {
                const addMemo = row[memoCol.index]?.text || '';
                if (addMemo) {
                    item.memo = item.memo ? (item.memo + ' ' + addMemo) : addMemo;
                }
            }

            // v4.1: If no dedicated memo column, scan for text-heavy cells as memo
            if (!memoCol) {
                const MIN_MEMO_TEXT = 10;
                const skipTypes = new Set([
                    ColumnType.AMOUNT, ColumnType.UNIT_PRICE, ColumnType.QUANTITY,
                    ColumnType.TAX, ColumnType.DISCOUNT, ColumnType.DATE, ColumnType.UNIT,
                    ColumnType.ITEM_CODE, ColumnType.DESCRIPTION
                ]);

                for (let i = 0; i < row.length; i++) {
                    const cell = row[i];
                    const text = (cell?.text || '').trim();

                    if (!text || text.length < MIN_MEMO_TEXT) continue;

                    const column = columns.find(c => c.index === i);
                    if (column && skipTypes.has(column.type)) continue;

                    // Skip pure numeric content
                    if (/^[\d,.\s$€£¥-]+$/.test(text)) continue;

                    // Found text content - append to memo
                    item.memo = item.memo ? (item.memo + ' ' + text) : text;
                    break; // Only take first text-heavy cell
                }
            }
        }

        /**
         * Parse quantity value
         */
        parseQuantity(text) {
            if (!text) return null;
            const cleaned = text.replace(/[^\d.,\-]/g, '').replace(/,/g, '.');
            const num = parseFloat(cleaned);
            return isNaN(num) ? null : num;
        }

        /**
         * Simple amount parser (fallback when AmountParser not available)
         * v4.0: Enhanced with European format support and OCR error correction
         */
        parseSimpleAmount(text) {
            if (!text) return null;

            // v4.0: First, apply OCR error corrections
            let cleaned = this._correctOCRErrors(text);

            // Detect format: European (1.234,56) vs US (1,234.56)
            const format = this._detectNumberFormat(cleaned);

            if (format === 'EUROPEAN') {
                // European format: period = thousands, comma = decimal
                cleaned = cleaned
                    .replace(/[^\d.,\-]/g, '')
                    .replace(/\./g, '')      // Remove thousands separators (periods)
                    .replace(/,/, '.');      // Convert decimal comma to period
            } else {
                // US/Default format: comma = thousands, period = decimal
                cleaned = cleaned
                    .replace(/[^\d.,\-]/g, '')
                    .replace(/,(\d{3})/g, '$1')  // Remove thousands separators
                    .replace(/,/g, '.');
            }

            const num = parseFloat(cleaned);
            return isNaN(num) ? null : Math.round(num * 100) / 100;
        }

        /**
         * v4.0: Detect number format (European vs US)
         */
        _detectNumberFormat(text) {
            if (!text) return 'US';

            const cleaned = text.replace(/[^\d.,]/g, '');

            // Count occurrences of periods and commas
            const periods = (cleaned.match(/\./g) || []).length;
            const commas = (cleaned.match(/,/g) || []).length;

            // European: Multiple periods as thousands, single comma as decimal (1.234.567,89)
            if (periods >= 1 && commas === 1 && /,\d{1,2}$/.test(cleaned)) {
                return 'EUROPEAN';
            }

            // European: Single period as thousands, single comma as decimal (1.234,56)
            if (periods === 1 && commas === 1 && /,\d{1,2}$/.test(cleaned) && /\.\d{3}/.test(cleaned)) {
                return 'EUROPEAN';
            }

            // European: No periods, single comma at end with 1-2 digits (1234,56)
            if (periods === 0 && commas === 1 && /,\d{1,2}$/.test(cleaned)) {
                return 'EUROPEAN';
            }

            // US format or default
            return 'US';
        }

        /**
         * v4.0: Correct common OCR errors in amount text
         * Uses capturing groups instead of lookbehind for JS compatibility
         */
        _correctOCRErrors(text) {
            if (!text) return text;

            return text
                // Common OCR mistakes for currency symbols
                .replace(/^[Ss]\s*(?=\d)/, '$')      // S → $ at start
                .replace(/^[Cc]\$\s*/, '$')          // C$ → $ (CAD)
                .replace(/^[Aa]\$\s*/, '$')          // A$ → $ (AUD)
                // Common OCR mistakes for digits (use capturing groups, not lookbehind)
                .replace(/[Oo](?=\d)/g, '0')         // O → 0 when followed by digit
                .replace(/(\d)[Oo]/g, '$10')         // O → 0 when preceded by digit
                .replace(/[Ll](?=\d)/g, '1')         // l → 1 when followed by digit
                .replace(/(\d)[Ll]/g, '$11')         // l → 1 when preceded by digit
                .replace(/[Ii](?=\d)/g, '1')         // I → 1 when followed by digit
                .replace(/(\d)[Ii]/g, '$11')         // I → 1 when preceded by digit
                // Fix common OCR space issues
                .replace(/(\d)\s+(\d)/g, '$1$2')     // Remove spaces between digits
                .replace(/(\d)\s+([.,])/g, '$1$2')   // Remove space before decimal
                .replace(/([.,])\s+(\d)/g, '$1$2');  // Remove space after decimal
        }

        /**
         * v4.0: Detect if an OCR'd amount is a common OCR error of the expected amount
         * Returns the corrected amount if detected, null otherwise
         */
        _detectAndCorrectOCRAmount(actual, expected) {
            if (!actual || !expected) return null;

            // Convert both to strings for comparison
            const actualStr = actual.toFixed(2);
            const expectedStr = expected.toFixed(2);

            // If they're already close, no correction needed
            if (Math.abs(actual - expected) < 0.02) return actual;

            // Check for common OCR digit substitutions
            // 0 ↔ O, 1 ↔ l ↔ I, 5 ↔ S, 8 ↔ B, 6 ↔ G
            const ocrMappings = [
                ['0', 'O'], ['0', 'o'],
                ['1', 'l'], ['1', 'I'], ['1', 'i'],
                ['5', 'S'], ['5', 's'],
                ['8', 'B'], ['8', 'b'],
                ['6', 'G'], ['6', 'g']
            ];

            // Check if actual could be OCR misread of expected
            let correctedStr = actualStr;
            for (const [digit, letter] of ocrMappings) {
                // Check if replacing letter with digit gets us closer
                const testStr = correctedStr.replace(new RegExp(letter, 'g'), digit);
                const testNum = parseFloat(testStr);
                if (!isNaN(testNum) && Math.abs(testNum - expected) < Math.abs(parseFloat(correctedStr) - expected)) {
                    correctedStr = testStr;
                }
            }

            const corrected = parseFloat(correctedStr);
            if (!isNaN(corrected) && Math.abs(corrected - expected) < 0.02) {
                return corrected;
            }

            // Check for decimal point OCR issues (1234 vs 12.34 vs 123.4)
            // If expected has cents but actual doesn't
            if (expected % 1 !== 0 && actual % 1 === 0) {
                // Try adding decimal point at different positions
                const actualIntStr = actual.toString();
                for (let i = actualIntStr.length - 1; i >= 1; i--) {
                    const withDecimal = parseFloat(actualIntStr.slice(0, i) + '.' + actualIntStr.slice(i));
                    if (Math.abs(withDecimal - expected) < 0.02) {
                        return withDecimal;
                    }
                }
            }

            return null;
        }

        /**
         * Post-process line items (v4.0 - Enhanced with math validation)
         * Key changes:
         * - Accept $0 amounts (free items, credits)
         * - Accept items with only itemCode (no description needed)
         * - Calculate amount from qty * rate before filtering
         * - Only skip truly empty rows
         * - v4.0: Math validation (qty × rate = amount)
         * - v4.0: OCR error detection and correction
         */
        postProcess(lineItems, columns) {
            const validItems = [];
            const skippedItems = [];

            for (const item of lineItems) {
                // v3.0: Calculate amount from qty * rate if missing
                if ((item.amount === null || item.amount === undefined) &&
                    item.quantity > 0 && item.unitPrice > 0) {
                    item.amount = Math.round(item.quantity * item.unitPrice * 100) / 100;
                    item._amountCalculated = true;
                }

                // v4.0: MATH VALIDATION - check if qty × rate = amount
                if (item.quantity > 0 && item.unitPrice > 0 && item.amount !== null && item.amount !== undefined) {
                    const expectedAmount = Math.round(item.quantity * item.unitPrice * 100) / 100;
                    const actualAmount = item.amount;
                    const diff = Math.abs(expectedAmount - actualAmount);
                    const diffPercent = actualAmount > 0 ? (diff / actualAmount) * 100 : (diff > 0 ? 100 : 0);

                    if (diff > 0.02) { // More than 2 cents difference
                        item._mathMismatch = true;
                        item._expectedAmount = expectedAmount;
                        item._mathDiff = diff;
                        item._mathDiffPercent = diffPercent;

                        this.addDiagnostic('MATH_VALIDATION', `Item math mismatch: ${item.quantity} × ${item.unitPrice} = ${expectedAmount}, but amount = ${actualAmount} (diff: ${diff.toFixed(2)}, ${diffPercent.toFixed(1)}%)`);

                        // If diff is small percentage (<5%), likely rounding - trust the amount
                        // If diff is larger, could be OCR error - flag for review
                        if (diffPercent > 5) {
                            item._needsAmountReview = true;
                            this.addWarning('math_mismatch',
                                `Line item math doesn't add up: ${item.quantity} × ${item.unitPrice} = ${expectedAmount}, but extracted amount is ${actualAmount}`,
                                {
                                    description: (item.description || '').substring(0, 50),
                                    expected: expectedAmount,
                                    actual: actualAmount,
                                    diff: diff,
                                    diffPercent: diffPercent
                                }
                            );

                            // v4.0: Auto-correct if we're confident qty and rate are right
                            // Check if the extracted amount looks like an OCR error
                            const ocrCorrectedAmount = this._detectAndCorrectOCRAmount(actualAmount, expectedAmount);
                            if (ocrCorrectedAmount !== null && Math.abs(ocrCorrectedAmount - expectedAmount) < 0.02) {
                                item._originalAmount = actualAmount;
                                item.amount = expectedAmount; // Use calculated amount
                                item._amountCorrectedByMath = true;
                                this.addDiagnostic('MATH_CORRECTION', `Auto-corrected amount from ${actualAmount} to ${expectedAmount} (OCR error detected)`);
                            }
                        }
                    } else {
                        item._mathValidated = true;
                    }
                }

                // Check what we have - v3.0: much more lenient
                const hasIdentifier = (item.description && item.description.trim().length >= 1) ||
                                     (item.itemCode && item.itemCode.trim().length >= 1);
                const hasAmount = item.amount !== null && item.amount !== undefined; // Accept $0!
                const hasQuantity = item.quantity !== null && item.quantity > 0;
                const hasRate = item.unitPrice !== null && item.unitPrice > 0;

                // v3.0: Keep item if it has EITHER:
                // 1. An identifier (description OR itemCode)
                // 2. Some numeric data (amount OR quantity OR rate)
                const hasNumericData = hasAmount || hasQuantity || hasRate;

                if (hasIdentifier || hasNumericData) {
                    // Flag items that might need review (but still keep them!)
                    if (!hasIdentifier) {
                        item._needsDescriptionReview = true;
                    }
                    if (!hasAmount && !hasQuantity) {
                        item._needsAmountReview = true;
                    }

                    // Clean up description
                    if (item.description) {
                        item.description = item.description.trim();
                    }

                    validItems.push(item);
                }
                // Only skip truly empty rows
                else {
                    skippedItems.push({
                        description: item.description || '[empty]',
                        itemCode: item.itemCode || null,
                        amount: item.amount,
                        quantity: item.quantity,
                        reason: 'no_identifier_or_numeric_data'
                    });
                    this.addWarning('line_item_skipped',
                        `Skipped empty row - no description, code, or amounts`,
                        { item: skippedItems[skippedItems.length - 1] }
                    );
                }
            }

            // Calculate confidence based on extraction quality
            let confidence = 0.7;

            // Boost confidence if we identified key columns
            const hasDescriptionCol = columns.some(c => c.type === ColumnType.DESCRIPTION);
            const hasAmountCol = columns.some(c => c.type === ColumnType.AMOUNT);
            const hasMemoCol = columns.some(c => c.type === ColumnType.MEMO);
            const hasItemCodeCol = columns.some(c => c.type === ColumnType.ITEM_CODE);

            if (hasDescriptionCol && hasAmountCol) {
                confidence += 0.15;
            }
            if (hasMemoCol) {
                confidence += 0.05;
            }
            if (hasItemCodeCol) {
                confidence += 0.05;
            }

            // v3.0: Only penalize if ALL items were skipped
            if (lineItems.length > 0 && validItems.length === 0) {
                confidence -= 0.2;
            }

            // Calculate total from line items
            const totalFromItems = validItems.reduce((sum, item) =>
                sum + (item.amount || 0), 0
            );

            // v4.1: Log memo extraction statistics
            const itemsWithMemo = validItems.filter(i => i.memo && i.memo.trim().length > 0).length;
            const avgMemoLength = itemsWithMemo > 0
                ? Math.round(validItems.filter(i => i.memo).reduce((sum, i) => sum + i.memo.length, 0) / itemsWithMemo)
                : 0;

            this.addDiagnostic('MEMO_STATS', `Memo extraction summary`, {
                totalItems: validItems.length,
                withMemo: itemsWithMemo,
                memoRate: validItems.length > 0 ? Math.round((itemsWithMemo / validItems.length) * 100) + '%' : '0%',
                avgMemoLength: avgMemoLength,
                hasMemoColumn: hasMemoCol
            });

            return {
                lineItems: validItems,
                skippedItems: skippedItems,
                confidence: Math.max(0, Math.min(confidence, 1.0)),
                totalFromItems: Math.round(totalFromItems * 100) / 100
            };
        }

        /**
         * Get column type by index
         */
        getColumnType(columns, index) {
            const col = columns.find(c => c.index === index);
            return col?.type || ColumnType.UNKNOWN;
        }

        /**
         * Get column by type
         */
        getColumnByType(columns, type) {
            return columns.find(c => c.type === type);
        }
    }

    return {
        TableAnalyzer: TableAnalyzer,
        ColumnType: ColumnType
    };
});
