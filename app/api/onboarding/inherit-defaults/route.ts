import { NextResponse } from 'next/server';
import { auth } from '@clerk/nextjs/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { getTenantId } from '@/lib/tenant';

const HELIONS_FORGE_TENANT_ID = '448fa53f-c64c-4375-815c-ce66664abead';

export async function POST() {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });

  const tenantId = await getTenantId();
  if (!tenantId) return NextResponse.json({ error: 'Tenant not found' }, { status: 400 });

  // Prevent Helions Forge from copying into itself
  if (tenantId === HELIONS_FORGE_TENANT_ID) {
    return NextResponse.json({ ok: true, products: 0, accessories: 0, materials: 0 });
  }

  const supabase = createAdminClient();

  // Fetch all defaults from Helions Forge
  const [products, accessories, materials, rates, jobTypes] = await Promise.all([
    supabase.from('product_pricing').select('*').eq('tenant_id', HELIONS_FORGE_TENANT_ID),
    supabase.from('accessories_pricing').select('*').eq('tenant_id', HELIONS_FORGE_TENANT_ID),
    supabase.from('materials_pricing').select('*').eq('tenant_id', HELIONS_FORGE_TENANT_ID),
    supabase.from('master_rates').select('*').eq('tenant_id', HELIONS_FORGE_TENANT_ID).single(),
    supabase.from('job_types').select('*').eq('tenant_id', HELIONS_FORGE_TENANT_ID),
  ]);

  // Delete existing data for this tenant first (clean slate)
  await Promise.all([
    supabase.from('product_pricing').delete().eq('tenant_id', tenantId),
    supabase.from('accessories_pricing').delete().eq('tenant_id', tenantId),
    supabase.from('materials_pricing').delete().eq('tenant_id', tenantId),
    supabase.from('master_rates').delete().eq('tenant_id', tenantId),
    supabase.from('job_types').delete().eq('tenant_id', tenantId),
  ]);

  // Re-insert with new tenant_id
  const remap = (rows: Record<string, unknown>[]) =>
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    rows.map(({ id, tenant_id, ...rest }) => ({ ...rest, tenant_id: tenantId }));

  if (products.data?.length) {
    await supabase.from('product_pricing').insert(remap(products.data));
  }
  if (accessories.data?.length) {
    await supabase.from('accessories_pricing').insert(remap(accessories.data));
  }
  if (materials.data?.length) {
    await supabase.from('materials_pricing').insert(remap(materials.data));
  }
  if (rates.data) {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { id, tenant_id, ...rateRest } = rates.data as Record<string, unknown>;
    await supabase.from('master_rates').insert({ ...rateRest, tenant_id: tenantId });
  }
  if (jobTypes.data?.length) {
    await supabase.from('job_types').insert(remap(jobTypes.data));
  }

  return NextResponse.json({
    ok: true,
    products: products.data?.length ?? 0,
    accessories: accessories.data?.length ?? 0,
    materials: materials.data?.length ?? 0,
  });
}
