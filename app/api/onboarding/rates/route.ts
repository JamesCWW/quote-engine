import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@clerk/nextjs/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { getTenantId } from '@/lib/tenant';

export async function POST(req: NextRequest) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });

  const tenantId = await getTenantId();
  if (!tenantId) return NextResponse.json({ error: 'Tenant not found' }, { status: 400 });

  const body = await req.json();
  const {
    fabrication_day_rate,
    installation_day_rate,
    minimum_job_value,
  } = body;

  const supabase = createAdminClient();

  const { error } = await supabase
    .from('master_rates')
    .upsert(
      {
        tenant_id: tenantId,
        fabrication_day_rate: Number(fabrication_day_rate),
        installation_day_rate: Number(installation_day_rate),
        minimum_job_value: Number(minimum_job_value),
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'tenant_id' }
    );

  if (error) {
    console.error('[onboarding/rates]', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
