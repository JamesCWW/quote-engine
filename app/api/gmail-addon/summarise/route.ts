import Anthropic from '@anthropic-ai/sdk';
import { NextRequest, NextResponse } from 'next/server';

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

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
  const { thread_text, tenant_id } = body as { thread_text: string; tenant_id: string };

  if (!thread_text || !tenant_id) {
    return NextResponse.json({ error: 'thread_text and tenant_id are required' }, { status: 400 });
  }

  const safeThreadText = thread_text
    .slice(0, 3000)
    .replace(/[\u0000-\u001F\u007F-\u009F]/g, ' ');

  try {
    const message = await anthropic.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 512,
      messages: [
        {
          role: 'user',
          content: `Read this email thread about a metalwork enquiry.
Write a 2-3 sentence project summary in plain English covering: what products are needed, any dimensions mentioned, installation requirements, and anything notable.
Be specific about what IS mentioned and honest about what is NOT mentioned.
Then list the product types detected as an array.
Return ONLY a valid JSON object. No markdown, no backticks, no explanation. The summary field must not contain unescaped quotes or special characters. Use single quotes within the summary text if needed, never double quotes.
Format: { "summary": string, "components_detected": string[] }

Valid component values: aluminium_driveway_gates, mild_steel_driveway_gates, iron_driveway_gates, aluminium_pedestrian_gate, mild_steel_pedestrian_gate, railings, handrails, automation, access_control

Email thread:
${safeThreadText}`,
        },
      ],
    });

    const text = message.content[0].type === 'text' ? message.content[0].text : '';

    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      console.error('[gmail-addon/summarise] Failed to parse AI response:', text);
      return NextResponse.json({ error: 'Failed to parse AI response' }, { status: 500 });
    }

    let summary = '';
    let components_detected: string[] = [];

    try {
      const result = JSON.parse(jsonMatch[0]);
      summary = result.summary || '';
      components_detected = Array.isArray(result.components_detected) ? result.components_detected : [];
    } catch {
      const content = jsonMatch[0];
      const summaryStart = content.indexOf('"summary"');

      if (summaryStart !== -1) {
        const valueStart = content.indexOf('"', summaryStart + 10) + 1;
        const valueEnd = content.indexOf('"', valueStart);
        if (valueEnd > valueStart) {
          summary = content.slice(valueStart, valueEnd);
        }
      }

      console.error('[gmail-addon/summarise] Haiku returned invalid JSON, using fallback');
    }

    return NextResponse.json({ summary, components_detected });
  } catch (error) {
    const err = error as Error;
    console.error('[gmail-addon/summarise] FAILED:', err.message);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
