import { NextRequest, NextResponse } from 'next/server';
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import { createAdminClient } from '@/lib/supabase/admin';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function pad2(n: number) { return String(n).padStart(2, '0'); }

function estRef() {
  const y = new Date().getFullYear();
  const r = Math.floor(1000 + Math.random() * 9000);
  return `EST-${y}-${r}`;
}

function fmtGBP(n: number) {
  return '£' + Number(n).toLocaleString('en-GB', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  });
}

function fmtDate(d: Date) {
  return `${pad2(d.getDate())}/${pad2(d.getMonth() + 1)}/${d.getFullYear()}`;
}

// pdf-lib uses bottom-left origin; helpers convert from top-left coords
// used in the drawing helpers below (pageH is closed-over per page).

// ---------------------------------------------------------------------------
// PDF builder
// ---------------------------------------------------------------------------

async function buildPdf(body: PdfRequestBody): Promise<Uint8Array> {
  const {
    customer_name,
    customer_email,
    project_summary,
    price_low,
    price_high,
    breakdown,
    valid_days = 30,
  } = body;

  // Fetch tenant profile
  const supabase = createAdminClient();
  const { data: profile } = await supabase
    .from('tenant_profile')
    .select('*')
    .eq('tenant_id', body.tenant_id)
    .single();

  const ref = estRef();
  const issuedDate = new Date();
  const validDate = new Date(issuedDate);
  validDate.setDate(validDate.getDate() + valid_days);

  // Create document
  const pdfDoc = await PDFDocument.create();
  const page = pdfDoc.addPage([595.28, 841.89]); // A4
  const { width: W, height: H } = page.getSize();

  const fontReg  = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const fontBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

  // Colours (pdf-lib uses 0-1 range)
  const cCharcoal  = rgb(0.102, 0.102, 0.102); // #1a1a1a
  const cMidGrey   = rgb(0.420, 0.447, 0.502); // #6b7280
  const cLightGrey = rgb(0.953, 0.957, 0.965); // #f3f4f6
  const cRuleGrey  = rgb(0.820, 0.835, 0.859); // #d1d5db
  const cWhite     = rgb(1, 1, 1);

  const ML = 50;           // left margin
  const MR = 50;           // right margin
  const PW = W - ML - MR; // printable width

  // pdf-lib y=0 is bottom; we track a "cursor" in top-left coordinates
  // (distance from the top of the page). drawText/drawRect/drawHRule all
  // convert to pdf-lib coords via  y = H - topY - size.
  let cursor = 50; // start 50pt from top

  // Convert top-left y to pdf-lib bottom-left y
  const py = (topY: number) => topY;

  // Draw text at top-left coordinate, returns the line height used
  function drawText(
    text: string,
    x: number,
    topY: number,
    opts: {
      font?: typeof fontReg;
      size?: number;
      color?: ReturnType<typeof rgb>;
      maxWidth?: number;
      align?: 'left' | 'right' | 'center';
    } = {}
  ) {
    const font  = opts.font  ?? fontReg;
    const size  = opts.size  ?? 10;
    const color = opts.color ?? cCharcoal;
    const maxWidth = opts.maxWidth ?? PW;

    // Wrap text if needed
    const words = text.split(' ');
    const lines: string[] = [];
    let current = '';
    for (const word of words) {
      const test = current ? current + ' ' + word : word;
      if (font.widthOfTextAtSize(test, size) <= maxWidth) {
        current = test;
      } else {
        if (current) lines.push(current);
        current = word;
      }
    }
    if (current) lines.push(current);

    const lineH = size * 1.35;
    for (const line of lines) {
      let drawX = x;
      const lineWidth = font.widthOfTextAtSize(line, size);
      if (opts.align === 'right') drawX = x + maxWidth - lineWidth;
      else if (opts.align === 'center') drawX = x + (maxWidth - lineWidth) / 2;

      page.drawText(line, {
        x: drawX,
        y: H - topY - size,
        font,
        size,
        color,
      });
      topY += lineH;
    }
    return lineH * lines.length;
  }

  function drawHRule(topY: number) {
    page.drawLine({
      start: { x: ML, y: H - topY },
      end:   { x: ML + PW, y: H - topY },
      thickness: 0.5,
      color: cRuleGrey,
    });
  }

  function drawRect(
    x: number, topY: number, w: number, h: number,
    fillColor: ReturnType<typeof rgb>
  ) {
    page.drawRectangle({
      x, y: H - topY - h, width: w, height: h,
      color: fillColor,
    });
  }

  // ── HEADER ──────────────────────────────────────────────────────────────────

  // Logo (left side)
  const logoSize = 70;
  if (profile?.logo_url) {
    try {
      const res = await fetch(profile.logo_url);
      if (res.ok) {
        const buf = await res.arrayBuffer();
        const ct  = res.headers.get('content-type') ?? '';
        let img;
        if (ct.includes('png') || profile.logo_url.endsWith('.png')) {
          img = await pdfDoc.embedPng(buf);
        } else {
          img = await pdfDoc.embedJpg(buf);
        }
        const dims = img.scaleToFit(logoSize, logoSize);
        page.drawImage(img, { x: ML, y: H - cursor - dims.height, ...dims });
      }
    } catch { /* skip logo on error */ }
  }

  // Business info (right-aligned)
  const bizName  = profile?.business_name ?? 'Your Business';
  const bizAddr  = (profile?.address ?? '').replace(/\n/g, ', ');
  const bizPhone = profile?.phone ?? '';
  const bizEmail = profile?.email ?? '';

  let rightY = cursor;
  drawText(bizName, ML, rightY, {
    font: fontBold, size: 13, color: cCharcoal,
    maxWidth: PW, align: 'right',
  });
  rightY += 18;

  if (bizAddr) {
    drawText(bizAddr, ML, rightY, { size: 9, color: cMidGrey, maxWidth: PW, align: 'right' });
    rightY += 13;
  }
  if (bizPhone) {
    drawText(bizPhone, ML, rightY, { size: 9, color: cMidGrey, maxWidth: PW, align: 'right' });
    rightY += 13;
  }
  if (bizEmail) {
    drawText(bizEmail, ML, rightY, { size: 9, color: cMidGrey, maxWidth: PW, align: 'right' });
    rightY += 13;
  }
  if (profile?.vat_number) {
    drawText(`VAT: ${profile.vat_number}`, ML, rightY, {
      size: 9, color: cMidGrey, maxWidth: PW, align: 'right',
    });
    rightY += 13;
  }

  cursor = Math.max(rightY, cursor + logoSize) + 20;

  // Divider
  drawHRule(cursor);
  cursor += 15;

  // ── ESTIMATE TITLE ───────────────────────────────────────────────────────────

  page.drawText('ESTIMATE', {
    x: ML, y: H - cursor - 24,
    font: fontBold, size: 24, color: cCharcoal,
  });
  cursor += 36;

  // Ref / dates
  drawText(`Reference: ${ref}`, ML, cursor, { size: 9, color: cMidGrey });
  cursor += 13;
  drawText(`Issued: ${fmtDate(issuedDate)}`, ML, cursor, { size: 9, color: cMidGrey });
  cursor += 13;
  drawText(`Valid until: ${fmtDate(validDate)}`, ML, cursor, { size: 9, color: cMidGrey });
  cursor += 22;

  // ── PREPARED FOR ─────────────────────────────────────────────────────────────

  const preparedH = customer_email ? 42 : 30;
  drawRect(ML, cursor, PW, preparedH, cLightGrey);

  drawText('PREPARED FOR', ML + 8, cursor + 7, {
    font: fontBold, size: 9, color: cMidGrey,
  });
  drawText(customer_name, ML + 8, cursor + 18, {
    font: fontBold, size: 11, color: cCharcoal,
  });
  if (customer_email) {
    drawText(customer_email, ML + 8, cursor + 31, { size: 9, color: cMidGrey });
  }
  cursor += preparedH + 18;

  // ── PROJECT OVERVIEW ──────────────────────────────────────────────────────────

  drawText('Project Overview', ML, cursor, { font: fontBold, size: 11, color: cCharcoal });
  cursor += 16;
  drawHRule(cursor);
  cursor += 10;

  // Wrap summary text manually
  const summaryLines = wrapText(project_summary, fontReg, 10, PW);
  for (const line of summaryLines) {
    page.drawText(line, { x: ML, y: H - cursor - 10, font: fontReg, size: 10, color: cCharcoal });
    cursor += 14;
  }
  cursor += 10;

  // ── COST BREAKDOWN ────────────────────────────────────────────────────────────

  drawText('Cost Breakdown', ML, cursor, { font: fontBold, size: 11, color: cCharcoal });
  cursor += 16;
  drawHRule(cursor);
  cursor += 10;

  function tableRow(label: string, amount: number | string, bold = false) {
    const font_ = bold ? fontBold : fontReg;
    const amtStr = typeof amount === 'number' ? fmtGBP(amount) : amount;
    page.drawText(label, { x: ML, y: H - cursor - 10, font: font_, size: 10, color: cCharcoal });
    const amtW = font_.widthOfTextAtSize(amtStr, 10);
    page.drawText(amtStr, { x: ML + PW - amtW, y: H - cursor - 10, font: font_, size: 10, color: cCharcoal });
    cursor += 16;
  }

  if (breakdown) {
    if (breakdown.product_supply) tableRow('Product supply', breakdown.product_supply);
    if (breakdown.manufacture)    tableRow('Manufacture', breakdown.manufacture);
    // design_fee is intentionally excluded from the customer-facing PDF
    if (breakdown.accessories?.length) {
      breakdown.accessories.forEach((a) => tableRow(`  ${a.name}`, a.amount));
    }
    if (breakdown.installation)   tableRow('Installation', breakdown.installation);
    cursor += 4;
    drawHRule(cursor);
    cursor += 8;
    if (breakdown.subtotal)    tableRow('Subtotal', breakdown.subtotal);
    if (breakdown.contingency) tableRow('Contingency (5%)', breakdown.contingency);
  }

  // ── ESTIMATE RANGE ────────────────────────────────────────────────────────────

  cursor += 4;
  drawHRule(cursor);
  cursor += 4;

  const rangeLabel = 'ESTIMATE RANGE (ex. VAT)';
  const rangeValue = `${fmtGBP(price_low)} – ${fmtGBP(price_high)}`;
  const rangeH = 30;

  drawRect(ML, cursor, PW, rangeH, cCharcoal);

  page.drawText(rangeLabel, {
    x: ML + 8, y: H - cursor - 20,
    font: fontBold, size: 11, color: cWhite,
  });
  const rangeValW = fontBold.widthOfTextAtSize(rangeValue, 11);
  page.drawText(rangeValue, {
    x: ML + PW - rangeValW - 8, y: H - cursor - 20,
    font: fontBold, size: 11, color: cWhite,
  });
  cursor += rangeH + 10;

  drawText('VAT at 20% will be added to the final invoice.', ML, cursor, {
    size: 9, color: cMidGrey,
  });
  cursor += 20;

  // ── FOOTER ───────────────────────────────────────────────────────────────────

  const footerText = profile?.estimate_footer_text ??
    'This is a budgetary estimate based on information provided. Final price subject to site survey and full specification. Estimate valid for 30 days.';

  drawHRule(cursor);
  cursor += 10;

  const footerLines = wrapText(footerText, fontReg, 8, PW);
  for (const line of footerLines) {
    page.drawText(line, { x: ML, y: H - cursor - 8, font: fontReg, size: 8, color: cMidGrey });
    cursor += 11;
  }
  cursor += 6;

  if (profile?.terms_and_conditions) {
    drawText('Terms & Conditions', ML, cursor, { font: fontBold, size: 8, color: cMidGrey });
    cursor += 12;

    const tcLines = wrapText(profile.terms_and_conditions, fontReg, 7.5, PW);
    for (const line of tcLines) {
      page.drawText(line, { x: ML, y: H - cursor - 7.5, font: fontReg, size: 7.5, color: cMidGrey });
      cursor += 10;
      if (cursor > H - 30) break; // safety: don't overflow page
    }
  }

  void py;

  return pdfDoc.save();
}

