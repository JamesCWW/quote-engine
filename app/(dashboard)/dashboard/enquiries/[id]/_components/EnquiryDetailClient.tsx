'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import QuoteResult, { type QuoteResultData } from '../../_components/QuoteResult';
import type { AnalysisQuestion } from '@/app/api/enquiries/[id]/analyse/route';

interface GeneratedQuote {
  id: string;
  price_low: number | null;
  price_high: number | null;
  confidence: string | null;
  ai_reasoning: string | null;
  final_price: number | null;
  status: string;
  reviewed_by: string | null;
  created_at: string;
}

interface AssumptionState {
  question: AnalysisQuestion;
  value: string;
  include: boolean;
}

interface Props {
  enquiryId: string;
  rawInput: string;
  tenantId: string;
  initialQuotes: GeneratedQuote[];
}

type Stage = 'loading_analysis' | 'ready' | 'generating' | 'result';
type DraftStage = 'idle' | 'generating' | 'ready';

const CONFIDENCE_STYLES: Record<string, string> = {
  high: 'bg-green-100 text-green-700',
  medium: 'bg-yellow-100 text-yellow-700',
  low: 'bg-red-100 text-red-700',
};

const STATUS_STYLES: Record<string, string> = {
  draft: 'bg-gray-100 text-gray-600',
  approved: 'bg-green-100 text-green-700',
  sent: 'bg-blue-100 text-blue-700',
};

const SECTION_LABELS: Record<string, string> = {
  gates: 'Gates',
  fencing: 'Fencing / Railings',
};

function AssumptionInput({
  a,
  idx,
  onValueChange,
  onIncludeChange,
}: {
  a: AssumptionState;
  idx: number;
  onValueChange: (idx: number, val: string) => void;
  onIncludeChange: (idx: number, include: boolean) => void;
}) {
  return (
    <div className="flex items-start gap-3">
      <input
        type="checkbox"
        id={`include-${a.question.id}`}
        checked={a.include}
        onChange={(e) => onIncludeChange(idx, e.target.checked)}
        className="mt-2.5 h-3.5 w-3.5 rounded border-gray-300 text-gray-900 cursor-pointer"
      />
      <div className="flex-1 min-w-0">
        <label
          htmlFor={`input-${a.question.id}`}
          className={`block text-xs font-medium mb-1 ${a.include ? 'text-gray-700' : 'text-gray-400'}`}
        >
          {a.question.label}
        </label>

        {a.question.type === 'dropdown' && a.question.options ? (
          <select
            id={`input-${a.question.id}`}
            value={a.value}
            onChange={(e) => onValueChange(idx, e.target.value)}
            disabled={!a.include}
            className="w-full border border-gray-300 rounded-md px-2.5 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-gray-900 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            <option value="">Select…</option>
            {a.question.options.map((opt) => (
              <option key={opt} value={opt}>{opt}</option>
            ))}
          </select>
        ) : a.question.type === 'yesno' ? (
          <div className="flex gap-2">
            {['Yes', 'No'].map((opt) => (
              <button
                key={opt}
                type="button"
                onClick={() => onValueChange(idx, opt)}
                disabled={!a.include}
                className={`px-3 py-1.5 text-xs rounded-md border transition-colors disabled:opacity-40 disabled:cursor-not-allowed ${
                  a.value === opt
                    ? 'bg-gray-900 text-white border-gray-900'
                    : 'border-gray-300 text-gray-600 hover:bg-gray-50'
                }`}
              >
                {opt}
              </button>
            ))}
          </div>
        ) : (
          <input
            id={`input-${a.question.id}`}
            type="text"
            value={a.value}
            onChange={(e) => onValueChange(idx, e.target.value)}
            disabled={!a.include}
            placeholder="Enter value…"
            className="w-full border border-gray-300 rounded-md px-2.5 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-gray-900 disabled:opacity-40 disabled:cursor-not-allowed"
          />
        )}
      </div>
    </div>
  );
}

