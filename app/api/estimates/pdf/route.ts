import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
// pdfkit is a CommonJS module — use require() to avoid ESM issues
// eslint-disable-next-line @typescript-eslint/no-require-imports
const PDFDocument = require('pdfkit');

interface AccessoryLine {
  name: string;
  amount: number;
}

interface DetBreakdown {
  product_supply?: number;
  manufacture?: number;
  installation?: number;
  design_fee?: number;
  accessories?: AccessoryLine[];
  subtotal?: number;
  contingency?: number;
}

interface PdfRequestBody {
  tenant_id: string;
  customer_name: string;
  customer_email?: string;
  project_summary: string;
  price_low: number;
  price_high: number;
  breakdown?: DetBreakdown;
  components?: unknown[];
  valid_days?: number;
}

function pad2(n: number) { return String(n).padStart(2, '0'); }

function estRef() {
  const y = new Date().getFullYear();
  const r = Math.floor(1000 + Math.random() * 9000);
  return `EST-${y}-${r}`;
}

function fmtGBP(n: number) {
  return '£' + Number(n).toLocaleString('en-GB', { minimumFractionDigits: 0, maximumFractionDigits: 0 });
}

function fmtDate(d: Date) {
  return `${pad2(d.getDate())}/${pad2(d.getMonth() + 1)}/${d.getFullYear()}`;
}

// Colour palette
const CHARCOAL = '#1a1a1a';
const MID_GREY  = '#6b7280';
const LIGHT_GREY = '#f3f4f6';
const RULE_GREY = '#d1d5db';

