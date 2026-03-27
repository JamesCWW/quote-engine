import Anthropic from '@anthropic-ai/sdk';
import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@clerk/nextjs/server';
import { SANITISER_PROMPT } from '@/lib/ai/prompts';

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

export async function POST(req: NextRequest) {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });
  }

  const body = await req.json();
  const { raw_text, tenant_id } = body as { raw_text: string; tenant_id: string };

  if (!raw_text || !tenant_id) {
    return NextResponse.json({ error: 'raw_text and tenant_id are required' }, { status: 400 });
  }

  // Truncate to 2000 chars to keep token costs low (per spec)
  const truncated = raw_text.slice(0, 2000);

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
    return NextResponse.json({ error: 'Unexpected response from AI' }, { status: 500 });
  }

  let parsed: Record<string, unknown>;
  try {
    // Strip markdown code fences if present
    const jsonText = content.text.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '').trim();
    parsed = JSON.parse(jsonText);
  } catch {
    return NextResponse.json({ error: 'Failed to parse AI response', raw: content.text }, { status: 500 });
  }

  return NextResponse.json({ data: parsed });
}
