#!/usr/bin/env node
/**
 * Flux Capture - Installation Verification Script
 *
 * This script verifies that Flux Capture is properly installed in a NetSuite account.
 * It's designed to be called from your website's installation portal.
 *
 * Usage:
 *   node verify-installation.js --account TSTDRV123456 --restlet-url <url>
 */

const https = require('https');
const crypto = require('crypto');

// Verification endpoint configuration
const CONFIG = {
    timeout: 30000,
    retries: 3,
    retryDelay: 2000
};

// Expected components for verification
const EXPECTED_COMPONENTS = {
    scripts: [
        'customscript_fc_suitelet',
        'customscript_fc_router',
        'customscript_fc_process_docs_mr',
        'customscript_fc_document_ue',
        'customscript_fc_email_capture',
        'customscript_fc_continue_polling'
    ],
    customRecords: [
        'customrecord_flux_document',
        'customrecord_flux_config'
    ],
    deployments: [
        'customdeploy_fc_suitelet',
        'customdeploy_fc_router',
        'customdeploy_fc_process_docs_mr',
        'customdeploy_fc_document_ue',
        'customdeploy_fc_continue_polling'
    ]
};

/**
 * Generate OAuth 1.0 signature for NetSuite REST API
 * This is used for TBA (Token Based Authentication)
 */
function generateOAuth1Signature(params) {
    const {
        url,
        method,
        consumerKey,
        consumerSecret,
        tokenId,
        tokenSecret,
        realm
    } = params;

    const timestamp = Math.floor(Date.now() / 1000);
    const nonce = crypto.randomBytes(16).toString('hex');

    const oauthParams = {
        oauth_consumer_key: consumerKey,
        oauth_nonce: nonce,
        oauth_signature_method: 'HMAC-SHA256',
        oauth_timestamp: timestamp,
        oauth_token: tokenId,
        oauth_version: '1.0'
    };

    // Create signature base string
    const sortedParams = Object.keys(oauthParams).sort().map(key =>
        `${encodeURIComponent(key)}=${encodeURIComponent(oauthParams[key])}`
    ).join('&');

    const baseString = [
        method.toUpperCase(),
        encodeURIComponent(url),
        encodeURIComponent(sortedParams)
    ].join('&');

    // Create signing key
    const signingKey = `${encodeURIComponent(consumerSecret)}&${encodeURIComponent(tokenSecret)}`;

    // Generate signature
    const signature = crypto.createHmac('sha256', signingKey)
        .update(baseString)
        .digest('base64');

    oauthParams.oauth_signature = signature;

    // Build Authorization header
    const authHeader = 'OAuth realm="' + realm + '",' +
        Object.keys(oauthParams).sort().map(key =>
            `${key}="${encodeURIComponent(oauthParams[key])}"`
        ).join(',');

    return authHeader;
}

/**
 * Call the Flux Router RESTlet to verify installation
 */
async function verifyViaRestlet(accountId, restletUrl, credentials) {
    return new Promise((resolve, reject) => {
        const url = new URL(restletUrl);

        const authHeader = generateOAuth1Signature({
            url: restletUrl,
            method: 'GET',
            ...credentials,
            realm: accountId
        });

        const options = {
            hostname: url.hostname,
            path: url.pathname + '?action=health',
            method: 'GET',
            headers: {
                'Authorization': authHeader,
                'Content-Type': 'application/json'
            },
            timeout: CONFIG.timeout
        };

        const req = https.request(options, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
                try {
                    const result = JSON.parse(data);
                    resolve({
                        success: res.statusCode === 200,
                        statusCode: res.statusCode,
                        data: result
                    });
                } catch (e) {
                    resolve({
                        success: false,
                        statusCode: res.statusCode,
                        error: 'Invalid JSON response'
                    });
                }
            });
        });

        req.on('error', reject);
        req.on('timeout', () => reject(new Error('Request timeout')));
        req.end();
    });
}

/**
 * Simple verification via license check endpoint
 * This doesn't require credentials - just checks if the account responds
 */
async function verifyViaLicenseCheck(accountId) {
    return new Promise((resolve, reject) => {
        const postData = JSON.stringify({
            account: accountId,
            product: 'capture',
            client_version: '1.0.0',
            action: 'verify_installation'
        });

        const options = {
            hostname: 'fluxfornetsuite.com',
            path: '/api/v1/verify-installation',
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Content-Length': Buffer.byteLength(postData)
            },
            timeout: CONFIG.timeout
        };

        const req = https.request(options, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
                try {
                    const result = JSON.parse(data);
                    resolve(result);
                } catch (e) {
                    resolve({
                        installed: false,
                        error: 'Invalid response'
                    });
                }
            });
        });

        req.on('error', reject);
        req.on('timeout', () => reject(new Error('Request timeout')));
        req.write(postData);
        req.end();
    });
}

