'use client';

import { useState, useMemo } from 'react';

export interface Quote {
  id: string;
  product_type: string | null;
  material: string | null;
  description: string;
  price_low: number | null;
  price_high: number | null;
  final_price: number | null;
  status: string;
  lost_reason: string | null;
  is_golden: boolean;
  created_at: string;
}

const STATUS_STYLES: Record<string, string> = {
  won: 'bg-green-100 text-green-700',
  lost: 'bg-red-100 text-red-700',
  draft: 'bg-gray-100 text-gray-600',
  sent: 'bg-blue-100 text-blue-700',
  unknown: 'bg-yellow-100 text-yellow-700',
};

const LOST_REASONS = [
  { value: 'price_too_high', label: 'Price too high' },
  { value: 'lost_to_competitor', label: 'Lost to competitor' },
  { value: 'project_cancelled', label: 'Project cancelled' },
  { value: 'no_response', label: 'No response' },
  { value: 'other', label: 'Other' },
];

function exportCSV(quotes: Quote[]) {
  const headers = [
    'ID', 'Product Type', 'Material', 'Description',
    'Price Low', 'Price High', 'Final Price', 'Status', 'Lost Reason', 'Golden', 'Created At',
  ];
  const rows = quotes.map((q) => [
    q.id,
    q.product_type ?? '',
    q.material ?? '',
    `"${(q.description ?? '').replace(/"/g, '""')}"`,
    q.price_low ?? '',
    q.price_high ?? '',
    q.final_price ?? '',
    q.status,
    q.lost_reason ?? '',
    q.is_golden ? 'Yes' : 'No',
    new Date(q.created_at).toLocaleDateString('en-GB'),
  ]);

  const csv = [headers.join(','), ...rows.map((r) => r.join(','))].join('\n');
  const blob = new Blob([csv], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `quotes-${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

export function QuotesList({ initialQuotes }: { initialQuotes: Quote[] }) {
  const [quotes, setQuotes] = useState<Quote[]>(initialQuotes);
  const [productFilter, setProductFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [goldenLoading, setGoldenLoading] = useState<string | null>(null);
  const [lostReasonLoading, setLostReasonLoading] = useState<string | null>(null);

  const productTypes = useMemo(() => {
    const types = quotes.map((q) => q.product_type).filter(Boolean) as string[];
    return Array.from(new Set(types)).sort();
  }, [quotes]);

  const filtered = useMemo(() => {
    return quotes.filter((q) => {
      if (productFilter && q.product_type?.toLowerCase() !== productFilter.toLowerCase()) return false;
      if (statusFilter && q.status !== statusFilter) return false;
      if (dateFrom && new Date(q.created_at) < new Date(dateFrom)) return false;
      if (dateTo && new Date(q.created_at) > new Date(dateTo + 'T23:59:59')) return false;
      return true;
    });
  }, [quotes, productFilter, statusFilter, dateFrom, dateTo]);

  async function toggleGolden(id: string, current: boolean) {
    setGoldenLoading(id);
    try {
      const res = await fetch(`/api/quotes/${id}/golden`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ is_golden: !current }),
      });
      if (res.ok) {
        setQuotes((prev) =>
          prev.map((q) => (q.id === id ? { ...q, is_golden: !current } : q))
        );
      }
    } finally {
      setGoldenLoading(null);
    }
  }

  async function setLostReason(id: string, lost_reason: string | null) {
    setLostReasonLoading(id);
    try {
      const updates: { lost_reason: string | null; status?: string } = { lost_reason };
      // Auto-set status to 'lost' when a lost reason is applied
      if (lost_reason) updates.status = 'lost';
      const res = await fetch(`/api/quotes/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updates),
      });
      if (res.ok) {
        const updated = await res.json();
        setQuotes((prev) =>
          prev.map((q) =>
            q.id === id
              ? { ...q, lost_reason: updated.lost_reason, status: updated.status ?? q.status }
              : q
          )
        );
      }
    } finally {
      setLostReasonLoading(null);
    }
  }

  return (
    <div className="space-y-5">
      {/* Filter bar */}
      <div className="flex flex-wrap items-center gap-3">
        <select
          value={productFilter}
          onChange={(e) => setProductFilter(e.target.value)}
          className="rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-700 focus:outline-none focus:ring-2 focus:ring-gray-900"
        >
          <option value="">All product types</option>
          {productTypes.map((t) => (
            <option key={t} value={t}>{t}</option>
          ))}
        </select>

        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          className="rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-700 focus:outline-none focus:ring-2 focus:ring-gray-900"
        >
          <option value="">All statuses</option>
          <option value="won">Won</option>
          <option value="lost">Lost</option>
          <option value="sent">Sent</option>
          <option value="draft">Draft</option>
          <option value="unknown">Unknown</option>
        </select>

        <input
          type="date"
          value={dateFrom}
          onChange={(e) => setDateFrom(e.target.value)}
          className="rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-700 focus:outline-none focus:ring-2 focus:ring-gray-900"
          placeholder="From"
          title="From date"
        />
        <input
          type="date"
          value={dateTo}
          onChange={(e) => setDateTo(e.target.value)}
          className="rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-700 focus:outline-none focus:ring-2 focus:ring-gray-900"
          placeholder="To"
          title="To date"
        />

        <span className="text-sm text-gray-400 ml-auto">{filtered.length} quotes</span>

        <button
          onClick={() => exportCSV(filtered)}
          disabled={filtered.length === 0}
          className="text-sm bg-gray-100 text-gray-700 px-3 py-2 rounded-lg hover:bg-gray-200 disabled:opacity-40 transition-colors"
        >
          Export CSV
        </button>
      </div>

      {/* Table */}
      {filtered.length === 0 ? (
        <div className="bg-white rounded-xl border border-gray-200 p-10 text-center text-sm text-gray-400">
          No quotes found. <a href="/dashboard/upload" className="text-gray-600 underline">Upload some.</a>
        </div>
      ) : (
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden shadow-sm">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-100 bg-gray-50">
                <th className="px-4 py-3 text-left font-medium text-gray-500">Type</th>
                <th className="px-4 py-3 text-left font-medium text-gray-500">Material</th>
                <th className="px-4 py-3 text-left font-medium text-gray-500 hidden md:table-cell">Description</th>
                <th className="px-4 py-3 text-left font-medium text-gray-500">Price range</th>
                <th className="px-4 py-3 text-left font-medium text-gray-500">Status</th>
                <th className="px-4 py-3 text-left font-medium text-gray-500 hidden lg:table-cell">Lost reason</th>
                <th className="px-4 py-3 text-left font-medium text-gray-500">Golden</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {filtered.map((q) => (
                <tr key={q.id} className="hover:bg-gray-50 transition-colors">
                  <td className="px-4 py-3 text-gray-800 font-medium">{q.product_type ?? '—'}</td>
                  <td className="px-4 py-3 text-gray-600">{q.material ?? '—'}</td>
                  <td className="px-4 py-3 text-gray-500 hidden md:table-cell max-w-xs truncate">
                    {q.description}
                  </td>
                  <td className="px-4 py-3 text-gray-700 whitespace-nowrap">
                    {q.price_low != null && q.price_high != null
                      ? `£${q.price_low.toLocaleString()} – £${q.price_high.toLocaleString()}`
                      : q.final_price != null
                      ? `£${q.final_price.toLocaleString()}`
                      : '—'}
                  </td>
                  <td className="px-4 py-3">
                    <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium ${STATUS_STYLES[q.status] ?? STATUS_STYLES.draft}`}>
                      {q.status}
                    </span>
                  </td>
                  <td className="px-4 py-3 hidden lg:table-cell">
                    <select
                      value={q.lost_reason ?? ''}
                      disabled={lostReasonLoading === q.id}
                      onChange={(e) => setLostReason(q.id, e.target.value || null)}
                      className="text-xs border border-gray-200 rounded px-2 py-1 text-gray-600 focus:outline-none focus:ring-1 focus:ring-gray-400 disabled:opacity-40 bg-transparent"
                    >
                      <option value="">—</option>
                      {LOST_REASONS.map((r) => (
                        <option key={r.value} value={r.value}>{r.label}</option>
                      ))}
                    </select>
                  </td>
                  <td className="px-4 py-3">
                    <button
                      onClick={() => toggleGolden(q.id, q.is_golden)}
                      disabled={goldenLoading === q.id}
                      title={q.is_golden ? 'Remove golden status' : 'Mark as golden'}
                      className={`text-lg transition-opacity ${goldenLoading === q.id ? 'opacity-40' : 'hover:scale-110'}`}
                    >
                      {q.is_golden ? '⭐' : '☆'}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
