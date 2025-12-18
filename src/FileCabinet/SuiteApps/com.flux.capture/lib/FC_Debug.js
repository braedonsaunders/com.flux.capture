/**
 * @NApiVersion 2.1
 * @NModuleScope Public
 * @module FC_Debug
 * @description Debug logging utility that gates all debug output behind a flux config setting.
 *              Automatically creates the config record if it doesn't exist.
 */
define(['N/log', 'N/record', 'N/query', 'N/runtime', 'N/cache'],
function(log, record, query, runtime, cache) {
    'use strict';

    const CONFIG_RECORD_TYPE = 'customrecord_flux_config';
    const CONFIG_TYPE = 'settings';
    const CONFIG_KEY = 'debug_mode';
    const CACHE_NAME = 'FLUX_DEBUG_CACHE';
    const CACHE_KEY = 'is_debug_mode';
    const CACHE_TTL = 300; // 5 minutes cache

    // In-memory cache for the current script execution
    let _debugModeCache = null;
    let _cacheTimestamp = null;
    const MEMORY_CACHE_TTL = 60000; // 1 minute in milliseconds

    /**
     * Gets or creates the debug mode configuration record.
     * Creates the record with default value of false if it doesn't exist.
     * @returns {boolean} Whether debug mode is enabled
     */
    function getOrCreateDebugConfig() {
        try {
            // Check in-memory cache first (fastest)
            const now = Date.now();
            if (_debugModeCache !== null && _cacheTimestamp && (now - _cacheTimestamp) < MEMORY_CACHE_TTL) {
                return _debugModeCache;
            }

            // Try to get from NetSuite cache
            try {
                var appCache = cache.getCache({ name: CACHE_NAME, scope: cache.Scope.PUBLIC });
                var cachedValue = appCache.get({ key: CACHE_KEY });
                if (cachedValue !== null) {
                    _debugModeCache = cachedValue === 'true';
                    _cacheTimestamp = now;
                    return _debugModeCache;
                }
            } catch (cacheError) {
                // Cache not available, continue to database lookup
            }

            // Query the database for the debug mode setting
            var sql = "SELECT id, custrecord_flux_cfg_data FROM " + CONFIG_RECORD_TYPE +
                " WHERE custrecord_flux_cfg_type = ? AND custrecord_flux_cfg_key = ? AND custrecord_flux_cfg_active = 'T'";

            var results = query.runSuiteQL({
                query: sql,
                params: [CONFIG_TYPE, CONFIG_KEY]
            }).asMappedResults();

            var isDebugMode = false;

            if (results.length === 0) {
                // Create the config record with default value (debug mode OFF)
                isDebugMode = createDebugConfigRecord(false);
            } else {
                // Parse the existing config
                try {
                    var configData = JSON.parse(results[0].custrecord_flux_cfg_data || '{}');
                    isDebugMode = configData.enabled === true;
                } catch (parseError) {
                    isDebugMode = false;
                }
            }

            // Update caches
            _debugModeCache = isDebugMode;
            _cacheTimestamp = now;

            try {
                var appCache = cache.getCache({ name: CACHE_NAME, scope: cache.Scope.PUBLIC });
                appCache.put({
                    key: CACHE_KEY,
                    value: String(isDebugMode),
                    ttl: CACHE_TTL
                });
            } catch (cacheError) {
                // Cache not available, continue without caching
            }

            return isDebugMode;

        } catch (e) {
            // If anything fails, default to not logging debug messages
            // Use standard log.error for critical utility errors
            log.error('FC_Debug.getOrCreateDebugConfig', 'Error checking debug mode: ' + e.message);
            return false;
        }
    }

    /**
     * Creates the debug mode configuration record
     * @param {boolean} enabled - Initial enabled state
     * @returns {boolean} The enabled state
     */
    function createDebugConfigRecord(enabled) {
        try {
            var configData = {
                enabled: enabled,
                description: 'Enable debug logging for Flux Capture',
                createdDate: new Date().toISOString()
            };

            var configRec = record.create({
                type: CONFIG_RECORD_TYPE,
                isDynamic: false
            });

            configRec.setValue({ fieldId: 'name', value: 'Debug Mode Settings' });
            configRec.setValue({ fieldId: 'custrecord_flux_cfg_type', value: CONFIG_TYPE });
            configRec.setValue({ fieldId: 'custrecord_flux_cfg_key', value: CONFIG_KEY });
            configRec.setValue({ fieldId: 'custrecord_flux_cfg_data', value: JSON.stringify(configData) });
            configRec.setValue({ fieldId: 'custrecord_flux_cfg_active', value: true });
            configRec.setValue({ fieldId: 'custrecord_flux_cfg_version', value: 1 });
            configRec.setValue({ fieldId: 'custrecord_flux_cfg_modified', value: new Date() });

            var userId = runtime.getCurrentUser().id;
            if (userId) {
                configRec.setValue({ fieldId: 'custrecord_flux_cfg_modified_by', value: userId });
            }

            configRec.setValue({ fieldId: 'custrecord_flux_cfg_source', value: 'auto_created' });

            configRec.save();

            log.audit('FC_Debug', 'Created debug mode config record (enabled: ' + enabled + ')');

            return enabled;
        } catch (e) {
            log.error('FC_Debug.createDebugConfigRecord', 'Error creating debug config: ' + e.message);
            return false;
        }
    }

    /**
     * Sets the debug mode enabled state
     * @param {boolean} enabled - Whether debug mode should be enabled
     * @returns {boolean} Success status
     */
    function setDebugMode(enabled) {
        try {
            var sql = "SELECT id FROM " + CONFIG_RECORD_TYPE +
                " WHERE custrecord_flux_cfg_type = ? AND custrecord_flux_cfg_key = ? AND custrecord_flux_cfg_active = 'T'";

            var results = query.runSuiteQL({
                query: sql,
                params: [CONFIG_TYPE, CONFIG_KEY]
            }).asMappedResults();

            var configData = {
                enabled: enabled,
                description: 'Enable debug logging for Flux Capture',
                modifiedDate: new Date().toISOString()
            };

            if (results.length === 0) {
                createDebugConfigRecord(enabled);
            } else {
                var configRec = record.load({
                    type: CONFIG_RECORD_TYPE,
                    id: results[0].id,
                    isDynamic: false
                });

                configRec.setValue({ fieldId: 'custrecord_flux_cfg_data', value: JSON.stringify(configData) });
                configRec.setValue({ fieldId: 'custrecord_flux_cfg_modified', value: new Date() });

                var userId = runtime.getCurrentUser().id;
                if (userId) {
                    configRec.setValue({ fieldId: 'custrecord_flux_cfg_modified_by', value: userId });
                }

                configRec.save();
            }

            // Clear caches
            _debugModeCache = enabled;
            _cacheTimestamp = Date.now();

            try {
                var appCache = cache.getCache({ name: CACHE_NAME, scope: cache.Scope.PUBLIC });
                appCache.put({
                    key: CACHE_KEY,
                    value: String(enabled),
                    ttl: CACHE_TTL
                });
            } catch (cacheError) {
                // Cache not available
            }

            log.audit('FC_Debug', 'Debug mode set to: ' + enabled);
            return true;

        } catch (e) {
            log.error('FC_Debug.setDebugMode', 'Error setting debug mode: ' + e.message);
            return false;
        }
    }

    /**
     * Clears the debug mode cache to force a fresh check
     */
    function clearCache() {
        _debugModeCache = null;
        _cacheTimestamp = null;

        try {
            var appCache = cache.getCache({ name: CACHE_NAME, scope: cache.Scope.PUBLIC });
            appCache.remove({ key: CACHE_KEY });
        } catch (cacheError) {
            // Cache not available
        }
    }

    /**
     * Checks if debug mode is currently enabled
     * @returns {boolean} Whether debug mode is enabled
     */
    function isDebugMode() {
        return getOrCreateDebugConfig();
    }

    /**
     * Logs a debug message if debug mode is enabled.
     * Equivalent to log.debug() but gated by debug mode setting.
     * @param {string} title - Log title
     * @param {string|Object} details - Log details
     */
    function debug(title, details) {
        if (getOrCreateDebugConfig()) {
            log.debug(title, details);
        }
    }

    /**
     * Logs an audit message. These are always logged regardless of debug mode.
     * @param {string} title - Log title
     * @param {string|Object} details - Log details
     */
    function audit(title, details) {
        log.audit(title, details);
    }

    /**
     * Logs an error message. These are always logged regardless of debug mode.
     * @param {string} title - Log title
     * @param {string|Object} details - Log details
     */
    function error(title, details) {
        log.error(title, details);
    }

    /**
     * Logs an emergency message. These are always logged regardless of debug mode.
     * @param {string} title - Log title
     * @param {string|Object} details - Log details
     */
    function emergency(title, details) {
        log.emergency(title, details);
    }

    /**
     * Logs a debug audit message if debug mode is enabled.
     * Uses audit level for visibility but only when debug mode is on.
     * @param {string} title - Log title
     * @param {string|Object} details - Log details
     */
    function debugAudit(title, details) {
        if (getOrCreateDebugConfig()) {
            log.audit(title, details);
        }
    }

    return {
        debug: debug,
        debugAudit: debugAudit,
        audit: audit,
        error: error,
        emergency: emergency,
        isDebugMode: isDebugMode,
        setDebugMode: setDebugMode,
        clearCache: clearCache
    };
});
