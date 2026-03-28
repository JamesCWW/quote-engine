import Anthropic from '@anthropic-ai/sdk';
import { createAdminClient } from '@/lib/supabase/admin';
import { findSimilarQuotes, extractSpecsFromImage, type SimilarQuote } from '@/lib/ai/rag';
import { QUOTE_GENERATOR_PROMPT, ROUGH_QUOTE_GENERATOR_PROMPT, detectQuoteMode } from '@/lib/ai/prompts';
import { buildPricingContext } from '@/lib/ai/pricing';
import { enforceMinimumPrices } from '@/lib/ai/minimum-prices';
import {
  calculateRailingMaterials,
  calculateRailingLabour,
  buildRailingPromptSection,
  type RailingDims,
  type CostBreakdown,
} from '@/lib/ai/material-takeoff';

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

function isRailingProduct(productType: string | undefined, text: string): boolean {
  return /railing|balustrade/.test(`${productType ?? ''} ${text}`.toLowerCase());
}

export interface JobComponent {
  component: 'gates' | 'railings';
  product_type?: string;
  design?: string | null;
  width_mm?: number | null;
  height_mm?: number | null;
  quantity?: number;
  automation?: 'electric' | 'manual';
  total_length_m?: number | null;
  sections?: Array<{ label: string; length_m: number }>;
  style?: string;
}

export interface QuoteResult {
  price_low: number;
  price_high: number;
  confidence: 'low' | 'medium' | 'high';
  reasoning: string;
  missing_info: string[];
  product_type: string;
  material: string;
  quote_mode: 'precise' | 'rough';
  similar_quotes: SimilarQuote[];
  cost_breakdown?: CostBreakdown;
  components?: Array<{
    name: string;
    items: Array<{ label: string; amount: number; note?: string }>;
    subtotal_low: number;
    subtotal_high: number;
  }>;
  options?: Array<{ name: string; price_low: number; price_high: number }>;
  job_components?: JobComponent[];
}

export async function generateQuote(params: {
  enquiry_text: string;
  tenant_id: string;
  assumptions?: Array<{ label: string; value: string }>;
  complexity_multiplier?: number;
  image_urls?: string[];
  railing_dims?: RailingDims;
}): Promise<QuoteResult> {
  const {
    enquiry_text,
    tenant_id,
    assumptions,
    complexity_multiplier = 1.0,
    image_urls,
    railing_dims,
  } = params;

  const supabase = createAdminClient();

  // Extract specs from image if present
  let imageContext = '';
  if (image_urls && image_urls.length > 0) {
    try {
      const specs = await extractSpecsFromImage(image_urls[0]);
      if (specs) imageContext = `\n\nPhoto analysis: ${specs}`;
    } catch (err) {
      console.error('[quote-engine] Vision extraction failed:', err);
    }
  }

  const fullEnquiryText = enquiry_text + imageContext;
  const quoteMode = detectQuoteMode(fullEnquiryText, assumptions);

  // Detect railing job with full dimensions
  const productTypeAssumption = assumptions?.find((a) => /product.?type/i.test(a.label))?.value;
  const hasRailingDims =
    railing_dims &&
    railing_dims.total_length_m > 0 &&
    railing_dims.height_m > 0 &&
    isRailingProduct(productTypeAssumption, fullEnquiryText);

  // Fetch RAG, pricing, master rates, and material takeoff in parallel
  const [similarQuotes, pricingResult, masterRates, railingCalc] = await Promise.all([
    findSimilarQuotes(fullEnquiryText, tenant_id, 3).catch((err) => {
      console.error('[quote-engine] RAG failed (non-fatal):', err);
      return [] as SimilarQuote[];
    }),
    quoteMode === 'precise' && !hasRailingDims
      ? buildPricingContext(fullEnquiryText, tenant_id, complexity_multiplier).catch((err) => {
          console.error('[quote-engine] Pricing context failed (non-fatal):', err);
          return { context: '', minimumValue: null };
        })
      : Promise.resolve({ context: '', minimumValue: null }),
    (async () => {
      try {
        const { data } = await supabase
          .from('master_rates')
          .select('fabrication_day_rate, installation_day_rate')
          .eq('tenant_id', tenant_id)
          .single();
        return data;
      } catch {
        return null;
      }
    })(),
    hasRailingDims
      ? calculateRailingMaterials(railing_dims!, tenant_id).catch((err) => {
          console.error('[quote-engine] Material takeoff failed (non-fatal):', err);
          return null;
        })
      : Promise.resolve(null),
  ]);

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
      : '\n\nNo similar historical jobs found in database — estimate from first principles.';

  const assumptionsSection =
    assumptions && assumptions.length > 0
      ? `\n\nConfirmed facts (treat these as certain — do not mark as missing info):\n${assumptions.map((a) => `- ${a.label}: ${a.value}`).join('\n')}`
      : '';

  // Call Claude
  const message = await anthropic.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 4000,
    messages: [
      {
        role: 'user',
        content: `${quoteMode === 'precise' ? QUOTE_GENERATOR_PROMPT : ROUGH_QUOTE_GENERATOR_PROMPT}${pricingSection}\n\nNew enquiry:\n${fullEnquiryText}${assumptionsSection}${similarContext}\n\nReturn only valid JSON.`,
      },
    ],
  });

  const content = message.content[0];
  if (content.type !== 'text') {
    throw new Error('Unexpected AI response type');
  }

  const jsonMatch = content.text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    throw new Error(`No JSON found in AI response: ${content.text}`);
  }
  const aiResult: {
    price_low: number;
    price_high: number;
    confidence: 'low' | 'medium' | 'high';
    reasoning: string;
    missing_info: string[];
    product_type: string;
    material: string;
    finishing_cost?: number;
    cost_breakdown?: CostBreakdown;
    components?: Array<{
      name: string;
      items: Array<{ label: string; amount: number; note?: string }>;
      subtotal_low: number;
      subtotal_high: number;
    }>;
    options?: Array<{ name: string; price_low: number; price_high: number }>;
    job_components?: JobComponent[];
  } = JSON.parse(jsonMatch[0]);

  // Enforce minimum prices
  enforceMinimumPrices(aiResult, fullEnquiryText);

  // Build cost_breakdown from railing data if Claude didn't return one
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

  return {
    price_low: aiResult.price_low,
    price_high: aiResult.price_high,
    confidence: aiResult.confidence,
    reasoning: aiResult.reasoning,
    missing_info: aiResult.missing_info ?? [],
    product_type: aiResult.product_type,
    material: aiResult.material,
    quote_mode: quoteMode,
    similar_quotes: similarQuotes as SimilarQuote[],
    ...(costBreakdown ? { cost_breakdown: costBreakdown } : {}),
    ...(aiResult.components?.length ? { components: aiResult.components } : {}),
    ...(aiResult.options?.length ? { options: aiResult.options } : {}),
    ...(aiResult.job_components?.length ? { job_components: aiResult.job_components } : {}),
  };
}
