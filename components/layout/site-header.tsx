import { signOut } from '@/app/actions/auth';
import { BrandLogo } from '@/components/layout/brand-logo';
import { ThemeToggle } from '@/components/layout/theme-toggle';
import { Button } from '@/components/ui/button';
import { getUser } from '@/lib/supabase/server';

export async function SiteHeader() {
  const user = await getUser();

  return (
    <header className="no-print bg-background/80 sticky top-0 z-50 border-b backdrop-blur-sm">
      <div className="mx-auto flex h-14 w-full max-w-6xl items-center gap-3 px-4">
        <BrandLogo imageClassName="h-11" priority />

        <div className="flex-1" />

        <ThemeToggle />

        {user ? (
          <form action={signOut}>
            <Button type="submit" variant="ghost" size="sm">
              Sign out
            </Button>
          </form>
        ) : null}
      </div>
    </header>
  );
}
