# BespokeQuote — Phase 1 Build Spec
## For Claude Code — Read this entire document before writing any code

---

## What this product is

BespokeQuote is a multi-tenant SaaS for UK bespoke trade businesses (metalwork, gates, railings) that helps them quote enquiries faster using a **deterministic rules engine** with an AI layer on top.

**The AI never produces the price. The rules engine produces the price. AI is used for:**
- Extracting structured data from messy email enquiries
- Pre-filling the assumptions form
- Analysing photos to suggest job parameters
- Writing the email response in the tenant's tone
- Generating clarifying questions when info is missing
- Explaining why an estimate came out where it did

**Tenant 1 = Helions Forge** (my own metalwork business). This is the canary — I use this product daily for real jobs. Do not break it.

---

## Stack

| Layer | Tool |
|---|---|
| Framework | Next.js 14 (App Router) |
| Database | Supabase (PostgreSQL + pgvector) |
| Auth | Clerk (Organisations for multi-tenancy) |
| Hosting | Vercel |
| AI | Anthropic API — claude-sonnet-4-6 (quotes), claude-haiku-4-5 (extraction/sanitising) |
| Embeddings | OpenAI text-embedding-3-small |
| Payments | Stripe (flat £79/month, 14-day trial) |
| Styling | Tailwind CSS + shadcn/ui |

---

## RLS Status (completed before Phase 1)

RLS has been enabled and policies added to all tables. Every table has:
- A `tenant_isolation` policy restricting reads/writes to the authenticated tenant
- A `service_role_bypass` policy allowing server-side admin operations

**Do not remove or modify RLS policies. All Supabase queries in application code must use either:**
- The user JWT client (automatically scoped by RLS) for user-facing operations
- The service role client (`lib/supabase/admin.ts`) only for server-side admin operations (seeding, imports, background jobs)

---

## Current Database Schema

```sql
-- Core tables (all have tenant_id)
tenants (id, name, clerk_org_id, is_internal, plan, stripe_customer_id, 
         vertical, onboarding_complete, trial_ends_at, created_at)
quotes (id, tenant_id, product_type, material, description, dimensions, 
        price_low, price_high, final_price, status, is_golden, embedding...)
enquiries (id, tenant_id, source, raw_input, image_urls, extracted_specs, status)
generated_quotes (id, tenant_id, enquiry_id, price_low, price_high, 
                  confidence, assumptions, final_price, status)

-- Pricing tables (all have tenant_id)
product_pricing (id, tenant_id, category, design_name, width_mm, height_mm, 
                 price_gbp, helions_sku, supplier_sku, supplier_price, photo_url)
accessories_pricing (id, tenant_id, category, item_name, supplier_name, 
                     supplier_price, helions_price)
materials_pricing (id, tenant_id, material, kg_per_unit, unit_cost_gbp)
master_rates (id, tenant_id, fabrication_day_rate, installation_day_rate, 
              consumer_unit_connection, minimum_job_value, margin_target_percent)
job_types (id, tenant_id, job_type, minimum_value, manufacture_days, 
           install_days, engineers_required)
```

---

## Phase 1 Tasks — Work through these in order

### TASK 1 — Tenant isolation audit (no code changes yet)

Read every file in:
- `app/api/` (all route handlers)
- `lib/ai/` (all AI functions)
- `scripts/` (all scripts)

For each file, check:
1. Does it query Supabase? If yes, which tables?
2. Does it filter by `tenant_id`? 
3. Does it use the user client or admin/service role client?
4. Is there any hardcoded Helions Forge reference (UUID, name, etc)?

Output a table like this — do not fix anything yet, just list:

| File | Tables queried | tenant_id filtered? | Client used | Hardcoded HF ref? |
|------|---------------|--------------------|-----------|--------------------|
| app/api/quote/route.ts | quotes, product_pricing | Partial | admin | No |

Flag anything that's missing tenant_id filters as HIGH RISK.

---

### TASK 2 — Add missing columns to tenants table

Run this SQL in Supabase (check if columns already exist first):

