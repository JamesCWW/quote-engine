'use client';

import { useEffect, useState, useCallback } from 'react';
import { useSearchParams } from 'next/navigation';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface AccessoryLine {
  name: string;
  amount: number;
}

interface DetBreakdown {
  product_supply?: number;
  manufacture?: number;
  installation?: number;
  design_fee?: number;
  accessories?: AccessoryLine[];
  subtotal?: number;
  contingency?: number;
}

interface LineItem {
  key: string;
  label: string;
  amount: number;
}

interface EstimateData {
  tenant_id: string;
  customer_name: string;
  customer_email?: string;
  project_summary: string;
  price_low: number;
  price_high: number;
  breakdown?: DetBreakdown;
  components?: unknown[];
  valid_days?: number;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function fmtGBP(n: number) {
  return '£' + Math.round(n).toLocaleString('en-GB');
}

// Strip detail suffixes like ": 0.5 days × £523 × 2 engineers" or " (0.5 days × £507)"
function cleanLabel(name: string): string {
  return name.replace(/\s*[:(].*$/, '').trim();
}

function buildLineItems(breakdown: DetBreakdown | undefined): LineItem[] {
  if (!breakdown) return [];
  const items: LineItem[] = [];
  if (breakdown.product_supply) items.push({ key: 'product_supply', label: 'Product supply', amount: breakdown.product_supply });
  if (breakdown.manufacture)    items.push({ key: 'manufacture',    label: 'Manufacture',    amount: breakdown.manufacture });
  // design_fee excluded from customer-facing view (shown as checkbox instead)
  if (breakdown.accessories?.length) {
    breakdown.accessories
      .filter(a => !a.name.toLowerCase().includes('design fee') && !a.name.toLowerCase().includes('design_fee'))
      .forEach((a, i) =>
        items.push({ key: `accessory_${i}`, label: cleanLabel(a.name).replace(/×/g, 'x'), amount: a.amount })
      );
  }
  if (breakdown.installation)   items.push({ key: 'installation',   label: 'Installation',   amount: breakdown.installation });
  return items;
}

// ---------------------------------------------------------------------------
// Page component
// ---------------------------------------------------------------------------

export default function EstimateEditPage() {
  const searchParams = useSearchParams();

  const [estimateData, setEstimateData] = useState<EstimateData | null>(null);
  const [parseError, setParseError] = useState<string | null>(null);

  // Section A — Summary
  const [summary, setSummary] = useState('');
  const [tidying, setTidying] = useState(false);

  // Section B — Line items
  const [lineItems, setLineItems] = useState<LineItem[]>([]);
  const [includeDesignFee, setIncludeDesignFee] = useState(false);

  const DESIGN_FEE = 220;

  // Derived totals
  const subtotal    = lineItems.reduce((s, i) => s + i.amount, 0);
  const contingency = Math.round(subtotal * 0.05);
  const total       = subtotal + contingency;

  // Section C — Price display
  const [showRange, setShowRange]   = useState(true);
  const [priceLow, setPriceLow]     = useState(0);
  const [priceHigh, setPriceHigh]   = useState(0);
  const [singlePrice, setSinglePrice] = useState(0);

  // Section D — Status
  const [generating, setGenerating] = useState(false);
  const [pdfUrl, setPdfUrl]         = useState<string | null>(null);
  const [genError, setGenError]     = useState<string | null>(null);

  // Parse incoming data from query param
  useEffect(() => {
    const raw = searchParams.get('data');
    if (!raw) {
      setParseError('No estimate data provided. Please return to Gmail and try again.');
      return;
    }
    try {
      const json: EstimateData = JSON.parse(atob(raw));
      setEstimateData(json);
      setSummary(json.project_summary || '');
      const items = buildLineItems(json.breakdown);
      setLineItems(items);
      setIncludeDesignFee(false);
      setPriceLow(json.price_low ?? 0);
      setPriceHigh(json.price_high ?? 0);
      setSinglePrice(Math.round(((json.price_low ?? 0) + (json.price_high ?? 0)) / 2));
    } catch {
      setParseError('Failed to parse estimate data. The link may be malformed.');
    }
  }, [searchParams]);

  // ── Section A: Tidy up with AI ─────────────────────────────────────────────

  const handleTidy = useCallback(async () => {
    setTidying(true);
    try {
      const res = await fetch('/api/estimates/tidy-summary', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ summary }),
      });
      const json = await res.json();
      if (json.tidied_summary) setSummary(json.tidied_summary);
    } catch {
      // silent — user can retry
    } finally {
      setTidying(false);
    }
  }, [summary]);

  // ── Section B: Update line item amount / design fee toggle ───────────────

  function updateAmount(key: string, value: string) {
    const num = parseFloat(value) || 0;
    setLineItems(prev => prev.map(item => item.key === key ? { ...item, amount: num } : item));
  }

  function handleDesignFeeToggle(checked: boolean) {
    setIncludeDesignFee(checked);
    setLineItems(prev => prev.map(item =>
      item.key === 'product_supply'
        ? { ...item, amount: item.amount + (checked ? DESIGN_FEE : -DESIGN_FEE) }
        : item
    ));
  }

  // ── Section D: Generate PDF ────────────────────────────────────────────────

  async function handleGenerate() {
    if (!estimateData) return;
    setGenerating(true);
    setGenError(null);
    setPdfUrl(null);

    // Rebuild breakdown with edited values (design fee is absorbed into product_supply)
    const updatedBreakdown: DetBreakdown = {};

    const productSupply = lineItems.find(i => i.key === 'product_supply');
    const manufacture   = lineItems.find(i => i.key === 'manufacture');
    const installation  = lineItems.find(i => i.key === 'installation');
    const accessories   = lineItems
      .filter(i => i.key.startsWith('accessory_'))
      .map(i => ({ name: i.label, amount: i.amount }));

    if (productSupply) updatedBreakdown.product_supply = productSupply.amount;
    if (manufacture)   updatedBreakdown.manufacture    = manufacture.amount;
    if (installation)  updatedBreakdown.installation   = installation.amount;
    if (accessories.length) updatedBreakdown.accessories = accessories;

    updatedBreakdown.subtotal    = subtotal;
    updatedBreakdown.contingency = contingency;

    const payload = {
      tenant_id:       estimateData.tenant_id,
      customer_name:   estimateData.customer_name,
      customer_email:  estimateData.customer_email,
      project_summary: summary,
      price_low:       showRange ? priceLow  : singlePrice,
      price_high:      showRange ? priceHigh : singlePrice,
      price_mode:      showRange ? 'range' : 'single',
      single_price:    showRange ? undefined : singlePrice,
      breakdown:       Object.keys(updatedBreakdown).length ? updatedBreakdown : undefined,
      components:      estimateData.components,
      valid_days:      estimateData.valid_days ?? 30,
    };

    try {
      const res  = await fetch('/api/estimates/pdf', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const json = await res.json();
      if (json.url) {
        setPdfUrl(json.url);
      } else {
        setGenError(json.error || 'PDF generation failed');
      }
    } catch (e) {
      setGenError((e as Error).message);
    } finally {
      setGenerating(false);
    }
  }

  function handleRegenerate() {
    setPdfUrl(null);
    setGenError(null);
    // Re-parse original data
    const raw = searchParams.get('data');
    if (!raw) return;
    try {
      const json: EstimateData = JSON.parse(atob(raw));
      setSummary(json.project_summary || '');
      setLineItems(buildLineItems(json.breakdown));
      setIncludeDesignFee(false);
      setPriceLow(json.price_low ?? 0);
      setPriceHigh(json.price_high ?? 0);
      setSinglePrice(Math.round(((json.price_low ?? 0) + (json.price_high ?? 0)) / 2));
    } catch { /* ignore */ }
  }

  // ── Render ─────────────────────────────────────────────────────────────────

  if (parseError) {
    return (
      <div className="max-w-2xl mx-auto px-4 py-12">
        <div className="bg-red-50 border border-red-200 rounded-lg p-6 text-red-700">
          {parseError}
        </div>
      </div>
    );
  }

  if (!estimateData) {
    return (
      <div className="max-w-2xl mx-auto px-4 py-12 text-gray-500 text-sm">
        Loading estimate data…
      </div>
    );
  }

  return (
    <div className="max-w-2xl mx-auto px-4 py-8 space-y-8">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Edit Estimate</h1>
        <p className="text-sm text-gray-500 mt-1">
          For <span className="font-medium text-gray-700">{estimateData.customer_name}</span>
          {estimateData.customer_email && (
            <span className="text-gray-400"> · {estimateData.customer_email}</span>
          )}
        </p>
      </div>

      {/* ── Section A: Project Summary ─────────────────────────────────────── */}
      <section className="bg-white border border-gray-200 rounded-lg p-6 space-y-3">
        <h2 className="text-sm font-semibold text-gray-900 uppercase tracking-wide">Project Summary</h2>
        <textarea
          className="w-full border border-gray-300 rounded-md p-3 text-sm text-gray-800 resize-y min-h-[120px] focus:outline-none focus:ring-2 focus:ring-gray-400"
          value={summary}
          onChange={e => setSummary(e.target.value)}
        />
        <button
          onClick={handleTidy}
          disabled={tidying || !summary.trim()}
          className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium bg-violet-600 text-white rounded-md hover:bg-violet-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
        >
          {tidying ? 'Tidying…' : '✨ Tidy up with AI'}
        </button>
      </section>

      {/* ── Section B: Cost Breakdown ──────────────────────────────────────── */}
      {lineItems.length > 0 && (
        <section className="bg-white border border-gray-200 rounded-lg p-6 space-y-3">
          <h2 className="text-sm font-semibold text-gray-900 uppercase tracking-wide">Cost Breakdown</h2>
          <div className="space-y-2">
            {lineItems.map(item => (
              <div key={item.key} className="flex items-center gap-3">
                <span className="flex-1 text-sm text-gray-700">{item.label}</span>
                <div className="flex items-center gap-1">
                  <span className="text-sm text-gray-500">£</span>
                  <input
                    type="number"
                    min="0"
                    step="1"
                    value={item.amount}
                    onChange={e => updateAmount(item.key, e.target.value)}
                    className="w-28 border border-gray-300 rounded-md px-2 py-1 text-sm text-right focus:outline-none focus:ring-2 focus:ring-gray-400"
                  />
                </div>
              </div>
            ))}
          </div>

          <label className="flex items-center gap-2 cursor-pointer pt-1">
            <input
              type="checkbox"
              checked={includeDesignFee}
              onChange={e => handleDesignFeeToggle(e.target.checked)}
              className="accent-gray-800 w-4 h-4"
            />
            <span className="text-sm text-gray-700">Include design fee (£{DESIGN_FEE}) in project cost</span>
          </label>

          <div className="border-t border-gray-200 pt-3 space-y-1">
            <div className="flex justify-between text-sm text-gray-600">
              <span>Subtotal</span>
              <span>{fmtGBP(subtotal)}</span>
            </div>
            <div className="flex justify-between text-sm text-gray-600">
              <span>Contingency (5%)</span>
              <span>{fmtGBP(contingency)}</span>
            </div>
            <div className="flex justify-between text-sm font-semibold text-gray-900 pt-1 border-t border-gray-200">
              <span>Total</span>
              <span>{fmtGBP(total)}</span>
            </div>
          </div>
        </section>
      )}

      {/* ── Section C: Price Display ───────────────────────────────────────── */}
      <section className="bg-white border border-gray-200 rounded-lg p-6 space-y-4">
        <h2 className="text-sm font-semibold text-gray-900 uppercase tracking-wide">Price Display</h2>

        <div className="flex gap-4">
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="radio"
              checked={showRange}
              onChange={() => setShowRange(true)}
              className="accent-gray-800"
            />
            <span className="text-sm text-gray-700">Show as range</span>
          </label>
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="radio"
              checked={!showRange}
              onChange={() => setShowRange(false)}
              className="accent-gray-800"
            />
            <span className="text-sm text-gray-700">Show single price</span>
          </label>
        </div>

        {showRange ? (
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-1">
              <span className="text-sm text-gray-500">£</span>
              <input
                type="number"
                min="0"
                step="1"
                value={priceLow}
                onChange={e => setPriceLow(parseFloat(e.target.value) || 0)}
                className="w-28 border border-gray-300 rounded-md px-2 py-1 text-sm text-right focus:outline-none focus:ring-2 focus:ring-gray-400"
              />
            </div>
            <span className="text-sm text-gray-500">–</span>
            <div className="flex items-center gap-1">
              <span className="text-sm text-gray-500">£</span>
              <input
                type="number"
                min="0"
                step="1"
                value={priceHigh}
                onChange={e => setPriceHigh(parseFloat(e.target.value) || 0)}
                className="w-28 border border-gray-300 rounded-md px-2 py-1 text-sm text-right focus:outline-none focus:ring-2 focus:ring-gray-400"
              />
            </div>
          </div>
        ) : (
          <div className="flex items-center gap-1">
            <span className="text-sm text-gray-500">£</span>
            <input
              type="number"
              min="0"
              step="1"
              value={singlePrice}
              onChange={e => setSinglePrice(parseFloat(e.target.value) || 0)}
              className="w-28 border border-gray-300 rounded-md px-2 py-1 text-sm text-right focus:outline-none focus:ring-2 focus:ring-gray-400"
            />
          </div>
        )}
      </section>

      {/* ── Section D: Generate ────────────────────────────────────────────── */}
      <section className="bg-white border border-gray-200 rounded-lg p-6 space-y-4">
        <h2 className="text-sm font-semibold text-gray-900 uppercase tracking-wide">Generate PDF</h2>

        {genError && (
          <div className="bg-red-50 border border-red-200 rounded-md p-3 text-sm text-red-700">
            {genError}
          </div>
        )}

        {pdfUrl ? (
          <div className="space-y-3">
            <div className="bg-green-50 border border-green-200 rounded-md p-3 text-sm text-green-700">
              PDF generated successfully.
            </div>
            <div className="flex gap-3">
              <a
                href={pdfUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium bg-gray-900 text-white rounded-md hover:bg-gray-700 transition-colors"
              >
                📥 Download / View PDF
              </a>
              <button
                onClick={handleRegenerate}
                className="px-4 py-2 text-sm font-medium border border-gray-300 text-gray-700 rounded-md hover:bg-gray-50 transition-colors"
              >
                Regenerate
              </button>
            </div>
          </div>
        ) : (
          <button
            onClick={handleGenerate}
            disabled={generating || !summary.trim()}
            className="inline-flex items-center gap-2 px-5 py-2.5 text-sm font-medium bg-gray-900 text-white rounded-md hover:bg-gray-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {generating ? 'Generating…' : '📄 Generate PDF'}
          </button>
        )}
      </section>
    </div>
  );
}
