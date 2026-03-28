import { createAdminClient } from '@/lib/supabase/admin';

interface MasterRates {
  fabrication_day_rate: number;
  installation_day_rate: number;
  consumer_unit_connection: number;
  minimum_job_value: number;
}

interface ProductMatch {
  design_name: string | null;
  width_mm: number | null;
  height_mm: number | null;
  price_gbp: number | null;
  category: string;
}

interface JobType {
  job_type: string;
  minimum_value: number | null;
  manufacture_days: number | null;
  install_days: number | null;
  engineers_required: number | null;
}

interface Accessory {
  item_name: string;
  helions_price: number | null;
  category: string;
}

// Aluminium gate design names — any match auto-identifies material as aluminium
const ALUMINIUM_GATE_DESIGNS = [
  'norfolk', 'surrey', 'hertfordshire', 'essex', 'cambridgeshire',
  'london', 'suffolk', 'northamptonshire', 'bedfordshire',
  'buckinghamshire', 'saffron walden', 'bury st edmunds',
  'grantchester', 'burwell', 'linton', 'finchingfield', 'clavering',
  'sudbury', 'ely', 'oxford', 'newmarket', 'huntingdon', 'thetford',
  'wellingborough', 'thaxted', 'halstead',
];

function detectDesignNames(text: string): string[] {
  const lower = text.toLowerCase();
  return ALUMINIUM_GATE_DESIGNS.filter((d) => lower.includes(d));
}

// Keyword maps to detect job type from free text
const JOB_TYPE_KEYWORDS: { keywords: string[]; job_type_pattern: string }[] = [
  { keywords: ['sliding', 'electric', 'aluminium', 'aluminum'], job_type_pattern: 'Sliding Electric Aluminium' },
  { keywords: ['sliding', 'manual', 'aluminium', 'aluminum'], job_type_pattern: 'Sliding Manual Aluminium' },
  { keywords: ['sliding', 'electric', 'iron'], job_type_pattern: 'Sliding Iron Driveway Gates Electric' },
  { keywords: ['sliding', 'manual', 'iron'], job_type_pattern: 'Sliding Iron Driveway Gates Manual' },
  { keywords: ['automated', 'iron', 'driveway'], job_type_pattern: 'Automated Double Iron Driveway' },
  { keywords: ['electric', 'aluminium', 'driveway'], job_type_pattern: 'Aluminium Driveway Gates Electric' },
  { keywords: ['electric', 'aluminum', 'driveway'], job_type_pattern: 'Aluminium Driveway Gates Electric' },
  { keywords: ['aluminium', 'driveway', 'concrete'], job_type_pattern: 'Aluminium Driveway Gates Manual Concrete' },
  { keywords: ['aluminum', 'driveway', 'concrete'], job_type_pattern: 'Aluminium Driveway Gates Manual Concrete' },
  { keywords: ['aluminium', 'driveway'], job_type_pattern: 'Aluminium Driveway Gates Manual Brick' },
  { keywords: ['aluminum', 'driveway'], job_type_pattern: 'Aluminium Driveway Gates Manual Brick' },
  { keywords: ['iron', 'driveway'], job_type_pattern: 'Manual Double Iron Driveway' },
  { keywords: ['aluminium', 'pedestrian', 'concrete'], job_type_pattern: 'Aluminium Pedestrian Gates Concrete' },
  { keywords: ['aluminum', 'pedestrian', 'concrete'], job_type_pattern: 'Aluminium Pedestrian Gates Concrete' },
  { keywords: ['aluminium', 'pedestrian'], job_type_pattern: 'Aluminium Pedestrian Gates Brick' },
  { keywords: ['aluminum', 'pedestrian'], job_type_pattern: 'Aluminium Pedestrian Gates Brick' },
  { keywords: ['juliette', 'balcony'], job_type_pattern: 'Juliette' },
  { keywords: ['balcony', 'terrace'], job_type_pattern: 'Juliette and Terrace' },
  { keywords: ['wall top', 'railing'], job_type_pattern: 'Wall Top Railings' },
  { keywords: ['handrail', 'step'], job_type_pattern: 'Small Handrails' },
  { keywords: ['handrail'], job_type_pattern: 'Handrails per 2 Meters' },
  { keywords: ['railing', '10 m', '10m'], job_type_pattern: 'Railings with Posts up to 10' },
  { keywords: ['railing'], job_type_pattern: 'Railings with Posts up to 10' },
];

