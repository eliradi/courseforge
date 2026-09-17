import { BrandLogo } from '@/components/layout/brand-logo';
import { HideOnPaths } from '@/components/layout/hide-on-paths';
import { SignOutButton, ThemePill } from '@/components/layout/landing-controls';
import { getUser } from '@/lib/supabase/server';

export async function SiteHeader() {
  const user = await getUser();

  // Signed-out, the landing page carries its own big logo and floating
  // controls; the sign-in page has neither header nor account actions.
  const hiddenOn = user ? ['/auth/login'] : ['/', '/auth/login'];

  return (
    <HideOnPaths paths={hiddenOn}>
      <header className="no-print bg-background/80 sticky top-0 z-50 border-b backdrop-blur-sm">
        <div className="mx-auto flex h-14 w-full max-w-6xl items-center gap-3 px-4">
          <BrandLogo imageClassName="h-11" priority />

          <div className="flex-1" />

          <div className="flex items-center gap-2">
            {user ? <SignOutButton /> : null}
            <ThemePill />
          </div>
        </div>
      </header>
    </HideOnPaths>
  );
}
