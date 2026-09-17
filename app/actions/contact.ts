'use server';

import { z } from 'zod';

import { CONTACT_TOPICS } from '@/lib/contact';
import { createAdminClient } from '@/lib/supabase/admin';
import { getUser } from '@/lib/supabase/server';

const ContactSchema = z.object({
  name: z.string().trim().min(1, 'Enter your name').max(120),
  email: z.string().trim().email('Enter a valid email address').max(254),
  topic: z.enum(CONTACT_TOPICS, { message: 'Choose a topic' }),
  message: z
    .string()
    .trim()
    .min(10, 'Tell us a little more (at least 10 characters)')
    .max(5000, 'Keep your message under 5,000 characters'),
});

export interface ContactState {
  status: 'idle' | 'sent' | 'error';
  message?: string;
}

export async function sendContactMessage(
  _prev: ContactState,
  formData: FormData,
): Promise<ContactState> {
  // Honeypot: the field is hidden from people, so anything in it came from a bot.
  // Report success so the bot has nothing to retry against.
  if (String(formData.get('company') ?? '')) return { status: 'sent' };

  const parsed = ContactSchema.safeParse({
    name: formData.get('name'),
    email: formData.get('email'),
    topic: formData.get('topic'),
    message: formData.get('message'),
  });
  if (!parsed.success) {
    return {
      status: 'error',
      message: parsed.error.issues[0]?.message ?? 'Check the form and try again',
    };
  }

  const user = await getUser();
  const { error } = await createAdminClient()
    .from('contact_messages')
    .insert({ ...parsed.data, user_id: user?.id ?? null });

  if (error) {
    console.error('contact message insert failed', error);
    return {
      status: 'error',
      message: 'We couldn’t send your message. Please try again or email us.',
    };
  }
  return { status: 'sent' };
}
