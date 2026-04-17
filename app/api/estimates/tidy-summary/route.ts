import Anthropic from '@anthropic-ai/sdk';
import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@clerk/nextjs/server';

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

export async function POST(req: NextRequest) {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });
  }

  const body = await req.json();
  const { summary } = body as { summary: string };

  if (!summary || typeof summary !== 'string') {
    return NextResponse.json({ error: 'summary is required' }, { status: 400 });
  }

  try {
    const message = await anthropic.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 512,
      messages: [
        {
          role: 'user',
          content: `Fix the grammar, spelling and flow of this project summary. Keep it concise and professional. Do not add or remove information. Return only the improved text.\n\n${summary}`,
        },
      ],
    });

    const tidied = message.content[0].type === 'text' ? message.content[0].text.trim() : summary;

    return NextResponse.json({ tidied_summary: tidied });
  } catch (error) {
    const err = error as Error;
    console.error('[estimates/tidy-summary] FAILED:', err.message);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
