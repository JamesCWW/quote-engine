import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@clerk/nextjs/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { getTenantId } from '@/lib/tenant';

export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });

  const tenantId = await getTenantId();
  if (!tenantId) return NextResponse.json({ error: 'Tenant not found' }, { status: 404 });

  const { id } = params;
  const body = await req.json();
  // Allow patching status and/or lost_reason
  const { status, lost_reason } = body as { status?: string; lost_reason?: string | null };

  const updates: Record<string, unknown> = {};
  if (status !== undefined) updates.status = status;
  if (lost_reason !== undefined) updates.lost_reason = lost_reason;

  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ error: 'No fields to update' }, { status: 400 });
  }

  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from('quotes')
    .update(updates)
    .eq('id', id)
    .eq('tenant_id', tenantId)
    .select('id, status, lost_reason')
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!data) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  return NextResponse.json(data);
}
