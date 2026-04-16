import { auth } from '@clerk/nextjs/server';
import { redirect } from 'next/navigation';
import { createAdminClient } from '@/lib/supabase/admin';
import { getTenantId } from '@/lib/tenant';
import OnboardingFlow from './_components/OnboardingFlow';

export default async function OnboardingPage() {
  const { userId } = await auth();
  if (!userId) redirect('/sign-in');

  const tenantId = await getTenantId();
  if (!tenantId) redirect('/sign-in');

  const supabase = createAdminClient();
  const { data: tenant } = await supabase
    .from('tenants')
    .select('is_internal, onboarding_complete')
    .eq('id', tenantId)
    .single();

  // Internal tenants and already-onboarded tenants skip this page
  if (!tenant || tenant.is_internal || tenant.onboarding_complete) {
    redirect('/dashboard');
  }

  return <OnboardingFlow tenantId={tenantId} />;
}
