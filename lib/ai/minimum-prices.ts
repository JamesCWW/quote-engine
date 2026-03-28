export interface PriceRule {
  min: number;
  max?: number;
}

export const MINIMUM_PRICES: Record<string, PriceRule> = {
  iron_driveway_gates_electric:         { min: 10500 },
  iron_driveway_gates_manual:           { min: 2500 },
  aluminium_driveway_gates_electric:    { min: 8500 },
  aluminium_driveway_gates_manual:      { min: 1800 },
  iron_pedestrian_gate_manual:          { min: 1800, max: 3200 },
  iron_pedestrian_gate_electric:        { min: 1200 },
  aluminium_pedestrian_gate:            { min: 1000, max: 1850 },
  railings_per_metre_installed:         { min: 150 },
};

/**
 * Classify a gate job into a MINIMUM_PRICES key.
 * Returns null if the job cannot be identified as a gate job.
 */
export function classifyGateJob(
  productType: string,
  material: string,
  text: string
): string | null {
  const combined = `${productType} ${material} ${text}`.toLowerCase();

  const isAluminium = /alumin/.test(combined);
  // Only call it iron if aluminium wasn't detected — avoids false positives on
  // phrases like "aluminium gates with mild steel posts"
  const isIron = !isAluminium && /\b(iron|mild[\s-]steel)\b/.test(combined);
  if (!isAluminium && !isIron) return null;

  const isPedestrian = /pedestrian|walk.?through|side[\s-]gate|wicket/.test(combined);
  const isElectric   = /electric|automat|motor/.test(combined);

  const mat        = isAluminium ? 'aluminium' : 'iron';
  const automation = isElectric  ? 'electric'  : 'manual';

  if (mat === 'aluminium' && isPedestrian) return 'aluminium_pedestrian_gate';
  if (mat === 'iron'      && isPedestrian) return `iron_pedestrian_gate_${automation}`;
  return `${mat}_driveway_gates_${automation}`;
}

/**
 * Extract the linear metres of fencing/railing from an enquiry text.
 * Returns 0 when no fencing component is detected or no length given.
 */
export function extractFencingLength(text: string): number {
  const hasFencing = /\b(railing|railings|fence|fencing|featherboard|feather.?edge|close.?board)\b/i.test(text);
  if (!hasFencing) return 0;
  const m = text.match(/(\d+(?:\.\d+)?)\s*(?:linear\s*)?(?:m\b|metres?|meters?)/i);
  return m ? parseFloat(m[1]) : 0;
}

/**
 * Mutates aiResult in-place to enforce MINIMUM_PRICES rules:
 *  - Floor: price_low must be >= gate minimum + (fencing length × £150/m)
 *  - Ceiling: price_high (and price_low) must not exceed the gate max (pedestrian gates only)
 *  - price_high is always kept >= price_low
 */
export function enforceMinimumPrices(
  aiResult: { price_low: number; price_high: number; reasoning: string; product_type: string; material: string },
  text: string
): void {
  const jobKey = classifyGateJob(aiResult.product_type ?? '', aiResult.material ?? '', text);
  const rule   = jobKey ? MINIMUM_PRICES[jobKey] : undefined;

  const fencingLength = extractFencingLength(text);
  const fencingMin    = fencingLength * MINIMUM_PRICES.railings_per_metre_installed.min;
  const gateMin       = rule?.min ?? 0;
  const totalMin      = gateMin + fencingMin;

  const notes: string[] = [];
  let changed = false;

  // ── Floor ──────────────────────────────────────────────────────────────────
  if (totalMin > 0 && aiResult.price_low < totalMin) {
    aiResult.price_low = totalMin;
    if (aiResult.price_high < aiResult.price_low) {
      aiResult.price_high = Math.round(aiResult.price_low * 1.2);
    }
    if (gateMin    > 0) notes.push(`gate minimum £${gateMin.toLocaleString()}`);
    if (fencingMin > 0) notes.push(`fencing minimum £${fencingMin.toLocaleString()} (${fencingLength}m × £150/m)`);
    changed = true;
  }

  // ── Ceiling (pedestrian gates only) ───────────────────────────────────────
  if (rule?.max) {
    if (aiResult.price_high > rule.max) {
      aiResult.price_high = rule.max;
      notes.push(`gate maximum £${rule.max.toLocaleString()}`);
      changed = true;
    }
    if (aiResult.price_low > rule.max) {
      aiResult.price_low = rule.max;
      changed = true;
    }
  }

  if (changed) {
    aiResult.reasoning += ` Note: Price adjusted to meet minimum pricing rules (${notes.join(', ')}).`;
  }
}
