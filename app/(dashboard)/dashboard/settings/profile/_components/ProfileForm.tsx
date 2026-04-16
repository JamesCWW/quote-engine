'use client';

import { useState, useRef } from 'react';

interface TenantProfile {
  id?: string;
  tenant_id?: string;
  business_name?: string | null;
  address?: string | null;
  phone?: string | null;
  email?: string | null;
  website?: string | null;
  vat_number?: string | null;
  logo_url?: string | null;
  terms_and_conditions?: string | null;
  estimate_footer_text?: string | null;
}

interface Props {
  initialProfile: TenantProfile | null;
}

export default function ProfileForm({ initialProfile }: Props) {
  const p = initialProfile ?? {};
  const [form, setForm] = useState({
    business_name: p.business_name ?? '',
    address: p.address ?? '',
    phone: p.phone ?? '',
    email: p.email ?? '',
    website: p.website ?? '',
    vat_number: p.vat_number ?? '',
    terms_and_conditions: p.terms_and_conditions ?? '',
    estimate_footer_text: p.estimate_footer_text ?? 'This is a budgetary estimate based on information provided. Final price subject to site survey and full specification. Estimate valid for 30 days.',
  });
  const [logoUrl, setLogoUrl] = useState(p.logo_url ?? '');
  const [uploading, setUploading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);

  async function handleLogoUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    const fd = new FormData();
    fd.append('file', file);
    const res = await fetch('/api/onboarding/upload-logo', { method: 'POST', body: fd });
    const data = await res.json();
    setUploading(false);
    if (data.url) setLogoUrl(data.url);
  }

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setSaved(false);
    setError('');
    const res = await fetch('/api/settings/profile', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...form, logo_url: logoUrl }),
    });
    setSaving(false);
    if (!res.ok) {
      const d = await res.json();
      setError(d.error ?? 'Save failed');
      return;
    }
    setSaved(true);
    setTimeout(() => setSaved(false), 3000);
  }

  const textField = (key: keyof typeof form) => ({
    value: form[key],
    onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
      setForm((f) => ({ ...f, [key]: e.target.value })),
  });

  return (
    <form onSubmit={handleSave} className="space-y-6">
      <div className="bg-white rounded-xl border border-gray-200 p-6 shadow-sm">
        <h2 className="text-base font-semibold text-gray-900 mb-4">Business Information</h2>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div className="sm:col-span-2">
            <label className="block text-xs font-medium text-gray-700 mb-1">Business name</label>
            <input
              type="text"
              className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-gray-900"
              {...textField('business_name')}
            />
          </div>

          <div className="sm:col-span-2">
            <label className="block text-xs font-medium text-gray-700 mb-1">Address</label>
            <textarea
              rows={3}
              className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-gray-900 resize-none"
              {...textField('address')}
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">Phone</label>
            <input
              type="tel"
              className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-gray-900"
              {...textField('phone')}
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">Email</label>
            <input
              type="email"
              className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-gray-900"
              {...textField('email')}
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">Website</label>
            <input
              type="url"
              className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-gray-900"
              {...textField('website')}
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">VAT number</label>
            <input
              type="text"
              className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-gray-900"
              {...textField('vat_number')}
            />
          </div>
        </div>
      </div>

      {/* Logo */}
      <div className="bg-white rounded-xl border border-gray-200 p-6 shadow-sm">
        <h2 className="text-base font-semibold text-gray-900 mb-4">Logo</h2>
        <div className="flex items-center gap-4">
          {logoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={logoUrl} alt="Business logo" className="h-16 w-auto rounded border border-gray-200 object-contain" />
          ) : (
            <div className="h-16 w-24 rounded border border-dashed border-gray-300 flex items-center justify-center text-gray-400 text-xs">
              No logo
            </div>
          )}
          <div className="space-y-1">
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              disabled={uploading}
              className="border border-gray-300 text-sm text-gray-700 px-3 py-1.5 rounded-md hover:bg-gray-50 disabled:opacity-50 transition-colors"
            >
              {uploading ? 'Uploading…' : logoUrl ? 'Change logo' : 'Upload logo'}
            </button>
            <p className="text-xs text-gray-400">PNG, JPG or SVG. Displayed on PDF estimates.</p>
            <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={handleLogoUpload} />
          </div>
        </div>
      </div>

      {/* Estimate text */}
      <div className="bg-white rounded-xl border border-gray-200 p-6 shadow-sm">
        <h2 className="text-base font-semibold text-gray-900 mb-4">Estimate Documents</h2>

        <div className="space-y-4">
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">Estimate footer text</label>
            <textarea
              rows={3}
              className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-gray-900 resize-y"
              {...textField('estimate_footer_text')}
            />
            <p className="text-xs text-gray-400 mt-0.5">Appears at the bottom of every PDF estimate.</p>
          </div>

          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">Terms and conditions</label>
            <textarea
              rows={6}
              placeholder="Enter your standard terms and conditions…"
              className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-gray-900 resize-y"
              {...textField('terms_and_conditions')}
            />
            <p className="text-xs text-gray-400 mt-0.5">Printed on the back of PDF estimates when set.</p>
          </div>
        </div>
      </div>

      {error && <p className="text-red-600 text-sm">{error}</p>}

      <div className="flex items-center justify-end gap-3">
        {saved && <span className="text-green-600 text-sm">✓ Saved</span>}
        <button
          type="submit"
          disabled={saving}
          className="bg-gray-900 text-white px-6 py-2.5 rounded-lg text-sm font-medium hover:bg-gray-800 disabled:opacity-50 transition-colors"
        >
          {saving ? 'Saving…' : 'Save changes'}
        </button>
      </div>
    </form>
  );
}
