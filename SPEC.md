# Helions Forge — AI Quoting Engine
## Full Project Specification & Build Plan

> **How to use this file:**
> - Work through one Phase at a time in Claude Code
> - Paste the relevant phase/task block into a new Claude Code session
> - Delete completed phases as you go to keep context lean
> - Always reference the Stack & Schema sections when starting a new session

---

## Stack

| Layer | Tool |
|---|---|
| Framework | Next.js 14 (App Router) |
| Database | Supabase (PostgreSQL + pgvector) |
| Auth | Clerk (with Organisations for multi-tenant) |
| Hosting | Vercel |
| AI | Anthropic API — `claude-sonnet-4-6` (quoting), `claude-haiku-4-5` (sanitising/bulk) |
| Embeddings | OpenAI `text-embedding-3-small` |
| Email Inbound | Resend (inbound webhook) |
| Materials DB | Airtable (synced nightly to Supabase) |
| Styling | Tailwind CSS + shadcn/ui |

---

## Guiding Principles

- **Never return a single fixed price** — always return a low/high range + confidence indicator
- **Tenant isolation is non-negotiable** — every DB query must filter by `tenant_id`
- **Haiku for bulk, Sonnet for customer-facing** — keep token costs low
- **Manual before automated** — build upload-first flows before email automation
- **Phase 1 is single-tenant (Helions Forge only)** — multi-tenant comes in Phase 4

---

## Database Schema (Supabase)

Use this as the reference for all phases. Enable `pgvector` extension before running migrations.

```sql
-- Enable vector extension
CREATE EXTENSION IF NOT EXISTS vector;

-- Tenants table
CREATE TABLE tenants (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  clerk_org_id TEXT UNIQUE NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Material rates (synced from Airtable)
CREATE TABLE materials (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE,
  name TEXT NOT NULL,            -- e.g. "316 Stainless Steel"
  unit TEXT NOT NULL,            -- e.g. "per kg", "per metre"
  rate_gbp DECIMAL(10,2) NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- Historical quotes (cleaned, anonymised)
CREATE TABLE quotes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE,
  product_type TEXT,             -- e.g. "Balustrade", "Staircase"
  material TEXT,                 -- e.g. "316 Stainless"
  description TEXT,              -- Cleaned job description
  dimensions JSONB,              -- { length_m: 5, height_m: 1.1, etc. }
  price_low DECIMAL(10,2),
  price_high DECIMAL(10,2),
  final_price DECIMAL(10,2),     -- What was actually quoted/won
  status TEXT DEFAULT 'draft',   -- draft | sent | won | lost
  is_golden BOOLEAN DEFAULT false, -- Paid/won quotes = true
  lost_reason TEXT,              -- e.g. "price_too_high"
  raw_text TEXT,                 -- Original sanitised email/note
  embedding vector(1536),        -- OpenAI text-embedding-3-small
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Enquiries (incoming, before quoting)
CREATE TABLE enquiries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE,
  source TEXT DEFAULT 'manual',  -- manual | email | chatbot
  raw_input TEXT,                -- Original customer message
  image_urls TEXT[],             -- Uploaded photo URLs
  extracted_specs JSONB,         -- AI-extracted dimensions/materials
  status TEXT DEFAULT 'new',     -- new | quoting | quoted | archived
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Generated quotes (linked to enquiry)
CREATE TABLE generated_quotes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE,
  enquiry_id UUID REFERENCES enquiries(id),
  similar_quote_ids UUID[],      -- Top 3 matched historical quotes
  ai_reasoning TEXT,             -- Why AI suggested this range
  price_low DECIMAL(10,2),
  price_high DECIMAL(10,2),
  confidence TEXT,               -- low | medium | high
  reviewed_by TEXT,              -- Clerk user ID
  final_price DECIMAL(10,2),     -- After human review
  status TEXT DEFAULT 'draft',   -- draft | approved | sent
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Row Level Security
ALTER TABLE materials ENABLE ROW LEVEL SECURITY;
ALTER TABLE quotes ENABLE ROW LEVEL SECURITY;
ALTER TABLE enquiries ENABLE ROW LEVEL SECURITY;
ALTER TABLE generated_quotes ENABLE ROW LEVEL SECURITY;

-- RLS Policies (repeat for each table)
CREATE POLICY "tenant_isolation" ON quotes
  FOR ALL USING (tenant_id = (
    SELECT id FROM tenants WHERE clerk_org_id = auth.jwt() ->> 'org_id'
  ));
-- Repeat above policy for: materials, enquiries, generated_quotes
```

