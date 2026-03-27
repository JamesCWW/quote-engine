import * as fs from 'fs';
import * as path from 'path';
import { parse } from 'csv-parse/sync';
import { createAdminClient } from '../lib/supabase/admin';

require('dotenv').config({ path: path.join(__dirname, '..', '.env.local') });

const ROOT = path.join(__dirname, '..');

function readCsv(filename: string): Record<string, string>[] {
  const content = fs.readFileSync(path.join(ROOT, filename), 'utf-8');
  return parse(content, { columns: true, skip_empty_lines: true, trim: true });
}

function num(val: string): number | null {
  if (!val || val.trim() === '') return null;
  const n = parseFloat(val.replace(/,/g, ''));
  return isNaN(n) ? null : n;
}

function int(val: string): number | null {
  if (!val || val.trim() === '') return null;
  const n = parseInt(val.replace(/,/g, ''), 10);
  return isNaN(n) ? null : n;
}

async function main() {
  const supabase = createAdminClient();

  // Look up Helions Forge tenant_id
  const { data: tenant, error: tenantError } = await supabase
    .from('tenants')
    .select('id')
    .eq('name', 'Helions Forge')
    .single();

  if (tenantError || !tenant) {
    console.error('Could not find Helions Forge tenant:', tenantError?.message);
    process.exit(1);
  }

  const tenantId = tenant.id;
  console.log(`Using tenant_id: ${tenantId}`);

  // ── 1. Aluminium Driveway Gates → product_pricing ──────────────────────────
  {
    const rows = readCsv('Aluminium Driveway Gates - Sheet1.csv');
    const records = rows.map((r) => ({
      tenant_id: tenantId,
      category: 'aluminium_driveway_gates',
      design_name: r.design_name,
      width_mm: int(r.width_mm),
      height_mm: int(r.height_mm),
      price_gbp: num(r.price_gbp),
      helions_sku: r.helions_sku || null,
      supplier_sku: r.supplier_sku || null,
      supplier_price: num(r.supplier_price),
      photo_url: r.photo_url || null,
    }));
    const { error } = await supabase.from('product_pricing').insert(records);
    if (error) throw new Error(`aluminium_driveway_gates: ${error.message}`);
    console.log(`✓ aluminium_driveway_gates: ${records.length} rows inserted`);
  }

  // ── 2. Aluminium Pedestrian Gates → product_pricing ────────────────────────
  {
    const rows = readCsv('Aluminium Pedestrian Gates - Sheet1.csv');
    const records = rows.map((r) => ({
      tenant_id: tenantId,
      category: 'aluminium_pedestrian_gates',
      design_name: r.design_name,
      width_mm: int(r.width_mm),
      height_mm: int(r.height_mm),
      price_gbp: num(r.price_gbp),
      helions_sku: r.helions_sku || null,
      supplier_sku: r.supplier_sku || null,
      supplier_price: num(r.supplier_price),
      photo_url: r.photo_url || null,
    }));
    const { error } = await supabase.from('product_pricing').insert(records);
    if (error) throw new Error(`aluminium_pedestrian_gates: ${error.message}`);
    console.log(`✓ aluminium_pedestrian_gates: ${records.length} rows inserted`);
  }

  // ── 3. Iron Driveway Gates → product_pricing ───────────────────────────────
  {
    const rows = readCsv('Iron Driveway Gates - Sheet1.csv');
    const records = rows.map((r) => ({
      tenant_id: tenantId,
      category: 'iron_driveway_gates',
      design_name: r.design_name,
      width_mm: int(r.width_mm),
      height_mm: int(r.height_mm),
      price_gbp: num(r.price_gbp),
      helions_sku: r.helions_sku || null,
      supplier_sku: null,
      supplier_price: null,
      photo_url: r.photo_url || null,
    }));
    const { error } = await supabase.from('product_pricing').insert(records);
    if (error) throw new Error(`iron_driveway_gates: ${error.message}`);
    console.log(`✓ iron_driveway_gates: ${records.length} rows inserted`);
  }

  // ── 4. Aluminium Gate Accessories → accessories_pricing ────────────────────
  {
    const rows = readCsv('Aluminium Gate Accessories - Sheet1.csv');
    const records = rows.map((r) => ({
      tenant_id: tenantId,
      category: 'aluminium_accessories',
      item_name: r.item_name,
      supplier_name: r.supplier_name || null,
      supplier_price: num(r.supplier_price),
      helions_price: num(r.helions_price),
    }));
    const { error } = await supabase.from('accessories_pricing').insert(records);
    if (error) throw new Error(`aluminium_accessories: ${error.message}`);
    console.log(`✓ aluminium_accessories: ${records.length} rows inserted`);
  }

  // ── 5. Iron Gates Accessories → accessories_pricing ────────────────────────
  {
    const rows = readCsv('Iron Gates Accessories - Sheet1.csv');
    const records = rows.map((r) => ({
      tenant_id: tenantId,
      category: 'iron_accessories',
      item_name: r.item_name,
      supplier_name: r.supplier_name || null,
      supplier_price: num(r.supplier_price),
      helions_price: num(r.helions_price),
    }));
    const { error } = await supabase.from('accessories_pricing').insert(records);
    if (error) throw new Error(`iron_accessories: ${error.message}`);
    console.log(`✓ iron_accessories: ${records.length} rows inserted`);
  }

  // ── 6. Automation Equipment → accessories_pricing ──────────────────────────
  {
    const rows = readCsv('Automation Equipment - Sheet1.csv');
    const records = rows.map((r) => ({
      tenant_id: tenantId,
      category: 'automation',
      item_name: r.item_name,
      supplier_name: r.supplier_name || null,
      supplier_price: num(r.supplier_price),
      helions_price: num(r.helions_price),
    }));
    const { error } = await supabase.from('accessories_pricing').insert(records);
    if (error) throw new Error(`automation: ${error.message}`);
    console.log(`✓ automation: ${records.length} rows inserted`);
  }

  // ── 7. Mild Steel Prices → materials_pricing ───────────────────────────────
  {
    const rows = readCsv('Mild Steel Prices - Sheet1.csv');
    const records = rows.map((r) => ({
      tenant_id: tenantId,
      material: r.material.trim(),
      kg_per_unit: num(r.kg_per_unit),
      unit_cost_gbp: num(r.unit_cost_gbp),
    }));
    const { error } = await supabase.from('materials_pricing').insert(records);
    if (error) throw new Error(`materials_pricing: ${error.message}`);
    console.log(`✓ materials_pricing: ${records.length} rows inserted`);
  }

  // ── 8. Master File → master_rates + job_types ──────────────────────────────
  {
    // master_rates: upsert single row (delete existing first to avoid duplicates)
    await supabase.from('master_rates').delete().eq('tenant_id', tenantId);
    const { error: mrError } = await supabase.from('master_rates').insert({
      tenant_id: tenantId,
      fabrication_day_rate: 507.00,
      installation_day_rate: 523.84,
      consumer_unit_connection: 435.00,
    });
    if (mrError) throw new Error(`master_rates: ${mrError.message}`);
    console.log(`✓ master_rates: 1 row inserted`);

    // job_types: parse from CSV, skip header rows that aren't job types
    const rows = readCsv('Master File - Sheet1.csv');
    // Rows where column "item" looks like a job type (has manufacture_days or install_days or minimum_value)
    const jobRows = rows.filter((r) => {
      const isRateRow = ['manufacturer day rate', 'installer day rate', 'galvanising cost', 'powder coating', 'customer requires'].some(
        (kw) => r.item?.toLowerCase().includes(kw)
      );
      return !isRateRow && r.item?.trim();
    });

    // Delete existing job_types for this tenant
    await supabase.from('job_types').delete().eq('tenant_id', tenantId);

    const jobRecords = jobRows.map((r) => ({
      tenant_id: tenantId,
      job_type: r.item.trim(),
      minimum_value: num(r.minimum_value),
      manufacture_days: num(r.manufacture_days),
      install_days: num(r.install_days),
      engineers_required: int(r.engineer),
    }));

    const { error: jtError } = await supabase.from('job_types').insert(jobRecords);
    if (jtError) throw new Error(`job_types: ${jtError.message}`);
    console.log(`✓ job_types: ${jobRecords.length} rows inserted`);
  }

  console.log('\nAll pricing data seeded successfully.');
}

main().catch((err) => {
  console.error('\nSeed failed:', err.message);
  process.exit(1);
});
