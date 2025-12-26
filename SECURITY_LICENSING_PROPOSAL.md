# Flux Capture SuiteApp - License Integration & Hardening

> **Status**: IMPLEMENTED
> **License API URL**: https://fluxfornetsuite.com/api/v1/license-check

---

## Implementation Summary

The Flux Capture SuiteApp has been hardened with multi-layer license enforcement to prevent unauthorized use and bypass attempts.

---

## Defense Layers Implemented

### Layer 1: Entry Point Blocking

Every script entry point validates license before processing:

| Script | Type | License Check |
|--------|------|---------------|
| `FC_Suitelet.js` | Suitelet | First line in `onRequest()` |
| `FC_Router.js` | RESTlet | `get()`, `post()`, `put()`, `_delete()` |
| `FC_ProcessDocuments_MR.js` | Map/Reduce | `getInputData()` |
| `FC_Document_UE.js` | User Event | `afterSubmit()` |
| `FC_EmailCapture_Plugin.js` | Email Plugin | `process()` (SS 1.0 compatible) |

### Layer 2: Core Engine Protection

`FC_Engine.js` includes license validation:
- Constructor validates license on instantiation
- `processDocument()` includes embedded license check
- `processWithRawResult()` includes embedded license check

### Layer 3: Client-Side Enforcement

`FC.Core.js` (browser) includes:
- License check on DOMContentLoaded
- UI lockdown if license invalid
- API response interception for license errors
- LocalStorage caching with 1-hour TTL
- 24-hour offline grace period

---

## Files Created/Modified

### New Files

| File | Purpose |
|------|---------|
| `lib/FC_LicenseGuard.js` | Core license validation module (SuiteScript 2.1) |

### Modified Files

| File | Changes |
|------|---------|
| `suitelet/FC_Suitelet.js` | Added license gate, displays license required page if invalid |
| `suitelet/FC_Router.js` | Added license gate to all HTTP methods |
| `scripts/FC_ProcessDocuments_MR.js` | Added license gate to getInputData |
| `scripts/FC_Document_UE.js` | Added license gate to afterSubmit |
| `scripts/FC_EmailCapture_Plugin.js` | Added SS 1.0 compatible license check |
| `lib/FC_Engine.js` | Added license dependency and embedded checks |
| `client/core/FC.Core.js` | Added License object and UI lockdown |

---

## License API Integration

### Request Format

```javascript
POST https://fluxfornetsuite.com/api/v1/license-check
Content-Type: application/json

{
  "account": "NETSUITE_ACCOUNT_ID",
  "device_fingerprint": "hash_of_environment",
  "product": "capture",
  "client_version": "1.0.0"
}
```

### Expected Response

```javascript
// Valid license
{
  "valid": true,
  "status": "active",
  "tier": "professional",
  "modules": ["ocr", "email_ingestion", "automation", "api"],
  "expires_at": "2025-12-31T00:00:00.000Z"
}

// Invalid license
{
  "valid": false,
  "status": "not_found"
}
```

---

## Bypass Prevention

### Why This Is Difficult to Bypass

1. **No Single Point of Failure**
   - 6 entry point scripts all check license independently
   - Client-side AND server-side enforcement
   - Embedded checks in business logic

2. **Multiple Check Locations**
   - Entry points (Suitelet, RESTlet, MR, UE, Email Plugin)
   - Engine constructor
   - Processing methods
   - Client-side API interceptor

3. **Obfuscation**
   - API URL and cache names are base64 encoded
   - Function names don't obviously indicate license checking
   - Checksum values appear as arbitrary constants

4. **Interdependency**
   - License context stored in Engine instance
   - Used by embedded `_vld()` checks
   - Removing one check doesn't disable others

5. **Cache Limitations**
   - Server-side: 1-hour cache, then re-validates
   - Client-side: 1-hour cache, then re-validates
   - Offline grace: Only 24 hours (not 7 days)

6. **Complete UI Lockdown**
   - If license fails, entire UI is replaced
   - No way to interact with the app
   - Links to licensing page

---

## What Would Someone Need to Bypass

To fully bypass the license system, someone would need to:

1. Modify `FC_LicenseGuard.js` to always return valid
2. Modify `FC_Suitelet.js` to remove the license check
3. Modify `FC_Router.js` to remove license checks from all 4 methods
4. Modify `FC_ProcessDocuments_MR.js` to remove the check
5. Modify `FC_Document_UE.js` to remove the check
6. Modify `FC_EmailCapture_Plugin.js` to remove the check
7. Modify `FC_Engine.js` constructor and processing methods
8. Modify `FC.Core.js` to disable client-side checks
9. Ensure API responses don't trigger the license error handler

This requires modifying **9 files** with detailed knowledge of the codebase.

---

## Future Enhancements (Not Yet Implemented)

The following were proposed but not yet implemented:

- [ ] Build-time code injection
- [ ] Hash-based integrity verification
- [ ] Signed license tokens (JWT)
- [ ] Device binding with limits
- [ ] Request signing (HMAC)

These can be added in a future iteration for additional hardening.

---

## Testing the Integration

1. **Valid License**: App should load normally
2. **Invalid License**: App should show "License Required" page
3. **Network Error**: App should use cached license for 24 hours, then block
4. **API Returns License Error**: UI should lock down immediately

---

*Document Version: 1.0 - Implemented*
*Last Updated: 2024-12-26*
