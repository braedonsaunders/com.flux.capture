/**
 * @NApiVersion 2.1
 * @NScriptType Suitelet
 * @NModuleScope SameAccount
 *
 * Flux Capture - Main Suitelet
 * Uses iframe to preserve NetSuite menu while serving app
 */
define(['N/file', 'N/runtime', 'N/url', 'N/ui/serverWidget', 'N/search'], function(file, runtime, url, serverWidget, search) {

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
        'js_view_rail': 'client/views/View.Rail.js',
        'js_view_batch': 'client/views/View.Batch.js',
        'js_view_settings': 'client/views/View.Settings.js'
    };

    function onRequest(context) {
        if (context.request.method !== 'GET') {
            context.response.write('Method not allowed');
            return;
        }

        try {
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
     * MODE 1: NETSUITE WRAPPER (Preserves Menu)
     * Creates a form with iframe pointing to content mode
     */
    function serveWrapper(context) {
        var form = serverWidget.createForm({ title: 'Flux Capture' });

        // Get the URL of *this* Suitelet with content mode flag
        var currentScript = runtime.getCurrentScript();
        var suiteletUrl = url.resolveScript({
            scriptId: currentScript.id,
            deploymentId: currentScript.deploymentId
        }) + '&fc_mode=content';

        // Add an Inline HTML field to host the iframe
        var field = form.addField({
            id: 'custpage_fc_frame',
            type: serverWidget.FieldType.INLINEHTML,
            label: ' '
        });

        // Styling for full-width iframe below NS header
        // Use visibility:hidden (not display:none) so NetSuite can still reference elements
        field.defaultValue = '\
            <style>\
                /* === Hide form title elements without breaking iframe === */\
                #main_form > table:first-child,\
                .uir-page-title-secondline,\
                .uir-page-title,\
                .uir-page-title-firstline,\
                #main_form > tbody > tr:first-child,\
                #main_form > table > tbody > tr:first-child {\
                    visibility: hidden !important;\
                    pointer-events: none !important;\
                    height: 0 !important;\
                    min-height: 0 !important;\
                    max-height: 0 !important;\
                    overflow: visible !important;\
                    padding: 0 !important;\
                    margin: 0 !important;\
                    border: none !important;\
                    line-height: 0 !important;\
                    font-size: 0 !important;\
                }\
                \
                /* Iframe container - full width, positioned below NS header */\
                .fc-frame-wrapper {\
                    position: fixed;\
                    left: 0;\
                    right: 0;\
                    bottom: 0;\
                    top: 103px;\
                    width: 100vw;\
                    z-index: 100;\
                    visibility: visible !important;\
                    opacity: 1 !important;\
                    pointer-events: auto !important;\
                }\
                \
                .fc-iframe {\
                    width: 100%;\
                    height: 100%;\
                    border: none;\
                    display: block;\
                    visibility: visible !important;\
                    opacity: 1 !important;\
                    pointer-events: auto !important;\
                }\
            </style>\
            <div class="fc-frame-wrapper">\
                <iframe\
                    src="' + suiteletUrl + '"\
                    class="fc-iframe"\
                    title="Flux Capture"\
                ></iframe>\
            </div>\
            <script>\
                (function() {\
                    function adjustIframePosition() {\
                        var wrapper = document.querySelector(".fc-frame-wrapper");\
                        if (!wrapper) return false;\
                        \
                        var headerSelectors = [\
                            "#div__header",\
                            "#ns-header",\
                            "#ns_navigation",\
                            ".uir-page-header",\
                            "#nscm"\
                        ];\
                        \
                        var headerBottom = 0;\
                        \
                        for (var i = 0; i < headerSelectors.length; i++) {\
                            var header = document.querySelector(headerSelectors[i]);\
                            if (header) {\
                                var rect = header.getBoundingClientRect();\
                                if (rect.bottom > headerBottom) {\
                                    headerBottom = rect.bottom;\
                                }\
                            }\
                        }\
                        \
                        if (headerBottom === 0) {\
                            var yPositions = [40, 60, 80, 100];\
                            for (var j = 0; j < yPositions.length; j++) {\
                                var elements = document.elementsFromPoint(window.innerWidth / 2, yPositions[j]);\
                                for (var k = 0; k < elements.length; k++) {\
                                    var el = elements[k];\
                                    if (el.tagName === "BODY" || el.tagName === "HTML") continue;\
                                    var rect = el.getBoundingClientRect();\
                                    if (rect.bottom > headerBottom && rect.bottom < 200) {\
                                        headerBottom = rect.bottom;\
                                    }\
                                }\
                            }\
                        }\
                        \
                        if (headerBottom > 0) {\
                            headerBottom = Math.max(80, Math.min(120, headerBottom));\
                            wrapper.style.top = headerBottom + "px";\
                            return true;\
                        }\
                        \
                        return false;\
                    }\
                    \
                    var success = adjustIframePosition();\
                    \
                    if (!success) {\
                        var retries = [100, 200, 400, 800];\
                        retries.forEach(function(delay) {\
                            setTimeout(adjustIframePosition, delay);\
                        });\
                    }\
                    \
                    window.addEventListener("resize", adjustIframePosition);\
                })();\
            </script>';

        context.response.writePage(form);
    }

    /**
     * MODE 2: APP CONTENT (Raw HTML inside iframe)
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
        htmlContent = htmlContent.replace(/\{\{JS_VIEW_RAIL_URL\}\}/g, fileUrls['js_view_rail'] || '');
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

        // 7. Set content type and serve raw HTML
        context.response.setHeader({
            name: 'Content-Type',
            value: 'text/html; charset=utf-8'
        });
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
