import { ArrowLeft } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';

import { BrandLogo } from '@/components/layout/brand-logo';
import { FloatingThemeToggle } from '@/components/layout/landing-controls';
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
      <FloatingThemeToggle />
      <Card>
        <CardHeader className="text-center">
          <CardTitle className="mx-auto mb-2">
            <h1>
              <BrandLogo alt="Sign in to Aceversity" imageClassName="h-16 sm:h-20" priority />
            </h1>
          </CardTitle>
          <CardDescription>
            Browsing catalogs is open to everyone. Generating and taking tests needs an account.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <LoginForm redirectTo={next ?? '/'} initialError={error} />
        </CardContent>
      </Card>
      <Link
        href="/"
        className="text-muted-foreground hover:text-primary mx-auto mt-4 inline-flex items-center gap-1 text-sm transition-colors"
      >
        <ArrowLeft className="size-3.5" />
        Back to home
      </Link>
    </div>
  );
}
