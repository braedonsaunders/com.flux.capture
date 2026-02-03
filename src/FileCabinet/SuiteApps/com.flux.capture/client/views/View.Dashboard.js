/**
 * Flux Capture - Dashboard View (Deprecated)
 * Redirects to Ingest view - Mission Control has been removed
 */
(function() {
    'use strict';

    // Dashboard route redirects to Ingest
    Router.register('dashboard',
        function() {
            Router.navigate('ingest');
        },
        function() {}
    );

})();
