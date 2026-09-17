import { LifeBuoy, Mail, ShieldCheck } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';

import { ContactForm } from '@/components/layout/contact-form';
import { ContentPage } from '@/components/layout/content-page';
import { Card, CardContent } from '@/components/ui/card';
import { SITE } from '@/lib/site';
import { getUser } from '@/lib/supabase/server';

export const metadata: Metadata = {
  title: 'Contact',
  description: `Get in touch with the ${SITE.name} team.`,
};

const CHANNELS = [
  { icon: Mail, title: 'General', email: SITE.emails.hello },
  { icon: LifeBuoy, title: 'Support', email: SITE.emails.support },
  { icon: ShieldCheck, title: 'Privacy', email: SITE.emails.privacy },
];

export default async function ContactPage() {
  const user = await getUser();

  return (
    <ContentPage
      eyebrow="Contact"
      title="Get in touch"
      intro="Questions, feedback, a missing course or a partnership idea — we’d love to hear from you."
      className="max-w-5xl"
    >
      <div className="grid gap-8 lg:grid-cols-[1fr_18rem]">
        <Card>
          <CardContent className="relative">
            <ContactForm defaultEmail={user?.email} />
          </CardContent>
        </Card>

        <aside className="space-y-5">
          {CHANNELS.map(({ icon: Icon, title, email }) => (
            <div key={title} className="flex gap-3">
              <span className="bg-primary/10 text-primary flex size-9 shrink-0 items-center justify-center rounded-lg">
                <Icon className="size-4" />
              </span>
              <div className="min-w-0">
                <p className="font-semibold">{title}</p>
                <a
                  href={`mailto:${email}`}
                  className="text-muted-foreground hover:text-primary text-sm break-words"
                >
                  {email}
                </a>
              </div>
            </div>
          ))}
          <p className="text-muted-foreground border-t pt-5 text-sm">
            Looking for a quick answer? Try the{' '}
            <Link href="/support" className="text-primary underline underline-offset-4">
              help center
            </Link>
            .
          </p>
        </aside>
      </div>
    </ContentPage>
  );
}
