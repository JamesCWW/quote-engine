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

## Phase 1 — Project Setup & Database

**Goal:** Working Next.js app with Supabase, Clerk, and database schema. No AI yet.

### Tasks

- [ ] **1.1** Scaffold Next.js 14 app with App Router
  ```bash
  npx create-next-app@latest helions-forge --typescript --tailwind --app
  ```

- [ ] **1.2** Install dependencies
  ```bash
  npm install @clerk/nextjs @supabase/supabase-js @supabase/ssr ai @anthropic-ai/sdk openai
  npm install @radix-ui/react-dialog @radix-ui/react-select lucide-react class-variance-authority
  npx shadcn@latest init
  ```

- [ ] **1.3** Set up environment variables (`.env.local`)
  ```
  NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=
  CLERK_SECRET_KEY=
  NEXT_PUBLIC_SUPABASE_URL=
  NEXT_PUBLIC_SUPABASE_ANON_KEY=
  SUPABASE_SERVICE_ROLE_KEY=
  ANTHROPIC_API_KEY=
  OPENAI_API_KEY=
  AIRTABLE_API_KEY=
  AIRTABLE_BASE_ID=
  ```

- [ ] **1.4** Configure Clerk middleware (`middleware.ts`) protecting `/dashboard` routes

- [ ] **1.5** Set up Supabase client helpers:
  - `lib/supabase/client.ts` — browser client
  - `lib/supabase/server.ts` — server client using Clerk JWT
  - `lib/supabase/admin.ts` — service role client (for edge functions only)

- [ ] **1.6** Run database schema migration (paste schema from above into Supabase SQL editor)

- [ ] **1.7** Enable pgvector extension in Supabase dashboard (Database → Extensions → vector)

- [ ] **1.8** Create an index on the embedding column for fast similarity search:
  ```sql
  CREATE INDEX ON quotes USING ivfflat (embedding vector_cosine_ops) WITH (lists = 100);
  ```

- [ ] **1.9** Seed the tenants table with Helions Forge entry:
  ```sql
  INSERT INTO tenants (name, clerk_org_id) VALUES ('Helions Forge', 'YOUR_CLERK_ORG_ID');
  ```

- [ ] **1.10** Basic folder structure:
  ```
  /app
    /(auth)
      /sign-in
      /sign-up
    /(dashboard)
      /layout.tsx        ← Clerk org check
      /page.tsx          ← Dashboard home
      /enquiries/
      /quotes/
      /materials/
      /upload/
    /api/
      /quote/route.ts
      /embed/route.ts
      /sanitise/route.ts
  /components
    /ui/                 ← shadcn components
    /quoting/
    /layout/
  /lib
    /supabase/
    /ai/
      /prompts.ts
      /rag.ts
      /sanitise.ts
  ```

**Test checkpoint:** Can log in with Clerk, see a blank dashboard, and Supabase tables exist.

---

## Phase 2 — Data Upload & Sanitisation Pipeline

**Goal:** Upload old quotes/emails, strip PII, store cleaned data with embeddings ready for RAG search.

### Tasks

- [ ] **2.1** Build `/dashboard/upload` page with:
  - Paste text area (for email copy-paste)
  - PDF/text file upload (Supabase Storage)
  - Submit button

- [ ] **2.2** Create the Sanitiser prompt in `lib/ai/prompts.ts`:
  ```typescript
  export const SANITISER_PROMPT = `
  You are a data cleaning assistant for a metalwork quoting system.
  
  Given raw email or quote text, extract and return ONLY a JSON object with:
  - product_type: string (e.g. "Balustrade", "Staircase", "Gate", "Railing")
  - material: string (e.g. "316 Stainless Steel", "Mild Steel Powder Coated")
  - description: string (clean job description, no personal details)
  - dimensions: object with any relevant measurements found (length_m, height_m, width_m, qty, etc.)
  - price_low: number or null (lowest price mentioned in GBP)
  - price_high: number or null (highest price mentioned in GBP)
  - final_price: number or null (agreed/invoiced price if mentioned)
  - status: "won" | "lost" | "unknown"
  
  CRITICAL RULES:
  - Remove ALL names, phone numbers, email addresses, postcodes, and street addresses
  - Replace with placeholders: [CUSTOMER], [SITE_ADDRESS], [PHONE], [EMAIL]
  - Keep all technical specs, dimensions, materials, and prices
  - Return ONLY valid JSON, no explanation text
  `;
  ```

- [ ] **2.3** Create `/api/sanitise/route.ts` — POST endpoint that:
  - Accepts `{ raw_text: string, tenant_id: string }`
  - Calls Claude Haiku with SANITISER_PROMPT
  - Returns structured JSON

