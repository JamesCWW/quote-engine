import Anthropic from '@anthropic-ai/sdk';
import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@clerk/nextjs/server';
import { createAdminClient } from '@/lib/supabase/admin';

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

export interface AnalysisQuestion {
  id: string;
  label: string;
  type: 'text' | 'dropdown' | 'yesno';
  options?: string[];
}

const ANALYSE_PROMPT = `You are a quoting assistant for Helions Forge, a bespoke metalwork manufacturer (gates, railings, balustrades).

Given the enquiry text and any extracted specs below, identify the key information that is MISSING and would be needed for an accurate quote.

Return ONLY a JSON array of questions. Do not ask about anything that is already clearly stated in the enquiry or specs.

Each question object must have:
- "id": camelCase identifier (e.g. "installationType")
- "label": Clear, friendly question for the estimator to fill in
- "type": one of "text", "dropdown", or "yesno"
- "options": array of strings — REQUIRED if type is "dropdown"

Common gaps to check for (only include if genuinely missing):
- Manual or electric gates/automation?
- Installation method: brick to brick or concrete posts?
- Any specific design or style preference?
- RAL colour or powder coat finish?
- Pedestrian gate required alongside driveway gates?
- Site postcode (for travel cost estimate)?
- Supply only or supply and install?
- Number of panels or gates?
- Specific dimensions (length, height, width) if not mentioned?

Return a maximum of 6 of the most important missing questions.
Return ONLY valid JSON array, no surrounding text.`;

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });

  const supabase = createAdminClient();

  // Fetch the enquiry to get tenant isolation + data
  const { data: enquiry, error } = await supabase
    .from('enquiries')
    .select('id, raw_input, extracted_specs, tenant_id')
    .eq('id', params.id)
    .single();

  if (error || !enquiry) {
    return NextResponse.json({ error: 'Enquiry not found' }, { status: 404 });
  }

  const specsText = enquiry.extracted_specs
    ? JSON.stringify(enquiry.extracted_specs, null, 2)
    : 'None extracted yet';

  const message = await anthropic.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 1024,
    messages: [
      {
        role: 'user',
        content: `${ANALYSE_PROMPT}\n\nEnquiry text:\n${(enquiry.raw_input ?? '').slice(0, 2000)}\n\nExtracted specs:\n${specsText}\n\nReturn only valid JSON array.`,
      },
    ],
  });

  const content = message.content[0];
  if (content.type !== 'text') {
    return NextResponse.json({ error: 'Unexpected AI response' }, { status: 500 });
  }

  let questions: AnalysisQuestion[];
  try {
    const jsonText = content.text
      .replace(/^```(?:json)?\n?/, '')
      .replace(/\n?```$/, '')
      .trim();
    questions = JSON.parse(jsonText);
  } catch {
    return NextResponse.json({ error: 'Failed to parse AI response', raw: content.text }, { status: 500 });
  }

  return NextResponse.json({ questions });
}
