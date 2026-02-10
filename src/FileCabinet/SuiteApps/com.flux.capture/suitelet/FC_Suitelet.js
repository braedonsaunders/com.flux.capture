/**
 * @NApiVersion 2.1
 * @NScriptType Suitelet
 * @NModuleScope SameAccount
 *
 * Flux Capture - Main Suitelet
 * Uses iframe to preserve NetSuite menu while serving app
 */
define(['N/file', 'N/runtime', 'N/url', 'N/ui/serverWidget', 'N/search', 'N/task', 'N/log', '/SuiteApps/com.flux.capture/lib/FC_Debug', '/SuiteApps/com.flux.capture/lib/FC_LicenseGuard'], function(file, runtime, url, serverWidget, search, task, log, fcDebug, License) {

    'use strict';

    var CONFIG = {
        basePath: '/SuiteApps/com.flux.capture'
    };

    // Maps keys to file paths for URL resolution
    var FILE_MANIFEST = {
        'html_app': 'App/app_index.html',
        'css_base': 'App/css/base.css',
        'css_components': 'App/css/components.css',
        'js_debug': 'client/core/FC.Debug.js',
        'js_core': 'client/core/FC.Core.js',
        'js_main': 'client/FC.Main.js',
        'js_view_dashboard': 'client/views/View.Dashboard.js',
        'js_view_queue': 'client/views/View.Queue.js',
        'js_view_review': 'client/views/View.Review.js',
        'js_view_rail': 'client/views/View.Rail.js',
        'js_view_settings': 'client/views/View.Settings.js',
        'js_view_documents': 'client/views/View.Documents.js'
    };

    var SCRIPT_IDS = {
        PROCESS_DOCUMENTS_MR: 'customscript_fc_process_docs_mr',
        PROCESS_DOCUMENTS_DEPLOY: 'customdeploy_fc_process_docs_mr'
    };

    function onRequest(context) {
        // Handle POST requests for API actions (like triggering processing)
        if (context.request.method === 'POST') {
            // License check for POST actions
            try {
                License.require();
            } catch (licError) {
                context.response.setHeader({ name: 'Content-Type', value: 'application/json' });
                context.response.write(JSON.stringify({
                    success: false,
                    error: { code: 'FLUX_LICENSE_REQUIRED', message: 'Valid license required' }
                }));
                return;
            }
            handlePostRequest(context);
            return;
        }

        if (context.request.method !== 'GET') {
            context.response.write('Method not allowed');
            return;
        }

        try {
            var isInnerFrame = context.request.parameters.fc_mode === 'content';

            if (isInnerFrame) {
                // Check license for iframe content - pass status to client
                var licenseValid = false;
                try {
                    var lic = License.validate();
                    licenseValid = lic && lic.valid === true;
                } catch (e) {
                    licenseValid = false;
                }
                serveAppContent(context, licenseValid);
            } else {
                // ALWAYS serve wrapper - preserves NetSuite navbar
                // License state is handled by the iframe content
                serveWrapper(context);
            }
        } catch (error) {
            log.error('Suitelet Error', { message: error.message, stack: error.stack });
            context.response.write('<h1>Error</h1><pre>' + error.message + '</pre>');
        }
    }

    /**
     * Handle POST requests for API actions
     */
    function handlePostRequest(context) {
        var action = context.request.parameters.action;

        try {
            if (action === 'triggerProcessing') {
                var mrTask = task.create({
                    taskType: task.TaskType.MAP_REDUCE,
                    scriptId: SCRIPT_IDS.PROCESS_DOCUMENTS_MR,
                    deploymentId: SCRIPT_IDS.PROCESS_DOCUMENTS_DEPLOY
                });
                var taskId = mrTask.submit();

                log.audit('FC_Suitelet.triggerProcessing', 'MapReduce task submitted: ' + taskId);

                context.response.setHeader({ name: 'Content-Type', value: 'application/json' });
                context.response.write(JSON.stringify({ success: true, taskId: taskId }));
            } else {
                context.response.setHeader({ name: 'Content-Type', value: 'application/json' });
                context.response.write(JSON.stringify({ success: false, error: 'Unknown action: ' + action }));
            }
        } catch (e) {
            log.error('FC_Suitelet.handlePost', e.message);
            context.response.setHeader({ name: 'Content-Type', value: 'application/json' });
            context.response.write(JSON.stringify({ success: false, error: e.message }));
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
                    \
                    /**\
                     * Detect NetSuite navbar theme color and sync to iframe sidebar\
                     */\
                    function detectAndSyncNavbarColor() {\
                        var iframe = document.querySelector(".fc-iframe");\
                        if (!iframe || !iframe.contentWindow) return false;\
                        \
                        var navbarColor = null;\
                        \
                        /* NetSuite navbar selectors - order by specificity */\
                        var navbarSelectors = [\
                            "#div__header",           /* Redwood theme header */\
                            "#ns-header",             /* Modern NS header */\
                            ".ns-header-container",   /* Header container */\
                            "#ns_navigation",         /* Navigation bar */\
                            ".uir-page-header",       /* Classic UI header */\
                            "#nscm"                   /* NetSuite Center Menu */\
                        ];\
                        \
                        for (var i = 0; i < navbarSelectors.length; i++) {\
                            var navbar = document.querySelector(navbarSelectors[i]);\
                            if (navbar) {\
                                var style = window.getComputedStyle(navbar);\
                                var bgColor = style.backgroundColor;\
                                /* Skip transparent or white backgrounds */\
                                if (bgColor && bgColor !== "transparent" && bgColor !== "rgba(0, 0, 0, 0)" && bgColor !== "rgb(255, 255, 255)") {\
                                    navbarColor = bgColor;\
                                    break;\
                                }\
                            }\
                        }\
                        \
                        /* Fallback: try to find any dark header element */\
                        if (!navbarColor) {\
                            var headerElements = document.querySelectorAll("[id*=header], [class*=header], [id*=nav], [class*=nav]");\
                            for (var j = 0; j < headerElements.length; j++) {\
                                var el = headerElements[j];\
                                var rect = el.getBoundingClientRect();\
                                /* Only consider elements at top of page */\
                                if (rect.top >= 0 && rect.top < 100 && rect.height > 30) {\
                                    var style = window.getComputedStyle(el);\
                                    var bgColor = style.backgroundColor;\
                                    if (bgColor && bgColor !== "transparent" && bgColor !== "rgba(0, 0, 0, 0)" && bgColor !== "rgb(255, 255, 255)") {\
                                        navbarColor = bgColor;\
                                        break;\
                                    }\
                                }\
                            }\
                        }\
                        \
                        if (navbarColor) {\
                            try {\
                                iframe.contentWindow.postMessage({\
                                    type: "FC_NAVBAR_COLOR",\
                                    color: navbarColor\
                                }, "*");\
                                return true;\
                            } catch (e) {\
                                /* Cross-origin error - iframe not ready */\
                                return false;\
                            }\
                        }\
                        return false;\
                    }\
                    \
                    /* Wait for iframe to load then sync color */\
                    var fcIframe = document.querySelector(".fc-iframe");\
                    if (fcIframe) {\
                        fcIframe.addEventListener("load", function() {\
                            /* Retry with delays to ensure iframe is ready */\
                            var colorRetries = [100, 300, 600, 1000];\
                            colorRetries.forEach(function(delay) {\
                                setTimeout(detectAndSyncNavbarColor, delay);\
                            });\
                        });\
                    }\
                })();\
            </script>';

        context.response.writePage(form);
    }

    /**
     * MODE 2: APP CONTENT (Raw HTML inside iframe)
     * @param {Object} context - Request context
     * @param {boolean} licenseValid - Whether license is valid (from server check)
     */
    function serveAppContent(context, licenseValid) {
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
        htmlContent = htmlContent.replace(/\{\{JS_DEBUG_URL\}\}/g, fileUrls['js_debug'] || '');
        htmlContent = htmlContent.replace(/\{\{JS_CORE_URL\}\}/g, fileUrls['js_core'] || '');
        htmlContent = htmlContent.replace(/\{\{JS_MAIN_URL\}\}/g, fileUrls['js_main'] || '');
        htmlContent = htmlContent.replace(/\{\{JS_VIEW_DASHBOARD_URL\}\}/g, fileUrls['js_view_dashboard'] || '');
        htmlContent = htmlContent.replace(/\{\{JS_VIEW_QUEUE_URL\}\}/g, fileUrls['js_view_queue'] || '');
        htmlContent = htmlContent.replace(/\{\{JS_VIEW_REVIEW_URL\}\}/g, fileUrls['js_view_review'] || '');
        htmlContent = htmlContent.replace(/\{\{JS_VIEW_RAIL_URL\}\}/g, fileUrls['js_view_rail'] || '');
        htmlContent = htmlContent.replace(/\{\{JS_VIEW_SETTINGS_URL\}\}/g, fileUrls['js_view_settings'] || '');
        htmlContent = htmlContent.replace(/\{\{JS_VIEW_DOCUMENTS_URL\}\}/g, fileUrls['js_view_documents'] || '');

        // 5. Inject runtime configuration (including license status from server)
        var currentUser = runtime.getCurrentUser();
        var isDebugMode = fcDebug.isDebugMode();
        var configScript = '<script>\n' +
            'window.FC_CONFIG = {\n' +
            '    apiUrl: "' + routerUrl + '",\n' +
            '    accountId: "' + runtime.accountId + '",\n' +
            '    isDebugMode: ' + isDebugMode + ',\n' +
            '    licenseValid: ' + (licenseValid === true) + ',\n' +
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
        fcDebug.debug('File URLs Resolved', JSON.stringify(fileUrls));

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
    function buildCacheToken(fileObj) {
        if (!fileObj) return String(Date.now());
        var token = fileObj.lastModifiedDate || fileObj.lastModified || fileObj.size || fileObj.id;
        if (!token) token = Date.now();
        return String(token).replace(/\s+/g, '');
    }

    function appendCacheBust(url, token) {
        if (!url || !token) return url;
        var separator = url.indexOf('?') === -1 ? '?' : '&';
        return url + separator + 'v=' + encodeURIComponent(token);
    }

    function resolveFileUrls() {
        var fileUrls = {};

        Object.keys(FILE_MANIFEST).forEach(function(key) {
            var relativePath = FILE_MANIFEST[key];
            var fullPath = CONFIG.basePath + '/' + relativePath;

            try {
                var fileObj = file.load({ id: fullPath });
                var cacheToken = buildCacheToken(fileObj);
                fileUrls[key] = appendCacheBust(fileObj.url, cacheToken);
                fcDebug.debug('File Loaded', key + ' -> ' + fileUrls[key]);
            } catch (e) {
                log.error('File Load Failed', key + ' -> ' + fullPath + ' : ' + e.message);

                // Try searching by file name as fallback
                try {
                    var fileName = relativePath.split('/').pop();
                    var fileSearch = search.create({
                        type: 'file',
                        filters: [['name', 'is', fileName]],
                        columns: ['url', 'folder', 'internalid', 'lastmodified']
                    });
                    var results = fileSearch.run().getRange({ start: 0, end: 1 });
                    if (results && results.length > 0) {
                        var rawUrl = results[0].getValue('url');
                        var cacheToken = results[0].getValue('lastmodified') || results[0].getValue('internalid');
                        fileUrls[key] = appendCacheBust(rawUrl, cacheToken || Date.now());
                        fcDebug.debug('File Found via Search', key + ' -> ' + fileUrls[key]);
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
