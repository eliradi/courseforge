import { BookOpen, LayoutDashboard, ShieldCheck, University, Users } from 'lucide-react';
import Link from 'next/link';
import { redirect } from 'next/navigation';

import { getAdminUser } from '@/lib/auth/admin';

const TABS = [
  { href: '/admin', label: 'Overview', icon: LayoutDashboard },
  { href: '/admin/users', label: 'Users', icon: Users },
  { href: '/admin/universities', label: 'Universities', icon: University },
  { href: '/admin/courses', label: 'Courses', icon: BookOpen },
];

/**
 * Console chrome for the signed-in admin pages.
 *
 * `/admin/login` deliberately sits outside this route group. When it lived
 * inside, this layout needed an `if (!admin) return children` branch — and in
 * dev, the first compile of the layout happened on the signed-out login page,
 * which meant Next cached a client manifest containing none of the subtree's
 * client code. Every later authenticated visit then 404'd on the layout chunk
 * and nothing under /admin hydrated: buttons rendered but did nothing.
 *
 * Keeping login out means this layout always renders the same tree.
 */
export default async function AdminConsoleLayout({ children }: { children: React.ReactNode }) {
  const admin = await getAdminUser();

  // Middleware already gates these paths; this is the server-side backstop.
  if (!admin) redirect('/admin/login');

  return (
    <div className="mx-auto w-full max-w-7xl px-4 py-8">
      <header className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <span className="bg-primary/10 text-primary flex size-8 items-center justify-center rounded-lg">
            <ShieldCheck className="size-4" />
          </span>
          <div>
            <h1 className="text-lg font-semibold">Admin console</h1>
            <p className="text-muted-foreground text-xs">{admin.email}</p>
          </div>
        </div>
      </header>

      <nav className="mb-8 flex flex-wrap gap-1 border-b">
        {TABS.map((tab) => (
          <Link
            key={tab.href}
            href={tab.href}
            className="text-muted-foreground hover:text-foreground hover:border-border -mb-px flex items-center gap-2 border-b-2 border-transparent px-3 py-2.5 text-sm font-medium transition-colors"
          >
            <tab.icon className="size-4" />
            {tab.label}
          </Link>
        ))}
      </nav>

      {children}
    </div>
  );
}
