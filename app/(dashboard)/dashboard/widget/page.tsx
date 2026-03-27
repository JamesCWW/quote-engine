import { getTenantId } from '@/lib/tenant';
import { redirect } from 'next/navigation';
import WidgetEmbedCode from './_components/WidgetEmbedCode';

export default async function WidgetPage() {
  const tenantId = await getTenantId();
  if (!tenantId) redirect('/sign-in');

  return (
    <main className="min-h-screen bg-gray-50 py-10 px-4">
      <div className="max-w-2xl mx-auto space-y-8">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Website Chatbot Widget</h1>
          <p className="text-sm text-gray-500 mt-1">
            Embed the AI quote assistant on your website with a single snippet.
          </p>
        </div>

        <WidgetEmbedCode tenantId={tenantId} />

        <div className="bg-white rounded-xl border border-gray-200 p-6 shadow-sm space-y-4">
          <h2 className="font-semibold text-gray-800">Preview</h2>
          <p className="text-sm text-gray-500">
            Open the link below to see the widget as your customers will see it.
          </p>
          <a
            href={`/widget/${tenantId}`}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-2 rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors"
          >
            Open widget preview ↗
          </a>
        </div>

        <div className="bg-amber-50 border border-amber-200 rounded-xl p-5 text-sm text-amber-800">
          <strong>Before the widget goes live:</strong>
          <ul className="mt-2 space-y-1 list-disc list-inside">
            <li>
              Run <code className="font-mono bg-amber-100 px-1 rounded">scripts/phase5-migration.sql</code> in
              the Supabase SQL editor to add <code className="font-mono bg-amber-100 px-1 rounded">min_quote_gbp</code> and{' '}
              <code className="font-mono bg-amber-100 px-1 rounded">price_buffer_percent</code> to your tenant config.
            </li>
            <li>Enable Supabase Realtime on the <strong>enquiries</strong> table in the Supabase dashboard.</li>
          </ul>
        </div>
      </div>
    </main>
  );
}
