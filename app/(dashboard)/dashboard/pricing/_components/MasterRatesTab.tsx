'use client';

import { useEffect, useState } from 'react';

interface MasterRates {
  id: string;
  fabrication_day_rate: number;
  installation_day_rate: number;
  consumer_unit_connection: number;
  minimum_job_value: number;
  galvanising_rate: string;
  powder_coating_rate: string;
  updated_at: string;
}

export default function MasterRatesTab() {
  const [rates, setRates] = useState<MasterRates | null>(null);
  const [editing, setEditing] = useState<Partial<MasterRates>>({});
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    fetch('/api/pricing/master-rates')
      .then((r) => r.json())
      .then((data) => {
        setRates(data);
        setEditing(data ?? {});
      })
      .catch(() => setError('Failed to load rates'));
  }, []);

  async function save() {
    setSaving(true);
    setError('');
    try {
      const res = await fetch('/api/pricing/master-rates', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          fabrication_day_rate: Number(editing.fabrication_day_rate),
          installation_day_rate: Number(editing.installation_day_rate),
          consumer_unit_connection: Number(editing.consumer_unit_connection),
          minimum_job_value: Number(editing.minimum_job_value),
          galvanising_rate: editing.galvanising_rate,
          powder_coating_rate: editing.powder_coating_rate,
        }),
      });
      if (!res.ok) throw new Error(await res.text());
      const updated = await res.json();
      setRates(updated);
      setEditing(updated);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Save failed');
    } finally {
      setSaving(false);
    }
  }

  if (!rates) return <p className="text-sm text-gray-500 py-6">Loading...</p>;

  const fields: { key: keyof MasterRates; label: string; prefix?: string; type?: string }[] = [
    { key: 'fabrication_day_rate', label: 'Fabrication Day Rate', prefix: '£' },
    { key: 'installation_day_rate', label: 'Installation Day Rate', prefix: '£' },
    { key: 'consumer_unit_connection', label: 'Consumer Unit Connection', prefix: '£' },
    { key: 'minimum_job_value', label: 'Minimum Job Value', prefix: '£' },
    { key: 'galvanising_rate', label: 'Galvanising Rate Formula', type: 'text' },
    { key: 'powder_coating_rate', label: 'Powder Coating Rate Formula', type: 'text' },
  ];

  return (
    <div>
      <div className="grid grid-cols-1 gap-4 max-w-lg">
        {fields.map(({ key, label, prefix, type }) => (
          <div key={key}>
            <label className="block text-xs font-medium text-gray-600 mb-1">{label}</label>
            <div className="flex items-center gap-2">
              {prefix && <span className="text-sm text-gray-500">{prefix}</span>}
              <input
                type={type ?? 'number'}
                step="0.01"
                value={(editing[key] as string | number) ?? ''}
                onChange={(e) => setEditing((prev) => ({ ...prev, [key]: e.target.value }))}
                className="border border-gray-300 rounded px-3 py-1.5 text-sm w-full focus:outline-none focus:ring-2 focus:ring-gray-400"
              />
            </div>
          </div>
        ))}
      </div>

      {error && <p className="text-sm text-red-600 mt-3">{error}</p>}

      <div className="mt-5 flex items-center gap-4">
        <button
          onClick={save}
          disabled={saving}
          className="bg-gray-900 text-white text-sm px-4 py-2 rounded hover:bg-gray-700 disabled:opacity-50"
        >
          {saving ? 'Saving…' : 'Save Rates'}
        </button>
        <p className="text-xs text-gray-400">
          Last updated: {new Date(rates.updated_at).toLocaleString('en-GB')}
        </p>
      </div>
    </div>
  );
}
