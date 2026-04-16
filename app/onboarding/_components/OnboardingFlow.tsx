'use client';

import { useState, useRef } from 'react';
import { useRouter } from 'next/navigation';

interface Props {
  tenantId: string;
}

type Step = 'welcome' | 'profile' | 'inherit' | 'rates' | 'done';

const STEPS: Step[] = ['welcome', 'profile', 'inherit', 'rates', 'done'];

function ProgressBar({ step }: { step: Step }) {
  const idx = STEPS.indexOf(step);
  const pct = Math.round((idx / (STEPS.length - 1)) * 100);
  return (
    <div className="w-full bg-gray-200 rounded-full h-1.5 mb-8">
      <div
        className="bg-gray-900 h-1.5 rounded-full transition-all duration-500"
        style={{ width: `${pct}%` }}
      />
    </div>
  );
}

// ─── Step 1: Welcome ────────────────────────────────────────────────────────
function WelcomeStep({ onNext }: { onNext: () => void }) {
  return (
    <div className="text-center space-y-6">
      <div className="text-5xl">⚒️</div>
      <h1 className="text-3xl font-bold text-gray-900">Welcome to BespokeQuote</h1>
      <p className="text-lg text-gray-600 max-w-md mx-auto">
        Let&apos;s get your estimator set up. Takes about 10 minutes.
      </p>
      <ul className="text-left max-w-sm mx-auto space-y-2 text-sm text-gray-600">
        <li className="flex items-center gap-2"><span className="text-gray-400">1.</span> Your business profile</li>
        <li className="flex items-center gap-2"><span className="text-gray-400">2.</span> Industry defaults loaded</li>
        <li className="flex items-center gap-2"><span className="text-gray-400">3.</span> Set your day rates</li>
      </ul>
      <button
        onClick={onNext}
        className="bg-gray-900 text-white px-8 py-3 rounded-lg font-medium hover:bg-gray-800 transition-colors"
      >
        Get started →
      </button>
    </div>
  );
}

// ─── Step 2: Business Profile ────────────────────────────────────────────────
function ProfileStep({ onNext }: { onNext: () => void }) {
  const [form, setForm] = useState({
    business_name: '',
    address: '',
    phone: '',
    email: '',
    website: '',
    vat_number: '',
  });
  const [logoUrl, setLogoUrl] = useState('');
  const [uploading, setUploading] = useState(false);
  const [saving, setSaving] = useState(false);
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

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.business_name.trim()) { setError('Business name is required'); return; }
    setSaving(true);
    setError('');
    const res = await fetch('/api/onboarding/profile', {
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
    onNext();
  }

  const field = (key: keyof typeof form) => ({
    value: form[key],
    onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
      setForm((f) => ({ ...f, [key]: e.target.value })),
  });

  return (
    <form onSubmit={handleSubmit} className="space-y-5">
      <div>
        <h2 className="text-xl font-bold text-gray-900 mb-1">Your business profile</h2>
        <p className="text-sm text-gray-500">This appears on your PDF estimates and customer emails.</p>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div className="sm:col-span-2">
          <label className="block text-xs font-medium text-gray-700 mb-1">Business name *</label>
          <input
            type="text"
            required
            placeholder="Acme Gates Ltd"
            className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-gray-900"
            {...field('business_name')}
          />
        </div>

        <div className="sm:col-span-2">
          <label className="block text-xs font-medium text-gray-700 mb-1">Address</label>
          <textarea
            rows={3}
            placeholder="Unit 1, Business Park..."
            className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-gray-900 resize-none"
            {...field('address')}
          />
        </div>

        <div>
          <label className="block text-xs font-medium text-gray-700 mb-1">Phone</label>
          <input
            type="tel"
            placeholder="01234 567890"
            className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-gray-900"
            {...field('phone')}
          />
        </div>

        <div>
          <label className="block text-xs font-medium text-gray-700 mb-1">Email</label>
          <input
            type="email"
            placeholder="quotes@yourbusiness.com"
            className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-gray-900"
            {...field('email')}
          />
        </div>

        <div>
          <label className="block text-xs font-medium text-gray-700 mb-1">Website (optional)</label>
          <input
            type="url"
            placeholder="https://yourbusiness.com"
            className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-gray-900"
            {...field('website')}
          />
        </div>

        <div>
          <label className="block text-xs font-medium text-gray-700 mb-1">VAT number (optional)</label>
          <input
            type="text"
            placeholder="GB 123 4567 89"
            className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-gray-900"
            {...field('vat_number')}
          />
        </div>

        <div className="sm:col-span-2">
          <label className="block text-xs font-medium text-gray-700 mb-1">Logo (optional)</label>
          <div className="flex items-center gap-3">
            {logoUrl && (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={logoUrl} alt="Logo preview" className="h-12 w-auto rounded border border-gray-200" />
            )}
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              disabled={uploading}
              className="border border-gray-300 text-sm text-gray-700 px-3 py-1.5 rounded-md hover:bg-gray-50 disabled:opacity-50 transition-colors"
            >
              {uploading ? 'Uploading…' : logoUrl ? 'Change logo' : 'Upload logo'}
            </button>
            <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={handleLogoUpload} />
          </div>
        </div>
      </div>

      {error && <p className="text-red-600 text-xs">{error}</p>}

      <div className="flex justify-between pt-2">
        <span className="text-xs text-gray-400">* Required</span>
        <button
          type="submit"
          disabled={saving}
          className="bg-gray-900 text-white px-6 py-2.5 rounded-lg text-sm font-medium hover:bg-gray-800 disabled:opacity-50 transition-colors"
        >
          {saving ? 'Saving…' : 'Continue →'}
        </button>
      </div>
    </form>
  );
}

