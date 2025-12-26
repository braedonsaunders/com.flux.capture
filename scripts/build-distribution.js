#!/usr/bin/env node
/**
 * Flux Capture - Distribution Build Script
 *
 * This script packages the SuiteApp for distribution via SuiteBundler.
 * It handles:
 * 1. JavaScript obfuscation for client-side code (since they can't be hidden in bundles)
 * 2. Bundle manifest generation
 * 3. File packaging with proper structure
 * 4. Hide Script configuration for server-side scripts
 *
 * Usage:
 *   node scripts/build-distribution.js           # Full build
 *   node scripts/build-distribution.js --bundle  # Package only (no obfuscation)
 *   node scripts/build-distribution.js --obfuscate # Obfuscate only
 */

const fs = require('fs');
const path = require('path');

// Configuration
const CONFIG = {
    srcDir: path.join(__dirname, '..', 'src', 'FileCabinet', 'SuiteApps', 'com.flux.capture'),
    distDir: path.join(__dirname, '..', 'dist'),
    bundleDir: path.join(__dirname, '..', 'dist', 'bundle'),

    // Files that should have "Hide in SuiteBundle" enabled (server-side scripts)
    hideScriptFiles: [
        'suitelet/FC_Suitelet.js',
        'suitelet/FC_Router.js',
        'lib/FC_Engine.js',
        'lib/FC_Debug.js',
        'lib/FC_LicenseGuard.js',
        'lib/providers/ExtractionProvider.js',
        'lib/providers/ProviderFactory.js',
        'lib/providers/AzureFormRecognizerProvider.js',
        'lib/providers/OCIProvider.js',
        'lib/providers/MindeeProvider.js',
        'lib/utils/PDFUtils.js',
        'scripts/FC_ProcessDocuments_MR.js',
        'scripts/FC_Document_UE.js',
        'scripts/FC_EmailCapture_Plugin.js',
        'scripts/FC_ContinuePolling_SS.js'
    ],

    // Files that need obfuscation (client-side scripts - can't be hidden in bundles as of May 2024)
    obfuscateFiles: [
        'client/core/FC.Core.js',
        'client/FC.Main.js',
        'client/views/View.Dashboard.js',
        'client/views/View.Queue.js',
        'client/views/View.Review.js',
        'client/views/View.Settings.js',
        'client/views/View.Rail.js',
        'client/views/View.Documents.js'
    ],

    // Obfuscation options (balanced between protection and performance)
    obfuscatorOptions: {
        compact: true,
        controlFlowFlattening: true,
        controlFlowFlatteningThreshold: 0.5,
        deadCodeInjection: true,
        deadCodeInjectionThreshold: 0.2,
        debugProtection: false, // Can cause issues in NetSuite
        disableConsoleOutput: false, // Keep console for debugging
        identifierNamesGenerator: 'hexadecimal',
        log: false,
        numbersToExpressions: true,
        renameGlobals: false, // Don't rename globals, may break NetSuite integration
        selfDefending: false, // Can cause issues in NetSuite
        simplify: true,
        splitStrings: true,
        splitStringsChunkLength: 10,
        stringArray: true,
        stringArrayCallsTransform: true,
        stringArrayEncoding: ['base64'],
        stringArrayIndexShift: true,
        stringArrayRotate: true,
        stringArrayShuffle: true,
        stringArrayWrappersCount: 2,
        stringArrayWrappersChainedCalls: true,
        stringArrayWrappersParametersMaxCount: 4,
        stringArrayWrappersType: 'function',
        stringArrayThreshold: 0.75,
        transformObjectKeys: true,
        unicodeEscapeSequence: false
    }
};

