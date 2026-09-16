import { GraduationCap } from 'lucide-react';
import type { Metadata } from 'next';

import { LoginForm } from '@/components/layout/login-form';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';

export const metadata: Metadata = { title: 'Sign in' };

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string; error?: string }>;
}) {
  const { next, error } = await searchParams;

  return (
    <div className="mx-auto flex w-full max-w-md flex-col justify-center px-4 py-20">
      <Card>
        <CardHeader className="text-center">
          <div className="bg-primary/10 text-primary mx-auto mb-3 flex size-11 items-center justify-center rounded-xl">
            <GraduationCap className="size-5" />
          </div>
          <CardTitle className="text-xl">Sign in to CourseForge</CardTitle>
          <CardDescription>
            Browsing catalogs is open to everyone. Generating and taking tests needs an account.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <LoginForm redirectTo={next ?? '/'} initialError={error} />
        </CardContent>
      </Card>
    </div>
  );
}
