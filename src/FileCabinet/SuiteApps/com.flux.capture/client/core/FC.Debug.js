/**
 * Flux Capture - Debug Utility
 * Gates all console.log output behind debug mode configuration
 */
(function() {
    'use strict';

    /**
     * Check if debug mode is enabled
     * @returns {boolean}
     */
    function isDebugMode() {
        return !!(window.FC_CONFIG && window.FC_CONFIG.isDebugMode);
    }

    /**
     * Debug log - only outputs if debug mode is enabled
     * @param {...*} args - Arguments to log
     */
    function debug() {
        if (isDebugMode()) {
            console.log.apply(console, arguments);
        }
    }

    /**
     * Debug warn - only outputs if debug mode is enabled
     * @param {...*} args - Arguments to log
     */
    function debugWarn() {
        if (isDebugMode()) {
            console.warn.apply(console, arguments);
        }
    }

    /**
     * Debug info - only outputs if debug mode is enabled
     * @param {...*} args - Arguments to log
     */
    function debugInfo() {
        if (isDebugMode()) {
            console.info.apply(console, arguments);
        }
    }

    /**
     * Error log - always outputs regardless of debug mode
     * @param {...*} args - Arguments to log
     */
    function error() {
        console.error.apply(console, arguments);
    }

    /**
     * Warn log - always outputs regardless of debug mode
     * Used for important warnings that should always be visible
     * @param {...*} args - Arguments to log
     */
    function warn() {
        console.warn.apply(console, arguments);
    }

    // Debug utility object
    var Debug = {
        isDebugMode: isDebugMode,
        log: debug,
        debug: debug,
        warn: debugWarn,
        info: debugInfo,
        error: error,
        alwaysWarn: warn
    };

    // Expose to global scope
    window.FCDebug = Debug;

})();
