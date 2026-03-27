// Supabase Edge Function: process-email
// Receives Resend inbound email webhook, sanitises with Claude Haiku,
// generates embeddings, deduplicates, handles threading, and saves to enquiries table.
//
// Deploy: supabase functions deploy process-email
//
// Required env vars (set via `supabase secrets set`):
//   ANTHROPIC_API_KEY         — Claude API key
//   OPENAI_API_KEY            — OpenAI API key (for embeddings)
//   SUPABASE_URL              — Injected automatically by Supabase
//   SUPABASE_SERVICE_ROLE_KEY — Injected automatically by Supabase
//   TENANT_ID                 — Default tenant UUID (Helions Forge)
//
// Resend inbound webhook setup (task 7.1):
//   1. In Resend dashboard → Domains → your domain → Inbound
//   2. Set inbound address: quotes@helionsforge.com
//   3. Set webhook URL: https://<your-project>.supabase.co/functions/v1/process-email
//      (append ?tenantId=<UUID> for multi-tenant use, or rely on TENANT_ID env var)
//   4. Copy the webhook signing secret → set as RESEND_WEBHOOK_SECRET env var

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

// ─── Types ──────────────────────────────────────────────────────────────────

interface ResendHeader {
  name: string;
  value: string;
}

interface ResendAttachment {
  filename: string;
  content: string;       // base64-encoded
  mimeType?: string;     // Resend inbound uses mimeType
  content_type?: string; // some formats use content_type
}

// Resend inbound email payload (direct format — not wrapped in event envelope)
interface ResendEmailPayload {
  from: string;
  to: string | string[];
  subject?: string;
  text?: string;
  html?: string;
  headers?: ResendHeader[];
  attachments?: ResendAttachment[];
  // Resend event webhook wraps in data:
  data?: ResendEmailPayload;
  type?: string;
}

interface SanitisedQuote {
  product_type?: string;
  material?: string;
  description?: string;
  dimensions?: Record<string, number>;
  price_low?: number | null;
  price_high?: number | null;
  final_price?: number | null;
  status?: 'won' | 'lost' | 'unknown';
}

// ─── Sanitise with Claude Haiku ─────────────────────────────────────────────

const SANITISER_PROMPT = `
You are a data cleaning assistant for a metalwork quoting system.

Given raw email or quote text, extract and return ONLY a JSON object with:
- product_type: string (e.g. "Iron Railings", "Garden Gate", "Pedestrian Gate", "Driveway Gates", "Electric Gate Automation")
- material: string (e.g. "Wrought Iron", "Mild Steel Powder Coated", "Aluminium")
- description: string (clean job description, no personal details)
- dimensions: object with any relevant measurements found (length_m, height_m, width_m, qty, etc.)
- price_low: number or null (lowest price mentioned in GBP)
- price_high: number or null (highest price mentioned in GBP)
- final_price: number or null (agreed/invoiced price if mentioned)
- status: "won" | "lost" | "unknown"

CRITICAL RULES:
- Remove ALL names, phone numbers, email addresses, postcodes, and street addresses
- Replace with placeholders: [CUSTOMER], [SITE_ADDRESS], [PHONE], [EMAIL]
- Keep all technical specs, dimensions, materials, and prices
- Return ONLY valid JSON, no explanation text
`;

async function sanitiseText(rawText: string, apiKey: string): Promise<SanitisedQuote> {
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 1024,
      messages: [{
        role: 'user',
        content: `${SANITISER_PROMPT}\n\nRaw text to clean:\n${rawText.slice(0, 2000)}`,
      }],
    }),
  });

  if (!res.ok) {
    throw new Error(`Anthropic API error ${res.status}: ${await res.text()}`);
  }

  const data = await res.json();
  const text: string = data.content[0].text;
  const jsonText = text.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '').trim();
  return JSON.parse(jsonText) as SanitisedQuote;
}

// ─── OpenAI Embedding ────────────────────────────────────────────────────────

async function generateEmbedding(text: string, apiKey: string): Promise<number[]> {
  const res = await fetch('https://api.openai.com/v1/embeddings', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: 'text-embedding-3-small',
      input: text.slice(0, 2000),
    }),
  });

  if (!res.ok) {
    throw new Error(`OpenAI API error ${res.status}: ${await res.text()}`);
  }

  const data = await res.json();
  return data.data[0].embedding as number[];
}

// ─── PDF Text Extraction ─────────────────────────────────────────────────────

