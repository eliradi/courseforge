import { BookOpenCheck, Landmark, Sparkles, Target } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';

import { ContentPage, Prose } from '@/components/layout/content-page';
import { Button } from '@/components/ui/button';
import { SITE } from '@/lib/site';

export const metadata: Metadata = {
  title: 'About',
  description: `Why we built ${SITE.name} and how it works.`,
};

const PILLARS = [
  {
    icon: Landmark,
    title: 'Straight from the source',
    body: 'Course details come from each university’s own public catalog, not a third-party dataset that drifts out of date.',
  },
  {
    icon: BookOpenCheck,
    title: 'The whole course, section by section',
    body: 'We build a full profile of a course — its topics, sections and readings — so you can see what you are signing up for.',
  },
  {
    icon: Sparkles,
    title: 'Practice that matches the syllabus',
    body: 'A hundred practice questions for every section, written to the course’s own topics and difficulty.',
  },
  {
    icon: Target,
    title: 'Built for students',
    body: 'Check a class before you register, get ahead over the summer, or review before an exam.',
  },
];

export default function AboutPage() {
  return (
    <ContentPage
      eyebrow={`About ${SITE.name}`}
      title={SITE.tagline}
      intro="We help students see what a university course really covers — and practice it before the first lecture."
      className="max-w-5xl"
    >
      <div className="grid gap-4 sm:grid-cols-2">
        {PILLARS.map(({ icon: Icon, title, body }) => (
          <div key={title} className="bg-card rounded-xl border p-5">
            <span className="bg-primary/10 text-primary mb-3 flex size-9 items-center justify-center rounded-lg">
              <Icon className="size-4" />
            </span>
            <h2 className="font-semibold">{title}</h2>
            <p className="text-muted-foreground mt-1.5 text-sm">{body}</p>
          </div>
        ))}
      </div>

      <Prose className="mt-12 max-w-3xl">
        <h2>Our story</h2>
        <p>
          Course catalogs are public, but they are scattered across hundreds of different sites and
          formats, and a two-line description rarely tells you what a class actually asks of you.{' '}
          {SITE.name} started as a way to fix that: read the catalog, lay out the course clearly,
          and turn it into practice you can use.
        </p>
        <h2>How we treat universities’ content</h2>
        <p>
          We read only public catalog pages, identify ourselves honestly, and respect each site’s
          robots.txt rules. We store facts about courses — never copyrighted textbook content.{' '}
          {SITE.name} is independent and is not affiliated with or endorsed by any university.
        </p>
      </Prose>

      <div className="mt-12 flex flex-wrap gap-3">
        <Button nativeButton={false} render={<Link href="/" />}>
          Explore courses
        </Button>
        <Button variant="outline" nativeButton={false} render={<Link href="/contact" />}>
          Get in touch
        </Button>
      </div>
    </ContentPage>
  );
}
