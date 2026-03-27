import { getTenantId } from '@/lib/tenant';
import { createAdminClient } from '@/lib/supabase/admin';
import { redirect } from 'next/navigation';
import { MaterialsTable, type Material } from './_components/MaterialsTable';

export default async function MaterialsPage() {
  const tenantId = await getTenantId();
  if (!tenantId) redirect('/sign-in');

  const supabase = createAdminClient();
  const { data: materials } = await supabase
    .from('materials')
    .select('id, name, unit, rate_gbp, updated_at')
    .eq('tenant_id', tenantId)
    .order('name', { ascending: true });

  return (
    <main className="min-h-screen bg-gray-50 py-10 px-4">
      <div className="max-w-4xl mx-auto">
        <div className="mb-8">
          <h1 className="text-2xl font-bold text-gray-900">Material Rates</h1>
          <p className="text-sm text-gray-500 mt-1">
            These rates are injected into every quote generation prompt so the AI is aware of current prices.
          </p>
        </div>
        <MaterialsTable initialMaterials={(materials ?? []) as Material[]} />
      </div>
    </main>
  );
}
