import Anthropic from '@anthropic-ai/sdk';
import { SANITISER_PROMPT } from './prompts';

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

export interface SanitisedQuote {
  product_type: string | null;
  material: string | null;
  description: string;
  dimensions: Record<string, number> | null;
  price_low: number | null;
  price_high: number | null;
  final_price: number | null;
  status: 'won' | 'lost' | 'unknown';
}

export async function sanitiseText(rawText: string): Promise<SanitisedQuote> {
  const truncated = rawText.slice(0, 2000);

  const message = await anthropic.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 1024,
    messages: [
      {
        role: 'user',
        content: `${SANITISER_PROMPT}\n\nRaw text to clean:\n${truncated}`,
      },
    ],
  });

  const content = message.content[0];
  if (content.type !== 'text') {
    throw new Error('Unexpected response type from sanitiser');
  }

  const jsonText = content.text.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '').trim();
  return JSON.parse(jsonText) as SanitisedQuote;
}
