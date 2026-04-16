import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@clerk/nextjs/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { getTenantId } from '@/lib/tenant';

export async function POST(req: NextRequest) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });

  const tenantId = await getTenantId();
  if (!tenantId) return NextResponse.json({ error: 'Tenant not found' }, { status: 400 });

  const formData = await req.formData();
  const file = formData.get('file') as File | null;

  if (!file) return NextResponse.json({ error: 'No file provided' }, { status: 400 });

  const ext = file.name.split('.').pop()?.toLowerCase() ?? 'png';
  const path = `${tenantId}/logo.${ext}`;

  const supabase = createAdminClient();
  const { error } = await supabase.storage
    .from('tenant-assets')
    .upload(path, await file.arrayBuffer(), {
      contentType: file.type,
      upsert: true,
    });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const { data: publicUrl } = supabase.storage
    .from('tenant-assets')
    .getPublicUrl(path);

  return NextResponse.json({ url: publicUrl.publicUrl });
}