```sql
ALTER TABLE tenants 
ADD COLUMN IF NOT EXISTS is_internal BOOLEAN DEFAULT false,
ADD COLUMN IF NOT EXISTS plan TEXT DEFAULT 'trial',
ADD COLUMN IF NOT EXISTS stripe_customer_id TEXT,
ADD COLUMN IF NOT EXISTS vertical TEXT DEFAULT 'metalwork',
ADD COLUMN IF NOT EXISTS onboarding_complete BOOLEAN DEFAULT false,
ADD COLUMN IF NOT EXISTS trial_ends_at TIMESTAMPTZ,
ADD COLUMN IF NOT EXISTS engine_version TEXT DEFAULT 'legacy';
```

Then update Helions Forge (Tenant 1) to be marked as internal:
```sql
UPDATE tenants 
SET is_internal = true, 
    plan = 'internal',
    vertical = 'metalwork',
    onboarding_complete = true
WHERE name = 'Helions Forge';
```

Verify with: `SELECT * FROM tenants;`

---

### TASK 3 — is_internal middleware bypass

Create a middleware helper that checks if the current tenant is internal and bypasses all gating checks if so.

In `middleware.ts` or a new `lib/tenant-gate.ts`:

```typescript
// Check if current tenant bypasses all restrictions
export async function isTenantInternal(tenantId: string): Promise<boolean> {
  const { data } = await supabaseAdmin
    .from('tenants')
    .select('is_internal')
    .eq('id', tenantId)
    .single()
  return data?.is_internal ?? false
}

// Use this before ANY gating check:
// - Stripe subscription status
// - Trial expiry
// - Usage limits
// - Feature flags
// - Rate limits
// If isTenantInternal() returns true, skip the check entirely
```

This must be:
- One function, one place — do not scatter the bypass logic
- Applied at middleware level, not in individual route handlers
- Permanent for Tenant 1 — no expiry, no override

---

### TASK 4 — Per-tenant engine version feature flag

Add `engine_version` to the tenants table (done in Task 2 above).

Values:
- `'legacy'` — current AI-based quote engine (default for all tenants)
- `'deterministic'` — new rules-based engine (Phase 1 build target)

In `lib/ai/quote-engine.ts`, add a routing function:

```typescript
export async function generateQuote(params: QuoteParams): Promise<QuoteResult> {
  const tenant = await getTenant(params.tenant_id)
  
  if (tenant.engine_version === 'deterministic') {
    return generateDeterministicQuote(params)
  } else {
    return generateLegacyQuote(params)  // existing code, untouched
  }
}
```

The legacy engine stays exactly as-is. The deterministic engine is built alongside it.

Start Tenant 1 on `'legacy'`. Switch to `'deterministic'` only after the calibration tool shows it's producing accurate estimates for real Helions Forge jobs.

---

### TASK 5 — Build the deterministic quote engine

Create `lib/ai/deterministic-engine.ts`

The engine works in this order:

**Step 1 — Extract structured data from enquiry**
Use Claude Haiku to extract:
```typescript
interface ExtractedSpec {
  product_type: 'iron_driveway_gates' | 'aluminium_driveway_gates' | 
                'iron_pedestrian_gate' | 'aluminium_pedestrian_gate' |
                'railings' | 'wall_top_railings' | 'handrails' | 
                'juliette_balcony' | 'unknown'
  material: 'mild_steel' | 'aluminium' | 'unknown'
  is_electric: boolean | null
  width_mm: number | null
  height_mm: number | null
  length_m: number | null  // for railings
  design_name: string | null  // e.g. "Norfolk", "Surrey"
  has_automation: boolean | null
  has_intercom: boolean | null
  installation_included: boolean | null
  confidence_per_field: Record<string, 'confirmed' | 'assumed' | 'unknown'>
}
```

**Step 2 — Look up exact product price**

For named aluminium/iron gate designs:
```typescript
// Find closest matching product in product_pricing
const product = await supabase
  .from('product_pricing')
  .select('*')
  .eq('tenant_id', tenantId)
  .eq('category', categoryFromProductType)
  .ilike('design_name', designName)
  .order('ABS(width_mm - targetWidth)')  // closest size
  .limit(1)
```

For bespoke iron/mild steel: no product lookup — use material cost calculation instead.

