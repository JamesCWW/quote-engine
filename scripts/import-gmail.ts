/**
 * Gmail import script for Helions Forge
 *
 * Searches Gmail for quote-related threads, sanitises each via Anthropic,
 * embeds via OpenAI, and inserts into Supabase — replicating the
 * /api/sanitise → /api/embed pipeline without needing the Next.js server running.
 *
 * Run with:
 *   npx ts-node scripts/import-gmail.ts            # full import
 *   npx ts-node scripts/import-gmail.ts --dry-run  # preview what would be imported
 *   npx ts-node scripts/import-gmail.ts --test      # inspect first 5 threads, no DB writes
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
const TEST_REPORT_PATH = path.join(SCRIPTS_DIR, 'import-test-report.json');

// ── Flags ──────────────────────────────────────────────────────────────────

const TEST_MODE = process.argv.includes('--test');
const DRY_RUN_MODE = process.argv.includes('--dry-run');

// ── Gmail search ───────────────────────────────────────────────────────────

const SEARCH_TERMS = [
  'quote', 'enquiry', 'estimate', 'price',
  'balustrade', 'staircase', 'railing', 'gate',
  'steel', 'metalwork', 'supply', 'install', 'fabricat',
];
const GMAIL_QUERY = `(${SEARCH_TERMS.join(' OR ')}) newer_than:730d`;

// ── Filter constants ───────────────────────────────────────────────────────

const ENQUIRY_WORDS = [
  'quote', 'quotation', 'estimate', 'enquiry', 'enquire',
  'price', 'pricing', 'how much', 'cost', 'interested in',
  'looking for', 'looking to', 'please quote',
  'supply and fit', 'supply and install', 'can you provide',
];

const PRODUCT_WORDS = [
  'gate', 'gates', 'railing', 'railings', 'fence', 'fencing',
  'handrail', 'balcony', 'iron', 'steel', 'aluminium',
  'driveway', 'pedestrian', 'automation', 'automated',
  'electric gate', 'sliding gate',
];

const EXCLUDE_FROM_PATTERNS = [
  'noreply@', 'no-reply@', 'notifications@',
  'hubspot', 'stripe', 'xero', 'quickbooks', '@royalmail',
  'invoicing@', 'billing@', 'donotreply@',
];

const EXCLUDE_SUBJECT_PATTERNS = [
  'payment received', 'receipt', 'order confirmation',
  'delivery notification', 'tracking', 'your order',
];

// Matches PDF filenames that are Helions Forge quote documents
const QUOTE_PDF_FILENAME_RE = /HF|[Qq]uote|[Qq]uotation|QUOTE/;

// Image MIME types to skip (don't download or include in combined text)
const SKIP_IMAGE_TYPES = new Set([
  'image/jpeg', 'image/jpg', 'image/png',
  'image/gif', 'image/webp',
]);

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
    const isQuotePdf = QUOTE_PDF_FILENAME_RE.test(filename);
    const label = isQuotePdf ? 'HELIONS FORGE QUOTE PDF' : 'ATTACHED PDF';

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
        texts.push(`--- ${label} (email ${emailIndex} of ${totalEmails}, ${date}) ---\n${text}`);
      } else {
        console.log(`    [PDF] Skipped ${filename} — no text content (image-only PDF?)`);
      }
    } catch (err) {
      console.log(`    [PDF] Skipped ${filename} — parse error: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  // Log skipped attachments (images and other non-PDF types)
  if (payload.parts) {
    for (const part of collectSkippedAttachments(payload.parts)) {
      const reason = SKIP_IMAGE_TYPES.has(part.mimeType) ? 'image' : 'non-PDF';
      console.log(`    [ATT] Skipped ${reason} attachment: ${part.filename ?? part.mimeType}`);
    }
  }

  return texts;
}

function collectSkippedAttachments(parts: any[]): any[] {
  const atts: any[] = [];
  for (const part of parts) {
    if (part.body?.attachmentId && part.mimeType !== 'application/pdf') {
      atts.push(part);
    } else if (part.parts) {
      atts.push(...collectSkippedAttachments(part.parts));
    }
  }
  return atts;
}

// ── Thread filter ──────────────────────────────────────────────────────────

type FilterVerdict =
  | { include: true; reason: 'outbound quote' | 'inbound enquiry' }
  | { include: false; reason: string };

/**
 * Evaluates whether a thread should be imported.
 * Operates on already-fetched message data (format: 'full').
 * Does NOT download attachment content — PDF filenames are used for Condition A.
 * Note: the invoice exclusion checks email body text only, not PDF text.
 */