function detectJobTypePattern(text: string): string | null {
  const lower = text.toLowerCase();
  for (const { keywords, job_type_pattern } of JOB_TYPE_KEYWORDS) {
    if (keywords.every((kw) => lower.includes(kw))) {
      return job_type_pattern;
    }
  }
  return null;
}

function detectCategory(text: string): string | null {
  const lower = text.toLowerCase();

  // Auto-detect aluminium from known design names (takes priority)
  const designNames = detectDesignNames(text);
  if (designNames.length > 0) {
    if (lower.includes('pedestrian') || lower.includes('walk') || lower.includes('foot')) {
      return 'aluminium_pedestrian_gates';
    }
    return 'aluminium_driveway_gates';
  }

  if ((lower.includes('aluminium') || lower.includes('aluminum')) && lower.includes('driveway')) {
    return 'aluminium_driveway_gates';
  }
  if ((lower.includes('aluminium') || lower.includes('aluminum')) && lower.includes('pedestrian')) {
    return 'aluminium_pedestrian_gates';
  }
  if (lower.includes('iron') && lower.includes('gate')) {
    return 'iron_driveway_gates';
  }
  if (lower.includes('aluminium') || lower.includes('aluminum')) {
    return 'aluminium_accessories';
  }
  if (lower.includes('iron')) {
    return 'iron_accessories';
  }
  return null;
}

// Convert a raw numeric value + optional unit string to millimetres.
// When no unit is given we use a heuristic:
//   ≤ 30        → metres  (e.g. "3 wide")
//   31 – 400    → cm      (e.g. "159 W" — typical gate dimension in cm)
//   > 400       → mm      (e.g. "1800 high")
function toMm(val: number, unit: string): number {
  const u = unit.toLowerCase().trim();
  if (u === 'mm') return Math.round(val);
  if (u === 'm' || u === 'metre' || u === 'meter' || u === 'metres' || u === 'meters') return Math.round(val * 1000);
  if (u === 'cm') return Math.round(val * 10);
  if (u === 'ft' || u === 'feet' || u === "'") return Math.round(val * 304.8);
  if (u === 'in' || u === 'inch' || u === 'inches' || u === '"') return Math.round(val * 25.4);
  // No unit — heuristic
  if (val <= 30) return Math.round(val * 1000);
  if (val <= 400) return Math.round(val * 10);
  return Math.round(val);
}

const UNIT_PATTERN = '(mm|cm|m|metres?|meters?|ft|feet|in|inches?|\'|")?';
const NUM_PATTERN = '(\\d+(?:\\.\\d+)?)';

