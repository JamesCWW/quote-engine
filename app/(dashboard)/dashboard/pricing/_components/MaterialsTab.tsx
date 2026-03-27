'use client';

import { useEffect, useState } from 'react';

interface Material {
  id: string;
  material: string;
  kg_per_unit: number | null;
  unit_cost_gbp: number | null;
  updated_at: string;
}

export default function MaterialsTab() {
  const [materials, setMaterials] = useState<Material[]>([]);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingValues, setEditingValues] = useState<Partial<Material>>({});
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  function load() {
    fetch('/api/pricing/materials')
      .then((r) => r.json())
      .then(setMaterials)
      .catch(() => setError('Failed to load materials'));
  }

  useEffect(() => { load(); }, []);

  function startEdit(m: Material) {
    setEditingId(m.id);
    setEditingValues({ kg_per_unit: m.kg_per_unit, unit_cost_gbp: m.unit_cost_gbp });
  }

  async function saveEdit(id: string) {
    setSaving(true);
    setError('');
    try {
      const res = await fetch('/api/pricing/materials', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id,
          kg_per_unit: editingValues.kg_per_unit !== undefined ? Number(editingValues.kg_per_unit) : undefined,
          unit_cost_gbp: editingValues.unit_cost_gbp !== undefined ? Number(editingValues.unit_cost_gbp) : undefined,
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
      {error && <p className="text-sm text-red-600 mb-3">{error}</p>}

      {materials.length === 0 ? (
        <p className="text-sm text-gray-400 py-6 text-center">No materials found. Run the CSV seed SQL to populate.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm border-collapse">
            <thead>
              <tr className="border-b border-gray-200 text-left text-xs text-gray-500">
                <th className="pb-2 pr-4">Material / Section</th>
                <th className="pb-2 pr-4">kg per unit</th>
                <th className="pb-2 pr-4">Cost per unit</th>
                <th className="pb-2 pr-4">Updated</th>
                <th className="pb-2"></th>
              </tr>
            </thead>
            <tbody>
              {materials.map((m) => (
                <tr key={m.id} className="border-b border-gray-100 hover:bg-gray-50">
                  <td className="py-2 pr-4 font-medium">{m.material}</td>
                  <td className="py-2 pr-4">
                    {editingId === m.id ? (
                      <input
                        type="number"
                        step="0.001"
                        value={editingValues.kg_per_unit ?? ''}
                        onChange={(e) => setEditingValues((v) => ({ ...v, kg_per_unit: Number(e.target.value) }))}
                        className="border border-gray-300 rounded px-2 py-0.5 w-24 text-sm"
                      />
                    ) : (
                      m.kg_per_unit != null ? `${m.kg_per_unit} kg` : '—'
                    )}
                  </td>
                  <td className="py-2 pr-4">
                    {editingId === m.id ? (
                      <input
                        type="number"
                        step="0.01"
                        value={editingValues.unit_cost_gbp ?? ''}
                        onChange={(e) => setEditingValues((v) => ({ ...v, unit_cost_gbp: Number(e.target.value) }))}
                        className="border border-gray-300 rounded px-2 py-0.5 w-24 text-sm"
                      />
                    ) : (
                      m.unit_cost_gbp != null ? `£${m.unit_cost_gbp.toFixed(2)}` : '—'
                    )}
                  </td>
                  <td className="py-2 pr-4 text-xs text-gray-400">
                    {new Date(m.updated_at).toLocaleDateString('en-GB')}
                  </td>
                  <td className="py-2">
                    {editingId === m.id ? (
                      <div className="flex gap-2">
                        <button
                          onClick={() => saveEdit(m.id)}
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
                      <button onClick={() => startEdit(m)} className="text-xs text-blue-600 hover:underline">
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
