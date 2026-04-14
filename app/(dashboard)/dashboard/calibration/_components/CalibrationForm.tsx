'use client';

import { useState } from 'react';

// ── Types matching the API response ───────────────────────────────────────

interface AccessoryItem {
  name: string;
  amount: number;
}

interface Breakdown {
  product_supply: number;
  manufacture: number;
  installation: number;
  accessories: AccessoryItem[];
  accessories_total: number;
  subtotal: number;
  contingency: number;
  price_low: number;
  price_high: number;
  minimum_applied: number | null;
  job_type_matched: string | null;
  product_matched: string | null;
}

interface ConfidenceField {
  [key: string]: 'confirmed' | 'assumed' | 'unknown';
}

interface ExtractedSpec {
  product_type: string;
  material: string;
  is_electric: boolean | null;
  width_mm: number | null;
  height_mm: number | null;
  length_m: number | null;
  design_name: string | null;
  has_automation: boolean | null;
  has_intercom: boolean | null;
  installation_included: boolean | null;
  confidence_per_field: ConfidenceField;
}

interface Suggestion {
  label: string;
  description: string;
  current_value: number | null;
  suggested_value: number | null;
  field: string;
  table: 'master_rates' | 'job_types';
  job_type?: string;
}

interface BiggestLineItem {
  label: string;
  value: number;
  field: string | null;
  table: string | null;
}

interface AnalyseResult {
  estimate: {
    price_low: number;
    price_high: number;
    midpoint: number;
    confidence: 'low' | 'medium' | 'high';
    reasoning: string;
    missing_info: string[];
    breakdown: Breakdown;
  };
  spec: ExtractedSpec;
  actual_price: number;
  gap: {
    amount: number;
    percent: number;
    direction: 'over' | 'under' | 'on_target';
  };
  biggest_line_item: BiggestLineItem | null;
  suggested_adjustments: Suggestion[];
}

// ── Helpers ────────────────────────────────────────────────────────────────

function fmt(n: number) {
  return `£${Math.round(n).toLocaleString('en-GB')}`;
}

