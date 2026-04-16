import { NextResponse } from 'next/server';
import { auth } from '@clerk/nextjs/server';
import { getTenantId } from '@/lib/tenant';
import { runDeterministicEngine } from '@/lib/ai/deterministic-engine';

export async function POST(request: Request) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const tenant_id = await getTenantId();
  if (!tenant_id) return NextResponse.json({ error: 'Tenant not found' }, { status: 400 });

  const body = await request.json() as { enquiry_text: string; actual_price: number };
  const { enquiry_text, actual_price } = body;

  if (!enquiry_text?.trim()) {
    return NextResponse.json({ error: 'enquiry_text is required' }, { status: 400 });
  }
  if (typeof actual_price !== 'number' || actual_price <= 0) {
    return NextResponse.json({ error: 'actual_price must be a positive number' }, { status: 400 });
  }

  console.log('CALIBRATION: calling runDeterministicEngine');
  const { result, spec, breakdown } = await runDeterministicEngine({
    enquiry_text,
    tenant_id,
  });

  const midpoint = (result.price_low + result.price_high) / 2;
  const gapAmount = Math.round(actual_price - midpoint);
  const gapPercent = midpoint > 0 ? Math.round((gapAmount / midpoint) * 100) : 0;
  const direction =
    Math.abs(gapPercent) <= 10
      ? 'on_target'
      : actual_price > midpoint
      ? 'under'   // engine was under, actual was higher
      : 'over';   // engine was over, actual was lower

  // Work out which line item has the biggest absolute value — that's the lever
  const lineItems = [
    { label: 'Product supply', value: breakdown.product_supply, field: null, table: null },
    { label: 'Manufacture', value: breakdown.manufacture, field: 'fabrication_day_rate', table: 'master_rates' as const },
    { label: 'Installation', value: breakdown.installation, field: 'installation_day_rate', table: 'master_rates' as const },
    { label: 'Accessories', value: breakdown.accessories_total, field: null, table: null },
  ].filter((l) => l.value > 0);

  const biggestLineItem = [...lineItems].sort((a, b) => b.value - a.value)[0] ?? null;

  // Suggested adjustments
  type Adjustment = {
    label: string;
    description: string;
    current_value: number | null;
    suggested_value: number | null;
    field: string;
    table: 'master_rates' | 'job_types';
    job_type?: string;
  };

  const suggestions: Adjustment[] = [];

  if (direction !== 'on_target') {
    const factor = actual_price / (midpoint || 1);

    if (breakdown.manufacture > 0) {
      // Fetch current fabrication rate so we can suggest a new one
      suggestions.push({
        label: 'Adjust fabrication day rate',
        description: direction === 'under'
          ? `Engine underestimated. Fabrication rate × ${factor.toFixed(2)} would have matched.`
          : `Engine overestimated. Fabrication rate × ${factor.toFixed(2)} would have matched.`,
        current_value: null, // filled client-side from master_rates
        suggested_value: null,
        field: 'fabrication_day_rate',
        table: 'master_rates',
      });
    }

    if (breakdown.installation > 0) {
      suggestions.push({
        label: 'Adjust installation day rate',
        description: direction === 'under'
          ? `Installation cost may be undercosted. Review install_days or day rate.`
          : `Installation cost may be overcosted. Review install_days or day rate.`,
        current_value: null,
        suggested_value: null,
        field: 'installation_day_rate',
        table: 'master_rates',
      });
    }

    if (breakdown.job_type_matched) {
      suggestions.push({
        label: `Adjust minimum value for "${breakdown.job_type_matched}"`,
        description: direction === 'under'
          ? `Actual price (£${actual_price.toLocaleString()}) is above engine estimate. Consider raising the minimum_value for this job type.`
          : `Actual price (£${actual_price.toLocaleString()}) is below engine estimate. Consider lowering the minimum_value.`,
        current_value: null,
        suggested_value: Math.round(actual_price * 0.9), // 90th percentile of actual as new minimum
        field: 'minimum_value',
        table: 'job_types',
        job_type: breakdown.job_type_matched,
      });
    }
  }

  return NextResponse.json({
    estimate: {
      price_low: result.price_low,
      price_high: result.price_high,
      midpoint: Math.round(midpoint),
      confidence: result.confidence,
      reasoning: result.reasoning,
      missing_info: result.missing_info,
      breakdown,
    },
    spec,
    actual_price,
    gap: {
      amount: gapAmount,
      percent: gapPercent,
      direction,
    },
    biggest_line_item: biggestLineItem,
    suggested_adjustments: suggestions,
  });
}
