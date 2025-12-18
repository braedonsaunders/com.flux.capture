/**
 * @NApiVersion 2.1
 * @NModuleScope Public
 * @module FluxCapture/Extraction/TableAnalyzer
 *
 * Smart Table Analyzer
 * Intelligent column detection, multi-row item handling, and line item extraction
 */

define(['N/log', '../FC_Debug'], function(log, fcDebug) {
    'use strict';

    /**
     * Column semantic types
     */
    const ColumnType = Object.freeze({
        ITEM_CODE: 'ITEM_CODE',
        DESCRIPTION: 'DESCRIPTION',
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
     * Smart Table Analyzer
     * Uses multiple signals to identify columns and extract line items
     */
    class TableAnalyzer {
        constructor(amountParser) {
            this.amountParser = amountParser;
            this.initializePatterns();
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
                    /^particulars$/i, /^details$/i, /^name$/i, /^memo$/i,
                    /^goods$/i, /^materials?$/i
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

            // Summary row indicators
            this.SUMMARY_PATTERNS = [
                /^sub\s*total$/i, /^subtotal$/i,
                /^total$/i, /^grand\s*total$/i,
                /^tax$/i, /^vat$/i, /^gst$/i, /^hst$/i, /^pst$/i,
                /^shipping$/i, /^freight$/i, /^delivery$/i,
                /^discount$/i, /^adjustment$/i,
                /^amount\s*due$/i, /^balance$/i,
                /^net$/i, /^gross$/i,
                /^\s*$/ // Empty row
            ];
        }

        /**
         * Analyze a table and extract structured data
         * @param {Object} table - Table from N/documentCapture
         * @param {Object} context - Extraction context
         * @returns {Object} Analyzed table with column types and line items
         */
        analyze(table, context = {}) {
            if (!table) {
                return { columns: [], lineItems: [], confidence: 0 };
            }

            // Step 1: Extract raw structure
            const structure = this.extractStructure(table);

            // Step 2: Identify columns
            const columns = this.identifyColumns(structure);

            // Step 3: Extract line items
            const lineItems = this.extractLineItems(structure, columns, context);

            // Step 4: Post-process and validate
            const processed = this.postProcess(lineItems, columns);

            fcDebug.debug('TableAnalyzer.analyze', {
                columns: columns.map(c => c.type),
                lineItems: processed.lineItems.length,
                confidence: processed.confidence.toFixed(2)
            });

            return {
                columns: columns,
                lineItems: processed.lineItems,
                confidence: processed.confidence,
                totalFromItems: processed.totalFromItems
            };
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
         */
        identifyFromData(bodyRows, colIndex) {
            if (!bodyRows || bodyRows.length === 0) {
                return { type: ColumnType.UNKNOWN, confidence: 0 };
            }

            // Sample data from column
            const samples = bodyRows
                .slice(0, Math.min(10, bodyRows.length))
                .map(row => row[colIndex]?.text || '')
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
            const textSamples = samples.filter(s =>
                s.length >= 5 && /[a-zA-Z]{3,}/.test(s)
            );
            if (textSamples.length / samples.length >= 0.7) {
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
         */
        applyPositionalHeuristics(column, index, totalColumns) {
            // First column is often item code or description
            if (index === 0 && column.type === ColumnType.UNKNOWN) {
                column.type = ColumnType.ITEM_CODE;
                column.confidence = 0.5;
            }

            // Second column is often description if first is code
            if (index === 1 && column.type === ColumnType.UNKNOWN) {
                column.type = ColumnType.DESCRIPTION;
                column.confidence = 0.6;
            }

            // Last column is usually amount
            if (index === totalColumns - 1 && column.type === ColumnType.UNKNOWN) {
                column.type = ColumnType.AMOUNT;
                column.confidence = 0.7;
            }

            // Second to last is often unit price
            if (index === totalColumns - 2 && column.type === ColumnType.UNKNOWN) {
                column.type = ColumnType.UNIT_PRICE;
                column.confidence = 0.5;
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
         */
        isSummaryRow(description) {
            if (!description) return false;
            const normalized = description.toLowerCase().trim();
            return this.SUMMARY_PATTERNS.some(p => p.test(normalized));
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
         * Post-process line items
         */
        postProcess(lineItems, columns) {
            // Filter out invalid items
            const validItems = lineItems.filter(item =>
                item.description &&
                item.description.trim().length >= 2 &&
                (item.amount > 0 || item.quantity > 0)
            );

            // Calculate confidence based on extraction quality
            let confidence = 0.7;

            // Boost confidence if we identified key columns
            const hasDescription = columns.some(c => c.type === ColumnType.DESCRIPTION);
            const hasAmount = columns.some(c => c.type === ColumnType.AMOUNT);

            if (hasDescription && hasAmount) {
                confidence += 0.2;
            }

            // Reduce confidence if we lost many items
            if (lineItems.length > 0 && validItems.length / lineItems.length < 0.5) {
                confidence -= 0.2;
            }

            // Calculate total from line items
            const totalFromItems = validItems.reduce((sum, item) =>
                sum + (item.amount || 0), 0
            );

            return {
                lineItems: validItems,
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
