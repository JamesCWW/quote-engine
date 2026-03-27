import { auth } from '@clerk/nextjs/server';
import { createAdminClient } from '@/lib/supabase/admin';

/**
 * Returns the Supabase tenant_id for the current Clerk session.
 * Uses orgId if available, falls back to userId for single-tenant mode.
 * Creates the tenant row if it doesn't exist yet.
 */
export async function getTenantId(): Promise<string | null> {
  const { userId, orgId } = await auth();
  if (!userId) return null;

  // Prefer org-based tenancy; fall back to user ID for single-tenant (Phase 1)
  const clerkOrgId = orgId ?? `user_${userId}`;

  const supabase = createAdminClient();

  const { data: existing } = await supabase
    .from('tenants')
    .select('id')
    .eq('clerk_org_id', clerkOrgId)
    .single();

  if (existing) return existing.id as string;

  // Create tenant on first use
  const { data: created, error } = await supabase
    .from('tenants')
    .insert({ clerk_org_id: clerkOrgId, name: orgId ? orgId : 'Helions Forge' })
    .select('id')
    .single();

  if (error) return null;
  return created.id as string;
}
