/**
 * @NApiVersion 2.1
 * @NModuleScope Public
 * @module FluxCapture/Utils/PDFUtils
 *
 * PDF Utilities for page counting and chunking.
 * Used to split large PDFs before sending to extraction providers
 * to avoid timeout issues with large documents.
 */

define(['N/log'], function(log) {
    'use strict';

    /**
     * PDF Parser and Chunker
     * Handles counting pages and extracting first N pages from a PDF
     */
    class PDFUtils {

        /**
         * Count pages in a PDF
         * @param {string} base64Content - Base64 encoded PDF content
         * @returns {number} - Number of pages, or -1 if unable to count
         */
        static countPages(base64Content) {
            try {
                const pdfBytes = PDFUtils._base64ToBytes(base64Content);
                const pdfString = PDFUtils._bytesToString(pdfBytes);

                log.debug('PDFUtils.countPages', {
                    pdfSize: pdfBytes.length,
                    stringLength: pdfString.length
                });

                // Method 1: Look for /Type /Page entries (most reliable)
                const pageMatches = pdfString.match(/\/Type\s*\/Page[^s]/g);
                if (pageMatches) {
                    log.debug('PDFUtils.countPages', {
                        method: 'Type/Page regex',
                        count: pageMatches.length
                    });
                    return pageMatches.length;
                }

                // Method 2: Look for /Count in the page tree
                const countMatch = pdfString.match(/\/Count\s+(\d+)/);
                if (countMatch) {
                    log.debug('PDFUtils.countPages', {
                        method: '/Count in page tree',
                        count: parseInt(countMatch[1], 10)
                    });
                    return parseInt(countMatch[1], 10);
                }

                // Method 3: Count page objects with /Parent
                const pageObjMatches = pdfString.match(/\/Type\s*\/Page\b/g);
                if (pageObjMatches) {
                    log.debug('PDFUtils.countPages', {
                        method: 'Type/Page boundary',
                        count: pageObjMatches.length
                    });
                    return pageObjMatches.length;
                }

                log.debug('PDFUtils.countPages', 'Could not determine page count');
                return -1;

            } catch (e) {
                log.error('PDFUtils.countPages', e.message);
                return -1;
            }
        }

        /**
         * Extract the first N pages from a PDF
         * @param {string} base64Content - Base64 encoded PDF content
         * @param {number} maxPages - Maximum number of pages to extract
         * @returns {Object} - { success: boolean, content?: string, pageCount?: number, error?: string }
         */
        static extractFirstPages(base64Content, maxPages) {
            try {
                const pdfBytes = PDFUtils._base64ToBytes(base64Content);

                // Parse the PDF
                const parser = new PDFParser(pdfBytes);
                const parseResult = parser.parse();

                if (!parseResult.success) {
                    return { success: false, error: parseResult.error };
                }

                const totalPages = parseResult.pageCount;

                // If already within limit, return original
                if (totalPages <= maxPages) {
                    log.audit('PDFUtils.extractFirstPages', `PDF has ${totalPages} pages, within limit of ${maxPages}`);
                    return {
                        success: true,
                        content: base64Content,
                        pageCount: totalPages,
                        wasChunked: false
                    };
                }

                log.audit('PDFUtils.extractFirstPages', `Chunking PDF from ${totalPages} pages to ${maxPages} pages`);

                // Build new PDF with only first N pages
                const builder = new PDFBuilder(parseResult);
                const newPdfBytes = builder.buildWithPages(maxPages);

                // Convert back to base64
                const newBase64 = PDFUtils._bytesToBase64(newPdfBytes);

                return {
                    success: true,
                    content: newBase64,
                    pageCount: maxPages,
                    originalPageCount: totalPages,
                    wasChunked: true
                };

            } catch (e) {
                log.error('PDFUtils.extractFirstPages', { message: e.message, stack: e.stack });
                return { success: false, error: e.message };
            }
        }

        /**
         * Check if file is a PDF based on magic bytes
         * @param {string} base64Content - Base64 encoded content
         * @returns {boolean}
         */
        static isPDF(base64Content) {
            try {
                // PDF magic bytes: %PDF
                // Take enough base64 chars to get at least 8 bytes for header check
                const bytes = PDFUtils._base64ToBytes(base64Content.substring(0, 20));
                const header = PDFUtils._bytesToString(bytes);
                const isPdf = header.startsWith('%PDF');

                log.debug('PDFUtils.isPDF', {
                    headerBytes: header.substring(0, 10),
                    isPdf: isPdf
                });

                return isPdf;
            } catch (e) {
                log.error('PDFUtils.isPDF', { error: e.message });
                return false;
            }
        }

        // ============================================
        // Encoding/Decoding Utilities
        // Uses manual base64 decoding for binary data compatibility
        // N/encode with UTF-8 corrupts binary data, so we use raw decoding
        // ============================================

        static _base64ToBytes(base64) {
            // Handle both URL-safe and standard base64
            const normalized = base64.replace(/-/g, '+').replace(/_/g, '/');

            // Pad if necessary
            const padded = normalized + '=='.slice(0, (4 - normalized.length % 4) % 4);

            // Base64 character set
            const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
            const lookup = new Uint8Array(256);
            for (let i = 0; i < chars.length; i++) {
                lookup[chars.charCodeAt(i)] = i;
            }

            // Calculate output length
            let outputLen = (padded.length / 4) * 3;
            if (padded[padded.length - 1] === '=') outputLen--;
            if (padded[padded.length - 2] === '=') outputLen--;

            // Decode
            const bytes = new Uint8Array(outputLen);
            let p = 0;

            for (let i = 0; i < padded.length; i += 4) {
                const a = lookup[padded.charCodeAt(i)];
                const b = lookup[padded.charCodeAt(i + 1)];
                const c = lookup[padded.charCodeAt(i + 2)];
                const d = lookup[padded.charCodeAt(i + 3)];

                bytes[p++] = (a << 2) | (b >> 4);
                if (p < outputLen) bytes[p++] = ((b & 15) << 4) | (c >> 2);
                if (p < outputLen) bytes[p++] = ((c & 3) << 6) | d;
            }

            return bytes;
        }

        static _bytesToBase64(bytes) {
            // Base64 character set
            const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
            let result = '';

            for (let i = 0; i < bytes.length; i += 3) {
                const a = bytes[i];
                const b = i + 1 < bytes.length ? bytes[i + 1] : 0;
                const c = i + 2 < bytes.length ? bytes[i + 2] : 0;

                result += chars[a >> 2];
                result += chars[((a & 3) << 4) | (b >> 4)];
                result += i + 1 < bytes.length ? chars[((b & 15) << 2) | (c >> 6)] : '=';
                result += i + 2 < bytes.length ? chars[c & 63] : '=';
            }

            return result;
        }

        static _bytesToString(bytes) {
            let str = '';
            for (let i = 0; i < bytes.length; i++) {
                str += String.fromCharCode(bytes[i]);
            }
            return str;
        }

        static _stringToBytes(str) {
            const bytes = new Uint8Array(str.length);
            for (let i = 0; i < str.length; i++) {
                bytes[i] = str.charCodeAt(i);
            }
            return bytes;
        }
    }

    /**
     * PDF Parser - Parses PDF structure to extract objects and page tree
     */
    class PDFParser {
        constructor(pdfBytes) {
            this.bytes = pdfBytes;
            this.data = PDFUtils._bytesToString(pdfBytes);
            this.objects = new Map();
            this.xref = null;
            this.trailer = null;
            this.pageRefs = [];
        }

        parse() {
            try {
                // Find and parse cross-reference table
                this._parseXref();

                // Parse trailer
                this._parseTrailer();

                // Parse all objects
                this._parseObjects();

                // Find page references
                this._findPageRefs();

                return {
                    success: true,
                    pageCount: this.pageRefs.length,
                    objects: this.objects,
                    xref: this.xref,
                    trailer: this.trailer,
                    pageRefs: this.pageRefs,
                    data: this.data,
                    bytes: this.bytes
                };

            } catch (e) {
                return {
                    success: false,
                    error: e.message
                };
            }
        }

        _parseXref() {
            // Find xref position from end of file
            const startxrefMatch = this.data.match(/startxref\s+(\d+)\s*%%EOF/);
            if (!startxrefMatch) {
                throw new Error('Cannot find startxref in PDF');
            }

            const xrefPos = parseInt(startxrefMatch[1], 10);
            this.xref = { position: xrefPos, entries: [] };

            // Check if it's a cross-reference stream or table
            const xrefSection = this.data.substring(xrefPos, xrefPos + 100);

            if (xrefSection.startsWith('xref')) {
                // Traditional xref table
                this._parseXrefTable(xrefPos);
            } else {
                // Cross-reference stream (PDF 1.5+)
                // For streams, we'll parse objects directly
                this.xref.isStream = true;
            }
        }

        _parseXrefTable(pos) {
            const xrefEnd = this.data.indexOf('trailer', pos);
            if (xrefEnd === -1) {
                return;
            }

            const xrefData = this.data.substring(pos, xrefEnd);
            const lines = xrefData.split(/\r?\n/);

            let currentObjNum = 0;
            for (let i = 1; i < lines.length; i++) {
                const line = lines[i].trim();
                if (!line) continue;

                // Section header: "0 123" (start objNum, count)
                const sectionMatch = line.match(/^(\d+)\s+(\d+)$/);
                if (sectionMatch) {
                    currentObjNum = parseInt(sectionMatch[1], 10);
                    continue;
                }

                // Entry: "0000000000 65535 f" or "0000000123 00000 n"
                const entryMatch = line.match(/^(\d{10})\s+(\d{5})\s+([nf])$/);
                if (entryMatch) {
                    this.xref.entries.push({
                        objNum: currentObjNum,
                        offset: parseInt(entryMatch[1], 10),
                        gen: parseInt(entryMatch[2], 10),
                        inUse: entryMatch[3] === 'n'
                    });
                    currentObjNum++;
                }
            }
        }

        _parseTrailer() {
            const trailerMatch = this.data.match(/trailer\s*<<([\s\S]*?)>>/);
            if (trailerMatch) {
                this.trailer = this._parseDict('<<' + trailerMatch[1] + '>>');
            } else {
                // Look for trailer in xref stream
                this.trailer = {};
            }
        }

        _parseDict(str) {
            const dict = {};
            const content = str.slice(2, -2); // Remove << and >>

            // Match key-value pairs
            const regex = /\/(\w+)\s*([^\/]*?)(?=\/\w+|$)/g;
            let match;

            while ((match = regex.exec(content)) !== null) {
                const key = match[1];
                let value = match[2].trim();

                // Parse value based on type
                if (value.startsWith('<<')) {
                    dict[key] = this._parseDict(value);
                } else if (value.match(/^\d+\s+\d+\s+R$/)) {
                    // Reference
                    const refMatch = value.match(/^(\d+)\s+(\d+)\s+R$/);
                    dict[key] = { ref: true, objNum: parseInt(refMatch[1], 10), gen: parseInt(refMatch[2], 10) };
                } else if (value.startsWith('[')) {
                    dict[key] = this._parseArray(value);
                } else if (value.match(/^\d+$/)) {
                    dict[key] = parseInt(value, 10);
                } else {
                    dict[key] = value;
                }
            }

            return dict;
        }

        _parseArray(str) {
            const content = str.slice(1, -1).trim();
            const items = [];

            // Match references in array
            const refRegex = /(\d+)\s+(\d+)\s+R/g;
            let match;

            while ((match = refRegex.exec(content)) !== null) {
                items.push({
                    ref: true,
                    objNum: parseInt(match[1], 10),
                    gen: parseInt(match[2], 10)
                });
            }

            return items;
        }

        _parseObjects() {
            // Find all object definitions
            const objRegex = /(\d+)\s+(\d+)\s+obj\s*([\s\S]*?)endobj/g;
            let match;

            while ((match = objRegex.exec(this.data)) !== null) {
                const objNum = parseInt(match[1], 10);
                const gen = parseInt(match[2], 10);
                const content = match[3].trim();
                const startPos = match.index;
                const endPos = match.index + match[0].length;

                this.objects.set(objNum, {
                    objNum: objNum,
                    gen: gen,
                    content: content,
                    raw: match[0],
                    startPos: startPos,
                    endPos: endPos
                });
            }
        }

        _findPageRefs() {
            // Find all Page objects (not Pages)
            for (const [objNum, obj] of this.objects) {
                if (obj.content.includes('/Type') &&
                    obj.content.includes('/Page') &&
                    !obj.content.includes('/Pages')) {

                    // Verify it's actually a Page type
                    const typeMatch = obj.content.match(/\/Type\s*\/Page\b/);
                    if (typeMatch) {
                        this.pageRefs.push({
                            objNum: objNum,
                            gen: obj.gen
                        });
                    }
                }
            }

            // Sort by object number to maintain page order
            // (This is a simplification - proper ordering requires traversing the page tree)
            this.pageRefs.sort((a, b) => a.objNum - b.objNum);

            // Try to get proper page order from page tree if possible
            this._orderPagesFromTree();
        }

        _orderPagesFromTree() {
            // Find the root catalog
            let catalogRef = null;
            if (this.trailer && this.trailer.Root) {
                catalogRef = this.trailer.Root;
            }

            if (!catalogRef || !catalogRef.ref) {
                return; // Keep simple ordering
            }

            const catalog = this.objects.get(catalogRef.objNum);
            if (!catalog) return;

            // Find Pages reference in catalog
            const pagesMatch = catalog.content.match(/\/Pages\s+(\d+)\s+(\d+)\s+R/);
            if (!pagesMatch) return;

            const pagesObjNum = parseInt(pagesMatch[1], 10);
            const pagesObj = this.objects.get(pagesObjNum);
            if (!pagesObj) return;

            // Extract Kids array for page ordering
            const orderedRefs = this._extractKids(pagesObj.content);
            if (orderedRefs.length > 0) {
                this.pageRefs = orderedRefs;
            }
        }

        _extractKids(content) {
            const kidsMatch = content.match(/\/Kids\s*\[([\s\S]*?)\]/);
            if (!kidsMatch) return [];

            const refs = [];
            const refRegex = /(\d+)\s+(\d+)\s+R/g;
            let match;

            while ((match = refRegex.exec(kidsMatch[1])) !== null) {
                const objNum = parseInt(match[1], 10);
                const obj = this.objects.get(objNum);

                if (obj) {
                    // Check if this is a Page or Pages node
                    if (obj.content.includes('/Type /Pages') || obj.content.includes('/Type/Pages')) {
                        // Recurse into Pages node
                        const childRefs = this._extractKids(obj.content);
                        refs.push(...childRefs);
                    } else if (obj.content.includes('/Type /Page') || obj.content.includes('/Type/Page')) {
                        refs.push({
                            objNum: objNum,
                            gen: parseInt(match[2], 10)
                        });
                    }
                }
            }

            return refs;
        }
    }

    /**
     * PDF Builder - Reconstructs a PDF with only selected pages
     */
    class PDFBuilder {
        constructor(parseResult) {
            this.parsed = parseResult;
            this.objects = parseResult.objects;
            this.pageRefs = parseResult.pageRefs;
            this.data = parseResult.data;
            this.bytes = parseResult.bytes;
        }

        buildWithPages(maxPages) {
            // Get the pages we want to keep
            const keepPages = this.pageRefs.slice(0, maxPages);
            const keepPageNums = new Set(keepPages.map(p => p.objNum));

            // Collect all objects that are referenced by the pages we're keeping
            const referencedObjects = this._collectReferencedObjects(keepPages);

            // Build new PDF
            return this._buildPDF(keepPages, referencedObjects);
        }

        _collectReferencedObjects(pages) {
            const referenced = new Set();
            const toProcess = [];

            // Start with page objects
            for (const page of pages) {
                toProcess.push(page.objNum);
            }

            // Add catalog and pages tree objects
            if (this.parsed.trailer && this.parsed.trailer.Root) {
                toProcess.push(this.parsed.trailer.Root.objNum);
            }

            // Traverse object references
            while (toProcess.length > 0) {
                const objNum = toProcess.pop();
                if (referenced.has(objNum)) continue;

                referenced.add(objNum);

                const obj = this.objects.get(objNum);
                if (!obj) continue;

                // Find all references in this object
                const refRegex = /(\d+)\s+0\s+R/g;
                let match;

                while ((match = refRegex.exec(obj.content)) !== null) {
                    const refObjNum = parseInt(match[1], 10);
                    if (!referenced.has(refObjNum)) {
                        toProcess.push(refObjNum);
                    }
                }
            }

            return referenced;
        }

        _buildPDF(keepPages, referencedObjects) {
            const parts = [];
            const newOffsets = new Map();
            let currentOffset = 0;

            // PDF Header
            const header = '%PDF-1.7\n%\xFF\xFF\xFF\xFF\n';
            parts.push(header);
            currentOffset += header.length;

            // Build object number mapping (old -> new)
            const objMapping = new Map();
            let newObjNum = 1;

            // First, create new Pages object
            const pagesObjNum = newObjNum++;
            objMapping.set('__pages__', pagesObjNum);

            // Map referenced objects
            for (const objNum of referencedObjects) {
                if (!objMapping.has(objNum)) {
                    objMapping.set(objNum, newObjNum++);
                }
            }

            // Map page objects specifically
            for (const page of keepPages) {
                if (!objMapping.has(page.objNum)) {
                    objMapping.set(page.objNum, newObjNum++);
                }
            }

            // Write Pages object (page tree root)
            const kidsRefs = keepPages.map(p => `${objMapping.get(p.objNum)} 0 R`).join(' ');
            const pagesObj = `${pagesObjNum} 0 obj\n<< /Type /Pages /Kids [${kidsRefs}] /Count ${keepPages.length} >>\nendobj\n`;
            newOffsets.set(pagesObjNum, currentOffset);
            parts.push(pagesObj);
            currentOffset += pagesObj.length;

            // Write Catalog
            const catalogObjNum = newObjNum++;
            const catalogObj = `${catalogObjNum} 0 obj\n<< /Type /Catalog /Pages ${pagesObjNum} 0 R >>\nendobj\n`;
            newOffsets.set(catalogObjNum, currentOffset);
            parts.push(catalogObj);
            currentOffset += catalogObj.length;

            // Write page objects with updated references
            for (const page of keepPages) {
                const obj = this.objects.get(page.objNum);
                if (!obj) continue;

                const newNum = objMapping.get(page.objNum);
                newOffsets.set(newNum, currentOffset);

                // Update Parent reference to point to new Pages object
                let content = obj.content;
                content = content.replace(/\/Parent\s+\d+\s+\d+\s+R/, `/Parent ${pagesObjNum} 0 R`);

                // Update all other references
                content = this._updateReferences(content, objMapping);

                const newObj = `${newNum} 0 obj\n${content}\nendobj\n`;
                parts.push(newObj);
                currentOffset += newObj.length;
            }

            // Write other referenced objects (resources, fonts, etc.)
            for (const objNum of referencedObjects) {
                // Skip pages (already written) and pages tree objects
                if (keepPages.some(p => p.objNum === objNum)) continue;

                const obj = this.objects.get(objNum);
                if (!obj) continue;

                // Skip Pages type objects (we created our own)
                if (obj.content.includes('/Type /Pages') || obj.content.includes('/Type/Pages')) continue;
                // Skip Catalog (we created our own)
                if (obj.content.includes('/Type /Catalog') || obj.content.includes('/Type/Catalog')) continue;

                const newNum = objMapping.get(objNum);
                if (!newNum || newOffsets.has(newNum)) continue;

                newOffsets.set(newNum, currentOffset);

                // Update references in content
                let content = this._updateReferences(obj.content, objMapping);

                const newObj = `${newNum} 0 obj\n${content}\nendobj\n`;
                parts.push(newObj);
                currentOffset += newObj.length;
            }

            // Write xref table
            const xrefOffset = currentOffset;
            const maxObjNum = Math.max(...Array.from(newOffsets.keys()), catalogObjNum);

            let xref = `xref\n0 ${maxObjNum + 1}\n`;
            xref += '0000000000 65535 f \n';

            for (let i = 1; i <= maxObjNum; i++) {
                const offset = newOffsets.get(i) || 0;
                xref += `${String(offset).padStart(10, '0')} 00000 n \n`;
            }

            parts.push(xref);
            currentOffset += xref.length;

            // Write trailer
            const trailer = `trailer\n<< /Size ${maxObjNum + 1} /Root ${catalogObjNum} 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;
            parts.push(trailer);

            // Join all parts and convert to bytes
            const pdfString = parts.join('');
            return PDFUtils._stringToBytes(pdfString);
        }

        _updateReferences(content, objMapping) {
            // Update object references
            return content.replace(/(\d+)\s+0\s+R/g, (match, objNum) => {
                const num = parseInt(objNum, 10);
                const newNum = objMapping.get(num);
                if (newNum) {
                    return `${newNum} 0 R`;
                }
                return match;
            });
        }
    }

    return {
        PDFUtils: PDFUtils,
        countPages: PDFUtils.countPages.bind(PDFUtils),
        extractFirstPages: PDFUtils.extractFirstPages.bind(PDFUtils),
        isPDF: PDFUtils.isPDF.bind(PDFUtils)
    };
});
