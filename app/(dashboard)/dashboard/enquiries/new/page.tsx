import { redirect } from 'next/navigation';
import { getTenantId } from '@/lib/tenant';
import EnquiryForm from './_components/EnquiryForm';

export default async function NewEnquiryPage() {
  const tenantId = await getTenantId();
  if (!tenantId) redirect('/sign-in');

  return (
    <main className="max-w-3xl mx-auto px-4 py-8">
      <h1 className="text-xl font-semibold text-gray-900 mb-6">New Enquiry</h1>
      <EnquiryForm tenantId={tenantId} />
    </main>
  );
}
