'use client';

import { AlertTriangle, BookOpen, RefreshCw, Search } from 'lucide-react';
import Link from 'next/link';
import { useEffect, useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';

import { ScrapeProgress } from '@/components/college/scrape-progress';
import { FavoriteToggle } from '@/components/favorite-toggle';
import { EmptyState } from '@/components/layout/empty-state';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { useScrapeStream } from '@/hooks/use-scrape-stream';
import type { Course, Department } from '@/lib/supabase/types';

interface CoursesPayload {
  courses: Course[];
  fromCache: boolean;
}

export function CourseList({
  department,
  initialCourses,
  needsScrape,
  favoriteCourseIds,
  signedIn,
}: {
  department: Department;
  initialCourses: Course[];
  needsScrape: boolean;
  favoriteCourseIds: string[];
  signedIn: boolean;
}) {
  const favorites = useMemo(() => new Set(favoriteCourseIds), [favoriteCourseIds]);
  const stream = useScrapeStream<CoursesPayload>(`/api/departments/${department.id}/courses`);
  const [courses, setCourses] = useState(initialCourses);
  const [query, setQuery] = useState('');

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
    setCourses(result.courses);
    if (!result.fromCache) {
      toast.success(`Found ${result.courses.length} courses in ${department.code}`);
    }
  }

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return courses;
    return courses.filter(
      (c) =>
        c.course_number.toLowerCase().includes(needle) ||
        c.title.toLowerCase().includes(needle) ||
        (c.description ?? '').toLowerCase().includes(needle),
    );
  }, [courses, query]);

  if (stream.running) {
    return (
      <div className="space-y-6">
        <ScrapeProgress steps={stream.steps} title={`Reading ${department.code} courses`} />
        <div className="space-y-2">
          {Array.from({ length: 8 }).map((_, i) => (
            <Skeleton key={i} className="h-12 rounded-lg" />
          ))}
        </div>
      </div>
    );
  }

  if (stream.error && !courses.length) {
    return (
      <Alert variant="destructive">
        <AlertTriangle className="size-4" />
        <AlertTitle>We couldn&apos;t read this department</AlertTitle>
        <AlertDescription className="space-y-3">
          <p>{stream.error.message}</p>
          <Button size="sm" variant="outline" onClick={() => void runScrape({ force: true })}>
            <RefreshCw className="size-3.5" />
            Try again
          </Button>
        </AlertDescription>
      </Alert>
    );
  }

  if (!courses.length) {
    return (
      <EmptyState
        icon={BookOpen}
        title="No courses cached yet"
        description={`We haven't read the ${department.code} course list yet.`}
        action={
          <Button onClick={() => void runScrape({})}>
            <RefreshCw className="size-4" />
            Scrape courses
          </Button>
        }
      />
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative min-w-0 flex-1">
          <Search className="text-muted-foreground pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Filter by number, title or description…"
            className="h-10 pl-9"
            aria-label="Filter courses"
          />
        </div>
        <Badge variant="secondary" className="h-7 tabular-nums">
          {filtered.length} of {courses.length}
        </Badge>
        <Button variant="outline" size="sm" onClick={() => void runScrape({ force: true })}>
          <RefreshCw className="size-3.5" />
          Re-scrape
        </Button>
      </div>

      {filtered.length ? (
        <div className="overflow-hidden rounded-xl border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-[9rem]">Number</TableHead>
                <TableHead>Title</TableHead>
                <TableHead className="hidden w-[9rem] sm:table-cell">Credits</TableHead>
                <TableHead className="w-12">
                  <span className="sr-only">Favourite</span>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.map((course) => (
                <TableRow key={course.id} className="hover:bg-muted/40">
                  <TableCell className="p-0">
                    <Link
                      href={`/course/${course.id}`}
                      className="block px-4 py-3 font-mono text-xs font-medium"
                    >
                      {course.course_number}
                    </Link>
                  </TableCell>
                  <TableCell className="p-0">
                    <Link href={`/course/${course.id}`} className="block px-4 py-3 text-sm">
                      {course.title}
                    </Link>
                  </TableCell>
                  <TableCell className="text-muted-foreground hidden p-0 text-xs sm:table-cell">
                    <Link href={`/course/${course.id}`} className="block px-4 py-3">
                      {course.credits ?? '—'}
                    </Link>
                  </TableCell>
                  <TableCell className="px-2 py-0">
                    <FavoriteToggle
                      target={{ courseId: course.id }}
                      initialFavorited={favorites.has(course.id)}
                      signedIn={signedIn}
                      label={`${course.course_number} ${course.title}`}
                      size="sm"
                    />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      ) : (
        <EmptyState
          icon={Search}
          title="No course matches that filter"
          description={`Nothing in ${department.code} matches “${query}”.`}
          action={
            <Button variant="outline" size="sm" onClick={() => setQuery('')}>
              Clear filter
            </Button>
          }
        />
      )}
    </div>
  );
}
