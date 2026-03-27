/**
 * Gmail import script for Helions Forge
 *
 * Searches Gmail for quote-related threads, sanitises each via Anthropic,
 * embeds via OpenAI, and inserts into Supabase — replicating the
 * /api/sanitise → /api/embed pipeline without needing the Next.js server running.
 *
 * Run with:
 *   npx ts-node scripts/import-gmail.ts
 *
 * On first run, a browser window opens for Gmail OAuth consent.
 * Token is cached in scripts/token.json for subsequent runs.
 */

import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

import * as fs from 'fs';
import * as http from 'http';
import * as path from 'path';
import { google } from 'googleapis';
import Anthropic from '@anthropic-ai/sdk';
import OpenAI from 'openai';
import { createClient } from '@supabase/supabase-js';
import { PDFParse } from 'pdf-parse';

// ── Paths ──────────────────────────────────────────────────────────────────

const SCRIPTS_DIR = path.join(__dirname);
const TOKEN_PATH = path.join(SCRIPTS_DIR, 'token.json');
const PROCESSED_PATH = path.join(SCRIPTS_DIR, 'processed-threads.json');
const ERROR_LOG_PATH = path.join(SCRIPTS_DIR, 'import-errors.log');

// ── Gmail search ───────────────────────────────────────────────────────────

const SEARCH_TERMS = [
  'quote', 'enquiry', 'estimate', 'price',
  'balustrade', 'staircase', 'railing', 'gate',
  'steel', 'metalwork', 'supply', 'install', 'fabricat',
];
const GMAIL_QUERY = `(${SEARCH_TERMS.join(' OR ')}) newer_than:365d`;

// ── Sanitiser prompt (mirrors lib/ai/prompts.ts) ───────────────────────────

const SANITISER_PROMPT = `
You are a data cleaning assistant for a metalwork quoting system.

Given raw email or quote text, extract and return ONLY a JSON object with:
- product_type: string (e.g. "Balustrade", "Staircase", "Gate", "Railing")
- material: string (e.g. "316 Stainless Steel", "Mild Steel Powder Coated")
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

// ── Clients ────────────────────────────────────────────────────────────────

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { autoRefreshToken: false, persistSession: false } }
);

// ── OAuth2 ─────────────────────────────────────────────────────────────────

const CALLBACK_PORT = 3001;
const REDIRECT_URI = `http://localhost:${CALLBACK_PORT}/callback`;

function buildOAuth2Client() {
  return new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    REDIRECT_URI
  );
}

async function waitForCallbackCode(): Promise<string> {
  return new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      const url = new URL(req.url!, `http://localhost:${CALLBACK_PORT}`);
      const code = url.searchParams.get('code');
      const error = url.searchParams.get('error');

      if (error) {
        res.writeHead(400, { 'Content-Type': 'text/html' });
        res.end('<h2>Authorisation denied.</h2><p>You may close this tab.</p>');
        server.close();
        reject(new Error(`OAuth error: ${error}`));
        return;
      }

      if (code) {
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end('<h2>Authorisation successful!</h2><p>You may close this tab and return to the terminal.</p>');
        server.close();
        resolve(code);
      }
    });

    server.listen(CALLBACK_PORT, () => {
      // server is ready
    });

    server.on('error', reject);
  });
}

async function getAuthenticatedClient() {
  const oauth2Client = buildOAuth2Client();

  if (fs.existsSync(TOKEN_PATH)) {
    const token = JSON.parse(fs.readFileSync(TOKEN_PATH, 'utf8'));
    oauth2Client.setCredentials(token);

    // Refresh if expired
    if (token.expiry_date && token.expiry_date < Date.now()) {
      const { credentials } = await oauth2Client.refreshAccessToken();
      fs.writeFileSync(TOKEN_PATH, JSON.stringify(credentials, null, 2));
      oauth2Client.setCredentials(credentials);
    }
    return oauth2Client;
  }

  // First run: start local server and open browser for consent
  const authUrl = oauth2Client.generateAuthUrl({
    access_type: 'offline',
    scope: ['https://www.googleapis.com/auth/gmail.readonly'],
    prompt: 'consent',
  });

  console.log('\nOpening browser for Gmail authorisation...');
  console.log('If it does not open automatically, visit:\n');
  console.log(authUrl, '\n');

  const callbackPromise = waitForCallbackCode();

  const open = (await import('open')).default;
  await open(authUrl);

  const code = await callbackPromise;

  const { tokens } = await oauth2Client.getToken(code);
  fs.writeFileSync(TOKEN_PATH, JSON.stringify(tokens, null, 2));
  oauth2Client.setCredentials(tokens);

  console.log(`Token saved to ${TOKEN_PATH}\n`);
  return oauth2Client;
}