// Bundle manifest structure
const BUNDLE_MANIFEST = {
    name: 'Flux Capture',
    version: '1.0.0',
    description: 'Intelligent Document Capture for NetSuite - AI-powered invoice and receipt processing',
    vendor: 'Flux for NetSuite',
    vendorUrl: 'https://fluxfornetsuite.com',
    supportEmail: 'support@fluxfornetsuite.com',

    // Bundle settings
    isManaged: true,  // Managed bundles track updates
    isLocked: true,   // Lock objects so they can't be edited in target account

    // Required features in target account
    requiredFeatures: [
        'SERVERSIDESCRIPTING'
    ],

    // Files included in bundle with their settings
    files: [],

    // Custom records
    customRecords: [
        'customrecord_flux_document',
        'customrecord_flux_config'
    ],

    // Scripts with deployments
    scripts: [
        {
            scriptId: 'customscript_fc_suitelet',
            type: 'suitelet',
            name: 'Flux Capture',
            hidden: true
        },
        {
            scriptId: 'customscript_fc_router',
            type: 'restlet',
            name: 'Flux Capture Router',
            hidden: true
        },
        {
            scriptId: 'customscript_fc_process_docs_mr',
            type: 'mapreduce',
            name: 'Flux Process Documents',
            hidden: true
        },
        {
            scriptId: 'customscript_fc_document_ue',
            type: 'userevent',
            name: 'Flux Document Events',
            hidden: true
        },
        {
            scriptId: 'customscript_fc_email_capture',
            type: 'emailcaptureplugin',
            name: 'Flux Email Capture',
            hidden: true
        },
        {
            scriptId: 'customscript_fc_continue_polling',
            type: 'scheduled',
            name: 'Flux Continue Polling',
            hidden: true
        }
    ]
};

// Color output helpers
const colors = {
    reset: '\x1b[0m',
    bright: '\x1b[1m',
    red: '\x1b[31m',
    green: '\x1b[32m',
    yellow: '\x1b[33m',
    blue: '\x1b[34m',
    cyan: '\x1b[36m'
};

function log(msg, color = '') {
    console.log(`${color}${msg}${colors.reset}`);
}

function logStep(step, msg) {
    console.log(`${colors.cyan}[${step}]${colors.reset} ${msg}`);
}

function logSuccess(msg) {
    console.log(`${colors.green}[SUCCESS]${colors.reset} ${msg}`);
}

function logWarning(msg) {
    console.log(`${colors.yellow}[WARNING]${colors.reset} ${msg}`);
}

function logError(msg) {
    console.log(`${colors.red}[ERROR]${colors.reset} ${msg}`);
}

/**
 * Ensure directory exists
 */
function ensureDir(dir) {
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
    }
}

/**
 * Copy file preserving directory structure
 */
function copyFile(src, destDir, relativePath) {
    const destPath = path.join(destDir, relativePath);
    ensureDir(path.dirname(destPath));
    fs.copyFileSync(src, destPath);
    return destPath;
}

/**
 * Obfuscate JavaScript code (requires javascript-obfuscator package)
 */
async function obfuscateCode(code, filePath) {
    try {
        // Dynamic import to handle missing package gracefully
        const JavaScriptObfuscator = require('javascript-obfuscator');

        // Create file-specific options
        const options = {
            ...CONFIG.obfuscatorOptions,
            sourceFileName: path.basename(filePath),
            sourceMapMode: 'inline' // Keep source map for debugging if needed
        };

        const result = JavaScriptObfuscator.obfuscate(code, options);
        return result.getObfuscatedCode();
    } catch (e) {
        if (e.code === 'MODULE_NOT_FOUND') {
            logWarning('javascript-obfuscator not installed. Run: npm install');
            logWarning('Returning original code without obfuscation');
            return code;
        }
        throw e;
    }
}

/**
 * Process a single file for distribution
 */
async function processFile(relativePath, options = {}) {
    const srcPath = path.join(CONFIG.srcDir, relativePath);
    const destPath = path.join(CONFIG.bundleDir, 'FileCabinet', 'SuiteApps', 'com.flux.capture', relativePath);

    if (!fs.existsSync(srcPath)) {
        logWarning(`File not found: ${relativePath}`);
        return null;
    }

    ensureDir(path.dirname(destPath));

    const isServerSide = CONFIG.hideScriptFiles.includes(relativePath);
    const needsObfuscation = CONFIG.obfuscateFiles.includes(relativePath);

    let content = fs.readFileSync(srcPath, 'utf8');

    // Obfuscate client-side code if needed
    if (needsObfuscation && options.obfuscate) {
        logStep('OBFUSCATE', relativePath);
        content = await obfuscateCode(content, srcPath);
    }

    fs.writeFileSync(destPath, content);

    return {
        path: relativePath,
        hideInBundle: isServerSide,
        obfuscated: needsObfuscation && options.obfuscate,
        size: content.length
    };
}