**Step 3 — Calculate installation cost**
```typescript
const jobType = await matchJobType(tenant_id, product_type, is_electric)
// From job_types table

const installCost = jobType.install_days 
  * masterRates.installation_day_rate 
  * jobType.engineers_required

const manufactureCost = jobType.manufacture_days 
  * masterRates.fabrication_day_rate
  * complexityMultiplier  // 1.0 to 2.0 based on design complexity
```

**Step 4 — Add relevant accessories**
Auto-include standard accessories for the job type:
- Electric gates: motor kit, photocells, remote fobs, underground shoes
- Posts if not brick-to-brick
- Consumer unit connection if no existing power

Fetch from `accessories_pricing` table.

**Step 5 — Apply minimums**
```typescript
const MINIMUMS = {
  iron_driveway_gates_electric: 10500,
  iron_driveway_gates_manual: 2500,
  aluminium_driveway_gates_electric: 8500,
  aluminium_driveway_gates_manual: 1800,
  iron_pedestrian_gate: 1200,
  aluminium_pedestrian_gate: 1000,
  railings_per_metre: 150,
}
// Never go below minimum for that product type
// Also check job_types.minimum_value
```

**Step 6 — Calculate confidence score (deterministic)**
```typescript
const confirmedFields = Object.values(confidence_per_field)
  .filter(v => v === 'confirmed').length
const totalFields = Object.keys(confidence_per_field).length
const fieldConfidence = confirmedFields / totalFields

// 'high' if >80% fields confirmed + exact product match found
// 'medium' if 50-80% confirmed OR product match found
// 'low' if <50% confirmed AND no product match
```

**Step 7 — Generate price range**
```typescript
const basePrice = productCost + installCost + manufactureCost + accessoriesCost

// Range width depends on confidence
const rangeMultiplier = {
  high: 0.10,    // ±10%
  medium: 0.20,  // ±20%  
  low: 0.35,     // ±35% (rough estimate)
}

price_low = Math.max(minimum, basePrice * (1 - rangeMultiplier[confidence]))
price_high = basePrice * (1 + rangeMultiplier[confidence])
```

**Step 8 — Generate cost breakdown**
```typescript
interface CostBreakdown {
  product_supply: number
  manufacture: number
  installation: number
  accessories: ItemisedCost[]
  finishing: number
  subtotal: number
  contingency: number
  price_low: number
  price_high: number
}
```

**Step 9 — Use AI only for explanation and questions**
After the price is calculated deterministically, call Claude Haiku to:
- Write 2-3 sentences explaining why the estimate came out where it did
- Generate clarifying questions for any `'unknown'` fields

---

### TASK 6 — Build the calibration tool

This is a dev tool first, user-facing feature second. Build it at `/dashboard/calibration`.

**The flow:**
1. User pastes a past quote (email thread or quote PDF text)
2. System runs it through the deterministic engine
3. User enters what they actually charged
4. System shows:
   - "Deterministic engine estimated: £X - £Y"
   - "You actually charged: £Z"
   - "Difference: £N (N%)"
   - "Suggested rule adjustments: [list]"
5. User can accept or reject each suggested adjustment
6. Accepted adjustments update the relevant row in `master_rates` or `job_types`

**Suggested adjustments logic:**
- If actual > estimate_high: suggest increasing relevant day rate or complexity multiplier
- If actual < estimate_low: suggest decreasing or checking if product was looked up correctly
- Show which specific line item caused the biggest gap

