import OpenAI from 'openai';
import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@clerk/nextjs/server';
import { createAdminClient } from '@/lib/supabase/admin';

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

export interface QuoteData {
  tenant_id: string;
  raw_text: string;
  product_type: string | null;
  material: string | null;
  description: string;
  dimensions: Record<string, number> | null;
  price_low: number | null;
  price_high: number | null;
  final_price: number | null;
  status: 'won' | 'lost' | 'unknown';
}

export async function POST(req: NextRequest) {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });
  }

  const body = await req.json() as QuoteData;
  const { tenant_id, description, raw_text, ...rest } = body;

  if (!tenant_id || !description) {
    return NextResponse.json({ error: 'tenant_id and description are required' }, { status: 400 });
  }

  // Generate embedding on the description
  const embeddingResponse = await openai.embeddings.create({
    model: 'text-embedding-3-small',
    input: description.slice(0, 2000),
  });

  const embedding = embeddingResponse.data[0].embedding;

  const supabase = createAdminClient();

  const quoteStatus = rest.status === 'unknown' ? 'draft' : rest.status;
  const isGolden = rest.status === 'won';

  const { data, error } = await supabase
    .from('quotes')
    .insert({
      tenant_id,
      raw_text: raw_text?.slice(0, 2000) ?? null,
      description,
      product_type: rest.product_type,
      material: rest.material,
      dimensions: rest.dimensions,
      price_low: rest.price_low,
      price_high: rest.price_high,
      final_price: rest.final_price,
      status: quoteStatus,
      is_golden: isGolden,
      embedding,
    })
    .select('id')
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ id: data.id });
}