/**
 * Generate bundle manifest JSON
 */
function generateBundleManifest(processedFiles) {
    const manifest = { ...BUNDLE_MANIFEST };
    manifest.files = processedFiles.filter(f => f !== null).map(f => ({
        path: f.path,
        hideInBundle: f.hideInBundle,
        obfuscated: f.obfuscated
    }));
    manifest.buildDate = new Date().toISOString();
    manifest.buildId = `build-${Date.now()}`;

    return manifest;
}

/**
 * Generate installation instructions
 */
function generateInstallInstructions(manifest) {
    return `
================================================================================
                    FLUX CAPTURE - INSTALLATION GUIDE
================================================================================

Bundle: ${manifest.name} v${manifest.version}
Build ID: ${manifest.buildId}
Build Date: ${manifest.buildDate}

================================================================================
INSTALLATION METHODS
================================================================================

METHOD 1: BUNDLE INSTALLATION (Recommended)
-------------------------------------------

If you received a Bundle ID from Flux for NetSuite:

1. Log into your NetSuite account as Administrator
2. Navigate to: Customization > SuiteBundler > Search & Install Bundles
3. In the search box, enter the Bundle ID provided to you
4. Click "Install" on the Flux Capture bundle
5. Review the objects to be installed and click "Install Bundle"
6. Wait for installation to complete (usually 2-5 minutes)

After installation:
1. Navigate to: Setup > Company > Enable Features > SuiteCloud
2. Ensure "Server SuiteScript" is enabled
3. Navigate to the Flux Capture Suitelet URL (provided after installation)
4. Enter your license key in Settings

METHOD 2: SDF PROJECT DEPLOYMENT (For Developers)
-------------------------------------------------

If you're deploying from source:

1. Install SuiteCloud CLI:
   npm install -g @oracle/suitecloud-cli

2. Authenticate with your NetSuite account:
   suitecloud account:setup

3. Deploy the project:
   cd src
   suitecloud project:deploy

4. After deployment, configure your license key in Settings

================================================================================
HIDE SCRIPT CONFIGURATION
================================================================================

For optimal source code protection, the following scripts should have
"Hide in SuiteBundle" enabled in the File Cabinet:

Server-Side Scripts (CAN be hidden):
${manifest.files.filter(f => f.hideInBundle).map(f => `  - ${f.path}`).join('\n')}

Client-Side Scripts (obfuscated, cannot be hidden):
${manifest.files.filter(f => f.obfuscated).map(f => `  - ${f.path}`).join('\n')}

To enable Hide in SuiteBundle for a file:
1. Navigate to: Documents > Files > File Cabinet
2. Navigate to: SuiteApps/com.flux.capture/[path]
3. Click on the file to edit
4. Check the "Hide in SuiteBundle" checkbox
5. Save the file

IMPORTANT: As of May 2024, client-side scripts CANNOT have "Hide in SuiteBundle"
enabled. They have been obfuscated for IP protection.

================================================================================
POST-INSTALLATION VERIFICATION
================================================================================

After installation, verify the following:

1. Scripts are deployed:
   - Customization > Scripting > Scripts
   - Search for "Flux" - should see 6 scripts

2. Custom records exist:
   - Customization > Lists, Records & Fields > Record Types
   - Search for "Flux" - should see 2 records

3. Access the application:
   - Navigate to the Suitelet URL
   - You should see the Flux Capture interface
   - If prompted, enter your license key

================================================================================
SUPPORT
================================================================================

Website: ${manifest.vendorUrl}
Email: ${manifest.supportEmail}

================================================================================
`;
}

/**
 * Generate bundle creation script for NetSuite
 */
