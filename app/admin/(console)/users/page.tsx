import { Users } from 'lucide-react';
import type { Metadata } from 'next';

import { UserTable } from '@/components/admin/user-table';
import { EmptyState } from '@/components/layout/empty-state';
import { listAdminUsers } from '@/lib/db/admin-queries';

export const metadata: Metadata = { title: 'Admin · Users' };
export const dynamic = 'force-dynamic';

export default async function AdminUsersPage() {
  const users = await listAdminUsers();

  if (!users.length) {
    return <EmptyState icon={Users} title="No users yet" description="Nobody has signed up." />;
  }

  return <UserTable users={users} />;
}