async function buildPdf(body: PdfRequestBody): Promise<Buffer> {
  const {
    customer_name,
    customer_email,
    project_summary,
    price_low,
    price_high,
    breakdown,
    valid_days = 30,
  } = body;

  const supabase = createAdminClient();
  const { data: profile } = await supabase
    .from('tenant_profile')
    .select('*')
    .eq('tenant_id', body.tenant_id)
    .single();

  const estRef_ = estRef();
  const issuedDate = new Date();
  const validDate = new Date(issuedDate);
  validDate.setDate(validDate.getDate() + valid_days);

  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 50, autoFirstPage: true });
    const chunks: Buffer[] = [];
    doc.on('data', (c: Buffer) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    const W = doc.page.width - 100; // usable width (margin 50 each side)
    let y = 50;

    // ── HEADER ─────────────────────────────────────────────────────────────
    // Logo (left) + business info (right)
    const logoSize = 70;
    if (profile?.logo_url) {
      try {
        doc.image(profile.logo_url, 50, y, { fit: [logoSize, logoSize] });
      } catch { /* skip if image fails */ }
    }

    // Business name & contact (right-aligned block)
    const bizName   = profile?.business_name ?? 'Your Business';
    const bizAddr   = profile?.address?.replace(/\n/g, ', ') ?? '';
    const bizPhone  = profile?.phone ?? '';
    const bizEmail  = profile?.email ?? '';

    doc.font('Helvetica-Bold').fontSize(13).fillColor(CHARCOAL)
      .text(bizName, 50, y, { align: 'right', width: W });
    y += 16;
    doc.font('Helvetica').fontSize(9).fillColor(MID_GREY);
    if (bizAddr)  { doc.text(bizAddr,  50, y, { align: 'right', width: W }); y += 12; }
    if (bizPhone) { doc.text(bizPhone, 50, y, { align: 'right', width: W }); y += 12; }
    if (bizEmail) { doc.text(bizEmail, 50, y, { align: 'right', width: W }); y += 12; }
    if (profile?.vat_number) {
      doc.text(`VAT: ${profile.vat_number}`, 50, y, { align: 'right', width: W }); y += 12;
    }

    // Reset y to below logo/header block
    y = Math.max(y, 50 + logoSize) + 20;

    // Divider
    doc.moveTo(50, y).lineTo(50 + W, y).lineWidth(1).strokeColor(RULE_GREY).stroke();
    y += 15;

    // "ESTIMATE" title
    doc.font('Helvetica-Bold').fontSize(24).fillColor(CHARCOAL)
      .text('ESTIMATE', 50, y);
    y += 32;

    // Ref / dates
    doc.font('Helvetica').fontSize(9).fillColor(MID_GREY);
    doc.text(`Reference: ${estRef_}`, 50, y);
    y += 13;
    doc.text(`Issued: ${fmtDate(issuedDate)}`, 50, y);
    y += 13;
    doc.text(`Valid until: ${fmtDate(validDate)}`, 50, y);
    y += 20;

    // ── PREPARED FOR ───────────────────────────────────────────────────────
    doc.rect(50, y, W, customer_email ? 38 : 26).fillColor(LIGHT_GREY).fill();
    doc.font('Helvetica-Bold').fontSize(9).fillColor(MID_GREY)
      .text('PREPARED FOR', 58, y + 7);
    doc.font('Helvetica').fontSize(11).fillColor(CHARCOAL)
      .text(customer_name, 58, y + 18);
    if (customer_email) {
      doc.font('Helvetica').fontSize(9).fillColor(MID_GREY)
        .text(customer_email, 58, y + 30);
    }
    y += (customer_email ? 38 : 26) + 18;

    // ── PROJECT OVERVIEW ──────────────────────────────────────────────────
    doc.font('Helvetica-Bold').fontSize(11).fillColor(CHARCOAL)
      .text('Project Overview', 50, y);
    y += 16;
    doc.moveTo(50, y).lineTo(50 + W, y).lineWidth(0.5).strokeColor(RULE_GREY).stroke();
    y += 10;

    doc.font('Helvetica').fontSize(10).fillColor(CHARCOAL)
      .text(project_summary, 50, y, { width: W, lineGap: 3 });
    y = doc.y + 20;

    // ── COST BREAKDOWN ────────────────────────────────────────────────────
    doc.font('Helvetica-Bold').fontSize(11).fillColor(CHARCOAL)
      .text('Cost Breakdown', 50, y);
    y += 16;
    doc.moveTo(50, y).lineTo(50 + W, y).lineWidth(0.5).strokeColor(RULE_GREY).stroke();
    y += 10;

    function tableRow(label: string, amount: number | string, bold = false) {
      const amtStr = typeof amount === 'number' ? fmtGBP(amount) : amount;
      const font = bold ? 'Helvetica-Bold' : 'Helvetica';
      doc.font(font).fontSize(10).fillColor(CHARCOAL)
        .text(label, 50, y, { width: W * 0.7 })
        .text(amtStr, 50 + W * 0.7, y, { width: W * 0.3, align: 'right' });
      y += 15;
    }

    function divider() {
      doc.moveTo(50, y).lineTo(50 + W, y).lineWidth(0.5).strokeColor(RULE_GREY).stroke();
      y += 8;
    }

    if (breakdown) {
      if (breakdown.product_supply) tableRow('Product supply', breakdown.product_supply);
      if (breakdown.manufacture) tableRow('Manufacture', breakdown.manufacture);
      if (breakdown.design_fee) tableRow('Design fee', breakdown.design_fee);
      if (breakdown.accessories?.length) {
        breakdown.accessories.forEach((a) => tableRow(`  ${a.name}`, a.amount));
      }
      if (breakdown.installation) tableRow('Installation', breakdown.installation);

      divider();
      if (breakdown.subtotal) tableRow('Subtotal', breakdown.subtotal);
      if (breakdown.contingency) tableRow('Contingency (5%)', breakdown.contingency);
    }

    // Estimate range
    y += 4;
    divider();
    doc.rect(50, y, W, 28).fillColor(CHARCOAL).fill();
    doc.font('Helvetica-Bold').fontSize(11).fillColor('#ffffff')
      .text('ESTIMATE RANGE (ex. VAT)', 58, y + 8, { width: W * 0.6 })
      .text(`${fmtGBP(price_low)} – ${fmtGBP(price_high)}`, 58, y + 8, { width: W - 16, align: 'right' });
    y += 36;

    doc.font('Helvetica').fontSize(9).fillColor(MID_GREY)
      .text('VAT at 20% will be added to the final invoice.', 50, y);
    y += 20;

    // ── FOOTER ─────────────────────────────────────────────────────────────
    const footerText = profile?.estimate_footer_text ??
      'This is a budgetary estimate based on information provided. Final price subject to site survey and full specification. Estimate valid for 30 days.';

    doc.moveTo(50, y).lineTo(50 + W, y).lineWidth(0.5).strokeColor(RULE_GREY).stroke();
    y += 10;
    doc.font('Helvetica').fontSize(8).fillColor(MID_GREY)
      .text(footerText, 50, y, { width: W, lineGap: 2 });
    y = doc.y + 10;

    if (profile?.terms_and_conditions) {
      doc.font('Helvetica-Bold').fontSize(8).fillColor(MID_GREY)
        .text('Terms & Conditions', 50, y);
      y += 12;
      doc.font('Helvetica').fontSize(7.5).fillColor(MID_GREY)
        .text(profile.terms_and_conditions, 50, y, { width: W, lineGap: 2 });
    }

    doc.end();
  });
}

export async function POST(req: NextRequest) {
  try {
    const body: PdfRequestBody = await req.json();

    if (!body.tenant_id || !body.customer_name || !body.project_summary) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
    }

    const pdfBuffer = await buildPdf(body);

    const estRef_ = `EST-${new Date().getFullYear()}-${Math.floor(1000 + Math.random() * 9000)}`;
    const storagePath = `${body.tenant_id}/${estRef_}.pdf`;

    const supabase = createAdminClient();
    const { error: uploadError } = await supabase.storage
      .from('estimate-pdfs')
      .upload(storagePath, pdfBuffer, {
        contentType: 'application/pdf',
        upsert: false,
      });

    if (uploadError) {
      console.error('[estimates/pdf] upload error:', uploadError);
      // Still return the PDF as a direct download if storage fails
      return new NextResponse(pdfBuffer as unknown as BodyInit, {
        headers: {
          'Content-Type': 'application/pdf',
          'Content-Disposition': `attachment; filename="${estRef_}.pdf"`,
        },
      });
    }

    const { data: publicUrl } = supabase.storage
      .from('estimate-pdfs')
      .getPublicUrl(storagePath);

    return NextResponse.json({
      ok: true,
      url: publicUrl.publicUrl,
      ref: estRef_,
    });
  } catch (err) {
    console.error('[estimates/pdf] PDF generation error:', err);
    return NextResponse.json({ error: (err as Error).message || 'PDF generation failed' }, { status: 500 });
  }
}
