# Flux Capture - Distribution System Guide

> **Purpose**: Distribute Flux Capture SuiteApp from your website with source code protection
> **Last Updated**: 2024-12-26

---

## Overview

Since SuiteApp Marketplace access may not be available, this guide outlines a creative distribution strategy using:

1. **SuiteBundler** - NetSuite's native bundle distribution system
2. **Hide Script** - Source code protection for server-side scripts
3. **Code Obfuscation** - Protection for client-side scripts (can't be hidden)
4. **Self-Service Portal** - Website-based installation and licensing

---

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                    DISTRIBUTION FLOW                             │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│   ┌──────────────┐     ┌──────────────┐     ┌──────────────┐   │
│   │   Website    │     │   NetSuite   │     │   Customer   │   │
│   │   Portal     │────>│   Bundle     │────>│   Account    │   │
│   │              │     │   (Hidden)   │     │              │   │
│   └──────────────┘     └──────────────┘     └──────────────┘   │
│          │                                          │           │
│          │         License Validation               │           │
│          └──────────────────────────────────────────┘           │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

---

## Distribution Methods

### Method 1: Managed Bundle (Recommended)

This is the most integrated approach, using NetSuite's SuiteBundler.

#### Step 1: Create Bundle in Development Account

1. Log into your NetSuite development/sandbox account
2. Navigate to: **Customization > SuiteBundler > Create Bundle**
3. Configure bundle:
   - **Name**: Flux Capture
   - **Version**: 1.0.0
   - **Is Managed**: Yes (tracks installations)
   - **Is Locked**: Yes (prevents editing)

#### Step 2: Enable Hide Script on Server-Side Files

Before adding files to the bundle, enable "Hide in SuiteBundle" on each server-side script:

1. Navigate to: **Documents > Files > File Cabinet**
2. Go to: **SuiteApps/com.flux.capture/**
3. For each server-side file, click to edit and check **"Hide in SuiteBundle"**

**Files to Hide (Server-Side):**
```
suitelet/FC_Suitelet.js          ✓ Hide
suitelet/FC_Router.js            ✓ Hide
lib/FC_Engine.js                 ✓ Hide
lib/FC_LicenseGuard.js           ✓ Hide
lib/FC_Debug.js                  ✓ Hide
lib/providers/*.js               ✓ Hide (all provider files)
lib/extraction/*.js              ✓ Hide
lib/resolution/*.js              ✓ Hide
lib/matching/*.js                ✓ Hide
lib/learning/*.js                ✓ Hide
lib/validation/*.js              ✓ Hide
lib/vendors/*.js                 ✓ Hide
lib/llm/*.js                     ✓ Hide
lib/utils/*.js                   ✓ Hide
scripts/FC_ProcessDocuments_MR.js ✓ Hide
scripts/FC_Document_UE.js        ✓ Hide
scripts/FC_EmailCapture_Plugin.js ✓ Hide
scripts/FC_ContinuePolling_SS.js ✓ Hide
```

**Files that CANNOT be Hidden (Client-Side):**
```
client/core/FC.Core.js           ✗ Obfuscate instead
client/FC.Main.js                ✗ Obfuscate instead
client/views/*.js                ✗ Obfuscate instead
App/app_index.html               ✗ Standard
App/css/*.css                    ✗ Standard
```

> **Important**: As of May 2024, NetSuite validates that client-side scripts cannot have "Hide in SuiteBundle" enabled. They must be served to the browser.

#### Step 3: Build Obfuscated Distribution

Run the build script to obfuscate client-side code:

```bash
# Install dependencies
npm install

# Build distribution package
npm run build
```

This creates:
- `dist/bundle/` - SDF project with obfuscated client code
- `dist/bundle-manifest.json` - Bundle configuration
- `dist/INSTALL.txt` - Installation instructions
- `dist/FC_BundleHelper.js` - Helper script to configure Hide settings

#### Step 4: Upload Obfuscated Files

Replace client-side files in File Cabinet with obfuscated versions from `dist/bundle/`.

#### Step 5: Add Objects to Bundle

In Bundle Builder, add:
- All script records (with deployments)
- Custom record types
- All File Cabinet files

#### Step 6: Configure Bundle Sharing

**Option A: Shared Bundle (Private)**
- Add specific account IDs to "Shared Account IDs"
- Customers search by your account ID + bundle name

**Option B: Public Bundle**
- Make bundle public (visible to all NetSuite accounts)
- Customers search by bundle name

#### Step 7: Generate Bundle ID

Save the bundle and note the **Bundle ID** - this is what customers use to install.

---

### Method 2: Self-Service Web Portal

Create a web portal on fluxfornetsuite.com for guided installation.

#### Portal Features

1. **Trial Request Flow**
   - Customer enters email and company info
   - System generates trial license
   - Customer receives installation instructions

2. **Installation Wizard**
   - Step-by-step guide with screenshots
   - Bundle ID lookup
   - Verification check

3. **License Activation**
   - Customer enters license key in app settings
   - Real-time validation via API

#### Portal API Endpoints

Add these endpoints to your fluxfornetsuite.com backend:

```javascript
// POST /api/v1/trial-request
// Request trial installation
{
  "email": "user@company.com",
  "company": "Acme Corp",
  "account_id": "123456",  // Optional - for verification
  "estimated_documents": 500
}

// Response
{
  "success": true,
  "trial_key": "TRL-XXXX-XXXX-XXXX",
  "expires_at": "2025-01-26T00:00:00Z",
  "bundle_id": "123456",
  "installation_url": "https://fluxfornetsuite.com/install/TRL-XXXX",
  "instructions": "..."
}

// POST /api/v1/verify-installation
// Verify Flux Capture is installed in an account
{
  "account": "TSTDRV123456",
  "license_key": "LIC-XXXX-XXXX"
}

// Response
{
  "installed": true,
  "version": "1.0.0",
  "license": {
    "valid": true,
    "status": "active",
    "expires_at": "2025-12-31"
  },
  "health": {
    "scripts_deployed": true,
    "records_created": true,
    "last_activity": "2024-12-26T10:30:00Z"
  }
}

// POST /api/v1/license-check
// Existing endpoint - validates license
{
  "account": "TSTDRV123456",
  "license_key": "LIC-XXXX-XXXX",
  "product": "capture",
  "client_version": "1.0.0"
}

// Response
{
  "valid": true,
  "status": "active",
  "expires_at": "2025-12-31T00:00:00Z"
}
```

---

## Source Code Protection Strategy

### Layer 1: Hide in SuiteBundle (Server-Side)

Server-side scripts are completely hidden from view when using a managed bundle.

**What "Hidden" Means:**
- Source code is not visible in File Cabinet
- Script record shows file but content is encrypted/hidden
- Customers cannot copy, modify, or view the code
- Only works for server-side SuiteScript

### Layer 2: Obfuscation (Client-Side)

Client-side JavaScript must be served to browsers, so it can't be truly hidden. We use obfuscation instead:

**Obfuscation Features:**
- Control flow flattening
- Dead code injection
- String encryption (base64)
- Identifier mangling (hexadecimal names)
- String array with rotation/shuffle
- Object key transformation

**Result:**
- Code is functional but extremely difficult to read
- Reverse engineering is time-consuming and error-prone
- Combined with license validation = strong protection

### Layer 3: License Validation

Even if someone deobfuscates the code, they must modify 9+ files to bypass licensing:

- FC_LicenseGuard.js (central validation)
- FC_Suitelet.js (entry point)
- FC_Router.js (API entry point)
- FC_ProcessDocuments_MR.js (background processing)
- FC_Document_UE.js (record triggers)
- FC_EmailCapture_Plugin.js (email import)
- FC_Engine.js (core processing)
- FC.Core.js (client-side)
- Multiple embedded checks throughout

---

## Installation Flow for Customers

### For Customers - What They See

1. **Visit fluxfornetsuite.com**
   - Click "Start Free Trial" or "Buy Now"

2. **Complete Registration**
   - Enter email, company, NetSuite account ID
   - Receive trial/license key via email

3. **Install Bundle in NetSuite**
   ```
   1. Log into NetSuite as Administrator
   2. Go to: Customization > SuiteBundler > Search & Install Bundles
   3. Search for "Flux Capture" or enter Bundle ID: [XXXXX]
   4. Click Install
   5. Wait 2-5 minutes for installation
   ```

4. **Configure License**
   - Navigate to Flux Capture Suitelet
   - Go to Settings
   - Enter license key
   - Click Validate

5. **Start Using**
   - Upload first document
   - Configure extraction settings
   - Set up email capture (optional)

---

## Bundle Update Distribution

When you release updates:

1. Update bundle version in your development account
2. Run obfuscation build for new client code
3. Upload new files
4. Save bundle (creates new version)

**For Customers:**
- They see update notification in SuiteBundler
- One-click update applies changes
- Their data is preserved

---

## Security Considerations

### What's Protected

| Component | Protection | Effectiveness |
|-----------|------------|---------------|
| Server-side scripts | Hide in SuiteBundle | **Strong** - Completely hidden |
| Client-side scripts | Obfuscation | **Moderate** - Difficult to read |
| License logic | Multi-layer checks | **Strong** - 9 files to modify |
| API keys/secrets | Environment config | **Strong** - Not in source |

### What's Not Protected

| Component | Risk | Mitigation |
|-----------|------|------------|
| HTML templates | Visible in browser | Minimal IP value |
| CSS styles | Visible in browser | Minimal IP value |
| API structure | Visible via network | License required for access |

### Recommendations

1. **Keep core algorithms server-side** - FC_Engine.js handles all AI extraction
2. **Validate everything server-side** - Don't trust client-side validation
3. **Use short cache TTL** - License checks every hour
4. **Monitor for abuse** - Track unusual API patterns
5. **Rotate obfuscation** - Re-obfuscate with each release

---

## Troubleshooting

### Bundle Won't Install

**Symptoms:** Installation fails or times out

**Solutions:**
1. Check required features are enabled
2. Verify no conflicting script IDs
3. Check for existing custom records with same IDs
4. Review installation log in SuiteBundler

### Scripts Not Hidden

**Symptoms:** Source code visible after bundle install

**Causes:**
1. "Hide in SuiteBundle" not enabled on source file
2. File added to bundle after preference was set
3. Bundle is not "Managed"

**Solution:**
1. Enable "Hide in SuiteBundle" on each file
2. Remove file from bundle
3. Re-add file to bundle
4. Re-save bundle

### License Validation Fails

**Symptoms:** "License Required" error after installation

**Solutions:**
1. Verify license key is correct
2. Check network connectivity to fluxfornetsuite.com
3. Verify account ID matches license
4. Contact support@fluxfornetsuite.com

---

## Quick Reference

### Build Commands

```bash
# Install dependencies
npm install

# Full build (obfuscate + package)
npm run build

# Package only (no obfuscation)
npm run build:bundle

# Obfuscate only
npm run build:obfuscate

# Verify installation
npm run verify-installation -- --account TSTDRV123456
```

### Key Files

| File | Purpose |
|------|---------|
| `scripts/build-distribution.js` | Build and obfuscation pipeline |
| `scripts/verify-installation.js` | Installation verification |
| `dist/bundle/` | Distribution-ready SDF project |
| `dist/bundle-manifest.json` | Bundle configuration |
| `dist/INSTALL.txt` | Customer installation guide |
| `dist/FC_BundleHelper.js` | Helper for Hide settings |

### Support

- Website: https://fluxfornetsuite.com
- Email: support@fluxfornetsuite.com
- Documentation: https://fluxfornetsuite.com/docs

---

*This document is confidential and intended for internal use.*
