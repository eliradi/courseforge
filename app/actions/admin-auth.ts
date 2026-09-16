'use server';

import { redirect } from 'next/navigation';
import { z } from 'zod';

import { createClient } from '@/lib/supabase/server';
import { isAdminUser } from '@/lib/auth/admin';

const CredentialsSchema = z.object({
  email: z.string().email('Enter a valid email address'),
  password: z.string().min(1, 'Enter your password'),
});

export interface AdminAuthState {
  status: 'idle' | 'error';
  message?: string;
}

/**
 * Password sign-in for the admin console.
 *
 * The public app uses magic links; the console uses a password because it is a
 * shared operational account rather than a person's inbox.
 */
export async function signInAdmin(
  _prev: AdminAuthState,
  formData: FormData,
): Promise<AdminAuthState> {
  const parsed = CredentialsSchema.safeParse({
    email: formData.get('email'),
    password: formData.get('password'),
  });
  if (!parsed.success) {
    return { status: 'error', message: parsed.error.issues[0]?.message ?? 'Invalid credentials' };
  }

  const supabase = await createClient();
  const { data, error } = await supabase.auth.signInWithPassword(parsed.data);

  if (error || !data.user) {
    // Don't reveal which half was wrong.
    return { status: 'error', message: 'Those credentials were not accepted.' };
  }

  if (!isAdminUser(data.user)) {
    await supabase.auth.signOut();
    return { status: 'error', message: 'That account does not have admin access.' };
  }

  redirect('/admin');
}
