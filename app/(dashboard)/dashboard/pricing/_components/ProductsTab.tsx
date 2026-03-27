'use client';

import { useEffect, useState, useCallback } from 'react';

interface Product {
  id: string;
  category: string;
  design_name: string | null;
  width_mm: number | null;
  height_mm: number | null;
  price_gbp: number | null;
  helions_sku: string | null;
  supplier_sku: string | null;
  supplier_price: number | null;
  updated_at: string;
}

const CATEGORIES = [
  { value: '', label: 'All Categories' },
  { value: 'aluminium_driveway_gates', label: 'Aluminium Driveway Gates' },
  { value: 'aluminium_pedestrian_gates', label: 'Aluminium Pedestrian Gates' },
  { value: 'iron_driveway_gates', label: 'Iron Driveway Gates' },
];

export default function ProductsTab() {
  const [products, setProducts] = useState<Product[]>([]);
  const [category, setCategory] = useState('');
  const [search, setSearch] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingValues, setEditingValues] = useState<Partial<Product>>({});
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(() => {
    const params = new URLSearchParams();
    if (category) params.set('category', category);
    if (search) params.set('search', search);
    fetch(`/api/pricing/products?${params}`)
      .then((r) => r.json())
      .then(setProducts)
      .catch(() => setError('Failed to load products'));
  }, [category, search]);

  useEffect(() => { load(); }, [load]);

  function startEdit(p: Product) {
    setEditingId(p.id);
    setEditingValues({ price_gbp: p.price_gbp, supplier_price: p.supplier_price });
  }

  async function saveEdit(id: string) {
    setSaving(true);
    setError('');
    try {
      const res = await fetch('/api/pricing/products', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id,
          price_gbp: editingValues.price_gbp !== undefined ? Number(editingValues.price_gbp) : undefined,
          supplier_price: editingValues.supplier_price !== undefined ? Number(editingValues.supplier_price) : undefined,
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
      <div className="flex gap-3 mb-4">
        <select
          value={category}
          onChange={(e) => setCategory(e.target.value)}
          className="border border-gray-300 rounded px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-gray-400"
        >
          {CATEGORIES.map((c) => (
            <option key={c.value} value={c.value}>{c.label}</option>
          ))}
        </select>
        <input
          type="text"
          placeholder="Search design name…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="border border-gray-300 rounded px-3 py-1.5 text-sm flex-1 focus:outline-none focus:ring-2 focus:ring-gray-400"
        />
      </div>

      {error && <p className="text-sm text-red-600 mb-3">{error}</p>}

      {products.length === 0 ? (
        <p className="text-sm text-gray-400 py-6 text-center">No products found. Run the CSV seed SQL to populate.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm border-collapse">
            <thead>
              <tr className="border-b border-gray-200 text-left text-xs text-gray-500">
                <th className="pb-2 pr-4">Category</th>
                <th className="pb-2 pr-4">Design</th>
                <th className="pb-2 pr-4">Size (mm)</th>
                <th className="pb-2 pr-4">Helions SKU</th>
                <th className="pb-2 pr-4">Supplier Price</th>
                <th className="pb-2 pr-4">Our Price</th>
                <th className="pb-2 pr-4">Updated</th>
                <th className="pb-2"></th>
              </tr>
            </thead>
            <tbody>
              {products.map((p) => (
                <tr key={p.id} className="border-b border-gray-100 hover:bg-gray-50">
                  <td className="py-2 pr-4 text-xs text-gray-500">{p.category.replace(/_/g, ' ')}</td>
                  <td className="py-2 pr-4">{p.design_name ?? '—'}</td>
                  <td className="py-2 pr-4 text-xs">
                    {p.width_mm && p.height_mm ? `${p.width_mm} × ${p.height_mm}` : '—'}
                  </td>
                  <td className="py-2 pr-4 text-xs text-gray-500">{p.helions_sku ?? '—'}</td>
                  <td className="py-2 pr-4">
                    {editingId === p.id ? (
                      <input
                        type="number"
                        step="0.01"
                        value={editingValues.supplier_price ?? ''}
                        onChange={(e) => setEditingValues((v) => ({ ...v, supplier_price: Number(e.target.value) }))}
                        className="border border-gray-300 rounded px-2 py-0.5 w-24 text-sm"
                      />
                    ) : (
                      p.supplier_price != null ? `£${p.supplier_price.toFixed(2)}` : '—'
                    )}
                  </td>
                  <td className="py-2 pr-4">
                    {editingId === p.id ? (
                      <input
                        type="number"
                        step="0.01"
                        value={editingValues.price_gbp ?? ''}
                        onChange={(e) => setEditingValues((v) => ({ ...v, price_gbp: Number(e.target.value) }))}
                        className="border border-gray-300 rounded px-2 py-0.5 w-24 text-sm"
                      />
                    ) : (
                      p.price_gbp != null ? `£${p.price_gbp.toFixed(2)}` : '—'
                    )}
                  </td>
                  <td className="py-2 pr-4 text-xs text-gray-400">
                    {new Date(p.updated_at).toLocaleDateString('en-GB')}
                  </td>
                  <td className="py-2">
                    {editingId === p.id ? (
                      <div className="flex gap-2">
                        <button
                          onClick={() => saveEdit(p.id)}
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
                      <button onClick={() => startEdit(p)} className="text-xs text-blue-600 hover:underline">
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
