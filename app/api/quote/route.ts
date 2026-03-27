import Anthropic from '@anthropic-ai/sdk';
import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@clerk/nextjs/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { findSimilarQuotes, extractSpecsFromImage } from '@/lib/ai/rag';
import { QUOTE_GENERATOR_PROMPT, ROUGH_QUOTE_GENERATOR_PROMPT, detectQuoteMode } from '@/lib/ai/prompts';
import { buildPricingContext } from '@/lib/ai/pricing';

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

export async function POST(req: NextRequest) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });

  const body = await req.json();
  const { enquiry_text, image_urls, tenant_id, enquiry_id, assumptions } = body as {
    enquiry_text: string;
    image_urls?: string[];
    tenant_id: string;
    enquiry_id?: string;
    assumptions?: Array<{ label: string; value: string }>;
  };

  if (!enquiry_text || !tenant_id) {
    return NextResponse.json({ error: 'enquiry_text and tenant_id are required' }, { status: 400 });
  }

  const supabase = createAdminClient();

  // 1. Save the incoming enquiry (or reuse an existing one)
  let enquiryId: string;

  if (enquiry_id) {
    // Reuse existing enquiry (e.g. opened from dashboard detail page)
    enquiryId = enquiry_id;
    await supabase.from('enquiries').update({ status: 'quoting' }).eq('id', enquiry_id);
  } else {
    const { data: enquiry, error: enquiryError } = await supabase
      .from('enquiries')
      .insert({
        tenant_id,
        source: 'manual',
        raw_input: enquiry_text,
        image_urls: image_urls ?? [],
        status: 'quoting',
      })
      .select('id')
      .single();

    if (enquiryError) {
      return NextResponse.json({ error: enquiryError.message }, { status: 500 });
    }
    enquiryId = enquiry.id;
  }

  // 2. Extract specs from image if present
  let imageContext = '';
  if (image_urls && image_urls.length > 0) {
    try {
      const specs = await extractSpecsFromImage(image_urls[0]);
      if (specs) imageContext = `\n\nPhoto analysis: ${specs}`;
    } catch (err) {
      console.error('Vision extraction failed:', err);
      // Non-fatal: continue without image context
    }
  }

  const fullEnquiryText = enquiry_text + imageContext;

  const quoteMode = detectQuoteMode(fullEnquiryText, assumptions);

  // 3. RAG + pricing lookup — pricing only needed for precise mode
  const [similarQuotes, pricingResult] = await Promise.all([
    findSimilarQuotes(fullEnquiryText, tenant_id, 3),
    quoteMode === 'precise'
      ? buildPricingContext(fullEnquiryText, tenant_id).catch((err) => {
          console.error('Pricing context failed (non-fatal):', err);
          return { context: '', minimumValue: null };
        })
      : Promise.resolve({ context: '', minimumValue: null }),
  ]);

  const pricingSection = pricingResult.context ? `\n\n${pricingResult.context}` : '';

  // 4. Build Sonnet context
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
      : '\n\nNo similar historical jobs found in database — estimate from first principles.';

  // 5. Build assumptions context
  const assumptionsSection =
    assumptions && assumptions.length > 0
      ? `\n\nConfirmed facts (treat these as certain — do not mark as missing info):\n${assumptions.map((a) => `- ${a.label}: ${a.value}`).join('\n')}`
      : '';

  // 6. Generate quote with Claude Sonnet
  const message = await anthropic.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 1024,
    messages: [
      {
        role: 'user',
        content: `${quoteMode === 'precise' ? QUOTE_GENERATOR_PROMPT : ROUGH_QUOTE_GENERATOR_PROMPT}${pricingSection}\n\nNew enquiry:\n${fullEnquiryText}${assumptionsSection}${similarContext}\n\nReturn only valid JSON.`,
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

  // 7. Enforce minimum job value if set for this job type
  const minimumValue = pricingResult.minimumValue;
  if (minimumValue && aiResult.price_low < minimumValue) {
    aiResult.price_low = minimumValue;
    aiResult.price_high = Math.round(minimumValue * 1.25);
    aiResult.reasoning +=
      ` Note: This job type has a minimum value of £${minimumValue.toLocaleString()}. Estimate adjusted accordingly.`;
  }

  // 8. Save to generated_quotes
  const { data: generatedQuote, error: gqError } = await supabase
    .from('generated_quotes')
    .insert({
      tenant_id,
      enquiry_id: enquiryId,
      similar_quote_ids: similarQuotes.map((q) => q.id),
      ai_reasoning: aiResult.reasoning,
      price_low: aiResult.price_low,
      price_high: aiResult.price_high,
      confidence: aiResult.confidence,
      assumptions: assumptions && assumptions.length > 0 ? assumptions : null,
      status: 'draft',
    })
    .select('id')
    .single();

  if (gqError) {
    return NextResponse.json({ error: gqError.message }, { status: 500 });
  }

  // Update enquiry with extracted specs
  await supabase
    .from('enquiries')
    .update({
      extracted_specs: {
        product_type: aiResult.product_type,
        material: aiResult.material,
      },
      status: 'quoted',
    })
    .eq('id', enquiryId);

  return NextResponse.json({
    generated_quote_id: generatedQuote.id,
    enquiry_id: enquiryId,
    price_low: aiResult.price_low,
    price_high: aiResult.price_high,
    confidence: aiResult.confidence,
    reasoning: aiResult.reasoning,
    missing_info: aiResult.missing_info ?? [],
    product_type: aiResult.product_type,
    material: aiResult.material,
    similar_quotes: similarQuotes,
    quote_mode: quoteMode,
  });
}
