# Flux for NetSuite - Website Portal Specification

> **Project**: fluxfornetsuite.com
> **Purpose**: Marketing website + license management portal for Flux Capture SuiteApp
> **Give this document to an LLM to build the website**

---

## Overview

Build a website for **Flux Capture**, an AI-powered document capture solution for NetSuite. The website needs:

1. **Marketing pages** - Product info, pricing, features
2. **Trial/Purchase flow** - Self-service signup and payment
3. **License API** - Backend for the NetSuite SuiteApp to validate licenses
4. **Customer portal** - License management, usage stats

---

## Tech Stack Recommendations

| Component | Recommended | Alternatives |
|-----------|-------------|--------------|
| Framework | Next.js 14 (App Router) | Remix, Astro |
| Database | PostgreSQL (via Supabase or Neon) | PlanetScale, MongoDB |
| Auth | Clerk or NextAuth | Supabase Auth, Auth0 |
| Payments | Stripe | Paddle, LemonSqueezy |
| Email | Resend | SendGrid, Postmark |
| Hosting | Vercel | Netlify, Railway |
| Styling | Tailwind CSS | - |

---

## Site Structure

```
fluxfornetsuite.com/
├── / (home)                    # Landing page
├── /features                   # Feature details
├── /pricing                    # Pricing page
├── /install                    # Installation guide
├── /docs                       # Documentation
├── /blog                       # Blog/updates
├── /contact                    # Contact form
├── /trial                      # Start trial flow
├── /buy                        # Purchase flow
├── /login                      # Customer login
├── /dashboard                  # Customer portal
│   ├── /licenses              # License management
│   ├── /usage                 # Usage statistics
│   ├── /billing               # Billing/invoices
│   └── /settings              # Account settings
└── /api/v1/                    # API endpoints
    ├── /license-check         # License validation (for SuiteApp)
    ├── /trial-request         # Create trial
    ├── /verify-installation   # Check installation
    └── /webhook/*             # Stripe webhooks
```

---

## Database Schema

### Tables

```sql
-- Customers (companies using Flux Capture)
CREATE TABLE customers (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email VARCHAR(255) NOT NULL UNIQUE,
    company_name VARCHAR(255) NOT NULL,
    phone VARCHAR(50),
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW(),

    -- Stripe integration
    stripe_customer_id VARCHAR(255),

    -- Source tracking
    source VARCHAR(100),  -- 'google', 'referral', 'direct', etc.
    referral_code VARCHAR(50)
);

-- Licenses (one per NetSuite account)
CREATE TABLE licenses (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    customer_id UUID REFERENCES customers(id) ON DELETE CASCADE,

    -- License identification
    license_key VARCHAR(50) NOT NULL UNIQUE,  -- Format: LIC-XXXX-XXXX-XXXX or TRL-XXXX-XXXX-XXXX
    netsuite_account_id VARCHAR(50),          -- e.g., "123456" or "TSTDRV123456"

    -- License status
    status VARCHAR(20) NOT NULL DEFAULT 'active',  -- 'active', 'trial', 'expired', 'suspended', 'cancelled'
    type VARCHAR(20) NOT NULL DEFAULT 'trial',     -- 'trial', 'monthly', 'annual'

    -- Dates
    created_at TIMESTAMP DEFAULT NOW(),
    activated_at TIMESTAMP,                    -- When first used in NetSuite
    expires_at TIMESTAMP NOT NULL,
    cancelled_at TIMESTAMP,

    -- Stripe subscription
    stripe_subscription_id VARCHAR(255),

    -- Constraints
    CONSTRAINT valid_status CHECK (status IN ('active', 'trial', 'expired', 'suspended', 'cancelled')),
    CONSTRAINT valid_type CHECK (type IN ('trial', 'monthly', 'annual'))
);

-- License checks log (for analytics and abuse detection)
CREATE TABLE license_checks (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    license_id UUID REFERENCES licenses(id) ON DELETE CASCADE,

    -- Request details
    netsuite_account_id VARCHAR(50) NOT NULL,
    client_version VARCHAR(20),
    device_fingerprint VARCHAR(255),
    ip_address INET,

    -- Result
    result VARCHAR(20) NOT NULL,  -- 'valid', 'invalid', 'expired', 'not_found'

    checked_at TIMESTAMP DEFAULT NOW()
);

-- Usage statistics (aggregated daily)
CREATE TABLE usage_stats (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    license_id UUID REFERENCES licenses(id) ON DELETE CASCADE,

    date DATE NOT NULL,

    -- Metrics
    documents_processed INTEGER DEFAULT 0,
    api_calls INTEGER DEFAULT 0,

    UNIQUE(license_id, date)
);

-- Indexes for performance
CREATE INDEX idx_licenses_key ON licenses(license_key);
CREATE INDEX idx_licenses_account ON licenses(netsuite_account_id);
CREATE INDEX idx_licenses_status ON licenses(status);
CREATE INDEX idx_license_checks_license ON license_checks(license_id);
CREATE INDEX idx_license_checks_account ON license_checks(netsuite_account_id);
CREATE INDEX idx_usage_stats_license_date ON usage_stats(license_id, date);
```

