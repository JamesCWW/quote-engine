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
    business_name,
    address,
    phone,
    email,
    website,
    vat_number,
    logo_url,
    terms_and_conditions,
    estimate_footer_text,
  } = body;

  const supabase = createAdminClient();

  const { error } = await supabase
    .from('tenant_profile')
    .upsert(
      {
        tenant_id: tenantId,
        business_name,
        address,
        phone,
        email,
        website,
        vat_number,
        logo_url,
        terms_and_conditions,
        estimate_footer_text,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'tenant_id' }
    );

  if (error) {
    console.error('[settings/profile]', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
