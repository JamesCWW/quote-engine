import { NextResponse } from 'next/server';
import { auth } from '@clerk/nextjs/server';
import { getTenantId } from '@/lib/tenant';
import { createAdminClient } from '@/lib/supabase/admin';

type ApplyRequest = {
  table: 'master_rates' | 'job_types';
  field: string;
  value: number;
  job_type?: string; // required when table === 'job_types'
};

const ALLOWED_MASTER_RATE_FIELDS = new Set([
  'fabrication_day_rate',
  'installation_day_rate',
  'consumer_unit_connection',
  'minimum_job_value',
]);

const ALLOWED_JOB_TYPE_FIELDS = new Set([
  'minimum_value',
  'manufacture_days',
  'install_days',
  'engineers_required',
]);

export async function POST(request: Request) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const tenant_id = await getTenantId();
  if (!tenant_id) return NextResponse.json({ error: 'Tenant not found' }, { status: 400 });

  const body = await request.json() as ApplyRequest;
  const { table, field, value, job_type } = body;

  // Validate table
  if (table !== 'master_rates' && table !== 'job_types') {
    return NextResponse.json({ error: 'Invalid table' }, { status: 400 });
  }

  // Validate field against allowlist (prevent arbitrary column writes)
  const allowedFields = table === 'master_rates' ? ALLOWED_MASTER_RATE_FIELDS : ALLOWED_JOB_TYPE_FIELDS;
  if (!allowedFields.has(field)) {
    return NextResponse.json(
      { error: `Field "${field}" is not adjustable via calibration` },
      { status: 400 }
    );
  }

  if (typeof value !== 'number' || value < 0) {
    return NextResponse.json({ error: 'value must be a non-negative number' }, { status: 400 });
  }

  const supabase = createAdminClient();

  if (table === 'master_rates') {
    const { error } = await supabase
      .from('master_rates')
      .update({ [field]: value })
      .eq('tenant_id', tenant_id);

    if (error) {
      console.error('[calibration/apply] master_rates update failed:', error);
      return NextResponse.json({ error: 'Update failed' }, { status: 500 });
    }

    return NextResponse.json({ ok: true, table, field, value });
  }

  // table === 'job_types'
  if (!job_type) {
    return NextResponse.json({ error: 'job_type is required for job_types updates' }, { status: 400 });
  }

  const { error } = await supabase
    .from('job_types')
    .update({ [field]: value })
    .eq('tenant_id', tenant_id)
    .ilike('job_type', `%${job_type}%`);

  if (error) {
    console.error('[calibration/apply] job_types update failed:', error);
    return NextResponse.json({ error: 'Update failed' }, { status: 500 });
  }

  return NextResponse.json({ ok: true, table, field, value, job_type });
}
