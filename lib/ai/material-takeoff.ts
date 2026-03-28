import { createAdminClient } from '@/lib/supabase/admin';

export interface RailingDims {
  total_length_m: number;
  height_m: number;
  upright_bar_size: string;
  top_rail_section: string;
  bottom_rail_section: string;
  post_size: string;
  post_spacing_m: number;
  upright_bar_spacing_mm: number;
  design_style: string;
  finish?: string;
}

export interface RailingMaterialBreakdown {
  uprights: number;
  upright_lengths: number;
  upright_cost: number;
  top_rail_lengths: number;
  top_rail_cost: number;
  bottom_rail_lengths: number;
  bottom_rail_cost: number;
  posts: number;
  post_lengths: number;
  post_cost: number;
  material_subtotal: number;
  waste_allowance: number;
  total_material_cost: number;
  breakdown_text: string;
}

export interface RailingLabourResult {
  manufacture_days: number;
  install_days: number;
  engineers: number;
  manufacture_cost: number;
  install_cost: number;
  total_labour_cost: number;
}

// Complexity multipliers keyed by design style (lowercase)
const DESIGN_STYLE_MULTIPLIERS: Record<string, number> = {
  'vertical bars': 1.0,
  'vertical with top detail': 1.2,
  'decorative with infill': 1.5,
  'heritage traditional': 1.8,
};

async function lookupMaterialRate(
  supabase: ReturnType<typeof createAdminClient>,
  tenantId: string,
  sectionSize: string
): Promise<number | null> {
  const { data } = await supabase
    .from('materials')
    .select('rate_gbp')
    .eq('tenant_id', tenantId)
    .ilike('name', `%${sectionSize}%`)
    .limit(1)
    .maybeSingle();
  return data?.rate_gbp ?? null;
}

function gbp(n: number) {
  return `£${n.toFixed(2)}`;
}

export async function calculateRailingMaterials(
  dims: RailingDims,
  tenantId: string
): Promise<RailingMaterialBreakdown> {
  const supabase = createAdminClient();

  const {
    total_length_m,
    height_m,
    upright_bar_size,
    top_rail_section,
    bottom_rail_section,
    post_size,
    post_spacing_m,
    upright_bar_spacing_mm,
  } = dims;

  const length_mm = total_length_m * 1000;

  // Uprights — never less than 112mm spacing (covers us)
  const uprights = Math.ceil(length_mm / upright_bar_spacing_mm);
  const upright_metres = uprights * height_m;
  const upright_lengths = Math.ceil(upright_metres / 6); // bar in 6m lengths

  // Top and bottom rails with 10% waste
  const rail_metres = total_length_m * 1.1;
  const top_rail_lengths = Math.ceil(rail_metres / 6);
  const bottom_rail_lengths = Math.ceil(rail_metres / 6);

  // Posts — one at each end and each span
  const posts = Math.ceil(total_length_m / post_spacing_m) + 1;
  const post_height_m = height_m + 0.5; // extra 0.5m for fixing depth
  const post_lengths = Math.ceil((posts * post_height_m) / 7.5); // SHS in 7.5m lengths

  // Fetch material rates in parallel
  const [uprightRate, topRailRate, bottomRailRate, postRate] = await Promise.all([
    lookupMaterialRate(supabase, tenantId, upright_bar_size),
    lookupMaterialRate(supabase, tenantId, top_rail_section),
    lookupMaterialRate(supabase, tenantId, bottom_rail_section),
    lookupMaterialRate(supabase, tenantId, post_size),
  ]);

  const upright_cost = upright_lengths * (uprightRate ?? 0);
  const top_rail_cost = top_rail_lengths * (topRailRate ?? 0);
  const bottom_rail_cost = bottom_rail_lengths * (bottomRailRate ?? 0);
  const post_cost = post_lengths * (postRate ?? 0);

  const material_subtotal = upright_cost + top_rail_cost + bottom_rail_cost + post_cost;
  const waste_allowance = Math.round(material_subtotal * 0.15);
  const total_material_cost = material_subtotal + waste_allowance;

  const breakdown_text = [
    `Uprights (${upright_bar_size}): ${uprights} bars × ${height_m}m = ${upright_metres.toFixed(1)}m → ${upright_lengths} × 6m lengths @ ${gbp(uprightRate ?? 0)} = ${gbp(upright_cost)}`,
    `Top rail (${top_rail_section}): ${total_length_m}m × 1.1 = ${rail_metres.toFixed(1)}m → ${top_rail_lengths} × 6m lengths @ ${gbp(topRailRate ?? 0)} = ${gbp(top_rail_cost)}`,
    `Bottom rail (${bottom_rail_section}): ${rail_metres.toFixed(1)}m → ${bottom_rail_lengths} × 6m lengths @ ${gbp(bottomRailRate ?? 0)} = ${gbp(bottom_rail_cost)}`,
    `Posts (${post_size}): ${posts} posts × ${post_height_m.toFixed(1)}m = ${(posts * post_height_m).toFixed(1)}m → ${post_lengths} × 7.5m lengths @ ${gbp(postRate ?? 0)} = ${gbp(post_cost)}`,
    `Material subtotal: ${gbp(material_subtotal)}`,
    `15% waste/cutting allowance: +${gbp(waste_allowance)}`,
    `Total material cost: ${gbp(total_material_cost)}`,
  ].join('\n');

  return {
    uprights,
    upright_lengths,
    upright_cost,
    top_rail_lengths,
    top_rail_cost,
    bottom_rail_lengths,
    bottom_rail_cost,
    posts,
    post_lengths,
    post_cost,
    material_subtotal,
    waste_allowance,
    total_material_cost,
    breakdown_text,
  };
}

