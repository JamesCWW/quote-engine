import { getTenantId } from '@/lib/tenant';
import { createAdminClient } from '@/lib/supabase/admin';
import { redirect, notFound } from 'next/navigation';
import Link from 'next/link';

const CONFIDENCE_STYLES: Record<string, string> = {
  high: 'bg-green-100 text-green-700',
  medium: 'bg-yellow-100 text-yellow-700',
  low: 'bg-red-100 text-red-700',
};

const STATUS_STYLES: Record<string, string> = {
  draft: 'bg-gray-100 text-gray-600',
  approved: 'bg-green-100 text-green-700',
  sent: 'bg-blue-100 text-blue-700',
};

export default async function EnquiryHistoryPage({
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

  return (
    <main className="min-h-screen bg-gray-50 py-10 px-4">
      <div className="max-w-5xl mx-auto space-y-8">
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
                {new Date(enquiry.created_at).toLocaleString('en-GB')} · Source: {enquiry.source}
              </p>
            </div>
            <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium bg-blue-100 text-blue-700`}>
              {enquiry.status}
            </span>
          </div>
          <p className="text-sm text-gray-700 whitespace-pre-wrap">{enquiry.raw_input}</p>

          {enquiry.extracted_specs && (
            <div className="mt-4 pt-4 border-t border-gray-100">
              <p className="text-xs font-medium text-gray-400 uppercase tracking-wide mb-2">
                Extracted specs
              </p>
              <div className="flex gap-4 text-sm text-gray-600">
                {(enquiry.extracted_specs as Record<string, string>).product_type && (
                  <span>Type: <span className="font-medium text-gray-800">{(enquiry.extracted_specs as Record<string, string>).product_type}</span></span>
                )}
                {(enquiry.extracted_specs as Record<string, string>).material && (
                  <span>Material: <span className="font-medium text-gray-800">{(enquiry.extracted_specs as Record<string, string>).material}</span></span>
                )}
              </div>
            </div>
          )}
        </div>

        {/* Quote version history */}
        <div>
          <h2 className="text-base font-semibold text-gray-800 mb-3">
            Quote versions ({quotes.length})
          </h2>

          {quotes.length === 0 ? (
            <div className="bg-white rounded-xl border border-gray-200 p-10 text-center text-sm text-gray-400">
              No quotes generated for this enquiry yet.
            </div>
          ) : (
            <div className="space-y-4">
              {quotes.map((q, i) => (
                <div
                  key={q.id}
                  className="bg-white rounded-xl border border-gray-200 shadow-sm p-5"
                >
                  <div className="flex items-center justify-between mb-3">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium text-gray-700">
                        Version {quotes.length - i}
                      </span>
                      {i === 0 && (
                        <span className="text-xs bg-gray-900 text-white px-2 py-0.5 rounded-full">
                          Latest
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-2">
                      {q.confidence && (
                        <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium ${CONFIDENCE_STYLES[q.confidence] ?? 'bg-gray-100 text-gray-600'}`}>
                          {q.confidence} confidence
                        </span>
                      )}
                      <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium ${STATUS_STYLES[q.status] ?? 'bg-gray-100 text-gray-600'}`}>
                        {q.status}
                      </span>
                    </div>
                  </div>

                  {/* Price range */}
                  <div className="flex items-baseline gap-2 mb-3">
                    <span className="text-2xl font-bold text-gray-900">
                      £{q.price_low?.toLocaleString()} – £{q.price_high?.toLocaleString()}
                    </span>
                    {q.final_price && (
                      <span className="text-sm text-green-700 font-medium">
                        Final: £{q.final_price.toLocaleString()}
                      </span>
                    )}
                  </div>

                  {q.ai_reasoning && (
                    <p className="text-sm text-gray-600 mb-2">{q.ai_reasoning}</p>
                  )}

                  <p className="text-xs text-gray-400">
                    Generated {new Date(q.created_at).toLocaleString('en-GB')}
                    {q.reviewed_by && ` · Approved by ${q.reviewed_by.slice(0, 8)}…`}
                  </p>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </main>
  );
}
