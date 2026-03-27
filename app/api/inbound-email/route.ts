import { Webhook } from 'svix';
import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';

interface ResendInboundPayload {
  type: string;
  data: {
    from: string;
    to: string[];
    subject: string;
    html?: string;
    text?: string;
    attachments?: unknown[];
  };
}

export async function POST(req: NextRequest) {
  const secret = process.env.RESEND_WEBHOOK_SECRET;
  if (!secret) {
    console.error('RESEND_WEBHOOK_SECRET is not set');
    return NextResponse.json({ error: 'Webhook secret not configured' }, { status: 500 });
  }

  // Read raw body for signature verification
  const rawBody = await req.text();

  const svixId = req.headers.get('svix-id') ?? '';
  const svixTimestamp = req.headers.get('svix-timestamp') ?? '';
  const svixSignature = req.headers.get('svix-signature') ?? '';

  const wh = new Webhook(secret);
  let payload: ResendInboundPayload;

  try {
    payload = wh.verify(rawBody, {
      'svix-id': svixId,
      'svix-timestamp': svixTimestamp,
      'svix-signature': svixSignature,
    }) as ResendInboundPayload;
  } catch {
    return NextResponse.json({ error: 'Invalid webhook signature' }, { status: 401 });
  }

  if (payload.type !== 'email.received') {
    return NextResponse.json({ ok: true });
  }

  const { from, to, subject, html, text } = payload.data;

  // Combine subject + body into a single text block
  const plainBody = text ?? html?.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim() ?? '';
  const rawInput = `Subject: ${subject}\n\nFrom: ${from}\n\n${plainBody}`.slice(0, 4000);

  const supabase = createAdminClient();
  const recipientEmail = to[0];

  // 1. Try to match by inbound_email address
  let { data: tenant } = await supabase
    .from('tenants')
    .select('id')
    .eq('inbound_email', recipientEmail)
    .single();

  if (tenant) {
    console.log(`[inbound-email] Matched tenant ${tenant.id} by inbound_email: ${recipientEmail}`);
  } else {
    // 2. Fall back to first tenant (single-tenant / testing mode)
    const { data: firstTenant } = await supabase
      .from('tenants')
      .select('id')
      .order('created_at', { ascending: true })
      .limit(1)
      .single();

    if (!firstTenant) {
      console.warn('[inbound-email] No tenants found in database');
      return NextResponse.json({ ok: true });
    }

    console.log(`[inbound-email] No inbound_email match for ${recipientEmail} — falling back to default tenant ${firstTenant.id}`);
    tenant = firstTenant;
  }

  const tenantId = tenant.id;
  const baseUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000';

  // Sanitise via /api/sanitise
  const sanitiseRes = await fetch(`${baseUrl}/api/sanitise`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ raw_text: rawInput, tenant_id: tenantId }),
  });

  if (!sanitiseRes.ok) {
    console.error('Sanitise failed:', await sanitiseRes.text());
    return NextResponse.json({ error: 'Sanitise step failed' }, { status: 500 });
  }

  const { data: sanitised } = await sanitiseRes.json();
  const description: string = sanitised?.description ?? rawInput;

  // Embed via /api/embed
  const embedRes = await fetch(`${baseUrl}/api/embed`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      tenant_id: tenantId,
      raw_text: rawInput,
      description,
      product_type: sanitised?.product_type ?? null,
      material: sanitised?.material ?? null,
      dimensions: sanitised?.dimensions ?? null,
      price_low: null,
      price_high: null,
      final_price: null,
      status: 'unknown',
    }),
  });

  if (!embedRes.ok) {
    console.error('Embed failed:', await embedRes.text());
    return NextResponse.json({ error: 'Embed step failed' }, { status: 500 });
  }

  // Save to enquiries table
  const { error: enquiryError } = await supabase
    .from('enquiries')
    .insert({
      tenant_id: tenantId,
      source: 'email',
      raw_input: rawInput,
      image_urls: [],
      extracted_specs: {
        from,
        subject,
        ...(sanitised ?? {}),
      },
      status: 'new',
    });

  if (enquiryError) {
    console.error('Enquiry insert error:', enquiryError);
    return NextResponse.json({ error: 'Failed to save enquiry' }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