function evaluateThread(messages: any[]): FilterVerdict {
  let hasHelionsFrom = false;
  let hasExternalFrom = false;
  let combinedText = '';
  let quotePdfFilenames: string[] = [];

  for (const msg of messages) {
    const headers = msg.payload?.headers ?? [];
    const from = getHeader(headers, 'from');
    const subject = getHeader(headers, 'subject');
    const body = extractBody(msg.payload ?? {});
    const fromLower = from.toLowerCase();
    const subjectLower = subject.toLowerCase();
    const bodyLower = body.toLowerCase();

    // Hard exclusion: blocked sender patterns
    if (EXCLUDE_FROM_PATTERNS.some(p => fromLower.includes(p))) {
      return { include: false, reason: `excluded sender (${from})` };
    }

    // Hard exclusion: blocked subject patterns
    if (EXCLUDE_SUBJECT_PATTERNS.some(p => subjectLower.includes(p))) {
      return { include: false, reason: `excluded subject pattern ("${subject}")` };
    }

    // Track FROM types
    if (fromLower.includes('helionsforge.com')) {
      hasHelionsFrom = true;
    } else {
      hasExternalFrom = true;
    }

    // Accumulate searchable text
    combinedText += ' ' + subjectLower + ' ' + bodyLower;

    // Collect PDF filenames from this message
    if (msg.payload?.parts) {
      for (const part of collectPdfParts(msg.payload.parts)) {
        if (part.filename) quotePdfFilenames.push(part.filename);
      }
    }
  }

  // Hard exclusion: single email with trivially short body
  if (messages.length === 1) {
    const body = extractBody(messages[0].payload ?? {}).trim();
    if (body.length < 50) {
      return { include: false, reason: 'single email, body too short (<50 chars)' };
    }
  }

  // Soft exclusion: "invoice" subject without any product keywords in body
  // (Checked before conditions so that pure invoice-only threads are caught,
  //  but note this uses email text only — PDF content is not evaluated here)
  const hasInvoiceSubject = messages.some(msg => {
    const subject = getHeader(msg.payload?.headers ?? [], 'subject').toLowerCase();
    return subject.includes('invoice');
  });
  if (hasInvoiceSubject && !PRODUCT_WORDS.some(w => combinedText.includes(w))) {
    return { include: false, reason: 'invoice subject without product keywords in body' };
  }

  // Condition A: outbound quote — Helions Forge sent a quote PDF
  if (hasHelionsFrom) {
    const hasQuotePdf = quotePdfFilenames.some(fn => QUOTE_PDF_FILENAME_RE.test(fn));
    if (hasQuotePdf) {
      return { include: true, reason: 'outbound quote' };
    }
  }

  // Condition B: inbound enquiry — customer email with enquiry + product keywords
  if (hasExternalFrom) {
    const hasEnquiryWord = ENQUIRY_WORDS.some(w => combinedText.includes(w));
    const hasProductWord = PRODUCT_WORDS.some(w => combinedText.includes(w));
    if (hasEnquiryWord && hasProductWord) {
      return { include: true, reason: 'inbound enquiry' };
    }
  }

  return { include: false, reason: 'no matching conditions' };
}

// ── Test-mode types & PDF extraction ──────────────────────────────────────

interface TestEmailEntry {
  from: string;
  date: string;
  body_length: number;
  body_preview: string;
  body_captured: boolean;
}

interface TestAttachmentEntry {
  filename: string;
  type: string;
  pdf_text_length: number;
  pdf_preview: string;
  pdf_captured: boolean;
}

interface TestThreadReport {
  thread_id: string;
  subject: string;
  email_count: number;
  emails: TestEmailEntry[];
  attachments: TestAttachmentEntry[];
  combined_text_length: number;
  combined_preview: string;
}

