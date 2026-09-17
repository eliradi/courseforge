import { LogIn, LogOut } from 'lucide-react';
import Link from 'next/link';

import { signOut } from '@/app/actions/auth';
import { ThemeToggle } from '@/components/layout/theme-toggle';
import { Button } from '@/components/ui/button';

/** Landing-page stand-in for the header: pricing, login, sign-up and theme toggle, pinned top-right. */
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
        <>
          {/* Gradient hairline border around a frosted pill; on hover the
            gradient fills it and the label turns white. */}
          <Link
            href="/auth/login"
            className="group flex h-9 rounded-full bg-gradient-to-r from-[#115388] to-[#0ba297] p-px shadow-sm transition-all duration-200 hover:-translate-y-0.5 hover:shadow-md hover:shadow-[#115388]/25"
          >
            <span className="bg-background/90 flex items-center rounded-full px-4 text-sm font-semibold tracking-wide backdrop-blur-md transition-colors duration-200 group-hover:bg-transparent">
              <span className="bg-gradient-to-r from-[#115388] to-[#0ba297] bg-clip-text text-transparent transition-colors duration-200 group-hover:text-white dark:from-[#7fb0e6] dark:to-[#2dd4bf]">
                Login
              </span>
            </span>
          </Link>

          {/* Deep-navy pill inside a slowly turning brand-gradient ring. */}
          <Link
            href="/auth/login"
            className="group relative flex h-9 overflow-hidden rounded-full p-[1.5px] shadow-md shadow-[#0ba297]/25 transition-all duration-200 hover:-translate-y-0.5 hover:shadow-lg hover:shadow-[#0ba297]/40"
          >
            <span
              aria-hidden
              className="absolute inset-[-150%] animate-[spin_4s_linear_infinite] bg-[conic-gradient(from_0deg,#115388,#0ba297,#8ff0e0,#0ba297,#115388)] motion-reduce:animate-none"
            />
            <span className="relative flex items-center rounded-full bg-[#0b2540] px-4 text-sm font-semibold tracking-wide text-white transition-colors duration-200 group-hover:bg-[#0e3257]">
              Sign Up
            </span>
          </Link>
        </>
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
