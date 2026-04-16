import { getTenantId } from '@/lib/tenant';
import { createAdminClient } from '@/lib/supabase/admin';
import { redirect } from 'next/navigation';
import ProfileForm from './_components/ProfileForm';

export default async function ProfileSettingsPage() {
  const tenantId = await getTenantId();
  if (!tenantId) redirect('/sign-in');

  const supabase = createAdminClient();
  const { data: profile } = await supabase
    .from('tenant_profile')
    .select('*')
    .eq('tenant_id', tenantId)
    .single();

  return (
    <main className="min-h-screen bg-gray-50 py-10 px-4">
      <div className="max-w-2xl mx-auto">
        <div className="mb-6">
          <h1 className="text-2xl font-bold text-gray-900">Settings</h1>
          <nav className="flex gap-4 mt-3 border-b border-gray-200 pb-0">
            <span className="text-sm font-medium text-gray-900 border-b-2 border-gray-900 pb-2 -mb-px">
              Profile
            </span>
          </nav>
        </div>
        <ProfileForm initialProfile={profile} />
      </div>
    </main>
  );
}