// Extract rough dimensions from free text.
// Handles: "3m wide", "1800mm high", "6ft wide", "159 W & 248 H", "159W x 248H", standalone W/H
function extractDimensions(text: string): { width_mm: number | null; height_mm: number | null } {
  let width_mm: number | null = null;
  let height_mm: number | null = null;

  // 1. Combined "N[unit] W … N[unit] H" pattern (e.g. "159 W & 248 H", "3m W x 2m H")
  const wxhRe = new RegExp(
    NUM_PATTERN + '\\s*' + UNIT_PATTERN + '\\s*[Ww]\\b.*?' +
    NUM_PATTERN + '\\s*' + UNIT_PATTERN + '\\s*[Hh]\\b',
    'i'
  );
  const wxhMatch = text.match(wxhRe);
  if (wxhMatch) {
    width_mm  = toMm(parseFloat(wxhMatch[1]), wxhMatch[2] ?? '');
    height_mm = toMm(parseFloat(wxhMatch[3]), wxhMatch[4] ?? '');
  }

  // 2. Explicit "wide / width" keyword
  if (!width_mm) {
    const re = new RegExp(NUM_PATTERN + '\\s*' + UNIT_PATTERN + '\\s*(?:wide|width)', 'i');
    const m = text.match(re);
    if (m) width_mm = toMm(parseFloat(m[1]), m[2] ?? '');
  }

  // 3. Explicit "high / height / tall" keyword
  if (!height_mm) {
    const re = new RegExp(NUM_PATTERN + '\\s*' + UNIT_PATTERN + '\\s*(?:high|height|tall)', 'i');
    const m = text.match(re);
    if (m) height_mm = toMm(parseFloat(m[1]), m[2] ?? '');
  }

  // 4. Standalone "N W" (where W is not part of a larger word)
  if (!width_mm) {
    const re = new RegExp(NUM_PATTERN + '\\s*' + UNIT_PATTERN + '\\s+[Ww](?=[\\s&x,]|$)', 'i');
    const m = text.match(re);
    if (m) width_mm = toMm(parseFloat(m[1]), m[2] ?? '');
  }

  // 5. Standalone "N H"
  if (!height_mm) {
    const re = new RegExp(NUM_PATTERN + '\\s*' + UNIT_PATTERN + '\\s+[Hh](?=[\\s&x,]|$)', 'i');
    const m = text.match(re);
    if (m) height_mm = toMm(parseFloat(m[1]), m[2] ?? '');
  }

  return { width_mm, height_mm };
}

export interface PricingResult {
  context: string;
  minimumValue: number | null;
}

async function findClosestProduct(
  supabase: ReturnType<typeof createAdminClient>,
  tenantId: string,
  category: string,
  designName: string | null,
  dimensions: { width_mm: number | null; height_mm: number | null }
): Promise<ProductMatch | null> {
  let query = supabase
    .from('product_pricing')
    .select('design_name, width_mm, height_mm, price_gbp, category')
    .eq('tenant_id', tenantId)
    .eq('category', category)
    .not('price_gbp', 'is', null);

  if (designName) {
    query = query.ilike('design_name', `%${designName}%`);
  }

  const { data: products } = await query;
  if (!products || products.length === 0) return null;

  const scored = products.map((p) => {
    let dist = 0;
    if (dimensions.width_mm && p.width_mm) dist += Math.abs(dimensions.width_mm - p.width_mm);
    if (dimensions.height_mm && p.height_mm) dist += Math.abs(dimensions.height_mm - p.height_mm);
    return { product: p as ProductMatch, dist };
  });
  scored.sort((a, b) => a.dist - b.dist);
  return scored[0].product;
}

