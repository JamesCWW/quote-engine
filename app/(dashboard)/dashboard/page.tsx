import { getTenantId } from '@/lib/tenant';
import { createAdminClient } from '@/lib/supabase/admin';
import { redirect } from 'next/navigation';
import Link from 'next/link';
import RealtimeNotifications from './_components/RealtimeNotifications';

export default async function DashboardPage() {
  const tenantId = await getTenantId();
  if (!tenantId) redirect('/sign-in');

  const supabase = createAdminClient();

  const now = new Date();
  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();

  // Stats queries in parallel
  const [quotesThisMonth, allQuotes, recentEnquiries] = await Promise.all([
    supabase
      .from('quotes')
      .select('id, status, final_price')
      .eq('tenant_id', tenantId)
      .gte('created_at', startOfMonth),
    supabase
      .from('quotes')
      .select('id, status, final_price')
      .eq('tenant_id', tenantId),
    supabase
      .from('enquiries')
      .select('id, source, raw_input, status, created_at')
      .eq('tenant_id', tenantId)
      .order('created_at', { ascending: false })
      .limit(10),
  ]);

  const monthlyQuotes = quotesThisMonth.data ?? [];
const allQuotesData = allQuotes.data ?? [];
  const wonAll = allQuotesData.filter((q) => q.status === 'won');

  const totalThisMonth = monthlyQuotes.length;
  const winRate =
    allQuotesData.length > 0
      ? Math.round((wonAll.length / allQuotesData.length) * 100)
      : 0;
  const avgValue =
    wonAll.length > 0
      ? Math.round(
          wonAll.reduce((sum, q) => sum + (q.final_price ?? 0), 0) / wonAll.length
        )
      : 0;

  const enquiries = recentEnquiries.data ?? [];

  const STATUS_STYLES: Record<string, string> = {
    new: 'bg-blue-100 text-blue-700',
    quoting: 'bg-yellow-100 text-yellow-700',
    quoted: 'bg-purple-100 text-purple-700',
    archived: 'bg-gray-100 text-gray-500',
  };

  return (
    <main className="min-h-screen bg-gray-50 py-10 px-4">
      <RealtimeNotifications tenantId={tenantId} />
      <div className="max-w-5xl mx-auto space-y-8">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Dashboard</h1>
            <p className="text-sm text-gray-500 mt-1">
              {now.toLocaleString('en-GB', { month: 'long', year: 'numeric' })}
            </p>
          </div>
          <Link
            href="/dashboard/enquiries/new"
            className="rounded-lg bg-gray-900 text-white px-4 py-2 text-sm font-medium hover:bg-gray-800 transition-colors"
          >
            + New Enquiry
          </Link>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-3 gap-4">
          <div className="bg-white rounded-xl border border-gray-200 p-5 shadow-sm">
            <p className="text-xs font-medium text-gray-400 uppercase tracking-wide">
              Quotes this month
            </p>
            <p className="text-3xl font-bold text-gray-900 mt-1">{totalThisMonth}</p>
          </div>
          <div className="bg-white rounded-xl border border-gray-200 p-5 shadow-sm">
            <p className="text-xs font-medium text-gray-400 uppercase tracking-wide">
              Win rate (all time)
            </p>
            <p className="text-3xl font-bold text-gray-900 mt-1">{winRate}%</p>
          </div>
          <div className="bg-white rounded-xl border border-gray-200 p-5 shadow-sm">
            <p className="text-xs font-medium text-gray-400 uppercase tracking-wide">
              Avg won value
            </p>
            <p className="text-3xl font-bold text-gray-900 mt-1">
              {avgValue > 0 ? `£${avgValue.toLocaleString()}` : '—'}
            </p>
          </div>
        </div>

        {/* Recent enquiries */}
        <div>
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-base font-semibold text-gray-800">Recent enquiries</h2>
            <Link
              href="/dashboard/enquiries/new"
              className="text-sm text-gray-500 hover:text-gray-900 transition-colors"
            >
              View all →
            </Link>
          </div>

          {enquiries.length === 0 ? (
            <div className="bg-white rounded-xl border border-gray-200 p-10 text-center text-sm text-gray-400">
              No enquiries yet.{' '}
              <Link href="/dashboard/enquiries/new" className="text-gray-600 underline">
                Create one.
              </Link>
            </div>
          ) : (
            <div className="bg-white rounded-xl border border-gray-200 overflow-hidden shadow-sm">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-100 bg-gray-50">
                    <th className="px-4 py-3 text-left font-medium text-gray-500">Enquiry</th>
                    <th className="px-4 py-3 text-left font-medium text-gray-500">Source</th>
                    <th className="px-4 py-3 text-left font-medium text-gray-500">Status</th>
                    <th className="px-4 py-3 text-left font-medium text-gray-500">Date</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {enquiries.map((e) => (
                    <tr key={e.id} className="relative hover:bg-gray-50 transition-colors cursor-pointer">
                      <td className="px-4 py-3 text-gray-800 max-w-xs truncate">
                        <Link
                          href={`/dashboard/enquiries/${e.id}`}
                          className="after:absolute after:inset-0"
                        >
                          {e.raw_input?.slice(0, 80) ?? '—'}
                        </Link>
                      </td>
                      <td className="px-4 py-3 text-gray-500 capitalize relative">{e.source}</td>
                      <td className="px-4 py-3 relative">
                        <span
                          className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium ${
                            STATUS_STYLES[e.status] ?? 'bg-gray-100 text-gray-500'
                          }`}
                        >
                          {e.status}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-gray-400 whitespace-nowrap relative">
                        {new Date(e.created_at).toLocaleDateString('en-GB', {
                          day: 'numeric',
                          month: 'short',
                        })}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </main>
  );
}
