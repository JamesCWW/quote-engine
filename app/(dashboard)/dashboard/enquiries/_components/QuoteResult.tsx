'use client';

import { useState } from 'react';

interface SimilarQuote {
  id: string;
  product_type: string | null;
  material: string | null;
  description: string;
  price_low: number | null;
  price_high: number | null;
  final_price: number | null;
  is_golden: boolean;
  similarity: number;
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

export interface QuoteComponent {
  name: string;
  items: Array<{ label: string; amount: number; note?: string }>;
  subtotal_low: number;
  subtotal_high: number;
}

export interface QuoteOption {
  name: string;
  price_low: number;
  price_high: number;
}

export interface QuoteResultData {
  generated_quote_id: string;
  enquiry_id: string;
  price_low: number;
  price_high: number;
  confidence: 'low' | 'medium' | 'high';
  reasoning: string;
  missing_info: string[];
  product_type: string;
  material: string;
  similar_quotes: SimilarQuote[];
  quote_mode?: 'rough' | 'precise';
  cost_breakdown?: CostBreakdown;
  components?: QuoteComponent[];
  options?: QuoteOption[];
}

interface Props {
  result: QuoteResultData;
  enquiryText: string;
  tenantId: string;
  onReset: () => void;
  onAddDetails?: () => void;
  onRegenerate?: (newText: string) => void;
}

function CostBreakdownPanel({
  breakdown,
  priceLow,
  priceHigh,
}: {
  breakdown: CostBreakdown;
  priceLow: number;
  priceHigh: number;
}) {
  const [open, setOpen] = useState(false);

  return (
    <div className="mt-4 rounded-md border border-gray-200 overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center justify-between px-4 py-2.5 bg-gray-50 hover:bg-gray-100 transition-colors text-left"
      >
        <span className="text-xs font-semibold text-gray-700 uppercase tracking-wide">
          Cost Breakdown
        </span>
        <span className="text-gray-400 text-sm">{open ? '▲' : '▼'}</span>
      </button>

      {open && (
        <div className="px-4 py-3 bg-white font-mono text-xs text-gray-700 space-y-1">
          <BreakdownRow label="Materials" value={breakdown.material_cost} />
          <BreakdownRow
            label="Manufacture"
            value={breakdown.manufacture_cost}
            note={`${breakdown.manufacture_days} days × £507`}
          />
          <BreakdownRow
            label="Installation"
            value={breakdown.install_cost}
            note={`${breakdown.install_days} days × ${breakdown.engineers} engineers × £523.84`}
          />
          <BreakdownRow label="Finishing" value={breakdown.finishing_cost} />
          <div className="border-t border-gray-200 pt-1 mt-1" />
          <BreakdownRow label="Subtotal" value={breakdown.subtotal} bold />
          <BreakdownRow label="Contingency (10%)" value={breakdown.contingency} />
          <div className="border-t border-gray-200 pt-1 mt-1" />
          <div className="flex justify-between font-semibold">
            <span>ESTIMATE</span>
            <span>
              {fmt(priceLow)} – {fmt(priceHigh)}
            </span>
          </div>
        </div>
      )}
    </div>
  );
}

function BreakdownRow({
  label,
  value,
  note,
  bold,
}: {
  label: string;
  value: number;
  note?: string;
  bold?: boolean;
}) {
  return (
    <div className={`flex justify-between gap-4 ${bold ? 'font-semibold' : ''}`}>
      <span className="text-gray-500">
        {label}
        {note && <span className="text-gray-400 ml-1">({note})</span>}
      </span>
      <span>{fmt(value)}</span>
    </div>
  );
}

function ComponentBreakdownPanel({ components, priceLow, priceHigh }: {
  components: QuoteComponent[];
  priceLow: number;
  priceHigh: number;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className="mt-4 rounded-md border border-gray-200 overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center justify-between px-4 py-2.5 bg-gray-50 hover:bg-gray-100 transition-colors text-left"
      >
        <span className="text-xs font-semibold text-gray-700 uppercase tracking-wide">
          Component Breakdown
        </span>
        <span className="text-gray-400 text-sm">{open ? '▲' : '▼'}</span>
      </button>
      {open && (
        <div className="px-4 py-3 bg-white font-mono text-xs text-gray-700 space-y-4">
          {components.map((comp, i) => (
            <div key={i}>
              <p className="font-semibold text-gray-800 mb-1">{comp.name}</p>
              {comp.items.map((item, j) => (
                <div key={j} className="flex justify-between gap-4">
                  <span className="text-gray-500">
                    {item.label}
                    {item.note && <span className="text-gray-400 ml-1">({item.note})</span>}
                  </span>
                  <span>{fmt(item.amount)}</span>
                </div>
              ))}
              <div className="border-t border-gray-100 pt-1 mt-1 flex justify-between font-semibold">
                <span>Subtotal</span>
                <span>{fmt(comp.subtotal_low)}{comp.subtotal_high !== comp.subtotal_low ? ` – ${fmt(comp.subtotal_high)}` : ''}</span>
              </div>
            </div>
          ))}
          <div className="border-t border-gray-200 pt-2 flex justify-between font-semibold text-gray-900">
            <span>TOTAL ESTIMATE</span>
            <span>{fmt(priceLow)} – {fmt(priceHigh)}</span>
          </div>
        </div>
      )}
    </div>
  );
}

function AlternativeOptionsPanel({ options }: { options: QuoteOption[] }) {
  return (
    <div className="mt-4 rounded-md border border-blue-100 bg-blue-50 overflow-hidden">
      <div className="px-4 py-2.5 bg-blue-100">
        <span className="text-xs font-semibold text-blue-700 uppercase tracking-wide">
          Alternative Options
        </span>
      </div>
      <div className="px-4 py-3 space-y-2">
        {options.map((opt, i) => (
          <div key={i} className="flex items-center justify-between text-sm">
            <span className="text-gray-700 font-medium">{opt.name}</span>
            <span className="text-gray-900 font-semibold">{fmt(opt.price_low)} – {fmt(opt.price_high)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

const CONFIDENCE_STYLES: Record<string, string> = {
  high: 'bg-green-100 text-green-800',
  medium: 'bg-amber-100 text-amber-800',
  low: 'bg-red-100 text-red-800',
};

function fmt(n: number) {
  return new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'GBP', maximumFractionDigits: 0 }).format(n);
}

export default function QuoteResult({ result, enquiryText, tenantId, onReset, onAddDetails, onRegenerate }: Props) {
  const [showModal, setShowModal] = useState(false);
  const [finalPrice, setFinalPrice] = useState(
    String(Math.round((result.price_low + result.price_high) / 2))
  );
  const [approving, setApproving] = useState(false);
  const [approved, setApproved] = useState(false);
  const [error, setError] = useState('');
  const [isEditingEnquiry, setIsEditingEnquiry] = useState(false);
  const [editedText, setEditedText] = useState(enquiryText);
  const [answers, setAnswers] = useState<Record<number, string>>({});

  async function handleApprove() {
    const price = parseFloat(finalPrice);
    if (!price || price <= 0) {
      setError('Enter a valid price');
      return;
    }

    setApproving(true);
    setError('');

    const res = await fetch(`/api/generated-quotes/${result.generated_quote_id}/approve`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        final_price: price,
        tenant_id: tenantId,
        enquiry_text: enquiryText,
        product_type: result.product_type,
        material: result.material,
      }),
    });

    setApproving(false);

    if (!res.ok) {
      const data = await res.json();
      setError(data.error ?? 'Approval failed');
      return;
    }

    setApproved(true);
    setShowModal(false);
  }

  function handleRegenerateWithDetails() {
    const answeredParts = result.missing_info
      .map((q, i) => (answers[i]?.trim() ? `- ${q}: ${answers[i].trim()}` : null))
      .filter(Boolean);

    let combined = editedText;
    if (answeredParts.length > 0) {
      combined += `\n\nAdditional details provided:\n${answeredParts.join('\n')}`;
    }
    onRegenerate?.(combined);
  }

  if (approved) {
    return (
      <div className="rounded-lg border border-green-200 bg-green-50 p-6 text-center">
        <p className="text-green-800 font-medium text-lg mb-1">Quote approved — {fmt(parseFloat(finalPrice))}</p>
        <p className="text-green-700 text-sm mb-4">Saved to quotes and added to training data.</p>
        <button
          onClick={onReset}
          className="text-sm text-green-700 underline hover:text-green-900"
        >
          Done
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Editable enquiry */}
      {onRegenerate && (
        <div className="rounded-lg border border-gray-200 bg-white p-4">
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Job Description</span>
            {!isEditingEnquiry && (
              <button
                type="button"
                onClick={() => setIsEditingEnquiry(true)}
                className="text-xs text-gray-500 hover:text-gray-700 underline"
              >
                Edit
              </button>
            )}
          </div>
          {isEditingEnquiry ? (
            <>
              <textarea
                value={editedText}
                onChange={(e) => setEditedText(e.target.value)}
                rows={4}
                className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-gray-900 resize-y"
              />
              <div className="flex gap-2 mt-2">
                <button
                  type="button"
                  onClick={() => onRegenerate(editedText)}
                  disabled={!editedText.trim()}
                  className="flex-1 bg-gray-900 text-white text-xs font-medium py-2 px-3 rounded-md hover:bg-gray-800 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                >
                  Re-generate Estimate
                </button>
                <button
                  type="button"
                  onClick={() => { setIsEditingEnquiry(false); setEditedText(enquiryText); }}
                  className="border border-gray-300 text-gray-600 text-xs py-2 px-3 rounded-md hover:bg-gray-50 transition-colors"
                >
                  Cancel
                </button>
              </div>
            </>
          ) : (
            <p className="text-sm text-gray-700 whitespace-pre-wrap">{enquiryText}</p>
          )}
        </div>
      )}

      {/* Price range */}
      <div className="rounded-lg border border-gray-200 bg-white p-6">
        {result.quote_mode && (
          <div className="flex items-center justify-between gap-3 mb-4 pb-4 border-b border-gray-100">
            <span className={`text-xs px-2.5 py-1 rounded-full font-medium border ${
              result.quote_mode === 'rough'
                ? 'bg-amber-50 text-amber-700 border-amber-200'
                : 'bg-blue-50 text-blue-700 border-blue-200'
            }`}>
              {result.quote_mode === 'rough'
                ? '📊 Rough estimate — provide details for accuracy'
                : '🎯 Precise estimate — based on confirmed specs'}
            </span>
            {result.quote_mode === 'rough' && onAddDetails && (
              <button
                onClick={onAddDetails}
                className="text-xs text-gray-500 underline hover:text-gray-700 flex-shrink-0"
              >
                Add details →
              </button>
            )}
          </div>
        )}

        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-sm text-gray-500 mb-1">Estimated range</p>
            <p className="text-4xl font-bold text-gray-900 tracking-tight">
              {fmt(result.price_low)} – {fmt(result.price_high)}
            </p>
            <p className="text-sm text-gray-500 mt-1">
              {result.product_type} · {result.material}
            </p>
          </div>
          <span
            className={`inline-flex items-center px-3 py-1 rounded-full text-sm font-medium capitalize ${
              CONFIDENCE_STYLES[result.confidence]
            }`}
          >
            {result.confidence} confidence
          </span>
        </div>

        <p className="mt-4 text-gray-700 text-sm leading-relaxed">{result.reasoning}</p>

        {result.missing_info.length > 0 && (
          <div className="mt-4 rounded-md bg-amber-50 border border-amber-200 p-3">
            <p className="text-xs font-semibold text-amber-800 mb-2">To sharpen the estimate, clarify:</p>
            <div className="space-y-2.5">
              {result.missing_info.map((q, i) => (
                <div key={i}>
                  <label className="text-xs text-amber-700 block mb-1">• {q}</label>
                  <input
                    type="text"
                    value={answers[i] ?? ''}
                    onChange={(e) => setAnswers((prev) => ({ ...prev, [i]: e.target.value }))}
                    placeholder="Your answer (optional)"
                    className="w-full border border-amber-200 rounded px-2 py-1.5 text-xs bg-white focus:outline-none focus:ring-1 focus:ring-amber-400 placeholder-amber-300"
                  />
                </div>
              ))}
            </div>
            {onRegenerate && (
              <button
                type="button"
                onClick={handleRegenerateWithDetails}
                disabled={Object.values(answers).every((v) => !v?.trim())}
                className="mt-3 w-full bg-amber-700 text-white text-xs font-medium py-2 px-3 rounded-md hover:bg-amber-800 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
              >
                Regenerate with Details
              </button>
            )}
          </div>
        )}

        {result.components && result.components.length > 0 && (
          <ComponentBreakdownPanel components={result.components} priceLow={result.price_low} priceHigh={result.price_high} />
        )}
        {result.cost_breakdown && !result.components && (
          <CostBreakdownPanel breakdown={result.cost_breakdown} priceLow={result.price_low} priceHigh={result.price_high} />
        )}
        {result.options && result.options.length > 0 && (
          <AlternativeOptionsPanel options={result.options} />
        )}
      </div>

      {/* Similar jobs used */}
      {result.similar_quotes.length > 0 && (
        <div className="rounded-lg border border-gray-200 bg-white p-6">
          <h3 className="text-sm font-semibold text-gray-900 mb-3">Similar Jobs Used</h3>
          <div className="space-y-3">
            {result.similar_quotes.map((q, i) => (
              <div key={q.id} className="flex gap-3 items-start text-sm">
                <span className="flex-shrink-0 w-5 h-5 rounded-full bg-gray-100 text-gray-600 text-xs flex items-center justify-center font-medium">
                  {i + 1}
                </span>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-medium text-gray-900">{q.product_type ?? 'Unknown'}</span>
                    {q.material && <span className="text-gray-400">·</span>}
                    {q.material && <span className="text-gray-600">{q.material}</span>}
                    {q.is_golden && (
                      <span className="text-xs bg-yellow-100 text-yellow-700 px-1.5 py-0.5 rounded font-medium">
                        Won
                      </span>
                    )}
                    <span className="ml-auto text-xs text-gray-400 flex-shrink-0">
                      {(q.similarity * 100).toFixed(0)}% match
                    </span>
                  </div>
                  <p className="text-gray-500 text-xs mt-0.5 truncate">{q.description}</p>
                  <p className="text-gray-700 text-xs mt-0.5">
                    {q.price_low != null && q.price_high != null
                      ? `${fmt(q.price_low)} – ${fmt(q.price_high)}`
                      : 'No price range'}
                    {q.final_price != null && (
                      <span className="text-gray-500"> · Final: {fmt(q.final_price)}</span>
                    )}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Actions */}
      <div className="flex gap-3">
        <button
          onClick={() => setShowModal(true)}
          className="flex-1 bg-gray-900 text-white text-sm font-medium py-2.5 px-4 rounded-md hover:bg-gray-800 transition-colors"
        >
          Approve &amp; Send
        </button>
        <button
          onClick={() => setShowModal(true)}
          className="flex-1 border border-gray-300 text-gray-700 text-sm font-medium py-2.5 px-4 rounded-md hover:bg-gray-50 transition-colors"
        >
          Edit Price
        </button>
        <button
          onClick={onReset}
          className="border border-gray-300 text-gray-500 text-sm py-2.5 px-4 rounded-md hover:bg-gray-50 transition-colors"
        >
          Discard
        </button>
      </div>

      {/* Approve modal */}
      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="bg-white rounded-xl shadow-xl p-6 w-full max-w-sm mx-4">
            <h2 className="text-base font-semibold text-gray-900 mb-1">Set final price</h2>
            <p className="text-sm text-gray-500 mb-4">
              AI range: {fmt(result.price_low)} – {fmt(result.price_high)}
            </p>

            <div className="mb-4">
              <label className="block text-xs font-medium text-gray-700 mb-1">Final price (£)</label>
              <input
                type="number"
                min="0"
                step="50"
                value={finalPrice}
                onChange={(e) => setFinalPrice(e.target.value)}
                className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-gray-900"
                autoFocus
              />
            </div>

            {error && <p className="text-red-600 text-xs mb-3">{error}</p>}

            <div className="flex gap-2">
              <button
                onClick={handleApprove}
                disabled={approving}
                className="flex-1 bg-gray-900 text-white text-sm font-medium py-2 px-4 rounded-md hover:bg-gray-800 disabled:opacity-50 transition-colors"
              >
                {approving ? 'Saving…' : 'Approve'}
              </button>
              <button
                onClick={() => setShowModal(false)}
                className="flex-1 border border-gray-300 text-gray-700 text-sm py-2 px-4 rounded-md hover:bg-gray-50 transition-colors"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