---

## API Endpoints

### 1. License Check (Called by SuiteApp)

**This is the most critical endpoint - the SuiteApp calls it on every user action.**

```
POST /api/v1/license-check
Content-Type: application/json
```

**Request:**
```json
{
    "account": "123456",              // NetSuite account ID (required)
    "license_key": "LIC-XXXX-XXXX",   // License key (optional if account is bound)
    "device_fingerprint": "abc123",   // Unique install identifier
    "product": "capture",             // Always "capture" for now
    "client_version": "1.0.0"         // SuiteApp version
}
```

**Response (valid):**
```json
{
    "valid": true,
    "status": "active",
    "expires_at": "2025-12-31T23:59:59Z"
}
```

**Response (invalid):**
```json
{
    "valid": false,
    "status": "expired",              // or "not_found", "suspended", "cancelled"
    "message": "License expired on 2024-12-01"
}
```

**Logic:**
1. Look up license by `license_key` OR `netsuite_account_id`
2. If found, check if `status` is active and `expires_at` > now
3. Log the check to `license_checks` table
4. If first check for this account, set `activated_at`
5. Return result

**Performance requirements:**
- Must respond in < 200ms (SuiteApp caches for 1 hour)
- Should handle 1000+ requests/minute

### 2. Trial Request

```
POST /api/v1/trial-request
Content-Type: application/json
```

**Request:**
```json
{
    "email": "user@company.com",
    "company": "Acme Corp",
    "phone": "+1-555-123-4567",       // Optional
    "account_id": "123456",           // Optional - NetSuite account ID
    "source": "google"                // Optional - attribution
}
```

**Response:**
```json
{
    "success": true,
    "trial_key": "TRL-A1B2-C3D4-E5F6",
    "expires_at": "2025-01-09T23:59:59Z",  // 14 days from now
    "bundle_id": "123456",
    "installation_url": "https://fluxfornetsuite.com/install"
}
```

**Logic:**
1. Create customer record if email doesn't exist
2. Generate unique trial license key (format: `TRL-XXXX-XXXX-XXXX`)
3. Create license with `type: 'trial'`, expires in 14 days
4. If `account_id` provided, bind license to that account
5. Send welcome email with license key and install instructions
6. Return trial details

### 3. Verify Installation

```
POST /api/v1/verify-installation
Content-Type: application/json
```

**Request:**
```json
{
    "account": "123456",
    "license_key": "LIC-XXXX-XXXX"    // Optional
}
```

**Response:**
```json
{
    "installed": true,
    "version": "1.0.0",
    "first_seen": "2024-12-20T10:30:00Z",
    "last_activity": "2024-12-26T14:22:00Z",
    "license": {
        "valid": true,
        "status": "active",
        "expires_at": "2025-12-31T23:59:59Z"
    }
}
```