- [ ] **2.4** Create `/api/embed/route.ts` — POST endpoint that:
  - Accepts cleaned quote data
  - Generates embedding via OpenAI `text-embedding-3-small` on the description field
  - Inserts full record + embedding into `quotes` table

- [ ] **2.5** Wire upload form → sanitise API → embed API → success confirmation

- [ ] **2.6** Build `/dashboard/quotes` list page showing all stored quotes with:
  - Product type, material, price range, status badges
  - "Mark as Golden" toggle button
  - Basic search/filter by product type

- [ ] **2.7** Batch upload tool — allow CSV upload with columns:
  `raw_text` (one row per quote/email). Processes each row through sanitise → embed pipeline.

**Test checkpoint:** Upload 10 sample old quotes, verify they appear cleaned and structured in the quotes table with embeddings stored.

---

## Phase 3 — RAG Quoting Engine (Core AI Feature)

**Goal:** New enquiry comes in → AI finds similar historical quotes → generates price range estimate.

### Tasks

- [ ] **3.1** Create the RAG search function in `lib/ai/rag.ts`:
  ```typescript
  // Takes new enquiry text, returns top 3 similar historical quotes for this tenant
  export async function findSimilarQuotes(
    enquiryText: string,
    tenantId: string,
    limit = 3
  ): Promise<Quote[]>
  // 1. Generate embedding for enquiryText
  // 2. Run Supabase vector similarity search filtered by tenant_id
  // 3. Prioritise is_golden = true results
  // 4. Return top N matches with similarity scores
  ```

  Supabase RPC for vector search:
  ```sql
  CREATE OR REPLACE FUNCTION match_quotes(
    query_embedding vector(1536),
    match_tenant_id UUID,
    match_count INT DEFAULT 3
  )
  RETURNS TABLE (
    id UUID, product_type TEXT, material TEXT, description TEXT,
    price_low DECIMAL, price_high DECIMAL, final_price DECIMAL,
    similarity FLOAT
  )
  LANGUAGE plpgsql AS $$
  BEGIN
    RETURN QUERY
    SELECT q.id, q.product_type, q.material, q.description,
           q.price_low, q.price_high, q.final_price,
           1 - (q.embedding <=> query_embedding) AS similarity
    FROM quotes q
    WHERE q.tenant_id = match_tenant_id
    ORDER BY q.embedding <=> query_embedding
    LIMIT match_count;
  END;
  $$;
  ```

- [ ] **3.2** Create the Quoting prompt in `lib/ai/prompts.ts`:
  ```typescript
  export const QUOTE_GENERATOR_PROMPT = `
  You are an expert estimator for Helions Forge, a bespoke metalwork manufacturer.
  
  You will be given:
  1. A new customer enquiry (text and/or extracted specs from a photo)
  2. Up to 3 similar historical jobs we have completed, with their prices
  
  Your job is to produce a ballpark estimate range.
  
  RULES:
  - ALWAYS return a low and high price range, never a single fixed price
  - Factor in: complexity, material type, linear metres, quantity, finishing
  - If historical data is thin or specs are unclear, widen the range and lower confidence
  - Confidence levels: "high" (clear specs + strong match), "medium" (partial match), "low" (guessing)
  - Note any missing information that would sharpen the estimate
  - Keep response concise and professional
  
  Return JSON:
  {
    "price_low": number,
    "price_high": number,
    "confidence": "low" | "medium" | "high",
    "reasoning": "string (2-3 sentences explaining the estimate)",
    "missing_info": ["list of clarifying questions if needed"],
    "product_type": "string",
    "material": "string"
  }
  `;
  ```

- [ ] **3.3** Create `/api/quote/route.ts` — main quoting endpoint:
  - Accepts `{ enquiry_text: string, image_urls?: string[], tenant_id: string }`
  - Runs `findSimilarQuotes()` to get top 3 matches
  - If image_urls present, first calls Claude Sonnet vision to extract specs from photo
  - Calls Claude Sonnet with QUOTE_GENERATOR_PROMPT + similar quotes context
  - Saves to `generated_quotes` table
  - Returns full quote response

- [ ] **3.4** Build `/dashboard/enquiries/new` page:
  - Text area for job description
  - Photo upload (stores to Supabase Storage, returns URL)
  - Submit → calls `/api/quote`
  - Shows loading state during processing

- [ ] **3.5** Build Quote Result component showing:
  - Price range (large, prominent)
  - Confidence badge (colour coded: green/amber/red)
  - AI reasoning paragraph
  - "Similar Jobs Used" section showing the 3 matched historical quotes
  - Missing info / clarifying questions list
  - **Approve & Send** button | **Edit Price** button

