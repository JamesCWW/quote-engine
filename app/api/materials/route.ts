import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@clerk/nextjs/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { getTenantId } from '@/lib/tenant';

export async function GET() {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });

  const tenantId = await getTenantId();
  if (!tenantId) return NextResponse.json({ error: 'Tenant not found' }, { status: 404 });

  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from('materials')
    .select('id, name, unit, rate_gbp, updated_at')
    .eq('tenant_id', tenantId)
    .order('name', { ascending: true });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json(data);
}

export async function POST(req: NextRequest) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });

  const tenantId = await getTenantId();
  if (!tenantId) return NextResponse.json({ error: 'Tenant not found' }, { status: 404 });

  const body = await req.json();
  const { name, unit, rate_gbp } = body as { name: string; unit: string; rate_gbp: number };

  if (!name || !unit || rate_gbp == null) {
    return NextResponse.json({ error: 'name, unit, and rate_gbp are required' }, { status: 400 });
  }

  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from('materials')
    .insert({ tenant_id: tenantId, name, unit, rate_gbp, updated_at: new Date().toISOString() })
    .select('id, name, unit, rate_gbp, updated_at')
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json(data, { status: 201 });
}
