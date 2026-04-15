import Anthropic from '@anthropic-ai/sdk';
import { createAdminClient } from '@/lib/supabase/admin';
import type { QuoteParams, QuoteResult } from './quote-engine';

export type { QuoteParams };

// ── Types ──────────────────────────────────────────────────────────────────

export interface ExtractedSpec {
  product_type:
    | 'iron_driveway_gates'
    | 'aluminium_driveway_gates'
    | 'iron_pedestrian_gate'
    | 'aluminium_pedestrian_gate'
    | 'railings'
    | 'wall_top_railings'
    | 'handrails'
    | 'juliette_balcony'
    | 'unknown';
  material: 'mild_steel' | 'aluminium' | 'unknown';
  is_electric: boolean | null;
  width_mm: number | null;
  height_mm: number | null;
  length_m: number | null;
  design_name: string | null;
  has_automation: boolean | null;
  has_intercom: boolean | null;
  installation_included: boolean | null;
  quantity: number | null;
  items: Array<{ width_mm: number | null; height_mm: number | null }> | null;
  confidence_per_field: Record<string, 'confirmed' | 'assumed' | 'unknown'>;
}

export interface DeterministicBreakdown {
  product_supply: number;
  manufacture: number;
  installation: number;
  accessories: Array<{ name: string; amount: number }>;
  accessories_total: number;
  subtotal: number;
  contingency: number;
  price_low: number;
  price_high: number;
  minimum_applied: number | null;
  job_type_matched: string | null;
  product_matched: string | null;
  notes: string[];
}

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// ── Step 1: Claude Haiku extraction ───────────────────────────────────────

async function extractSpec(enquiryText: string): Promise<ExtractedSpec> {
  const message = await anthropic.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 1024,
    messages: [
      {
        role: 'user',
        content: `You are a metalwork quoting assistant for a UK bespoke gates and railings business.
Extract structured data from this enquiry.

Return ONLY valid JSON with this exact shape:
{
  "product_type": "iron_driveway_gates" | "aluminium_driveway_gates" | "iron_pedestrian_gate" | "aluminium_pedestrian_gate" | "railings" | "wall_top_railings" | "handrails" | "juliette_balcony" | "unknown",
  "material": "mild_steel" | "aluminium" | "unknown",
  "is_electric": true | false | null,
  "width_mm": number | null,
  "height_mm": number | null,
  "length_m": number | null,
  "design_name": string | null,
  "has_automation": true | false | null,
  "has_intercom": true | false | null,
  "installation_included": true | false | null,
  "quantity": number | null,
  "items": [{"width_mm": number | null, "height_mm": number | null}] | null,
  "confidence_per_field": {
    "product_type": "confirmed" | "assumed" | "unknown",
    "material": "confirmed" | "assumed" | "unknown",
    "is_electric": "confirmed" | "assumed" | "unknown",
    "width_mm": "confirmed" | "assumed" | "unknown",
    "height_mm": "confirmed" | "assumed" | "unknown",
    "length_m": "confirmed" | "assumed" | "unknown",
    "design_name": "confirmed" | "assumed" | "unknown",
    "has_automation": "confirmed" | "assumed" | "unknown",
    "has_intercom": "confirmed" | "assumed" | "unknown",
    "installation_included": "confirmed" | "assumed" | "unknown"
  }
}

Confidence rules:
- "confirmed": explicitly stated by the customer
- "assumed": logically inferred (e.g. "electric gates" → has_automation = true, assumed)
- "unknown": not mentioned, cannot be inferred

Conversion rules:
- width/height: always output in millimetres
- If given in metres: multiply by 1000. In cm: multiply by 10. In feet: multiply by 304.8.
- design_name: gate design names like Norfolk, Surrey, Hertfordshire, Essex, etc.
- installation_included: default assumed true unless customer says collect/supply-only
- quantity: number of gates/units requested. Set to 2 if "pair", "two", "both" mentioned. Default null (treated as 1).
- items: if multiple sets of dimensions are listed, output each as an object. If only one set (or none), set to null. width_mm and height_mm in each item use the same mm conversion rules.

Enquiry text:
${enquiryText}`,
      },
    ],
  });

  const content = message.content[0];
  if (content.type !== 'text') throw new Error('[det-engine] Unexpected Haiku response type');
  const match = content.text.match(/\{[\s\S]*\}/);
  if (!match) throw new Error('[det-engine] No JSON in Haiku extraction response');
  return JSON.parse(match[0]) as ExtractedSpec;
}

