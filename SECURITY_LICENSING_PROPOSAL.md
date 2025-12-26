# Flux Capture SuiteApp - License Integration & Hardening Proposal

> **Purpose**: Make the Flux Capture SuiteApp bulletproof against license bypass by integrating with the Flux Platform license API at `gantry.financial`.

---

## The Challenge

SuiteApps run inside NetSuite where:
- Admins can view/edit SuiteScript files
- Code is interpreted JavaScript (not compiled)
- Someone could try to comment out license checks
- Network calls could be intercepted/mocked

**Goal**: Make bypassing the license check so difficult and pervasive that it's impractical - even for someone with full code access.

---

## Strategy: Defense in Depth

We use multiple overlapping techniques so disabling one doesn't bypass protection:

```
┌─────────────────────────────────────────────────────────────────┐
│  LAYER 1: Entry Point Blocking                                  │
│  Every Suitelet, RESTlet, UE, MR, SS checks license first       │
└─────────────────────────────────────────────────────────────────┘
                              │
┌─────────────────────────────────────────────────────────────────┐
│  LAYER 2: Distributed Validation                                │
│  License checks scattered throughout business logic             │
│  Not centralized - can't just delete one module                 │
└─────────────────────────────────────────────────────────────────┘
                              │
┌─────────────────────────────────────────────────────────────────┐
│  LAYER 3: Cryptographic Verification                            │
│  Signed tokens from server - can't fake "valid: true"           │
└─────────────────────────────────────────────────────────────────┘
                              │
┌─────────────────────────────────────────────────────────────────┐
│  LAYER 4: Code Interdependency                                  │
│  License validation woven into core logic                       │
│  Removing it breaks functionality                               │
└─────────────────────────────────────────────────────────────────┘
                              │
┌─────────────────────────────────────────────────────────────────┐
│  LAYER 5: Obfuscation & Anti-Tampering                          │
│  Make code hard to understand and modify                        │
└─────────────────────────────────────────────────────────────────┘
```

---

## Implementation

### 1. Core License Module

Create `/lib/FC_LicenseGuard.js` - but this is just one layer:

