import 'server-only';

import type { User } from '@supabase/supabase-js';

import { getUser } from '@/lib/supabase/server';

/**
 * Admin is a server-controlled flag.
 *
 * It lives in `app_metadata`, which only the service role can write — unlike
 * `user_metadata`, which a signed-in user can change on themselves. Never move
 * this check to user_metadata.
 */
export function isAdminUser(user: User | null): boolean {
  if (!user) return false;
  const role = (user.app_metadata as { role?: unknown } | null)?.role;
  return role === 'admin';
}

export async function getAdminUser(): Promise<User | null> {
  const user = await getUser();
  return isAdminUser(user) ? user : null;
}
