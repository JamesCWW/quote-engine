'use client';

import { useEffect, useState, useCallback } from 'react';

interface Accessory {
  id: string;
  category: string;
  item_name: string;
  supplier_name: string | null;
  supplier_price: number | null;
  helions_price: number | null;
  notes: string | null;
  updated_at: string;
}

const CATEGORIES = [
  { value: '', label: 'All Categories' },
  { value: 'aluminium_accessories', label: 'Aluminium Accessories' },
  { value: 'iron_accessories', label: 'Iron Accessories' },
  { value: 'automation', label: 'Automation' },
];

export default function AccessoriesTab() {
  const [accessories, setAccessories] = useState<Accessory[]>([]);
  const [category, setCategory] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingValues, setEditingValues] = useState<Partial<Accessory>>({});
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(() => {
    const params = new URLSearchParams();
    if (category) params.set('category', category);
    fetch(`/api/pricing/accessories?${params}`)
      .then((r) => r.json())
      .then(setAccessories)
      .catch(() => setError('Failed to load accessories'));
  }, [category]);

  useEffect(() => { load(); }, [load]);

  function startEdit(a: Accessory) {
    setEditingId(a.id);
    setEditingValues({ supplier_price: a.supplier_price, helions_price: a.helions_price });
  }

  async function saveEdit(id: string) {
    setSaving(true);
    setError('');
    try {
      const res = await fetch('/api/pricing/accessories', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id,
          supplier_price: editingValues.supplier_price !== undefined ? Number(editingValues.supplier_price) : undefined,
          helions_price: editingValues.helions_price !== undefined ? Number(editingValues.helions_price) : undefined,
        }),
      });
      if (!res.ok) throw new Error(await res.text());
      setEditingId(null);
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Save failed');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div>
      <div className="mb-4">
        <select
          value={category}
          onChange={(e) => setCategory(e.target.value)}
          className="border border-gray-300 rounded px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-gray-400"
        >
          {CATEGORIES.map((c) => (
            <option key={c.value} value={c.value}>{c.label}</option>
          ))}
        </select>
      </div>

      {error && <p className="text-sm text-red-600 mb-3">{error}</p>}

      {accessories.length === 0 ? (
        <p className="text-sm text-gray-400 py-6 text-center">No accessories found. Run the CSV seed SQL to populate.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm border-collapse">
            <thead>
              <tr className="border-b border-gray-200 text-left text-xs text-gray-500">
                <th className="pb-2 pr-4">Category</th>
                <th className="pb-2 pr-4">Item</th>
                <th className="pb-2 pr-4">Supplier</th>
                <th className="pb-2 pr-4">Supplier Price</th>
                <th className="pb-2 pr-4">Helions Price</th>
                <th className="pb-2 pr-4">Updated</th>
                <th className="pb-2"></th>
              </tr>
            </thead>
            <tbody>
              {accessories.map((a) => (
                <tr key={a.id} className="border-b border-gray-100 hover:bg-gray-50">
                  <td className="py-2 pr-4 text-xs text-gray-500">{a.category.replace(/_/g, ' ')}</td>
                  <td className="py-2 pr-4">{a.item_name}</td>
                  <td className="py-2 pr-4 text-xs text-gray-500">{a.supplier_name ?? '—'}</td>
                  <td className="py-2 pr-4">
                    {editingId === a.id ? (
                      <input
                        type="number"
                        step="0.01"
                        value={editingValues.supplier_price ?? ''}
                        onChange={(e) => setEditingValues((v) => ({ ...v, supplier_price: Number(e.target.value) }))}
                        className="border border-gray-300 rounded px-2 py-0.5 w-24 text-sm"
                      />
                    ) : (
                      a.supplier_price != null ? `£${a.supplier_price.toFixed(2)}` : '—'
                    )}
                  </td>
                  <td className="py-2 pr-4">
                    {editingId === a.id ? (
                      <input
                        type="number"
                        step="0.01"
                        value={editingValues.helions_price ?? ''}
                        onChange={(e) => setEditingValues((v) => ({ ...v, helions_price: Number(e.target.value) }))}
                        className="border border-gray-300 rounded px-2 py-0.5 w-24 text-sm"
                      />
                    ) : (
                      a.helions_price != null ? `£${a.helions_price.toFixed(2)}` : '—'
                    )}
                  </td>
                  <td className="py-2 pr-4 text-xs text-gray-400">
                    {new Date(a.updated_at).toLocaleDateString('en-GB')}
                  </td>
                  <td className="py-2">
                    {editingId === a.id ? (
                      <div className="flex gap-2">
                        <button
                          onClick={() => saveEdit(a.id)}
                          disabled={saving}
                          className="text-xs text-green-700 hover:underline disabled:opacity-50"
                        >
                          Save
                        </button>
                        <button onClick={() => setEditingId(null)} className="text-xs text-gray-400 hover:underline">
                          Cancel
                        </button>
                      </div>
                    ) : (
                      <button onClick={() => startEdit(a)} className="text-xs text-blue-600 hover:underline">
                        Edit
                      </button>
                    )}
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