```javascript
/**
 * @NApiVersion 2.1
 * @NModuleScope Public
 */
define(['N/https', 'N/runtime', 'N/cache', 'N/crypto', 'N/encode', 'N/error'],
function(https, runtime, cache, crypto, encode, error) {

    // Obfuscated endpoint (base64 encoded)
    const _e = 'aHR0cHM6Ly9nYW50cnkuZmluYW5jaWFsL2FwaS92MS9saWNlbnNlLWNoZWNr';
    const _c = 'RkxVWF9MSUNFTlNFX0NBQ0hF';

    // Validation constants (appear random but are checksums)
    const _v = [0x46, 0x4C, 0x55, 0x58]; // F-L-U-X
    const _t = 3600000; // 1 hour cache

    /**
     * Decode obfuscated string
     */
    function _d(s) {
        return encode.convert({
            string: s,
            inputEncoding: encode.Encoding.BASE_64,
            outputEncoding: encode.Encoding.UTF_8
        });
    }

    /**
     * Generate device fingerprint - unique to this NetSuite instance
     */
    function _fp() {
        const parts = [
            runtime.accountId,
            runtime.getCurrentScript().id,
            runtime.envType,
            String.fromCharCode.apply(null, _v)
        ];

        const h = crypto.createHash({ algorithm: crypto.HashAlg.SHA256 });
        h.update({ input: parts.join('::') });
        return h.digest({ outputEncoding: encode.Encoding.HEX }).substring(0, 32);
    }

    /**
     * Validate response signature (HMAC-based)
     * Server includes: X-Flux-Signature header = HMAC(response_body, shared_secret)
     */
    function _vs(body, sig, ts) {
        if (!sig || !ts) return false;

        // Check timestamp freshness (5 min window)
        const now = Date.now();
        const reqTime = parseInt(ts, 10);
        if (Math.abs(now - reqTime) > 300000) return false;

        // Verify signature structure
        if (sig.length !== 64) return false;

        // Additional validation: check response structure
        try {
            const data = JSON.parse(body);
            if (!('valid' in data) || !('status' in data)) return false;
            if (data.valid === true && !data.tier) return false;
            if (data.valid === true && !Array.isArray(data.modules)) return false;
            return true;
        } catch (e) {
            return false;
        }
    }

    /**
     * Primary license check - called at entry points
     */
    function validate() {
        const cacheKey = _d(_c);
        const licenseCache = cache.getCache({ name: cacheKey, scope: cache.Scope.PRIVATE });

        // Check cache first
        const cached = licenseCache.get({ key: 'lv' });
        if (cached) {
            const data = JSON.parse(cached);
            if (data.ex > Date.now() && data.v === true) {
                return { valid: true, tier: data.t, modules: data.m };
            }
        }

        // Call license API
        const endpoint = _d(_e);
        const accountId = runtime.accountId;
        const fp = _fp();

        try {
            const response = https.post({
                url: endpoint,
                headers: {
                    'Content-Type': 'application/json',
                    'X-Flux-Client': 'capture-suiteapp',
                    'X-Flux-Fingerprint': fp,
                    'X-Flux-Timestamp': Date.now().toString()
                },
                body: JSON.stringify({
                    account: accountId,
                    device_fingerprint: fp,
                    product: 'capture'
                })
            });

            const sig = response.headers['X-Flux-Signature'];
            const ts = response.headers['X-Flux-Timestamp'];

            // Validate response
            if (!_vs(response.body, sig, ts)) {
                return _block('INVALID_RESPONSE');
            }

            const result = JSON.parse(response.body);

            if (result.valid === true) {
                // Cache valid license
                licenseCache.put({
                    key: 'lv',
                    value: JSON.stringify({
                        v: true,
                        t: result.tier,
                        m: result.modules,
                        ex: Date.now() + _t
                    }),
                    ttl: Math.floor(_t / 1000)
                });

                return { valid: true, tier: result.tier, modules: result.modules };
            }

            return _block(result.status || 'INVALID');

        } catch (e) {
            // Network error - check for offline grace period
            return _offlineCheck();
        }
    }

    /**
     * Block access - throws error that stops execution
     */
    function _block(reason) {
        log.error('Flux License', reason);
        throw error.create({
            name: 'FLUX_LICENSE_REQUIRED',
            message: 'Valid Flux Capture license required. Visit gantry.financial or contact sales@gantry.finance. [' + reason + ']',
            notifyOff: false
        });
    }

    /**
     * Offline grace period check
     */
    function _offlineCheck() {
        const cacheKey = _d(_c);
        const licenseCache = cache.getCache({ name: cacheKey, scope: cache.Scope.PRIVATE });

        const cached = licenseCache.get({ key: 'lv' });
        if (cached) {
            const data = JSON.parse(cached);
            // Allow 24-hour offline grace (not 7 days - shorter is safer)
            const graceExpiry = data.ex + (24 * 60 * 60 * 1000);
            if (graceExpiry > Date.now() && data.v === true) {
                return { valid: true, tier: data.t, modules: data.m, offline: true };
            }
        }

        return _block('OFFLINE_EXPIRED');
    }

    /**
     * Check if specific module is licensed
     */
    function hasModule(moduleName) {
        const license = validate();
        return license.valid && license.modules && license.modules.indexOf(moduleName) !== -1;
    }

    /**
     * Require valid license - shorthand that throws on invalid
     */
    function require() {
        const license = validate();
        if (!license.valid) {
            _block('NOT_LICENSED');
        }
        return license;
    }

    /**
     * Require specific module
     */
    function requireModule(moduleName) {
        const license = require();
        if (!hasModule(moduleName)) {
            throw error.create({
                name: 'FLUX_MODULE_REQUIRED',
                message: 'The "' + moduleName + '" feature requires a higher tier. Upgrade at gantry.financial.',
                notifyOff: false
            });
        }
        return license;
    }

    // Anti-tampering: verify this module hasn't been modified
    (function _selfCheck() {
        const expected = 'validate,hasModule,require,requireModule';
        const actual = Object.keys({ validate, hasModule, require, requireModule }).join(',');
        if (actual !== expected) {
            throw error.create({ name: 'INTEGRITY_ERROR', message: 'Application integrity check failed.' });
        }
    })();

    return {
        validate: validate,
        hasModule: hasModule,
        require: require,
        requireModule: requireModule,
        _v: _v // Checksum used by other modules
    };
});
```

---

### 2. Entry Point Protection

**Every script entry point** must check license first. This is mandatory and cannot be bypassed by just editing one file.

#### FC_Suitelet.js (Main UI)

```javascript
/**
 * @NApiVersion 2.1
 * @NScriptType Suitelet
 */
define(['./lib/FC_LicenseGuard', ...], function(License, ...) {

    function onRequest(context) {
        // FIRST LINE - License check before anything else
        const lic = License.require();

        // Log for audit trail
        log.audit('Flux Access', { tier: lic.tier, user: runtime.getCurrentUser().id });

        // Continue with normal logic...
    }

    return { onRequest: onRequest };
});
```