// ── Gmail helpers ──────────────────────────────────────────────────────────

function decodeBase64(data: string): string {
  return Buffer.from(data.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8');
}

function extractTextFromParts(parts: any[]): string {
  let text = '';
  for (const part of parts) {
    if (part.mimeType === 'text/plain' && part.body?.data) {
      text += decodeBase64(part.body.data) + '\n';
    } else if (part.parts) {
      text += extractTextFromParts(part.parts);
    }
  }
  return text;
}

function extractBody(payload: any): string {
  if (payload.body?.data) {
    return decodeBase64(payload.body.data);
  }
  if (payload.parts) {
    return extractTextFromParts(payload.parts);
  }
  return '';
}

function getHeader(headers: { name?: string | null; value?: string | null }[], name: string): string {
  return headers.find(h => h.name?.toLowerCase() === name.toLowerCase())?.value ?? '';
}

// ── PDF helpers ────────────────────────────────────────────────────────────

function collectPdfParts(parts: any[]): any[] {
  const pdfs: any[] = [];
  for (const part of parts) {
    if (part.mimeType === 'application/pdf' && part.body?.attachmentId) {
      pdfs.push(part);
    } else if (part.parts) {
      pdfs.push(...collectPdfParts(part.parts));
    }
  }
  return pdfs;
}

async function extractPdfAttachments(
  gmail: ReturnType<typeof google.gmail>,
  messageId: string,
  payload: any,
  emailIndex: number,
  totalEmails: number,
  date: string
): Promise<string[]> {
  const pdfParts = payload.parts ? collectPdfParts(payload.parts) : [];
  const texts: string[] = [];

  for (const part of pdfParts) {
    const filename = part.filename ?? 'attachment.pdf';
    try {
      const attRes = await gmail.users.messages.attachments.get({
        userId: 'me',
        messageId,
        id: part.body.attachmentId,
      });
      const data = attRes.data.data;
      if (!data) {
        console.log(`    [PDF] Skipped ${filename} — empty attachment data`);
        continue;
      }
      const buffer = Buffer.from(data.replace(/-/g, '+').replace(/_/g, '/'), 'base64');
      const parser = new PDFParse({ data: buffer });
      const result = await parser.getText();
      await parser.destroy();
      const text = result.text.trim();
      if (text) {
        console.log(`    [PDF] Extracted text from ${filename} (email ${emailIndex} of ${totalEmails})`);
        texts.push(`--- QUOTE PDF (email ${emailIndex} of ${totalEmails}, ${date}) ---\n${text}`);
      } else {
        console.log(`    [PDF] Skipped ${filename} — no text content (image-only PDF?)`);
      }
    } catch (err) {
      console.log(`    [PDF] Skipped ${filename} — parse error: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  // Log non-PDF attachments that were skipped
  if (payload.parts) {
    const nonPdfAttachments = collectNonPdfAttachments(payload.parts);
    for (const part of nonPdfAttachments) {
      console.log(`    [ATT] Skipped non-PDF attachment: ${part.filename ?? part.mimeType}`);
    }
  }

  return texts;
}

function collectNonPdfAttachments(parts: any[]): any[] {
  const atts: any[] = [];
  for (const part of parts) {
    if (part.body?.attachmentId && part.mimeType !== 'application/pdf') {
      atts.push(part);
    } else if (part.parts) {
      atts.push(...collectNonPdfAttachments(part.parts));
    }
  }
  return atts;
}

// ── Tenant lookup ──────────────────────────────────────────────────────────

async function getHelionsTenantId(): Promise<string> {
  const { data, error } = await supabase
    .from('tenants')
    .select('id')
    .eq('name', 'Helions Forge')
    .single();

  if (error || !data) {
    throw new Error(`Could not find Helions Forge tenant in Supabase: ${error?.message ?? 'not found'}`);
  }
  return data.id as string;
}

// ── Pipeline ───────────────────────────────────────────────────────────────

interface SanitisedQuote {
  product_type: string | null;
  material: string | null;
  description: string;
  dimensions: Record<string, number> | null;
  price_low: number | null;
  price_high: number | null;
  final_price: number | null;
  status: 'won' | 'lost' | 'unknown';
}

async function sanitise(rawText: string): Promise<SanitisedQuote> {
  const truncated = rawText.slice(0, 2000);
  const message = await anthropic.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 1024,
    messages: [{ role: 'user', content: `${SANITISER_PROMPT}\n\nRaw text to clean:\n${truncated}` }],
  });

  const content = message.content[0];
  if (content.type !== 'text') throw new Error('Unexpected response from Anthropic');

  const jsonText = content.text.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '').trim();
  return JSON.parse(jsonText) as SanitisedQuote;
}

async function embedAndInsert(
  tenantId: string,
  rawText: string,
  sanitised: SanitisedQuote
): Promise<string> {
  const embeddingResponse = await openai.embeddings.create({
    model: 'text-embedding-3-small',
    input: sanitised.description.slice(0, 2000),
  });
  const embedding = embeddingResponse.data[0].embedding;

  const quoteStatus = sanitised.status === 'unknown' ? 'draft' : sanitised.status;
  const isGolden = sanitised.status === 'won';

  const { data, error } = await supabase
    .from('quotes')
    .insert({
      tenant_id: tenantId,
      raw_text: rawText.slice(0, 2000),
      description: sanitised.description,
      product_type: sanitised.product_type,
      material: sanitised.material,
      dimensions: sanitised.dimensions,
      price_low: sanitised.price_low,
      price_high: sanitised.price_high,
      final_price: sanitised.final_price,
      status: quoteStatus,
      is_golden: isGolden,
      embedding,
    })
    .select('id')
    .single();

  if (error) throw new Error(`Supabase insert failed: ${error.message}`);
  return data.id as string;
}

// ── Processed-thread tracking ──────────────────────────────────────────────

function loadProcessed(): Set<string> {
  if (!fs.existsSync(PROCESSED_PATH)) return new Set();
  const arr: string[] = JSON.parse(fs.readFileSync(PROCESSED_PATH, 'utf8'));
  return new Set(arr);
}

function saveProcessed(processed: Set<string>): void {
  fs.writeFileSync(PROCESSED_PATH, JSON.stringify(Array.from(processed), null, 2));
}

// ── Error logging ──────────────────────────────────────────────────────────

function logError(threadId: string, subject: string, err: unknown): void {
  const msg = `[${new Date().toISOString()}] Thread ${threadId} ("${subject}"): ${err instanceof Error ? err.message : String(err)}\n`;
  fs.appendFileSync(ERROR_LOG_PATH, msg);
}

// ── Main ───────────────────────────────────────────────────────────────────

async function main() {
  // Validate required env vars
  const required = [
    'GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET',
    'ANTHROPIC_API_KEY', 'OPENAI_API_KEY',
    'NEXT_PUBLIC_SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY',
  ];
  const missing = required.filter(k => !process.env[k]);
  if (missing.length) {
    console.error(`Missing env vars: ${missing.join(', ')}`);
    process.exit(1);
  }

  console.log('Helions Forge — Gmail Import\n');

  const [auth, tenantId] = await Promise.all([
    getAuthenticatedClient(),
    getHelionsTenantId(),
  ]);

  console.log(`Tenant ID: ${tenantId}`);

  const gmail = google.gmail({ version: 'v1', auth });

  // ── Fetch all matching thread IDs ──────────────────────────────────────

  console.log(`\nSearching Gmail: ${GMAIL_QUERY}\n`);

  let allThreadIds: string[] = [];
  let pageToken: string | undefined;

  do {
    const res = await gmail.users.threads.list({
      userId: 'me',
      q: GMAIL_QUERY,
      maxResults: 500,
      pageToken,
    });
    const threads = res.data.threads ?? [];
    allThreadIds.push(...threads.map(t => t.id!));
    pageToken = res.data.nextPageToken ?? undefined;
  } while (pageToken);

  console.log(`Found ${allThreadIds.length} threads matching search criteria.`);

  const processed = loadProcessed();
  const toProcess = allThreadIds.filter(id => !processed.has(id));
  const skippedCount = allThreadIds.length - toProcess.length;

  console.log(`Skipping ${skippedCount} already-processed threads.`);
  console.log(`Processing ${toProcess.length} new threads.\n`);

  // ── Process each thread ────────────────────────────────────────────────

  let successCount = 0;
  let errorCount = 0;

  for (let i = 0; i < toProcess.length; i++) {
    const threadId = toProcess[i];
    process.stdout.write(`Processing thread ${i + 1}/${toProcess.length}...`);

    let subject = '(unknown)';
    try {
      // Fetch all messages in thread
      const threadRes = await gmail.users.threads.get({
        userId: 'me',
        id: threadId,
        format: 'full',
      });
      const messages = threadRes.data.messages ?? [];

      // Build combined text block
      const textParts: string[] = [];
      let totalPdfCount = 0;
      const totalEmails = messages.length;

      for (let msgIdx = 0; msgIdx < messages.length; msgIdx++) {
        const msg = messages[msgIdx];
        const payload = msg.payload!;
        const headers = payload.headers ?? [];
        const msgSubject = getHeader(headers, 'subject');
        const date = getHeader(headers, 'date');
        const from = getHeader(headers, 'from');
        if (!subject || subject === '(unknown)') subject = msgSubject;

        const body = extractBody(payload).trim();
        const pdfTexts = await extractPdfAttachments(gmail, msg.id!, payload, msgIdx + 1, totalEmails, date);
        totalPdfCount += pdfTexts.length;

        const parts: string[] = [];
        if (body) parts.push(body);
        parts.push(...pdfTexts);

        if (parts.length > 0) {
          textParts.push(`--- Email ---\nSubject: ${msgSubject}\nDate: ${date}\nFrom: ${from}\n\n${parts.join('\n\n')}`);
        }
      }

      if (textParts.length === 0) {
        process.stdout.write(` skipped (no text content)\n`);
        processed.add(threadId);
        saveProcessed(processed);
        skippedCount; // already counted
        continue;
      }

      let combinedText = textParts.join('\n\n');

      if (totalPdfCount > 1) {
        combinedText = `Note: ${totalPdfCount} quote PDFs found in this thread - prices and specs may have evolved. Capture the full evolution in job_evolution field.\n\n${combinedText}`;
      }

      // Sanitise → embed → insert
      const sanitised = await sanitise(combinedText);
      await embedAndInsert(tenantId, combinedText, sanitised);

      processed.add(threadId);
      saveProcessed(processed);
      successCount++;
      process.stdout.write(` done\n`);

    } catch (err) {
      errorCount++;
      logError(threadId, subject, err);
      process.stdout.write(` ERROR (logged)\n`);
    }

    // Brief pause to avoid rate-limiting
    await new Promise(r => setTimeout(r, 200));
  }

  // ── Summary ────────────────────────────────────────────────────────────

  console.log('\n─────────────────────────────');
  console.log('Import complete');
  console.log(`  Processed : ${successCount}`);
  console.log(`  Skipped   : ${skippedCount}`);
  console.log(`  Errors    : ${errorCount}`);
  if (errorCount > 0) {
    console.log(`  Error log : ${ERROR_LOG_PATH}`);
  }
  console.log('─────────────────────────────\n');
}

main().catch(err => {
  console.error('\nFatal error:', err.message ?? err);
  process.exit(1);
});
