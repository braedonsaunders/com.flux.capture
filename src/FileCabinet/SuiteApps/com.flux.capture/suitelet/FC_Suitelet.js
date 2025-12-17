/**
 * @NApiVersion 2.1
 * @NScriptType Suitelet
 * @NModuleScope SameAccount
 *
 * Flux Capture - Main Suitelet
 * Two-mode pattern: wrapper (NetSuite nav) + content (SPA)
 */
define(['N/file', 'N/runtime', 'N/url', 'N/ui/serverWidget'], function(file, runtime, url, serverWidget) {

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
     * Mode 1: Serve NetSuite wrapper with iframe
     */
    function serveWrapper(context) {
        var form = serverWidget.createForm({ title: 'Flux Capture' });
        var currentScript = runtime.getCurrentScript();

        // Get URL to this same Suitelet with fc_mode=content
        var contentUrl = url.resolveScript({
            scriptId: currentScript.id,
            deploymentId: currentScript.deploymentId,
            params: { fc_mode: 'content' }
        });

        var htmlField = form.addField({
            id: 'custpage_fc_frame',
            type: serverWidget.FieldType.INLINEHTML,
            label: ' '
        });

        htmlField.defaultValue = getWrapperHTML(contentUrl);
        context.response.writePage(form);
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
     */
    function resolveFileUrls() {
        var fileUrls = {};

        Object.keys(FILE_MANIFEST).forEach(function(key) {
            var relativePath = FILE_MANIFEST[key];
            var fullPath = CONFIG.basePath + '/' + relativePath;

            try {
                var fileObj = file.load({ id: fullPath });
                fileUrls[key] = fileObj.url;
                log.debug('File Loaded', key + ' -> ' + fullPath);
            } catch (e) {
                log.error('File Load Failed', key + ' -> ' + fullPath + ' : ' + e.message);
                fileUrls[key] = null;
            }
        });

        return fileUrls;
    }

    /**
     * Get wrapper HTML with iframe
     */
    function getWrapperHTML(contentUrl) {
        return '\
            <style>\
                #main_form > table:first-child,\
                .uir-page-title-secondline,\
                .uir-page-title,\
                .uir-page-title-firstline,\
                #main_form > tbody > tr:first-child,\
                #main_form > table > tbody > tr:first-child {\
                    visibility: hidden !important;\
                    height: 0 !important;\
                    min-height: 0 !important;\
                    overflow: hidden !important;\
                    padding: 0 !important;\
                    margin: 0 !important;\
                    border: none !important;\
                }\
                .fc-frame-wrapper {\
                    position: fixed;\
                    left: 0;\
                    right: 0;\
                    bottom: 0;\
                    top: 103px;\
                    width: 100vw;\
                    z-index: 100;\
                }\
                .fc-iframe {\
                    width: 100%;\
                    height: 100%;\
                    border: none;\
                    display: block;\
                }\
            </style>\
            <div class="fc-frame-wrapper">\
                <iframe src="' + contentUrl + '" class="fc-iframe" title="Flux Capture"></iframe>\
            </div>\
            <script>\
                (function() {\
                    function adjustIframePosition() {\
                        var wrapper = document.querySelector(".fc-frame-wrapper");\
                        if (!wrapper) return;\
                        var headerSelectors = ["#div__header", "#ns-header", "#ns_navigation", ".uir-page-header"];\
                        var headerBottom = 0;\
                        for (var i = 0; i < headerSelectors.length; i++) {\
                            var header = document.querySelector(headerSelectors[i]);\
                            if (header) {\
                                var rect = header.getBoundingClientRect();\
                                if (rect.bottom > headerBottom) headerBottom = rect.bottom;\
                            }\
                        }\
                        if (headerBottom > 0) {\
                            headerBottom = Math.max(80, Math.min(120, headerBottom));\
                            wrapper.style.top = headerBottom + "px";\
                        }\
                    }\
                    adjustIframePosition();\
                    [100, 200, 400, 800].forEach(function(d) { setTimeout(adjustIframePosition, d); });\
                    window.addEventListener("resize", adjustIframePosition);\
                })();\
            </script>';
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
