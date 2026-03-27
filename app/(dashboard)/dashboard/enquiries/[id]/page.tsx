import { getTenantId } from '@/lib/tenant';
import { createAdminClient } from '@/lib/supabase/admin';
import { redirect, notFound } from 'next/navigation';
import Link from 'next/link';
import EnquiryDetailClient from './_components/EnquiryDetailClient';

export default async function EnquiryDetailPage({
  params,
}: {
  params: { id: string };
}) {
  const tenantId = await getTenantId();
  if (!tenantId) redirect('/sign-in');

  const supabase = createAdminClient();

  const [enquiryResult, quotesResult] = await Promise.all([
    supabase
      .from('enquiries')
      .select('id, source, raw_input, extracted_specs, status, created_at')
      .eq('id', params.id)
      .eq('tenant_id', tenantId)
      .single(),
    supabase
      .from('generated_quotes')
      .select('id, price_low, price_high, confidence, ai_reasoning, final_price, status, reviewed_by, created_at')
      .eq('enquiry_id', params.id)
      .eq('tenant_id', tenantId)
      .order('created_at', { ascending: false }),
  ]);

  if (enquiryResult.error || !enquiryResult.data) notFound();

  const enquiry = enquiryResult.data;
  const quotes = quotesResult.data ?? [];
  const specs = enquiry.extracted_specs as Record<string, string> | null;

  return (
    <main className="min-h-screen bg-gray-50 py-10 px-4">
      <div className="max-w-3xl mx-auto space-y-6">
        {/* Back link */}
        <Link href="/dashboard" className="text-sm text-gray-500 hover:text-gray-900">
          ← Back to dashboard
        </Link>

        {/* Enquiry details */}
        <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-6">
          <div className="flex items-start justify-between mb-4">
            <div>
              <h1 className="text-lg font-bold text-gray-900">Enquiry</h1>
              <p className="text-xs text-gray-400 mt-0.5">
                {new Date(enquiry.created_at).toLocaleString('en-GB')} · Source:{' '}
                <span className="capitalize">{enquiry.source}</span>
              </p>
            </div>
            <span className="inline-flex px-2 py-0.5 rounded-full text-xs font-medium bg-blue-100 text-blue-700">
              {enquiry.status}
            </span>
          </div>

          {/* Full enquiry text */}
          <p className="text-sm text-gray-700 whitespace-pre-wrap leading-relaxed">
            {enquiry.raw_input}
          </p>

          {/* Extracted specs */}
          {specs && Object.keys(specs).length > 0 && (
            <div className="mt-4 pt-4 border-t border-gray-100">
              <p className="text-xs font-medium text-gray-400 uppercase tracking-wide mb-2">
                Extracted specs
              </p>
              <div className="flex flex-wrap gap-x-6 gap-y-1 text-sm text-gray-600">
                {specs.product_type && (
                  <span>
                    Type:{' '}
                    <span className="font-medium text-gray-800">{specs.product_type}</span>
                  </span>
                )}
                {specs.material && (
                  <span>
                    Material:{' '}
                    <span className="font-medium text-gray-800">{specs.material}</span>
                  </span>
                )}
                {specs.from && (
                  <span>
                    From:{' '}
                    <span className="font-medium text-gray-800">{specs.from}</span>
                  </span>
                )}
                {specs.subject && (
                  <span>
                    Subject:{' '}
                    <span className="font-medium text-gray-800">{specs.subject}</span>
                  </span>
                )}
              </div>
            </div>
          )}
        </div>

        {/* Interactive quote generation + history */}
        <EnquiryDetailClient
          enquiryId={enquiry.id}
          rawInput={enquiry.raw_input ?? ''}
          tenantId={tenantId}
          initialQuotes={quotes}
        />
      </div>
    </main>
  );
}
