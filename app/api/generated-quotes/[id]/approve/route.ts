import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@clerk/nextjs/server';
import { createAdminClient } from '@/lib/supabase/admin';
import OpenAI from 'openai';
import { Resend } from 'resend';

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const resend = process.env.RESEND_API_KEY ? new Resend(process.env.RESEND_API_KEY) : null;

export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });

  const { id } = params;
  const body = await req.json();
  const { final_price, tenant_id, enquiry_text, product_type, material } = body as {
    final_price: number;
    tenant_id: string;
    enquiry_text: string;
    product_type?: string;
    material?: string;
  };

  if (!final_price || !tenant_id) {
    return NextResponse.json({ error: 'final_price and tenant_id are required' }, { status: 400 });
  }

  const supabase = createAdminClient();

  // Verify ownership and get quote data
  const { data: gq, error: fetchError } = await supabase
    .from('generated_quotes')
    .select('*')
    .eq('id', id)
    .eq('tenant_id', tenant_id)
    .single();

  if (fetchError || !gq) {
    return NextResponse.json({ error: 'Generated quote not found' }, { status: 404 });
  }

  // Mark generated quote as approved
  const { error: updateError } = await supabase
    .from('generated_quotes')
    .update({ status: 'approved', final_price, reviewed_by: userId })
    .eq('id', id);

  if (updateError) {
    return NextResponse.json({ error: updateError.message }, { status: 500 });
  }

  // Self-improvement loop: save approved job as training data in quotes table
  const description = (enquiry_text ?? '').slice(0, 2000);
  let embedding: number[] | null = null;

  if (description) {
    try {
      const embResponse = await openai.embeddings.create({
        model: 'text-embedding-3-small',
        input: description,
      });
      embedding = embResponse.data[0].embedding;
    } catch (err) {
      console.error('Embedding failed during approval:', err);
    }
  }

  await supabase.from('quotes').insert({
    tenant_id,
    description,
    product_type: product_type ?? null,
    material: material ?? null,
    price_low: gq.price_low,
    price_high: gq.price_high,
    final_price,
    status: 'won',
    is_golden: true,
    embedding,
  });

  // Send notification email if Resend is configured
  const notifyEmail = process.env.NOTIFY_EMAIL;
  if (resend && notifyEmail) {
    try {
      await resend.emails.send({
        from: process.env.RESEND_FROM_EMAIL ?? 'quotes@helionsforge.com',
        to: notifyEmail,
        subject: `Quote approved — £${final_price.toLocaleString()}${product_type ? ` (${product_type})` : ''}`,
        html: `
          <h2>Quote Approved</h2>
          <p><strong>Final price:</strong> £${final_price.toLocaleString()}</p>
          ${product_type ? `<p><strong>Product type:</strong> ${product_type}</p>` : ''}
          ${material ? `<p><strong>Material:</strong> ${material}</p>` : ''}
          <p><strong>AI range:</strong> £${gq.price_low?.toLocaleString() ?? '?'} – £${gq.price_high?.toLocaleString() ?? '?'}</p>
          <p><strong>Description:</strong><br/>${description}</p>
          <hr/>
          <p style="color:#666;font-size:12px">Helions Forge · AI Quoting Engine</p>
        `,
      });
    } catch (emailErr) {
      // Non-fatal: log and continue
      console.error('Failed to send approval notification:', emailErr);
    }
  }

  return NextResponse.json({ success: true });
}