function AssumptionsList({
  assumptions,
  onValueChange,
  onIncludeChange,
}: {
  assumptions: AssumptionState[];
  onValueChange: (idx: number, val: string) => void;
  onIncludeChange: (idx: number, include: boolean) => void;
}) {
  const hasSections = assumptions.some((a) => a.question.section);

  if (!hasSections) {
    return (
      <div className="space-y-3">
        {assumptions.map((a, idx) => (
          <AssumptionInput key={a.question.id} a={a} idx={idx} onValueChange={onValueChange} onIncludeChange={onIncludeChange} />
        ))}
      </div>
    );
  }

  // Group by section for mixed enquiries
  const sections = new Map<string, { a: AssumptionState; idx: number }[]>();
  assumptions.forEach((a, idx) => {
    const key = a.question.section ?? 'general';
    if (!sections.has(key)) sections.set(key, []);
    sections.get(key)!.push({ a, idx });
  });

  return (
    <div className="space-y-5">
      {Array.from(sections.entries()).map(([sectionKey, items]) => (
        <div key={sectionKey}>
          <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2 border-b border-gray-100 pb-1">
            {SECTION_LABELS[sectionKey] ?? sectionKey}
          </p>
          <div className="space-y-3">
            {items.map(({ a, idx }) => (
              <AssumptionInput key={a.question.id} a={a} idx={idx} onValueChange={onValueChange} onIncludeChange={onIncludeChange} />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

export default function EnquiryDetailClient({
  enquiryId,
  rawInput,
  tenantId,
  initialQuotes,
}: Props) {
  const router = useRouter();

  // Main flow
  const [stage, setStage] = useState<Stage>('loading_analysis');
  const [assumptions, setAssumptions] = useState<AssumptionState[]>([]);
  const [result, setResult] = useState<QuoteResultData | null>(null);
  const [generateError, setGenerateError] = useState('');

  // Draft reply
  const [draftStage, setDraftStage] = useState<DraftStage>('idle');
  const [draft, setDraft] = useState<{ subject: string; body: string } | null>(null);
  const [draftError, setDraftError] = useState('');
  const [copied, setCopied] = useState(false);

  // Auto-analyse on mount
  const analyseEnquiry = useCallback(async () => {
    setStage('loading_analysis');
    try {
      const res = await fetch(`/api/enquiries/${enquiryId}/analyse`, { method: 'POST' });
      if (!res.ok) throw new Error('Analysis failed');
      const data = await res.json();
      const questions: AnalysisQuestion[] = data.questions ?? [];
      setAssumptions(
        questions.map((q) => ({
          question: q,
          value: q.defaultValue ?? (q.type === 'dropdown' && q.options?.[0] ? q.options[0] : ''),
          include: true,
        }))
      );
    } catch {
      // Non-fatal — proceed with empty assumptions
      setAssumptions([]);
    }
    setStage('ready');
  }, [enquiryId]);

  useEffect(() => {
    analyseEnquiry();
  }, [analyseEnquiry]);

  function setAssumptionValue(idx: number, value: string) {
    setAssumptions((prev) =>
      prev.map((a, i) => (i === idx ? { ...a, value } : a))
    );
  }

  function setAssumptionInclude(idx: number, include: boolean) {
    setAssumptions((prev) =>
      prev.map((a, i) => (i === idx ? { ...a, include } : a))
    );
  }

  function getIncludedAssumptions() {
    return assumptions
      .filter((a) => a.include && a.value.trim())
      .map((a) => ({ label: a.question.label, value: a.value.trim() }));
  }

  async function generateQuote() {
    setStage('generating');
    setGenerateError('');

    try {
      const res = await fetch('/api/quote', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          enquiry_text: rawInput,
          tenant_id: tenantId,
          enquiry_id: enquiryId,
          assumptions: getIncludedAssumptions(),
        }),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error ?? 'Quote generation failed');
      }

      const data: QuoteResultData = await res.json();
      setResult(data);
      setStage('result');
    } catch (err) {
      setGenerateError(err instanceof Error ? err.message : 'Something went wrong');
      setStage('ready');
    }
  }

  async function generateDraftReply() {
    if (!result) return;
    setDraftStage('generating');
    setDraftError('');

    try {
      const res = await fetch(`/api/enquiries/${enquiryId}/draft-reply`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          price_low: result.price_low,
          price_high: result.price_high,
          product_type: result.product_type,
          material: result.material,
          assumptions: getIncludedAssumptions(),
          quote_mode: result.quote_mode,
          missing_info: result.missing_info,
        }),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error ?? 'Draft generation failed');
      }

      const data = await res.json();
      setDraft(data);
      setDraftStage('ready');
    } catch (err) {
      setDraftError(err instanceof Error ? err.message : 'Something went wrong');
      setDraftStage('idle');
    }
  }

  async function copyToClipboard() {
    if (!draft) return;
    await navigator.clipboard.writeText(`Subject: ${draft.subject}\n\n${draft.body}`);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  function handleReset() {
    setStage('ready');
    setResult(null);
    setGenerateError('');
    setDraftStage('idle');
    setDraft(null);
    setDraftError('');
    router.refresh();
  }

  return (
    <div className="space-y-6">

      {/* Loading analysis */}
      {stage === 'loading_analysis' && (
        <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-6 flex items-center gap-3 text-sm text-gray-500">
          <div className="w-4 h-4 border-2 border-gray-400 border-t-transparent rounded-full animate-spin flex-shrink-0" />
          Analysing enquiry for missing information…
        </div>
      )}

      {/* Assumptions panel + generate button */}
      {(stage === 'ready' || stage === 'generating') && (
        <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-6 space-y-5">
          <div className="flex items-center justify-between">
            <h2 className="text-base font-semibold text-gray-900">Before generating</h2>
            <button
              type="button"
              onClick={analyseEnquiry}
              className="text-xs text-gray-400 hover:text-gray-600 transition-colors"
            >
              Re-analyse
            </button>
          </div>

          {assumptions.length === 0 ? (
            <p className="text-sm text-gray-400">No missing information identified.</p>
          ) : (
            <div className="space-y-3">
              <p className="text-xs text-gray-500">
                Fill in any known details before generating. Uncheck items to exclude them.
              </p>
              <AssumptionsList
                assumptions={assumptions}
                onValueChange={setAssumptionValue}
                onIncludeChange={setAssumptionInclude}
              />
            </div>
          )}

          {generateError && (
            <div className="rounded-md bg-red-50 border border-red-200 p-3 text-sm text-red-700">
              {generateError}
            </div>
          )}

          <button
            onClick={generateQuote}
            disabled={stage === 'generating'}
            className="w-full bg-gray-900 text-white text-sm font-medium py-2.5 px-4 rounded-md hover:bg-gray-800 disabled:opacity-50 transition-colors"
          >
            {stage === 'generating' ? (
              <span className="flex items-center justify-center gap-2">
                <span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                Analysing and finding similar jobs…
              </span>
            ) : (
              'Generate Quote'
            )}
          </button>
        </div>
      )}

      {/* Quote result */}
      {stage === 'result' && result && (
        <>
          <QuoteResult
            result={result}
            enquiryText={rawInput}
            tenantId={tenantId}
            onReset={handleReset}
            onAddDetails={result.quote_mode === 'rough' ? handleReset : undefined}
          />

          {/* Draft reply section */}
          <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-6">
            <div className="flex items-center justify-between mb-4">
              <div>
                <h2 className="text-base font-semibold text-gray-900">Draft Reply</h2>
                <p className="text-sm text-gray-500 mt-0.5">
                  Generate a professional email response to send to the customer
                </p>
              </div>
              {draftStage === 'idle' && (
                <button
                  onClick={generateDraftReply}
                  className="bg-gray-900 text-white text-sm font-medium py-2 px-4 rounded-md hover:bg-gray-800 transition-colors"
                >
                  Draft Reply
                </button>
              )}
              {draftStage === 'generating' && (
                <div className="flex items-center gap-2 text-sm text-gray-500">
                  <div className="w-4 h-4 border-2 border-gray-400 border-t-transparent rounded-full animate-spin" />
                  Writing…
                </div>
              )}
            </div>

            {draftError && (
              <div className="rounded-md bg-red-50 border border-red-200 p-3 text-sm text-red-700 mb-4">
                {draftError}
              </div>
            )}

            {draftStage === 'ready' && draft && (
              <div className="space-y-3">
                <div>
                  <p className="text-xs font-medium text-gray-400 uppercase tracking-wide mb-1">Subject</p>
                  <p className="text-sm font-medium text-gray-800">{draft.subject}</p>
                </div>

                <div>
                  <p className="text-xs font-medium text-gray-400 uppercase tracking-wide mb-1">Body</p>
                  <textarea
                    readOnly
                    value={draft.body}
                    rows={12}
                    className="w-full border border-gray-200 rounded-md px-3 py-2.5 text-sm text-gray-700 bg-gray-50 resize-y focus:outline-none"
                  />
                </div>

                <div className="flex gap-2">
                  <button
                    onClick={copyToClipboard}
                    className={`flex-1 text-sm font-medium py-2.5 px-4 rounded-md border transition-colors ${
                      copied
                        ? 'bg-green-50 border-green-300 text-green-700'
                        : 'bg-white border-gray-300 text-gray-700 hover:bg-gray-50'
                    }`}
                  >
                    {copied ? 'Copied!' : 'Copy to clipboard'}
                  </button>
                  <button
                    onClick={generateDraftReply}
                    className="border border-gray-300 text-gray-500 text-sm py-2.5 px-4 rounded-md hover:bg-gray-50 transition-colors"
                  >
                    Regenerate
                  </button>
                </div>
              </div>
            )}
          </div>
        </>
      )}

      {/* Quote version history */}
      {initialQuotes.length > 0 && stage !== 'result' && (
        <div>
          <h2 className="text-base font-semibold text-gray-800 mb-3">
            Quote versions ({initialQuotes.length})
          </h2>
          <div className="space-y-4">
            {initialQuotes.map((q, i) => (
              <div
                key={q.id}
                className="bg-white rounded-xl border border-gray-200 shadow-sm p-5"
              >
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium text-gray-700">
                      Version {initialQuotes.length - i}
                    </span>
                    {i === 0 && (
                      <span className="text-xs bg-gray-900 text-white px-2 py-0.5 rounded-full">
                        Latest
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-2">
                    {q.confidence && (
                      <span
                        className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium ${
                          CONFIDENCE_STYLES[q.confidence] ?? 'bg-gray-100 text-gray-600'
                        }`}
                      >
                        {q.confidence} confidence
                      </span>
                    )}
                    <span
                      className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium ${
                        STATUS_STYLES[q.status] ?? 'bg-gray-100 text-gray-600'
                      }`}
                    >
                      {q.status}
                    </span>
                  </div>
                </div>

                <div className="flex items-baseline gap-2 mb-3">
                  <span className="text-2xl font-bold text-gray-900">
                    £{q.price_low?.toLocaleString()} – £{q.price_high?.toLocaleString()}
                  </span>
                  {q.final_price && (
                    <span className="text-sm text-green-700 font-medium">
                      Final: £{q.final_price.toLocaleString()}
                    </span>
                  )}
                </div>

                {q.ai_reasoning && (
                  <p className="text-sm text-gray-600 mb-2">{q.ai_reasoning}</p>
                )}

                <p className="text-xs text-gray-400">
                  Generated {new Date(q.created_at).toLocaleString('en-GB')}
                  {q.reviewed_by && ` · Approved by ${q.reviewed_by.slice(0, 8)}…`}
                </p>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
