'use client';

import { useState } from 'react';

export interface Material {
  id: string;
  name: string;
  unit: string;
  rate_gbp: number;
  updated_at: string;
}

interface EditState {
  id: string;
  name: string;
  unit: string;
  rate_gbp: string;
}

export function MaterialsTable({ initialMaterials }: { initialMaterials: Material[] }) {
  const [materials, setMaterials] = useState<Material[]>(initialMaterials);
  const [editing, setEditing] = useState<EditState | null>(null);
  const [adding, setAdding] = useState(false);
  const [newRow, setNewRow] = useState({ name: '', unit: '', rate_gbp: '' });
  const [loading, setLoading] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function saveEdit() {
    if (!editing) return;
    setLoading(editing.id);
    setError(null);
    try {
      const res = await fetch(`/api/materials/${editing.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: editing.name,
          unit: editing.unit,
          rate_gbp: parseFloat(editing.rate_gbp),
        }),
      });
      if (!res.ok) throw new Error(await res.text());
      const updated: Material = await res.json();
      setMaterials((prev) => prev.map((m) => (m.id === updated.id ? updated : m)));
      setEditing(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Update failed');
    } finally {
      setLoading(null);
    }
  }

  async function deleteMaterial(id: string) {
    if (!confirm('Delete this material?')) return;
    setLoading(id);
    setError(null);
    try {
      const res = await fetch(`/api/materials/${id}`, { method: 'DELETE' });
      if (!res.ok) throw new Error(await res.text());
      setMaterials((prev) => prev.filter((m) => m.id !== id));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Delete failed');
    } finally {
      setLoading(null);
    }
  }

  async function addMaterial() {
    setLoading('new');
    setError(null);
    try {
      const res = await fetch('/api/materials', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: newRow.name,
          unit: newRow.unit,
          rate_gbp: parseFloat(newRow.rate_gbp),
        }),
      });
      if (!res.ok) throw new Error(await res.text());
      const created: Material = await res.json();
      setMaterials((prev) => [...prev, created].sort((a, b) => a.name.localeCompare(b.name)));
      setNewRow({ name: '', unit: '', rate_gbp: '' });
      setAdding(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Add failed');
    } finally {
      setLoading(null);
    }
  }

  return (
    <div className="space-y-4">
      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-2 rounded-lg text-sm">
          {error}
        </div>
      )}

      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden shadow-sm">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-100 bg-gray-50">
              <th className="px-4 py-3 text-left font-medium text-gray-500">Material</th>
              <th className="px-4 py-3 text-left font-medium text-gray-500">Unit</th>
              <th className="px-4 py-3 text-left font-medium text-gray-500">Rate (£)</th>
              <th className="px-4 py-3 text-left font-medium text-gray-500">Last updated</th>
              <th className="px-4 py-3 text-left font-medium text-gray-500">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {materials.map((m) =>
              editing?.id === m.id ? (
                <tr key={m.id} className="bg-blue-50">
                  <td className="px-4 py-2">
                    <input
                      className="w-full border border-gray-300 rounded px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-gray-900"
                      value={editing.name}
                      onChange={(e) => setEditing({ ...editing, name: e.target.value })}
                    />
                  </td>
                  <td className="px-4 py-2">
                    <input
                      className="w-full border border-gray-300 rounded px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-gray-900"
                      value={editing.unit}
                      onChange={(e) => setEditing({ ...editing, unit: e.target.value })}
                      placeholder="e.g. per kg"
                    />
                  </td>
                  <td className="px-4 py-2">
                    <input
                      type="number"
                      step="0.01"
                      className="w-24 border border-gray-300 rounded px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-gray-900"
                      value={editing.rate_gbp}
                      onChange={(e) => setEditing({ ...editing, rate_gbp: e.target.value })}
                    />
                  </td>
                  <td className="px-4 py-2 text-gray-400">—</td>
                  <td className="px-4 py-2 flex gap-2">
                    <button
                      onClick={saveEdit}
                      disabled={loading === m.id}
                      className="text-xs bg-gray-900 text-white px-3 py-1 rounded hover:bg-gray-700 disabled:opacity-40"
                    >
                      Save
                    </button>
                    <button
                      onClick={() => setEditing(null)}
                      className="text-xs text-gray-500 hover:text-gray-900"
                    >
                      Cancel
                    </button>
                  </td>
                </tr>
              ) : (
                <tr key={m.id} className="hover:bg-gray-50 transition-colors">
                  <td className="px-4 py-3 font-medium text-gray-800">{m.name}</td>
                  <td className="px-4 py-3 text-gray-600">{m.unit}</td>
                  <td className="px-4 py-3 text-gray-700">
                    £{Number(m.rate_gbp).toFixed(2)}
                  </td>
                  <td className="px-4 py-3 text-gray-400 whitespace-nowrap">
                    {new Date(m.updated_at).toLocaleDateString('en-GB', {
                      day: 'numeric',
                      month: 'short',
                      year: 'numeric',
                    })}
                  </td>
                  <td className="px-4 py-3 flex gap-3">
                    <button
                      onClick={() =>
                        setEditing({
                          id: m.id,
                          name: m.name,
                          unit: m.unit,
                          rate_gbp: String(m.rate_gbp),
                        })
                      }
                      className="text-xs text-blue-600 hover:text-blue-800"
                    >
                      Edit
                    </button>
                    <button
                      onClick={() => deleteMaterial(m.id)}
                      disabled={loading === m.id}
                      className="text-xs text-red-500 hover:text-red-700 disabled:opacity-40"
                    >
                      Delete
                    </button>
                  </td>
                </tr>
              )
            )}

            {/* Add new row */}
            {adding && (
              <tr className="bg-green-50">
                <td className="px-4 py-2">
                  <input
                    autoFocus
                    className="w-full border border-gray-300 rounded px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-gray-900"
                    placeholder="e.g. 316 Stainless Steel"
                    value={newRow.name}
                    onChange={(e) => setNewRow({ ...newRow, name: e.target.value })}
                  />
                </td>
                <td className="px-4 py-2">
                  <input
                    className="w-full border border-gray-300 rounded px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-gray-900"
                    placeholder="e.g. per kg"
                    value={newRow.unit}
                    onChange={(e) => setNewRow({ ...newRow, unit: e.target.value })}
                  />
                </td>
                <td className="px-4 py-2">
                  <input
                    type="number"
                    step="0.01"
                    className="w-24 border border-gray-300 rounded px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-gray-900"
                    placeholder="0.00"
                    value={newRow.rate_gbp}
                    onChange={(e) => setNewRow({ ...newRow, rate_gbp: e.target.value })}
                  />
                </td>
                <td className="px-4 py-2 text-gray-400">—</td>
                <td className="px-4 py-2 flex gap-2">
                  <button
                    onClick={addMaterial}
                    disabled={loading === 'new' || !newRow.name || !newRow.unit || !newRow.rate_gbp}
                    className="text-xs bg-green-700 text-white px-3 py-1 rounded hover:bg-green-600 disabled:opacity-40"
                  >
                    Add
                  </button>
                  <button
                    onClick={() => { setAdding(false); setNewRow({ name: '', unit: '', rate_gbp: '' }); }}
                    className="text-xs text-gray-500 hover:text-gray-900"
                  >
                    Cancel
                  </button>
                </td>
              </tr>
            )}

            {materials.length === 0 && !adding && (
              <tr>
                <td colSpan={5} className="px-4 py-10 text-center text-sm text-gray-400">
                  No materials yet. Add your first material rate below.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {!adding && (
        <button
          onClick={() => setAdding(true)}
          className="text-sm text-gray-600 hover:text-gray-900 border border-dashed border-gray-300 rounded-lg px-4 py-2 w-full hover:border-gray-400 transition-colors"
        >
          + Add material
        </button>
      )}
    </div>
  );
}
