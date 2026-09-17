import Image from 'next/image';
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
        {/* The wordmark's navy lettering disappears on the dark theme, so it sits on a light chip there. */}
        <Link
          href="/"
          aria-label="Aceversity home"
          className="flex items-center dark:rounded-md dark:bg-white dark:px-1.5 dark:py-0.5"
        >
          <Image
            src="/logo-wordmark.png"
            alt="Aceversity"
            width={1732}
            height={444}
            priority
            className="h-11 w-auto"
          />
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
