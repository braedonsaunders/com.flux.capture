/**
 * @NApiVersion 2.1
 * @NScriptType Restlet
 * @NModuleScope SameAccount
 *
 * Flux Capture - MINIMAL TEST VERSION
 */

define(['N/log'], function(log) {

    var API_VERSION = '2.0.0';

    function get(context) {
        log.debug('FC_Router GET', JSON.stringify(context));

        var action = context.action || 'health';

        if (action === 'health') {
            return {
                success: true,
                version: API_VERSION,
                message: 'Minimal test - healthy'
            };
        }

        if (action === 'stats') {
            return {
                success: true,
                version: API_VERSION,
                data: {
                    summary: {
                        totalProcessed: 0,
                        completed: 0,
                        autoProcessed: 0,
                        pendingReview: 0,
                        rejected: 0,
                        errors: 0,
                        avgConfidence: 0,
                        totalValue: 0
                    },
                    typeBreakdown: {},
                    trend: [],
                    autoProcessRate: 0
                }
            };
        }

        if (action === 'anomalies') {
            return {
                success: true,
                version: API_VERSION,
                data: []
            };
        }

        return {
            success: false,
            error: {
                code: 'UNKNOWN_ACTION',
                message: 'Unknown action: ' + action
            }
        };
    }

    function post(context) {
        log.debug('FC_Router POST', JSON.stringify(context));
        return {
            success: true,
            version: API_VERSION,
            message: 'POST received'
        };
    }

    function put(context) {
        log.debug('FC_Router PUT', JSON.stringify(context));
        return {
            success: true,
            version: API_VERSION,
            message: 'PUT received'
        };
    }

    function doDelete(context) {
        log.debug('FC_Router DELETE', JSON.stringify(context));
        return {
            success: true,
            version: API_VERSION,
            message: 'DELETE received'
        };
    }

    return {
        get: get,
        post: post,
        put: put,
        'delete': doDelete
    };
});