---

# Phase 1 - Completed

## Phase 2 - Completed

## Phase 3 — Completed

## Phase 4 — Completed

## Phase 5 — Completed

## Phase 6 — Multi-Tenant SaaS (White Label Template)

**Goal:** Convert single-tenant Helions Forge app into reusable SaaS platform.

### Tasks

- [ ] **6.1** Clerk Organisations setup:
  - Enable Organisations in Clerk dashboard
  - Update middleware to require `orgId` on all `/dashboard` routes
  - Update all Supabase queries to use `clerk_org_id` → `tenant_id` lookup

- [ ] **6.2** Tenant onboarding flow (`/onboarding`):
  - Create Clerk org
  - Set business name, industry type
  - Upload logo (stored in Supabase Storage)
  - Set initial material rates
  - Creates tenant row in DB

- [ ] **6.3** "Tone of voice" config per tenant:
  - Formal / Friendly / Technical toggle
  - Custom business description injected into prompts
  - Stored in tenants table as `prompt_config JSONB`

- [ ] **6.4** White-label theming:
  - Primary colour, logo per tenant
  - Applied to widget and any customer-facing pages
  - Stored in tenants table as `theme JSONB`

- [ ] **6.5** Tenant admin panel (`/dashboard/settings`):
  - Update material rates
  - Set price buffer %
  - Manage team members (Clerk org members)
  - View usage stats (quotes generated this month)

- [ ] **6.6** Usage/billing tracking:
  - `usage_logs` table tracking quotes generated per tenant per month
  - Monthly reset counter
  - Soft limit warnings (email at 80% of plan limit)

- [ ] **6.7** Data isolation audit:
  - Run through every API route and confirm `tenant_id` filter is present
  - Verify RLS policies block cross-tenant access with test queries

- [ ] **6.8** Super-admin panel (`/admin` — your account only):
  - List all tenants
  - View their usage
  - Manually trigger data sync

**Test checkpoint:** Create two test tenants with different data — confirm neither can see the other's quotes.

---

## Phase 7 — Email Inbound Pipeline (Automation)

**Goal:** Automate ingestion — emails sent to a quotes inbox auto-appear in dashboard.

### Tasks

- [ ] **7.1** Set up Resend inbound email:
  - Configure `quotes@helionsforge.com` inbound webhook
  - Points to Supabase Edge Function URL

- [ ] **7.2** Supabase Edge Function `functions/process-email/index.ts`:
  - Receives Resend webhook payload
  - Extracts email body text + any attachments
  - Calls sanitise API (Claude Haiku)
  - Generates embedding (OpenAI)
  - Inserts into `enquiries` table with `source: 'email'`
  - Triggers Supabase Realtime notification to dashboard

- [ ] **7.3** Attachment handling:
  - If PDF attached, extract text using edge function
  - If image attached, store URL and flag for vision processing

- [ ] **7.4** Duplicate detection:
  - Before inserting, check if similar embedding already exists (similarity > 0.95)
  - If duplicate, flag rather than create new row

- [ ] **7.5** Thread awareness:
  - Group emails by subject thread
  - Link reply emails to original enquiry row

**Test checkpoint:** Send a test email to the inbound address, verify it appears cleaned and structured in the dashboard within 30 seconds.

---

## Cost Management Notes

| Operation | Model | Approx Cost |
|---|---|---|
| Sanitise historical email | Claude Haiku | ~£0.0003 per email |
| Generate embedding | OpenAI text-embedding-3-small | ~£0.0001 per quote |
| Generate quote estimate | Claude Sonnet | ~£0.003 per quote |
| Extract specs from photo | Claude Sonnet (vision) | ~£0.005 per image |
| Chatbot conversation (full) | Claude Sonnet | ~£0.02 per session |

**Monthly cost estimate at 200 quotes/month:** ~£2–5 in AI tokens. Margin is very high.

