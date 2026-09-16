import { createServerClient } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';

/** Paths that require a signed-in user. Browsing catalogs stays public. */
const PROTECTED = [/^\/test\//, /^\/course\/[^/]+\/tests\/?$/];

function isProtected(pathname: string): boolean {
  return PROTECTED.some((pattern) => pattern.test(pathname));
}

/** The admin console, which needs the admin role rather than just a session. */
function isAdminPath(pathname: string): boolean {
  return pathname === '/admin' || pathname.startsWith('/admin/');
}

/**
 * Refreshes the auth cookie on every request so Server Components see a live
 * session, and gates the signed-in-only routes.
 *
 * Gating here rather than inside each page keeps the rule in one place, and
 * means a protected page never begins rendering for a signed-out visitor — in
 * dev that also avoids Next caching a client-chunk-less compile of a route
 * whose first request happened to be a redirect.
 */
export async function updateSession(request: NextRequest) {
  let response = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          for (const { name, value } of cookiesToSet) {
            request.cookies.set(name, value);
          }
          response = NextResponse.next({ request });
          for (const { name, value, options } of cookiesToSet) {
            response.cookies.set(name, value, options);
          }
        },
      },
    },
  );

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { pathname, search } = request.nextUrl;

  // Admin console: bounce anyone without the server-set admin role. The pages
  // re-check on the server too — this is the cheap first gate, not the only one.
  if (isAdminPath(pathname) && pathname !== '/admin/login') {
    const role = (user?.app_metadata as { role?: unknown } | null)?.role;
    if (role !== 'admin') {
      const login = request.nextUrl.clone();
      login.pathname = '/admin/login';
      login.search = '';
      const redirect = NextResponse.redirect(login);
      for (const cookie of response.cookies.getAll()) redirect.cookies.set(cookie);
      return redirect;
    }
  }

  if (!user && isProtected(pathname)) {
    const login = request.nextUrl.clone();
    login.pathname = '/auth/login';
    login.search = `?next=${encodeURIComponent(`${pathname}${search}`)}`;

    const redirect = NextResponse.redirect(login);
    // Carry over any refreshed auth cookies so the session isn't lost.
    for (const cookie of response.cookies.getAll()) {
      redirect.cookies.set(cookie);
    }
    return redirect;
  }

  return response;
}
