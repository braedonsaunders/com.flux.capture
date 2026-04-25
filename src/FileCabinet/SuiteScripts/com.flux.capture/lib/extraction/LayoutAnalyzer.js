/**
 * @NApiVersion 2.1
 * @NModuleScope Public
 * @module FluxCapture/Extraction/LayoutAnalyzer
 *
 * Document Layout Analyzer
 * Detects document zones (header, line items, totals) for context-aware extraction
 */

define(['N/log', '../FC_Debug'], function(log, fcDebug) {
    'use strict';

    /**
     * Document Zone Types
     */
    const Zone = Object.freeze({
        HEADER: 'HEADER',           // Top area: vendor info, invoice #, dates
        BILL_TO: 'BILL_TO',         // Customer/ship-to address area
        LINE_ITEMS: 'LINE_ITEMS',   // Product/service table
        TOTALS: 'TOTALS',           // Subtotal, tax, total area
        FOOTER: 'FOOTER',           // Payment terms, bank details
        UNKNOWN: 'UNKNOWN'
    });

    /**
     * Layout Analyzer
     * Analyzes document structure to identify zones and improve field extraction
     */
    class LayoutAnalyzer {
        constructor() {
            this.zoneIndicators = this.initializeZoneIndicators();
        }

        /**
         * Initialize zone indicator patterns
         */
        initializeZoneIndicators() {
            return {
                [Zone.HEADER]: {
                    keywords: [
                        /invoice/i, /bill/i, /statement/i,
                        /date/i, /invoice\s*(no|#|number)/i,
                        /from/i, /vendor/i, /supplier/i
                    ],
                    positionHint: { yMin: 0, yMax: 0.25 } // Top 25%
                },
                [Zone.BILL_TO]: {
                    keywords: [
                        /bill\s*to/i, /ship\s*to/i, /sold\s*to/i,
                        /customer/i, /deliver\s*to/i, /attention/i
                    ],
                    positionHint: { yMin: 0.10, yMax: 0.40 }
                },
                [Zone.LINE_ITEMS]: {
                    keywords: [
                        /description/i, /item/i, /product/i, /service/i,
                        /qty/i, /quantity/i, /price/i, /amount/i,
                        /unit/i, /rate/i
                    ],
                    positionHint: { yMin: 0.25, yMax: 0.80 }
                },
                [Zone.TOTALS]: {
                    keywords: [
                        /sub\s*total/i, /total/i, /tax/i, /vat/i, /gst/i,
                        /amount\s*due/i, /balance/i, /grand\s*total/i,
                        /net/i, /gross/i
                    ],
                    positionHint: { yMin: 0.60, yMax: 1.0 } // Bottom 40%
                },
                [Zone.FOOTER]: {
                    keywords: [
                        /terms/i, /payment/i, /bank/i, /account/i,
                        /remit/i, /wire/i, /routing/i, /iban/i,
                        /thank\s*you/i
                    ],
                    positionHint: { yMin: 0.80, yMax: 1.0 }
                }
            };
        }

        /**
         * Analyze document and identify zones
         * @param {Object} extractionResult - Raw extraction result from N/documentCapture
         * @returns {Object} Document layout with zone assignments
         */
        analyze(extractionResult) {
            const layout = {
                zones: {},
                elements: [],
                tables: [],
                pageHeight: 1.0, // Normalized
                pageWidth: 1.0
            };

            if (!extractionResult || !extractionResult.pages) {
                return layout;
            }

            // Process first page (most invoices are single page)
            const firstPage = extractionResult.pages[0];

            // Collect all elements with positions
            const elements = this.collectElements(firstPage);
            layout.elements = elements;

            // Find tables (line items are usually in largest table)
            const tables = this.identifyTables(firstPage);
            layout.tables = tables;

            // Assign zones to elements
            this.assignZones(layout);

            // Identify the main line items table
            layout.lineItemsTable = this.findLineItemsTable(tables, layout);

            fcDebug.debug('LayoutAnalyzer.analyze', {
                elementCount: elements.length,
                tableCount: tables.length,
                zones: Object.keys(layout.zones).filter(z => layout.zones[z].length > 0)
            });

            return layout;
        }

        /**
         * Collect all text elements with position information
         */
        collectElements(page) {
            const elements = [];

            // Collect from fields
            if (page.fields) {
                page.fields.forEach((field, index) => {
                    const element = {
                        type: 'field',
                        index: index,
                        label: this.extractText(field.label),
                        value: this.extractText(field.value),
                        confidence: field.confidence || field.label?.confidence || 0.5,
                        position: this.extractPosition(field),
                        zone: Zone.UNKNOWN
                    };
                    if (element.label || element.value) {
                        elements.push(element);
                    }
                });
            }

            // Collect from lines
            if (page.lines) {
                page.lines.forEach((line, index) => {
                    const text = this.extractText(line);
                    if (text) {
                        elements.push({
                            type: 'line',
                            index: index,
                            text: text,
                            confidence: line.confidence || 0.5,
                            position: this.extractPosition(line),
                            zone: Zone.UNKNOWN
                        });
                    }
                });
            }

            // Sort by vertical position (top to bottom)
            elements.sort((a, b) => (a.position?.y || 0) - (b.position?.y || 0));

            return elements;
        }

        /**
         * Identify tables in the document
         */
        identifyTables(page) {
            const tables = [];

            if (page.tables) {
                page.tables.forEach((table, index) => {
                    const rowCount = (table.headerRows?.length || 0) +
                                    (table.bodyRows?.length || 0) +
                                    (table.footerRows?.length || 0);

                    const colCount = this.getColumnCount(table);

                    tables.push({
                        index: index,
                        rowCount: rowCount,
                        colCount: colCount,
                        hasHeaders: (table.headerRows?.length || 0) > 0,
                        bodyRowCount: table.bodyRows?.length || 0,
                        position: this.estimateTablePosition(table),
                        confidence: table.confidence || 0.7,
                        raw: table
                    });
                });
            }

            // Sort by size (largest first)
            tables.sort((a, b) => b.bodyRowCount - a.bodyRowCount);

            return tables;
        }

        /**
         * Get column count from a table
         */
        getColumnCount(table) {
            let maxCols = 0;

            const checkRows = (rows) => {
                if (!rows) return;
                rows.forEach(row => {
                    const cells = Array.isArray(row) ? row : (row.cells || []);
                    maxCols = Math.max(maxCols, cells.length);
                });
            };

            checkRows(table.headerRows);
            checkRows(table.bodyRows);
            checkRows(table.footerRows);

            return maxCols;
        }

        /**
         * Estimate table position from its cells
         */
        estimateTablePosition(table) {
            // Tables from N/documentCapture may not have direct position
            // Estimate from first/last cells if available
            let minY = 1.0, maxY = 0;

            const processRows = (rows) => {
                if (!rows) return;
                rows.forEach(row => {
                    const cells = Array.isArray(row) ? row : (row.cells || []);
                    cells.forEach(cell => {
                        const pos = this.extractPosition(cell);
                        if (pos) {
                            minY = Math.min(minY, pos.y);
                            maxY = Math.max(maxY, pos.y + (pos.height || 0.02));
                        }
                    });
                });
            };

            processRows(table.headerRows);
            processRows(table.bodyRows);
            processRows(table.footerRows);

            return {
                y: minY < 1.0 ? minY : 0.35, // Default to middle-ish
                height: maxY > minY ? maxY - minY : 0.30
            };
        }

        /**
         * Assign zones to elements based on position and content
         */
        assignZones(layout) {
            // Initialize zone arrays
            Object.values(Zone).forEach(zone => {
                layout.zones[zone] = [];
            });

            layout.elements.forEach(element => {
                const zone = this.determineZone(element, layout);
                element.zone = zone;
                layout.zones[zone].push(element);
            });
        }

        /**
         * Determine which zone an element belongs to
         */
        determineZone(element, layout) {
            const y = element.position?.y || 0;
            const text = (element.label || element.value || element.text || '').toLowerCase();

            // Score each zone
            const scores = {};

            for (const [zone, indicators] of Object.entries(this.zoneIndicators)) {
                let score = 0;

                // Position score
                if (y >= indicators.positionHint.yMin && y <= indicators.positionHint.yMax) {
                    // Closer to middle of zone range = higher score
                    const zoneMid = (indicators.positionHint.yMin + indicators.positionHint.yMax) / 2;
                    const distFromMid = Math.abs(y - zoneMid);
                    const zoneRange = indicators.positionHint.yMax - indicators.positionHint.yMin;
                    score += (1 - distFromMid / zoneRange) * 0.4;
                }

                // Keyword score
                for (const pattern of indicators.keywords) {
                    if (pattern.test(text)) {
                        score += 0.3;
                        break;
                    }
                }

                scores[zone] = score;
            }

            // Find highest scoring zone
            let bestZone = Zone.UNKNOWN;
            let bestScore = 0.2; // Minimum threshold

            for (const [zone, score] of Object.entries(scores)) {
                if (score > bestScore) {
                    bestScore = score;
                    bestZone = zone;
                }
            }

            return bestZone;
        }

        /**
         * Find the main line items table
         */
        findLineItemsTable(tables, layout) {
            if (tables.length === 0) return null;

            // Score each table
            const scored = tables.map(table => {
                let score = 0;

                // Size score - larger tables more likely to be line items
                score += Math.min(table.bodyRowCount / 20, 0.4);

                // Column count - line items typically have 4-8 columns
                if (table.colCount >= 3 && table.colCount <= 10) {
                    score += 0.2;
                }

                // Position - should be in middle area
                if (table.position.y >= 0.25 && table.position.y <= 0.75) {
                    score += 0.2;
                }

                // Has headers
                if (table.hasHeaders) {
                    score += 0.2;
                }

                return { ...table, score };
            });

            scored.sort((a, b) => b.score - a.score);

            return scored[0].score > 0.3 ? scored[0] : null;
        }

        /**
         * Extract text from various field/line formats
         */
        extractText(obj) {
            if (!obj) return null;
            if (typeof obj === 'string') return obj;
            if (typeof obj === 'number') return String(obj);
            return obj.text || obj.name || obj.value || obj.content || null;
        }

        /**
         * Extract position from an element
         * Returns normalized coordinates (0-1 range)
         */
        extractPosition(obj) {
            if (!obj) return null;

            // Try different property names used by N/documentCapture
            const bbox = obj.boundingBox || obj.bbox || obj.geometry || obj.position;

            if (bbox) {
                // Normalize if not already
                return {
                    x: bbox.x || bbox.left || 0,
                    y: bbox.y || bbox.top || 0,
                    width: bbox.width || (bbox.right - bbox.left) || 0,
                    height: bbox.height || (bbox.bottom - bbox.top) || 0
                };
            }

            return null;
        }

        /**
         * Get elements in a specific zone
         */
        getZoneElements(layout, zone) {
            return layout.zones[zone] || [];
        }

        /**
         * Get zone for a field based on its label
         */
        getFieldZone(layout, fieldLabel) {
            const normalizedLabel = (fieldLabel || '').toLowerCase();

            for (const element of layout.elements) {
                const elemLabel = (element.label || '').toLowerCase();
                if (elemLabel.includes(normalizedLabel) || normalizedLabel.includes(elemLabel)) {
                    return element.zone;
                }
            }

            return Zone.UNKNOWN;
        }

        /**
         * Get nearby elements to a given element
         */
        getNearbyElements(layout, element, radius = 0.1) {
            if (!element.position) return [];

            return layout.elements.filter(e => {
                if (!e.position || e === element) return false;

                const dx = Math.abs(e.position.x - element.position.x);
                const dy = Math.abs(e.position.y - element.position.y);

                return dx <= radius && dy <= radius;
            });
        }

        /**
         * Get labels near a value (for field matching context)
         */
        getNearbyLabels(layout, position, radius = 0.1) {
            if (!position) return [];

            return layout.elements
                .filter(e => {
                    if (!e.position) return false;
                    const dy = Math.abs(e.position.y - position.y);
                    const dx = e.position.x - position.x;
                    // Labels are typically to the left or slightly above
                    return dy <= radius && dx >= -radius && dx <= 0.02;
                })
                .map(e => e.label || e.text)
                .filter(Boolean);
        }
    }

    return {
        LayoutAnalyzer: LayoutAnalyzer,
        Zone: Zone
    };
});