export async function buildPricingContext(
  userText: string,
  tenantId: string,
  complexityMultiplier: number = 1.0
): Promise<PricingResult> {
  if (!userText || userText.length < 15) return { context: '', minimumValue: null };

  const supabase = createAdminClient();

  const designNames = detectDesignNames(userText);
  const electricMentioned = /electric|automat|motor/i.test(userText);

  // Fetch master rates in parallel with job/product lookups
  const [ratesRes, jobTypePattern, category, dimensions] = await Promise.all([
    supabase
      .from('master_rates')
      .select('fabrication_day_rate, installation_day_rate, consumer_unit_connection, minimum_job_value')
      .eq('tenant_id', tenantId)
      .single(),
    Promise.resolve(detectJobTypePattern(userText)),
    Promise.resolve(detectCategory(userText)),
    Promise.resolve(extractDimensions(userText)),
  ]);

  const rates: MasterRates | null = ratesRes.data as MasterRates | null;
  if (!rates) return { context: '', minimumValue: null };

  const fabricationRate = rates.fabrication_day_rate;
  const installRate = rates.installation_day_rate;
  const isAluminium = category?.startsWith('aluminium');

  const parts: string[] = [];

  // ── Product price lookup ──────────────────────────────────────────────────
  // For multiple design names (alternative quote request), look up each separately
  const lookupDesigns = designNames.length > 0 ? designNames.slice(0, 2) : [null];
  const productMatches = await Promise.all(
    lookupDesigns.map((d) =>
      (category && (d || dimensions.width_mm || dimensions.height_mm))
        ? findClosestProduct(supabase, tenantId, category, d, dimensions)
        : Promise.resolve(null)
    )
  );

  if (designNames.length >= 2 && productMatches[0] && productMatches[1]) {
    // Show as Option A / Option B for alternative quote requests
    for (let i = 0; i < 2; i++) {
      const pm = productMatches[i];
      if (!pm?.price_gbp) continue;
      const dimStr = [
        pm.width_mm ? `${pm.width_mm}mm wide` : null,
        pm.height_mm ? `${pm.height_mm}mm high` : null,
      ].filter(Boolean).join(' × ');
      parts.push(`OPTION ${i === 0 ? 'A' : 'B'} — ${pm.design_name ?? designNames[i]} gate supply: £${pm.price_gbp.toFixed(2)} (${dimStr})`);
    }
  } else {
    const productMatch = productMatches[0];
    if (productMatch?.price_gbp) {
      const dimStr = [
        productMatch.width_mm ? `${productMatch.width_mm}mm wide` : null,
        productMatch.height_mm ? `${productMatch.height_mm}mm high` : null,
      ].filter(Boolean).join(' × ');
      parts.push(`Gate supply (${productMatch.design_name ?? 'standard'}, ${dimStr}): £${productMatch.price_gbp.toFixed(2)}`);
    }
  }

  // ── Job type: installation + manufacture cost ─────────────────────────────
  let jobTypeMatch: JobType | null = null;
  if (jobTypePattern) {
    const { data: jobTypes } = await supabase
      .from('job_types')
      .select('job_type, minimum_value, manufacture_days, install_days, engineers_required')
      .eq('tenant_id', tenantId)
      .ilike('job_type', `%${jobTypePattern}%`);

    if (jobTypes && jobTypes.length > 0) {
      jobTypeMatch = jobTypes[0] as JobType;
    }
  }

  if (jobTypeMatch) {
    const { install_days, manufacture_days, engineers_required, minimum_value } = jobTypeMatch;

    if (install_days && engineers_required) {
      const installCost = install_days * installRate * engineers_required;
      parts.push(
        `Installation: £${installCost.toFixed(2)} (${install_days} days × £${installRate} × ${engineers_required} engineers)`
      );
    }
    if (manufacture_days) {
      // Aluminium gates are pre-manufactured — do NOT apply complexity multiplier
      const adjustedDays = isAluminium ? manufacture_days : manufacture_days * complexityMultiplier;
      const manufactureCost = adjustedDays * fabricationRate;
      const multiplierNote =
        !isAluminium && complexityMultiplier !== 1.0
          ? ` — complexity multiplier ${complexityMultiplier}×`
          : '';
      parts.push(`Manufacture: £${manufactureCost.toFixed(2)} (${adjustedDays.toFixed(1)} days × £${fabricationRate}${multiplierNote})`);
    }
    if (minimum_value) {
      parts.push(`Minimum job value: £${minimum_value.toFixed(2)}`);
    }
  }

  // ── Accessories ───────────────────────────────────────────────────────────
  if (category === 'aluminium_driveway_gates') {
    // For aluminium driveway gates: show explicit line items (not a generic list)
    const { data: allAcc } = await supabase
      .from('accessories_pricing')
      .select('item_name, helions_price, category')
      .eq('tenant_id', tenantId)
      .in('category', ['aluminium_accessories', 'automation'])
      .not('helions_price', 'is', null);

    const acc = (allAcc ?? []) as Accessory[];
    const find = (pattern: RegExp) => acc.find((a) => pattern.test(a.item_name));

    const largePost = find(/driveway.*post.*large|large.*post.*driveway/i);
    const fob = find(/remote.*fob|fob/i);
    const postPrice = largePost?.helions_price ?? 181.89;
    const fobPrice = fob?.helions_price ?? 28.56;

    parts.push(`\nALUMINIUM GATE LINE ITEMS — include each as an explicit line in cost breakdown:`);
    parts.push(`  Posts × 2: £${(postPrice * 2).toFixed(2)} (£${postPrice.toFixed(2)} each — Driveway Gate Post Large)`);
    parts.push(`  Remote fobs × 2: £${(fobPrice * 2).toFixed(2)} (£${fobPrice.toFixed(2)} each)`);

    if (electricMentioned) {
      const frogKit = find(/frog.?x|frog.*2.?leaf|2.?leaf.*kit/i);
      const photocell = find(/photocell|dir\b/i);
      const removeFeet = find(/remove.*feet|feet.*motor|underground.*feet/i);
      const shoes = find(/underground.*shoes|shoes.*underground/i);

      parts.push(`  FROG-X 2-leaf automation kit: £${(frogKit?.helions_price ?? 1364.30).toFixed(2)}`);
      if (photocell) parts.push(`  DIR Photocells: £${photocell.helions_price!.toFixed(2)}`);
      if (removeFeet) parts.push(`  Remove Feet for Underground Motors: £${removeFeet.helions_price!.toFixed(2)}`);
      if (shoes) parts.push(`  Pair of Underground Shoes: £${shoes.helions_price!.toFixed(2)}`);
      parts.push(`  Consumer unit connection: £${rates.consumer_unit_connection.toFixed(2)}`);
    }
  } else {
    // Generic accessories for iron or other categories
    const accessoryCategory = category?.includes('iron') ? 'iron_accessories' : 'aluminium_accessories';
    const { data: accessories } = await supabase
      .from('accessories_pricing')
      .select('item_name, helions_price, category')
      .eq('tenant_id', tenantId)
      .in('category', [accessoryCategory, 'automation'])
      .not('helions_price', 'is', null)
      .order('category')
      .limit(20);

    if (accessories && accessories.length > 0) {
      const accessoryList = (accessories as Accessory[])
        .map((a) => `${a.item_name} £${a.helions_price?.toFixed(2)}`)
        .join(', ');
      parts.push(`Likely accessories: ${accessoryList}`);
    }

    if (electricMentioned && rates.consumer_unit_connection) {
      parts.push(`Note: Always add automation equipment costs separately if electric gates requested. Consumer unit connection: £${rates.consumer_unit_connection.toFixed(2)}`);
    }
  }

  // ── Mixed enquiry: gates + fencing/railings ───────────────────────────────
  const hasFencing = /\b(railing|railings|fence|fencing|featherboard|feather.?edge|close.?board|panel)\b/i.test(userText);
  const hasGates = /\b(gate|gates)\b/i.test(userText);
  if (hasGates && hasFencing) {
    const lengthMatch = userText.match(/(\d+(?:\.\d+)?)\s*(?:linear\s*)?(?:m\b|metres?|meters?)/i);
    const fencingLength = lengthMatch ? parseFloat(lengthMatch[1]) : null;

    parts.push(`\nFENCING/RAILINGS COMPONENT${fencingLength ? ` (${fencingLength}m)` : ' (length unknown — ask customer)'}:`);
    if (fencingLength) {
      parts.push(`  Steel railings to match gates: £${(fencingLength * 180).toFixed(0)}–£${(fencingLength * 280).toFixed(0)} (£180–£280/m installed)`);
      parts.push(`  Timber feather edge: £${(fencingLength * 80).toFixed(0)}–£${(fencingLength * 120).toFixed(0)} (£80–£120/m installed)`);
    } else {
      parts.push(`  Steel railings to match gates: £180–£280/m installed`);
      parts.push(`  Timber feather edge: £80–£120/m installed`);
    }
    parts.push(`  CLARIFYING QUESTION: "For the fencing sections we can supply mild steel railings to complement the gates, or timber close board fencing. Which would you prefer?"`);
  }

  const minimumValue = jobTypeMatch?.minimum_value ?? null;

  if (parts.length === 0) return { context: '', minimumValue };

  return {
    context: `EXACT PRICING DATA — use these figures directly:\n${parts.join('\n')}`,
    minimumValue,
  };
}
