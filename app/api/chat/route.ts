import { anthropic } from '@ai-sdk/anthropic';
import { streamText } from 'ai';
import { createAdminClient } from '@/lib/supabase/admin';
import { findSimilarGoldenQuotes } from '@/lib/ai/rag';
import { buildChatbotSystemPrompt } from '@/lib/ai/prompts';
import { buildPricingContext } from '@/lib/ai/pricing';

export const runtime = 'nodejs';
export const maxDuration = 30;

const HANDOFF_KEYWORDS = [
  'structural',
  'large scale',
  'large-scale',
  '50 metres',
  '50m',
  'commercial',
  'industrial',
];

// Keywords that indicate the customer wants a "traditional iron" look — auto-map to mild steel
const IRON_KEYWORDS = ['wrought iron', 'iron gate', 'iron railing', 'traditional iron', 'cast iron'];
const IRON_LOOSE_KEYWORDS = ['iron', 'traditional'];

function containsHandoffKeyword(text: string): boolean {
  const lower = text.toLowerCase();
  return HANDOFF_KEYWORDS.some((kw) => lower.includes(kw));
}

function detectIronOrTraditional(messages: { role: string; content: string }[]): string {
  const allUserText = messages
    .filter((m) => m.role === 'user')
    .map((m) => m.content.toLowerCase())
    .join(' ');

  // Specific multi-word phrases first
  if (IRON_KEYWORDS.some((kw) => allUserText.includes(kw))) {
    return IRON_KEYWORDS.find((kw) => allUserText.includes(kw)) ?? 'iron';
  }
  // Loose single words only if no aluminium mentioned (avoid false positives)
  if (!allUserText.includes('aluminium') && !allUserText.includes('aluminum')) {
    if (IRON_LOOSE_KEYWORDS.some((kw) => allUserText.includes(kw))) {
      return IRON_LOOSE_KEYWORDS.find((kw) => allUserText.includes(kw)) ?? 'iron';
    }
  }
  return '';
}

export async function POST(req: Request) {
  const { messages, tenantId } = await req.json();

  if (!tenantId || !messages?.length) {
    return new Response(JSON.stringify({ error: 'Missing tenantId or messages' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // Fetch tenant config (min quote + price buffer)
  const supabase = createAdminClient();
  const { data: tenant } = await supabase
    .from('tenants')
    .select('id, min_quote_gbp, price_buffer_percent')
    .eq('id', tenantId)
    .single();

  if (!tenant) {
    return new Response(JSON.stringify({ error: 'Tenant not found' }), {
      status: 404,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const minQuoteGbp = Number(tenant.min_quote_gbp ?? 300);
  const priceBufferPercent = Number(tenant.price_buffer_percent ?? 10);

  // Check last user message for handoff keywords
  const lastUserMsg = [...messages].reverse().find((m: { role: string }) => m.role === 'user');
  const lastUserText: string = lastUserMsg?.content ?? '';

  // Detect iron/traditional → auto-assume mild steel
  const materialAssumption = detectIronOrTraditional(messages);

  // Build conversation text for RAG (last few user messages)
  const userContext = messages
    .filter((m: { role: string }) => m.role === 'user')
    .map((m: { content: string }) => m.content)
    .slice(-4)
    .join(' ');

  // RAG + pricing lookup — run in parallel
  const [similarQuotesContext, pricingContext] = await Promise.all([
    userContext.length > 20
      ? findSimilarGoldenQuotes(userContext, tenantId, 3)
          .then((similar) =>
            similar.length > 0
              ? similar
                  .map(
                    (q, i) =>
                      `Job ${i + 1}: ${q.product_type ?? 'Metalwork'} — ${q.material ?? 'unknown material'} — ${q.description?.slice(0, 120)} — Price range: £${q.price_low}–£${q.price_high}${q.final_price ? ` (final: £${q.final_price})` : ''}`
                  )
                  .join('\n')
              : ''
          )
          .catch((err) => {
            console.error('RAG lookup failed (non-fatal):', err);
            return '';
          })
      : Promise.resolve(''),

    buildPricingContext(userContext, tenantId).catch((err) => {
      console.error('Pricing context failed (non-fatal):', err);
      return '';
    }),
  ]);

  const systemPrompt = buildChatbotSystemPrompt(
    minQuoteGbp,
    priceBufferPercent,
    similarQuotesContext,
    pricingContext,
    materialAssumption
  );

  // Flag high-priority handoff in DB if keywords found
  if (containsHandoffKeyword(lastUserText)) {
    try {
      await supabase.from('enquiries').insert({
        tenant_id: tenantId,
        source: 'chatbot',
        raw_input: messages.map((m: { role: string; content: string }) => `${m.role}: ${m.content}`).join('\n'),
        status: 'new',
        extracted_specs: { priority: 'high', handoff_triggered: true },
      });
    } catch (err) {
      console.error('Handoff enquiry insert failed:', err);
    }
  }

  const result = streamText({
    model: anthropic('claude-sonnet-4-6'),
    system: systemPrompt,
    messages,
    maxOutputTokens: 600,
  });

  return result.toTextStreamResponse();
}
