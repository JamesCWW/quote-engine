import Anthropic from '@anthropic-ai/sdk';
import { NextRequest, NextResponse } from 'next/server';

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const SUPPORTED_TYPES = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'] as const;
type SupportedType = (typeof SUPPORTED_TYPES)[number];

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
  const { image_base64, mime_type } = body as {
    image_base64: string;
    mime_type: string;
  };

  if (!image_base64 || !mime_type) {
    return NextResponse.json({ error: 'image_base64 and mime_type are required' }, { status: 400 });
  }

  if (!SUPPORTED_TYPES.includes(mime_type as SupportedType)) {
    return NextResponse.json(
      { error: `Unsupported image type: ${mime_type}. Supported: ${SUPPORTED_TYPES.join(', ')}` },
      { status: 400 }
    );
  }

  const message = await anthropic.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 1024,
    messages: [
      {
        role: 'user',
        content: [
          {
            type: 'image',
            source: {
              type: 'base64',
              media_type: mime_type as SupportedType,
              data: image_base64,
            },
          },
          {
            type: 'text',
            text: `You are an expert in bespoke metalwork for Helions Forge, a UK manufacturer of gates, railings and balustrades.

Analyse this image and return ONLY a JSON object with these exact fields:

{
  "complexity": "simple_flat_bar" | "standard_decorative" | "highly_decorative" | "victorian_ornate",
  "dimensions_noted": "string — any visible dimensions, scale clues, or 'None visible'",
  "design_features": ["array of specific features observed"],
  "reasoning": "1-2 sentences explaining your complexity assessment",
  "confidence": "high" | "medium" | "low"
}

Complexity guide:
- simple_flat_bar: plain horizontal/vertical bars, no decoration, minimal welding
- standard_decorative: some scrollwork or simple finials, moderate detail
- highly_decorative: significant scrollwork, multiple design elements, custom patterns
- victorian_ornate: elaborate Victorian/Georgian style, heavy ornamentation, very labour-intensive

Return only valid JSON.`,
          },
        ],
      },
    ],
  });

  const content = message.content[0];
  if (content.type !== 'text') {
    return NextResponse.json({ error: 'Unexpected AI response' }, { status: 500 });
  }

  let analysis: {
    complexity: string;
    dimensions_noted: string;
    design_features: string[];
    reasoning: string;
    confidence: string;
  };

  try {
    const jsonText = content.text
      .replace(/^```(?:json)?\n?/, '')
      .replace(/\n?```$/, '')
      .trim();
    analysis = JSON.parse(jsonText);
  } catch {
    return NextResponse.json(
      { error: 'Failed to parse AI response', raw: content.text },
      { status: 500 }
    );
  }

  return NextResponse.json(analysis);
}
