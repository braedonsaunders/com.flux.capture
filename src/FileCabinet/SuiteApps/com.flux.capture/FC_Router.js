/**
 * @NApiVersion 2.1
 * @NScriptType Restlet
 * @NModuleScope SameAccount
 *
 * Flux Capture - DIAGNOSTIC VERSION
 */

define(['N/log'], function(log) {

    var API_VERSION = '2.0.0';

    function get(context) {
        log.debug('FC_Router GET START', JSON.stringify(context));

        try {
            var action = context.action || 'health';
            log.debug('FC_Router action', action);

            var response = null;

            if (action === 'health') {
                response = {
                    success: true,
                    version: API_VERSION,
                    message: 'Diagnostic test - healthy'
                };
            } else if (action === 'stats') {
                response = {
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
            } else if (action === 'anomalies') {
                response = {
                    success: true,
                    version: API_VERSION,
                    data: []
                };
            } else {
                response = {
                    success: false,
                    error: {
                        code: 'UNKNOWN_ACTION',
                        message: 'Unknown action: ' + action
                    }
                };
            }

            log.debug('FC_Router RESPONSE', JSON.stringify(response));
            // Return as string - NetSuite will set Content-Type to text/plain
            return JSON.stringify(response);

        } catch (e) {
            log.error('FC_Router CATCH ERROR', e.message + ' | ' + e.stack);
            return JSON.stringify({
                success: false,
                error: { code: 'CAUGHT_ERROR', message: e.message }
            });
        }
    }

    function post(context) {
        log.debug('FC_Router POST', JSON.stringify(context));
        return JSON.stringify({
            success: true,
            version: API_VERSION,
            message: 'POST received'
        });
    }

    function put(context) {
        log.debug('FC_Router PUT', JSON.stringify(context));
        return JSON.stringify({
            success: true,
            version: API_VERSION,
            message: 'PUT received'
        });
    }

    function doDelete(context) {
        log.debug('FC_Router DELETE', JSON.stringify(context));
        return JSON.stringify({
            success: true,
            version: API_VERSION,
            message: 'DELETE received'
        });
    }

    return {
        get: get,
        post: post,
        put: put,
        'delete': doDelete
    };
});
