# Flux Capture - Distribution System Guide

> **Purpose**: Distribute Flux Capture SuiteApp from your website without SDN membership
> **Last Updated**: 2024-12-26

---

## Overview

This guide outlines how to distribute Flux Capture using:

1. **SuiteBundler** - NetSuite's native bundle system (no SDN required)
2. **Hide Script** - Source code protection for server-side scripts
3. **Code Obfuscation** - Protection for client-side scripts
4. **License API** - Your existing fluxfornetsuite.com license system

**No SDN (SuiteCloud Developer Network) membership required.**

---

## Distribution Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│                         DISTRIBUTION FLOW                            │
├─────────────────────────────────────────────────────────────────────┤
│                                                                      │
│   ┌──────────────────┐                                              │
│   │  fluxfornetsuite │  1. Customer requests trial                  │
│   │     .com         │  2. Gets license key + Bundle ID             │
│   └────────┬─────────┘                                              │
│            │                                                         │
│            ▼                                                         │
│   ┌──────────────────┐                                              │
│   │  Your NetSuite   │  Bundle stored here with                     │
│   │  Dev Account     │  "Hide in SuiteBundle" enabled               │
│   │  (Bundle Source) │  Sharing: Public or Shared                   │
│   └────────┬─────────┘                                              │
│            │                                                         │
│            ▼                                                         │
│   ┌──────────────────┐                                              │
│   │  Customer's      │  3. Customer installs bundle                 │
│   │  NetSuite        │  4. Enters license key in Settings           │
│   │  Account         │  5. License API validates                    │
│   └────────┬─────────┘                                              │
│            │                                                         │
│            ▼                                                         │
│   ┌──────────────────┐                                              │
│   │  fluxfornetsuite │  License check on every use                  │
│   │  /api/v1/        │  Tracks usage, validates access              │
│   │  license-check   │                                              │
│   └──────────────────┘                                              │
│                                                                      │
└─────────────────────────────────────────────────────────────────────┘
```

---

## Bundle Distribution Options

### Option A: Public Bundle (Recommended)

Anyone can search and install. Your license system controls access.

**Pros:**
- No manual work per customer
- Customers can install immediately
- Self-service friendly

**Cons:**
- Anyone can download (but can't use without license)
- Competitors could examine obfuscated client code

**Setup:**
1. Create bundle in your NetSuite account
2. Set availability to "Public"
3. Customers search by bundle name or your account ID

### Option B: Shared Bundle

Only specific account IDs can install.

**Pros:**
- Full control over who can download
- Extra layer of protection

**Cons:**
- Must collect Account ID before they can install
- Manual process to add each customer

**Setup:**
1. Create bundle in your NetSuite account
2. Set availability to "Shared"
3. Add customer Account IDs to sharing list as they sign up

### Recommendation

**Use Public Bundle** - Your license system already prevents unauthorized use. The convenience of self-service outweighs the minimal risk of someone downloading without a license.

---

## Source Code Protection

### What Gets Hidden vs Obfuscated

| File Type | Protection | Method |
|-----------|------------|--------|
| Server-side SuiteScript | **Hidden** | "Hide in SuiteBundle" checkbox |
| Client-side JavaScript | Obfuscated | Build script transformation |
| HTML/CSS | None needed | Minimal IP value |

### Server-Side Files (HIDDEN - completely invisible)

```
suitelet/FC_Suitelet.js           ✓ HIDDEN
suitelet/FC_Router.js             ✓ HIDDEN
lib/FC_Engine.js                  ✓ HIDDEN
lib/FC_LicenseGuard.js            ✓ HIDDEN
lib/FC_Debug.js                   ✓ HIDDEN
lib/providers/*.js                ✓ HIDDEN
lib/extraction/*.js               ✓ HIDDEN
lib/resolution/*.js               ✓ HIDDEN
lib/matching/*.js                 ✓ HIDDEN
lib/learning/*.js                 ✓ HIDDEN
lib/validation/*.js               ✓ HIDDEN
lib/vendors/*.js                  ✓ HIDDEN
lib/llm/*.js                      ✓ HIDDEN
lib/utils/*.js                    ✓ HIDDEN
scripts/FC_ProcessDocuments_MR.js ✓ HIDDEN
scripts/FC_Document_UE.js         ✓ HIDDEN
scripts/FC_EmailCapture_Plugin.js ✓ HIDDEN
scripts/FC_ContinuePolling_SS.js  ✓ HIDDEN
```

### Client-Side Files (OBFUSCATED - hard to read)

```
client/core/FC.Core.js            → Obfuscated
client/FC.Main.js                 → Obfuscated
client/views/View.Dashboard.js    → Obfuscated
client/views/View.Queue.js        → Obfuscated
client/views/View.Review.js       → Obfuscated
client/views/View.Settings.js     → Obfuscated
client/views/View.Rail.js         → Obfuscated
client/views/View.Documents.js    → Obfuscated
```

---

## Step-by-Step Setup

### Step 1: Build Distribution Package

```bash
# Install build dependencies
npm install

# Build with obfuscation
npm run build
```

This creates:
- `dist/bundle/` - Files ready for upload
- `dist/bundle-manifest.json` - Configuration reference
- `dist/INSTALL.txt` - Customer instructions

### Step 2: Upload to Your NetSuite Account

1. Log into your NetSuite dev/sandbox account
2. Go to **Documents > Files > File Cabinet**
3. Navigate to or create: `SuiteApps/com.flux.capture/`
4. Upload all files from `dist/bundle/FileCabinet/SuiteApps/com.flux.capture/`

### Step 3: Enable Hide in SuiteBundle

For each server-side `.js` file:

1. Click on the file in File Cabinet
2. Click **Edit**
3. Check **"Hide in SuiteBundle"**
4. Save

**Tip:** Use the helper script to automate this:
1. Upload `dist/FC_BundleHelper.js` as a Suitelet
2. Deploy and run with `?action=configure`

### Step 4: Create the Bundle

1. Go to **Customization > SuiteBundler > Create Bundle**
2. Fill in details:
   - **Name:** Flux Capture
   - **Version:** 1.0.0
   - **Description:** AI-powered document capture for NetSuite
   - **Availability:** Public (or Shared if you prefer)
3. Add components:
   - All script records (with deployments)
   - Both custom record types
   - All File Cabinet files under `SuiteApps/com.flux.capture/`
4. Save and note the **Bundle ID**

### Step 5: Configure Your Website

Update fluxfornetsuite.com with:
- The Bundle ID for installation instructions
- Your NetSuite Account ID (for bundle search)

See `WEBSITE_PORTAL_SPEC.md` for full website implementation details.

---

## Customer Installation Flow

### What Customers Do

1. **Visit fluxfornetsuite.com**
   - Click "Start Free Trial" or "Buy Now"

2. **Complete signup**
   - Enter email, company name
   - Receive license key via email

3. **Install in NetSuite**
   ```
   Customization > SuiteBundler > Search & Install Bundles

   Search for: "Flux Capture"
   (or enter your Account ID in the search)

   Click Install > Confirm > Wait 2-5 minutes
   ```

4. **Activate license**
   - Open Flux Capture (appears in menu after install)
   - Go to Settings
   - Enter license key
   - Click Validate

5. **Start using**
   - Upload first document
   - Configure extraction provider

---

## License System Integration

Your existing license system handles:

| Feature | How It Works |
|---------|--------------|
| **Access Control** | FC_LicenseGuard.js checks license on every request |
| **Installation Tracking** | License API logs account IDs that validate |
| **Trial Management** | 14-day trials with automatic expiration |
| **Usage Monitoring** | Health check endpoint reports activity |

### License Check Flow

```
Customer uses Flux Capture
        │
        ▼
FC_LicenseGuard.js checks cache
        │
        ├─── Cache valid? → Allow access
        │
        └─── Cache expired?
                │
                ▼
        POST fluxfornetsuite.com/api/v1/license-check
                │
                ├─── Valid → Cache result, allow access
                │
                └─── Invalid → Block with license required message
```

---

## Updating the Bundle

When you release updates:

1. Build new distribution package
2. Upload updated files to File Cabinet
3. Re-enable "Hide in SuiteBundle" on any new server-side files
4. Edit the bundle and increment version
5. Save bundle

**For customers:**
- They'll see update notification in SuiteBundler
- One-click update process
- Their data and settings are preserved

---

## Troubleshooting

### "Bundle not found" when searching

- Ensure bundle is saved and availability is "Public"
- Try searching by your Account ID instead of bundle name
- Bundle may take a few minutes to appear in search

### Scripts visible after installation

- "Hide in SuiteBundle" must be enabled BEFORE adding file to bundle
- Remove file from bundle, enable hide, re-add file

### License validation fails after install

- Check network connectivity to fluxfornetsuite.com
- Verify license key is entered correctly
- Check if trial has expired

---

## Quick Reference

### Build Commands

```bash
npm install                    # Install dependencies
npm run build                  # Full build with obfuscation
npm run build:bundle           # Package only (skip obfuscation)
```

### Key Information to Configure

| Setting | Value |
|---------|-------|
| Bundle ID | [Your bundle ID after creation] |
| Source Account ID | [Your NetSuite account ID] |
| License API | https://fluxfornetsuite.com/api/v1/license-check |
| Support Email | support@fluxfornetsuite.com |

### Files Reference

| File | Purpose |
|------|---------|
| `scripts/build-distribution.js` | Build and obfuscation |
| `scripts/verify-installation.js` | Installation verification CLI |
| `dist/bundle/` | Distribution-ready files |
| `portal/` | Website portal templates |
| `WEBSITE_PORTAL_SPEC.md` | Full website specification |

---

## Security Summary

| Layer | Protection | Bypass Difficulty |
|-------|------------|-------------------|
| Hide in SuiteBundle | Server code invisible | Impossible |
| Obfuscation | Client code unreadable | Very Hard |
| License Checks | 9+ files to modify | Hard |
| API Validation | Server-side enforcement | Impossible without server access |

**Combined protection makes unauthorized use impractical.**

---

*For website implementation details, see WEBSITE_PORTAL_SPEC.md*
