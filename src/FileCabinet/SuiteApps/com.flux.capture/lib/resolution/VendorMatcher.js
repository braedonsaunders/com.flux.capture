/**
 * @NApiVersion 2.1
 * @NModuleScope Public
 * @module FluxCapture/Resolution/VendorMatcher
 *
 * Multi-Signal Vendor Matcher
 * Uses multiple signals (name, tax ID, email, address, aliases) for accurate vendor matching
 */

define(['N/log', 'N/query', 'N/search'], function(log, query, search) {
    'use strict';

    /**
     * Match signals and their weights
     */
    const MatchSignal = Object.freeze({
        TAX_ID: { weight: 0.40, name: 'Tax ID' },           // Highest - unique identifier
        LEARNED_ALIAS: { weight: 0.35, name: 'Learned Alias' }, // From corrections
        COMPANY_NAME: { weight: 0.30, name: 'Company Name' },
        EMAIL_DOMAIN: { weight: 0.15, name: 'Email Domain' },
        ADDRESS: { weight: 0.10, name: 'Address' },
        PHONE: { weight: 0.05, name: 'Phone' }
    });

    /**
     * Multi-Signal Vendor Matcher
     */
    class VendorMatcher {
        constructor(aliasManager) {
            this.aliasManager = aliasManager;
            this.vendorCache = null;
            this.cacheTime = 0;
            this.CACHE_TTL = 5 * 60 * 1000; // 5 minutes
            this.initializeStopWords();
        }

        /**
         * Initialize stop words and company suffixes
         */
        initializeStopWords() {
            this.STOP_WORDS = new Set([
                'the', 'a', 'an', 'and', 'or', 'of', 'for', 'to', 'in', 'at', 'by', 'with'
            ]);

            this.COMPANY_SUFFIXES = [
                'incorporated', 'inc', 'corporation', 'corp',
                'limited', 'ltd', 'llc', 'llp', 'lp',
                'company', 'co', 'enterprises', 'enterprise',
                'services', 'service', 'solutions', 'solution',
                'group', 'holdings', 'holding',
                'international', 'intl', 'worldwide', 'global',
                'industries', 'industry', 'associates', 'assoc',
                'partners', 'partnership', 'consulting',
                'technologies', 'technology', 'tech',
                'systems', 'system', 'products', 'product'
            ];

            // Common abbreviations
            this.ABBREVIATIONS = {
                'intl': 'international',
                'corp': 'corporation',
                'inc': 'incorporated',
                'ltd': 'limited',
                'co': 'company',
                'assoc': 'associates',
                'mfg': 'manufacturing',
                'svcs': 'services',
                'tech': 'technology',
                'sys': 'systems',
                'natl': 'national',
                'amer': 'american',
                'mgmt': 'management',
                'dist': 'distribution',
                'equip': 'equipment'
            };
        }

        /**
         * Match vendor using multiple signals
         * @param {Object} extractedData - Extracted document data
         * @param {string} extractedData.vendorName - Extracted vendor name
         * @param {string} extractedData.taxId - Extracted tax ID (EIN, VAT, etc.)
         * @param {string} extractedData.email - Extracted email address
         * @param {string} extractedData.address - Extracted address
         * @param {string} extractedData.phone - Extracted phone number
         * @returns {Object} Match result with vendor, confidence, signals used
         */
        match(extractedData) {
            const result = {
                vendorId: null,
                vendorName: null,
                confidence: 0,
                signals: [],
                suggestions: [],
                matchedBy: null
            };

            if (!extractedData) return result;

            // ============= DEBUG: Log incoming extracted data =============
            log.audit('DEBUG.VendorMatcher', '========== VENDOR MATCH INPUT ==========');
            log.audit('DEBUG.VendorMatcher.Input', JSON.stringify({
                vendorName: extractedData.vendorName || '(null)',
                taxId: extractedData.taxId || '(null)',
                email: extractedData.email || '(null)',
                address: extractedData.address || '(null)',
                phone: extractedData.phone || '(null)',
                allKeys: Object.keys(extractedData)
            }));

            log.debug('VendorMatcher.match', {
                vendorName: extractedData.vendorName,
                taxId: extractedData.taxId,
                email: extractedData.email
            });

            // Signal 1: Tax ID match (highest priority)
            if (extractedData.taxId) {
                log.audit('DEBUG.VendorMatcher.TaxId', `Attempting Tax ID match for: "${extractedData.taxId}"`);
                const taxMatch = this.matchByTaxId(extractedData.taxId);
                log.audit('DEBUG.VendorMatcher.TaxId.Result', taxMatch ?
                    `FOUND: id=${taxMatch.id}, name="${taxMatch.companyName}"` :
                    'NO MATCH');
                if (taxMatch) {
                    result.vendorId = taxMatch.id;
                    result.vendorName = taxMatch.companyName;
                    result.confidence = 0.98;
                    result.matchedBy = MatchSignal.TAX_ID.name;
                    result.signals.push({
                        type: 'TAX_ID',
                        value: extractedData.taxId,
                        score: 0.98
                    });
                    log.debug('VendorMatcher', `Tax ID match: ${taxMatch.companyName}`);
                    return result;
                }
            } else {
                log.audit('DEBUG.VendorMatcher.TaxId', 'No Tax ID provided in extracted data');
            }

            // Signal 2: Learned alias match
            log.audit('DEBUG.VendorMatcher.Alias', `AliasManager available: ${!!this.aliasManager}, vendorName: "${extractedData.vendorName || '(null)'}"`);
            if (this.aliasManager && extractedData.vendorName) {
                const aliasMatch = this.aliasManager.findVendorByAlias(extractedData.vendorName);
                log.audit('DEBUG.VendorMatcher.Alias.Result', aliasMatch ?
                    JSON.stringify({ vendorId: aliasMatch.vendorId, vendorName: aliasMatch.vendorName, confidence: aliasMatch.confidence, matchType: aliasMatch.matchType }) :
                    'NO ALIAS MATCH');
                if (aliasMatch && aliasMatch.confidence >= 0.85) {
                    result.vendorId = aliasMatch.vendorId;
                    result.vendorName = aliasMatch.vendorName;
                    result.confidence = aliasMatch.confidence;
                    result.matchedBy = MatchSignal.LEARNED_ALIAS.name;
                    result.signals.push({
                        type: 'LEARNED_ALIAS',
                        value: extractedData.vendorName,
                        score: aliasMatch.confidence
                    });
                    log.debug('VendorMatcher', `Alias match: ${aliasMatch.vendorName}`);
                    return result;
                }
            }

            // Signal 3: Multi-signal scoring
            log.audit('DEBUG.VendorMatcher.Search', `Searching candidates for: "${extractedData.vendorName || '(null)'}"`);
            const candidates = this.searchCandidates(extractedData);
            log.audit('DEBUG.VendorMatcher.Search.Result', `Found ${candidates.length} candidates`);

            if (candidates.length === 0) {
                log.audit('DEBUG.VendorMatcher.Result', 'NO CANDIDATES FOUND - returning unmatched');
                result.vendorName = extractedData.vendorName;
                return result;
            }

            // Log all candidates
            log.audit('DEBUG.VendorMatcher.Candidates', JSON.stringify(candidates.slice(0, 10).map(c => ({
                id: c.id,
                companyName: c.companyName,
                entityId: c.entityId,
                email: c.email || '(null)'
            }))));

            // Score candidates using all available signals
            const scoredCandidates = this.scoreCandidates(candidates, extractedData);
            scoredCandidates.sort((a, b) => b.totalScore - a.totalScore);

            // Log top scored candidates with signal breakdown
            log.audit('DEBUG.VendorMatcher.Scoring', '========== CANDIDATE SCORING ==========');
            scoredCandidates.slice(0, 5).forEach((c, idx) => {
                log.audit(`DEBUG.VendorMatcher.Score.${idx + 1}`, JSON.stringify({
                    rank: idx + 1,
                    companyName: c.companyName,
                    id: c.id,
                    totalScore: c.totalScore.toFixed(4),
                    primarySignal: c.primarySignal,
                    signals: c.signals.map(s => `${s.type}:${s.score.toFixed(3)}`)
                }));
            });

            const bestMatch = scoredCandidates[0];

            // Set result
            const passesThreshold = bestMatch.totalScore >= 0.55;
            result.vendorId = passesThreshold ? bestMatch.id : null;
            result.vendorName = bestMatch.companyName;
            result.confidence = bestMatch.totalScore;
            result.matchedBy = bestMatch.primarySignal;
            result.signals = bestMatch.signals;
            result.suggestions = scoredCandidates.slice(0, 5).map(c => ({
                id: c.id,
                companyName: c.companyName,
                entityId: c.entityId,
                score: c.totalScore
            }));

            log.audit('DEBUG.VendorMatcher.FinalResult', JSON.stringify({
                selected: passesThreshold ? 'YES' : 'NO (below 0.55 threshold)',
                vendorId: result.vendorId,
                vendorName: result.vendorName,
                confidence: result.confidence.toFixed(4),
                matchedBy: result.matchedBy,
                suggestionCount: result.suggestions.length
            }));

            log.debug('VendorMatcher.match', {
                bestMatch: bestMatch.companyName,
                score: bestMatch.totalScore.toFixed(3),
                candidateCount: scoredCandidates.length
            });

            return result;
        }

        /**
         * Match vendor by tax ID (exact match)
         */
        matchByTaxId(taxId) {
            if (!taxId) return null;

            // Normalize tax ID
            const normalizedTaxId = this.normalizeTaxId(taxId);

            try {
                // Search in vendor record fields that might contain tax ID
                // This checks: taxidnum (federal ID), and custom fields
                const sql = `
                    SELECT v.id, v.companyname, v.entityid, v.email
                    FROM vendor v
                    WHERE v.isinactive = 'F'
                    AND (
                        REPLACE(REPLACE(v.taxidnum, '-', ''), ' ', '') = ?
                        OR REPLACE(REPLACE(v.taxidnum, '-', ''), ' ', '') LIKE ?
                    )
                    FETCH FIRST 1 ROWS ONLY
                `;

                const results = query.runSuiteQL({
                    query: sql,
                    params: [normalizedTaxId, '%' + normalizedTaxId + '%']
                });

                if (results.results && results.results.length > 0) {
                    const r = results.results[0];
                    return {
                        id: r.values[0],
                        companyName: r.values[1],
                        entityId: r.values[2],
                        email: r.values[3]
                    };
                }
            } catch (e) {
                log.debug('VendorMatcher.matchByTaxId', e.message);
            }

            return null;
        }

        /**
         * Normalize tax ID for comparison
         */
        normalizeTaxId(taxId) {
            return String(taxId)
                .replace(/[\s\-\.]/g, '')
                .toUpperCase();
        }

        /**
         * Search for vendor candidates
         */
        searchCandidates(extractedData) {
            const candidates = [];
            const seenIds = new Set();

            // Search by name variations
            if (extractedData.vendorName) {
                const nameResults = this.searchByName(extractedData.vendorName);
                nameResults.forEach(v => {
                    if (!seenIds.has(v.id)) {
                        candidates.push(v);
                        seenIds.add(v.id);
                    }
                });
            }

            // Search by email domain
            if (extractedData.email) {
                const emailResults = this.searchByEmailDomain(extractedData.email);
                emailResults.forEach(v => {
                    if (!seenIds.has(v.id)) {
                        candidates.push(v);
                        seenIds.add(v.id);
                    }
                });
            }

            return candidates;
        }

        /**
         * Search vendors by name
         */
        searchByName(vendorName) {
            const normalized = this.normalizeVendorName(vendorName);
            const tokens = this.tokenizeName(normalized);
            const variations = this.generateSearchVariations(normalized, tokens);

            // DEBUG: Log name processing
            log.audit('DEBUG.VendorMatcher.SearchByName', JSON.stringify({
                original: vendorName,
                normalized: normalized,
                tokens: tokens,
                variations: variations
            }));

            if (variations.length === 0) {
                log.audit('DEBUG.VendorMatcher.SearchByName', 'No variations generated - returning empty');
                return [];
            }

            const likeConditions = variations.map(() => 'LOWER(v.companyname) LIKE ?').join(' OR ');

            // Use only core vendor fields that are guaranteed to exist
            const sql = `
                SELECT v.id, v.companyname, v.entityid, v.email, v.phone
                FROM vendor v
                WHERE v.isinactive = 'F'
                AND (${likeConditions})
                ORDER BY v.companyname
                FETCH FIRST 25 ROWS ONLY
            `;

            try {
                const params = variations.map(v => `%${v}%`);
                log.audit('DEBUG.VendorMatcher.SearchByName.Query', `Searching with ${params.length} LIKE patterns: ${params.slice(0, 5).join(', ')}${params.length > 5 ? '...' : ''}`);

                const results = query.runSuiteQL({
                    query: sql,
                    params: params
                });

                const resultCount = results.results ? results.results.length : 0;
                log.audit('DEBUG.VendorMatcher.SearchByName.Results', `Query returned ${resultCount} vendors`);

                if (!results.results) return [];

                return results.results.map(r => ({
                    id: r.values[0],
                    companyName: r.values[1],
                    entityId: r.values[2],
                    email: r.values[3],
                    address: null, // Address requires sublist join - omit for now
                    city: null,
                    phone: r.values[4]
                }));
            } catch (e) {
                log.error('VendorMatcher.searchByName', e.message);
                log.audit('DEBUG.VendorMatcher.SearchByName.Error', e.message);
                return [];
            }
        }

        /**
         * Search vendors by email domain
         */
        searchByEmailDomain(email) {
            const domain = this.extractEmailDomain(email);
            if (!domain) return [];

            // Use only core vendor fields that are guaranteed to exist
            const sql = `
                SELECT v.id, v.companyname, v.entityid, v.email, v.phone
                FROM vendor v
                WHERE v.isinactive = 'F'
                AND LOWER(v.email) LIKE ?
                FETCH FIRST 10 ROWS ONLY
            `;

            try {
                const results = query.runSuiteQL({
                    query: sql,
                    params: [`%@${domain.toLowerCase()}`]
                });

                if (!results.results) return [];

                return results.results.map(r => ({
                    id: r.values[0],
                    companyName: r.values[1],
                    entityId: r.values[2],
                    email: r.values[3],
                    address: null,
                    city: null,
                    phone: r.values[4]
                }));
            } catch (e) {
                log.debug('VendorMatcher.searchByEmailDomain', e.message);
                return [];
            }
        }

        /**
         * Score all candidates using multiple signals
         */
        scoreCandidates(candidates, extractedData) {
            return candidates.map(candidate => {
                const signals = [];
                let totalScore = 0;
                let primarySignal = null;
                let highestSignalScore = 0;

                // Score company name
                if (extractedData.vendorName) {
                    const nameScore = this.calculateNameScore(
                        extractedData.vendorName,
                        candidate.companyName
                    );
                    signals.push({ type: 'COMPANY_NAME', score: nameScore });
                    totalScore += nameScore * MatchSignal.COMPANY_NAME.weight;

                    if (nameScore > highestSignalScore) {
                        highestSignalScore = nameScore;
                        primarySignal = MatchSignal.COMPANY_NAME.name;
                    }
                }

                // Score email domain
                if (extractedData.email && candidate.email) {
                    const emailScore = this.calculateEmailScore(
                        extractedData.email,
                        candidate.email
                    );
                    if (emailScore > 0) {
                        signals.push({ type: 'EMAIL_DOMAIN', score: emailScore });
                        totalScore += emailScore * MatchSignal.EMAIL_DOMAIN.weight;

                        if (emailScore > highestSignalScore) {
                            highestSignalScore = emailScore;
                            primarySignal = MatchSignal.EMAIL_DOMAIN.name;
                        }
                    }
                }

                // Score address
                if (extractedData.address && candidate.address) {
                    const addressScore = this.calculateAddressScore(
                        extractedData.address,
                        candidate.address,
                        candidate.city
                    );
                    if (addressScore > 0) {
                        signals.push({ type: 'ADDRESS', score: addressScore });
                        totalScore += addressScore * MatchSignal.ADDRESS.weight;
                    }
                }

                // Score phone
                if (extractedData.phone && candidate.phone) {
                    const phoneScore = this.calculatePhoneScore(
                        extractedData.phone,
                        candidate.phone
                    );
                    if (phoneScore > 0) {
                        signals.push({ type: 'PHONE', score: phoneScore });
                        totalScore += phoneScore * MatchSignal.PHONE.weight;
                    }
                }

                // Normalize total score
                const maxPossibleScore = this.calculateMaxPossibleScore(extractedData, candidate);
                const normalizedScore = maxPossibleScore > 0 ? totalScore / maxPossibleScore : 0;

                return {
                    ...candidate,
                    signals,
                    totalScore: Math.min(normalizedScore, 0.98),
                    primarySignal
                };
            });
        }

        /**
         * Calculate maximum possible score based on available signals
         */
        calculateMaxPossibleScore(extractedData, candidate) {
            let maxScore = 0;

            if (extractedData.vendorName) {
                maxScore += MatchSignal.COMPANY_NAME.weight;
            }
            if (extractedData.email && candidate.email) {
                maxScore += MatchSignal.EMAIL_DOMAIN.weight;
            }
            if (extractedData.address && candidate.address) {
                maxScore += MatchSignal.ADDRESS.weight;
            }
            if (extractedData.phone && candidate.phone) {
                maxScore += MatchSignal.PHONE.weight;
            }

            return maxScore || MatchSignal.COMPANY_NAME.weight; // At minimum, name match
        }

        /**
         * Calculate name match score
         */
        calculateNameScore(searchName, candidateName) {
            const normalizedSearch = this.normalizeVendorName(searchName);
            const normalizedCandidate = this.normalizeVendorName(candidateName);

            // Exact match
            if (normalizedSearch === normalizedCandidate) {
                log.audit('DEBUG.VendorMatcher.NameScore', `EXACT MATCH: "${normalizedSearch}" === "${normalizedCandidate}"`);
                return 1.0;
            }

            // Token-based matching
            const searchTokens = this.tokenizeName(normalizedSearch);
            const candidateTokens = this.tokenizeName(normalizedCandidate);

            const tokenScore = this.calculateTokenScore(searchTokens, candidateTokens);
            const levenshteinScore = this.calculateLevenshteinScore(normalizedSearch, normalizedCandidate);
            const prefixScore = this.calculatePrefixScore(normalizedSearch, normalizedCandidate);

            // Weighted combination
            const finalScore = (tokenScore * 0.45) + (levenshteinScore * 0.35) + (prefixScore * 0.20);

            // DEBUG: Log detailed scoring (only for top candidates to reduce log volume)
            log.audit('DEBUG.VendorMatcher.NameScore.Detail', JSON.stringify({
                search: normalizedSearch,
                candidate: normalizedCandidate,
                searchTokens: searchTokens,
                candidateTokens: candidateTokens,
                tokenScore: tokenScore.toFixed(4),
                levenshteinScore: levenshteinScore.toFixed(4),
                prefixScore: prefixScore.toFixed(4),
                finalScore: finalScore.toFixed(4)
            }));

            return finalScore;
        }

        /**
         * Calculate token-based score
         */
        calculateTokenScore(tokens1, tokens2) {
            if (tokens1.length === 0 || tokens2.length === 0) return 0;

            let matches = 0;
            const used = new Set();

            for (const t1 of tokens1) {
                // Try exact match first
                const exactIdx = tokens2.findIndex((t2, i) => !used.has(i) && t1 === t2);
                if (exactIdx >= 0) {
                    matches += 1;
                    used.add(exactIdx);
                    continue;
                }

                // Try fuzzy match
                for (let i = 0; i < tokens2.length; i++) {
                    if (used.has(i)) continue;

                    const t2 = tokens2[i];
                    const similarity = this.calculateLevenshteinScore(t1, t2);

                    if (similarity >= 0.85) {
                        matches += similarity;
                        used.add(i);
                        break;
                    }

                    // Check abbreviation expansion
                    const expanded1 = this.ABBREVIATIONS[t1] || t1;
                    const expanded2 = this.ABBREVIATIONS[t2] || t2;
                    if (expanded1 === expanded2) {
                        matches += 0.9;
                        used.add(i);
                        break;
                    }
                }
            }

            return matches / Math.max(tokens1.length, tokens2.length);
        }

        /**
         * Calculate Levenshtein similarity score
         */
        calculateLevenshteinScore(str1, str2) {
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
         * Calculate prefix match score
         */
        calculatePrefixScore(str1, str2) {
            if (!str1 || !str2) return 0;

            if (str1.startsWith(str2) || str2.startsWith(str1)) {
                const shorter = Math.min(str1.length, str2.length);
                const longer = Math.max(str1.length, str2.length);
                return shorter / longer;
            }

            return 0;
        }

        /**
         * Calculate email domain match score
         */
        calculateEmailScore(email1, email2) {
            const domain1 = this.extractEmailDomain(email1);
            const domain2 = this.extractEmailDomain(email2);

            if (!domain1 || !domain2) return 0;

            // Exact domain match
            if (domain1.toLowerCase() === domain2.toLowerCase()) {
                return 1.0;
            }

            // Root domain match (sub.company.com vs company.com)
            const root1 = this.extractRootDomain(domain1);
            const root2 = this.extractRootDomain(domain2);

            if (root1 && root2 && root1.toLowerCase() === root2.toLowerCase()) {
                return 0.8;
            }

            return 0;
        }

        /**
         * Calculate address similarity score
         */
        calculateAddressScore(address1, address2, city) {
            if (!address1 || !address2) return 0;

            const normalized1 = this.normalizeAddress(address1);
            const normalized2 = this.normalizeAddress(address2 + ' ' + (city || ''));

            // Simple token overlap
            const tokens1 = normalized1.split(/\s+/).filter(t => t.length > 2);
            const tokens2 = normalized2.split(/\s+/).filter(t => t.length > 2);

            const matches = tokens1.filter(t1 =>
                tokens2.some(t2 => t1 === t2)
            ).length;

            return matches / Math.max(tokens1.length, 1);
        }

        /**
         * Calculate phone number score
         */
        calculatePhoneScore(phone1, phone2) {
            const digits1 = this.extractPhoneDigits(phone1);
            const digits2 = this.extractPhoneDigits(phone2);

            if (digits1.length < 7 || digits2.length < 7) return 0;

            // Check if one contains the other (handles country code differences)
            if (digits1.includes(digits2) || digits2.includes(digits1)) {
                return 0.9;
            }

            // Exact match
            if (digits1 === digits2) {
                return 1.0;
            }

            // Last 10 digits match (US format)
            const last10_1 = digits1.slice(-10);
            const last10_2 = digits2.slice(-10);
            if (last10_1.length === 10 && last10_1 === last10_2) {
                return 0.95;
            }

            return 0;
        }

        /**
         * Normalize vendor name
         */
        normalizeVendorName(name) {
            if (!name) return '';

            return String(name)
                .toLowerCase()
                .replace(/[.,'"!?()]/g, '')
                .replace(new RegExp(`\\b(${this.COMPANY_SUFFIXES.join('|')})\\.?\\b`, 'gi'), '')
                .replace(/\s+/g, ' ')
                .trim();
        }

        /**
         * Tokenize vendor name
         */
        tokenizeName(name) {
            if (!name) return [];

            return name
                .toLowerCase()
                .split(/\s+/)
                .filter(w => w.length > 1 && !this.STOP_WORDS.has(w));
        }

        /**
         * Generate search variations
         */
        generateSearchVariations(normalizedName, tokens) {
            const variations = new Set([normalizedName]);

            // Add significant tokens
            tokens.forEach(token => {
                if (token.length >= 4) {
                    variations.add(token);

                    // Handle plurals
                    if (token.endsWith('s') && token.length > 4) {
                        variations.add(token.slice(0, -1));
                    } else {
                        variations.add(token + 's');
                    }
                }
            });

            // First 2-3 tokens combined
            if (tokens.length >= 2) {
                variations.add(tokens.slice(0, 2).join(' '));
            }
            if (tokens.length >= 3) {
                variations.add(tokens.slice(0, 3).join(' '));
            }

            return Array.from(variations);
        }

        /**
         * Extract email domain
         */
        extractEmailDomain(email) {
            if (!email) return null;
            const match = String(email).match(/@([^@\s]+)/);
            return match ? match[1] : null;
        }

        /**
         * Extract root domain (company.com from sub.company.com)
         */
        extractRootDomain(domain) {
            if (!domain) return null;
            const parts = domain.split('.');
            if (parts.length >= 2) {
                return parts.slice(-2).join('.');
            }
            return domain;
        }

        /**
         * Normalize address for comparison
         */
        normalizeAddress(address) {
            if (!address) return '';

            return String(address)
                .toLowerCase()
                .replace(/\bstreet\b/g, 'st')
                .replace(/\bavenue\b/g, 'ave')
                .replace(/\broad\b/g, 'rd')
                .replace(/\bdrive\b/g, 'dr')
                .replace(/\bsuite\b/g, 'ste')
                .replace(/\bapartment\b/g, 'apt')
                .replace(/\bbuilding\b/g, 'bldg')
                .replace(/\bfloor\b/g, 'fl')
                .replace(/[.,#]/g, '')
                .replace(/\s+/g, ' ')
                .trim();
        }

        /**
         * Extract digits from phone number
         */
        extractPhoneDigits(phone) {
            if (!phone) return '';
            return String(phone).replace(/\D/g, '');
        }

        /**
         * Get match signals enum
         */
        static get MatchSignal() {
            return MatchSignal;
        }
    }

    return {
        VendorMatcher: VendorMatcher,
        MatchSignal: MatchSignal
    };
});