### Token-saving rules to enforce in code:
1. Never send full email chain to Sonnet — sanitise with Haiku first, send only structured summary to Sonnet
2. Limit similar quotes context to 3 matches maximum
3. Truncate raw_text to 2000 chars before embedding
4. Cache material rates in memory — don't re-fetch on every request

---

## Claude Code Session Tips

When starting a new Claude Code session for a phase:

1. Paste only the relevant phase tasks (not the whole file)
2. Include the Stack table and Schema section
3. State clearly: "We are building Phase X. The previous phases are complete."
4. For debugging sessions, paste only the specific component/route with the issue

**Useful context to always include:**
- "Use Clerk `auth().orgId` for tenant identification"
- "All Supabase queries must include `.eq('tenant_id', tenantId)` filter"
- "Use `claude-haiku-4-5` for sanitisation, `claude-sonnet-4-6` for quote generation"
- "Always return price as a range `{ price_low, price_high }` never a single value"
---

## Planned Improvements & Future Phases

### Accuracy Improvements (after full Gmail import complete)
- Guided quoting wizard: after initial estimate, show clarifying 
  questions as a step-by-step popup modal. User answers each 
  question, AI recalculates with tighter range and higher confidence
- Confidence scoring by data density — auto low confidence 
  if fewer than 5 similar jobs exist for that product type
- Seasonal/date weighting — more recent won jobs weighted higher 
  than older ones so prices reflect current market
- Material price awareness — when Airtable rates update, flag 
  estimates that used old rates
- Win/loss pattern learning — if jobs in a certain price bracket 
  are consistently lost, AI adjusts ranges accordingly
- Photo analysis confidence boost — confidence automatically 
  increases when image is provided as visual data reduces ambiguity

### UX Improvements
- Quick copy button for formatted estimate summary
- Customer name + job reference field on enquiry form
- Customer estimate history — see all previous estimates 
  for the same customer
- One-click duplicate quote for similar jobs
- Mobile optimised layout for on-site use

### Materials Improvements
- Bulk CSV import for materials table
- CSV columns: name, unit, rate_gbp, length_m, weight_per_unit
- Common lengths: 6m or 7.5m (configurable per material)
- Weight field for steel sections (kg per metre or per unit)
- Full material cost calculation using weight x rate x length

### Gmail Import Improvements
- Bulk status editor — after import completes, quickly mark 
  jobs as won/lost/unknown in bulk to correct dashboard stats
- Re-run import periodically to catch new emails automatically

### Phase 8 — Gmail Integration (both options)

Option A — Gmail Add-on (sidebar inside Gmail):
- Sidebar panel appears inside Gmail when viewing 
  a customer email
- Shows AI estimate and suggested reply in the panel
- One click inserts formatted response with price range 
  into compose window
- Works like Gmail's built-in "Polish" feature
- Users can choose this OR Option B based on preference

Option B — Email forwarding (auto pipeline):
- Forward customer email to quotes@helionsforge.com
- Auto-appears in dashboard as new enquiry, pre-processed
- "Draft Reply" button generates professional response 
  with price range ready to copy back into Gmail
- Built as part of Phase 7 inbound email pipeline

Recommend building Option B in Phase 7 and Option A 
after launch as Phase 8.

### Phase 9 — Helions Forge Business App Integration

Existing app stack: Next.js, Airtable, Clerk, Vercel
Airtable base: "Helions Forge"
Tables: LEADS, JOBS, QUOTES, EQUIPMENT AND STOCK, 
        SUPPLIERS, PRODUCTS, PENDING ACTIONS, TASKS, 
        NOTIFICATIONS, SETTINGS, DAYS_LOG, INVOICES

Integration approach — Airtable as shared data layer:

On quote approved in Quote Engine:
- Auto-create record in LEADS table with:
  customer name, product type, estimate range, 
  job reference, source (quote engine), date

On lead converted to job:
- Create QUOTES record with final approved price
- Create JOBS record linked to quote

On job marked complete/won:
- Webhook back to Quote Engine
- Mark as golden training data in quotes table
- Update win rate statistics on dashboard

Full business loop:
Enquiry → AI Estimate → Approve → Lead → Quote 
→ Job → Invoice → Golden Training Data 
→ Better Future Estimates

Note: Both apps share Clerk auth so same login works 
across both. Integration to be scoped properly once 
Phase 5-7 are complete.
