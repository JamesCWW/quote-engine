import { getTenantId } from '@/lib/tenant';
import { createAdminClient } from '@/lib/supabase/admin';
import { redirect } from 'next/navigation';
import { QuotesList, type Quote } from './_components/QuotesList';

export default async function QuotesPage() {
  const tenantId = await getTenantId();
  if (!tenantId) redirect('/sign-in');

  const supabase = createAdminClient();
  const { data: quotes } = await supabase
    .from('quotes')
    .select('id, product_type, material, description, price_low, price_high, final_price, status, lost_reason, is_golden, created_at')
    .eq('tenant_id', tenantId)
    .order('created_at', { ascending: false });

  return (
    <main className="min-h-screen bg-gray-50 py-10 px-4">
      <div className="max-w-5xl mx-auto">
        <div className="flex items-center justify-between mb-8">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Historical Quotes</h1>
            <p className="text-sm text-gray-500 mt-1">Cleaned training data used for AI price estimation.</p>
          </div>
          <a
            href="/dashboard/upload"
            className="rounded-lg bg-gray-900 text-white px-4 py-2 text-sm font-medium hover:bg-gray-800 transition-colors"
          >
            + Upload more
          </a>
        </div>
        <QuotesList initialQuotes={(quotes ?? []) as Quote[]} />
      </div>
    </main>
  );
}
