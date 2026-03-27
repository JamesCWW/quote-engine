import { createAdminClient } from '@/lib/supabase/admin';
import ChatWidget from './_components/ChatWidget';

interface Props {
  params: { tenantId: string };
}

export default async function WidgetPage({ params }: Props) {
  const supabase = createAdminClient();
  const { data: tenant } = await supabase
    .from('tenants')
    .select('id, name')
    .eq('id', params.tenantId)
    .single();

  if (!tenant) {
    return (
      <div style={{ fontFamily: 'sans-serif', padding: 16, color: '#888', fontSize: 14 }}>
        Widget not available.
      </div>
    );
  }

  return <ChatWidget tenantId={tenant.id} tenantName={tenant.name} />;
}
