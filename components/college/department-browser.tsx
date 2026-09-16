'use client';

import { AlertTriangle, Link2, Library, RefreshCw, Search } from 'lucide-react';
import Link from 'next/link';
import { useEffect, useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';

import { ScrapeProgress } from '@/components/college/scrape-progress';
import { EmptyState } from '@/components/layout/empty-state';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { useScrapeStream } from '@/hooks/use-scrape-stream';
import type { College, Department } from '@/lib/supabase/types';

interface DiscoverPayload {
  departments: Department[];
  platform: string;
  catalogUrl: string;
  fromCache: boolean;
}

const PLATFORM_LABELS: Record<string, string> = {
  courseleaf: 'CourseLeaf',
  acalog: 'Acalog',
  banner: 'Ellucian Banner',
  kuali: 'Kuali',
  generic: 'Generic catalog',
};

export function DepartmentBrowser({
  college,
  initialDepartments,
  needsScrape,
}: {
  college: College;
  initialDepartments: Department[];
  needsScrape: boolean;
}) {
  const stream = useScrapeStream<DiscoverPayload>(`/api/colleges/${college.id}/discover`);
  const [departments, setDepartments] = useState(initialDepartments);
  const [platform, setPlatform] = useState(college.catalog_platform);
  const [catalogUrl, setCatalogUrl] = useState(college.catalog_url);
  const [query, setQuery] = useState('');
  const [manualUrl, setManualUrl] = useState('');
  const [showManual, setShowManual] = useState(false);

  // Kick off discovery on first visit (or when the cache has gone stale).
  const started = useRef(false);
  useEffect(() => {
    if (!needsScrape || started.current) return;
    started.current = true;
    void runScrape({});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [needsScrape]);

  async function runScrape(body: Record<string, unknown>) {
    const result = await stream.run(body);
    if (!result) return;

    setDepartments(result.departments);
    setPlatform(result.platform);
    setCatalogUrl(result.catalogUrl);
    setShowManual(false);
    if (!result.fromCache) {
      toast.success(`Found ${result.departments.length} departments`, {
        description: `Read from ${PLATFORM_LABELS[result.platform] ?? result.platform}.`,
      });
    }
  }

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return departments;
    return departments.filter(
      (d) => d.code.toLowerCase().includes(needle) || d.name.toLowerCase().includes(needle),
    );
  }, [departments, query]);

  if (stream.running) {
    return (
      <div className="space-y-6">
        <ScrapeProgress steps={stream.steps} title={`Reading ${college.name}'s catalog`} />
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-[4.5rem] rounded-xl" />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {stream.error ? (
        <Alert variant="destructive">
          <AlertTriangle className="size-4" />
          <AlertTitle>We couldn&apos;t read that catalog</AlertTitle>
          <AlertDescription className="space-y-3">
            <p>{stream.error.message}</p>
            <div className="flex flex-wrap gap-2">
              <Button size="sm" variant="outline" onClick={() => void runScrape({})}>
                <RefreshCw className="size-3.5" />
                Try again
              </Button>
              {stream.error.recoverable ? (
                <Button size="sm" variant="outline" onClick={() => setShowManual(true)}>
                  <Link2 className="size-3.5" />
                  Enter the catalog URL
                </Button>
              ) : null}
            </div>
          </AlertDescription>
        </Alert>
      ) : null}

      {departments.length > 0 ? (
        <>
          <div className="flex flex-wrap items-center gap-3">
            <div className="relative min-w-0 flex-1">
              <Search className="text-muted-foreground pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2" />
              <Input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Filter departments…"
                className="h-10 pl-9"
                aria-label="Filter departments"
              />
            </div>

            {platform ? (
              <Badge variant="secondary" className="h-7">
                {PLATFORM_LABELS[platform] ?? platform}
              </Badge>
            ) : null}

            <Button variant="outline" size="sm" onClick={() => void runScrape({ force: true })}>
              <RefreshCw className="size-3.5" />
              Re-scrape
            </Button>
          </div>

          {filtered.length ? (
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {filtered.map((department) => (
                <Link
                  key={department.id}
                  href={`/college/${college.id}/dept/${department.id}`}
                  className="group focus-visible:ring-ring rounded-xl focus-visible:ring-2 focus-visible:outline-none"
                >
                  <Card className="hover:border-primary/50 h-full transition-colors">
                    <CardContent className="flex items-start gap-3 py-4">
                      <Badge
                        variant="outline"
                        className="group-hover:border-primary/40 group-hover:text-primary mt-0.5 shrink-0 font-mono text-[11px]"
                      >
                        {department.code}
                      </Badge>
                      <span className="min-w-0 text-sm font-medium">{department.name}</span>
                    </CardContent>
                  </Card>
                </Link>
              ))}
            </div>
          ) : (
            <EmptyState
              icon={Search}
              title="No department matches that filter"
              description={`Nothing in ${college.name}'s catalog matches “${query}”.`}
              action={
                <Button variant="outline" size="sm" onClick={() => setQuery('')}>
                  Clear filter
                </Button>
              }
            />
          )}

          {catalogUrl ? (
            <p className="text-muted-foreground text-xs">
              Source:{' '}
              <a
                href={catalogUrl}
                target="_blank"
                rel="noreferrer noopener"
                className="hover:text-foreground underline underline-offset-2"
              >
                {catalogUrl}
              </a>
            </p>
          ) : null}
        </>
      ) : !stream.error ? (
        <EmptyState
          icon={Library}
          title="No departments cached yet"
          description={`We haven't read ${college.name}'s catalog yet.`}
          action={
            <Button onClick={() => void runScrape({})}>
              <RefreshCw className="size-4" />
              Scrape the catalog
            </Button>
          }
        />
      ) : null}

      <ManualUrlPanel
        open={showManual || (!departments.length && Boolean(stream.error))}
        value={manualUrl}
        onChange={setManualUrl}
        onSubmit={() => {
          if (!manualUrl.trim()) return;
          void runScrape({ manualUrl: manualUrl.trim(), force: true });
        }}
        onToggle={() => setShowManual((v) => !v)}
        showToggle={departments.length > 0}
      />
    </div>
  );
}

function ManualUrlPanel({
  open,
  value,
  onChange,
  onSubmit,
  onToggle,
  showToggle,
}: {
  open: boolean;
  value: string;
  onChange: (value: string) => void;
  onSubmit: () => void;
  onToggle: () => void;
  showToggle: boolean;
}) {
  if (!open) {
    return showToggle ? (
      <button
        type="button"
        onClick={onToggle}
        className="text-muted-foreground hover:text-foreground text-xs underline underline-offset-2"
      >
        Catalog not found, or looks wrong?
      </button>
    ) : null;
  }

  return (
    <Card>
      <CardContent className="space-y-3 py-5">
        <div>
          <h3 className="text-sm font-semibold">Point us at the catalog</h3>
          <p className="text-muted-foreground mt-1 text-sm">
            Paste the URL of the course catalog index — the page that lists subjects or departments.
          </p>
        </div>
        <form
          className="flex flex-col gap-2 sm:flex-row"
          onSubmit={(event) => {
            event.preventDefault();
            onSubmit();
          }}
        >
          <Input
            type="url"
            required
            value={value}
            onChange={(e) => onChange(e.target.value)}
            placeholder="https://catalog.example.edu/courses/"
            className="h-10"
            aria-label="Catalog URL"
          />
          <Button type="submit" className="h-10 shrink-0">
            Use this URL
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
