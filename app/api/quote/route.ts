import Anthropic from '@anthropic-ai/sdk';
import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@clerk/nextjs/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { findSimilarQuotes, extractSpecsFromImage, type SimilarQuote } from '@/lib/ai/rag';
import { QUOTE_GENERATOR_PROMPT, ROUGH_QUOTE_GENERATOR_PROMPT, detectQuoteMode } from '@/lib/ai/prompts';
import { buildPricingContext } from '@/lib/ai/pricing';
import {
  calculateRailingMaterials,
  calculateRailingLabour,
  buildRailingPromptSection,
  type RailingDims,
  type CostBreakdown,
} from '@/lib/ai/material-takeoff';

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

function isRailingProduct(productType: string | undefined, enquiryText: string): boolean {
  const text = `${productType ?? ''} ${enquiryText}`.toLowerCase();
  return /railing|balustrade/.test(text);
}

export async function POST(req: NextRequest) {
  try {
  console.log('Step 1: Auth check');
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });

  console.log('Step 2: Parsing request body');
  const body = await req.json();
  console.log('Body received:', JSON.stringify(body));
  const { enquiry_text, image_urls, tenant_id, enquiry_id, assumptions, railing_dims } = body as {
    enquiry_text: string;
    image_urls?: string[];
    tenant_id: string;
    enquiry_id?: string;
    assumptions?: Array<{ label: string; value: string }>;
    railing_dims?: RailingDims;
  };

  if (!enquiry_text || !tenant_id) {
    return NextResponse.json({ error: 'enquiry_text and tenant_id are required' }, { status: 400 });
  }

  console.log('Step 3: Creating Supabase client');
  const supabase = createAdminClient();

  // 1. Save the incoming enquiry (or reuse an existing one)
  let enquiryId: string;

  console.log('Step 4: Saving/reusing enquiry');
  if (enquiry_id) {
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
      console.error('Enquiry insert error:', enquiryError);
      return NextResponse.json({ error: enquiryError.message }, { status: 500 });
    }
    enquiryId = enquiry.id;
  }
  console.log('Enquiry ID:', enquiryId);

  // 2. Extract specs from image if present
  console.log('Step 5: Image extraction (if applicable)');
  let imageContext = '';
  if (image_urls && image_urls.length > 0) {
    try {
      const specs = await extractSpecsFromImage(image_urls[0]);
      if (specs) imageContext = `\n\nPhoto analysis: ${specs}`;
    } catch (err) {
      console.error('Vision extraction failed:', err);
    }
  }

  const fullEnquiryText = enquiry_text + imageContext;

  const quoteMode = detectQuoteMode(fullEnquiryText, assumptions);

  // Detect if this is a railing job with full dimensions for material takeoff
  const productTypeAssumption = assumptions?.find((a) =>
    /product.?type/i.test(a.label)
  )?.value;
  const hasRailingDims =
    railing_dims &&
    railing_dims.total_length_m > 0 &&
    railing_dims.height_m > 0 &&
    isRailingProduct(productTypeAssumption, fullEnquiryText);

  // 3. RAG + pricing + material takeoff in parallel
  console.log('Step 6: Fetching RAG + pricing + material takeoff');
  const [similarQuotes, pricingResult, masterRates, railingCalc] = await Promise.all([
    findSimilarQuotes(fullEnquiryText, tenant_id, 3).catch((err) => {
      console.error('RAG findSimilarQuotes failed (non-fatal):', err);
      return [] as SimilarQuote[];
    }),
    quoteMode === 'precise' && !hasRailingDims
      ? buildPricingContext(fullEnquiryText, tenant_id).catch((err) => {
          console.error('Pricing context failed (non-fatal):', err);
          return { context: '', minimumValue: null };
        })
      : Promise.resolve({ context: '', minimumValue: null }),
    hasRailingDims
      ? Promise.resolve(
          supabase
            .from('master_rates')
            .select('fabrication_day_rate, installation_day_rate')
            .eq('tenant_id', tenant_id)
            .single()
        ).then((r) => r.data).catch(() => null)
      : Promise.resolve(null),
    hasRailingDims
      ? calculateRailingMaterials(railing_dims!, tenant_id).catch((err) => {
          console.error('Material takeoff failed (non-fatal):', err);
          return null;
        })
      : Promise.resolve(null),
  ]);
  console.log('Step 6 complete: similarQuotes count:', (similarQuotes as SimilarQuote[]).length);

  const railingLabour =
    hasRailingDims && railingCalc && masterRates
      ? calculateRailingLabour(
          railing_dims!.total_length_m,
          railing_dims!.design_style,
          masterRates.fabrication_day_rate,
          masterRates.installation_day_rate
        )
      : null;

  // 4. Build pricing section
  let pricingSection = '';
  if (hasRailingDims && railingCalc && railingLabour && masterRates) {
    pricingSection =
      '\n\n' +
      buildRailingPromptSection(
        railingCalc,
        railingLabour,
        masterRates.fabrication_day_rate,
        masterRates.installation_day_rate,
        railing_dims!.finish ?? 'Primer + paint'
      );
  } else if (pricingResult.context) {
    pricingSection = `\n\n${pricingResult.context}`;
  }

  // 5. Build Sonnet context
  const similarContext =
    similarQuotes.length > 0
      ? `\n\nSimilar historical jobs:\n${(similarQuotes as SimilarQuote[])
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

  const assumptionsSection =
    assumptions && assumptions.length > 0
      ? `\n\nConfirmed facts (treat these as certain — do not mark as missing info):\n${assumptions.map((a) => `- ${a.label}: ${a.value}`).join('\n')}`
      : '';

  // 6. Generate quote with Claude Sonnet
  console.log('Step 7: Calling Claude API');
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
    finishing_cost?: number;
    cost_breakdown?: CostBreakdown;
    components?: Array<{ name: string; items: Array<{ label: string; amount: number; note?: string }>; subtotal_low: number; subtotal_high: number }>;
    options?: Array<{ name: string; price_low: number; price_high: number }>;
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

  // 7. Enforce minimum job value
  const minimumValue = pricingResult.minimumValue;
  if (minimumValue && aiResult.price_low < minimumValue) {
    aiResult.price_low = minimumValue;
    aiResult.price_high = Math.round(minimumValue * 1.25);
    aiResult.reasoning +=
      ` Note: This job type has a minimum value of £${minimumValue.toLocaleString()}. Estimate adjusted accordingly.`;
  }

  // Build cost_breakdown if we have railing data
  let costBreakdown: CostBreakdown | undefined = aiResult.cost_breakdown;
  if (!costBreakdown && railingCalc && railingLabour) {
    const finishingCost = aiResult.finishing_cost ?? 0;
    const subtotal =
      railingCalc.total_material_cost +
      railingLabour.manufacture_cost +
      railingLabour.install_cost +
      finishingCost;
    const contingency = Math.round(subtotal * 0.1);
    costBreakdown = {
      material_cost: railingCalc.total_material_cost,
      manufacture_cost: railingLabour.manufacture_cost,
      manufacture_days: railingLabour.manufacture_days,
      install_cost: railingLabour.install_cost,
      install_days: railingLabour.install_days,
      engineers: railingLabour.engineers,
      finishing_cost: finishingCost,
      subtotal,
      contingency,
    };
  }

  // 8. Save to generated_quotes
  const { data: generatedQuote, error: gqError } = await supabase
    .from('generated_quotes')
    .insert({
      tenant_id,
      enquiry_id: enquiryId,
      similar_quote_ids: (similarQuotes as SimilarQuote[]).map((q) => q.id),
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

  console.log('Step complete: returning response');
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
    ...(costBreakdown ? { cost_breakdown: costBreakdown } : {}),
    ...(aiResult.components?.length ? { components: aiResult.components } : {}),
    ...(aiResult.options?.length ? { options: aiResult.options } : {}),
  });
  } catch (error) {
    const err = error as Error;
    console.error('FAILED AT STEP:', err.message);
    console.error('Stack:', err.stack);
    return NextResponse.json({ error: err.message, stack: err.stack }, { status: 500 });
  }
}
