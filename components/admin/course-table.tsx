'use client';

import {
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
  Loader2,
  Search,
} from 'lucide-react';
import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useRef, useState, useTransition } from 'react';

import { SortableHead, nextSort, type SortState } from '@/components/admin/sortable-head';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { formatUsd } from '@/lib/ai/pricing';
import type { AdminCoursePage, CourseFilter, CourseSort } from '@/lib/db/admin-queries';

const LEVEL_STYLES: Record<string, string> = {
  Introductory: 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-400',
  Undergraduate: 'bg-sky-500/10 text-sky-700 dark:text-sky-400',
  Graduate: 'bg-violet-500/10 text-violet-700 dark:text-violet-400',
  Unspecified: 'bg-muted text-muted-foreground',
};

const FILTERS: CourseFilter[] = ['all', 'tested', 'untested'];

/** Counts and money read best biggest-first; names A–Z. */
const NUMERIC: CourseSort[] = ['sections', 'tests', 'taken', 'cost'];
const descByDefault = (column: CourseSort) => NUMERIC.includes(column);

const SEARCH_DEBOUNCE_MS = 350;

/**
 * The admin course list. Search, filter, sort and page live in the URL and are
 * applied by the server (see `admin_course_list`), so every course is reachable
 * however large the catalog gets.
 */
