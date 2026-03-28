import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@clerk/nextjs/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { generateQuote } from '@/lib/ai/quote-engine';
import type { RailingDims } from '@/lib/ai/material-takeoff';

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

    // Save the incoming enquiry (or reuse an existing one)
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

    console.log('Step 5: Generating quote');
    const result = await generateQuote({
      enquiry_text,
      tenant_id,
      assumptions,
      image_urls,
      railing_dims,
    });

    // Save to generated_quotes
    const { data: generatedQuote, error: gqError } = await supabase
      .from('generated_quotes')
      .insert({
        tenant_id,
        enquiry_id: enquiryId,
        similar_quote_ids: result.similar_quotes.map((q) => q.id),
        ai_reasoning: result.reasoning,
        price_low: result.price_low,
        price_high: result.price_high,
        confidence: result.confidence,
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
          product_type: result.product_type,
          material: result.material,
        },
        status: 'quoted',
      })
      .eq('id', enquiryId);

    console.log('Step complete: returning response');
    return NextResponse.json({
      generated_quote_id: generatedQuote.id,
      enquiry_id: enquiryId,
      price_low: result.price_low,
      price_high: result.price_high,
      confidence: result.confidence,
      reasoning: result.reasoning,
      missing_info: result.missing_info,
      product_type: result.product_type,
      material: result.material,
      similar_quotes: result.similar_quotes,
      quote_mode: result.quote_mode,
      ...(result.cost_breakdown ? { cost_breakdown: result.cost_breakdown } : {}),
      ...(result.components?.length ? { components: result.components } : {}),
      ...(result.options?.length ? { options: result.options } : {}),
    });
  } catch (error) {
    const err = error as Error;
    console.error('FAILED AT STEP:', err.message);
    console.error('Stack:', err.stack);
    return NextResponse.json({ error: err.message, stack: err.stack }, { status: 500 });
  }
}
