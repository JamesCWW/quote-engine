import { auth } from '@clerk/nextjs/server';
import { redirect } from 'next/navigation';
import Link from 'next/link';
import { getTenantId } from '@/lib/tenant';
import { createAdminClient } from '@/lib/supabase/admin';

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const { userId } = await auth();

  if (!userId) {
    redirect('/sign-in');
  }

  // Check onboarding status — redirect new tenants before they reach the dashboard
  const tenantId = await getTenantId();
  if (tenantId) {
    const supabase = createAdminClient();
    const { data: tenant } = await supabase
      .from('tenants')
      .select('is_internal, onboarding_complete')
      .eq('id', tenantId)
      .single();

    if (tenant && !tenant.is_internal && !tenant.onboarding_complete) {
      redirect('/onboarding');
    }
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <nav className="bg-white border-b border-gray-200 px-4 py-3">
        <div className="max-w-5xl mx-auto flex items-center gap-6">
          <span className="font-bold text-gray-900 text-sm tracking-tight">BespokeQuote</span>
          <Link href="/dashboard" className="text-sm text-gray-500 hover:text-gray-900 transition-colors">
            Home
          </Link>
          <Link href="/dashboard/enquiries/new" className="text-sm text-gray-500 hover:text-gray-900 transition-colors">
            New Enquiry
          </Link>
          <Link href="/dashboard/quotes" className="text-sm text-gray-500 hover:text-gray-900 transition-colors">
            Quotes
          </Link>
          <Link href="/dashboard/materials" className="text-sm text-gray-500 hover:text-gray-900 transition-colors">
            Materials
          </Link>
          <Link href="/dashboard/pricing" className="text-sm text-gray-500 hover:text-gray-900 transition-colors">
            Pricing
          </Link>
          <Link href="/dashboard/calibration" className="text-sm text-gray-500 hover:text-gray-900 transition-colors">
            Calibration
          </Link>
          <Link href="/dashboard/widget" className="text-sm text-gray-500 hover:text-gray-900 transition-colors">
            Widget
          </Link>
          <Link href="/dashboard/settings/profile" className="text-sm text-gray-500 hover:text-gray-900 transition-colors">
            Settings
          </Link>
        </div>
      </nav>
      {children}
    </div>
  );
}