function confidenceBadge(c: 'low' | 'medium' | 'high') {
  const map = {
    high: 'bg-green-100 text-green-800',
    medium: 'bg-yellow-100 text-yellow-800',
    low: 'bg-red-100 text-red-800',
  };
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${map[c]}`}>
      {c}
    </span>
  );
}

function fieldBadge(v: 'confirmed' | 'assumed' | 'unknown') {
  const map = {
    confirmed: 'bg-green-100 text-green-700',
    assumed: 'bg-yellow-100 text-yellow-700',
    unknown: 'bg-red-100 text-red-700',
  };
  return (
    <span className={`inline-block px-1.5 py-0.5 rounded text-xs ${map[v]}`}>{v}</span>
  );
}

// ── Component ──────────────────────────────────────────────────────────────

export default function CalibrationForm() {
  const [enquiryText, setEnquiryText] = useState('');
  const [actualPrice, setActualPrice] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState<AnalyseResult | null>(null);
  const [applying, setApplying] = useState<string | null>(null);
  const [applied, setApplied] = useState<Set<string>>(new Set());
  const [adjustValues, setAdjustValues] = useState<Record<string, string>>({});

  async function handleAnalyse() {
    setError('');
    setResult(null);
    const price = parseFloat(actualPrice);
    if (!enquiryText.trim()) { setError('Paste an enquiry or past quote first.'); return; }
    if (isNaN(price) || price <= 0) { setError('Enter a valid actual price charged.'); return; }

    setLoading(true);
    try {
      const res = await fetch('/api/calibration/analyse', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enquiry_text: enquiryText, actual_price: price }),
      });
      const data = await res.json() as AnalyseResult & { error?: string };
      if (!res.ok) { setError(data.error ?? 'Analysis failed'); return; }
      setResult(data);
      // Pre-populate adjust inputs with suggested values
      const initial: Record<string, string> = {};
      data.suggested_adjustments.forEach((s, i) => {
        if (s.suggested_value) initial[`${i}`] = String(s.suggested_value);
      });
      setAdjustValues(initial);
    } catch (err) {
      setError(String(err));
    } finally {
      setLoading(false);
    }
  }

  async function handleApply(suggestion: Suggestion, idx: number) {
    const key = `${idx}`;
    const rawVal = adjustValues[key];
    const value = rawVal ? parseFloat(rawVal) : suggestion.suggested_value;
    if (!value || isNaN(value)) { setError('Enter a value to apply.'); return; }

    setApplying(key);
    setError('');
    try {
      const body: Record<string, unknown> = {
        table: suggestion.table,
        field: suggestion.field,
        value,
      };
      if (suggestion.job_type) body.job_type = suggestion.job_type;

      const res = await fetch('/api/calibration/apply', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await res.json() as { error?: string };
      if (!res.ok) { setError(data.error ?? 'Apply failed'); return; }
      setApplied((prev) => new Set(Array.from(prev).concat(key)));
    } catch (err) {
      setError(String(err));
    } finally {
      setApplying(null);
    }
  }

  const gap = result?.gap;
  const gapColour =
    !gap ? '' :
    gap.direction === 'on_target' ? 'text-green-700' :
    gap.direction === 'under' ? 'text-amber-700' : 'text-red-700';

  const gapLabel =
    !gap ? '' :
    gap.direction === 'on_target' ? 'On target' :
    gap.direction === 'under'
      ? `Engine underestimated by ${fmt(Math.abs(gap.amount))} (${Math.abs(gap.percent)}%)`
      : `Engine overestimated by ${fmt(Math.abs(gap.amount))} (${Math.abs(gap.percent)}%)`;

  return (
    <div className="space-y-6">
      {/* Input panel */}
      <div className="bg-white border border-gray-200 rounded-lg p-5 space-y-4">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            Past enquiry or quote text
          </label>
          <textarea
            className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm font-mono resize-y min-h-[160px] focus:outline-none focus:ring-2 focus:ring-indigo-500"
            placeholder="Paste a past customer enquiry or the original quote text here..."
            value={enquiryText}
            onChange={(e) => setEnquiryText(e.target.value)}
          />
        </div>
        <div className="flex items-end gap-4">
          <div className="w-48">
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Actual price charged (£)
            </label>
            <input
              type="number"
              min="0"
              step="1"
              className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
              placeholder="e.g. 4800"
              value={actualPrice}
              onChange={(e) => setActualPrice(e.target.value)}
            />
          </div>
          <button
            onClick={handleAnalyse}
            disabled={loading}
            className="px-5 py-2 bg-indigo-600 text-white text-sm font-medium rounded-md hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {loading ? 'Analysing…' : 'Compare estimate vs actual'}
          </button>
        </div>
        {error && <p className="text-sm text-red-600">{error}</p>}
      </div>

      {result && (
        <>
          {/* Gap summary banner */}
          <div className={`border rounded-lg p-4 ${
            gap?.direction === 'on_target' ? 'bg-green-50 border-green-200' :
            gap?.direction === 'under' ? 'bg-amber-50 border-amber-200' :
            'bg-red-50 border-red-200'
          }`}>
            <p className={`font-semibold text-base ${gapColour}`}>{gapLabel}</p>
            <p className="text-sm text-gray-600 mt-1">
              Engine estimated {fmt(result.estimate.midpoint)} midpoint (range {fmt(result.estimate.price_low)} – {fmt(result.estimate.price_high)}).
              You charged {fmt(result.actual_price)}.
            </p>
          </div>

          {/* Side-by-side breakdown */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* Engine breakdown */}
            <div className="bg-white border border-gray-200 rounded-lg p-4">
              <h2 className="font-semibold text-sm text-gray-700 mb-3 flex items-center gap-2">
                Engine estimate {confidenceBadge(result.estimate.confidence)}
              </h2>
              <table className="w-full text-sm">
                <tbody>
                  <tr>
                    <td className="text-gray-500 py-0.5">Product supply</td>
                    <td className="text-right font-mono">{fmt(result.estimate.breakdown.product_supply)}</td>
                  </tr>
                  <tr>
                    <td className="text-gray-500 py-0.5">Manufacture</td>
                    <td className="text-right font-mono">{fmt(result.estimate.breakdown.manufacture)}</td>
                  </tr>
                  <tr>
                    <td className="text-gray-500 py-0.5">Installation</td>
                    <td className="text-right font-mono">{fmt(result.estimate.breakdown.installation)}</td>
                  </tr>
                  {result.estimate.breakdown.accessories.map((a, i) => (
                    <tr key={i}>
                      <td className="text-gray-500 py-0.5 pl-3 text-xs">{a.name}</td>
                      <td className="text-right font-mono text-xs">{fmt(a.amount)}</td>
                    </tr>
                  ))}
                  <tr>
                    <td className="text-gray-500 py-0.5">Contingency (5%)</td>
                    <td className="text-right font-mono">{fmt(result.estimate.breakdown.contingency)}</td>
                  </tr>
                  <tr className="border-t border-gray-100 font-semibold">
                    <td className="py-1">Range</td>
                    <td className="text-right font-mono">{fmt(result.estimate.price_low)} – {fmt(result.estimate.price_high)}</td>
                  </tr>
                  {result.estimate.breakdown.minimum_applied && (
                    <tr>
                      <td colSpan={2} className="text-xs text-amber-700 pt-1">
                        Floor raised to minimum: {fmt(result.estimate.breakdown.minimum_applied)}
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
              {result.estimate.breakdown.job_type_matched && (
                <p className="text-xs text-gray-400 mt-2">Job type: {result.estimate.breakdown.job_type_matched}</p>
              )}
              {result.estimate.breakdown.product_matched && (
                <p className="text-xs text-gray-400">Product: {result.estimate.breakdown.product_matched}</p>
              )}
            </div>

            {/* Extracted spec */}
            <div className="bg-white border border-gray-200 rounded-lg p-4">
              <h2 className="font-semibold text-sm text-gray-700 mb-3">What the engine extracted</h2>
              <table className="w-full text-sm">
                <tbody>
                  {Object.entries(result.spec.confidence_per_field).map(([field, conf]) => {
                    const raw = result.spec[field as keyof ExtractedSpec];
                    const display = raw === null || raw === undefined ? '—' : String(raw);
                    return (
                      <tr key={field}>
                        <td className="text-gray-500 py-0.5 capitalize">{field.replace(/_/g, ' ')}</td>
                        <td className="font-mono text-xs py-0.5 px-2">{display}</td>
                        <td className="py-0.5">{fieldBadge(conf as 'confirmed' | 'assumed' | 'unknown')}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>

          {/* Reasoning */}
          <div className="bg-white border border-gray-200 rounded-lg p-4">
            <h2 className="font-semibold text-sm text-gray-700 mb-2">Engine reasoning</h2>
            <p className="text-sm text-gray-600">{result.estimate.reasoning}</p>
            {result.estimate.missing_info.length > 0 && (
              <div className="mt-2">
                <p className="text-xs font-medium text-gray-500 mb-1">Missing / unknown fields:</p>
                <ul className="list-disc list-inside space-y-0.5">
                  {result.estimate.missing_info.map((q, i) => (
                    <li key={i} className="text-xs text-amber-700">{q}</li>
                  ))}
                </ul>
              </div>
            )}
          </div>

          {/* Biggest driver */}
          {result.biggest_line_item && (
            <div className="bg-white border border-gray-200 rounded-lg p-4">
              <h2 className="font-semibold text-sm text-gray-700 mb-1">Biggest cost driver</h2>
              <p className="text-sm text-gray-600">
                <span className="font-medium">{result.biggest_line_item.label}</span> at{' '}
                <span className="font-mono">{fmt(result.biggest_line_item.value)}</span> —{' '}
                {((result.biggest_line_item.value / (result.estimate.breakdown.subtotal || 1)) * 100).toFixed(0)}% of subtotal.
              </p>
            </div>
          )}

          {/* Suggested adjustments */}
          {result.suggested_adjustments.length > 0 && (
            <div className="bg-white border border-gray-200 rounded-lg p-4">
              <h2 className="font-semibold text-sm text-gray-700 mb-3">Suggested rate adjustments</h2>
              <div className="space-y-3">
                {result.suggested_adjustments.map((s, i) => {
                  const key = `${i}`;
                  const isDone = applied.has(key);
                  return (
                    <div
                      key={i}
                      className={`border rounded-md p-3 ${isDone ? 'border-green-200 bg-green-50' : 'border-gray-200'}`}
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="flex-1">
                          <p className="text-sm font-medium text-gray-800">{s.label}</p>
                          <p className="text-xs text-gray-500 mt-0.5">{s.description}</p>
                          <p className="text-xs text-gray-400 mt-0.5">
                            Table: <code className="font-mono">{s.table}</code> · Field:{' '}
                            <code className="font-mono">{s.field}</code>
                            {s.job_type && (
                              <> · Job type: <code className="font-mono">{s.job_type}</code></>
                            )}
                          </p>
                        </div>
                        <div className="flex items-center gap-2 flex-shrink-0">
                          <input
                            type="number"
                            min="0"
                            step="0.01"
                            className="w-28 border border-gray-300 rounded px-2 py-1 text-sm font-mono focus:outline-none focus:ring-1 focus:ring-indigo-500"
                            value={adjustValues[key] ?? ''}
                            onChange={(e) =>
                              setAdjustValues((prev) => ({ ...prev, [key]: e.target.value }))
                            }
                            disabled={isDone}
                            placeholder="new value"
                          />
                          <button
                            onClick={() => handleApply(s, i)}
                            disabled={isDone || applying === key}
                            className={`px-3 py-1.5 text-sm font-medium rounded-md transition-colors ${
                              isDone
                                ? 'bg-green-600 text-white cursor-default'
                                : 'bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed'
                            }`}
                          >
                            {isDone ? 'Applied' : applying === key ? 'Saving…' : 'Apply'}
                          </button>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Re-run button */}
          <div className="flex justify-end">
            <button
              onClick={() => { setResult(null); setApplied(new Set()); setAdjustValues({}); }}
              className="text-sm text-gray-500 hover:text-gray-700 underline"
            >
              Clear and start over
            </button>
          </div>
        </>
      )}
    </div>
  );
}
