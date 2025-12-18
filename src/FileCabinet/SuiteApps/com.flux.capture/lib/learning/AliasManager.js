/**
 * @NApiVersion 2.1
 * @NModuleScope Public
 * @module FluxCapture/Learning/AliasManager
 *
 * Vendor Alias Manager
 * Manages learned vendor name aliases for improved matching
 * Uses Flux Configuration records for storage
 */

define(['N/log', 'N/record', 'N/query', 'N/runtime', 'N/cache', '../FC_Debug'], function(log, record, query, runtime, cache, fcDebug) {
    'use strict';

    /**
     * Vendor Alias Manager
     * Stores and retrieves vendor name aliases learned from user corrections
     */
    class AliasManager {
        constructor() {
            this.CONFIG_RECORD_TYPE = 'customrecord_flux_config';
            this.CONFIG_TYPE = 'vendor_alias';
            this.aliasCache = null;
            this.cacheTime = 0;
            this.CACHE_TTL = 5 * 60 * 1000; // 5 minutes
        }

        /**
         * Add a vendor alias
         * @param {string} aliasText - The OCR text that should map to vendor
         * @param {number} vendorId - The correct vendor ID
         * @param {Object} options - Additional options
         * @returns {Object} Result of the operation
         */
        addAlias(aliasText, vendorId, options = {}) {
            if (!aliasText || !vendorId) {
                return { success: false, reason: 'Alias text and vendor ID required' };
            }

            const normalizedAlias = this.normalizeAlias(aliasText);
            const key = `alias_${this.hashKey(normalizedAlias)}`;

            try {
                // Check for existing alias
                const existing = this.getAliasRecord(key);

                // Get vendor name for reference
                const vendorName = this.getVendorName(vendorId);

                const data = existing?.data || {
                    aliases: [],
                    vendorId: vendorId,
                    vendorName: vendorName,
                    usageCount: 0,
                    confidence: 0.85
                };

                // Add this alias if not already present
                if (!data.aliases.includes(normalizedAlias)) {
                    data.aliases.push(normalizedAlias);
                }

                // Also store original form if different
                if (aliasText !== normalizedAlias && !data.aliases.includes(aliasText)) {
                    data.aliases.push(aliasText);
                }

                // Update metadata
                data.vendorId = vendorId;
                data.vendorName = vendorName;
                data.usageCount = (data.usageCount || 0) + 1;
                data.confidence = Math.min((data.confidence || 0.85) + 0.02, 0.98);
                data.lastUsed = new Date().toISOString();
                data.source = options.source || 'manual';
                data.documentId = options.documentId || null;

                // Save to config
                const result = this.saveAliasRecord(key, data, existing?.id);

                // Invalidate cache
                this.invalidateCache();

                fcDebug.debug('AliasManager.addAlias', {
                    alias: normalizedAlias,
                    vendorId: vendorId,
                    vendorName: vendorName
                });

                return result;
            } catch (e) {
                log.error('AliasManager.addAlias', e.message);
                return { success: false, reason: e.message };
            }
        }

        /**
         * Find vendor by alias
         * @param {string} text - Text to search for
         * @returns {Object|null} Matched vendor or null
         */
        findVendorByAlias(text) {
            if (!text) return null;

            const normalizedText = this.normalizeAlias(text);
            const aliases = this.loadAllAliases();

            // Exact match first
            for (const alias of aliases) {
                if (alias.aliases.some(a => this.normalizeAlias(a) === normalizedText)) {
                    // Update usage stats (async, don't wait)
                    this.incrementUsage(alias.key);

                    return {
                        vendorId: alias.vendorId,
                        vendorName: alias.vendorName,
                        confidence: alias.confidence,
                        matchType: 'exact_alias'
                    };
                }
            }

            // Fuzzy match
            const bestMatch = this.fuzzyMatchAlias(normalizedText, aliases);
            if (bestMatch && bestMatch.score >= 0.85) {
                return {
                    vendorId: bestMatch.vendorId,
                    vendorName: bestMatch.vendorName,
                    confidence: bestMatch.score * bestMatch.confidence,
                    matchType: 'fuzzy_alias'
                };
            }

            return null;
        }

        /**
         * Fuzzy match text against all aliases
         */
        fuzzyMatchAlias(text, aliases) {
            let bestMatch = null;
            let bestScore = 0;

            for (const alias of aliases) {
                for (const aliasText of alias.aliases) {
                    const score = this.calculateSimilarity(text, this.normalizeAlias(aliasText));
                    if (score > bestScore) {
                        bestScore = score;
                        bestMatch = {
                            ...alias,
                            score: score,
                            matchedAlias: aliasText
                        };
                    }
                }
            }

            return bestMatch;
        }

        /**
         * Get all aliases for a vendor
         * @param {number} vendorId - Vendor ID
         * @returns {Array} List of alias texts
         */
        getVendorAliases(vendorId) {
            if (!vendorId) return [];

            const aliases = this.loadAllAliases();
            const vendorAliases = aliases.filter(a => a.vendorId === vendorId);

            const allAliasTexts = [];
            vendorAliases.forEach(a => {
                allAliasTexts.push(...a.aliases);
            });

            return [...new Set(allAliasTexts)];
        }

        /**
         * Remove an alias
         * @param {string} aliasText - Alias to remove
         * @param {number} vendorId - Vendor ID (optional, for verification)
         */
        removeAlias(aliasText, vendorId = null) {
            const normalizedAlias = this.normalizeAlias(aliasText);
            const key = `alias_${this.hashKey(normalizedAlias)}`;

            try {
                const existing = this.getAliasRecord(key);
                if (!existing) {
                    return { success: false, reason: 'Alias not found' };
                }

                // If vendorId specified, verify it matches
                if (vendorId && existing.data.vendorId !== vendorId) {
                    return { success: false, reason: 'Vendor ID mismatch' };
                }

                // Remove from aliases array
                const data = existing.data;
                data.aliases = data.aliases.filter(a =>
                    this.normalizeAlias(a) !== normalizedAlias
                );

                if (data.aliases.length === 0) {
                    // Delete the record if no aliases left
                    record.delete({
                        type: this.CONFIG_RECORD_TYPE,
                        id: existing.id
                    });
                } else {
                    // Update the record
                    this.saveAliasRecord(key, data, existing.id);
                }

                this.invalidateCache();

                return { success: true };
            } catch (e) {
                log.error('AliasManager.removeAlias', e.message);
                return { success: false, reason: e.message };
            }
        }

        /**
         * Get suggestions for vendor name (top matches from aliases)
         * @param {string} text - Text to match
         * @param {number} limit - Max suggestions
         * @returns {Array} Suggested vendors
         */
        getSuggestions(text, limit = 5) {
            if (!text) return [];

            const normalizedText = this.normalizeAlias(text);
            const aliases = this.loadAllAliases();
            const suggestions = [];

            for (const alias of aliases) {
                let bestScore = 0;
                for (const aliasText of alias.aliases) {
                    const score = this.calculateSimilarity(normalizedText, this.normalizeAlias(aliasText));
                    bestScore = Math.max(bestScore, score);
                }

                if (bestScore >= 0.5) {
                    suggestions.push({
                        vendorId: alias.vendorId,
                        vendorName: alias.vendorName,
                        score: bestScore * alias.confidence,
                        usageCount: alias.usageCount
                    });
                }
            }

            // Sort by score, then usage count
            suggestions.sort((a, b) => {
                if (Math.abs(a.score - b.score) > 0.1) {
                    return b.score - a.score;
                }
                return b.usageCount - a.usageCount;
            });

            return suggestions.slice(0, limit);
        }

        /**
         * Load all alias records
         */
        loadAllAliases() {
            // Check cache
            if (this.aliasCache && Date.now() - this.cacheTime < this.CACHE_TTL) {
                return this.aliasCache;
            }

            try {
                const sql = `
                    SELECT custrecord_flux_cfg_key, custrecord_flux_cfg_data
                    FROM ${this.CONFIG_RECORD_TYPE}
                    WHERE custrecord_flux_cfg_type = ?
                    AND custrecord_flux_cfg_active = 'T'
                `;

                const results = query.runSuiteQL({
                    query: sql,
                    params: [this.CONFIG_TYPE]
                });

                const aliases = [];
                if (results.results) {
                    results.results.forEach(row => {
                        try {
                            const data = JSON.parse(row.values[1] || '{}');
                            aliases.push({
                                key: row.values[0],
                                ...data
                            });
                        } catch (e) {
                            // Skip invalid records
                        }
                    });
                }

                // Update cache
                this.aliasCache = aliases;
                this.cacheTime = Date.now();

                fcDebug.debug('AliasManager.loadAllAliases', `Loaded ${aliases.length} alias records`);

                return aliases;
            } catch (e) {
                log.error('AliasManager.loadAllAliases', e.message);
                return [];
            }
        }

        /**
         * Get alias record by key
         */
        getAliasRecord(key) {
            try {
                const sql = `
                    SELECT id, custrecord_flux_cfg_data
                    FROM ${this.CONFIG_RECORD_TYPE}
                    WHERE custrecord_flux_cfg_type = ?
                    AND custrecord_flux_cfg_key = ?
                    AND custrecord_flux_cfg_active = 'T'
                    FETCH FIRST 1 ROWS ONLY
                `;

                const results = query.runSuiteQL({
                    query: sql,
                    params: [this.CONFIG_TYPE, key]
                });

                if (results.results && results.results.length > 0) {
                    return {
                        id: results.results[0].values[0],
                        data: JSON.parse(results.results[0].values[1] || '{}')
                    };
                }
            } catch (e) {
                fcDebug.debug('AliasManager.getAliasRecord', e.message);
            }

            return null;
        }

        /**
         * Save alias record
         */
        saveAliasRecord(key, data, existingId = null) {
            try {
                let configRecord;

                if (existingId) {
                    configRecord = record.load({
                        type: this.CONFIG_RECORD_TYPE,
                        id: existingId
                    });
                } else {
                    configRecord = record.create({
                        type: this.CONFIG_RECORD_TYPE
                    });
                    configRecord.setValue('custrecord_flux_cfg_type', this.CONFIG_TYPE);
                    configRecord.setValue('custrecord_flux_cfg_key', key);
                }

                configRecord.setValue('custrecord_flux_cfg_data', JSON.stringify(data));
                configRecord.setValue('custrecord_flux_cfg_active', true);
                configRecord.setValue('custrecord_flux_cfg_modified', new Date());
                configRecord.setValue('custrecord_flux_cfg_modified_by', runtime.getCurrentUser().id);
                configRecord.setValue('custrecord_flux_cfg_source', 'alias_manager');

                const savedId = configRecord.save();

                return {
                    success: true,
                    configId: savedId
                };
            } catch (e) {
                log.error('AliasManager.saveAliasRecord', e.message);
                return { success: false, reason: e.message };
            }
        }

        /**
         * Increment usage count for an alias (async operation)
         */
        incrementUsage(key) {
            try {
                const existing = this.getAliasRecord(key);
                if (existing) {
                    const data = existing.data;
                    data.usageCount = (data.usageCount || 0) + 1;
                    data.lastUsed = new Date().toISOString();
                    this.saveAliasRecord(key, data, existing.id);
                }
            } catch (e) {
                // Non-critical, just log
                fcDebug.debug('AliasManager.incrementUsage', e.message);
            }
        }

        /**
         * Invalidate cache
         */
        invalidateCache() {
            this.aliasCache = null;
            this.cacheTime = 0;
        }

        /**
         * Normalize alias text for consistent matching
         */
        normalizeAlias(text) {
            if (!text) return '';

            return String(text)
                .toLowerCase()
                .replace(/[.,'"!?()]/g, '')
                .replace(/\b(inc|llc|ltd|corp|co|company|incorporated|limited|corporation)\b\.?/gi, '')
                .replace(/\s+/g, ' ')
                .trim();
        }

        /**
         * Hash a key for storage (deterministic)
         */
        hashKey(text) {
            let hash = 0;
            const str = String(text).toLowerCase();
            for (let i = 0; i < str.length; i++) {
                const char = str.charCodeAt(i);
                hash = ((hash << 5) - hash) + char;
                hash = hash & hash; // Convert to 32bit integer
            }
            return Math.abs(hash).toString(36);
        }

        /**
         * Calculate string similarity (Levenshtein-based)
         */
        calculateSimilarity(str1, str2) {
            if (str1 === str2) return 1;
            if (!str1 || !str2) return 0;

            const len1 = str1.length;
            const len2 = str2.length;

            if (Math.abs(len1 - len2) > Math.max(len1, len2) * 0.5) {
                return 0;
            }

            const matrix = [];
            for (let i = 0; i <= len1; i++) {
                matrix[i] = [i];
            }
            for (let j = 0; j <= len2; j++) {
                matrix[0][j] = j;
            }

            for (let i = 1; i <= len1; i++) {
                for (let j = 1; j <= len2; j++) {
                    const cost = str1[i - 1] === str2[j - 1] ? 0 : 1;
                    matrix[i][j] = Math.min(
                        matrix[i - 1][j] + 1,
                        matrix[i][j - 1] + 1,
                        matrix[i - 1][j - 1] + cost
                    );
                }
            }

            const distance = matrix[len1][len2];
            return 1 - (distance / Math.max(len1, len2));
        }

        /**
         * Get vendor name from ID
         */
        getVendorName(vendorId) {
            try {
                const sql = `SELECT companyname FROM vendor WHERE id = ?`;
                const results = query.runSuiteQL({ query: sql, params: [vendorId] });
                if (results.results && results.results.length > 0) {
                    return results.results[0].values[0];
                }
            } catch (e) {
                fcDebug.debug('AliasManager.getVendorName', e.message);
            }
            return null;
        }

        /**
         * Get stats about the alias database
         */
        getStats() {
            const aliases = this.loadAllAliases();

            return {
                totalRecords: aliases.length,
                totalAliases: aliases.reduce((sum, a) => sum + (a.aliases?.length || 0), 0),
                uniqueVendors: new Set(aliases.map(a => a.vendorId)).size,
                totalUsage: aliases.reduce((sum, a) => sum + (a.usageCount || 0), 0)
            };
        }
    }

    return {
        AliasManager: AliasManager
    };
});