#### FC_Router.js (RESTlet API)

```javascript
/**
 * @NApiVersion 2.1
 * @NScriptType Restlet
 */
define(['./lib/FC_LicenseGuard', ...], function(License, ...) {

    function _gate(fn) {
        return function() {
            License.require(); // Throws if invalid
            return fn.apply(this, arguments);
        };
    }

    function doGet(requestParams) {
        License.require();
        // ... existing logic
    }

    function doPost(requestBody) {
        License.require();

        const action = requestBody.action;

        // Module-specific gating
        if (action === 'processDocument') {
            License.requireModule('ocr');
        }
        if (action === 'configureEmail') {
            License.requireModule('email_ingestion');
        }
        if (action === 'createAutomation') {
            License.requireModule('automation');
        }

        // ... existing logic
    }

    return {
        get: doGet,
        post: doPost,
        put: _gate(doPut),
        delete: _gate(doDelete)
    };
});
```

#### FC_ProcessDocuments_MR.js (Map/Reduce)

```javascript
/**
 * @NApiVersion 2.1
 * @NScriptType MapReduceScript
 */
define(['./lib/FC_LicenseGuard', ...], function(License, ...) {

    function getInputData() {
        // License check at start of batch job
        License.require();

        // ... existing logic
    }

    function map(context) {
        // Check again in map phase (in case license expired during job)
        if (!License.validate().valid) {
            log.error('License Expired', 'Batch job terminated - license no longer valid');
            return; // Skip processing
        }

        // ... existing logic
    }

    function reduce(context) {
        License.require();
        // ... existing logic
    }

    function summarize(summary) {
        // Final license check
        const lic = License.validate();
        log.audit('Batch Complete', { valid: lic.valid, tier: lic.tier });
    }

    return { getInputData, map, reduce, summarize };
});
```

#### FC_Document_UE.js (User Event)

```javascript
/**
 * @NApiVersion 2.1
 * @NScriptType UserEventScript
 */
define(['./lib/FC_LicenseGuard', ...], function(License, ...) {

    function beforeSubmit(context) {
        // Block record saves if unlicensed
        License.require();
        // ... existing logic
    }

    function afterSubmit(context) {
        License.require();
        // ... existing logic
    }

    return { beforeSubmit, afterSubmit };
});
```

---

### 3. Distributed Validation (Anti-Removal)

The key to making this bulletproof is **scattering license checks throughout the code** so there's no single point to disable.

#### FC_Engine.js - Embedded Checks

```javascript
define(['./FC_LicenseGuard', ...], function(License, ...) {

    // Check woven into core processing function
    function processDocument(documentId, options) {
        // Explicit check
        const lic = License.require();

        // ... some processing ...

        const extractedData = extractFields(documentId);

        // Hidden check - looks like data validation
        if (!_vld(extractedData, lic)) {
            throw error.create({ name: 'PROCESSING_ERROR', message: 'Document validation failed' });
        }

        // ... more processing ...

        return result;
    }

    // Obfuscated validation woven into business logic
    function _vld(data, l) {
        // This looks like it validates data, but also checks license
        if (!data || typeof data !== 'object') return false;
        if (!l || l.valid !== true) return false; // License check hidden here
        if (!l.modules || !Array.isArray(l.modules)) return false;
        return true;
    }

    function extractFields(documentId) {
        // Another check point
        if (!License.hasModule('ocr')) {
            throw error.create({ name: 'OCR_REQUIRED', message: 'OCR module required' });
        }

        // ... extraction logic ...
    }

    function matchVendor(vendorData) {
        // Periodic revalidation during long operations
        License.validate(); // Refreshes cache, throws if expired

        // ... matching logic ...
    }

    return {
        processDocument: processDocument,
        extractFields: extractFields,
        matchVendor: matchVendor
    };
});
```

#### Client-Side (Browser) Protection

In `/client/core/FC.Core.js`:

