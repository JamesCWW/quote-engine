'use client';

import { useState, useRef } from 'react';

interface SanitisedData {
  product_type: string | null;
  material: string | null;
  description: string;
  dimensions: Record<string, number> | null;
  price_low: number | null;
  price_high: number | null;
  final_price: number | null;
  status: 'won' | 'lost' | 'unknown';
}

type UploadMode = 'single' | 'batch';
type StepStatus = 'idle' | 'sanitising' | 'embedding' | 'done' | 'error';

interface BatchResult {
  index: number;
  status: 'ok' | 'error';
  message: string;
}

export function UploadForm({ tenantId }: { tenantId: string }) {
  const [mode, setMode] = useState<UploadMode>('single');

  // Single upload state
  const [rawText, setRawText] = useState('');
  const [stepStatus, setStepStatus] = useState<StepStatus>('idle');
  const [sanitisedPreview, setSanitisedPreview] = useState<SanitisedData | null>(null);
  const [errorMessage, setErrorMessage] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Batch upload state
  const [batchStatus, setBatchStatus] = useState<'idle' | 'processing' | 'done'>('idle');
  const [batchResults, setBatchResults] = useState<BatchResult[]>([]);
  const csvInputRef = useRef<HTMLInputElement>(null);

  async function handleSingleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!rawText.trim()) return;

    setErrorMessage('');
    setSanitisedPreview(null);
    setStepStatus('sanitising');

    // Step 1: Sanitise
    let sanitised: SanitisedData;
    try {
      const res = await fetch('/api/sanitise', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ raw_text: rawText, tenant_id: tenantId }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? 'Sanitise failed');
      sanitised = json.data as SanitisedData;
      setSanitisedPreview(sanitised);
    } catch (err) {
      setErrorMessage((err as Error).message);
      setStepStatus('error');
      return;
    }

    // Step 2: Embed + store
    setStepStatus('embedding');
    try {
      const res = await fetch('/api/embed', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...sanitised, raw_text: rawText, tenant_id: tenantId }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? 'Embed failed');
    } catch (err) {
      setErrorMessage((err as Error).message);
      setStepStatus('error');
      return;
    }

    setStepStatus('done');
    setRawText('');
  }

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;

    if (file.type === 'text/plain' || file.name.endsWith('.txt')) {
      const reader = new FileReader();
      reader.onload = (ev) => setRawText((ev.target?.result as string) ?? '');
      reader.readAsText(file);
    } else if (file.name.endsWith('.pdf')) {
      // PDFs: we can't parse in-browser without a library.
      // Set a placeholder so the user knows to also paste text.
      setRawText(`[PDF uploaded: ${file.name}]\n\nPlease paste the PDF text content above to process it.`);
    }
  }

  async function handleCsvUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;

    setBatchStatus('processing');
    setBatchResults([]);

    const text = await file.text();
    const lines = text.split('\n').map((l) => l.trim()).filter(Boolean);

    // Skip header row if it looks like a header (contains "raw_text")
    const startIndex = lines[0]?.toLowerCase().includes('raw_text') ? 1 : 0;
    const rows = lines.slice(startIndex);

    const results: BatchResult[] = [];

    for (let i = 0; i < rows.length; i++) {
      // CSV rows may be quoted; do a basic parse
      const raw = rows[i].replace(/^"([\s\S]*)"$/, '$1').replace(/""/g, '"');
      if (!raw.trim()) continue;

      try {
        // Sanitise
        const sanitiseRes = await fetch('/api/sanitise', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ raw_text: raw, tenant_id: tenantId }),
        });
        const sanitiseJson = await sanitiseRes.json();
        if (!sanitiseRes.ok) throw new Error(sanitiseJson.error ?? 'Sanitise failed');
        const sanitised = sanitiseJson.data as SanitisedData;

        // Embed
        const embedRes = await fetch('/api/embed', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ...sanitised, raw_text: raw, tenant_id: tenantId }),
        });
        const embedJson = await embedRes.json();
        if (!embedRes.ok) throw new Error(embedJson.error ?? 'Embed failed');

        results.push({ index: i + 1, status: 'ok', message: `Row ${i + 1}: saved (${sanitised.product_type ?? 'unknown type'})` });
      } catch (err) {
        results.push({ index: i + 1, status: 'error', message: `Row ${i + 1}: ${(err as Error).message}` });
      }

      // Update UI incrementally
      setBatchResults([...results]);
    }

    setBatchStatus('done');
    if (csvInputRef.current) csvInputRef.current.value = '';
  }

  function reset() {
    setStepStatus('idle');
    setSanitisedPreview(null);
    setErrorMessage('');
    setRawText('');
    if (fileInputRef.current) fileInputRef.current.value = '';
  }

  return (
    <div className="space-y-6">
      {/* Mode tabs */}
      <div className="flex border border-gray-200 rounded-lg overflow-hidden w-fit">
        <button
          onClick={() => setMode('single')}
          className={`px-4 py-2 text-sm font-medium ${mode === 'single' ? 'bg-gray-900 text-white' : 'bg-white text-gray-600 hover:bg-gray-50'}`}
        >
          Single Upload
        </button>
        <button
          onClick={() => setMode('batch')}
          className={`px-4 py-2 text-sm font-medium border-l border-gray-200 ${mode === 'batch' ? 'bg-gray-900 text-white' : 'bg-white text-gray-600 hover:bg-gray-50'}`}
        >
          Batch CSV
        </button>
      </div>

      {/* Single upload */}
      {mode === 'single' && (
        <div className="bg-white rounded-xl border border-gray-200 p-6 shadow-sm">
          {stepStatus === 'done' ? (
            <div className="space-y-4">
              <div className="flex items-center gap-2 text-green-700">
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
                <span className="font-medium">Quote saved successfully</span>
              </div>
              {sanitisedPreview && (
                <div className="bg-gray-50 rounded-lg p-4 text-sm space-y-1 text-gray-700">
                  <div><span className="font-medium">Type:</span> {sanitisedPreview.product_type ?? '—'}</div>
                  <div><span className="font-medium">Material:</span> {sanitisedPreview.material ?? '—'}</div>
                  <div><span className="font-medium">Description:</span> {sanitisedPreview.description}</div>
                  {sanitisedPreview.price_low != null && (
                    <div><span className="font-medium">Price range:</span> £{sanitisedPreview.price_low} – £{sanitisedPreview.price_high}</div>
                  )}
                  <div><span className="font-medium">Status:</span> {sanitisedPreview.status}</div>
                </div>
              )}
              <button onClick={reset} className="text-sm text-gray-500 hover:text-gray-700 underline">
                Upload another
              </button>
            </div>
          ) : (
            <form onSubmit={handleSingleSubmit} className="space-y-5">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Paste quote / email text
                </label>
                <textarea
                  value={rawText}
                  onChange={(e) => setRawText(e.target.value)}
                  rows={10}
                  placeholder="Paste the raw email or quote text here..."
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-gray-900 resize-y"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Or upload a file (.txt or .pdf)
                </label>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".txt,.pdf"
                  onChange={handleFileChange}
                  className="block text-sm text-gray-500 file:mr-3 file:py-1.5 file:px-3 file:rounded file:border-0 file:text-sm file:font-medium file:bg-gray-100 file:text-gray-700 hover:file:bg-gray-200"
                />
                <p className="mt-1 text-xs text-gray-400">
                  Text files are loaded automatically. For PDFs, paste the text content above.
                </p>
              </div>

              {stepStatus === 'error' && (
                <p className="text-sm text-red-600 bg-red-50 rounded-lg px-3 py-2">{errorMessage}</p>
              )}

              <button
                type="submit"
                disabled={!rawText.trim() || stepStatus === 'sanitising' || stepStatus === 'embedding'}
                className="w-full rounded-lg bg-gray-900 text-white px-4 py-2.5 text-sm font-medium disabled:opacity-50 hover:bg-gray-800 transition-colors"
              >
                {stepStatus === 'sanitising' && 'Sanitising with AI…'}
                {stepStatus === 'embedding' && 'Generating embedding…'}
                {(stepStatus === 'idle' || stepStatus === 'error') && 'Clean & Store Quote'}
              </button>
            </form>
          )}
        </div>
      )}

      {/* Batch CSV upload */}
      {mode === 'batch' && (
        <div className="bg-white rounded-xl border border-gray-200 p-6 shadow-sm space-y-5">
          <div>
            <p className="text-sm text-gray-600 mb-3">
              Upload a CSV file with a single column <code className="bg-gray-100 px-1 rounded text-xs">raw_text</code> (one quote/email per row).
              Each row will be sanitised and embedded automatically.
            </p>
            <input
              ref={csvInputRef}
              type="file"
              accept=".csv"
              disabled={batchStatus === 'processing'}
              onChange={handleCsvUpload}
              className="block text-sm text-gray-500 file:mr-3 file:py-1.5 file:px-3 file:rounded file:border-0 file:text-sm file:font-medium file:bg-gray-100 file:text-gray-700 hover:file:bg-gray-200 disabled:opacity-50"
            />
          </div>

          {batchStatus === 'processing' && (
            <p className="text-sm text-gray-500 animate-pulse">Processing rows…</p>
          )}

          {batchResults.length > 0 && (
            <div className="space-y-1 max-h-64 overflow-y-auto">
              {batchResults.map((r) => (
                <div
                  key={r.index}
                  className={`text-xs px-3 py-1.5 rounded ${r.status === 'ok' ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-700'}`}
                >
                  {r.message}
                </div>
              ))}
            </div>
          )}

          {batchStatus === 'done' && (
            <div className="text-sm text-gray-700">
              Done — {batchResults.filter((r) => r.status === 'ok').length} of {batchResults.length} rows saved.{' '}
              <button
                onClick={() => { setBatchStatus('idle'); setBatchResults([]); }}
                className="underline text-gray-500 hover:text-gray-700"
              >
                Reset
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