async function extractPdfAttachmentsForTest(
  gmail: ReturnType<typeof google.gmail>,
  messageId: string,
  payload: any
): Promise<TestAttachmentEntry[]> {
  const pdfParts = payload.parts ? collectPdfParts(payload.parts) : [];
  const entries: TestAttachmentEntry[] = [];

  for (const part of pdfParts) {
    const filename = part.filename ?? 'attachment.pdf';
    const entry: TestAttachmentEntry = {
      filename,
      type: 'application/pdf',
      pdf_text_length: 0,
      pdf_preview: '',
      pdf_captured: false,
    };
    try {
      const attRes = await gmail.users.messages.attachments.get({
        userId: 'me',
        messageId,
        id: part.body.attachmentId,
      });
      const data = attRes.data.data;
      if (data) {
        const buffer = Buffer.from(data.replace(/-/g, '+').replace(/_/g, '/'), 'base64');
        const parser = new PDFParse({ data: buffer });
        const result = await parser.getText();
        await parser.destroy();
        const text = result.text.trim();
        entry.pdf_text_length = text.length;
        entry.pdf_preview = text.slice(0, 200);
        entry.pdf_captured = text.length > 0;
      }
    } catch (_err) {
      // captured = false, lengths remain 0
    }
    entries.push(entry);
  }

  // Include non-PDF attachments with their mime type (images etc.)
  if (payload.parts) {
    for (const part of collectSkippedAttachments(payload.parts)) {
      entries.push({
        filename: part.filename ?? part.mimeType,
        type: part.mimeType,
        pdf_text_length: 0,
        pdf_preview: '',
        pdf_captured: false,
      });
    }
  }

  return entries;
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
  // Validate required env vars — AI/DB credentials not needed for dry-run or test
  const googleRequired = ['GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET'];
  const fullRequired = [...googleRequired, 'ANTHROPIC_API_KEY', 'OPENAI_API_KEY', 'NEXT_PUBLIC_SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY'];
  const required = (TEST_MODE || DRY_RUN_MODE) ? googleRequired : fullRequired;
  const missing = required.filter(k => !process.env[k]);
  if (missing.length) {
    console.error(`Missing env vars: ${missing.join(', ')}`);
    process.exit(1);
  }

  if (DRY_RUN_MODE) {
    console.log('Helions Forge — Gmail Import [DRY RUN]\n');
    console.log('  • Fetching and evaluating all threads');
    console.log('  • No attachment downloads, no database writes\n');
  } else if (TEST_MODE) {
    console.log('Helions Forge — Gmail Import [TEST MODE]\n');
    console.log('  • Processing first 5 threads only');
    console.log('  • No API calls to /api/sanitise or /api/embed');
    console.log('  • No database writes');
    console.log(`  • Report will be saved to ${TEST_REPORT_PATH}\n`);
  } else {
    console.log('Helions Forge — Gmail Import\n');
  }

  const auth = await getAuthenticatedClient();
  const tenantId = (TEST_MODE || DRY_RUN_MODE) ? '' : await getHelionsTenantId();

  if (!TEST_MODE && !DRY_RUN_MODE) console.log(`Tenant ID: ${tenantId}`);

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

  // ── Dry-run mode ───────────────────────────────────────────────────────

  if (DRY_RUN_MODE) {
    console.log(`\nEvaluating all ${allThreadIds.length} threads...\n`);

    const included: Array<{ id: string; subject: string; reason: string }> = [];
    const excluded: Array<{ id: string; subject: string; reason: string }> = [];

    for (let i = 0; i < allThreadIds.length; i++) {
      const threadId = allThreadIds[i];
      process.stdout.write(`\rEvaluating ${i + 1}/${allThreadIds.length}...`);

      try {
        const threadRes = await gmail.users.threads.get({
          userId: 'me',
          id: threadId,
          format: 'full',
        });
        const messages = threadRes.data.messages ?? [];
        const subject = getHeader(messages[0]?.payload?.headers ?? [], 'subject') || '(no subject)';
        const verdict = evaluateThread(messages);

        if (verdict.include) {
          included.push({ id: threadId, subject, reason: verdict.reason });
        } else {
          excluded.push({ id: threadId, subject, reason: verdict.reason });
        }
      } catch (err) {
        excluded.push({ id: threadId, subject: '(error)', reason: `fetch error: ${err instanceof Error ? err.message : String(err)}` });
      }

      // Brief pause to avoid rate-limiting
      await new Promise(r => setTimeout(r, 100));
    }

    process.stdout.write('\r');

    console.log('\n── WOULD INCLUDE ─────────────────────────────────────────────────────\n');
    for (const t of included) {
      console.log(`  INCLUDE [${t.reason.padEnd(17)}]  "${t.subject}"`);
    }

    console.log('\n── WOULD EXCLUDE ─────────────────────────────────────────────────────\n');
    for (const t of excluded) {
      console.log(`  EXCLUDE  "${t.subject}"`);
      console.log(`           reason: ${t.reason}`);
    }

    const estSeconds = included.length * 5;
    const estMin = Math.floor(estSeconds / 60);
    const estSec = estSeconds % 60;
    const estStr = estMin > 0 ? `${estMin}m ${estSec}s` : `${estSec}s`;

    console.log('\n─────────────────────────────────────────────────────────────────────');
    console.log('Dry run complete');
    console.log(`  Total found    : ${allThreadIds.length}`);
    console.log(`  Would include  : ${included.length}`);
    console.log(`  Would exclude  : ${excluded.length}`);
    console.log(`  Estimated time : ${included.length} × 5s = ${estStr}`);
    console.log('─────────────────────────────────────────────────────────────────────\n');
    return;
  }

  // ── Normal and test-mode processing ───────────────────────────────────

  const processed = loadProcessed();
  const unprocessed = allThreadIds.filter(id => !processed.has(id));
  const skippedCount = allThreadIds.length - unprocessed.length;
  const toProcess = TEST_MODE ? unprocessed.slice(0, 5) : unprocessed;

  if (TEST_MODE) {
    console.log(`Found ${allThreadIds.length} threads (${skippedCount} already processed).`);
    console.log(`Test mode: inspecting first ${toProcess.length} unprocessed threads.\n`);
  } else {
    console.log(`Skipping ${skippedCount} already-processed threads.`);
    console.log(`Processing ${toProcess.length} new threads.\n`);
  }

  // ── Process each thread ────────────────────────────────────────────────

  let successCount = 0;
  let filteredCount = 0;
  let errorCount = 0;
  const testReport: TestThreadReport[] = [];

  for (let i = 0; i < toProcess.length; i++) {
    const threadId = toProcess[i];
    process.stdout.write(`${TEST_MODE ? 'Inspecting' : 'Processing'} thread ${i + 1}/${toProcess.length}...`);

    let subject = '(unknown)';
    try {
      // Fetch all messages in thread
      const threadRes = await gmail.users.threads.get({
        userId: 'me',
        id: threadId,
        format: 'full',
      });
      const messages = threadRes.data.messages ?? [];
      subject = getHeader(messages[0]?.payload?.headers ?? [], 'subject') || '(no subject)';

      // Apply filter (skip in test mode — test mode inspects everything)
      if (!TEST_MODE) {
        const verdict = evaluateThread(messages);
        if (!verdict.include) {
          process.stdout.write(` filtered (${verdict.reason})\n`);
          processed.add(threadId);
          saveProcessed(processed);
          filteredCount++;
          continue;
        }
        process.stdout.write(` [${verdict.reason}]`);
      }

      // Build combined text block
      const textParts: string[] = [];
      let totalPdfCount = 0;
      const totalEmails = messages.length;
      const testEmails: TestEmailEntry[] = [];
      const testAttachments: TestAttachmentEntry[] = [];

      for (let msgIdx = 0; msgIdx < messages.length; msgIdx++) {
        const msg = messages[msgIdx];
        const payload = msg.payload!;
        const headers = payload.headers ?? [];
        const msgSubject = getHeader(headers, 'subject');
        const date = getHeader(headers, 'date');
        const from = getHeader(headers, 'from');

        const body = extractBody(payload).trim();

        if (TEST_MODE) {
          testEmails.push({
            from,
            date,
            body_length: body.length,
            body_preview: body.slice(0, 200),
            body_captured: body.length > 0,
          });
          const attEntries = await extractPdfAttachmentsForTest(gmail, msg.id!, payload);
          testAttachments.push(...attEntries);
          totalPdfCount += attEntries.filter(a => a.type === 'application/pdf' && a.pdf_captured).length;

          const pdfTexts = attEntries
            .filter(a => a.type === 'application/pdf' && a.pdf_captured)
            .map(a => {
              const label = QUOTE_PDF_FILENAME_RE.test(a.filename) ? 'HELIONS FORGE QUOTE PDF' : 'ATTACHED PDF';
              return `--- ${label} ---\n${a.pdf_preview}`;
            });
          const parts: string[] = [];
          if (body) parts.push(body);
          parts.push(...pdfTexts);
          if (parts.length > 0) {
            textParts.push(`--- Email ---\nSubject: ${msgSubject}\nDate: ${date}\nFrom: ${from}\n\n${parts.join('\n\n')}`);
          }
        } else {
          const pdfTexts = await extractPdfAttachments(gmail, msg.id!, payload, msgIdx + 1, totalEmails, date);
          totalPdfCount += pdfTexts.length;

          const parts: string[] = [];
          if (body) parts.push(body);
          parts.push(...pdfTexts);

          if (parts.length > 0) {
            textParts.push(`--- Email ---\nSubject: ${msgSubject}\nDate: ${date}\nFrom: ${from}\n\n${parts.join('\n\n')}`);
          }
        }
      }

      if (textParts.length === 0 && !TEST_MODE) {
        process.stdout.write(` skipped (no text content)\n`);
        processed.add(threadId);
        saveProcessed(processed);
        continue;
      }

      let combinedText = textParts.join('\n\n');

      if (!TEST_MODE && totalPdfCount > 1) {
        combinedText = `Note: ${totalPdfCount} quote PDFs found in this thread - prices and specs may have evolved. Capture the full evolution in job_evolution field.\n\n${combinedText}`;
      }

      if (TEST_MODE) {
        testReport.push({
          thread_id: threadId,
          subject,
          email_count: totalEmails,
          emails: testEmails,
          attachments: testAttachments,
          combined_text_length: combinedText.length,
          combined_preview: combinedText.slice(0, 300),
        });
        process.stdout.write(` captured\n`);
      } else {
        // Sanitise → embed → insert
        const sanitised = await sanitise(combinedText);
        await embedAndInsert(tenantId, combinedText, sanitised);

        processed.add(threadId);
        saveProcessed(processed);
        successCount++;
        process.stdout.write(` done\n`);
      }

    } catch (err) {
      errorCount++;
      if (!TEST_MODE) logError(threadId, subject, err);
      process.stdout.write(` ERROR: ${err instanceof Error ? err.message : String(err)}\n`);
    }

    // Brief pause to avoid rate-limiting
    await new Promise(r => setTimeout(r, 200));
  }

  // ── Summary ────────────────────────────────────────────────────────────

  if (TEST_MODE) {
    fs.writeFileSync(TEST_REPORT_PATH, JSON.stringify(testReport, null, 2));
    console.log('\n─────────────────────────────');
    console.log('Test run complete');
    console.log(`  Threads inspected : ${testReport.length}`);
    console.log(`  Errors            : ${errorCount}`);
    console.log(`  Report saved to   : ${TEST_REPORT_PATH}`);
    console.log('─────────────────────────────\n');
  } else {
    console.log('\n─────────────────────────────');
    console.log('Import complete');
    console.log(`  Processed : ${successCount}`);
    console.log(`  Filtered  : ${filteredCount}`);
    console.log(`  Skipped   : ${skippedCount}`);
    console.log(`  Errors    : ${errorCount}`);
    if (errorCount > 0) {
      console.log(`  Error log : ${ERROR_LOG_PATH}`);
    }
    console.log('─────────────────────────────\n');
  }
}

main().catch(err => {
  console.error('\nFatal error:', err.message ?? err);
  process.exit(1);
});
