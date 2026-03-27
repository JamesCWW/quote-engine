import Anthropic from '@anthropic-ai/sdk';
import { NextRequest, NextResponse } from 'next/server';

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

function validateApiKey(req: NextRequest): boolean {
  const authHeader = req.headers.get('authorization');
  if (!authHeader?.startsWith('Bearer ')) return false;
  return authHeader.slice(7) === process.env.GMAIL_ADDON_API_KEY;
}

export async function POST(req: NextRequest) {
  if (!validateApiKey(req)) {
    return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });
  }

  const body = await req.json();
  const { email_subject, email_body, price_low, price_high, product_type, material } = body as {
    email_subject: string;
    email_body: string;
    price_low: number;
    price_high: number;
    product_type: string;
    material: string;
  };

  if (!email_body || !price_low || !price_high) {
    return NextResponse.json(
      { error: 'email_body, price_low and price_high are required' },
      { status: 400 }
    );
  }

  const prompt = `You are writing a professional email reply on behalf of Helions Forge, a bespoke metalwork manufacturer based in the UK.

Write a concise, professional, friendly reply to this customer enquiry. Use UK English spelling.

Rules:
- Thank the customer briefly for their enquiry
- Confirm what they asked about (${product_type}${material ? `, ${material}` : ''})
- State the price range clearly: "Based on the information provided, we estimate this project would be in the region of £${price_low.toLocaleString()} – £${price_high.toLocaleString()} + VAT"
- Include this sentence verbatim: "This estimate is subject to a site survey and final specification. We would be happy to arrange a free site visit to provide a fixed quotation."
- Sign off: "Kind regards,\\nThe Helions Forge Team"
- Keep it to 3–4 short paragraphs, no bullet points in the body

Customer enquiry:
${email_body.slice(0, 1500)}

Return ONLY a JSON object with exactly two fields:
{
  "subject": "Re: ${email_subject || 'Your metalwork enquiry'}",
  "body": "the full email body text"
}`;

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
    return NextResponse.json(
      { error: 'Failed to parse AI response', raw: content.text },
      { status: 500 }
    );
  }

  return NextResponse.json(draft);
}