**Logic:**
1. Look up license by account ID or license key
2. Check `license_checks` table for activity from this account
3. Return installation status and license info

### 4. Create Subscription (Stripe Checkout)

```
POST /api/v1/create-checkout
Content-Type: application/json
Authorization: Bearer <session_token>
```

**Request:**
```json
{
    "plan": "annual",                 // "monthly" or "annual"
    "license_key": "TRL-XXXX-XXXX",   // Existing trial to convert (optional)
    "account_id": "123456"            // NetSuite account to license
}
```

**Response:**
```json
{
    "checkout_url": "https://checkout.stripe.com/..."
}
```

### 5. Stripe Webhook Handler

```
POST /api/v1/webhook/stripe
```

Handle these events:
- `checkout.session.completed` - Create/upgrade license
- `invoice.paid` - Extend license expiration
- `invoice.payment_failed` - Send warning email
- `customer.subscription.deleted` - Mark license as cancelled

---

## Page Specifications

### Home Page (`/`)

**Purpose:** Convert visitors to trial signups

**Sections:**
1. **Hero**
   - Headline: "Stop Manual Data Entry. Let AI Capture Your Invoices."
   - Subheadline: "Flux Capture extracts data from invoices, receipts, and bills directly into NetSuite. 95%+ accuracy. 2-minute setup."
   - CTA: "Start Free Trial" → `/trial`
   - Secondary CTA: "Watch Demo" → video modal

2. **Social Proof**
   - "Trusted by X companies processing Y documents/month"
   - Logo bar of customers (or "As seen in" publications)

3. **Features Grid** (link to `/features`)
   - AI-Powered Extraction
   - Email Inbox Monitoring
   - Vendor Auto-Matching
   - PO Matching & 3-Way Match
   - Multi-Document Batch Processing
   - Learning from Corrections

4. **How It Works** (3 steps)
   - Step 1: Upload or email documents
   - Step 2: AI extracts all fields
   - Step 3: Review and approve to NetSuite

5. **Pricing Preview**
   - Simple pricing mention
   - "Starting at $X/month"
   - CTA: "See Pricing" → `/pricing`

6. **Testimonials**
   - 2-3 customer quotes with photos

7. **FAQ**
   - Common questions

8. **Final CTA**
   - "Ready to eliminate manual data entry?"
   - "Start Free Trial" button

### Pricing Page (`/pricing`)

**Pricing Model:** Flat monthly/annual fee (not usage-based)

**Display:**
```
┌─────────────────────────────────────────────────────────┐
│                                                          │
│   Monthly          Annual (Save 20%)                    │
│   $XXX/mo          $XXX/mo (billed annually)            │
│                                                          │
│   ✓ Unlimited documents                                 │
│   ✓ All AI extraction features                          │
│   ✓ Email inbox monitoring                              │
│   ✓ Vendor matching                                     │
│   ✓ PO matching                                         │
│   ✓ Email support                                       │
│                                                          │
│   [Start Free Trial]                                    │
│   14 days free, no credit card required                 │
│                                                          │
└─────────────────────────────────────────────────────────┘
```

**FAQ Section:**
- How does the trial work?
- Can I cancel anytime?
- Do you offer refunds?
- Is there a setup fee?
- Do you offer volume discounts?

### Trial Page (`/trial`)

**Purpose:** Capture trial signups

**Form Fields:**
- Work Email (required)
- Company Name (required)
- Phone (optional)
- NetSuite Account ID (optional, with help text)
- "How did you hear about us?" dropdown (optional)

**After Submit:**
1. Show success message with license key
2. Show next steps:
   - Check email for details
   - Install bundle in NetSuite
   - Enter license key in Settings

**Email Sent:**
- Subject: "Your Flux Capture Trial is Ready"
- Contains: License key, Bundle ID, installation steps, support contact