**Route:** `/dashboard/calibration`
**API:** `/api/calibration/analyse` (POST — takes past quote text + actual price, returns comparison)
**API:** `/api/calibration/apply` (POST — takes adjustment, updates tenant's rates)

---

### TASK 7 — Tenant isolation fixes (from audit in Task 1)

After completing the audit in Task 1, fix any HIGH RISK gaps found:
- Add missing `tenant_id` filters to any queries that don't have them
- Replace any hardcoded Helions Forge UUIDs with dynamic tenant lookup
- Ensure all background jobs and scripts accept `--tenant-id` parameter

---

### TASK 8 — Onboarding flow skeleton

Build the basic onboarding flow at `/onboarding`. This is gated — only shown to new tenants where `onboarding_complete = false`.

**Steps:**
1. Welcome screen — "Let's get your estimator set up. Takes about 10 minutes."
2. Inherit industry defaults — automatically copy metalwork vertical defaults into tenant's pricing tables. Show a summary: "We've loaded 800+ products, 40 accessories, and standard materials for metalwork."
3. Set key rates (4 fields):
   - Fabrication day rate (default: £507)
   - Installation day rate (default: £523.84)
   - Minimum job value (default: £500)
   - Markup target % (default: 30%)
4. Set 3 key rules:
   - Minimum automated iron gate value (default: £10,500)
   - Minimum automated aluminium gate value (default: £8,500)
   - Travel uplift beyond X miles (default: none)
5. Done — redirect to `/dashboard`

Mark `onboarding_complete = true` when Step 5 is reached.

**Important:** Tenant 1 (Helions Forge) skips onboarding entirely because `onboarding_complete = true` is already set.

---

### TASK 9 — Stripe integration

**Plan:** £79/month flat, 14-day free trial, one product, one price.

Install: `npm install stripe @stripe/stripe-js`

Environment variables needed:
```
STRIPE_SECRET_KEY=
STRIPE_PUBLISHABLE_KEY=
STRIPE_WEBHOOK_SECRET=
STRIPE_PRICE_ID=  (create this in Stripe dashboard first)
```

**Routes to build:**
- `/api/stripe/create-checkout` — creates Stripe checkout session for new tenant
- `/api/stripe/webhook` — handles `customer.subscription.created`, `customer.subscription.deleted`, `invoice.payment_failed`
- `/api/stripe/portal` — creates Stripe billing portal session for existing tenant

**Middleware gating:**
```typescript
// In middleware, after auth check:
const tenant = await getTenant(orgId)

if (tenant.is_internal) {
  // bypass all checks, proceed
} else if (tenant.plan === 'trial' && tenant.trial_ends_at > now) {
  // allow, show trial banner
} else if (tenant.plan === 'active') {
  // allow
} else {
  // redirect to /subscribe
}
```

**Webhook handler updates `tenants` table:**
- `subscription.created` → set `plan = 'active'`, `stripe_customer_id`
- `subscription.deleted` → set `plan = 'cancelled'`
- `payment_failed` → set `plan = 'past_due'`

---

## Key rules to follow throughout Phase 1

1. **Never break Tenant 1's daily workflow.** If a change could affect the quote generation, pricing pages, or Gmail add-on for Helions Forge, flag it before shipping.

2. **One task at a time.** Complete and verify each task before starting the next. Don't start Task 5 until Tasks 1-4 are confirmed working.

3. **Calibration is a dev tool first.** Use it constantly during Task 5 to verify the deterministic engine is producing sensible estimates for real Helions Forge jobs before switching the engine_version flag.

4. **The legacy engine is untouched.** Do not modify `generateLegacyQuote()` or any existing prompt logic. The new engine is built alongside it, not replacing it.

5. **All pricing constants must come from the database.** No hardcoded prices, minimums, or day rates in application code. Everything comes from `master_rates`, `job_types`, or `product_pricing` tables.

---

## How to start each Claude Code session

Paste this at the top of every new session:

```
I am building BespokeQuote — a multi-tenant SaaS for UK bespoke trade businesses.
Stack: Next.js 14, Supabase (pgvector + RLS), Clerk Organisations, Anthropic API, Stripe, Vercel.
Tenant 1 = Helions Forge (my own metalwork business) — do not break their daily workflow.
Read PHASE1_SPEC.md before writing any code.
We are working on Task [X]. Previous tasks are complete.
```

---

## Current status

- [x] RLS enabled and policies added to all tables
- [x] Service role bypass policies in place
- [ ] Task 1 — Tenant isolation audit
- [ ] Task 2 — tenants table columns
- [ ] Task 3 — is_internal middleware bypass
- [ ] Task 4 — Per-tenant engine version flag
- [ ] Task 5 — Deterministic quote engine
- [ ] Task 6 — Calibration tool
- [ ] Task 7 — Tenant isolation fixes
- [ ] Task 8 — Onboarding flow
- [ ] Task 9 — Stripe integration