// ─── Step 3: Inherit Defaults ────────────────────────────────────────────────
function InheritStep({ onNext }: { onNext: () => void }) {
  const [state, setState] = useState<'idle' | 'loading' | 'done' | 'error'>('idle');
  const [counts, setCounts] = useState({ products: 0, accessories: 0, materials: 0 });
  const [errorMsg, setErrorMsg] = useState('');

  async function run() {
    setState('loading');
    try {
      const res = await fetch('/api/onboarding/inherit-defaults', { method: 'POST' });
      const data = await res.json();
      if (!res.ok) { setErrorMsg(data.error ?? 'Failed'); setState('error'); return; }
      setCounts({ products: data.products, accessories: data.accessories, materials: data.materials });
      setState('done');
    } catch (e) {
      setErrorMsg(String(e));
      setState('error');
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-bold text-gray-900 mb-1">Industry defaults</h2>
        <p className="text-sm text-gray-500">
          We&apos;ll load the standard metalwork/gates pricing database as your starting point.
          You can adjust everything afterwards.
        </p>
      </div>

      {state === 'idle' && (
        <button
          onClick={run}
          className="bg-gray-900 text-white px-6 py-3 rounded-lg font-medium hover:bg-gray-800 transition-colors"
        >
          Load industry defaults →
        </button>
      )}

      {state === 'loading' && (
        <div className="flex items-center gap-3 text-gray-600">
          <svg className="animate-spin h-5 w-5" viewBox="0 0 24 24" fill="none">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
          </svg>
          Loading pricing database…
        </div>
      )}

      {state === 'done' && (
        <div className="space-y-4">
          <div className="bg-green-50 border border-green-200 rounded-lg p-4">
            <p className="text-green-800 font-medium mb-2">✅ Defaults loaded successfully</p>
            <ul className="text-sm text-green-700 space-y-1">
              <li>• {counts.products} products loaded</li>
              <li>• {counts.accessories} accessories loaded</li>
              <li>• {counts.materials} materials loaded</li>
            </ul>
            <p className="text-xs text-green-600 mt-2">Standard metalwork/gates pricing for UK market.</p>
          </div>
          <button
            onClick={onNext}
            className="bg-gray-900 text-white px-6 py-2.5 rounded-lg text-sm font-medium hover:bg-gray-800 transition-colors"
          >
            Continue →
          </button>
        </div>
      )}

      {state === 'error' && (
        <div className="space-y-3">
          <p className="text-red-600 text-sm">{errorMsg}</p>
          <button onClick={run} className="border border-gray-300 text-sm px-4 py-2 rounded-md hover:bg-gray-50">
            Try again
          </button>
        </div>
      )}
    </div>
  );
}

// ─── Step 4: Set Key Rates ───────────────────────────────────────────────────
function RatesStep({ onNext }: { onNext: () => void }) {
  const [rates, setRates] = useState({
    fabrication_day_rate: '507',
    installation_day_rate: '523.84',
    design_fee: '220',
    minimum_job_value: '500',
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError('');
    const res = await fetch('/api/onboarding/rates', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(rates),
    });
    setSaving(false);
    if (!res.ok) {
      const d = await res.json();
      setError(d.error ?? 'Save failed');
      return;
    }
    onNext();
  }

  const field = (key: keyof typeof rates) => ({
    value: rates[key],
    onChange: (e: React.ChangeEvent<HTMLInputElement>) =>
      setRates((r) => ({ ...r, [key]: e.target.value })),
  });

  return (
    <form onSubmit={handleSubmit} className="space-y-5">
      <div>
        <h2 className="text-xl font-bold text-gray-900 mb-1">Set your day rates</h2>
        <p className="text-sm text-gray-500">
          These are pre-filled with standard UK metalwork rates. Adjust to match your own costs.
        </p>
      </div>

      <div className="space-y-4">
        {[
          { key: 'fabrication_day_rate' as const, label: 'Fabrication day rate', hint: 'Per fabrication day in the workshop' },
          { key: 'installation_day_rate' as const, label: 'Installation day rate', hint: 'Per engineer per day on site' },
          { key: 'design_fee' as const, label: 'Design fee', hint: 'Fixed design and drawing fee' },
          { key: 'minimum_job_value' as const, label: 'Minimum job value', hint: 'Smallest job you will quote' },
        ].map(({ key, label, hint }) => (
          <div key={key}>
            <label className="block text-xs font-medium text-gray-700 mb-1">{label}</label>
            <div className="relative">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500 text-sm">£</span>
              <input
                type="number"
                min="0"
                step="0.01"
                required
                className="w-full border border-gray-300 rounded-md pl-7 pr-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-gray-900"
                {...field(key)}
              />
            </div>
            <p className="text-xs text-gray-400 mt-0.5">{hint}</p>
          </div>
        ))}
      </div>

      {error && <p className="text-red-600 text-xs">{error}</p>}

      <div className="flex justify-end pt-2">
        <button
          type="submit"
          disabled={saving}
          className="bg-gray-900 text-white px-6 py-2.5 rounded-lg text-sm font-medium hover:bg-gray-800 disabled:opacity-50 transition-colors"
        >
          {saving ? 'Saving…' : 'Finish setup →'}
        </button>
      </div>
    </form>
  );
}

// ─── Step 5: Done ────────────────────────────────────────────────────────────
function DoneStep() {
  const router = useRouter();

  async function finish() {
    await fetch('/api/onboarding/complete', { method: 'POST' });
    router.push('/dashboard');
  }

  return (
    <div className="text-center space-y-6">
      <div className="text-5xl">🎉</div>
      <h2 className="text-2xl font-bold text-gray-900">You&apos;re all set!</h2>
      <p className="text-gray-600 max-w-sm mx-auto">
        Your estimator is configured. Start by pasting in an enquiry to get your first estimate.
      </p>
      <button
        onClick={finish}
        className="bg-gray-900 text-white px-8 py-3 rounded-lg font-medium hover:bg-gray-800 transition-colors"
      >
        Go to dashboard →
      </button>
    </div>
  );
}

// ─── Main Flow ────────────────────────────────────────────────────────────────
// eslint-disable-next-line @typescript-eslint/no-unused-vars
export default function OnboardingFlow({ tenantId }: Props) {
  const [step, setStep] = useState<Step>('welcome');

  const next = () => {
    const idx = STEPS.indexOf(step);
    if (idx < STEPS.length - 1) setStep(STEPS[idx + 1]);
  };

  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center py-12 px-4">
      <div className="w-full max-w-lg bg-white rounded-2xl shadow-sm border border-gray-200 p-8">
        <div className="mb-2 flex items-center justify-between">
          <span className="text-xs font-medium text-gray-400 uppercase tracking-wide">
            BespokeQuote Setup
          </span>
          <span className="text-xs text-gray-400">
            Step {Math.max(1, STEPS.indexOf(step))} of {STEPS.length - 1}
          </span>
        </div>
        <ProgressBar step={step} />

        {step === 'welcome' && <WelcomeStep onNext={next} />}
        {step === 'profile' && <ProfileStep onNext={next} />}
        {step === 'inherit' && <InheritStep onNext={next} />}
        {step === 'rates' && <RatesStep onNext={next} />}
        {step === 'done' && <DoneStep />}
      </div>
    </div>
  );
}
