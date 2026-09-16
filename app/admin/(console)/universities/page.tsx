import type { Metadata } from 'next';

import { UniversityTable } from '@/components/admin/university-table';
import { listAdminColleges } from '@/lib/db/admin-queries';

export const metadata: Metadata = { title: 'Admin · Universities' };
export const dynamic = 'force-dynamic';

export default async function AdminUniversitiesPage() {
  const colleges = await listAdminColleges();
  return <UniversityTable colleges={colleges} />;
}