// Basic extraction using PDF text operators (Tj/TJ).
// Works for text-layer PDFs; does not handle scanned/image PDFs.
// For production use, consider a proper PDF parsing library.
function extractTextFromPdf(base64Content: string): string {
  try {
    const binary = atob(base64Content);
    const texts: string[] = [];

    // Match text between parentheses before Tj operator
    const tjRegex = /\(([^)\\]*(?:\\.[^)\\]*)*)\)\s*Tj/g;
    let match;
    while ((match = tjRegex.exec(binary)) !== null) {
      const text = match[1]
        .replace(/\\n/g, ' ')
        .replace(/\\r/g, ' ')
        .replace(/\\\(/g, '(')
        .replace(/\\\)/g, ')')
        .replace(/\\\\/g, '\\')
        .replace(/[^\x20-\x7E]/g, ''); // strip non-printable chars
      if (text.trim().length > 2) texts.push(text.trim());
    }

    if (texts.length > 0) {
      return texts.join(' ').slice(0, 2000);
    }
    return '[PDF content could not be extracted automatically — please review manually]';
  } catch {
    return '[PDF attachment — please review manually]';
  }
}

// ─── Image Upload to Supabase Storage ───────────────────────────────────────

async function uploadImageAttachment(
  supabase: ReturnType<typeof createClient>,
  attachment: ResendAttachment,
  tenantId: string,
): Promise<string | null> {
  try {
    const binary = atob(attachment.content);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i);
    }

    const ext = attachment.filename.split('.').pop() ?? 'jpg';
    const path = `${tenantId}/email-${Date.now()}-${attachment.filename}`;
    const contentType = attachment.mimeType ?? attachment.content_type ?? `image/${ext}`;

    const { data, error } = await supabase.storage
      .from('enquiry-photos')
      .upload(path, bytes, { contentType, upsert: false });

    if (error || !data) return null;

    const { data: urlData } = supabase.storage
      .from('enquiry-photos')
      .getPublicUrl(path);

    return urlData.publicUrl ?? null;
  } catch {
    return null;
  }
}

// ─── Main Handler ────────────────────────────────────────────────────────────

