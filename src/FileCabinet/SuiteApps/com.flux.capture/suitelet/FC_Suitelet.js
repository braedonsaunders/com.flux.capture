/**
 * @NApiVersion 2.1
 * @NScriptType Suitelet
 * @NModuleScope SameAccount
 *
 * Flux Capture - Main Suitelet
 * Redirects to content mode (fc_mode=content) to serve the SPA directly
 */
define(['N/file', 'N/runtime', 'N/url', 'N/search'], function(file, runtime, url, search) {

    'use strict';

    var CONFIG = {
        basePath: '/SuiteApps/com.flux.capture'
    };

    // Maps keys to file paths for URL resolution
    var FILE_MANIFEST = {
        'html_app': 'App/app_index.html',
        'css_base': 'App/css/base.css',
        'css_components': 'App/css/components.css',
        'js_core': 'client/core/FC.Core.js',
        'js_main': 'client/FC.Main.js',
        'js_view_dashboard': 'client/views/View.Dashboard.js',
        'js_view_upload': 'client/views/View.Upload.js',
        'js_view_queue': 'client/views/View.Queue.js',
        'js_view_review': 'client/views/View.Review.js',
        'js_view_batch': 'client/views/View.Batch.js',
        'js_view_settings': 'client/views/View.Settings.js'
    };

    function onRequest(context) {
        if (context.request.method !== 'GET') {
            context.response.write('Method not allowed');
            return;
        }

        try {
            // Check if this is the inner frame request
            var isInnerFrame = context.request.parameters.fc_mode === 'content';

            if (isInnerFrame) {
                serveAppContent(context);
            } else {
                serveWrapper(context);
            }
        } catch (error) {
            log.error('Suitelet Error', { message: error.message, stack: error.stack });
            context.response.write('<h1>Error</h1><pre>' + error.message + '</pre>');
        }
    }

    /**
     * Mode 1: Redirect to content mode
     * NetSuite's X-Frame-Options headers prevent iframe embedding,
     * so we redirect directly to the content URL instead
     */
    function serveWrapper(context) {
        var currentScript = runtime.getCurrentScript();

        // Redirect to content URL to avoid X-Frame-Options issues
        context.response.sendRedirect({
            type: 'SUITELET',
            identifier: currentScript.id,
            id: currentScript.deploymentId,
            parameters: { fc_mode: 'content' }
        });
    }

    /**
     * Mode 2: Serve raw HTML app content
     */
    function serveAppContent(context) {
        // 1. Resolve all file URLs
        var fileUrls = resolveFileUrls();

        // 2. Get Router URL
        var routerUrl = url.resolveScript({
            scriptId: 'customscript_fc_router',
            deploymentId: 'customdeploy_fc_router'
        });

        // 3. Load HTML template
        var htmlPath = CONFIG.basePath + '/App/app_index.html';
        var htmlFile = file.load({ id: htmlPath });
        var htmlContent = htmlFile.getContents();

        // 4. Replace all placeholders
        htmlContent = htmlContent.replace(/\{\{CSS_BASE_URL\}\}/g, fileUrls['css_base'] || '');
        htmlContent = htmlContent.replace(/\{\{CSS_COMPONENTS_URL\}\}/g, fileUrls['css_components'] || '');
        htmlContent = htmlContent.replace(/\{\{JS_CORE_URL\}\}/g, fileUrls['js_core'] || '');
        htmlContent = htmlContent.replace(/\{\{JS_MAIN_URL\}\}/g, fileUrls['js_main'] || '');
        htmlContent = htmlContent.replace(/\{\{JS_VIEW_DASHBOARD_URL\}\}/g, fileUrls['js_view_dashboard'] || '');
        htmlContent = htmlContent.replace(/\{\{JS_VIEW_UPLOAD_URL\}\}/g, fileUrls['js_view_upload'] || '');
        htmlContent = htmlContent.replace(/\{\{JS_VIEW_QUEUE_URL\}\}/g, fileUrls['js_view_queue'] || '');
        htmlContent = htmlContent.replace(/\{\{JS_VIEW_REVIEW_URL\}\}/g, fileUrls['js_view_review'] || '');
        htmlContent = htmlContent.replace(/\{\{JS_VIEW_BATCH_URL\}\}/g, fileUrls['js_view_batch'] || '');
        htmlContent = htmlContent.replace(/\{\{JS_VIEW_SETTINGS_URL\}\}/g, fileUrls['js_view_settings'] || '');

        // 5. Inject runtime configuration
        var currentUser = runtime.getCurrentUser();
        var configScript = '<script>\n' +
            'window.FC_CONFIG = {\n' +
            '    apiUrl: "' + routerUrl + '",\n' +
            '    accountId: "' + runtime.accountId + '",\n' +
            '    user: {\n' +
            '        id: ' + currentUser.id + ',\n' +
            '        name: "' + escapeJs(currentUser.name) + '",\n' +
            '        email: "' + escapeJs(currentUser.email) + '",\n' +
            '        role: ' + currentUser.role + '\n' +
            '    }\n' +
            '};\n' +
            '</script>\n';

        htmlContent = htmlContent.replace('</head>', configScript + '</head>');

        // 6. Log file resolution status for debugging
        log.debug('File URLs Resolved', JSON.stringify(fileUrls));

        // 7. Serve raw HTML
        context.response.write(htmlContent);
    }

    /**
     * Resolve all file URLs from FILE_MANIFEST
     * Uses search fallback if direct path fails
     */
    function resolveFileUrls() {
        var fileUrls = {};

        Object.keys(FILE_MANIFEST).forEach(function(key) {
            var relativePath = FILE_MANIFEST[key];
            var fullPath = CONFIG.basePath + '/' + relativePath;

            try {
                var fileObj = file.load({ id: fullPath });
                fileUrls[key] = fileObj.url;
                log.debug('File Loaded', key + ' -> ' + fileObj.url);
            } catch (e) {
                log.error('File Load Failed', key + ' -> ' + fullPath + ' : ' + e.message);

                // Try searching by file name as fallback
                try {
                    var fileName = relativePath.split('/').pop();
                    var fileSearch = search.create({
                        type: 'file',
                        filters: [['name', 'is', fileName]],
                        columns: ['url', 'folder']
                    });
                    var results = fileSearch.run().getRange({ start: 0, end: 1 });
                    if (results && results.length > 0) {
                        fileUrls[key] = results[0].getValue('url');
                        log.debug('File Found via Search', key + ' -> ' + fileUrls[key]);
                    } else {
                        log.error('File Search Failed', 'No results for: ' + fileName);
                        fileUrls[key] = null;
                    }
                } catch (searchError) {
                    log.error('File Search Error', searchError.message);
                    fileUrls[key] = null;
                }
            }
        });

        return fileUrls;
    }

    /**
     * Escape string for JavaScript
     */
    function escapeJs(str) {
        if (!str) return '';
        return String(str).replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n');
    }

    return { onRequest: onRequest };
});
