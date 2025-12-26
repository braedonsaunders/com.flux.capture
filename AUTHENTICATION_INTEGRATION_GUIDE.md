# Flux Platform Authentication System - Integration Guide

> **For LLM Integration Context**: This document provides complete technical details for integrating authentication from the Flux Platform (fluxfornetsuite.com) into the Gantry and Capture desktop/SuiteApp applications.

---

## Table of Contents

1. [System Overview](#system-overview)
2. [Authentication Architecture](#authentication-architecture)
3. [License Verification API](#license-verification-api)
4. [Database Schema](#database-schema)
5. [Product & Tier Configuration](#product--tier-configuration)
6. [Integration Patterns](#integration-patterns)
7. [Security Considerations](#security-considerations)
8. [Error Handling](#error-handling)

---

## System Overview

### Platform Details
- **Brand**: Flux (umbrella brand)
- **Products**: Gantry (NetSuite financial intelligence) and Capture (document processing)
- **Stack**: Next.js 16, React 19, TypeScript 5, Supabase, Stripe
- **Auth Provider**: Supabase Auth (email/password + magic link)
- **License Format**: `GF-XXXX-XXXX-XXXX-XXXX`

### Key Identifier
- **NetSuite Account ID**: Primary identifier for Gantry app license lookups
- **License Key**: Secondary/backup identifier for validation
- **Product ID**: `'gantry'` or `'capture'`

---

## Authentication Architecture

### Two-Layer Authentication

The system uses a **two-layer authentication model**:

1. **User Authentication** (Supabase Auth)
   - For web dashboard access
   - Email/password or magic link
   - JWT-based sessions stored in HTTP-only cookies
   - NOT used by Gantry/Capture apps directly

2. **License Validation** (REST API)
   - **This is what Gantry and Capture apps should use**
   - Validates by NetSuite Account ID (Gantry) or License Key
   - Returns tier, enabled modules, and expiration
   - No user session required

### Flow Diagram

```
┌─────────────────────────────────────────────────────────────────────┐
│                        FLUX PLATFORM (fluxfornetsuite.com)           │
├─────────────────────────────────────────────────────────────────────┤
│                                                                      │
│  ┌──────────────┐     ┌──────────────┐     ┌───────────────────┐   │
│  │   Web User   │────▶│ Supabase Auth │────▶│  Dashboard/Portal │   │
│  │   (Browser)  │     │   (Sessions)  │     │   (React App)     │   │
│  └──────────────┘     └──────────────┘     └───────────────────┘   │
│                                                                      │
│  ═══════════════════════════════════════════════════════════════    │
│                                                                      │
│  ┌──────────────┐     ┌──────────────┐     ┌───────────────────┐   │
│  │ Gantry App   │────▶│ License API  │────▶│    Supabase DB    │   │
│  │ (NetSuite)   │     │  /api/v1/    │     │    (Licenses)     │   │
│  └──────────────┘     └──────────────┘     └───────────────────┘   │
│                                                                      │
│  ┌──────────────┐            │                                      │
│  │ Capture App  │────────────┘                                      │
│  │  (Desktop)   │                                                   │
│  └──────────────┘                                                   │
│                                                                      │
└─────────────────────────────────────────────────────────────────────┘
```

---

## License Verification API

### Primary Endpoint

**Base URL**: `https://fluxfornetsuite.com` (production) or `http://localhost:3000` (dev)

---

### GET `/api/v1/license-check`

**Purpose**: Quick validation by NetSuite Account ID

**Request**:
```http
GET /api/v1/license-check?account={netsuite_account_id}
```

**Query Parameters**:
| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `account` | string | Yes | NetSuite Account ID (e.g., `1234567` or `1234567_SB1`) |

**Response (Success - 200)**:
```json
{
  "valid": true,
  "status": "active",
  "tier": "controller",
  "modules": ["integrity", "health", "velocity", "vendor"],
  "expires_at": "2025-01-15T00:00:00.000Z"
}
```

**Response (Not Found - 404)**:
```json
{
  "valid": false,
  "status": "not_found",
  "message": "No active license found for this NetSuite account"
}
```

**Response (Expired - 200)**:
```json
{
  "valid": false,
  "status": "expired",
  "message": "License has expired",
  "expires_at": "2024-12-01T00:00:00.000Z"
}
```

---

### POST `/api/v1/license-check`

**Purpose**: Validation with optional license key verification (more secure)

**Request**:
```http
POST /api/v1/license-check
Content-Type: application/json

{
  "account": "1234567",
  "license_key": "GF-ABCD-EFGH-IJKL-MNOP"
}
```

**Request Body**:
| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `account` | string | Yes | NetSuite Account ID |
| `license_key` | string | No | License key for additional verification |

**Response (Success - 200)**:
```json
{
  "valid": true,
  "status": "active",
  "tier": "cfo",
  "modules": ["integrity", "health", "velocity", "vendor", "burden", "cashflow", "customer_value", "time", "advisor"],
  "expires_at": "2025-06-15T00:00:00.000Z"
}
```

**Response (Invalid - 200)**:
```json
{
  "valid": false,
  "status": "not_found",
  "message": "License not found or invalid"
}
```

---

### API Implementation Reference

```typescript
// File: /src/app/api/v1/license-check/route.ts

// GET handler - lookup by NetSuite account ID
export async function GET(request: NextRequest) {
  const accountId = request.nextUrl.searchParams.get('account');

  if (!accountId) {
    return NextResponse.json({
      valid: false,
      status: 'error',
      message: 'Missing required parameter: account'
    }, { status: 400 });
  }

  const supabase = createSupabaseAdminClient();

  const { data: license, error } = await supabase
    .from('licenses')
    .select('*')
    .eq('netsuite_account_id', accountId)
    .eq('status', 'active')
    .single();

  if (error || !license) {
    return NextResponse.json({
      valid: false,
      status: 'not_found',
      message: 'No active license found for this NetSuite account',
    }, { status: 404 });
  }

  // Check expiration
  if (license.expires_at && new Date(license.expires_at) < new Date()) {
    return NextResponse.json({
      valid: false,
      status: 'expired',
      message: 'License has expired',
      expires_at: license.expires_at,
    });
  }

  // Update last check timestamp (for analytics)
  await supabase
    .from('licenses')
    .update({ last_check_at: new Date().toISOString() })
    .eq('id', license.id);

  return NextResponse.json({
    valid: true,
    status: 'active',
    tier: license.tier,
    modules: license.modules_enabled,
    expires_at: license.expires_at,
  });
}
```

---

## Database Schema

### Licenses Table

```sql
CREATE TABLE public.licenses (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  customer_id UUID NOT NULL REFERENCES public.customers(id) ON DELETE CASCADE,
  product_id VARCHAR(50) REFERENCES public.products(id),  -- 'gantry' or 'capture'
  subscription_id UUID REFERENCES public.subscriptions(id) ON DELETE SET NULL,
  license_key VARCHAR(50) UNIQUE NOT NULL,                -- Format: GF-XXXX-XXXX-XXXX-XXXX
  netsuite_account_id VARCHAR(50),                        -- For Gantry integration
  tier VARCHAR(50) NOT NULL DEFAULT 'auditor',            -- auditor, controller, cfo (Gantry)
                                                          -- starter, professional, enterprise (Capture)
  modules_enabled TEXT[] DEFAULT '{}',                    -- Array of enabled module names
  status VARCHAR(50) NOT NULL DEFAULT 'active',           -- active, expired, revoked, suspended
  activated_at TIMESTAMPTZ,
  expires_at TIMESTAMPTZ,                                 -- NULL = never expires
  last_check_at TIMESTAMPTZ,                              -- Updated on each API validation call
  check_count INTEGER DEFAULT 0,                          -- Incremented on each validation
  created_by VARCHAR(255),                                -- Admin email if manually created
  notes TEXT,
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes for fast lookups
CREATE INDEX idx_licenses_netsuite ON public.licenses(netsuite_account_id);
CREATE INDEX idx_licenses_status ON public.licenses(status);
CREATE INDEX idx_licenses_key ON public.licenses(license_key);
CREATE INDEX idx_licenses_product ON public.licenses(product_id);
```

### Customers Table

```sql
CREATE TABLE public.customers (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  email VARCHAR(255) UNIQUE NOT NULL,
  name VARCHAR(255),
  company_name VARCHAR(255),
  stripe_customer_id VARCHAR(255) UNIQUE,
  netsuite_account_id VARCHAR(50),
  phone VARCHAR(50),
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
```

### Subscriptions Table

```sql
CREATE TABLE public.subscriptions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  customer_id UUID NOT NULL REFERENCES public.customers(id) ON DELETE CASCADE,
  product_id VARCHAR(50) REFERENCES public.products(id),  -- 'gantry' or 'capture'
  stripe_subscription_id VARCHAR(255),                    -- NULL for manual subscriptions
  status VARCHAR(50) NOT NULL DEFAULT 'active',           -- active, trialing, past_due, canceled, paused, unpaid
  plan_id VARCHAR(50) NOT NULL,                           -- e.g., 'gantry_controller'
  plan_name VARCHAR(100) NOT NULL,                        -- e.g., 'The Controller'
  billing_cycle VARCHAR(20) DEFAULT 'monthly',            -- monthly, yearly
  amount INTEGER DEFAULT 0,                               -- Price in cents
  currency VARCHAR(3) DEFAULT 'USD',
  current_period_start TIMESTAMPTZ,
  current_period_end TIMESTAMPTZ,
  cancel_at_period_end BOOLEAN DEFAULT FALSE,
  canceled_at TIMESTAMPTZ,
  trial_start TIMESTAMPTZ,
  trial_end TIMESTAMPTZ,
  created_by VARCHAR(255),                                -- Admin email if manually created
  notes TEXT,
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
```

---

## Product & Tier Configuration

### Gantry Product

| Tier | ID | Modules | Monthly Price |
|------|-----|---------|---------------|
| **The Auditor** | `auditor` | `integrity`, `health` | $299 |
| **The Controller** | `controller` | `integrity`, `health`, `velocity`, `vendor` | $599 |
| **The CFO** | `cfo` | `integrity`, `health`, `velocity`, `vendor`, `burden`, `cashflow`, `customer_value`, `time`, `advisor` | $999 |

### Gantry Module Definitions

```typescript
// File: /src/types/index.ts

export type GantryModule =
  | 'integrity'      // Forensic Auditor - Benford's Law, duplicates, ghost vendors
  | 'velocity'       // Spend Velocity - subscription creep, shadow IT
  | 'vendor'         // Vendor Performance - OTIF, scorecards, maverick spend
  | 'burden'         // Burden & Costing - rate engine, selling rates
  | 'cashflow'       // Cash Flow forecasting
  | 'customer_value' // Customer Value - RFM, churn risk, LTV
  | 'time'           // Time & Billing analytics
  | 'health'         // System Health dashboard
  | 'advisor';       // AI Financial Advisor

export const GANTRY_TIER_MODULES: Record<string, GantryModule[]> = {
  auditor: ['integrity', 'health'],
  controller: ['integrity', 'health', 'velocity', 'vendor'],
  cfo: ['integrity', 'health', 'velocity', 'vendor', 'burden', 'cashflow', 'customer_value', 'time', 'advisor'],
};

export const GANTRY_MODULE_NAMES: Record<GantryModule, string> = {
  integrity: 'Integrity (Forensic Auditor)',
  velocity: 'Spend Velocity',
  vendor: 'Vendor Performance',
  burden: 'Burden & Costing',
  cashflow: 'Cash Flow',
  customer_value: 'Customer Value',
  time: 'Time & Billing',
  health: 'System Health',
  advisor: 'AI Advisor',
};
```

### Capture Product

| Tier | ID | Modules | Monthly Price |
|------|-----|---------|---------------|
| **Starter** | `starter` | `ocr`, `email_ingestion` | $99 |
| **Professional** | `professional` | `ocr`, `email_ingestion`, `automation`, `api` | $299 |
| **Enterprise** | `enterprise` | `ocr`, `email_ingestion`, `automation`, `api`, `custom_ml`, `integrations` | $599 |

### Capture Module Definitions

```typescript
export type CaptureModule =
  | 'ocr'             // OCR Processing
  | 'email_ingestion' // Email Ingestion
  | 'automation'      // Workflow Automation
  | 'api'             // API Access
  | 'custom_ml'       // Custom ML Models
  | 'integrations';   // Advanced Integrations

export const CAPTURE_TIER_MODULES: Record<string, CaptureModule[]> = {
  starter: ['ocr', 'email_ingestion'],
  professional: ['ocr', 'email_ingestion', 'automation', 'api'],
  enterprise: ['ocr', 'email_ingestion', 'automation', 'api', 'custom_ml', 'integrations'],
};
```

---

## Integration Patterns

### Pattern 1: Gantry SuiteApp (NetSuite SuiteScript)

```javascript
/**
 * Gantry Finance License Validation - SuiteScript 2.x
 * For use in NetSuite SuiteApp/SuiteBundle
 */

define(['N/https', 'N/runtime'], function(https, runtime) {

    const LICENSE_API_URL = 'https://fluxfornetsuite.com/api/v1/license-check';

    /**
     * Validate license for current NetSuite account
     * @returns {Object} { valid: boolean, tier: string, modules: string[], expires_at: string }
     */
    function validateLicense() {
        var accountId = runtime.accountId;

        try {
            var response = https.get({
                url: LICENSE_API_URL + '?account=' + encodeURIComponent(accountId),
                headers: {
                    'Content-Type': 'application/json',
                    'Accept': 'application/json'
                }
            });

            var result = JSON.parse(response.body);

            if (result.valid) {
                return {
                    valid: true,
                    tier: result.tier,
                    modules: result.modules,
                    expires_at: result.expires_at
                };
            } else {
                return {
                    valid: false,
                    status: result.status,
                    message: result.message
                };
            }
        } catch (e) {
            log.error('License Validation Error', e.message);
            return {
                valid: false,
                status: 'error',
                message: 'Failed to validate license: ' + e.message
            };
        }
    }

    /**
     * Check if a specific module is enabled
     * @param {string} moduleName - e.g., 'integrity', 'velocity', 'vendor'
     * @returns {boolean}
     */
    function isModuleEnabled(moduleName) {
        var license = validateLicense();
        if (!license.valid) return false;
        return license.modules.indexOf(moduleName) !== -1;
    }

    /**
     * Get current tier name
     * @returns {string|null}
     */
    function getCurrentTier() {
        var license = validateLicense();
        return license.valid ? license.tier : null;
    }

    return {
        validateLicense: validateLicense,
        isModuleEnabled: isModuleEnabled,
        getCurrentTier: getCurrentTier
    };
});
```

### Pattern 2: Desktop Application (TypeScript/Node.js)

```typescript
/**
 * Flux Platform License Client
 * For Gantry or Capture desktop applications
 */

interface LicenseCheckResponse {
  valid: boolean;
  status: 'active' | 'expired' | 'revoked' | 'not_found' | 'error';
  tier?: string;
  modules?: string[];
  expires_at?: string;
  message?: string;
}

interface LicenseConfig {
  baseUrl: string;
  accountId?: string;   // For Gantry (NetSuite)
  licenseKey?: string;  // For Capture or backup validation
}

class FluxLicenseClient {
  private baseUrl: string;
  private cachedLicense: LicenseCheckResponse | null = null;
  private cacheExpiry: number = 0;
  private cacheTTL: number = 5 * 60 * 1000; // 5 minutes

  constructor(config: LicenseConfig) {
    this.baseUrl = config.baseUrl || 'https://fluxfornetsuite.com';
  }

  /**
   * Validate license by NetSuite Account ID (primary method for Gantry)
   */
  async validateByAccount(accountId: string): Promise<LicenseCheckResponse> {
    // Check cache first
    if (this.cachedLicense && Date.now() < this.cacheExpiry) {
      return this.cachedLicense;
    }

    try {
      const response = await fetch(
        `${this.baseUrl}/api/v1/license-check?account=${encodeURIComponent(accountId)}`,
        {
          method: 'GET',
          headers: {
            'Content-Type': 'application/json',
            'Accept': 'application/json',
          },
        }
      );

      const result: LicenseCheckResponse = await response.json();

      // Cache successful validations
      if (result.valid) {
        this.cachedLicense = result;
        this.cacheExpiry = Date.now() + this.cacheTTL;
      }

      return result;
    } catch (error) {
      return {
        valid: false,
        status: 'error',
        message: `Network error: ${error instanceof Error ? error.message : 'Unknown'}`,
      };
    }
  }

  /**
   * Validate license with both account ID and license key (more secure)
   */
  async validateWithKey(accountId: string, licenseKey: string): Promise<LicenseCheckResponse> {
    try {
      const response = await fetch(`${this.baseUrl}/api/v1/license-check`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json',
        },
        body: JSON.stringify({
          account: accountId,
          license_key: licenseKey,
        }),
      });

      const result: LicenseCheckResponse = await response.json();

      if (result.valid) {
        this.cachedLicense = result;
        this.cacheExpiry = Date.now() + this.cacheTTL;
      }

      return result;
    } catch (error) {
      return {
        valid: false,
        status: 'error',
        message: `Network error: ${error instanceof Error ? error.message : 'Unknown'}`,
      };
    }
  }

  /**
   * Check if a specific module is enabled
   */
  isModuleEnabled(moduleName: string): boolean {
    if (!this.cachedLicense?.valid) return false;
    return this.cachedLicense.modules?.includes(moduleName) ?? false;
  }

  /**
   * Get enabled modules list
   */
  getEnabledModules(): string[] {
    return this.cachedLicense?.modules ?? [];
  }

  /**
   * Get current tier
   */
  getTier(): string | null {
    return this.cachedLicense?.tier ?? null;
  }

  /**
   * Check if license is expired or will expire soon
   */
  getExpirationStatus(): { expired: boolean; daysUntilExpiry: number | null } {
    if (!this.cachedLicense?.expires_at) {
      return { expired: false, daysUntilExpiry: null };
    }

    const expiryDate = new Date(this.cachedLicense.expires_at);
    const now = new Date();
    const diffMs = expiryDate.getTime() - now.getTime();
    const diffDays = Math.ceil(diffMs / (1000 * 60 * 60 * 24));

    return {
      expired: diffDays < 0,
      daysUntilExpiry: diffDays,
    };
  }

  /**
   * Clear cached license (force re-validation)
   */
  clearCache(): void {
    this.cachedLicense = null;
    this.cacheExpiry = 0;
  }
}

// Usage Example
const licenseClient = new FluxLicenseClient({
  baseUrl: 'https://fluxfornetsuite.com',
});

// For Gantry (NetSuite integration)
const license = await licenseClient.validateByAccount('1234567');
if (license.valid) {
  console.log(`License valid! Tier: ${license.tier}`);
  console.log(`Modules: ${license.modules?.join(', ')}`);

  // Check specific module
  if (licenseClient.isModuleEnabled('velocity')) {
    // Enable Spend Velocity features
  }
}
```

### Pattern 3: Periodic License Validation

```typescript
/**
 * Background license validator with retry logic
 */
class LicenseValidator {
  private client: FluxLicenseClient;
  private accountId: string;
  private checkInterval: number = 60 * 60 * 1000; // 1 hour
  private intervalId: NodeJS.Timeout | null = null;
  private onLicenseChange: (license: LicenseCheckResponse) => void;

  constructor(
    accountId: string,
    onLicenseChange: (license: LicenseCheckResponse) => void
  ) {
    this.client = new FluxLicenseClient({ baseUrl: 'https://fluxfornetsuite.com' });
    this.accountId = accountId;
    this.onLicenseChange = onLicenseChange;
  }

  async start(): Promise<void> {
    // Initial check
    await this.check();

    // Schedule periodic checks
    this.intervalId = setInterval(() => this.check(), this.checkInterval);
  }

  stop(): void {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
  }

  private async check(): Promise<void> {
    const license = await this.client.validateByAccount(this.accountId);
    this.onLicenseChange(license);
  }
}

// Usage
const validator = new LicenseValidator('1234567', (license) => {
  if (!license.valid) {
    // Show license expired/invalid UI
    showLicenseError(license.message);
    disableFeatures();
  } else {
    // Update enabled features based on modules
    updateEnabledFeatures(license.modules);
  }
});

validator.start();
```

---

## Security Considerations

### 1. No Authentication Required for License API

The `/api/v1/license-check` endpoint is **intentionally public** (no auth header required) because:
- It's designed for server-to-server or app-to-server communication
- NetSuite SuiteScript cannot easily manage OAuth tokens
- The NetSuite Account ID serves as a pseudo-authentication factor
- License keys provide additional security when needed

### 2. Rate Limiting Recommendations

Implement client-side rate limiting:
- Cache license responses for at least 5 minutes
- Don't validate on every user action
- Use a background validator with hourly checks

### 3. License Key Security

```typescript
// License key format: GF-XXXX-XXXX-XXXX-XXXX
// Generated using crypto.randomBytes() for security
// Character set excludes similar characters (I, O, 0, 1)

function generateLicenseKey(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const bytes = randomBytes(16);
  const segments: string[] = [];

  for (let i = 0; i < 4; i++) {
    let segment = '';
    for (let j = 0; j < 4; j++) {
      segment += chars[bytes[i * 4 + j] % chars.length];
    }
    segments.push(segment);
  }

  return `GF-${segments.join('-')}`;
}
```

### 4. Offline Handling

For desktop apps, implement offline grace period:

```typescript
const OFFLINE_GRACE_PERIOD_DAYS = 7;

interface CachedLicense {
  license: LicenseCheckResponse;
  lastValidated: string; // ISO timestamp
}

function isOfflineGracePeriodValid(cached: CachedLicense): boolean {
  if (!cached.license.valid) return false;

  const lastValidated = new Date(cached.lastValidated);
  const now = new Date();
  const daysSinceValidation = (now.getTime() - lastValidated.getTime()) / (1000 * 60 * 60 * 24);

  return daysSinceValidation < OFFLINE_GRACE_PERIOD_DAYS;
}
```

---

## Error Handling

### Response Status Codes

| Status | Description |
|--------|-------------|
| `200` | Success (check `valid` field for actual validity) |
| `400` | Bad request (missing parameters) |
| `404` | License not found |
| `500` | Server error |

### Status Field Values

| Status | Meaning |
|--------|---------|
| `active` | License is valid and active |
| `expired` | License has passed expiration date |
| `revoked` | License was manually revoked by admin |
| `suspended` | License temporarily suspended |
| `not_found` | No matching license exists |
| `error` | Server error occurred |

### Recommended Error Messages for Users

```typescript
const ERROR_MESSAGES: Record<string, string> = {
  'not_found': 'No valid license found for this NetSuite account. Please contact sales@fluxfornetsuite.com.',
  'expired': 'Your license has expired. Please renew at fluxfornetsuite.com/dashboard/billing.',
  'revoked': 'Your license has been revoked. Please contact support@fluxfornetsuite.com.',
  'suspended': 'Your license is temporarily suspended. Please contact support@fluxfornetsuite.com.',
  'error': 'Unable to validate license. Please check your internet connection and try again.',
};
```

---

## Environment Configuration

### Required for License API Access

The apps don't need any environment variables to call the license API. Simply use:

**Production**: `https://fluxfornetsuite.com/api/v1/license-check`
**Development**: `http://localhost:3000/api/v1/license-check`

### Server-side (Flux Platform)

```env
# Supabase (for license lookups)
NEXT_PUBLIC_SUPABASE_URL=https://xxx.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJhbG...
SUPABASE_SERVICE_ROLE_KEY=eyJhbG...

# Application URL
NEXT_PUBLIC_APP_URL=https://fluxfornetsuite.com
```

---

## Testing

### Test License Validation

```bash
# GET request
curl "https://fluxfornetsuite.com/api/v1/license-check?account=1234567"

# POST request with license key
curl -X POST "https://fluxfornetsuite.com/api/v1/license-check" \
  -H "Content-Type: application/json" \
  -d '{"account": "1234567", "license_key": "GF-ABCD-EFGH-IJKL-MNOP"}'
```

### Expected Responses

**Valid License**:
```json
{
  "valid": true,
  "status": "active",
  "tier": "controller",
  "modules": ["integrity", "health", "velocity", "vendor"],
  "expires_at": "2025-06-15T00:00:00.000Z"
}
```

**Invalid Account**:
```json
{
  "valid": false,
  "status": "not_found",
  "message": "No active license found for this NetSuite account"
}
```

---

## Summary

For integrating Gantry or Capture apps with the Flux Platform authentication:

1. **Use the License API** (`/api/v1/license-check`) - NOT Supabase Auth directly
2. **Identify by NetSuite Account ID** (Gantry) or license key (Capture)
3. **Cache responses** to minimize API calls (5+ minute cache recommended)
4. **Check modules array** to enable/disable features
5. **Handle offline gracefully** with cached license + grace period
6. **Log validation errors** for debugging but show user-friendly messages

The license API is public, requires no authentication, and is designed for easy integration from any platform (NetSuite SuiteScript, Electron, Node.js, etc.).