Deno.serve(async (req) => {
  if (req.method !== 'POST') {
    return new Response('Method not allowed', { status: 405 });
  }

  const anthropicKey = Deno.env.get('ANTHROPIC_API_KEY');
  const openaiKey = Deno.env.get('OPENAI_API_KEY');
  const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
  const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

  if (!anthropicKey || !openaiKey) {
    return new Response(
      JSON.stringify({ error: 'Missing required env vars: ANTHROPIC_API_KEY, OPENAI_API_KEY' }),
      { status: 500, headers: { 'Content-Type': 'application/json' } },
    );
  }

  // tenantId: query param for multi-tenant, or fall back to TENANT_ID env var
  const url = new URL(req.url);
  const tenantId = url.searchParams.get('tenantId') ?? Deno.env.get('TENANT_ID');

  if (!tenantId) {
    return new Response(
      JSON.stringify({ error: 'No tenant ID — set TENANT_ID env var or pass ?tenantId= param' }),
      { status: 400, headers: { 'Content-Type': 'application/json' } },
    );
  }

  let raw: ResendEmailPayload;
  try {
    raw = await req.json();
  } catch {
    return new Response(
      JSON.stringify({ error: 'Invalid JSON payload' }),
      { status: 400, headers: { 'Content-Type': 'application/json' } },
    );
  }

  // Handle Resend event webhook envelope ({ type, data: {...} }) and direct inbound format
  const email: ResendEmailPayload = (raw.type === 'email.received' && raw.data)
    ? raw.data
    : raw;

  const headers = email.headers ?? [];

  // Extract email threading metadata
  const messageId = headers
    .find((h) => h.name.toLowerCase() === 'message-id')?.value?.trim()
    ?? null;
  const inReplyTo = headers
    .find((h) => h.name.toLowerCase() === 'in-reply-to')?.value?.trim()
    ?? null;

  const supabase = createClient(supabaseUrl, supabaseServiceKey);

  // ── 7.4: Exact deduplication by message ID ──────────────────────────────
  if (messageId) {
    const { data: existing } = await supabase
      .from('enquiries')
      .select('id')
      .eq('tenant_id', tenantId)
      .eq('email_message_id', messageId)
      .maybeSingle();

    if (existing) {
      return new Response(
        JSON.stringify({ message: 'Duplicate: message ID already processed', id: existing.id }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    }
  }

  // ── Build raw text ───────────────────────────────────────────────────────
  let rawText = email.text ?? '';

  // Fall back to HTML with tags stripped
  if (!rawText && email.html) {
    rawText = email.html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
  }

  const imageUrls: string[] = [];
  const attachmentNotes: string[] = [];

  for (const att of email.attachments ?? []) {
    const mime = att.mimeType ?? att.content_type ?? '';

    if (mime.startsWith('image/')) {
      // ── 7.3: Image attachment — upload to Storage, flag for vision ──────
      const publicUrl = await uploadImageAttachment(supabase, att, tenantId);
      if (publicUrl) {
        imageUrls.push(publicUrl);
        attachmentNotes.push(`Image attached: ${att.filename} (uploaded for vision processing)`);
      } else {
        attachmentNotes.push(`Image attached: ${att.filename} (upload failed — review manually)`);
      }
    } else if (mime === 'application/pdf') {
      // ── 7.3: PDF attachment — extract text ───────────────────────────────
      const pdfText = extractTextFromPdf(att.content);
      attachmentNotes.push(`PDF (${att.filename}): ${pdfText}`);
    }
  }

  if (attachmentNotes.length > 0) {
    rawText += '\n\n--- Attachments ---\n' + attachmentNotes.join('\n');
  }

  if (!rawText.trim()) {
    return new Response(
      JSON.stringify({ error: 'No usable text content in email' }),
      { status: 400, headers: { 'Content-Type': 'application/json' } },
    );
  }

  // Prepend subject for better context when sanitising
  const fullText = `Subject: ${email.subject ?? '(no subject)'}\nFrom: ${email.from}\n\n${rawText}`;

  // ── 7.2: Sanitise with Claude Haiku ─────────────────────────────────────
  let sanitised: SanitisedQuote;
  try {
    sanitised = await sanitiseText(fullText, anthropicKey);
  } catch (err) {
    return new Response(
      JSON.stringify({ error: `Sanitise failed: ${err instanceof Error ? err.message : err}` }),
      { status: 500, headers: { 'Content-Type': 'application/json' } },
    );
  }

  const description = sanitised.description ?? rawText.slice(0, 500);

  // ── 7.2: Generate embedding ──────────────────────────────────────────────
  let embedding: number[];
  try {
    embedding = await generateEmbedding(description, openaiKey);
  } catch (err) {
    return new Response(
      JSON.stringify({ error: `Embedding failed: ${err instanceof Error ? err.message : err}` }),
      { status: 500, headers: { 'Content-Type': 'application/json' } },
    );
  }

  // ── 7.4: Embedding-based duplicate detection (similarity > 0.95) ────────
  let duplicateOfId: string | null = null;
  try {
    const { data: similar } = await supabase.rpc('match_enquiries', {
      query_embedding: embedding,
      match_threshold: 0.95,
      match_count: 1,
      p_tenant_id: tenantId,
    });
    if (similar && similar.length > 0) {
      duplicateOfId = similar[0].id as string;
    }
  } catch {
    // match_enquiries RPC may not exist yet — continue without duplicate check
  }

  // ── 7.5: Thread awareness — find parent by In-Reply-To header ───────────
  let parentEnquiryId: string | null = null;
  let emailThreadId: string | null = messageId;

  if (inReplyTo) {
    const { data: parent } = await supabase
      .from('enquiries')
      .select('id, email_thread_id')
      .eq('tenant_id', tenantId)
      .eq('email_message_id', inReplyTo)
      .maybeSingle();

    if (parent) {
      parentEnquiryId = parent.id;
      // Inherit the thread ID from the parent so all replies share the same root
      emailThreadId = parent.email_thread_id ?? inReplyTo;
    }
  }

  // ── Insert into enquiries ────────────────────────────────────────────────
  const isDuplicate = duplicateOfId !== null;

  const { data: enquiry, error: insertError } = await supabase
    .from('enquiries')
    .insert({
      tenant_id: tenantId,
      source: 'email',
      raw_input: rawText.slice(0, 5000),
      image_urls: imageUrls.length > 0 ? imageUrls : null,
      extracted_specs: sanitised,
      // Archive duplicates so they don't clutter the dashboard but are preserved
      status: isDuplicate ? 'archived' : 'new',
      email_message_id: messageId,
      email_thread_id: emailThreadId,
      email_subject: email.subject ?? null,
      email_from: email.from ?? null,
      parent_enquiry_id: parentEnquiryId,
      duplicate_of_id: duplicateOfId,
      embedding,
    })
    .select('id')
    .single();

  if (insertError) {
    return new Response(
      JSON.stringify({ error: `Insert failed: ${insertError.message}` }),
      { status: 500, headers: { 'Content-Type': 'application/json' } },
    );
  }

  return new Response(
    JSON.stringify({
      message: isDuplicate
        ? 'Processed as likely duplicate (status: archived)'
        : 'Email processed and saved as new enquiry',
      id: enquiry.id,
      is_duplicate: isDuplicate,
      duplicate_of_id: duplicateOfId,
      thread_linked: !!parentEnquiryId,
      parent_enquiry_id: parentEnquiryId,
    }),
    { headers: { 'Content-Type': 'application/json' } },
  );
});
