import { createAdminClient } from '@/lib/supabase/admin';
import { NextRequest, NextResponse } from 'next/server';

// Public endpoint — used by chatbot widget to save completed conversations as enquiries.
// No Clerk auth required. Tenant is identified by tenantId in the request body.
export async function POST(req: NextRequest) {
  const body = await req.json();
  const { tenantId, source, raw_input, image_urls, contact_name, contact_email } = body;

  if (!tenantId || !raw_input) {
    return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
  }

  const supabase = createAdminClient();

  // Verify tenant exists
  const { data: tenant } = await supabase
    .from('tenants')
    .select('id')
    .eq('id', tenantId)
    .single();

  if (!tenant) {
    return NextResponse.json({ error: 'Tenant not found' }, { status: 404 });
  }

  const extractedSpecs: Record<string, unknown> = {};
  if (contact_name) extractedSpecs.contact_name = contact_name;
  if (contact_email) extractedSpecs.contact_email = contact_email;

  const { data, error } = await supabase
    .from('enquiries')
    .insert({
      tenant_id: tenantId,
      source: source ?? 'chatbot',
      raw_input,
      image_urls: image_urls ?? [],
      extracted_specs: Object.keys(extractedSpecs).length ? extractedSpecs : null,
      status: 'new',
    })
    .select('id')
    .single();

  if (error) {
    console.error('Enquiry insert error:', error);
    return NextResponse.json({ error: 'Failed to save enquiry' }, { status: 500 });
  }

  return NextResponse.json({ id: data.id });
}