export function CourseTable({
  data,
  query,
  filter,
  sort,
}: {
  data: AdminCoursePage;
  query: string;
  filter: CourseFilter;
  sort: SortState<CourseSort>;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [pending, startTransition] = useTransition();
  const [text, setText] = useState(query);
  const lastPushed = useRef(query);

  function navigate(changes: Record<string, string | null>) {
    const params = new URLSearchParams(searchParams.toString());
    for (const [key, value] of Object.entries(changes)) {
      if (value === null || value === '') params.delete(key);
      else params.set(key, value);
    }
    const qs = params.toString();
    startTransition(() => router.push(qs ? `${pathname}?${qs}` : pathname, { scroll: false }));
  }

  // Search as you type, debounced; a new search starts from page 1.
  useEffect(() => {
    const term = text.trim();
    if (term === lastPushed.current) return;
    const timer = setTimeout(() => {
      lastPushed.current = term;
      navigate({ q: term || null, page: null });
    }, SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [text]);

  function onSort(column: CourseSort) {
    const next = nextSort(sort, column, descByDefault);
    navigate({ sort: next.key, dir: next.desc ? 'desc' : 'asc', page: null });
  }

  function goTo(page: number) {
    const target = Math.min(Math.max(1, page), data.pageCount);
    navigate({ page: target === 1 ? null : String(target) });
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  const first = data.matching ? (data.page - 1) * data.pageSize + 1 : 0;
  const last = Math.min(data.page * data.pageSize, data.matching);
  const filtered = Boolean(query) || filter !== 'all';

  const head = (column: CourseSort, label: string, align: 'left' | 'right' = 'left', className?: string) => (
    <SortableHead label={label} column={column} sort={sort} onSort={onSort} align={align} className={className} />
  );

  const pager = (
    <Pager page={data.page} pageCount={data.pageCount} onGo={goTo} disabled={pending} />
  );

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <p className="text-sm">
          <span className="text-2xl font-semibold tabular-nums">{data.total.toLocaleString()}</span>{' '}
          <span className="text-muted-foreground">courses in the database</span>
        </p>
        {filtered ? (
          <p className="text-muted-foreground text-sm tabular-nums">
            {data.matching.toLocaleString()} match
          </p>
        ) : null}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-0 flex-1">
          <Search className="text-muted-foreground pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2" />
          <Input
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="Search course, title, department or university…"
            className="h-9 pl-9"
            aria-label="Search courses"
          />
        </div>
        {FILTERS.map((value) => (
          <Button
            key={value}
            size="sm"
            variant={filter === value ? 'secondary' : 'ghost'}
            onClick={() => navigate({ filter: value === 'all' ? null : value, page: null })}
            className="capitalize"
          >
            {value}
          </Button>
        ))}
        {pending ? <Loader2 className="text-muted-foreground size-4 animate-spin" aria-label="Loading" /> : null}
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-muted-foreground text-xs tabular-nums">
          {data.matching
            ? `Showing ${first.toLocaleString()}–${last.toLocaleString()} of ${data.matching.toLocaleString()}`
            : 'No courses match'}
        </p>
        {pager}
      </div>

      <div className={`overflow-x-auto rounded-xl border transition-opacity ${pending ? 'opacity-60' : ''}`}>
        <Table>
          <TableHeader>
            <TableRow>
              {head('course', 'Course', 'left', 'w-[8rem]')}
              {head('title', 'Title')}
              {head('university', 'University')}
              {head('department', 'Department')}
              {head('level', 'Level')}
              {head('sections', 'Sections', 'right')}
              {head('tests', 'Tests', 'right')}
              {head('taken', 'Taken', 'right')}
              {head('cost', 'AI cost', 'right')}
            </TableRow>
          </TableHeader>
          <TableBody>
            {data.rows.length ? (
              data.rows.map((course) => (
                <TableRow key={course.id}>
                  <TableCell className="p-0">
                    <Link href={`/course/${course.id}`} className="block px-4 py-3 font-mono text-xs">
                      {course.courseNumber}
                    </Link>
                  </TableCell>
                  <TableCell className="max-w-[20rem] truncate text-sm">{course.title}</TableCell>
                  <TableCell className="text-xs">{course.collegeName}</TableCell>
                  <TableCell className="text-xs">
                    <span className="font-medium">{course.departmentCode}</span>
                    <span className="text-muted-foreground block max-w-[12rem] truncate">
                      {course.departmentName}
                    </span>
                  </TableCell>
                  <TableCell>
                    <Badge className={`border-0 text-[11px] ${LEVEL_STYLES[course.level] ?? LEVEL_STYLES.Unspecified}`}>
                      {course.level}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-right text-xs tabular-nums">
                    {course.sectionCount || '—'}
                  </TableCell>
                  <TableCell className="text-right text-xs tabular-nums">
                    {course.testSetCount ? (
                      <span className="flex items-center justify-end gap-1">
                        {course.completeTestSets > 0 ? (
                          <CheckCircle2 className="size-3 text-emerald-600 dark:text-emerald-500" />
                        ) : null}
                        {course.completeTestSets}/{course.testSetCount}
                      </span>
                    ) : (
                      '—'
                    )}
                  </TableCell>
                  <TableCell className="text-right text-xs tabular-nums">
                    {course.attemptsTaken || '—'}
                  </TableCell>
                  <TableCell className="text-right text-xs tabular-nums">
                    {course.costUsd > 0 ? formatUsd(course.costUsd) : '—'}
                  </TableCell>
                </TableRow>
              ))
            ) : (
              <TableRow>
                <TableHead colSpan={9} className="text-muted-foreground h-24 text-center font-normal">
                  No courses match this search.
                </TableHead>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>

      <div className="flex justify-end">{pager}</div>

      <p className="text-muted-foreground text-xs">
        Level is derived from the course number (catalogs don&apos;t publish a course &ldquo;type&rdquo;),
        using the standard US convention where the leading digit marks class standing. Tests shows
        complete / total generated sets; tests are shared, so any of them is usable by every student.
      </p>
    </div>
  );
}

function Pager({
  page,
  pageCount,
  onGo,
  disabled,
}: {
  page: number;
  pageCount: number;
  onGo: (page: number) => void;
  disabled: boolean;
}) {
  const [draft, setDraft] = useState(String(page));
  useEffect(() => setDraft(String(page)), [page]);

  if (pageCount <= 1) return null;

  return (
    <nav className="flex items-center gap-1" aria-label="Pagination">
      <Button size="icon-sm" variant="ghost" onClick={() => onGo(1)} disabled={disabled || page <= 1} aria-label="First page">
        <ChevronsLeft />
      </Button>
      <Button size="icon-sm" variant="ghost" onClick={() => onGo(page - 1)} disabled={disabled || page <= 1} aria-label="Previous page">
        <ChevronLeft />
      </Button>
      <form
        className="flex items-center gap-1.5 px-1 text-xs"
        onSubmit={(e) => {
          e.preventDefault();
          const value = Number(draft);
          if (Number.isFinite(value)) onGo(Math.round(value));
        }}
      >
        Page
        <Input
          value={draft}
          onChange={(e) => setDraft(e.target.value.replace(/\D/g, ''))}
          onBlur={() => setDraft(String(page))}
          inputMode="numeric"
          className="h-7 w-12 px-1 text-center text-xs tabular-nums"
          aria-label="Page number"
        />
        <span className="tabular-nums">of {pageCount}</span>
      </form>
      <Button
        size="icon-sm"
        variant="ghost"
        onClick={() => onGo(page + 1)}
        disabled={disabled || page >= pageCount}
        aria-label="Next page"
      >
        <ChevronRight />
      </Button>
      <Button
        size="icon-sm"
        variant="ghost"
        onClick={() => onGo(pageCount)}
        disabled={disabled || page >= pageCount}
        aria-label="Last page"
      >
        <ChevronsRight />
      </Button>
    </nav>
  );
}