export function calculateRailingLabour(
  total_length_m: number,
  design_style: string,
  fabrication_day_rate: number,
  installation_day_rate: number
): RailingLabourResult {
  // Install days by length band
  const install_days = total_length_m <= 10 ? 2 : 4;
  const engineers = 2;

  // Manufacture days with design complexity multiplier
  const base_days = Math.ceil(total_length_m / 2);
  const multiplier = DESIGN_STYLE_MULTIPLIERS[design_style.toLowerCase().trim()] ?? 1.0;
  const manufacture_days = base_days * multiplier;

  const manufacture_cost = manufacture_days * fabrication_day_rate;
  const install_cost = install_days * engineers * installation_day_rate;
  const total_labour_cost = manufacture_cost + install_cost;

  return {
    manufacture_days,
    install_days,
    engineers,
    manufacture_cost,
    install_cost,
    total_labour_cost,
  };
}

export interface CostBreakdown {
  material_cost: number;
  manufacture_cost: number;
  manufacture_days: number;
  install_cost: number;
  install_days: number;
  engineers: number;
  finishing_cost: number;
  subtotal: number;
  contingency: number;
}

export function buildRailingPromptSection(
  materialBreakdown: RailingMaterialBreakdown,
  labourResult: RailingLabourResult,
  fabricationRate: number,
  installationRate: number,
  finish: string
): string {
  const totalPreFinishing =
    materialBreakdown.total_material_cost + labourResult.total_labour_cost;

  return `EXACT CALCULATED COSTS — use these directly:
${materialBreakdown.breakdown_text}

Labour:
  Manufacture: ${gbp(labourResult.manufacture_cost)} (${labourResult.manufacture_days} days × £${fabricationRate})
  Installation: ${gbp(labourResult.install_cost)} (${labourResult.install_days} days × ${labourResult.engineers} engineers × £${installationRate})

Total materials + labour (excl. finishing): ${gbp(totalPreFinishing)}

IMPORTANT: Only estimate the finishing cost for "${finish}" and apply 10% contingency.
Do NOT re-estimate material quantities or labour. Use the exact costs above.
price_low and price_high should reflect: materials + labour + finishing + 10% contingency (±5% variance).

Include these ADDITIONAL fields in your JSON response:
"finishing_cost": <your GBP estimate for ${finish} finishing>,
"cost_breakdown": {
  "material_cost": ${materialBreakdown.total_material_cost.toFixed(2)},
  "manufacture_cost": ${labourResult.manufacture_cost.toFixed(2)},
  "manufacture_days": ${labourResult.manufacture_days},
  "install_cost": ${labourResult.install_cost.toFixed(2)},
  "install_days": ${labourResult.install_days},
  "engineers": ${labourResult.engineers},
  "finishing_cost": <same as above>,
  "subtotal": <material_cost + manufacture_cost + install_cost + finishing_cost>,
  "contingency": <subtotal × 0.10>
}`;
}
