import { createAdminClient } from '@/lib/supabase/admin';

/**
 * Returns true if the tenant is internal (e.g. Helions Forge).
 * Internal tenants bypass ALL gating checks:
 *   - Stripe subscription status
 *   - Trial expiry
 *   - Usage limits
 *   - Feature flags
 *   - Rate limits
 *
 * Use this as the first check before any gating logic:
 *   if (await isTenantInternal(tenantId)) { // proceed }
 */
export async function isTenantInternal(tenantId: string): Promise<boolean> {
  const supabase = createAdminClient();
  const { data } = await supabase
    .from('tenants')
    .select('is_internal')
    .eq('id', tenantId)
    .single();
  return data?.is_internal ?? false;
}
