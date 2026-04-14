import Anthropic from '@anthropic-ai/sdk';
import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@clerk/nextjs/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { getTenantId } from '@/lib/tenant';

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

interface Assumption {
  label: string;
  value: string;
}

function buildDraftPrompt(
  enquiryText: string,
  productType: string,
  material: string,
  priceLow: number,
  priceHigh: number,
  assumptions: Assumption[],
  originalSubject: string,
  quoteMode?: string,
  missingInfo?: string[]
): string {
  const subjectLine = `Re: ${originalSubject || 'Your metalwork enquiry'}`;

  if (quoteMode === 'rough') {
    const questionsList =
      missingInfo && missingInfo.length > 0
        ? missingInfo.map((q) => `- ${q}`).join('\n')
        : '- Overall dimensions (width × height)\n- Manual or electric?\n- Installation requirements';

    return `You are writing a professional email reply on behalf of Helions Forge, a bespoke metalwork manufacturer based in the UK. Use UK English spelling.

Write a concise, friendly reply using this exact structure:
1. Brief thank you for their enquiry
2. Include this sentence verbatim: "As a rough ballpark figure, this type of project typically ranges from £${priceLow.toLocaleString()} to £${priceHigh.toLocaleString()} + VAT, depending on specification, complexity and installation requirements."
3. A short paragraph starting with "To provide you with a more accurate estimate, it would be helpful to know:" followed by these questions (as a short list):
${questionsList}
4. Include this sentence verbatim: "We'd be happy to arrange a free site visit if that would be easier."
5. Sign off: "Kind regards,\\nThe Helions Forge Team"

Keep it to 3–4 short paragraphs. No bullet points in the body prose, but the questions may be listed.

Customer enquiry:
${enquiryText.slice(0, 1500)}

Return ONLY a JSON object with exactly two fields:
{
  "subject": "${subjectLine}",
  "body": "the full email body text"
}`;
  }

  const assumptionLines =
    assumptions.length > 0
      ? `\n\nFor the purposes of this estimate we have assumed the following:\n${assumptions.map((a) => `- ${a.label}: ${a.value}`).join('\n')}`
      : '';

  return `You are writing a professional email reply on behalf of Helions Forge, a bespoke metalwork manufacturer based in the UK.

Write a concise, professional, friendly reply to this customer enquiry. Use UK English spelling.

Rules:
- Thank the customer briefly for their enquiry
- Confirm what they asked about (${productType}${material ? `, ${material}` : ''})
- State the price range clearly: "Based on the information provided, we estimate this project would be in the region of £${priceLow.toLocaleString()} – £${priceHigh.toLocaleString()} + VAT"${assumptionLines ? `\n- Include this assumptions paragraph verbatim: "For the purposes of this estimate we have assumed the following: ${assumptions.map((a) => `${a.label}: ${a.value}`).join('; ')}"` : ''}
- Include this sentence verbatim: "This estimate is subject to a site survey and final specification. We would be happy to arrange a free site visit to provide a fixed quotation."
- Sign off: "Kind regards,\nThe Helions Forge Team"
- Keep it to 3–4 short paragraphs, no bullet points in the body

Customer enquiry:
${enquiryText.slice(0, 1500)}

Return ONLY a JSON object with exactly two fields:
{
  "subject": "${subjectLine}",
  "body": "the full email body text"
}`;
}

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });

  const tenantId = await getTenantId();
  if (!tenantId) return NextResponse.json({ error: 'Tenant not found' }, { status: 403 });

  const body = await req.json();
  const {
    price_low,
    price_high,
    product_type,
    material,
    assumptions,
    quote_mode,
    missing_info,
  } = body as {
    price_low: number;
    price_high: number;
    product_type: string;
    material: string;
    assumptions: Assumption[];
    quote_mode?: string;
    missing_info?: string[];
  };

  const supabase = createAdminClient();

  const { data: enquiry, error } = await supabase
    .from('enquiries')
    .select('raw_input, extracted_specs')
    .eq('id', params.id)
    .eq('tenant_id', tenantId)
    .single();

  if (error || !enquiry) {
    return NextResponse.json({ error: 'Enquiry not found' }, { status: 404 });
  }

  const specs = enquiry.extracted_specs as Record<string, string> | null;
  const originalSubject = specs?.subject ?? '';

  const prompt = buildDraftPrompt(
    enquiry.raw_input ?? '',
    product_type,
    material,
    price_low,
    price_high,
    assumptions,
    originalSubject,
    quote_mode,
    missing_info
  );

  const message = await anthropic.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 1024,
    messages: [{ role: 'user', content: prompt }],
  });

  const content = message.content[0];
  if (content.type !== 'text') {
    return NextResponse.json({ error: 'Unexpected AI response' }, { status: 500 });
  }

  let draft: { subject: string; body: string };
  try {
    const jsonText = content.text
      .replace(/^```(?:json)?\n?/, '')
      .replace(/\n?```$/, '')
      .trim();
    draft = JSON.parse(jsonText);
  } catch {
    return NextResponse.json({ error: 'Failed to parse AI response', raw: content.text }, { status: 500 });
  }

  return NextResponse.json(draft);
}