// ── Step 6: Deterministic confidence ──────────────────────────────────────

function calculateConfidence(
  spec: ExtractedSpec,
  productFound: boolean,
  noDimensions: boolean
): 'low' | 'medium' | 'high' {
  // No dimensions at all → always low confidence
  if (noDimensions) return 'low';

  const values = Object.values(spec.confidence_per_field);
  const confirmed = values.filter((v) => v === 'confirmed').length;
  const ratio = confirmed / values.length;

  if (ratio > 0.8 && productFound) return 'high';
  if (ratio >= 0.5 || productFound) return 'medium';
  return 'low';
}

// Maps product_type → product_pricing.category string
const PRODUCT_TYPE_CATEGORY: Partial<Record<ExtractedSpec['product_type'], string>> = {
  iron_driveway_gates: 'iron_driveway_gates',
  aluminium_driveway_gates: 'aluminium_driveway_gates',
  iron_pedestrian_gate: 'iron_pedestrian_gates',
  aluminium_pedestrian_gate: 'aluminium_pedestrian_gates',
};

// ── Helpers ────────────────────────────────────────────────────────────────

type ProductRow = {
  design_name: string | null;
  width_mm: number | null;
  height_mm: number | null;
  price_gbp: number | null;
  category: string;
};

/** Returns the median product by price_gbp (middle index after ascending sort). */
function getMedianProduct(products: ProductRow[]): ProductRow | null {
  if (products.length === 0) return null;
  const sorted = [...products].sort((a, b) => (a.price_gbp ?? 0) - (b.price_gbp ?? 0));
  return sorted[Math.floor(sorted.length / 2)];
}

/**
 * Finds the smallest product where width_mm >= requested_width AND height_mm >= requested_height.
 * If no product meets both constraints, returns the largest available product.
 * Products with null dimensions are excluded when a dimension requirement is specified.
 */
function findSmallestFittingProduct(
  products: ProductRow[],
  width_mm: number | null,
  height_mm: number | null
): ProductRow | null {
  if (products.length === 0) return null;

  console.log(
    `[det-engine] findSmallestFittingProduct: requested ${width_mm ?? '?'}mm × ${height_mm ?? '?'}mm, ` +
    `candidates: ${JSON.stringify(products.map(p => `${p.width_mm ?? 'null'}×${p.height_mm ?? 'null'} £${p.price_gbp ?? 'null'}`))}`
  );

  // Filter to products that are at least as large as requested in both dimensions.
  // Exclude products with null dimensions when a dimension requirement is specified
  // (null-dimension rows have area=0 and would otherwise sort first).
  const fitting = products.filter((p) => {
    if (width_mm && !p.width_mm) return false;
    if (height_mm && !p.height_mm) return false;
    const widthOk = !width_mm || p.width_mm! >= width_mm;
    const heightOk = !height_mm || p.height_mm! >= height_mm;
    return widthOk && heightOk;
  });

  console.log(
    `[det-engine] findSmallestFittingProduct: ${fitting.length} fitting product(s) found: ` +
    `${JSON.stringify(fitting.map(p => `${p.width_mm ?? 'null'}×${p.height_mm ?? 'null'} £${p.price_gbp ?? 'null'}`))}`
  );

  if (fitting.length > 0) {
    // Pick smallest fitting product — sort by width ASC, then height ASC (matches SQL ORDER BY)
    const sorted = [...fitting].sort((a, b) => {
      if ((a.width_mm ?? 0) !== (b.width_mm ?? 0)) return (a.width_mm ?? 0) - (b.width_mm ?? 0);
      return (a.height_mm ?? 0) - (b.height_mm ?? 0);
    });
    console.log(`[det-engine] findSmallestFittingProduct: selected ${sorted[0].width_mm ?? '?'}mm × ${sorted[0].height_mm ?? '?'}mm £${sorted[0].price_gbp ?? '?'}`);
    return sorted[0];
  }

  // No product is large enough — use the largest available
  const sorted = [...products].sort((a, b) => {
    const aArea = (a.width_mm ?? 0) * (a.height_mm ?? 0);
    const bArea = (b.width_mm ?? 0) * (b.height_mm ?? 0);
    return bArea - aArea;
  });
  console.log(`[det-engine] findSmallestFittingProduct: no fitting product — using largest available ${sorted[0].width_mm ?? '?'}mm × ${sorted[0].height_mm ?? '?'}mm`);
  return sorted[0];
}