### Installation Guide (`/install`)

**Purpose:** Step-by-step installation instructions

**Content:**

```markdown
## Installation Guide

### Prerequisites
- NetSuite Administrator access
- 5 minutes

### Step 1: Install the Bundle

1. Log into NetSuite as Administrator
2. Navigate to: **Customization > SuiteBundler > Search & Install Bundles**
3. In the search box, enter: `Flux Capture`
   (or search by Account ID: `XXXXXX`)
4. Click on **Flux Capture** in the results
5. Click **Install**
6. Review the components and click **Install Bundle**
7. Wait 2-5 minutes for installation to complete

### Step 2: Access Flux Capture

After installation, Flux Capture appears in your NetSuite menu.

1. Navigate to: **Flux Capture** (in main menu or Setup)
2. You should see the Flux Capture dashboard

### Step 3: Enter Your License Key

1. Click the **Settings** icon (gear)
2. Find the **License Key** field
3. Enter your license key: `TRL-XXXX-XXXX-XXXX`
4. Click **Validate**
5. You should see "License Valid"

### Step 4: Configure Extraction Provider

1. In Settings, go to **Extraction Provider**
2. Choose your AI provider (Azure recommended)
3. Enter your API credentials
4. Click **Save**

### You're Ready!

Upload your first document and watch the magic happen.

[Upload First Document] [Read Documentation]
```

### Customer Dashboard (`/dashboard`)

**Requires authentication**

**Sections:**

1. **Overview**
   - License status (active/trial/expired)
   - Days remaining (for trial)
   - Documents processed this month
   - Quick actions

2. **License Management** (`/dashboard/licenses`)
   - Current license details
   - NetSuite account ID bound
   - Expiration date
   - Upgrade/renew buttons

3. **Usage Statistics** (`/dashboard/usage`)
   - Documents processed over time (chart)
   - API calls
   - Last activity

4. **Billing** (`/dashboard/billing`)
   - Current plan
   - Next billing date
   - Payment method
   - Invoice history
   - "Manage Subscription" → Stripe Customer Portal

5. **Settings** (`/dashboard/settings`)
   - Update email
   - Change password
   - Company details

---

## Email Templates

### 1. Trial Welcome

**Subject:** Your Flux Capture Trial is Ready

```
Hi {company_name},

Welcome to Flux Capture! Your 14-day free trial is ready.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
YOUR LICENSE KEY
{license_key}
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

INSTALLATION STEPS:

1. Log into NetSuite as Administrator
2. Go to: Customization > SuiteBundler > Search & Install Bundles
3. Search for "Flux Capture" and click Install
4. Open Flux Capture and enter your license key in Settings

BUNDLE ID: {bundle_id}

Need help? Reply to this email or visit fluxfornetsuite.com/docs

Your trial expires: {expires_at}

Happy automating!
The Flux Team
```

### 2. Trial Expiring (3 days before)

**Subject:** Your Flux Capture trial expires in 3 days

```
Hi {company_name},

Your Flux Capture trial expires on {expires_at}.

You've processed {documents_count} documents so far. Don't lose access!

[Upgrade Now] - Keep your data and settings

Questions? Just reply to this email.

The Flux Team
```

### 3. Trial Expired

**Subject:** Your Flux Capture trial has expired

```
Hi {company_name},

Your Flux Capture trial expired on {expires_at}.

The good news: Your data is safe, and you can reactivate anytime.

[Reactivate Now]

We'd love to have you back!

The Flux Team
```

### 4. Payment Successful

**Subject:** Payment received - Flux Capture

```
Hi {company_name},

Thanks for subscribing to Flux Capture!

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
RECEIPT
Plan: {plan_name}
Amount: ${amount}
Next billing: {next_billing_date}
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Your license has been updated and is active until {expires_at}.

View your dashboard: https://fluxfornetsuite.com/dashboard

The Flux Team
```

### 5. Payment Failed

**Subject:** Action required - Payment failed for Flux Capture

