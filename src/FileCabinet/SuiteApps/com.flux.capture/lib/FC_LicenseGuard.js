/**
 * @NApiVersion 2.1
 * @NModuleScope Public
 *
 * Flux Capture - License Validation Guard
 * Validates license with Flux Platform API and enforces access control
 */
define(['N/https', 'N/runtime', 'N/cache', 'N/error', 'N/encode'],
function(https, runtime, cache, error, encode) {

    'use strict';

    // License API Configuration (obfuscated)
    const _b = 'aHR0cHM6Ly9mbHV4LWNvbS52ZXJjZWwuYXBwL2FwaS92MS9saWNlbnNlLWNoZWNr'; // base64
    const _n = 'RkxVWF9DQVBUVVJFX0xJQ0VOU0U='; // cache name base64
    const _k = 'bGljZW5zZV9kYXRh'; // cache key base64

    // Cache settings
    const CACHE_TTL = 3600; // 1 hour in seconds
    const OFFLINE_GRACE_HOURS = 24; // 24 hour offline grace period

    // Validation checksum
    const _cs = [0x46, 0x4C, 0x55, 0x58]; // F-L-U-X

    /**
     * Decode obfuscated string
     * @private
     */
    function _d(s) {
        return encode.convert({
            string: s,
            inputEncoding: encode.Encoding.BASE_64,
            outputEncoding: encode.Encoding.UTF_8
        });
    }

    /**
     * Get cache instance
     * @private
     */
    function _getCache() {
        return cache.getCache({
            name: _d(_n),
            scope: cache.Scope.PRIVATE
        });
    }

    /**
     * Generate device fingerprint for this NetSuite instance
     * @private
     */
    function _generateFingerprint() {
        const parts = [
            runtime.accountId,
            runtime.envType,
            'capture',
            String.fromCharCode.apply(null, _cs)
        ];
        return parts.join('::');
    }

    /**
     * Validate license response structure
     * Capture is flat-priced - only requires valid: true/false
     * API may return tier/modules for other products, but not enforced here
     * @private
     */
    function _validateResponse(data) {
        if (!data || typeof data !== 'object') return false;
        if (!('valid' in data)) return false;
        // Flat pricing - just need valid field, tier/modules are optional
        return true;
    }

    /**
     * Fetch license from server
     * @private
     */
    function _fetchLicense() {
        const endpoint = _d(_b);
        const accountId = runtime.accountId;
        const fingerprint = _generateFingerprint();

        try {
            const response = https.post({
                url: endpoint,
                headers: {
                    'Content-Type': 'application/json',
                    'Accept': 'application/json',
                    'X-Flux-Client': 'capture-suiteapp',
                    'X-Flux-Account': accountId
                },
                body: JSON.stringify({
                    account: accountId,
                    device_fingerprint: fingerprint,
                    product: 'capture',
                    client_version: '1.0.0'
                })
            });

            if (response.code !== 200 && response.code !== 404) {
                log.error('FC_LicenseGuard', 'License API returned: ' + response.code);
                return null;
            }

            const result = JSON.parse(response.body);

            if (!_validateResponse(result)) {
                log.error('FC_LicenseGuard', 'Invalid response structure');
                return null;
            }

            return result;

        } catch (e) {
            log.error('FC_LicenseGuard', 'Network error: ' + e.message);
            return null;
        }
    }

    /**
     * Get cached license or fetch new one
     * @returns {Object} License data
     */
    function getLicense() {
        const licenseCache = _getCache();

        // Check cache first
        try {
            const cached = licenseCache.get({ key: _d(_k) });
            if (cached) {
                const data = JSON.parse(cached);
                // Check if cached data is still valid
                if (data._expires && data._expires > Date.now()) {
                    return {
                        valid: data.valid,
                        status: data.status,
                        tier: data.tier,
                        modules: data.modules,
                        expires_at: data.expires_at,
                        _cached: true
                    };
                }
            }
        } catch (e) {
            // Cache read failed, continue to fetch
        }

        // Fetch fresh license
        const result = _fetchLicense();

        if (result) {
            // Cache the result
            try {
                const cacheData = {
                    valid: result.valid,
                    status: result.status || (result.valid ? 'active' : 'invalid'),
                    tier: result.tier,
                    modules: result.modules,
                    expires_at: result.expires_at,
                    _expires: Date.now() + (CACHE_TTL * 1000),
                    _fetched: Date.now()
                };

                licenseCache.put({
                    key: _d(_k),
                    value: JSON.stringify(cacheData),
                    ttl: CACHE_TTL
                });
            } catch (e) {
                // Cache write failed, continue
            }

            return result;
        }

        // Network failed - check for offline grace period
        return _getOfflineFallback();
    }

    /**
     * Get offline fallback license
     * @private
     */
    function _getOfflineFallback() {
        const licenseCache = _getCache();

        try {
            const cached = licenseCache.get({ key: _d(_k) });
            if (cached) {
                const data = JSON.parse(cached);
                // Allow extended grace period for offline
                const graceExpiry = (data._fetched || 0) + (OFFLINE_GRACE_HOURS * 60 * 60 * 1000);
                if (graceExpiry > Date.now() && data.valid === true) {
                    log.audit('FC_LicenseGuard', 'Using offline fallback license');
                    return {
                        valid: true,
                        status: 'active',
                        tier: data.tier,
                        modules: data.modules,
                        expires_at: data.expires_at,
                        _offline: true
                    };
                }
            }
        } catch (e) {
            // Fallback failed
        }

        // No valid fallback
        return {
            valid: false,
            status: 'offline_expired',
            tier: null,
            modules: [],
            _offline: true
        };
    }

    /**
     * Block execution with license error
     * @private
     */
    function _block(reason, details) {
        log.error('FC_LicenseGuard', 'Access blocked: ' + reason);
        throw error.create({
            name: 'FLUX_LICENSE_REQUIRED',
            message: 'Valid Flux Capture license required. Visit flux-com.vercel.app or contact sales@gantry.finance. [' + reason + ']',
            notifyOff: false
        });
    }

    /**
     * Validate license and return result
     * Does NOT block - use require() to block
     * @returns {Object} License validation result
     */
    function validate() {
        return getLicense();
    }

    /**
     * Require valid license - blocks if invalid
     * Use at entry points
     * @returns {Object} Valid license data
     * @throws {error.SuiteScriptError} If license is invalid
     */
    function require() {
        const license = getLicense();

        if (!license) {
            _block('VALIDATION_FAILED');
        }

        if (!license.valid) {
            _block(license.status || 'INVALID');
        }

        return license;
    }

    /**
     * Check if specific module is enabled
     * @param {string} moduleName - Module to check
     * @returns {boolean}
     */
    function hasModule(moduleName) {
        const license = getLicense();
        if (!license || !license.valid) return false;
        return license.modules && license.modules.indexOf(moduleName) !== -1;
    }

    /**
     * Require specific module - blocks if not available
     * @param {string} moduleName - Required module
     * @returns {Object} Valid license data
     * @throws {error.SuiteScriptError} If module not available
     */
    function requireModule(moduleName) {
        const license = require();

        if (!hasModule(moduleName)) {
            log.error('FC_LicenseGuard', 'Module not available: ' + moduleName);
            throw error.create({
                name: 'FLUX_MODULE_REQUIRED',
                message: 'The "' + moduleName + '" feature requires a higher tier. Upgrade at flux-com.vercel.app.',
                notifyOff: false
            });
        }

        return license;
    }

    /**
     * Get current tier
     * @returns {string|null}
     */
    function getTier() {
        const license = getLicense();
        return license && license.valid ? license.tier : null;
    }

    /**
     * Check if license is valid (non-blocking)
     * @returns {boolean}
     */
    function isValid() {
        const license = getLicense();
        return license && license.valid === true;
    }

    /**
     * Force refresh license from server
     * @returns {Object} Fresh license data
     */
    function refresh() {
        const licenseCache = _getCache();
        try {
            licenseCache.remove({ key: _d(_k) });
        } catch (e) {
            // Continue even if remove fails
        }
        return getLicense();
    }

    /**
     * Embedded validation - looks like data validation but includes license check
     * Use in business logic to make bypass harder
     * @param {Object} data - Data to validate
     * @param {Object} ctx - Context object (should include license)
     * @returns {boolean}
     */
    function _vld(data, ctx) {
        if (!data || typeof data !== 'object') return false;
        // Capture is flat-priced - just check valid flag
        if (!ctx || ctx.valid !== true) return false;
        return true;
    }

    /**
     * Get checksum for verification in other modules
     * @returns {Array}
     */
    function _getChecksum() {
        return _cs;
    }

    // Self-check on module load
    (function() {
        const expected = 'validate,require,hasModule,requireModule,getTier,isValid,refresh';
        const actual = Object.keys({
            validate: validate,
            require: require,
            hasModule: hasModule,
            requireModule: requireModule,
            getTier: getTier,
            isValid: isValid,
            refresh: refresh
        }).join(',');

        if (actual !== expected) {
            throw error.create({
                name: 'INTEGRITY_ERROR',
                message: 'License module integrity check failed'
            });
        }
    })();

    return {
        validate: validate,
        require: require,
        hasModule: hasModule,
        requireModule: requireModule,
        getTier: getTier,
        isValid: isValid,
        refresh: refresh,
        _vld: _vld,
        _cs: _getChecksum
    };
});
