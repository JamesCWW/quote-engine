import OpenAI from 'openai';
import Anthropic from '@anthropic-ai/sdk';
import { createAdminClient } from '@/lib/supabase/admin';

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

export interface SimilarQuote {
  id: string;
  product_type: string | null;
  material: string | null;
  description: string;
  price_low: number | null;
  price_high: number | null;
  final_price: number | null;
  is_golden: boolean;
  similarity: number;
}

/**
 * Embeds enquiryText and runs a vector similarity search against the tenant's
 * historical quotes. Golden (won) quotes are prioritised in ranking.
 */
export async function findSimilarQuotes(
  enquiryText: string,
  tenantId: string,
  limit = 3
): Promise<SimilarQuote[]> {
  const embeddingResponse = await openai.embeddings.create({
    model: 'text-embedding-3-small',
    input: enquiryText.slice(0, 2000),
  });

  const embedding = embeddingResponse.data[0].embedding;
  const supabase = createAdminClient();

  const { data, error } = await supabase.rpc('match_quotes', {
    query_embedding: embedding,
    match_tenant_id: tenantId,
    match_count: limit,
  });

  if (error) {
    console.error('RAG search error:', error);
    return [];
  }

  return (data ?? []) as SimilarQuote[];
}

/**
 * Like findSimilarQuotes but restricted to golden (won) quotes only.
 * Used by the public chatbot so it only references paid/proven jobs.
 */
export async function findSimilarGoldenQuotes(
  enquiryText: string,
  tenantId: string,
  limit = 3
): Promise<SimilarQuote[]> {
  const embeddingResponse = await openai.embeddings.create({
    model: 'text-embedding-3-small',
    input: enquiryText.slice(0, 2000),
  });

  const embedding = embeddingResponse.data[0].embedding;
  const supabase = createAdminClient();

  const { data, error } = await supabase.rpc('match_quotes', {
    query_embedding: embedding,
    match_tenant_id: tenantId,
    match_count: limit * 3, // over-fetch then filter
  });

  if (error) {
    console.error('RAG golden search error:', error);
    return [];
  }

  const golden = ((data ?? []) as SimilarQuote[]).filter((q) => q.is_golden);
  return golden.slice(0, limit);
}

/**
 * Uses Claude Sonnet vision to describe metalwork visible in an image URL.
 * Returns a free-text spec description to augment the enquiry context.
 */
export async function extractSpecsFromImage(imageUrl: string): Promise<string> {
  const message = await anthropic.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 512,
    messages: [
      {
        role: 'user',
        content: [
          {
            type: 'image',
            source: {
              type: 'url',
              url: imageUrl,
            },
          },
          {
            type: 'text',
            text: 'Describe the metalwork in this image. Note: product type, approximate dimensions, material type, finish, fixings visible, complexity level. Be specific about what you can see.',
          },
        ],
      },
    ],
  });

  const content = message.content[0];
  return content.type === 'text' ? content.text : '';
}
