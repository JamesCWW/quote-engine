-- Phase 6: Pricing Tables
-- Run this in the Supabase SQL editor

-- ── Create Tables ──────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS master_rates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID REFERENCES tenants(id),
  fabrication_day_rate DECIMAL(10,2) DEFAULT 507.00,
  installation_day_rate DECIMAL(10,2) DEFAULT 523.84,
  galvanising_rate TEXT DEFAULT 'total_kg*1.2',
  powder_coating_rate TEXT DEFAULT 'width*height*65',
  consumer_unit_connection DECIMAL(10,2) DEFAULT 435.00,
  minimum_job_value DECIMAL(10,2) DEFAULT 500.00,
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS product_pricing (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID REFERENCES tenants(id),
  category TEXT NOT NULL,
  design_name TEXT,
  width_mm INT,
  height_mm INT,
  price_gbp DECIMAL(10,2),
  helions_sku TEXT,
  supplier_sku TEXT,
  supplier_price DECIMAL(10,2),
  photo_url TEXT,
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS accessories_pricing (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID REFERENCES tenants(id),
  category TEXT NOT NULL,
  item_name TEXT NOT NULL,
  supplier_name TEXT,
  supplier_price DECIMAL(10,2),
  helions_price DECIMAL(10,2),
  notes TEXT,
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS materials_pricing (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID REFERENCES tenants(id),
  material TEXT NOT NULL,
  kg_per_unit DECIMAL(10,3),
  unit_cost_gbp DECIMAL(10,2),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS job_types (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID REFERENCES tenants(id),
  job_type TEXT NOT NULL,
  minimum_value DECIMAL(10,2),
  manufacture_days DECIMAL(4,1),
  install_days DECIMAL(4,1),
  engineers_required INT,
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- ── Indexes ────────────────────────────────────────────────────────────────

CREATE INDEX IF NOT EXISTS product_pricing_tenant_category_idx ON product_pricing (tenant_id, category);
CREATE INDEX IF NOT EXISTS accessories_pricing_tenant_category_idx ON accessories_pricing (tenant_id, category);
CREATE INDEX IF NOT EXISTS job_types_tenant_idx ON job_types (tenant_id);

-- ── Seed Data — Helions Forge tenant ──────────────────────────────────────
-- Uses a subquery to look up the Helions Forge tenant ID by name.

DO $$
DECLARE
  helions_id UUID;
BEGIN
  SELECT id INTO helions_id FROM tenants WHERE name = 'Helions Forge' LIMIT 1;
  IF helions_id IS NULL THEN
    RAISE EXCEPTION 'Helions Forge tenant not found. Create the tenant first.';
  END IF;

  -- ── master_rates ──────────────────────────────────────────────────────
  INSERT INTO master_rates (
    tenant_id, fabrication_day_rate, installation_day_rate,
    galvanising_rate, powder_coating_rate, consumer_unit_connection, minimum_job_value
  )
  VALUES (
    helions_id, 507.00, 523.84,
    'total_kg*1.2', 'width*height*65', 435.00, 500.00
  )
  ON CONFLICT DO NOTHING;

  -- ── job_types ─────────────────────────────────────────────────────────
  INSERT INTO job_types (tenant_id, job_type, minimum_value, manufacture_days, install_days, engineers_required) VALUES
    (helions_id, 'Automated Double Iron Driveway Gates',  10500.00, 4.0, 4.0, 2),
    (helions_id, 'Manual Double Iron Driveway Gates',     NULL,     2.0, 2.0, 2),
    (helions_id, 'Aluminium Pedestrian Gates Brick to Brick', NULL, NULL, 1.0, 1),
    (helions_id, 'Aluminium Pedestrian Gates Concrete Posts', NULL, NULL, 2.0, 1),
    (helions_id, 'Aluminium Driveway Gates Manual Brick to Brick', NULL, NULL, 1.0, 2),
    (helions_id, 'Aluminium Driveway Gates Manual Concrete Posts', NULL, NULL, 2.0, 2),
    (helions_id, 'Aluminium Driveway Gates Electric',     NULL,     NULL, 4.0, 2),
    (helions_id, 'Sliding Electric Aluminium Gates',      NULL,     NULL, 5.0, 2),
    (helions_id, 'Sliding Manual Aluminium Gates',        NULL,     NULL, 3.0, 2),
    (helions_id, 'Sliding Iron Driveway Gates Electric',  NULL,     NULL, 5.0, 2),
    (helions_id, 'Sliding Iron Driveway Gates Manual',    NULL,     NULL, 4.0, 2),
    (helions_id, 'Railings with Posts up to 10 Meters',  NULL,     NULL, 2.0, 2),
    (helions_id, 'Railings with Posts 11-20 Meters',     NULL,     NULL, 4.0, 2),
    (helions_id, 'Wall Top Railings up to 10 Meters',    NULL,     NULL, 1.0, 2),
    (helions_id, 'Small Handrails for Steps',            NULL,     NULL, 1.0, 2),
    (helions_id, 'Juliette Balcony Railings up to 5 Meters', NULL, NULL, 2.0, 2),
    (helions_id, 'Juliette and Terrace Balconies 6-10 Meters', NULL, NULL, 3.0, 2),
    (helions_id, 'Railings per 2 Meters',               NULL,     1.0, NULL, NULL),
    (helions_id, 'Handrails per 2 Meters',              NULL,     1.0, NULL, NULL)
  ON CONFLICT DO NOTHING;

END $$;

-- ── CSV-sourced seed data ──────────────────────────────────────────────────
-- Run the following INSERT blocks after populating from your CSV files.
-- Replace (SELECT id FROM tenants WHERE name = 'Helions Forge') in each block.

-- ALUMINIUM DRIVEWAY GATES  →  product_pricing (category: 'aluminium_driveway_gates')
-- Example row — replace with CSV data:
-- INSERT INTO product_pricing (tenant_id, category, design_name, width_mm, height_mm, price_gbp, helions_sku, supplier_sku, supplier_price, photo_url)
-- SELECT id, 'aluminium_driveway_gates', 'Design Name', 3000, 1800, 1250.00, 'HF-ADG-001', 'SUP-001', 950.00, 'https://...'
-- FROM tenants WHERE name = 'Helions Forge';

-- ALUMINIUM PEDESTRIAN GATES  →  product_pricing (category: 'aluminium_pedestrian_gates')
-- INSERT INTO product_pricing (tenant_id, category, design_name, width_mm, height_mm, price_gbp, helions_sku, supplier_sku, supplier_price, photo_url)
-- SELECT id, 'aluminium_pedestrian_gates', ...
-- FROM tenants WHERE name = 'Helions Forge';

-- IRON DRIVEWAY GATES  →  product_pricing (category: 'iron_driveway_gates')
-- INSERT INTO product_pricing (tenant_id, category, design_name, width_mm, height_mm, price_gbp, helions_sku, photo_url)
-- SELECT id, 'iron_driveway_gates', ...
-- FROM tenants WHERE name = 'Helions Forge';

-- ALUMINIUM ACCESSORIES  →  accessories_pricing (category: 'aluminium_accessories')
-- INSERT INTO accessories_pricing (tenant_id, category, item_name, supplier_name, supplier_price, helions_price)
-- SELECT id, 'aluminium_accessories', ...
-- FROM tenants WHERE name = 'Helions Forge';

-- IRON ACCESSORIES  →  accessories_pricing (category: 'iron_accessories')
-- INSERT INTO accessories_pricing (tenant_id, category, item_name, supplier_name, supplier_price, helions_price)
-- SELECT id, 'iron_accessories', ...
-- FROM tenants WHERE name = 'Helions Forge';

-- AUTOMATION  →  accessories_pricing (category: 'automation')
-- INSERT INTO accessories_pricing (tenant_id, category, item_name, supplier_name, supplier_price, helions_price)
-- SELECT id, 'automation', ...
-- FROM tenants WHERE name = 'Helions Forge';

-- MATERIALS  →  materials_pricing
-- INSERT INTO materials_pricing (tenant_id, material, kg_per_unit, unit_cost_gbp)
-- SELECT id, 'Mild Steel RHS 50x50x3', 4.25, 12.80
-- FROM tenants WHERE name = 'Helions Forge';

-- ── Correction: Automated Double Iron Driveway Gates install_days fix ──────
-- Run this if you already executed the seed block above.
UPDATE job_types
SET install_days = 4
WHERE job_type ILIKE '%automated%iron%driveway%';
