import Anthropic from '@anthropic-ai/sdk';
import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { findSimilarQuotes, type SimilarQuote } from '@/lib/ai/rag';
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

function validateApiKey(req: NextRequest): boolean {
  const authHeader = req.headers.get('authorization');
  if (!authHeader?.startsWith('Bearer ')) return false;
  return authHeader.slice(7) === process.env.GMAIL_ADDON_API_KEY;
}

function isRailingProduct(productType: string | undefined, emailBody: string): boolean {
  const text = `${productType ?? ''} ${emailBody}`.toLowerCase();
  return /railing|balustrade/.test(text);
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
    railing_dims,
  } = body as {
    email_subject: string;
    email_body: string;
    tenant_id: string;
    complexity_multiplier?: number;
    assumptions?: Array<{ label: string; value: string }>;
    railing_dims?: RailingDims;
  };

  if (!email_body || !tenant_id) {
    return NextResponse.json({ error: 'email_body and tenant_id are required' }, { status: 400 });
  }

  const enquiry_text = email_subject ? `Subject: ${email_subject}\n\n${email_body}` : email_body;

  const quoteMode = detectQuoteMode(enquiry_text, assumptions);

  // Detect if this is a railing job with full dimensions for material takeoff
  const productTypeAssumption = assumptions?.find((a) =>
    /product.?type/i.test(a.label)
  )?.value;
  const hasRailingDims =
    railing_dims &&
    railing_dims.total_length_m > 0 &&
    railing_dims.height_m > 0 &&
    isRailingProduct(productTypeAssumption, email_body);

  // Fetch master rates and run material takeoff in parallel when applicable
  const [similarQuotes, pricingResult, masterRates, railingCalc] = await Promise.all([
    findSimilarQuotes(enquiry_text, tenant_id, 3),
    quoteMode === 'precise' && !hasRailingDims
      ? buildPricingContext(enquiry_text, tenant_id, complexity_multiplier).catch((err) => {
          console.error('Pricing context failed (non-fatal):', err);
          return { context: '', minimumValue: null };
        })
      : Promise.resolve({ context: '', minimumValue: null }),
    hasRailingDims
      ? Promise.resolve(
          createAdminClient()
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

  // Build railing labour once we have master rates and material breakdown
  const railingLabour =
    hasRailingDims && railingCalc && masterRates
      ? calculateRailingLabour(
          railing_dims!.total_length_m,
          railing_dims!.design_style,
          masterRates.fabrication_day_rate,
          masterRates.installation_day_rate
        )
      : null;

  // Build pricing section — railing exact costs take priority over generic pricing context
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
        content: `${quoteMode === 'precise' ? QUOTE_GENERATOR_PROMPT : ROUGH_QUOTE_GENERATOR_PROMPT}${pricingSection}\n\nNew enquiry:\n${enquiry_text}${assumptionsSection}${similarContext}\n\nReturn only valid JSON.`,
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

  // If Claude didn't return cost_breakdown but we have the data, build it server-side
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

  return NextResponse.json({
    price_low: aiResult.price_low,
    price_high: aiResult.price_high,
    confidence: aiResult.confidence,
    reasoning: aiResult.reasoning,
    missing_info: aiResult.missing_info ?? [],
    product_type: aiResult.product_type,
    material: aiResult.material,
    similar_quote_ids: (similarQuotes as SimilarQuote[]).map((q) => q.id),
    quote_mode: quoteMode,
    ...(costBreakdown ? { cost_breakdown: costBreakdown } : {}),
  });
}