function generateBundleCreationScript(manifest) {
    return `/**
 * Flux Capture - Bundle Creation Helper
 *
 * This script helps automate bundle creation in NetSuite.
 * Run this in a Suitelet or server-side context.
 *
 * @NApiVersion 2.1
 * @NScriptType Suitelet
 */
define(['N/file', 'N/search', 'N/record', 'N/log'], function(file, search, record, log) {

    const BUNDLE_CONFIG = ${JSON.stringify(manifest, null, 8)};

    /**
     * Set "Hide in SuiteBundle" preference on a file
     * Note: This can only be done via SuiteScript, not REST API
     */
    function setHideInBundle(fileId, hide) {
        try {
            const fileRecord = record.load({
                type: record.Type.FILE,
                id: fileId,
                isDynamic: true
            });

            // The field ID for "Hide in SuiteBundle" is 'hideinbundle'
            fileRecord.setValue({
                fieldId: 'hideinbundle',
                value: hide
            });

            fileRecord.save();
            log.audit('SetHideInBundle', 'File ' + fileId + ' hidden: ' + hide);
            return true;
        } catch (e) {
            log.error('SetHideInBundle', 'Failed for file ' + fileId + ': ' + e.message);
            return false;
        }
    }

    /**
     * Find file ID by path
     */
    function findFileByPath(filePath) {
        const fullPath = '/SuiteApps/com.flux.capture/' + filePath;

        const fileSearch = search.create({
            type: search.Type.FILE,
            filters: [
                ['name', 'is', filePath.split('/').pop()]
            ],
            columns: ['internalid', 'folder', 'name']
        });

        const results = fileSearch.run().getRange({ start: 0, end: 100 });

        for (const result of results) {
            // Match by full path if needed
            const fileId = result.getValue('internalid');
            const fileObj = file.load({ id: fileId });
            if (fileObj.path === fullPath) {
                return fileId;
            }
        }

        return null;
    }

    /**
     * Configure all files for bundle distribution
     */
    function configureBundleFiles() {
        const results = {
            success: [],
            failed: []
        };

        for (const fileConfig of BUNDLE_CONFIG.files) {
            if (fileConfig.hideInBundle) {
                const fileId = findFileByPath(fileConfig.path);
                if (fileId) {
                    const success = setHideInBundle(fileId, true);
                    if (success) {
                        results.success.push(fileConfig.path);
                    } else {
                        results.failed.push(fileConfig.path);
                    }
                } else {
                    log.warning('ConfigureBundle', 'File not found: ' + fileConfig.path);
                    results.failed.push(fileConfig.path);
                }
            }
        }

        return results;
    }

    function onRequest(context) {
        if (context.request.method === 'GET') {
            const action = context.request.parameters.action;

            if (action === 'configure') {
                const results = configureBundleFiles();
                context.response.write(JSON.stringify(results, null, 2));
            } else {
                context.response.write(JSON.stringify({
                    message: 'Flux Capture Bundle Configuration Helper',
                    actions: {
                        configure: 'Set Hide in SuiteBundle on all server-side scripts'
                    },
                    config: BUNDLE_CONFIG
                }, null, 2));
            }
        }
    }

    return { onRequest: onRequest };
});
`;
}

/**
 * Main build function
 */
