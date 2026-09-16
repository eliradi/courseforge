import { ShieldCheck } from 'lucide-react';
import type { Metadata } from 'next';
import { redirect } from 'next/navigation';

import { AdminLoginForm } from '@/components/admin/admin-login-form';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { getAdminUser } from '@/lib/auth/admin';

export const metadata: Metadata = { title: 'Admin sign in' };

export default async function AdminLoginPage() {
  if (await getAdminUser()) redirect('/admin');

  return (
    <div className="mx-auto flex w-full max-w-md flex-col justify-center px-4 py-20">
      <Card>
        <CardHeader className="text-center">
          <div className="bg-primary/10 text-primary mx-auto mb-3 flex size-11 items-center justify-center rounded-xl">
            <ShieldCheck className="size-5" />
          </div>
          <CardTitle className="text-xl">Admin console</CardTitle>
          <CardDescription>Operational access — staff accounts only.</CardDescription>
        </CardHeader>
        <CardContent>
          <AdminLoginForm />
        </CardContent>
      </Card>
    </div>
  );
}
