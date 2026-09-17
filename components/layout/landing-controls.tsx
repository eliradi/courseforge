import { LogIn, LogOut } from 'lucide-react';
import Link from 'next/link';

import { signOut } from '@/app/actions/auth';
import { ThemeToggle } from '@/components/layout/theme-toggle';
import { Button } from '@/components/ui/button';

/** Landing-page stand-in for the header: pricing, login and theme toggle, pinned top-right. */
export function FloatingControls({ signedIn }: { signedIn: boolean }) {
  return (
    <div className="no-print fixed top-4 right-4 z-50 flex items-center gap-2">
      {/* Brand hexes rather than theme tokens, so it reads the same in both themes. */}
      <Link
        href="#pricing"
        title="See pricing"
        className="group relative flex h-9 items-center overflow-hidden rounded-full bg-gradient-to-r from-[#115388] to-[#0ba297] px-4 text-sm font-semibold tracking-wide text-white shadow-md shadow-[#115388]/25 ring-1 ring-white/20 transition-all duration-200 hover:-translate-y-0.5 hover:shadow-lg hover:shadow-[#0ba297]/30"
      >
        Pricing
        {/* Shine that sweeps across on hover. */}
        <span
          aria-hidden
          className="pointer-events-none absolute inset-0 -translate-x-full bg-gradient-to-r from-transparent via-white/30 to-transparent transition-transform duration-700 group-hover:translate-x-full"
        />
      </Link>
      {signedIn ? null : (
        <Link
          href="/auth/login"
          className="bg-background/80 text-foreground hover:text-primary hover:border-primary/40 flex h-9 items-center rounded-full border px-4 text-sm font-semibold tracking-wide shadow-sm backdrop-blur-md transition-all duration-200 hover:-translate-y-0.5"
        >
          Login
        </Link>
      )}
      <ThemePill />
    </div>
  );
}

/** Just the floating theme toggle, for header-less pages such as sign-in. */
export function FloatingThemeToggle() {
  return (
    <div className="no-print fixed top-4 right-4 z-50">
      <ThemePill />
    </div>
  );
}

function ThemePill() {
  return (
    <div className="bg-background/80 rounded-full border shadow-sm backdrop-blur-md">
      <ThemeToggle />
    </div>
  );
}

/** Landing-page account action, shown under the logo. */
export function AccountAction({ signedIn }: { signedIn: boolean }) {
  if (signedIn) {
    return (
      <form action={signOut}>
        <Button type="submit" variant="outline" size="sm" className="rounded-full px-4">
          <LogOut className="size-3.5" />
          Sign out
        </Button>
      </form>
    );
  }
  return (
    <Button
      size="sm"
      className="rounded-full px-5 shadow-sm"
      nativeButton={false}
      render={<Link href="/auth/login" />}
    >
      <LogIn className="size-3.5" />
      Start Acing
    </Button>
  );
}
