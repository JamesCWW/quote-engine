import Anthropic from '@anthropic-ai/sdk';
import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@clerk/nextjs/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { getTenantId } from '@/lib/tenant';

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

export interface AnalysisQuestion {
  id: string;
  label: string;
  type: 'text' | 'dropdown' | 'yesno';
  options?: string[];
  section?: string; // e.g. 'gates' | 'fencing' — set when enquiry has multiple components
  defaultValue?: string; // pre-filled value auto-detected from the enquiry
}

const ANALYSE_PROMPT = `You are a quoting assistant for Helions Forge, a bespoke metalwork manufacturer (gates, railings, balustrades).

Given the enquiry text and any extracted specs below, identify the key information that is MISSING and would be needed for an accurate quote.

Return ONLY a JSON array of questions. Do not ask about anything that is already clearly stated in the enquiry or specs.

ALUMINIUM GATE DESIGN DETECTION:
If the enquiry mentions any of these design names, automatically set material = Aluminium and do NOT ask about material:
Norfolk, Surrey, Hertfordshire, Essex, Cambridgeshire, London, Suffolk, Northamptonshire,
Bedfordshire, Buckinghamshire, Saffron Walden, Bury St Edmunds, Grantchester, Burwell,
Linton, Finchingfield, Clavering, Sudbury, Ely, Oxford, Newmarket, Huntingdon, Thetford,
Wellingborough, Thaxted, Halstead

MIXED ENQUIRY DETECTION:
If the enquiry mentions BOTH gates AND fencing/railings, tag each question with a "section" field:
- "section": "gates" for gate-related questions
- "section": "fencing" for fencing/railing questions

For mixed enquiries, include:
GATES section (if missing):
- Motor type (if electric): dropdown ["FROG-X Underground", "BFT/Nice Swing Motor", "Sliding Motor", "Not sure"]
- Access control: dropdown ["Keypad only", "Video intercom", "GSM intercom", "Remote fobs only", "None"]
- Posts required: yesno

FENCING section (if missing):
- Fencing type: dropdown ["Steel railings to match gates", "Timber feather edge / close board", "Unsure — need recommendation"]
- Total fencing length (metres): text
- Fencing height (metres): text
- Posts included: yesno

Each question object must have:
- "id": camelCase identifier (e.g. "installationType")
- "label": Clear, friendly question for the estimator to fill in
- "type": one of "text", "dropdown", or "yesno"
- "options": array of strings — REQUIRED if type is "dropdown"
- "section": "gates" | "fencing" — REQUIRED if mixed enquiry, omit otherwise
- "defaultValue": string — set this if the answer can be auto-detected from the enquiry text

Common gates gaps to check for (only include if genuinely missing):
- Manual or electric gates/automation?
- Installation method: brick to brick or concrete posts?
- Any specific design or style preference?
- RAL colour or powder coat finish?
- Pedestrian gate required alongside driveway gates?
- Site postcode (for travel cost estimate)?
- Supply only or supply and install?
- Number of panels or gates?
- Specific dimensions (length, height, width) if not mentioned?

Return a maximum of 8 of the most important missing questions (can be split across sections for mixed enquiries).
Return ONLY valid JSON array, no surrounding text.`;

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });

  const tenantId = await getTenantId();
  if (!tenantId) return NextResponse.json({ error: 'Tenant not found' }, { status: 403 });

  const supabase = createAdminClient();

  // Fetch the enquiry scoped to the authenticated tenant
  const { data: enquiry, error } = await supabase
    .from('enquiries')
    .select('id, raw_input, extracted_specs, tenant_id')
    .eq('id', params.id)
    .eq('tenant_id', tenantId)
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
