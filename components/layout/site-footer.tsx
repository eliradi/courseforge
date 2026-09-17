import { Mail } from 'lucide-react';
import Image from 'next/image';
import Link from 'next/link';

import { FOOTER_NAV, SITE, SOCIAL_LINKS } from '@/lib/site';
import { getUser } from '@/lib/supabase/server';

export async function SiteFooter() {
  const year = new Date().getFullYear();
  const user = await getUser();

  // Signed-in pages stay uncluttered: just the copyright line.
  if (user) {
    return (
      <footer className="no-print text-muted-foreground border-t py-5 text-center text-xs">
        © {year} {SITE.name}. All rights reserved.
      </footer>
    );
  }

  return (
    <footer className="no-print bg-muted/40 border-t">
      <div className="mx-auto grid w-full max-w-6xl gap-10 px-4 py-12 md:grid-cols-[1.4fr_repeat(3,1fr)]">
        <div className="space-y-4">
          <Link
            href="/"
            className="inline-flex items-center gap-2.5"
            aria-label={`${SITE.name} home`}
          >
            <Image src="/logo-mark.png" alt="" width={478} height={427} className="h-9 w-auto" />
            {/* Two-tone wordmark, like the logo: "Ace" in blue, "versity" in teal. */}
            <span className="text-xl font-bold tracking-tight">
              <span className="text-primary">Ace</span>
              <span className="text-brand-teal">versity</span>
            </span>
          </Link>
          <p className="text-muted-foreground max-w-xs text-sm">{SITE.description}</p>
          <a
            href={`mailto:${SITE.emails.hello}`}
            className="text-muted-foreground hover:text-foreground inline-flex items-center gap-2 text-sm"
          >
            <Mail className="size-4" />
            {SITE.emails.hello}
          </a>
          <ul className="flex gap-2 pt-1">
            {SOCIAL_LINKS.map(({ label, href, icon }) => (
              <li key={href}>
                <a
                  href={href}
                  target="_blank"
                  rel="noopener noreferrer"
                  aria-label={label}
                  title={label}
                  className="text-muted-foreground hover:text-primary hover:border-primary/40 bg-background flex size-9 items-center justify-center rounded-full border transition-colors"
                >
                  <svg viewBox="0 0 24 24" className="size-4 fill-current" aria-hidden="true">
                    <path d={icon.path} />
                  </svg>
                </a>
              </li>
            ))}
          </ul>
        </div>

        {FOOTER_NAV.map((group) => (
          <nav key={group.title} aria-label={group.title}>
            <h2 className="mb-3 text-sm font-semibold">{group.title}</h2>
            <ul className="space-y-2 text-sm">
              {group.links.map((link) => (
                <li key={link.label}>
                  <Link
                    href={link.href}
                    className="text-muted-foreground hover:text-primary transition-colors"
                  >
                    {link.label}
                  </Link>
                </li>
              ))}
            </ul>
          </nav>
        ))}
      </div>

      <div className="border-t">
        <p className="text-muted-foreground mx-auto w-full max-w-6xl px-4 py-5 text-xs">
          © {year} {SITE.name}. All rights reserved.
        </p>
      </div>
    </footer>
  );
}
