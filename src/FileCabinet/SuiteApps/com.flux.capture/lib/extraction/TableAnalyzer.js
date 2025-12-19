/**
 * @NApiVersion 2.1
 * @NModuleScope Public
 * @module FluxCapture/Extraction/TableAnalyzer
 *
 * Smart Table Analyzer v2.0
 * Intelligent column detection, multi-row item handling, and line item extraction
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
            // Header patterns for column detection
            this.HEADER_PATTERNS = {
                [ColumnType.ITEM_CODE]: [
                    /^(item|sku|part|product)\s*(code|no\.?|#|number|id)?$/i,
                    /^code$/i, /^sku$/i, /^part\s*#?$/i, /^stock\s*#?$/i
                ],
                [ColumnType.DESCRIPTION]: [
                    /^desc(ription)?$/i, /^item$/i, /^product$/i, /^service$/i,
                    /^particulars$/i, /^details$/i, /^name$/i,
                    /^goods$/i, /^materials?$/i
                ],
                [ColumnType.MEMO]: [
                    /^memo$/i, /^notes?$/i, /^remarks?$/i, /^comments?$/i,
                    /^line\s*(memo|note)s?$/i, /^item\s*(memo|note)s?$/i,
                    /^additional\s*(info|notes?)$/i, /^instructions?$/i
                ],
                [ColumnType.QUANTITY]: [
                    /^qty$/i, /^quantity$/i, /^units?$/i, /^count$/i,
                    /^pcs$/i, /^pieces?$/i, /^no\.?\s*of/i, /^ordered$/i
                ],
                [ColumnType.UNIT]: [
                    /^unit$/i, /^uom$/i, /^u\/m$/i, /^measure$/i,
                    /^unit\s*of\s*measure$/i
                ],
                [ColumnType.UNIT_PRICE]: [
                    /^(unit\s*)?(price|rate|cost)$/i, /^each$/i,
                    /^rate$/i, /^unit\s*cost$/i, /^price\s*per$/i,
                    /^\$\s*\/\s*unit$/i
                ],
                [ColumnType.AMOUNT]: [
                    /^amount$/i, /^(line\s*)?total$/i, /^extended$/i,
                    /^ext\.?$/i, /^sum$/i, /^value$/i,
                    /^line\s*amount$/i, /^ext\.?\s*price$/i
                ],
                [ColumnType.TAX]: [
                    /^tax$/i, /^vat$/i, /^gst$/i, /^hst$/i,
                    /^tax\s*amount$/i, /^tax\s*%$/i
                ],
                [ColumnType.DISCOUNT]: [
                    /^discount$/i, /^disc\.?$/i, /^disc\s*%$/i,
                    /^savings?$/i
                ],
                [ColumnType.DATE]: [
                    /^date$/i, /^ship\s*date$/i, /^delivery$/i
                ]
            };

            // Data patterns for inferring column types
            this.DATA_PATTERNS = {
                [ColumnType.ITEM_CODE]: /^[A-Z0-9\-\/]{2,15}$/i,
                [ColumnType.QUANTITY]: /^\d{1,4}([.,]\d{1,3})?$/,
                [ColumnType.UNIT_PRICE]: /^[\$€£]?\d{1,6}[.,]\d{2}$/,
                [ColumnType.AMOUNT]: /^[\$€£]?\d{1,8}[.,]\d{2}$/,
                [ColumnType.DATE]: /\d{1,2}[\-\/]\d{1,2}[\-\/]\d{2,4}/
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
                            amt: currentItem.amount
                        });
                    }

                    // Start new item from this anchor row
                    currentItem = this.createLineItem(row, columns, context);
                    itemStartIdx = i;
                    this.addDiagnostic('ROW_DECISION', `Row[${i}] NEW_ANCHOR: Starting new line item`, {
                        desc: currentItem.description?.substring(0, 40),
                        amt: currentItem.amount,
                        qty: currentItem.quantity
                    });

                    // Look backwards for description-only rows that belong to this item
                    // (if current row has no description but previous rows do)
                    if (!currentItem.description || currentItem.description.length < 3) {
                        for (let j = i - 1; j >= 0; j--) {
                            const prevAnalysis = rowAnalysis[j];
                            // Stop if we hit another anchor or summary
                            if (prevAnalysis.hasAmount || prevAnalysis.isSummary || prevAnalysis.used) break;
                            // Check if prev row has description
                            if (prevAnalysis.hasDescription) {
                                const prevRow = body[j];
                                const descCol = columns.find(c => c.type === ColumnType.DESCRIPTION);
                                if (descCol) {
                                    const prevDesc = prevRow[descCol.index]?.text || '';
                                    currentItem.description = prevDesc + (currentItem.description ? ' ' + currentItem.description : '');
                                    prevAnalysis.used = true;
                                }
                                break; // Only look back one row typically
                            }
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
                    currentItem._needsAmountReview = true;
                    this.addDiagnostic('ROW_DECISION', `Row[${i}] NEW_NO_AMOUNT: Has desc+qty but no amount`, {
                        desc: analysis.descriptionText?.substring(0, 40),
                        qty: analysis.quantity
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
                    amt: currentItem.amount
                });
            }

            this.addDiagnostic('EXTRACTION', `Two-pass extraction complete: ${items.length} items created`);

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
         * Modifies item in place
         */
        extractMemoFromDescription(item) {
            if (!item.description) return;

            // If there's already a memo, don't overwrite
            if (item.memo && item.memo.length > 5) return;

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

                    break; // Only extract once
                }
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
         */
        appendToLineItem(item, row, columns) {
            const descCol = columns.find(c => c.type === ColumnType.DESCRIPTION);
            if (descCol) {
                const addText = row[descCol.index]?.text || '';
                if (addText) {
                    item.description += ' ' + addText;
                }
            }

            // Also append memo text if present
            const memoCol = columns.find(c => c.type === ColumnType.MEMO);
            if (memoCol) {
                const addMemo = row[memoCol.index]?.text || '';
                if (addMemo) {
                    item.memo = item.memo ? (item.memo + ' ' + addMemo) : addMemo;
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
         */
        parseSimpleAmount(text) {
            if (!text) return null;
            const cleaned = text
                .replace(/[^\d.,\-]/g, '')
                .replace(/,(\d{3})/g, '$1')
                .replace(/,/g, '.');
            const num = parseFloat(cleaned);
            return isNaN(num) ? null : Math.round(num * 100) / 100;
        }

        /**
         * Post-process line items (v3.0 - MUCH less aggressive filtering)
         * Key changes:
         * - Accept $0 amounts (free items, credits)
         * - Accept items with only itemCode (no description needed)
         * - Calculate amount from qty * rate before filtering
         * - Only skip truly empty rows
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