/**
 * Generate installation report
 */
function generateReport(verification) {
    const lines = [
        '',
        '=' .repeat(60),
        '  FLUX CAPTURE - INSTALLATION VERIFICATION REPORT',
        '='.repeat(60),
        '',
        `Account: ${verification.accountId}`,
        `Verified: ${new Date().toISOString()}`,
        '',
        'STATUS: ' + (verification.success ? 'INSTALLED' : 'NOT INSTALLED'),
        ''
    ];

    if (verification.components) {
        lines.push('COMPONENTS:');
        for (const [category, items] of Object.entries(verification.components)) {
            lines.push(`  ${category}:`);
            for (const item of items) {
                const status = item.found ? '[OK]' : '[MISSING]';
                lines.push(`    ${status} ${item.id}`);
            }
        }
    }

    if (verification.health) {
        lines.push('');
        lines.push('HEALTH CHECK:');
        lines.push(`  Status: ${verification.health.status}`);
        lines.push(`  Version: ${verification.health.version || 'Unknown'}`);
        if (verification.health.license) {
            lines.push(`  License: ${verification.health.license.valid ? 'Valid' : 'Invalid'}`);
        }
    }

    if (verification.error) {
        lines.push('');
        lines.push('ERROR:');
        lines.push(`  ${verification.error}`);
    }

    lines.push('');
    lines.push('='.repeat(60));
    lines.push('');

    return lines.join('\n');
}

/**
 * Main verification function
 */
async function verify(options) {
    console.log('\nFlux Capture Installation Verification');
    console.log('=' .repeat(40));

    const result = {
        accountId: options.account,
        timestamp: new Date().toISOString(),
        success: false,
        components: {},
        health: null,
        error: null
    };

    try {
        if (options.restletUrl && options.consumerKey) {
            // Full verification via RESTlet
            console.log('Verifying via RESTlet...');
            const restletResult = await verifyViaRestlet(options.account, options.restletUrl, {
                consumerKey: options.consumerKey,
                consumerSecret: options.consumerSecret,
                tokenId: options.tokenId,
                tokenSecret: options.tokenSecret
            });

            if (restletResult.success) {
                result.success = true;
                result.health = restletResult.data;
            } else {
                result.error = `RESTlet returned status ${restletResult.statusCode}`;
            }
        } else {
            // Simple verification via license check
            console.log('Verifying via license check endpoint...');
            const licenseResult = await verifyViaLicenseCheck(options.account);
            result.success = licenseResult.installed === true;
            result.health = licenseResult.health;
            if (!result.success && licenseResult.error) {
                result.error = licenseResult.error;
            }
        }
    } catch (e) {
        result.error = e.message;
    }

    // Generate and print report
    const report = generateReport(result);
    console.log(report);

    return result;
}

// CLI handling
function parseArgs() {
    const args = process.argv.slice(2);
    const options = {};

    for (let i = 0; i < args.length; i++) {
        switch (args[i]) {
            case '--account':
                options.account = args[++i];
                break;
            case '--restlet-url':
                options.restletUrl = args[++i];
                break;
            case '--consumer-key':
                options.consumerKey = args[++i];
                break;
            case '--consumer-secret':
                options.consumerSecret = args[++i];
                break;
            case '--token-id':
                options.tokenId = args[++i];
                break;
            case '--token-secret':
                options.tokenSecret = args[++i];
                break;
            case '--help':
                console.log(`
Flux Capture Installation Verification

Usage:
  node verify-installation.js --account <ACCOUNT_ID> [options]

Options:
  --account <id>           NetSuite account ID (required)
  --restlet-url <url>      FC Router RESTlet URL (for full verification)
  --consumer-key <key>     OAuth consumer key
  --consumer-secret <sec>  OAuth consumer secret
  --token-id <id>          OAuth token ID
  --token-secret <sec>     OAuth token secret
  --help                   Show this help

Examples:
  # Simple verification (uses license check endpoint)
  node verify-installation.js --account TSTDRV123456

  # Full verification with TBA credentials
  node verify-installation.js --account TSTDRV123456 \\
    --restlet-url "https://123456.restlets.api.netsuite.com/..." \\
    --consumer-key "abc..." --consumer-secret "xyz..." \\
    --token-id "123..." --token-secret "456..."
`);
                process.exit(0);
        }
    }

    return options;
}

const options = parseArgs();

if (!options.account) {
    console.error('Error: --account is required');
    process.exit(1);
}

verify(options).then(result => {
    process.exit(result.success ? 0 : 1);
}).catch(err => {
    console.error('Verification failed:', err.message);
    process.exit(1);
});