async function build(options = {}) {
    const startTime = Date.now();

    log('\n' + '='.repeat(60), colors.cyan);
    log('  FLUX CAPTURE - DISTRIBUTION BUILD', colors.bright);
    log('='.repeat(60) + '\n', colors.cyan);

    // Parse options
    const doObfuscate = options.obfuscate !== false;
    const doBundle = options.bundle !== false;

    logStep('CONFIG', `Obfuscate: ${doObfuscate}, Bundle: ${doBundle}`);

    // Clean and create dist directory
    logStep('CLEAN', 'Cleaning dist directory...');
    if (fs.existsSync(CONFIG.distDir)) {
        fs.rmSync(CONFIG.distDir, { recursive: true });
    }
    ensureDir(CONFIG.bundleDir);

    // Collect all files to process
    const allFiles = [
        ...CONFIG.hideScriptFiles,
        ...CONFIG.obfuscateFiles,
        'App/app_index.html',
        'App/css/base.css',
        'App/css/components.css'
    ];

    // Add library files that aren't already listed
    const libDirs = [
        'lib/extraction',
        'lib/resolution',
        'lib/matching',
        'lib/learning',
        'lib/validation',
        'lib/vendors',
        'lib/llm'
    ];

    for (const libDir of libDirs) {
        const fullDir = path.join(CONFIG.srcDir, libDir);
        if (fs.existsSync(fullDir)) {
            const files = fs.readdirSync(fullDir).filter(f => f.endsWith('.js'));
            for (const f of files) {
                const relativePath = path.join(libDir, f);
                if (!allFiles.includes(relativePath)) {
                    allFiles.push(relativePath);
                    // These are server-side, add to hideScriptFiles
                    if (!CONFIG.hideScriptFiles.includes(relativePath)) {
                        CONFIG.hideScriptFiles.push(relativePath);
                    }
                }
            }
        }
    }

    // Process files
    logStep('PROCESS', `Processing ${allFiles.length} files...`);
    const processedFiles = [];

    for (const relativePath of allFiles) {
        const result = await processFile(relativePath, { obfuscate: doObfuscate });
        if (result) {
            processedFiles.push(result);
            const status = result.hideInBundle ? '[HIDE]' : (result.obfuscated ? '[OBFS]' : '[COPY]');
            log(`  ${status} ${relativePath}`);
        }
    }

    // Copy Objects directory
    logStep('OBJECTS', 'Copying SDF Objects...');
    const objectsDir = path.join(__dirname, '..', 'src', 'Objects');
    const destObjectsDir = path.join(CONFIG.bundleDir, 'Objects');
    ensureDir(destObjectsDir);

    const objectFiles = fs.readdirSync(objectsDir).filter(f => f.endsWith('.xml'));
    for (const objFile of objectFiles) {
        fs.copyFileSync(
            path.join(objectsDir, objFile),
            path.join(destObjectsDir, objFile)
        );
        log(`  [COPY] Objects/${objFile}`);
    }

    // Copy manifest and deploy
    logStep('MANIFEST', 'Copying SDF manifest files...');
    fs.copyFileSync(
        path.join(__dirname, '..', 'src', 'manifest.xml'),
        path.join(CONFIG.bundleDir, 'manifest.xml')
    );
    fs.copyFileSync(
        path.join(__dirname, '..', 'src', 'deploy.xml'),
        path.join(CONFIG.bundleDir, 'deploy.xml')
    );

    // Generate bundle manifest
    logStep('BUNDLE', 'Generating bundle manifest...');
    const bundleManifest = generateBundleManifest(processedFiles);
    fs.writeFileSync(
        path.join(CONFIG.distDir, 'bundle-manifest.json'),
        JSON.stringify(bundleManifest, null, 2)
    );

    // Generate installation instructions
    logStep('DOCS', 'Generating installation documentation...');
    const instructions = generateInstallInstructions(bundleManifest);
    fs.writeFileSync(
        path.join(CONFIG.distDir, 'INSTALL.txt'),
        instructions
    );

    // Generate bundle creation helper script
    const helperScript = generateBundleCreationScript(bundleManifest);
    fs.writeFileSync(
        path.join(CONFIG.distDir, 'FC_BundleHelper.js'),
        helperScript
    );

    // Summary
    const duration = ((Date.now() - startTime) / 1000).toFixed(2);

    log('\n' + '='.repeat(60), colors.green);
    log('  BUILD COMPLETE', colors.bright);
    log('='.repeat(60), colors.green);

    log(`\nProcessed Files: ${processedFiles.length}`);
    log(`  - Hidden (server-side): ${processedFiles.filter(f => f.hideInBundle).length}`);
    log(`  - Obfuscated (client-side): ${processedFiles.filter(f => f.obfuscated).length}`);
    log(`  - Standard: ${processedFiles.filter(f => !f.hideInBundle && !f.obfuscated).length}`);
    log(`\nOutput: ${CONFIG.distDir}`);
    log(`Duration: ${duration}s\n`);

    return bundleManifest;
}

// CLI handling
const args = process.argv.slice(2);
const options = {
    obfuscate: !args.includes('--bundle'),
    bundle: !args.includes('--obfuscate')
};

if (args.includes('--help')) {
    console.log(`
Flux Capture Distribution Builder

Usage:
  node build-distribution.js [options]

Options:
  --bundle      Package only (skip obfuscation)
  --obfuscate   Obfuscate only (skip packaging)
  --help        Show this help

Output:
  dist/                      Distribution directory
  dist/bundle/               SDF project ready for deployment
  dist/bundle-manifest.json  Bundle configuration
  dist/INSTALL.txt           Installation instructions
  dist/FC_BundleHelper.js    NetSuite script to configure bundle
`);
    process.exit(0);
}

build(options).catch(err => {
    logError(err.message);
    process.exit(1);
});
