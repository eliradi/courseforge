'use server';

import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { z } from 'zod';

import { createClient } from '@/lib/supabase/server';

const EmailSchema = z.object({ email: z.string().email('Enter a valid email address') });

export interface AuthState {
  status: 'idle' | 'sent' | 'error';
  message?: string;
}

async function siteUrl(): Promise<string> {
  if (process.env.NEXT_PUBLIC_SITE_URL) return process.env.NEXT_PUBLIC_SITE_URL.replace(/\/$/, '');
  const h = await headers();
  const host = h.get('x-forwarded-host') ?? h.get('host') ?? 'localhost:3000';
  const protocol = h.get('x-forwarded-proto') ?? (host.startsWith('localhost') ? 'http' : 'https');
  return `${protocol}://${host}`;
}

/** Sends a Supabase magic link. Generating and taking tests requires sign-in. */
export async function signInWithEmail(_prev: AuthState, formData: FormData): Promise<AuthState> {
  const parsed = EmailSchema.safeParse({ email: formData.get('email') });
  if (!parsed.success) {
    return { status: 'error', message: parsed.error.issues[0]?.message ?? 'Invalid email' };
  }

  const redirectTo = String(formData.get('redirectTo') ?? '/');
  const supabase = await createClient();
  const base = await siteUrl();

  const { error } = await supabase.auth.signInWithOtp({
    email: parsed.data.email,
    options: {
      emailRedirectTo: `${base}/auth/callback?next=${encodeURIComponent(redirectTo)}`,
    },
  });

  if (error) return { status: 'error', message: error.message };
  return { status: 'sent', message: `Check ${parsed.data.email} for your sign-in link.` };
}

export async function signOut(): Promise<never> {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect('/');
}
