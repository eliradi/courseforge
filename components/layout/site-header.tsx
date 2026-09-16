import { GraduationCap } from 'lucide-react';
import Link from 'next/link';

import { signOut } from '@/app/actions/auth';
import { ThemeToggle } from '@/components/layout/theme-toggle';
import { Button } from '@/components/ui/button';
import { getUser } from '@/lib/supabase/server';

export async function SiteHeader() {
  const user = await getUser();

  return (
    <header className="no-print bg-background/80 sticky top-0 z-50 border-b backdrop-blur-sm">
      <div className="mx-auto flex h-14 w-full max-w-6xl items-center gap-3 px-4">
        <Link href="/" className="flex items-center gap-2 font-semibold">
          <span className="bg-primary text-primary-foreground flex size-7 items-center justify-center rounded-lg">
            <GraduationCap className="size-4" />
          </span>
          CourseForge
        </Link>

        <div className="flex-1" />

        <ThemeToggle />

        {user ? (
          <form action={signOut}>
            <Button type="submit" variant="ghost" size="sm">
              Sign out
            </Button>
          </form>
        ) : (
          <Button size="sm" variant="outline" nativeButton={false} render={<Link href="/auth/login" />}>
            Sign in
          </Button>
        )}
      </div>
    </header>
  );
}
