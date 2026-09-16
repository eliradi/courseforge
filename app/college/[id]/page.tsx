import { ExternalLink } from 'lucide-react';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';

import { DepartmentBrowser } from '@/components/college/department-browser';
import { Breadcrumbs } from '@/components/layout/breadcrumbs';
import { Badge } from '@/components/ui/badge';
import { getCollege, listDepartments } from '@/lib/db/queries';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const { id } = await params;
  const college = await getCollege(id);
  return { title: college ? `${college.name} — departments` : 'College' };
}

export default async function CollegePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const college = await getCollege(id);
  if (!college) notFound();

  const departments = await listDepartments(id);
  // Use whatever is already in the database, however old — only a college we've
  // never read gets scraped automatically. Refreshing is an explicit action.
  const needsScrape = departments.length === 0;

  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-10">
      <Breadcrumbs items={[{ label: 'Colleges', href: '/' }, { label: college.name }]} />

      <header className="mb-8">
        <div className="flex flex-wrap items-center gap-2">
          {college.rank ? (
            <Badge variant="secondary" className="font-mono text-[11px]">
              #{college.rank} nationally
            </Badge>
          ) : null}
          {college.short_name && college.short_name !== college.name ? (
            <Badge variant="outline" className="text-[11px]">
              {college.short_name}
            </Badge>
          ) : null}
        </div>

        <h1 className="mt-3 text-3xl font-semibold">{college.name}</h1>

        <p className="text-muted-foreground mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
          <span>{[college.city, college.state].filter(Boolean).join(', ')}</span>
          <span aria-hidden>·</span>
          <a
            href={`https://${college.website_domain}`}
            target="_blank"
            rel="noreferrer noopener"
            className="hover:text-foreground inline-flex items-center gap-1 underline underline-offset-2"
          >
            {college.website_domain}
            <ExternalLink className="size-3" />
          </a>
        </p>

        <p className="text-muted-foreground mt-4 max-w-2xl text-sm">
          Pick a department to see its course list. We read these straight from the
          university&apos;s own catalog once and keep them — use Re-scrape to refresh.
        </p>
      </header>

      <DepartmentBrowser
        college={college}
        initialDepartments={departments}
        needsScrape={needsScrape}
      />
    </div>
  );
}
