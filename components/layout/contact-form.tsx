'use client';

import { CheckCircle2, Loader2, Send } from 'lucide-react';
import { useActionState } from 'react';

import { sendContactMessage, type ContactState } from '@/app/actions/contact';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { CONTACT_TOPICS } from '@/lib/contact';

export function ContactForm({ defaultEmail }: { defaultEmail?: string }) {
  const [state, formAction, pending] = useActionState<ContactState, FormData>(sendContactMessage, {
    status: 'idle',
  });

  if (state.status === 'sent') {
    return (
      <div className="flex flex-col items-center py-10 text-center">
        <CheckCircle2 className="text-brand-teal mb-3 size-10" />
        <h2 className="text-lg font-semibold">Message sent</h2>
        <p className="text-muted-foreground mt-1 max-w-sm text-sm">
          Thanks for reaching out. We usually reply within 2 business days.
        </p>
      </div>
    );
  }

  return (
    <form action={formAction} className="space-y-4">
      {/* Honeypot for bots; hidden from people and assistive tech. */}
      <div aria-hidden="true" className="absolute -left-[9999px] size-px overflow-hidden">
        <label htmlFor="company">Company</label>
        <input id="company" name="company" type="text" tabIndex={-1} autoComplete="off" />
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="name">Name</Label>
          <Input id="name" name="name" autoComplete="name" required maxLength={120} />
        </div>
        <div className="space-y-2">
          <Label htmlFor="email">Email</Label>
          <Input
            id="email"
            name="email"
            type="email"
            autoComplete="email"
            required
            defaultValue={defaultEmail}
            placeholder="you@university.edu"
          />
        </div>
      </div>

      <div className="space-y-2">
        <Label htmlFor="topic">Topic</Label>
        <Select name="topic" defaultValue={CONTACT_TOPICS[0]}>
          <SelectTrigger id="topic" className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {CONTACT_TOPICS.map((topic) => (
              <SelectItem key={topic} value={topic}>
                {topic}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="space-y-2">
        <Label htmlFor="message">Message</Label>
        <Textarea
          id="message"
          name="message"
          required
          minLength={10}
          maxLength={5000}
          rows={6}
          className="min-h-32"
          placeholder="How can we help? For course issues, include the university and course number."
        />
      </div>

      {state.status === 'error' && state.message ? (
        <Alert variant="destructive">
          <AlertDescription>{state.message}</AlertDescription>
        </Alert>
      ) : null}

      <Button type="submit" className="w-full sm:w-auto" disabled={pending}>
        {pending ? <Loader2 className="size-4 animate-spin" /> : <Send className="size-4" />}
        Send message
      </Button>
    </form>
  );
}