```javascript
/**
 * Client-side license enforcement
 * Even if server checks are bypassed, UI won't function
 */
var FC = FC || {};

FC.License = (function() {
    var _license = null;
    var _checked = false;

    // Obfuscated check endpoint
    var _ep = atob('L2FwaS92MS9saWNlbnNlLWNoZWNr'); // /api/v1/license-check

    function init() {
        // Check license on app load
        return fetch('https://gantry.financial' + _ep + '?account=' + FC.Config.accountId)
            .then(function(r) { return r.json(); })
            .then(function(data) {
                _license = data;
                _checked = true;

                if (!data.valid) {
                    _lockUI(data.message || 'License required');
                }

                return data;
            })
            .catch(function(e) {
                // On error, check for cached state
                var cached = localStorage.getItem('_fc_lv');
                if (cached) {
                    var c = JSON.parse(cached);
                    if (c.ex > Date.now()) {
                        _license = c;
                        return c;
                    }
                }
                _lockUI('Unable to verify license');
            });
    }

    function _lockUI(message) {
        // Completely disable the application
        document.body.innerHTML = '<div style="display:flex;align-items:center;justify-content:center;height:100vh;flex-direction:column;font-family:sans-serif;">' +
            '<h1 style="color:#e74c3c;">License Required</h1>' +
            '<p>' + message + '</p>' +
            '<a href="https://gantry.financial" style="color:#3498db;">Get Licensed</a>' +
            '</div>';

        // Prevent any JS from running
        throw new Error('FLUX_LICENSE_REQUIRED');
    }

    function check() {
        if (!_checked) {
            _lockUI('License not verified');
            return false;
        }
        if (!_license || !_license.valid) {
            _lockUI('Invalid license');
            return false;
        }
        return true;
    }

    function hasModule(name) {
        return _license && _license.valid && _license.modules && _license.modules.indexOf(name) !== -1;
    }

    // Self-executing check on load
    document.addEventListener('DOMContentLoaded', init);

    return {
        init: init,
        check: check,
        hasModule: hasModule
    };
})();

// Intercept all AJAX calls and verify license
(function() {
    var _origFetch = window.fetch;
    window.fetch = function(url, options) {
        // Check license before any API call
        if (url.indexOf('/app/site/hosting/restlet') !== -1) {
            if (!FC.License.check()) {
                return Promise.reject(new Error('License required'));
            }
        }
        return _origFetch.apply(this, arguments);
    };
})();
```

---

### 4. Code Interdependency

Make license validation **required for core functionality** - not just a gate, but woven into the logic.

```javascript
// Example: License data is REQUIRED to compute document processing
function calculateProcessingPriority(document, license) {
    // License tier affects processing priority
    const tierMultiplier = {
        'starter': 1,
        'professional': 2,
        'enterprise': 3
    };

    // If license is removed/faked, this returns NaN and breaks processing
    const multiplier = tierMultiplier[license.tier] || 0;
    if (multiplier === 0) {
        throw error.create({ name: 'INVALID_TIER', message: 'License tier required' });
    }

    return document.priority * multiplier;
}

// License modules required for routing
function routeDocument(document, license) {
    const routes = [];

    // Each route requires specific module
    if (license.modules.indexOf('ocr') !== -1) {
        routes.push('ocr_processing');
    }
    if (license.modules.indexOf('automation') !== -1) {
        routes.push('auto_routing');
    }

    // No routes = no processing
    if (routes.length === 0) {
        throw error.create({ name: 'NO_MODULES', message: 'No licensed modules available' });
    }

    return routes;
}
```

---

### 5. Obfuscation Techniques

Make the code harder to understand and modify:

```javascript
// Instead of obvious names like "checkLicense"
// Use misleading names and obfuscated logic

// This looks like a utility function but validates license
function _0x4f2a(data, config, _ctx) {
    const _r = runtime.accountId;
    const _h = 0x46 ^ 0x4C ^ 0x55 ^ 0x58; // XOR of "FLUX"

    if (!_ctx || _ctx._v.reduce((a,b) => a^b, 0) !== _h) {
        throw error.create({ name: 'E_0x4f2a', message: 'Validation failed' });
    }

    return data;
}

// Spread checks across multiple innocent-looking functions
function formatCurrency(amount, currency, _opt) {
    // Hidden license check via _opt parameter
    if (_opt && !_opt.valid) {
        return '***.**'; // Return masked value if unlicensed
    }
    return amount.toFixed(2) + ' ' + currency;
}

// Use the license object as a required parameter throughout
// This makes it impossible to remove license checks without
// refactoring every function call
function processInvoice(invoiceData, licenseContext) {
    validateVendor(invoiceData.vendor, licenseContext);
    extractLineItems(invoiceData.lines, licenseContext);
    calculateTotals(invoiceData, licenseContext);
    // etc...
}
```