```
Hi {company_name},

We couldn't process your payment for Flux Capture.

Please update your payment method to avoid service interruption:

[Update Payment Method]

If you have questions, just reply to this email.

The Flux Team
```

---

## Configuration Values

These values need to be set in environment variables:

```env
# App
NEXT_PUBLIC_APP_URL=https://fluxfornetsuite.com
NEXT_PUBLIC_APP_NAME="Flux Capture"

# Database
DATABASE_URL=postgresql://...

# Stripe
STRIPE_SECRET_KEY=sk_live_...
STRIPE_WEBHOOK_SECRET=whsec_...
NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY=pk_live_...
STRIPE_PRICE_MONTHLY=price_...
STRIPE_PRICE_ANNUAL=price_...

# Email (Resend)
RESEND_API_KEY=re_...
EMAIL_FROM="Flux for NetSuite <hello@fluxfornetsuite.com>"

# NetSuite Bundle Info
NEXT_PUBLIC_BUNDLE_ID=123456
NEXT_PUBLIC_SOURCE_ACCOUNT_ID=123456

# Auth (if using Clerk)
NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=pk_...
CLERK_SECRET_KEY=sk_...
```

---

## License Key Format

**Trial:** `TRL-XXXX-XXXX-XXXX`
**Paid:** `LIC-XXXX-XXXX-XXXX`

Where X is alphanumeric (A-Z, 0-9), generated randomly.

**Generation code:**
```javascript
function generateLicenseKey(type = 'LIC') {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  const segment = () => Array.from({ length: 4 }, () =>
    chars[Math.floor(Math.random() * chars.length)]
  ).join('');

  return `${type}-${segment()}-${segment()}-${segment()}`;
}
```

---

## Security Considerations

1. **Rate Limiting**
   - `/api/v1/license-check`: 100 requests/minute per IP
   - `/api/v1/trial-request`: 5 requests/hour per IP
   - Apply stricter limits on auth endpoints

2. **License Key Security**
   - Keys are not secret (visible in NetSuite settings)
   - Security comes from account binding + server validation
   - Log all checks for abuse detection

3. **Webhook Verification**
   - Always verify Stripe webhook signatures
   - Use idempotency keys for payment processing

4. **Input Validation**
   - Validate email format
   - Sanitize NetSuite account IDs (alphanumeric only)
   - Validate license key format before lookup

---

## Analytics Events to Track

Track these events for understanding user behavior:

| Event | Properties |
|-------|------------|
| `page_view` | `path`, `referrer` |
| `trial_started` | `email`, `company`, `source` |
| `trial_converted` | `license_key`, `plan` |
| `trial_expired` | `license_key`, `documents_processed` |
| `installation_verified` | `account_id`, `version` |
| `subscription_cancelled` | `license_key`, `reason` |

---

## Support Integration

Consider integrating:
- **Intercom** or **Crisp** for live chat
- **Help Scout** or **Zendesk** for ticket management
- **Cal.com** for demo booking

Add chat widget on all pages except docs.

---

## SEO Considerations

**Key pages to optimize:**
- `/` - "NetSuite document capture", "NetSuite OCR", "NetSuite invoice automation"
- `/features` - Feature-specific keywords
- `/pricing` - "NetSuite capture pricing"

**Technical SEO:**
- Proper meta tags on all pages
- Open Graph images for social sharing
- Sitemap.xml
- Robots.txt
- Structured data for software product

---

## Launch Checklist

- [ ] All pages built and responsive
- [ ] Trial flow working end-to-end
- [ ] Stripe integration tested with test keys
- [ ] Email templates configured
- [ ] License API responding correctly
- [ ] Bundle ID configured
- [ ] DNS configured
- [ ] SSL certificate active
- [ ] Analytics tracking
- [ ] Error monitoring (Sentry)
- [ ] Backup strategy for database

---

*This specification should provide everything needed to build the complete website and license management system.*