// ── Main engine ────────────────────────────────────────────────────────────

export async function runDeterministicEngine(params: QuoteParams): Promise<{
  result: QuoteResult;
  spec: ExtractedSpec;
  breakdown: DeterministicBreakdown;
}> {
  const { enquiry_text, tenant_id, complexity_multiplier = 1.0 } = params;
  const supabase = createAdminClient();

  // ── Step 1: Extract structured spec ───────────────────────────────────────
  const spec = await extractSpec(enquiry_text);

  // Resolve category for this product type
  const productCategory = PRODUCT_TYPE_CATEGORY[spec.product_type] ?? null;
  console.log(
    `[det-engine] product_type="${spec.product_type}" → category="${productCategory ?? 'none'}" design_name="${spec.design_name ?? 'none'}" quantity=${spec.quantity ?? 1}`
  );

  // Build product pricing query:
  //   - design_name known → filter by design name (precise match)
  //   - no design_name but category known → fetch all products in category for median/closest-size match
  //   - otherwise → no product data
  const productQuery = spec.design_name
    ? supabase
        .from('product_pricing')
        .select('design_name, width_mm, height_mm, price_gbp, category')
        .eq('tenant_id', tenant_id)
        .ilike('design_name', `%${spec.design_name}%`)
        .not('price_gbp', 'is', null)
    : productCategory
    ? supabase
        .from('product_pricing')
        .select('design_name, width_mm, height_mm, price_gbp, category')
        .eq('tenant_id', tenant_id)
        .eq('category', productCategory)
        .not('price_gbp', 'is', null)
    : Promise.resolve({ data: [] as ProductRow[] });

  // Fetch master rates, job types, and product pricing in parallel
  const [ratesRes, jobTypesRes, productRows] = await Promise.all([
    supabase
      .from('master_rates')
      .select(
        'fabrication_day_rate, installation_day_rate, consumer_unit_connection, minimum_job_value, design_fee'
      )
      .eq('tenant_id', tenant_id)
      .single(),

    supabase
      .from('job_types')
      .select('job_type, minimum_value, manufacture_days, install_days, engineers_required')
      .eq('tenant_id', tenant_id),

    productQuery,
  ]);

  const rates = ratesRes.data;
  const fabricationRate = rates?.fabrication_day_rate ?? 507;
  const installRate = rates?.installation_day_rate ?? 523.84;

  // ── Step 2: Product lookup ─────────────────────────────────────────────────
  let productSupplyCost = 0;
  let productFound = false;
  let productMatchedName: string | null = null;
  const productNotes: string[] = [];

  const products = (productRows.data ?? []) as ProductRow[];
  const quantity = spec.quantity ?? 1;

  // Build the list of items to price. If spec.items has multiple entries, use those.
  // Otherwise treat it as a single item using top-level width_mm / height_mm.
  const multipleItems =
    spec.items && spec.items.length > 1
      ? spec.items
      : null;

  const singleWidth = spec.width_mm;
  const singleHeight = spec.height_mm;
  const hasDimensions = !!(singleWidth || singleHeight || multipleItems);

  console.log(`[det-engine] Product rows fetched: ${products.length}, quantity=${quantity}, multipleItems=${multipleItems?.length ?? 'no'}`);

  if (products.length > 0) {
    if (multipleItems) {
      // ── Case: Multiple items with distinct dimensions — price each separately ──
      for (const item of multipleItems) {
        const best = findSmallestFittingProduct(products, item.width_mm, item.height_mm);
        if (best && best.price_gbp) {
          productSupplyCost += best.price_gbp;
          productFound = true;
          const isRoundedUp =
            (item.width_mm && best.width_mm && best.width_mm > item.width_mm) ||
            (item.height_mm && best.height_mm && best.height_mm > item.height_mm);
          if (isRoundedUp) {
            productNotes.push(
              `Item ${multipleItems.indexOf(item) + 1}: rounded up to next available size (${item.width_mm ?? '?'}mm × ${item.height_mm ?? '?'}mm → ${best.width_mm ?? '?'}mm × ${best.height_mm ?? '?'}mm)`
            );
          }
        }
      }
      if (productFound) {
        productMatchedName = spec.design_name ?? null;
        productNotes.push(`Priced as ${multipleItems.length} separate items`);
      }
    } else if (spec.design_name) {
      // ── Case A: Design name known ─────────────────────────────────────────
      if (hasDimensions) {
        // Find smallest product that fits the requested dimensions (round up)
        const best = findSmallestFittingProduct(products, singleWidth, singleHeight);
        if (best && best.price_gbp) {
          productSupplyCost = best.price_gbp * quantity;
          productFound = true;
          productMatchedName = best.design_name ?? spec.design_name;
          const isRoundedUp =
            (singleWidth && best.width_mm && best.width_mm > singleWidth) ||
            (singleHeight && best.height_mm && best.height_mm > singleHeight);
          const isLargestAvailable =
            !!(singleWidth && best.width_mm && best.width_mm < singleWidth) ||
            !!(singleHeight && best.height_mm && best.height_mm < singleHeight);
          if (isLargestAvailable) {
            const note =
              `No product available at or above requested size (${singleWidth ?? '?'}mm × ${singleHeight ?? '?'}mm) — largest available used` +
              (best.width_mm || best.height_mm
                ? ` (${best.width_mm ?? '?'}mm × ${best.height_mm ?? '?'}mm)`
                : '');
            productNotes.push(note);
          } else if (isRoundedUp) {
            const note =
              `Rounded up to next available size — no exact match for ${singleWidth ?? '?'}mm × ${singleHeight ?? '?'}mm` +
              (best.width_mm || best.height_mm
                ? ` (matched ${best.width_mm ?? '?'}mm × ${best.height_mm ?? '?'}mm)`
                : '');
            productNotes.push(note);
          }
          if (quantity > 1) productNotes.push(`Quantity: ${quantity}`);
        }
      } else {
        // Design known but no dimensions → median price
        const median = getMedianProduct(products);
        if (median?.price_gbp) {
          productSupplyCost = median.price_gbp * quantity;
          productFound = true;
          productMatchedName = spec.design_name;
          productNotes.push('Dimensions not provided — mid-range estimate used');
          if (quantity > 1) productNotes.push(`Quantity: ${quantity}`);
        }
      }
    } else {
      // ── Case B: No design name → median price ─────────────────────────────
      const median = getMedianProduct(products);
      if (median?.price_gbp) {
        productSupplyCost = median.price_gbp * quantity;
        productFound = true;
        productMatchedName = null;
        const cat = productCategory?.replace(/_/g, ' ') ?? 'product';
        productNotes.push(`Mid-range ${cat} price used — design not specified`);
        if (!hasDimensions) {
          productNotes.push('Dimensions not provided — mid-range estimate used');
        }
        if (quantity > 1) productNotes.push(`Quantity: ${quantity}`);
      }
    }
  }

  console.log(
    `[det-engine] Product supply: £${Math.round(productSupplyCost)} productFound=${productFound} notes=${JSON.stringify(productNotes)}`
  );
  // DEBUG: product lookup diagnostics
  console.log('PRODUCT QUERY:', `width >= ${spec.width_mm}, height >= ${spec.height_mm}`);
  console.log('PRODUCT FOUND:', productMatchedName, `£${productSupplyCost}`);

  // ── Step 3: Job type matching ─────────────────────────────────────────────
  type JobTypeRow = {
    job_type: string;
    minimum_value: number | null;
    manufacture_days: number | null;
    install_days: number | null;
    engineers_required: number | null;
  };

  const allJobTypes = (jobTypesRes.data ?? []) as JobTypeRow[];
  console.log(
    '[det-engine] All job_types rows:',
    JSON.stringify(
      allJobTypes.map((jt) => ({
        job_type: jt.job_type,
        manufacture_days: jt.manufacture_days,
        install_days: jt.install_days,
        engineers_required: jt.engineers_required,
        minimum_value: jt.minimum_value,
      }))
    )
  );

  const isAluminium = spec.material === 'aluminium';
  const isElectric = spec.is_electric === true || spec.has_automation === true;

  let bestJobType: JobTypeRow | null = null;
  let bestScore = 0;

  for (const jt of allJobTypes) {
    const jtLower = jt.job_type.toLowerCase();
    let score = 0;

    if (isAluminium && /alumin/.test(jtLower)) score += 3;
    if (!isAluminium && /\b(iron|mild.?steel)\b/.test(jtLower)) score += 3;
    if (isElectric && /electric|automat/.test(jtLower)) score += 3;
    if (!isElectric && spec.is_electric !== null && !/electric|automat/.test(jtLower)) score += 2;
    if (spec.product_type.includes('pedestrian') && /pedestrian/.test(jtLower)) score += 3;
    if (
      (spec.product_type.includes('driveway') || spec.product_type.includes('gates')) &&
      /driveway/.test(jtLower)
    )
      score += 2;
    if (spec.product_type.includes('railing') && /railing/.test(jtLower)) score += 3;
    if (spec.product_type.includes('handrail') && /handrail/.test(jtLower)) score += 3;
    if (spec.product_type.includes('juliette') && /juliette/.test(jtLower)) score += 3;
    if (spec.product_type.includes('wall_top') && /wall.?top/.test(jtLower)) score += 3;

    if (score > bestScore) {
      bestScore = score;
      bestJobType = jt;
    }
  }

  // Special override: aluminium driveway gates default to "concrete in posts" unless enquiry
  // explicitly says "brick to brick" or "no posts".
  if (spec.product_type === 'aluminium_driveway_gates') {
    const isBrickToBrick = /brick.?to.?brick|no posts/i.test(enquiry_text);
    if (!isBrickToBrick) {
      const concreteInPosts = allJobTypes.find((jt) => /concrete.?in.?posts?/i.test(jt.job_type));
      if (concreteInPosts) {
        console.log(
          `[det-engine] Aluminium driveway gate — overriding job type to "${concreteInPosts.job_type}" (posts assumed unless "brick to brick" specified)`
        );
        bestJobType = concreteInPosts;
      }
    } else {
      console.log(`[det-engine] Aluminium driveway gate — "brick to brick" detected, keeping scored job type`);
    }
  }

  console.log(
    `[det-engine] Job type matched: "${bestJobType?.job_type ?? 'none'}" manufacture_days=${bestJobType?.manufacture_days ?? 'null'} install_days=${bestJobType?.install_days ?? 'null'} engineers=${bestJobType?.engineers_required ?? 'null'} min_value=£${bestJobType?.minimum_value ?? 'null'}`
  );
  // DEBUG: job type diagnostics
  console.log('POSTS DETECTED:', spec.has_posts);
  console.log('JOB TYPE MATCHED:', bestJobType?.job_type);
  console.log('INSTALL DAYS:', bestJobType?.install_days);
  console.log('ENGINEERS:', bestJobType?.engineers_required);

  // Multi-pedestrian gate (qty >= 2): 1 day, 2 engineers, no quantity multiplication
  const isMultiPedestrianGate = quantity >= 2 && spec.product_type.includes('pedestrian');
  const effectiveInstallDays = isMultiPedestrianGate ? 1 : (bestJobType?.install_days ?? 0);
  const effectiveEngineers = isMultiPedestrianGate ? 2 : (bestJobType?.engineers_required ?? 1);
  const installCost = bestJobType
    ? effectiveInstallDays * installRate * effectiveEngineers
    : 0;

  // ── Manufacture cost — only for bespoke jobs (no product match) ────────────
  // Named gate products (aluminium AND iron) include all fabrication cost in their
  // product price. Manufacture cost only applies when productSupplyCost = 0.
  let manufactureCost = 0;

  if (!productFound) {
    // Resolve manufacture days for bespoke fallback
    const dbManufactureDays = bestJobType?.manufacture_days ?? null;
    let resolvedManufactureDays: number;

    if (!isAluminium && spec.product_type === 'iron_driveway_gates' && !dbManufactureDays) {
      resolvedManufactureDays = isElectric ? 4 : 2;
      console.log(
        `[det-engine] Bespoke iron gate — manufacture_days ${dbManufactureDays === null ? 'null' : '0'} in DB, applying fallback: ${resolvedManufactureDays} days (isElectric=${isElectric})`
      );
    } else {
      resolvedManufactureDays = dbManufactureDays ?? 0;
    }

    const adjustedManufactureDays = isAluminium
      ? resolvedManufactureDays
      : resolvedManufactureDays * complexity_multiplier;

    manufactureCost = adjustedManufactureDays * fabricationRate;
    console.log(
      `[det-engine] Bespoke manufacture: days=${adjustedManufactureDays} × rate=£${fabricationRate} = £${Math.round(manufactureCost)}`
    );
  } else {
    console.log('[det-engine] Named product found — manufacture cost included in product price, skipping separate charge');
  }

  // Expose adjusted manufacture days for the cost_breakdown output
  const adjustedManufactureDays = productFound
    ? 0
    : (() => {
        const dbDays = bestJobType?.manufacture_days ?? null;
        let days: number;
        if (!isAluminium && spec.product_type === 'iron_driveway_gates' && !dbDays) {
          days = isElectric ? 4 : 2;
        } else {
          days = dbDays ?? 0;
        }
        return isAluminium ? days : days * complexity_multiplier;
      })();

  // ── Step 4: Auto-include standard accessories ──────────────────────────────
  const accessoryCategories = isAluminium
    ? ['aluminium_accessories', 'automation']
    : ['iron_accessories', 'automation'];

  const { data: allAcc } = await supabase
    .from('accessories_pricing')
    .select('item_name, helions_price, category')
    .eq('tenant_id', tenant_id)
    .in('category', accessoryCategories)
    .not('helions_price', 'is', null);

  type AccRow = { item_name: string; helions_price: number; category: string };
  const acc = (allAcc ?? []) as AccRow[];
  const findAcc = (pattern: RegExp) => acc.find((a) => pattern.test(a.item_name));
  const accessories: Array<{ name: string; amount: number }> = [];

  const isGateProduct =
    spec.product_type.includes('gate') ||
    spec.product_type.includes('driveway') ||
    spec.product_type.includes('pedestrian');
  const isDrivewayGate = spec.product_type.includes('driveway');
  const isPedestrianGate = spec.product_type.includes('pedestrian');

  if (isGateProduct) {
    // Driveway gates always use Large posts; other gate types use any gate post
    const post = isDrivewayGate
      ? findAcc(/large.*post|post.*large/i)
      : findAcc(/gate.*post|post.*gate/i);
    if (post) accessories.push({ name: `Gate posts × 2`, amount: post.helions_price * 2 });

    if (isElectric) {
      const fob = findAcc(/remote.*fob|fob/i);
      if (fob) accessories.push({ name: `Remote fobs × 2`, amount: fob.helions_price * 2 });

      const motorKit = findAcc(/frog.?x|frog.*2.?leaf|2.?leaf.*kit|motor.*kit/i);
      if (motorKit) accessories.push({ name: motorKit.item_name, amount: motorKit.helions_price });

      const photocell = findAcc(/photocell|dir\b/i);
      if (photocell) accessories.push({ name: photocell.item_name, amount: photocell.helions_price });

      const shoes = findAcc(/underground.*shoes|shoes.*underground/i);
      if (shoes) accessories.push({ name: shoes.item_name, amount: shoes.helions_price });

      if (rates?.consumer_unit_connection) {
        accessories.push({ name: 'Consumer unit connection', amount: rates.consumer_unit_connection });
      }
    }

    // Aluminium gates: add custom size fee
    // item_name prefix: "DG" = driveway gate (£140), "PG" = pedestrian gate (£70)
    if (isAluminium) {
      const customSizeItems = acc.filter(
        (a) => /custom.?size/i.test(a.item_name) && a.category === 'aluminium_accessories'
      );
      console.log(`[det-engine] Custom size candidates: ${JSON.stringify(customSizeItems.map(a => `${a.item_name} £${a.helions_price}`))}`);
      if (isDrivewayGate) {
        // DG prefix = driveway gate row
        const customSizeRow =
          customSizeItems.find((a) => /^DG/i.test(a.item_name)) ??
          customSizeItems.find((a) => /driveway/i.test(a.item_name)) ??
          customSizeItems.find((a) => !/^PG/i.test(a.item_name)) ??
          customSizeItems[0];
        const customSizeAmount = customSizeRow?.helions_price ?? 140;
        console.log(`[det-engine] Driveway gate custom size fee: "${customSizeRow?.item_name ?? 'fallback'}" £${customSizeAmount}`);
        // DEBUG: custom size item diagnostics
        console.log('CUSTOM SIZE ITEM:', customSizeRow?.item_name, customSizeRow?.helions_price);
        accessories.push({ name: 'Custom size fee', amount: customSizeAmount });
      } else if (isPedestrianGate) {
        // PG prefix = pedestrian gate row
        const customSizeRow =
          customSizeItems.find((a) => /^PG/i.test(a.item_name)) ??
          customSizeItems.find((a) => /pedestrian/i.test(a.item_name)) ??
          customSizeItems.find((a) => !/^DG/i.test(a.item_name)) ??
          customSizeItems[0];
        const customSizeAmount = customSizeRow?.helions_price ?? 70;
        console.log(`[det-engine] Pedestrian gate custom size fee: "${customSizeRow?.item_name ?? 'fallback'}" £${customSizeAmount}`);
        // DEBUG: custom size item diagnostics
        console.log('CUSTOM SIZE ITEM:', customSizeRow?.item_name, customSizeRow?.helions_price);
        accessories.push({ name: 'Custom size fee', amount: customSizeAmount });
      }
    }
  }

  // Design fee — added on every job
  const designFee = (rates as (typeof rates & { design_fee?: number | null }))?.design_fee ?? null;
  if (designFee) {
    accessories.push({ name: 'Design fee', amount: designFee });
  }

  const accessoriesTotal = accessories.reduce((sum, a) => sum + a.amount, 0);

  // ── Step 5: Minimum value ──────────────────────────────────────────────────
  const minimum = bestJobType?.minimum_value ?? rates?.minimum_job_value ?? 0;

  // ── Step 6: Confidence score ───────────────────────────────────────────────
  const noDimensions = !hasDimensions;
  const confidence = calculateConfidence(spec, productFound, noDimensions);

  // ── Step 7: Price range ────────────────────────────────────────────────────
  const rangeMultiplier = confidence === 'high' ? 0.1 : confidence === 'medium' ? 0.2 : 0.35;

  const basePrice = productSupplyCost + manufactureCost + installCost + accessoriesTotal;
  const contingency = Math.round(basePrice * 0.05);
  const total = basePrice + contingency;

  const rawLow = Math.round(total * (1 - rangeMultiplier));
  const rawHigh = Math.round(total * (1 + rangeMultiplier));
  const price_low = Math.max(minimum, rawLow);
  const price_high = Math.max(price_low + 1, rawHigh);

  // ── Step 8: Cost breakdown ─────────────────────────────────────────────────
  const breakdown: DeterministicBreakdown = {
    product_supply: Math.round(productSupplyCost),
    manufacture: Math.round(manufactureCost),
    installation: Math.round(installCost),
    accessories,
    accessories_total: Math.round(accessoriesTotal),
    subtotal: Math.round(basePrice),
    contingency,
    price_low,
    price_high,
    minimum_applied: price_low > rawLow ? minimum : null,
    job_type_matched: bestJobType?.job_type ?? null,
    product_matched: productMatchedName,
    notes: productNotes,
  };

  // ── Step 9: Haiku explanation ──────────────────────────────────────────────
  const unknownFields = Object.entries(spec.confidence_per_field)
    .filter(([, v]) => v === 'unknown')
    .map(([k]) => k);

  let reasoning =
    `Deterministic estimate: product supply £${Math.round(productSupplyCost).toLocaleString()}, ` +
    `manufacture £${Math.round(manufactureCost).toLocaleString()}, ` +
    `installation £${Math.round(installCost).toLocaleString()}, ` +
    `accessories £${Math.round(accessoriesTotal).toLocaleString()}.`;
  let missing_info: string[] = unknownFields.map((f) => `Please confirm: ${f.replace(/_/g, ' ')}`);

  try {
    const explanationMsg = await anthropic.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 512,
      messages: [
        {
          role: 'user',
          content: `You are a UK metalwork quoting assistant. Write a short explanation of this estimate and any clarifying questions needed.

Job:
- Product: ${spec.product_type.replace(/_/g, ' ')}
- Material: ${spec.material.replace(/_/g, ' ')}
- Automated: ${isElectric ? 'yes' : spec.is_electric === null ? 'unknown' : 'no'}
- Design: ${spec.design_name ?? 'not specified'}
- Width: ${spec.width_mm ? spec.width_mm + 'mm' : 'unknown'}
- Height: ${spec.height_mm ? spec.height_mm + 'mm' : 'unknown'}
- Quantity: ${quantity}
- Confidence: ${confidence}
- Price range: £${price_low.toLocaleString()} – £${price_high.toLocaleString()}
${productNotes.length > 0 ? `- Pricing notes: ${productNotes.join('; ')}` : ''}

Line items: product £${Math.round(productSupplyCost).toLocaleString()}, manufacture £${Math.round(manufactureCost).toLocaleString()}, install £${Math.round(installCost).toLocaleString()}, accessories £${Math.round(accessoriesTotal).toLocaleString()}
Unknown fields: ${unknownFields.length > 0 ? unknownFields.join(', ') : 'none'}

Return JSON only:
{"reasoning": "2-3 sentence plain English explanation", "missing_info": ["question for each unknown field"]}`,
        },
      ],
    });

    const ec = explanationMsg.content[0];
    if (ec.type === 'text') {
      const m = ec.text.match(/\{[\s\S]*\}/);
      if (m) {
        const r = JSON.parse(m[0]) as { reasoning?: string; missing_info?: string[] };
        if (r.reasoning) reasoning = r.reasoning;
        if (r.missing_info) missing_info = r.missing_info;
      }
    }
  } catch (err) {
    console.error('[det-engine] Explanation step failed (non-fatal):', err);
  }

  const result: QuoteResult = {
    price_low,
    price_high,
    confidence,
    reasoning,
    missing_info,
    product_type: spec.product_type,
    material: spec.material,
    quote_mode: productFound ? 'precise' : 'rough',
    similar_quotes: [],
    cost_breakdown: {
      material_cost: Math.round(productSupplyCost),
      manufacture_cost: Math.round(manufactureCost),
      manufacture_days: adjustedManufactureDays,
      install_cost: Math.round(installCost),
      install_days: effectiveInstallDays,
      engineers: effectiveEngineers,
      finishing_cost: 0,
      subtotal: Math.round(basePrice),
      contingency,
    },
  };

  return { result, spec, breakdown };
}

export async function generateDeterministicQuote(params: QuoteParams): Promise<QuoteResult> {
  const { result } = await runDeterministicEngine(params);
  return result;
}
