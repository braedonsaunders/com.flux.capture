# Flux Capture - Security & Licensing Integration Proposal

> **Purpose**: This document proposes a comprehensive security architecture for integrating license verification into Flux Capture, with hardening measures to prevent bypass, piracy, and unauthorized use.

---

## Executive Summary

The current `AUTHENTICATION_INTEGRATION_GUIDE.md` provides the foundation for license verification, but lacks security hardening. This proposal addresses:

1. **Server-side hardening** - Secure the license API against abuse
2. **Client-side protection** - Prevent tampering and bypass in the SuiteApp
3. **Multi-layer verification** - Defense in depth approach
4. **Runtime integrity checks** - Detect and respond to tampering
5. **Monitoring & analytics** - Track suspicious behavior

---

## Table of Contents

1. [Current Vulnerabilities](#1-current-vulnerabilities)
2. [Proposed Security Architecture](#2-proposed-security-architecture)
3. [Server-Side Hardening](#3-server-side-hardening)
4. [Client-Side Protection](#4-client-side-protection)
5. [License Verification Implementation](#5-license-verification-implementation)
6. [Anti-Tampering Measures](#6-anti-tampering-measures)
7. [Monitoring & Alerting](#7-monitoring--alerting)
8. [Implementation Plan](#8-implementation-plan)

---

## 1. Current Vulnerabilities

### 1.1 API-Level Vulnerabilities

| Vulnerability | Risk Level | Description |
|---------------|------------|-------------|
| **Unauthenticated API** | HIGH | `/api/v1/license-check` requires no authentication - anyone can probe any account |
| **No request signing** | HIGH | Requests can be forged or replayed |
| **No rate limiting** | MEDIUM | Vulnerable to enumeration attacks |
| **Predictable license format** | LOW | `GF-XXXX-XXXX-XXXX-XXXX` could theoretically be brute-forced |

### 1.2 Client-Side Vulnerabilities

| Vulnerability | Risk Level | Description |
|---------------|------------|-------------|
| **No license check in code** | CRITICAL | License validation is documented but NOT implemented |
| **Plain response handling** | HIGH | `valid: true` response can be spoofed locally |
| **No code integrity checks** | HIGH | SuiteScript files can be modified |
| **Offline exploitation** | MEDIUM | 7-day grace period can be exploited with time manipulation |
| **Cache manipulation** | MEDIUM | Cached license can be tampered with |

### 1.3 Business Logic Vulnerabilities

| Vulnerability | Risk Level | Description |
|---------------|------------|-------------|
| **Module array spoofing** | HIGH | Client could inject modules into cached response |
| **Tier escalation** | HIGH | No server-side enforcement at feature level |
| **License sharing** | MEDIUM | Same license can be used across unlimited instances |

---

## 2. Proposed Security Architecture

### 2.1 Defense in Depth Model

```
┌─────────────────────────────────────────────────────────────────────────┐
│                         LAYER 1: API GATEWAY                            │
│  • Request signing with HMAC                                            │
│  • Rate limiting per account/IP                                         │
│  • Request fingerprinting                                               │
└─────────────────────────────────────────────────────────────────────────┘
                                    │
┌─────────────────────────────────────────────────────────────────────────┐
│                       LAYER 2: LICENSE SERVER                           │
│  • Signed license tokens (JWT)                                          │
│  • Device binding                                                       │
│  • Usage tracking & limits                                              │
└─────────────────────────────────────────────────────────────────────────┘
                                    │
┌─────────────────────────────────────────────────────────────────────────┐
│                      LAYER 3: CLIENT VERIFICATION                       │
│  • Token signature validation                                           │
│  • Code integrity checks                                                │
│  • Runtime tamper detection                                             │
└─────────────────────────────────────────────────────────────────────────┘
                                    │
┌─────────────────────────────────────────────────────────────────────────┐
│                       LAYER 4: FEATURE GATING                           │
│  • Server-side feature enforcement                                      │
│  • Module-level access control                                          │
│  • Usage metering                                                       │
└─────────────────────────────────────────────────────────────────────────┘
```

### 2.2 Core Security Principles

1. **Zero Trust Client** - Never trust client-side validations alone
2. **Cryptographic Verification** - Use signatures, not plain booleans
3. **Server-Side Enforcement** - Critical features gated at API level
4. **Behavioral Detection** - Monitor for anomalous usage patterns
5. **Graceful Degradation** - Fail closed, not open

---

## 3. Server-Side Hardening

### 3.1 Signed License Tokens

Replace plain JSON responses with signed JWT tokens:

```typescript
// NEW: /api/v1/license-check response
{
  "token": "eyJhbGciOiJFUzI1NiIsInR5cCI6IkpXVCJ9...",
  "expires_in": 3600  // Token valid for 1 hour
}

// Token payload (signed, cannot be modified)
{
  "sub": "1234567",                    // NetSuite Account ID
  "iss": "gantry.financial",           // Issuer
  "iat": 1703548800,                   // Issued at
  "exp": 1703552400,                   // Expires (1 hour)
  "lic": {
    "valid": true,
    "status": "active",
    "tier": "professional",
    "modules": ["ocr", "email_ingestion", "automation", "api"],
    "license_expires": "2025-06-15T00:00:00.000Z"
  },
  "device": {
    "id": "hash_of_device_fingerprint",
    "bound_at": "2024-01-15T10:30:00.000Z"
  },
  "nonce": "random_request_nonce"
}
```

**Implementation (Server):**

```typescript
// File: /api/v1/license-check/route.ts

import { SignJWT, jwtVerify } from 'jose';

const LICENSE_SIGNING_KEY = new TextEncoder().encode(process.env.LICENSE_JWT_SECRET);

export async function POST(request: NextRequest) {
  const body = await request.json();
  const { account, license_key, device_fingerprint, nonce } = body;

  // Validate request
  if (!account || !device_fingerprint || !nonce) {
    return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
  }

  // Lookup license (existing logic)
  const license = await getLicenseByAccount(account);

  if (!license || license.status !== 'active') {
    // Return signed "invalid" token (cannot be forged)
    const token = await new SignJWT({
      sub: account,
      iss: 'gantry.financial',
      lic: { valid: false, status: license?.status || 'not_found' },
      nonce,
    })
      .setProtectedHeader({ alg: 'ES256' })
      .setIssuedAt()
      .setExpirationTime('1h')
      .sign(LICENSE_SIGNING_KEY);

    return NextResponse.json({ token, expires_in: 3600 });
  }

  // Check device binding
  const deviceHash = await hashDeviceFingerprint(device_fingerprint);
  const isDeviceBound = await checkDeviceBinding(license.id, deviceHash);

  if (!isDeviceBound) {
    // Check if device limit reached
    const deviceCount = await countBoundDevices(license.id);
    const maxDevices = getMaxDevicesForTier(license.tier); // e.g., starter=2, pro=5, enterprise=unlimited

    if (deviceCount >= maxDevices) {
      return NextResponse.json({
        error: 'device_limit_exceeded',
        message: `Maximum ${maxDevices} devices allowed for ${license.tier} tier`,
        devices_used: deviceCount,
      }, { status: 403 });
    }

    // Bind new device
    await bindDevice(license.id, deviceHash, device_fingerprint);
  }

  // Generate signed license token
  const token = await new SignJWT({
    sub: account,
    iss: 'gantry.financial',
    lic: {
      valid: true,
      status: 'active',
      tier: license.tier,
      modules: license.modules_enabled,
      license_expires: license.expires_at,
    },
    device: {
      id: deviceHash,
      bound_at: isDeviceBound ? isDeviceBound.bound_at : new Date().toISOString(),
    },
    nonce,
  })
    .setProtectedHeader({ alg: 'ES256' })
    .setIssuedAt()
    .setExpirationTime('1h')
    .sign(LICENSE_SIGNING_KEY);

  // Log validation for analytics
  await logLicenseCheck(license.id, deviceHash, 'success');

  return NextResponse.json({ token, expires_in: 3600 });
}
```

### 3.2 Request Signing (HMAC)

Require clients to sign requests to prevent tampering:

```typescript
// Client-side request signing
function signRequest(payload: object, timestamp: number, secret: string): string {
  const message = `${timestamp}.${JSON.stringify(payload)}`;
  return crypto.createHmac('sha256', secret).update(message).digest('hex');
}

// Request format
POST /api/v1/license-check
Headers:
  X-Flux-Timestamp: 1703548800
  X-Flux-Signature: hmac_sha256(timestamp + payload, shared_secret)
Body:
  { "account": "1234567", "device_fingerprint": "...", "nonce": "..." }
```

**Server-side validation:**

```typescript
function validateRequestSignature(request: NextRequest, body: object): boolean {
  const timestamp = parseInt(request.headers.get('X-Flux-Timestamp') || '0');
  const signature = request.headers.get('X-Flux-Signature');

  // Reject old requests (prevent replay)
  const now = Math.floor(Date.now() / 1000);
  if (Math.abs(now - timestamp) > 300) { // 5 minute window
    return false;
  }

  // Validate signature
  const expectedSignature = signRequest(body, timestamp, process.env.REQUEST_SIGNING_SECRET!);
  return crypto.timingSafeEqual(
    Buffer.from(signature || ''),
    Buffer.from(expectedSignature)
  );
}
```

### 3.3 Rate Limiting & Abuse Prevention

```typescript
// Rate limiting configuration
const RATE_LIMITS = {
  per_account: { requests: 100, window: '1h' },
  per_ip: { requests: 1000, window: '1h' },
  global: { requests: 100000, window: '1h' },
};

// Suspicious behavior triggers
const ABUSE_PATTERNS = {
  rapid_device_changes: { threshold: 5, window: '24h', action: 'flag_review' },
  failed_validations: { threshold: 10, window: '1h', action: 'temp_block' },
  license_key_probing: { threshold: 3, window: '1h', action: 'permanent_block' },
};
```

### 3.4 Database Schema Additions

```sql
-- Device binding table
CREATE TABLE public.license_devices (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  license_id UUID NOT NULL REFERENCES public.licenses(id) ON DELETE CASCADE,
  device_hash VARCHAR(64) NOT NULL,        -- SHA256 of fingerprint
  device_info JSONB DEFAULT '{}',          -- Browser, OS, etc.
  first_seen_at TIMESTAMPTZ DEFAULT NOW(),
  last_seen_at TIMESTAMPTZ DEFAULT NOW(),
  is_active BOOLEAN DEFAULT TRUE,
  UNIQUE(license_id, device_hash)
);

-- Validation audit log
CREATE TABLE public.license_validations (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  license_id UUID REFERENCES public.licenses(id),
  account_id VARCHAR(50),
  device_hash VARCHAR(64),
  ip_address INET,
  result VARCHAR(20) NOT NULL,             -- success, expired, not_found, blocked
  error_code VARCHAR(50),
  request_fingerprint JSONB,               -- User agent, headers hash
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Add indexes
CREATE INDEX idx_license_devices_license ON public.license_devices(license_id);
CREATE INDEX idx_license_validations_license ON public.license_validations(license_id);
CREATE INDEX idx_license_validations_device ON public.license_validations(device_hash);
CREATE INDEX idx_license_validations_created ON public.license_validations(created_at);

-- Add device limit to licenses
ALTER TABLE public.licenses ADD COLUMN max_devices INTEGER DEFAULT 2;
```

---

## 4. Client-Side Protection

### 4.1 License Verification Module

Create a new module for license verification in the SuiteApp:

```javascript
/**
 * Flux Capture License Verification Module
 * @NApiVersion 2.1
 * @NModuleScope Public
 * @module lib/license/FC_License
 */
define(['N/https', 'N/runtime', 'N/cache', 'N/crypto', 'N/encode', 'N/record'],
function(https, runtime, cache, crypto, encode, record) {

    const LICENSE_API_URL = 'https://gantry.financial/api/v1/license-check';
    const CACHE_NAME = 'FLUX_LICENSE_CACHE';
    const CACHE_TTL = 3600; // 1 hour
    const PUBLIC_KEY = '-----BEGIN PUBLIC KEY-----\nMFkwEwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAE...\n-----END PUBLIC KEY-----';

    /**
     * Generate device fingerprint for NetSuite environment
     * Combines multiple factors that are unique per installation
     */
    function generateDeviceFingerprint() {
        const accountId = runtime.accountId;
        const companyName = runtime.getCurrentUser().name;
        const roleId = runtime.getCurrentUser().role;
        const bundleId = runtime.getCurrentScript().bundleId;

        // Create composite fingerprint
        const fingerprintData = [
            accountId,
            companyName,
            roleId,
            bundleId,
            'flux_capture_v1'
        ].join('|');

        // Hash the fingerprint
        var hashObj = crypto.createHash({
            algorithm: crypto.HashAlg.SHA256
        });
        hashObj.update({
            input: fingerprintData
        });
        return hashObj.digest({ outputEncoding: encode.Encoding.HEX });
    }

    /**
     * Generate unique nonce for request
     */
    function generateNonce() {
        var randomBytes = crypto.createSecretKey({
            algorithm: crypto.SecretKeyType.AES,
            keyId: runtime.getCurrentScript().id + '_nonce_' + Date.now()
        });
        return randomBytes.guid;
    }

    /**
     * Validate JWT token signature using public key
     * @param {string} token - JWT token from server
     * @returns {Object|null} - Decoded payload or null if invalid
     */
    function validateTokenSignature(token) {
        try {
            var parts = token.split('.');
            if (parts.length !== 3) return null;

            var header = JSON.parse(encode.convert({
                string: parts[0],
                inputEncoding: encode.Encoding.BASE_64_URL_SAFE,
                outputEncoding: encode.Encoding.UTF_8
            }));

            var payload = JSON.parse(encode.convert({
                string: parts[1],
                inputEncoding: encode.Encoding.BASE_64_URL_SAFE,
                outputEncoding: encode.Encoding.UTF_8
            }));

            // Check expiration
            if (payload.exp && payload.exp < Math.floor(Date.now() / 1000)) {
                log.audit('License Token Expired', { exp: payload.exp });
                return null;
            }

            // Verify issuer
            if (payload.iss !== 'gantry.financial') {
                log.error('License Token Invalid Issuer', { iss: payload.iss });
                return null;
            }

            // Verify account ID matches
            if (payload.sub !== runtime.accountId) {
                log.error('License Token Account Mismatch', {
                    expected: runtime.accountId,
                    received: payload.sub
                });
                return null;
            }

            // Note: Full ES256 signature verification would require external library
            // For production, implement with jose or similar in Suitelet context

            return payload;
        } catch (e) {
            log.error('Token Validation Error', e.message);
            return null;
        }
    }

    /**
     * Get cached license or fetch new one
     * @returns {Object} License info with valid, tier, modules
     */
    function getLicense() {
        var licenseCache = cache.getCache({ name: CACHE_NAME, scope: cache.Scope.PRIVATE });

        // Try cache first
        var cachedLicense = licenseCache.get({ key: 'license_token' });
        if (cachedLicense) {
            var parsed = JSON.parse(cachedLicense);
            var payload = validateTokenSignature(parsed.token);
            if (payload && payload.lic) {
                return payload.lic;
            }
        }

        // Fetch fresh license
        return fetchAndCacheLicense(licenseCache);
    }

    /**
     * Fetch license from server and cache it
     */
    function fetchAndCacheLicense(licenseCache) {
        var accountId = runtime.accountId;
        var deviceFingerprint = generateDeviceFingerprint();
        var nonce = generateNonce();

        var requestBody = JSON.stringify({
            account: accountId,
            device_fingerprint: deviceFingerprint,
            nonce: nonce,
            client_version: '1.0.0',
            platform: 'netsuite_suiteapp'
        });

        try {
            var response = https.post({
                url: LICENSE_API_URL,
                headers: {
                    'Content-Type': 'application/json',
                    'Accept': 'application/json',
                    'X-Flux-Client': 'capture-suiteapp/1.0',
                    'X-Flux-Timestamp': Math.floor(Date.now() / 1000).toString()
                },
                body: requestBody
            });

            if (response.code !== 200) {
                log.error('License API Error', { code: response.code, body: response.body });
                return getOfflineFallback();
            }

            var result = JSON.parse(response.body);

            if (result.token) {
                var payload = validateTokenSignature(result.token);
                if (payload && payload.lic) {
                    // Cache the valid token
                    licenseCache.put({
                        key: 'license_token',
                        value: JSON.stringify({
                            token: result.token,
                            fetched_at: new Date().toISOString()
                        }),
                        ttl: result.expires_in || CACHE_TTL
                    });

                    // Store fallback in config for offline mode
                    storeOfflineFallback(payload.lic);

                    return payload.lic;
                }
            }

            return { valid: false, status: 'invalid_response' };

        } catch (e) {
            log.error('License Fetch Error', e.message);
            return getOfflineFallback();
        }
    }

    /**
     * Store license data for offline fallback (encrypted)
     */
    function storeOfflineFallback(licenseData) {
        try {
            var config = record.load({
                type: 'customrecord_flux_config',
                id: getConfigRecordId('license_fallback')
            });

            // Encrypt before storing
            var encrypted = encryptLicenseData(JSON.stringify({
                license: licenseData,
                stored_at: new Date().toISOString(),
                valid_until: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString() // 7 days
            }));

            config.setValue({ fieldId: 'custrecord_flux_cfg_data', value: encrypted });
            config.save();
        } catch (e) {
            log.debug('Offline Fallback Store', e.message);
        }
    }

    /**
     * Get offline fallback license (with strict validation)
     */
    function getOfflineFallback() {
        try {
            var config = record.load({
                type: 'customrecord_flux_config',
                id: getConfigRecordId('license_fallback')
            });

            var encrypted = config.getValue({ fieldId: 'custrecord_flux_cfg_data' });
            if (!encrypted) return { valid: false, status: 'offline_no_fallback' };

            var decrypted = decryptLicenseData(encrypted);
            var data = JSON.parse(decrypted);

            // Check if fallback is still valid (7-day window)
            if (new Date(data.valid_until) < new Date()) {
                log.audit('Offline Fallback Expired', data.valid_until);
                return { valid: false, status: 'offline_expired' };
            }

            // Return with offline indicator
            return Object.assign({}, data.license, { offline_mode: true });

        } catch (e) {
            log.debug('Offline Fallback Error', e.message);
            return { valid: false, status: 'offline_error' };
        }
    }

    /**
     * Check if specific module is enabled
     * @param {string} moduleName - Module to check (e.g., 'ocr', 'automation')
     * @returns {boolean}
     */
    function isModuleEnabled(moduleName) {
        var license = getLicense();
        if (!license || !license.valid) return false;
        return (license.modules || []).indexOf(moduleName) !== -1;
    }

    /**
     * Get current tier
     * @returns {string|null}
     */
    function getTier() {
        var license = getLicense();
        return license && license.valid ? license.tier : null;
    }

    /**
     * Require valid license - throws error if invalid
     * Use at entry points of protected functionality
     */
    function requireLicense() {
        var license = getLicense();
        if (!license || !license.valid) {
            throw error.create({
                name: 'FLUX_LICENSE_REQUIRED',
                message: 'Valid Flux Capture license required. Please contact sales@gantry.finance.',
                notifyOff: false
            });
        }
        return license;
    }

    /**
     * Require specific module - throws error if not available
     * @param {string} moduleName - Required module
     */
    function requireModule(moduleName) {
        var license = requireLicense();
        if (!isModuleEnabled(moduleName)) {
            throw error.create({
                name: 'FLUX_MODULE_REQUIRED',
                message: 'The ' + moduleName + ' module is not included in your ' + license.tier + ' tier. Upgrade at gantry.financial.',
                notifyOff: false
            });
        }
    }

    /**
     * Force refresh license (bypass cache)
     */
    function refreshLicense() {
        var licenseCache = cache.getCache({ name: CACHE_NAME, scope: cache.Scope.PRIVATE });
        licenseCache.remove({ key: 'license_token' });
        return getLicense();
    }

    // Encryption helpers (reuse from ProviderFactory pattern)
    function encryptLicenseData(data) {
        var sKey = crypto.createSecretKey({
            algorithm: crypto.SecretKeyType.AES,
            guid: runtime.accountId.replace(/[^a-zA-Z0-9]/g, '')
        });

        var cipher = crypto.createCipher({
            algorithm: crypto.EncryptionAlg.AES,
            key: sKey
        });

        cipher.update({ input: data });
        return cipher.final({ outputEncoding: encode.Encoding.HEX }).ciphertext;
    }

    function decryptLicenseData(encrypted) {
        var sKey = crypto.createSecretKey({
            algorithm: crypto.SecretKeyType.AES,
            guid: runtime.accountId.replace(/[^a-zA-Z0-9]/g, '')
        });

        var decipher = crypto.createDecipher({
            algorithm: crypto.EncryptionAlg.AES,
            key: sKey,
            iv: null
        });

        decipher.update({
            input: encrypted,
            inputEncoding: encode.Encoding.HEX
        });

        return decipher.final({ outputEncoding: encode.Encoding.UTF_8 }).cleartext;
    }

    function getConfigRecordId(key) {
        // Implementation to get config record ID by key
        // (similar to existing pattern in ProviderFactory)
        return 1; // Placeholder
    }

    return {
        getLicense: getLicense,
        isModuleEnabled: isModuleEnabled,
        getTier: getTier,
        requireLicense: requireLicense,
        requireModule: requireModule,
        refreshLicense: refreshLicense,
        generateDeviceFingerprint: generateDeviceFingerprint
    };
});
```

### 4.2 Integration Points

Integrate license checks at critical entry points:

```javascript
// FC_Router.js - Add license gate to API endpoints
define(['./lib/license/FC_License', ...], function(License, ...) {

    function routeRequest(context) {
        var action = context.request.parameters.action;

        // GATE: Check license for all actions
        try {
            var license = License.requireLicense();
            log.debug('License Valid', { tier: license.tier, modules: license.modules });
        } catch (e) {
            return createErrorResponse(e.name, e.message, 403);
        }

        // Module-specific gates
        switch(action) {
            case 'processDocument':
                License.requireModule('ocr');
                break;
            case 'configureEmailCapture':
                License.requireModule('email_ingestion');
                break;
            case 'createAutomationRule':
                License.requireModule('automation');
                break;
            case 'apiAccess':
                License.requireModule('api');
                break;
        }

        // Continue with normal routing...
    }
});
```

```javascript
// FC_Engine.js - Gate processing based on tier
define(['./license/FC_License', ...], function(License, ...) {

    function processDocument(documentId) {
        var license = License.requireLicense();

        // Check document limits by tier
        var monthlyLimit = getTierDocumentLimit(license.tier);
        var monthlyUsage = getMonthlyDocumentCount();

        if (monthlyUsage >= monthlyLimit) {
            throw error.create({
                name: 'FLUX_LIMIT_EXCEEDED',
                message: 'Monthly document limit (' + monthlyLimit + ') reached for ' + license.tier + ' tier.'
            });
        }

        // Continue processing...
    }

    function getTierDocumentLimit(tier) {
        var limits = {
            'starter': 100,
            'professional': 500,
            'enterprise': -1  // Unlimited
        };
        return limits[tier] || 0;
    }
});
```

---

## 5. License Verification Implementation

### 5.1 Verification Flow

```
┌─────────────┐     ┌─────────────────┐     ┌─────────────────┐
│   SuiteApp  │────▶│  License Cache  │────▶│   Return Cache  │
│   Request   │     │   (1hr TTL)     │     │   if Valid      │
└─────────────┘     └────────┬────────┘     └─────────────────┘
                             │ Cache Miss/Expired
                             ▼
                    ┌─────────────────┐
                    │  Generate       │
                    │  Device         │
                    │  Fingerprint    │
                    └────────┬────────┘
                             │
                             ▼
                    ┌─────────────────┐     ┌─────────────────┐
                    │  Call License   │────▶│  Validate JWT   │
                    │  API (HTTPS)    │     │  Signature      │
                    └─────────────────┘     └────────┬────────┘
                                                     │
                            ┌────────────────────────┴────────────────────┐
                            │                                              │
                            ▼                                              ▼
                   ┌─────────────────┐                          ┌─────────────────┐
                   │  Valid: Cache   │                          │  Invalid: Check │
                   │  & Store        │                          │  Offline        │
                   │  Fallback       │                          │  Fallback       │
                   └─────────────────┘                          └────────┬────────┘
                                                                         │
                                        ┌────────────────────────────────┴────────────────────────────────┐
                                        │                                                                  │
                                        ▼                                                                  ▼
                               ┌─────────────────┐                                              ┌─────────────────┐
                               │  Fallback Valid │                                              │  No Fallback    │
                               │  (< 7 days)     │                                              │  Block Access   │
                               │  Limited Mode   │                                              │  Show Upgrade   │
                               └─────────────────┘                                              └─────────────────┘
```

### 5.2 Verification Timing

| Event | Action |
|-------|--------|
| **SuiteApp Load** | Check license on first API call |
| **Before Processing** | Verify module access |
| **Hourly (Background)** | Refresh license token |
| **On Feature Access** | Check specific module |
| **On Error** | Force refresh and retry once |

### 5.3 Response to Invalid License

```javascript
/**
 * License enforcement response matrix
 */
const ENFORCEMENT_RESPONSES = {
    'not_found': {
        block: true,
        message: 'No valid license found. Purchase at gantry.financial.',
        allowTrial: true,
        trialDays: 14
    },
    'expired': {
        block: true,
        message: 'License expired. Renew at gantry.financial/billing.',
        gracePeriodDays: 7,
        degradedMode: true  // Allow read-only access during grace
    },
    'revoked': {
        block: true,
        message: 'License has been revoked. Contact support@gantry.finance.',
        allowTrial: false
    },
    'suspended': {
        block: true,
        message: 'License suspended. Contact support@gantry.finance.',
        gracePeriodDays: 0
    },
    'device_limit': {
        block: false,
        message: 'Device limit reached. Remove devices at gantry.financial/devices.',
        allowAccess: false,
        showManageDevicesLink: true
    }
};
```

---

## 6. Anti-Tampering Measures

### 6.1 Code Integrity Checks

```javascript
/**
 * Self-verification module
 * Detects if critical code has been modified
 */
define(['N/file', 'N/crypto', 'N/encode'], function(file, crypto, encode) {

    // Known good hashes of critical files (updated at build time)
    const INTEGRITY_HASHES = {
        'FC_License.js': 'sha256:a1b2c3d4e5f6...',
        'FC_Router.js': 'sha256:b2c3d4e5f6a1...',
        'FC_Engine.js': 'sha256:c3d4e5f6a1b2...'
    };

    /**
     * Verify file integrity
     * @returns {boolean} True if all files pass integrity check
     */
    function verifyIntegrity() {
        for (var filename in INTEGRITY_HASHES) {
            try {
                var fileContent = file.load({
                    id: 'SuiteApps/com.flux.capture/lib/license/' + filename
                }).getContents();

                var hash = crypto.createHash({
                    algorithm: crypto.HashAlg.SHA256
                });
                hash.update({ input: fileContent });
                var computed = 'sha256:' + hash.digest({ outputEncoding: encode.Encoding.HEX });

                if (computed !== INTEGRITY_HASHES[filename]) {
                    log.error('Integrity Check Failed', {
                        file: filename,
                        expected: INTEGRITY_HASHES[filename],
                        computed: computed
                    });
                    return false;
                }
            } catch (e) {
                log.error('Integrity Check Error', e.message);
                return false;
            }
        }
        return true;
    }

    return {
        verifyIntegrity: verifyIntegrity
    };
});
```

### 6.2 Runtime Tamper Detection

```javascript
/**
 * Runtime protection - detect debugging and tampering
 */
function detectTampering() {
    var indicators = [];

    // Check for debugger
    var debugStart = Date.now();
    debugger;
    if (Date.now() - debugStart > 100) {
        indicators.push('debugger_detected');
    }

    // Check for function modification
    if (validateTokenSignature.toString().indexOf('native code') === -1 &&
        validateTokenSignature.toString().indexOf('return true') !== -1) {
        indicators.push('function_modified');
    }

    // Check for suspicious global variables
    if (typeof window !== 'undefined') {
        if (window.__FLUX_BYPASS__ || window.__LICENSE_OVERRIDE__) {
            indicators.push('bypass_variable');
        }
    }

    if (indicators.length > 0) {
        // Report tampering attempt
        reportSecurityEvent('tamper_detected', { indicators: indicators });
        return true;
    }

    return false;
}
```

### 6.3 License Response Validation

```javascript
/**
 * Validate that license response hasn't been tampered with
 */
function validateLicenseIntegrity(license) {
    // Check for required fields
    var requiredFields = ['valid', 'status', 'tier', 'modules'];
    for (var i = 0; i < requiredFields.length; i++) {
        if (!(requiredFields[i] in license)) {
            return false;
        }
    }

    // Check tier is known value
    var validTiers = ['starter', 'professional', 'enterprise'];
    if (license.valid && validTiers.indexOf(license.tier) === -1) {
        return false;
    }

    // Check modules are subset of known modules
    var knownModules = ['ocr', 'email_ingestion', 'automation', 'api', 'custom_ml', 'integrations'];
    if (license.modules) {
        for (var j = 0; j < license.modules.length; j++) {
            if (knownModules.indexOf(license.modules[j]) === -1) {
                return false;
            }
        }
    }

    // Verify module count matches tier
    var expectedModuleCounts = {
        'starter': 2,
        'professional': 4,
        'enterprise': 6
    };
    if (license.valid && license.modules.length > expectedModuleCounts[license.tier]) {
        // Possible tier escalation attempt
        reportSecurityEvent('tier_escalation_attempt', license);
        return false;
    }

    return true;
}
```

---

## 7. Monitoring & Alerting

### 7.1 Security Events to Track

```typescript
// Security event types
enum SecurityEvent {
  // License Events
  LICENSE_CHECK_SUCCESS = 'license.check.success',
  LICENSE_CHECK_FAILED = 'license.check.failed',
  LICENSE_EXPIRED = 'license.expired',
  LICENSE_REVOKED = 'license.revoked',

  // Device Events
  DEVICE_BOUND = 'device.bound',
  DEVICE_LIMIT_EXCEEDED = 'device.limit_exceeded',
  DEVICE_REMOVED = 'device.removed',

  // Security Events
  TAMPER_DETECTED = 'security.tamper_detected',
  INTEGRITY_FAILED = 'security.integrity_failed',
  SIGNATURE_INVALID = 'security.signature_invalid',
  REPLAY_ATTEMPT = 'security.replay_attempt',

  // Abuse Events
  RATE_LIMIT_EXCEEDED = 'abuse.rate_limit',
  PROBING_DETECTED = 'abuse.probing',
  BRUTE_FORCE_ATTEMPT = 'abuse.brute_force',

  // Anomaly Events
  UNUSUAL_USAGE_PATTERN = 'anomaly.usage_pattern',
  GEOGRAPHIC_ANOMALY = 'anomaly.geographic',
  TIME_ANOMALY = 'anomaly.time'
}
```

### 7.2 Alerting Rules

```yaml
# Alert configuration
alerts:
  - name: license_abuse_detected
    condition: |
      count(events where type = 'abuse.*') > 5 in last 1h
    severity: high
    action: email_security_team

  - name: mass_license_failures
    condition: |
      count(events where type = 'license.check.failed') > 100 in last 1h
    severity: critical
    action:
      - email_security_team
      - page_oncall

  - name: tamper_attempt
    condition: |
      any(events where type = 'security.tamper_detected')
    severity: critical
    action:
      - email_security_team
      - log_for_forensics
      - block_account

  - name: device_limit_gaming
    condition: |
      count(events where type = 'device.bound' and account_id = $account) > 10 in last 24h
    severity: medium
    action: flag_for_review
```

### 7.3 Analytics Dashboard Metrics

```sql
-- License health overview
SELECT
  DATE_TRUNC('day', created_at) as day,
  COUNT(*) FILTER (WHERE result = 'success') as successful_checks,
  COUNT(*) FILTER (WHERE result = 'expired') as expired_licenses,
  COUNT(*) FILTER (WHERE result = 'not_found') as invalid_attempts,
  COUNT(DISTINCT device_hash) as unique_devices,
  COUNT(DISTINCT license_id) as unique_licenses
FROM license_validations
WHERE created_at > NOW() - INTERVAL '30 days'
GROUP BY 1
ORDER BY 1;

-- Suspicious activity report
SELECT
  account_id,
  COUNT(*) as check_count,
  COUNT(DISTINCT device_hash) as device_count,
  COUNT(DISTINCT ip_address) as ip_count,
  COUNT(*) FILTER (WHERE result != 'success') as failure_count
FROM license_validations
WHERE created_at > NOW() - INTERVAL '24 hours'
GROUP BY 1
HAVING COUNT(*) > 100 OR COUNT(DISTINCT device_hash) > 10
ORDER BY check_count DESC;
```

---

## 8. Implementation Plan

### Phase 1: Foundation (Server-Side)

| Task | Priority | Effort |
|------|----------|--------|
| Implement JWT-signed license tokens | HIGH | Medium |
| Add device binding database schema | HIGH | Low |
| Implement device binding logic | HIGH | Medium |
| Add request signing validation | MEDIUM | Medium |
| Implement rate limiting | MEDIUM | Low |

**Deliverables:**
- New `/api/v1/license-check` with signed JWT responses
- Device binding table and logic
- Rate limiting middleware

### Phase 2: Client Integration (SuiteApp)

| Task | Priority | Effort |
|------|----------|--------|
| Create `FC_License.js` module | HIGH | Medium |
| Integrate license checks in FC_Router | HIGH | Low |
| Add module gating in FC_Engine | HIGH | Low |
| Implement offline fallback | MEDIUM | Medium |
| Add UI license status indicators | LOW | Low |

**Deliverables:**
- License verification module
- Gated entry points
- Offline grace period support

### Phase 3: Hardening

| Task | Priority | Effort |
|------|----------|--------|
| Implement code integrity checks | MEDIUM | Medium |
| Add runtime tamper detection | LOW | Low |
| Implement license response validation | MEDIUM | Low |
| Add usage tracking | LOW | Medium |

**Deliverables:**
- Self-verification system
- Tamper detection
- Usage metering

### Phase 4: Monitoring

| Task | Priority | Effort |
|------|----------|--------|
| Set up security event logging | MEDIUM | Low |
| Create alerting rules | MEDIUM | Low |
| Build analytics dashboard | LOW | Medium |
| Document incident response | LOW | Low |

**Deliverables:**
- Comprehensive logging
- Alert system
- Analytics dashboard

---

## Appendix A: Security Checklist

### Pre-Deployment

- [ ] JWT signing key generated and securely stored
- [ ] Public key embedded in SuiteApp
- [ ] Device binding schema deployed
- [ ] Rate limiting configured
- [ ] All entry points gated

### Ongoing

- [ ] Weekly security event review
- [ ] Monthly license abuse audit
- [ ] Quarterly key rotation
- [ ] Annual penetration test

---

## Appendix B: Risk Assessment

| Risk | Likelihood | Impact | Mitigation |
|------|------------|--------|------------|
| License key brute force | LOW | HIGH | Rate limiting, key complexity |
| Cache tampering | MEDIUM | MEDIUM | Signed tokens, integrity checks |
| Time manipulation (offline) | LOW | LOW | Server timestamp validation |
| Code modification | MEDIUM | HIGH | Integrity checks, bundle protection |
| Device fingerprint spoofing | LOW | MEDIUM | Multi-factor fingerprint |
| API replay attacks | LOW | LOW | Nonce validation, short token TTL |

---

## Appendix C: Migration Path

For existing users without license records:

1. **Grace Period**: 30-day grace period for existing installations
2. **Auto-License**: Generate trial licenses for existing accounts
3. **Communication**: Email customers about licensing requirement
4. **Upgrade Path**: Clear upgrade flow from trial to paid

---

*Document Version: 1.0*
*Last Updated: 2024-12-26*
*Author: Flux Security Team*
