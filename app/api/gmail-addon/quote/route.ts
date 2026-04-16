import { NextRequest, NextResponse } from 'next/server';
import { generateQuote } from '@/lib/ai/quote-engine';
import type { RailingDims } from '@/lib/ai/material-takeoff';

function validateApiKey(req: NextRequest): boolean {
  const authHeader = req.headers.get('authorization');
  if (!authHeader?.startsWith('Bearer ')) return false;
  return authHeader.slice(7) === process.env.GMAIL_ADDON_API_KEY;
}

export async function POST(req: NextRequest) {
  try {
    console.log('[gmail-addon/quote] Step 1: Auth check');
    if (!validateApiKey(req)) {
      return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });
    }

    console.log('[gmail-addon/quote] Step 2: Parsing request body');
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

    console.log('[gmail-addon/quote] Step 3: Generating quote');
    console.log('ADDON: calling generateQuote');
    const result = await generateQuote({
      enquiry_text,
      tenant_id,
      assumptions,
      complexity_multiplier,
      railing_dims,
    });

    console.log('[gmail-addon/quote] Step complete: returning response');
    return NextResponse.json({
      price_low: result.price_low,
      price_high: result.price_high,
      confidence: result.confidence,
      reasoning: result.reasoning,
      missing_info: result.missing_info,
      product_type: result.product_type,
      material: result.material,
      similar_quote_ids: result.similar_quotes.map((q) => q.id),
      quote_mode: result.quote_mode,
      ...(result.cost_breakdown ? { cost_breakdown: result.cost_breakdown } : {}),
      ...(result.det_breakdown ? { det_breakdown: result.det_breakdown } : {}),
      ...(result.components?.length ? { components: result.components } : {}),
      ...(result.options?.length ? { options: result.options } : {}),
      ...(result.job_components?.length ? { job_components: result.job_components } : {}),
    });
  } catch (error) {
    const err = error as Error;
    console.error('[gmail-addon/quote] FAILED:', err.message);
    console.error('[gmail-addon/quote] Stack:', err.stack);
    return NextResponse.json({ error: err.message, stack: err.stack }, { status: 500 });
  }
}