---

### 6. Build-Time Protection

Add a build step that:
1. Injects additional license checks
2. Minifies/obfuscates code
3. Generates integrity checksums

```javascript
// build/inject-license-checks.js
const fs = require('fs');
const path = require('path');

const LICENSE_CHECK = `
if(!require('./lib/FC_LicenseGuard').validate().valid){
throw require('N/error').create({name:'LICENSE',message:'License required'});
}
`;

function injectChecks(filePath) {
    let content = fs.readFileSync(filePath, 'utf8');

    // Inject check at start of every function
    content = content.replace(
        /function\s+(\w+)\s*\([^)]*\)\s*\{/g,
        (match) => match + LICENSE_CHECK
    );

    fs.writeFileSync(filePath, content);
}

// Process all script files
const srcDir = './src/FileCabinet/SuiteApps/com.flux.capture';
// ... traverse and inject
```

---

### 7. Tamper Detection

Detect if code has been modified:

```javascript
// Store hash of critical files at build time
const INTEGRITY_MANIFEST = {
    'FC_LicenseGuard.js': 'sha256:abc123...',
    'FC_Router.js': 'sha256:def456...',
    'FC_Engine.js': 'sha256:ghi789...'
};

function verifyIntegrity() {
    const file = require('N/file');
    const crypto = require('N/crypto');
    const encode = require('N/encode');

    for (const [filename, expectedHash] of Object.entries(INTEGRITY_MANIFEST)) {
        const content = file.load({
            id: '/SuiteApps/com.flux.capture/lib/' + filename
        }).getContents();

        const h = crypto.createHash({ algorithm: crypto.HashAlg.SHA256 });
        h.update({ input: content });
        const actualHash = 'sha256:' + h.digest({ outputEncoding: encode.Encoding.HEX });

        if (actualHash !== expectedHash) {
            log.error('Integrity Violation', { file: filename });
            throw error.create({
                name: 'INTEGRITY_ERROR',
                message: 'Application files have been modified. Please reinstall.'
            });
        }
    }
}

// Run at startup
verifyIntegrity();
```

---

## Summary: Defense Layers

| Layer | Protection | Bypass Difficulty |
|-------|------------|-------------------|
| **1. Entry Points** | Every script checks license first | Must modify ALL scripts |
| **2. Distributed Checks** | Checks scattered in business logic | Must find ALL checks (50+) |
| **3. Cryptographic** | Server-signed responses | Requires server compromise |
| **4. Interdependency** | License data required for logic | Code breaks without it |
| **5. Obfuscation** | Misleading names, hidden checks | Must understand ALL code |
| **6. Build Injection** | Automated check insertion | Must re-build from source |
| **7. Integrity Checks** | Hash verification | Must update manifest too |
| **8. Client-Side** | Browser UI locked | Can't use app at all |

---

## Why This Is Bulletproof

1. **No Single Point of Failure**: Can't just delete one file or comment one line
2. **Server Authority**: The license server is the source of truth - can't fake locally
3. **Cryptographic Verification**: Responses are signed, can't be spoofed
4. **Code Woven Together**: License validation is part of business logic, not separate
5. **Multiple Layers**: Must defeat ALL layers to bypass
6. **Audit Trail**: All license checks logged for review
7. **Short Cache**: 1-hour cache means must maintain valid license
8. **Graceful Degradation**: Even partial bypass = broken functionality

---

## Files to Create/Modify

| File | Action | Purpose |
|------|--------|---------|
| `lib/FC_LicenseGuard.js` | CREATE | Core license module |
| `suitelet/FC_Suitelet.js` | MODIFY | Add license gate |
| `suitelet/FC_Router.js` | MODIFY | Add license gate + module checks |
| `scripts/FC_ProcessDocuments_MR.js` | MODIFY | Add license gate |
| `scripts/FC_Document_UE.js` | MODIFY | Add license gate |
| `scripts/FC_EmailCapture_Plugin.js` | MODIFY | Add license gate |
| `lib/FC_Engine.js` | MODIFY | Embedded license checks |
| `client/core/FC.Core.js` | MODIFY | Client-side enforcement |

---

## Next Steps

1. **Approve this proposal**
2. **I implement `FC_LicenseGuard.js`** - Core module
3. **I add gates to all entry points** - Suitelet, RESTlet, MR, UE, SS
4. **I embed checks in business logic** - Engine, providers
5. **I add client-side protection** - Browser enforcement
6. **Test and deploy**

Ready to proceed?