// ---------------------------------------------------------------------------
// Text wrapping utility
// ---------------------------------------------------------------------------

function wrapText(
  text: string,
  font: Awaited<ReturnType<PDFDocument['embedFont']>>,
  size: number,
  maxWidth: number
): string[] {
  const lines: string[] = [];
  for (const paragraph of text.split('\n')) {
    const words = paragraph.split(' ');
    let current = '';
    for (const word of words) {
      const test = current ? current + ' ' + word : word;
      if (font.widthOfTextAtSize(test, size) <= maxWidth) {
        current = test;
      } else {
        if (current) lines.push(current);
        current = word;
      }
    }
    if (current) lines.push(current);
  }
  return lines;
}

// ---------------------------------------------------------------------------
// Route handler
// ---------------------------------------------------------------------------

export async function POST(req: NextRequest) {
  try {
    const body: PdfRequestBody = await req.json();

    if (!body.tenant_id || !body.customer_name || !body.project_summary) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
    }

    console.log('[estimates/pdf] generating PDF', {
      tenant_id:       body.tenant_id,
      customer_name:   body.customer_name,
      customer_email:  body.customer_email ?? null,
      price_low:       body.price_low,
      price_high:      body.price_high,
      has_breakdown:   !!body.breakdown,
      has_components:  Array.isArray(body.components) ? body.components.length : 0,
      summary_length:  body.project_summary?.length ?? 0,
      valid_days:      body.valid_days ?? 30,
    });

    const pdfBytes = await buildPdf(body);

    const ref = `EST-${new Date().getFullYear()}-${Math.floor(1000 + Math.random() * 9000)}`;
    const storagePath = `${body.tenant_id}/${ref}.pdf`;

    const supabase = createAdminClient();
    const { error: uploadError } = await supabase.storage
      .from('estimate-pdfs')
      .upload(storagePath, pdfBytes, {
        contentType: 'application/pdf',
        upsert: false,
      });

    if (uploadError) {
      console.error('[estimates/pdf] upload error:', uploadError);
      // Return the PDF as a direct download if storage fails
      return new NextResponse(pdfBytes as unknown as BodyInit, {
        headers: {
          'Content-Type': 'application/pdf',
          'Content-Disposition': `attachment; filename="${ref}.pdf"`,
        },
      });
    }

    const { data: publicUrl } = supabase.storage
      .from('estimate-pdfs')
      .getPublicUrl(storagePath);

    return NextResponse.json({ ok: true, url: publicUrl.publicUrl, ref });
  } catch (err) {
    console.error('[estimates/pdf] PDF generation error:', err);
    return NextResponse.json(
      { error: (err as Error).message || 'PDF generation failed' },
      { status: 500 }
    );
  }
}
