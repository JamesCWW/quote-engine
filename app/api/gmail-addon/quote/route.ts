import Anthropic from '@anthropic-ai/sdk';
import { NextRequest, NextResponse } from 'next/server';
import { findSimilarQuotes } from '@/lib/ai/rag';
import { QUOTE_GENERATOR_PROMPT } from '@/lib/ai/prompts';
import { buildPricingContext } from '@/lib/ai/pricing';

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
  const {
    email_subject,
    email_body,
    tenant_id,
    complexity_multiplier = 1.0,
    assumptions,
  } = body as {
    email_subject: string;
    email_body: string;
    tenant_id: string;
    complexity_multiplier?: number;
    assumptions?: Array<{ label: string; value: string }>;
  };

  if (!email_body || !tenant_id) {
    return NextResponse.json({ error: 'email_body and tenant_id are required' }, { status: 400 });
  }

  const enquiry_text = email_subject ? `Subject: ${email_subject}\n\n${email_body}` : email_body;

  const [similarQuotes, pricingResult] = await Promise.all([
    findSimilarQuotes(enquiry_text, tenant_id, 3),
    buildPricingContext(enquiry_text, tenant_id, complexity_multiplier).catch((err) => {
      console.error('Pricing context failed (non-fatal):', err);
      return { context: '', minimumValue: null };
    }),
  ]);

  const pricingSection = pricingResult.context ? `\n\n${pricingResult.context}` : '';

  const similarContext =
    similarQuotes.length > 0
      ? `\n\nSimilar historical jobs:\n${similarQuotes
          .map(
            (q, i) =>
              `Job ${i + 1} (similarity: ${(q.similarity * 100).toFixed(0)}%${q.is_golden ? ', WON' : ''}):
- Type: ${q.product_type ?? 'Unknown'}
- Material: ${q.material ?? 'Unknown'}
- Description: ${q.description}
- Price range: £${q.price_low ?? '?'} – £${q.price_high ?? '?'}
- Final price: ${q.final_price ? `£${q.final_price}` : 'Not recorded'}`
          )
          .join('\n\n')}`
      : '\n\nNo similar historical jobs found — estimate from first principles.';

  const assumptionsSection =
    assumptions && assumptions.length > 0
      ? `\n\nConfirmed facts (treat as certain — do not mark as missing info):\n${assumptions
          .map((a) => `- ${a.label}: ${a.value}`)
          .join('\n')}`
      : '';

  const message = await anthropic.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 1024,
    messages: [
      {
        role: 'user',
        content: `${QUOTE_GENERATOR_PROMPT}${pricingSection}\n\nNew enquiry:\n${enquiry_text}${assumptionsSection}${similarContext}\n\nReturn only valid JSON.`,
      },
    ],
  });

  const content = message.content[0];
  if (content.type !== 'text') {
    return NextResponse.json({ error: 'Unexpected AI response' }, { status: 500 });
  }

  let aiResult: {
    price_low: number;
    price_high: number;
    confidence: 'low' | 'medium' | 'high';
    reasoning: string;
    missing_info: string[];
    product_type: string;
    material: string;
  };

  try {
    const jsonText = content.text
      .replace(/^```(?:json)?\n?/, '')
      .replace(/\n?```$/, '')
      .trim();
    aiResult = JSON.parse(jsonText);
  } catch {
    return NextResponse.json(
      { error: 'Failed to parse AI response', raw: content.text },
      { status: 500 }
    );
  }

  const minimumValue = pricingResult.minimumValue;
  if (minimumValue && aiResult.price_low < minimumValue) {
    aiResult.price_low = minimumValue;
    aiResult.price_high = Math.round(minimumValue * 1.25);
    aiResult.reasoning += ` Note: Minimum job value of £${minimumValue.toLocaleString()} applied.`;
  }

  return NextResponse.json({
    price_low: aiResult.price_low,
    price_high: aiResult.price_high,
    confidence: aiResult.confidence,
    reasoning: aiResult.reasoning,
    missing_info: aiResult.missing_info ?? [],
    product_type: aiResult.product_type,
    material: aiResult.material,
    similar_quote_ids: similarQuotes.map((q) => q.id),
  });
}
