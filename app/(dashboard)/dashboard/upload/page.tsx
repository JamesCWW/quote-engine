import { getTenantId } from '@/lib/tenant';
import { redirect } from 'next/navigation';
import { UploadForm } from './_components/UploadForm';

export default async function UploadPage() {
  const tenantId = await getTenantId();
  if (!tenantId) redirect('/sign-in');

  return (
    <main className="min-h-screen bg-gray-50 py-10 px-4">
      <div className="max-w-2xl mx-auto">
        <h1 className="text-2xl font-bold text-gray-900 mb-1">Upload Historical Quotes</h1>
        <p className="text-sm text-gray-500 mb-8">
          Paste or upload old quote emails. They will be cleaned, anonymised, and stored as training data.
        </p>
        <UploadForm tenantId={tenantId} />
      </div>
    </main>
  );
}
