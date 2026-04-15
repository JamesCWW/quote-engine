import { Webhook } from 'svix';
import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { sanitiseText } from '@/lib/ai/sanitise';
import { storeQuoteWithEmbedding } from '@/lib/ai/rag';

interface ResendInboundPayload {
  type: string;
  data: {
    email_id: string;
    from: string;
    to: string[];
    subject: string;
    date?: string;
  };
}

interface ResendEmailResponse {
  id: string;
  from: string;
  to: string[];
  subject: string;
  text?: string;
  html?: string;
  created_at: string;
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

  console.log('Raw Resend body:', rawBody);

  try {
    payload = wh.verify(rawBody, {
      'svix-id': svixId,
      'svix-timestamp': svixTimestamp,
      'svix-signature': svixSignature,
    }) as ResendInboundPayload;
  } catch {
    return NextResponse.json({ error: 'Invalid webhook signature' }, { status: 401 });
  }

  console.log('Full Resend payload:', JSON.stringify(payload, null, 2));

  if (payload.type !== 'email.received') {
    return NextResponse.json({ ok: true });
  }

  const { email_id, from, to, subject, date } = payload.data;

  // Fetch full email content from Resend API using the email_id
  const resendApiKey = process.env.RESEND_API_KEY;
  if (!resendApiKey) {
    console.error('[inbound-email] RESEND_API_KEY is not set');
    return NextResponse.json({ error: 'Resend API key not configured' }, { status: 500 });
  }

  let emailData: ResendEmailResponse;
  try {
    const resendRes = await fetch(`https://api.resend.com/emails/${email_id}`, {
      headers: { Authorization: `Bearer ${resendApiKey}` },
    });
    if (!resendRes.ok) {
      throw new Error(`Resend API returned ${resendRes.status}`);
    }
    emailData = await resendRes.json();
    console.log('Resend email fetch response:', JSON.stringify(emailData, null, 2));
  } catch (err) {
    console.error('[inbound-email] Failed to fetch email from Resend:', err);
    return NextResponse.json({ error: 'Failed to fetch email content' }, { status: 500 });
  }

  // Extract body text: prefer plain text, fall back to stripped HTML, then sentinel
  let plainBody: string;
  if (emailData.text && emailData.text.trim()) {
    plainBody = emailData.text.trim();
  } else if (emailData.html && emailData.html.trim()) {
    plainBody = emailData.html.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
  } else {
    plainBody = 'No email body found';
  }

  const emailDate = date ?? emailData.created_at ?? new Date().toISOString();
  const rawInput = `Subject: ${subject}\nFrom: ${from}\nDate: ${emailDate}\n\n${plainBody}`.slice(0, 4000);

  const supabase = createAdminClient();
  const recipientEmail = to[0];

  // 1. Try to match by inbound_email address
  const { data: tenant } = await supabase
    .from('tenants')
    .select('id')
    .eq('inbound_email', recipientEmail)
    .single();

  if (tenant) {
    console.log(`[inbound-email] Matched tenant ${tenant.id} by inbound_email: ${recipientEmail}`);
  } else {
    console.warn(`[inbound-email] No tenant matched inbound_email: ${recipientEmail} — discarding email`);
    return NextResponse.json({ ok: true });
  }

  const tenantId = tenant.id;

  // Sanitise
  let sanitised;
  try {
    sanitised = await sanitiseText(rawInput);
  } catch (err) {
    console.error('[inbound-email] Sanitise failed:', err);
    return NextResponse.json({ error: 'Sanitise step failed' }, { status: 500 });
  }

  // Embed and store to quotes table for future RAG retrieval
  try {
    await storeQuoteWithEmbedding(tenantId, rawInput, sanitised);
  } catch (err) {
    console.error('[inbound-email] Embed/store failed:', err);
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
        ...sanitised,
      },
      status: 'new',
    });

  if (enquiryError) {
    console.error('Enquiry insert error:', enquiryError);
    return NextResponse.json({ error: 'Failed to save enquiry' }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