- [ ] **3.6** Human review flow:
  - "Edit Price" opens modal to set final_price
  - "Approve" marks status = 'approved' and saves final_price
  - On approval: auto-creates a new entry in `quotes` table using this job as future training data (the self-improvement loop)

- [ ] **3.7** Photo-to-quote vision extraction:
  ```typescript
  // Before calling main quote endpoint, extract specs from image
  export async function extractSpecsFromImage(imageUrl: string): Promise<string>
  // Prompt: "Describe the metalwork in this image. Note: product type, 
  // approximate dimensions, material type, finish, fixings visible, 
  // complexity level. Be specific about what you can see."
  ```

**Test checkpoint:** Submit a test enquiry (text + photo), verify AI returns a sensible price range with similar quotes shown, approve it and verify it saves back to quotes table.

---

## Phase 4 — Dashboard Polish & Materials Management

**Goal:** Full usable internal tool for Helions Forge daily use.

### Tasks

- [ ] **4.1** Dashboard home (`/dashboard`) showing:
  - Stats: Total quotes this month, Win rate, Average quote value
  - Recent enquiries list (last 10)
  - Quick "New Enquiry" button

- [ ] **4.2** `/dashboard/materials` page:
  - Table of all materials with current rate per unit
  - Add / Edit / Delete material rows
  - "Last updated" timestamp
  - Note: these rates feed into the quoting context so AI is aware of current prices

- [ ] **4.3** Airtable → Supabase nightly sync:
  - Supabase Edge Function (`functions/sync-materials/index.ts`)
  - Fetches Airtable base via REST API
  - Upserts into `materials` table by `tenant_id`
  - Triggered by pg_cron or Supabase scheduled function (daily at midnight)

- [ ] **4.4** Include live material rates in quoting prompt:
  - Before generating quote, fetch current materials from DB
  - Inject into QUOTE_GENERATOR_PROMPT as "Current Material Rates" section

- [ ] **4.5** `/dashboard/quotes` full management page:
  - Filter by status, product type, date range
  - Mark as Golden
  - Tag lost reasons (price_too_high, lost_to_competitor, project_cancelled)
  - Export to CSV

- [ ] **4.6** Quote history for each enquiry (side panel showing all version edits)

- [ ] **4.7** Basic email notification (via Resend) when a quote is approved:
  - Sends summary to team member email
  - Not customer-facing yet

**Test checkpoint:** Full end-to-end flow works cleanly. Materials update and next quote reflects new rates.

---

## Phase 5 — Website Chatbot Widget

**Goal:** Customer-facing AI quote assistant embeddable on the Helions Forge website.

### Tasks

- [ ] **5.1** Create `/api/chat/route.ts` — streaming chat endpoint:
  - Uses Vercel AI SDK `streamText`
  - System prompt is a "safe public" version — gives ranges only, no cost breakdowns
  - Has access to same RAG search but filtered to golden quotes only
  - Hard limit: never quote below £X minimum (configurable per tenant)

- [ ] **5.2** Chatbot conversation flow (system prompt stages):
  ```
  Stage 1: Greet + ask product type
  Stage 2: Ask internal/external, dimensions
  Stage 3: Ask material preference / budget range
  Stage 4: Ask for photo (optional)
  Stage 5: Generate and present range estimate
  Stage 6: Offer to "send to our team for a formal quote" → capture email
  ```

- [ ] **5.3** Build embeddable chat widget (`/widget/[tenantId]`):
  - Minimal React component, iframe-embeddable
  - Mobile-friendly floating button
  - Collects: job description, photo upload, contact email at end
  - Saves full conversation to `enquiries` table with `source: 'chatbot'`

- [ ] **5.4** Human handoff trigger:
  - If user mentions keywords: "structural", "large scale", "50 metres+", "commercial"
  - Bot responds: "This sounds like a specialist project — I've flagged this for our team to call you directly."
  - Creates high-priority enquiry in dashboard

- [ ] **5.5** Dashboard notification for new chatbot leads:
  - Supabase Realtime subscription on `enquiries` table
  - Toast notification in dashboard when new chatbot enquiry arrives

- [ ] **5.6** Market fluctuation buffer:
  - Config value per tenant: `price_buffer_percent` (default: 10%)
  - All chatbot-generated ranges are automatically padded by this %
  - Disclaimer shown: "Estimates may vary subject to current material costs"

**Test checkpoint:** Embed widget on a test page, complete a full conversation, verify lead appears in dashboard with specs extracted.

---

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
