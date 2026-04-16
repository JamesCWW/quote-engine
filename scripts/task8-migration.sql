-- Task 8 / Additional Features migration
-- Run this in Supabase SQL Editor

-- ============================================================
-- 1. tenant_profile table
-- ============================================================
CREATE TABLE IF NOT EXISTS tenant_profile (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE,
  business_name TEXT,
  address TEXT,
  phone TEXT,
  email TEXT,
  website TEXT,
  vat_number TEXT,
  logo_url TEXT,
  terms_and_conditions TEXT,
  estimate_footer_text TEXT DEFAULT 'This is a budgetary estimate based on information provided. Final price subject to site survey and full specification. Estimate valid for 30 days.',
  updated_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE tenant_profile ENABLE ROW LEVEL SECURITY;

CREATE POLICY "tenant_isolation" ON tenant_profile
  FOR ALL USING (tenant_id = (
    SELECT id FROM tenants
    WHERE clerk_org_id = (auth.jwt() ->> 'org_id')
  ));

CREATE POLICY "service_role_bypass" ON tenant_profile
  FOR ALL TO service_role USING (true);

-- ============================================================
-- 2. Seed Helions Forge profile
-- ============================================================
INSERT INTO tenant_profile
  (tenant_id, business_name, address, phone, email, website)
VALUES (
  '448fa53f-c64c-4375-815c-ce66664abead',
  'Helions Forge Ltd',
  'Unit 1, Park Dairy, Mill Rd, West Wratting, Cambridge, CB21 5LT',
  '01223 618253',
  'info@helionsforge.com',
  'https://helionsforge.com'
)
ON CONFLICT DO NOTHING;

-- ============================================================
-- 3. estimate-pdfs storage bucket
-- ============================================================
-- Run this in Supabase Dashboard → Storage → New bucket
-- Name: estimate-pdfs
-- Public: true
-- Or use the SQL below if your Supabase version supports it:
-- INSERT INTO storage.buckets (id, name, public)
-- VALUES ('estimate-pdfs', 'estimate-pdfs', true)
-- ON CONFLICT DO NOTHING;

-- ============================================================
-- 4. tenant-assets storage bucket (for logos)
-- ============================================================
-- Name: tenant-assets
-- Public: true
-- INSERT INTO storage.buckets (id, name, public)
-- VALUES ('tenant-assets', 'tenant-assets', true)
-- ON CONFLICT DO NOTHING;
