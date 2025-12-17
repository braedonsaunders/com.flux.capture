/**
 * @NApiVersion 2.1
 * @NScriptType Suitelet
 * @NModuleScope SameAccount
 *
 * Flux Capture - Main Suitelet
 * Embeds SPA directly into NetSuite form to preserve navbar
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
        'js_view_batch': 'client/views/View.Batch.js',
        'js_view_settings': 'client/views/View.Settings.js'
    };

    function onRequest(context) {
        if (context.request.method !== 'GET') {
            context.response.write('Method not allowed');
            return;
        }

        try {
            // Check if this is the content-only request (for direct access)
            var isContentOnly = context.request.parameters.fc_mode === 'content';

            if (isContentOnly) {
                serveAppContent(context);
            } else {
                serveWithNavbar(context);
            }
        } catch (error) {
            log.error('Suitelet Error', { message: error.message, stack: error.stack });
            context.response.write('<h1>Error</h1><pre>' + error.message + '</pre>');
        }
    }

    /**
     * Mode 1: Serve app embedded in NetSuite form (with navbar)
     * Injects app HTML directly into the page, no iframe needed
     */
    function serveWithNavbar(context) {
        var form = serverWidget.createForm({ title: 'Flux Capture' });

        // Get all file URLs and config
        var fileUrls = resolveFileUrls();
        var routerUrl = url.resolveScript({
            scriptId: 'customscript_fc_router',
            deploymentId: 'customdeploy_fc_router'
        });

        // Build the embedded app HTML
        var appHtml = buildEmbeddedAppHtml(fileUrls, routerUrl);

        var htmlField = form.addField({
            id: 'custpage_fc_app',
            type: serverWidget.FieldType.INLINEHTML,
            label: ' '
        });

        htmlField.defaultValue = appHtml;
        context.response.writePage(form);
    }

    /**
     * Mode 2: Serve raw HTML app content (content-only mode)
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

        // 7. Set content type and serve raw HTML
        context.response.setHeader({
            name: 'Content-Type',
            value: 'text/html; charset=utf-8'
        });
        context.response.write(htmlContent);
    }

    /**
     * Build embedded app HTML for injection into NetSuite form
     */
    function buildEmbeddedAppHtml(fileUrls, routerUrl) {
        var currentUser = runtime.getCurrentUser();

        // CSS to hide NetSuite form elements and position our app
        var wrapperCss = '\
<style>\
    /* Hide NetSuite form elements */\
    #main_form > table:first-child,\
    .uir-page-title-secondline,\
    .uir-page-title,\
    .uir-page-title-firstline,\
    #main_form > tbody > tr:first-child,\
    #main_form > table > tbody > tr:first-child,\
    .uir-machine-headerrow {\
        display: none !important;\
    }\
    \
    /* App container positioning */\
    .fc-app-container {\
        position: fixed;\
        left: 0;\
        right: 0;\
        bottom: 0;\
        top: 0;\
        width: 100vw;\
        height: 100vh;\
        z-index: 100;\
        background: #f8fafc;\
    }\
</style>';

        // Runtime config script
        var configScript = '\
<script>\
window.FC_CONFIG = {\
    apiUrl: "' + routerUrl + '",\
    accountId: "' + runtime.accountId + '",\
    user: {\
        id: ' + currentUser.id + ',\
        name: "' + escapeJs(currentUser.name) + '",\
        email: "' + escapeJs(currentUser.email) + '",\
        role: ' + currentUser.role + '\
    }\
};\
</script>';

        // Load external resources
        var externalResources = '\
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700;800&display=swap" rel="stylesheet">\
<link href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css" rel="stylesheet">\
<link rel="stylesheet" href="' + (fileUrls['css_base'] || '') + '">\
<link rel="stylesheet" href="' + (fileUrls['css_components'] || '') + '">';

        // Load the app HTML template and extract body content
        var htmlPath = CONFIG.basePath + '/App/app_index.html';
        var htmlFile = file.load({ id: htmlPath });
        var htmlContent = htmlFile.getContents();

        // Extract body content (between <body> and </body>)
        var bodyMatch = htmlContent.match(/<body[^>]*>([\s\S]*)<\/body>/i);
        var bodyContent = bodyMatch ? bodyMatch[1] : '';

        // Extract inline styles from head
        var styleMatch = htmlContent.match(/<style>([\s\S]*?)<\/style>/i);
        var inlineStyles = styleMatch ? '<style>' + styleMatch[1] + '</style>' : '';

        // Build JS script tags
        var jsScripts = '\
<script src="' + (fileUrls['js_core'] || '') + '"></script>\
<script src="' + (fileUrls['js_main'] || '') + '"></script>\
<script src="' + (fileUrls['js_view_dashboard'] || '') + '"></script>\
<script src="' + (fileUrls['js_view_upload'] || '') + '"></script>\
<script src="' + (fileUrls['js_view_queue'] || '') + '"></script>\
<script src="' + (fileUrls['js_view_review'] || '') + '"></script>\
<script src="' + (fileUrls['js_view_batch'] || '') + '"></script>\
<script src="' + (fileUrls['js_view_settings'] || '') + '"></script>';

        // Script to adjust for NetSuite header
        var adjustScript = '\
<script>\
(function() {\
    function adjustAppPosition() {\
        var container = document.querySelector(".fc-app-container");\
        if (!container) return;\
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
            container.style.top = headerBottom + "px";\
            container.style.height = "calc(100vh - " + headerBottom + "px)";\
        }\
    }\
    adjustAppPosition();\
    [100, 200, 400, 800, 1500].forEach(function(d) { setTimeout(adjustAppPosition, d); });\
    window.addEventListener("resize", adjustAppPosition);\
})();\
</script>';

        // Combine everything
        return wrapperCss +
               externalResources +
               inlineStyles +
               configScript +
               '<div class="fc-app-container">' +
               bodyContent +
               '</div>' +
               jsScripts +
               adjustScript;
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
