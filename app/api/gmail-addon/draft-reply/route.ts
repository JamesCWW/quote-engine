import Anthropic from '@anthropic-ai/sdk';
import { NextRequest, NextResponse } from 'next/server';

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

function validateApiKey(req: NextRequest): boolean {
  const authHeader = req.headers.get('authorization');
  if (!authHeader?.startsWith('Bearer ')) return false;
  return authHeader.slice(7) === process.env.GMAIL_ADDON_API_KEY;
}

const TONE_INSTRUCTIONS: Record<string, string> = {
  formal: `Write in a formal, professional business letter style. Use full sentences, formal salutations, and structured paragraphs. Keep it polished and corporate in tone.`,
  friendly: `Write in a warm, conversational tone. Be personable and approachable — like a knowledgeable friend who also happens to be an expert. Use natural language while remaining professional.`,
  quick: `Write an extremely brief reply: 2-3 short sentences maximum. Lead with the price range immediately, add one sentence about next steps. No pleasantries beyond a single opener. Skip the site visit boilerplate.`,
};

export async function POST(req: NextRequest) {
  if (!validateApiKey(req)) {
    return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });
  }

  const body = await req.json();
  const {
    email_subject,
    email_body,
    email_context,
    price_low,
    price_high,
    product_type,
    material,
    tone = 'friendly',
    quote_mode,
    missing_info,
    components,
  } = body as {
    email_subject: string;
    email_body: string;
    email_context?: string;
    price_low: number;
    price_high: number;
    product_type: string;
    material: string;
    tone?: 'formal' | 'friendly' | 'quick';
    quote_mode?: string;
    missing_info?: string[];
    components?: Array<{ name: string; subtotal_low: number; subtotal_high: number }>;
  };

  if (!email_body || !price_low || !price_high) {
    return NextResponse.json(
      { error: 'email_body, price_low and price_high are required' },
      { status: 400 }
    );
  }

  const toneInstruction = TONE_INSTRUCTIONS[tone] ?? TONE_INSTRUCTIONS.friendly;

  const isQuick = tone === 'quick';
  const isRough = quote_mode === 'rough';
  const isMixed = components && components.length > 1;

  const questionsList =
    missing_info && missing_info.length > 0
      ? missing_info.map((q) => `- ${q}`).join('\n')
      : '- Overall dimensions (width × height)\n- Manual or electric?\n- Installation requirements';

  const componentBreakdown = isMixed
    ? components!.map((c) =>
        `${c.name}: £${c.subtotal_low.toLocaleString()} – £${c.subtotal_high.toLocaleString()} + VAT`
      ).join('\n')
    : '';

  const prompt = `You are writing a reply on behalf of Helions Forge, a bespoke metalwork manufacturer based in the UK. Use UK English spelling.

TONE: ${toneInstruction}

${
  isQuick
    ? `Write a brief 2-3 sentence reply that:
- Gives the price range: "${isRough ? `As a rough ballpark, this type of project typically ranges from £${price_low.toLocaleString()} to £${price_high.toLocaleString()} + VAT` : `Based on your enquiry, we estimate £${price_low.toLocaleString()} – £${price_high.toLocaleString()} + VAT`}"
- States the next step (site visit or call)
- Sign off: "Kind regards, The Helions Forge Team"`
    : isRough
    ? `Write a concise reply using this structure:
1. Brief thank you for their enquiry
2. Include verbatim: "As a rough ballpark figure, this type of project typically ranges from £${price_low.toLocaleString()} to £${price_high.toLocaleString()} + VAT, depending on specification, complexity and installation requirements."
3. A short paragraph starting with "To provide you with a more accurate estimate, it would be helpful to know:" followed by these questions:
${questionsList}
4. Include verbatim: "We'd be happy to arrange a free site visit if that would be easier."
5. Sign off: "Kind regards,\\nThe Helions Forge Team"
Keep it to 3-4 short paragraphs. Questions may be listed.`
    : isMixed
    ? `Write a concise reply for a MIXED enquiry (multiple product types) using this structure:
1. Brief thank you for their detailed enquiry
2. A sentence confirming you have reviewed their requirements for ${product_type}
3. A section headed "ESTIMATE BREAKDOWN" showing each component on a separate line:
${componentBreakdown}
TOTAL ESTIMATE: £${price_low.toLocaleString()} – £${price_high.toLocaleString()} + VAT
4. A note that the gates price includes supply, posts, automation and installation. For the fencing, note that you can offer steel railings to complement the gates or timber feather edge — and ask which they would prefer if not already specified.
5. Include verbatim: "These estimates are subject to a site survey and final specification. We would be happy to arrange a free site visit to provide a fixed quotation."
6. Sign off: "Kind regards,\\nThe Helions Forge Team"
Keep it professional, to 4-5 short paragraphs.`
    : `Write a concise reply that:
- Thanks the customer briefly for their enquiry
- Confirms what they asked about (${product_type}${material ? `, ${material}` : ''})
- States the price range: "Based on the information provided, we estimate this project would be in the region of £${price_low.toLocaleString()} – £${price_high.toLocaleString()} + VAT"
- Includes verbatim: "This estimate is subject to a site survey and final specification. We would be happy to arrange a free site visit to provide a fixed quotation."
- Sign off: "Kind regards,\\nThe Helions Forge Team"
- Keep it to 3-4 short paragraphs, no bullet points in the body`
}

${email_context ? `Customer email thread (use for tone, greeting and customer name):
${email_context.slice(0, 1000)}

Job description used for pricing:
${email_body.slice(0, 1000)}` : `Customer enquiry:
${email_body.slice(0, 1500)}`}

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
