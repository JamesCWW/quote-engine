import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';

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
    tenant_id,
    email_subject,
    email_body,
    price_low,
    price_high,
    confidence,
    reasoning,
    product_type,
    material,
    assumptions,
    similar_quote_ids,
  } = body as {
    tenant_id: string;
    email_subject: string;
    email_body: string;
    price_low: number;
    price_high: number;
    confidence: string;
    reasoning: string;
    product_type: string;
    material: string;
    assumptions?: Array<{ label: string; value: string }>;
    similar_quote_ids?: string[];
  };

  if (!tenant_id || !email_body || price_low == null || price_high == null) {
    return NextResponse.json(
      { error: 'tenant_id, email_body, price_low and price_high are required' },
      { status: 400 }
    );
  }

  const supabase = createAdminClient();

  const { data: enquiry, error: enquiryError } = await supabase
    .from('enquiries')
    .insert({
      tenant_id,
      source: 'gmail_addon',
      raw_input: email_subject ? `Subject: ${email_subject}\n\n${email_body}` : email_body,
      image_urls: [],
      status: 'quoted',
      extracted_specs: {
        product_type: product_type ?? null,
        material: material ?? null,
        subject: email_subject ?? '',
      },
    })
    .select('id')
    .single();

  if (enquiryError) {
    return NextResponse.json({ error: enquiryError.message }, { status: 500 });
  }

  const { data: generatedQuote, error: gqError } = await supabase
    .from('generated_quotes')
    .insert({
      tenant_id,
      enquiry_id: enquiry.id,
      similar_quote_ids: similar_quote_ids ?? [],
      ai_reasoning: reasoning,
      price_low,
      price_high,
      confidence,
      assumptions: assumptions && assumptions.length > 0 ? assumptions : null,
      status: 'draft',
    })
    .select('id')
    .single();

  if (gqError) {
    return NextResponse.json({ error: gqError.message }, { status: 500 });
  }

  return NextResponse.json({
    enquiry_id: enquiry.id,
    generated_quote_id: generatedQuote.id,
  });
}
