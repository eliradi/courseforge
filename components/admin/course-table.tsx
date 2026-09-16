'use client';

import { CheckCircle2, Search } from 'lucide-react';
import Link from 'next/link';
import { useMemo, useState } from 'react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { formatUsd } from '@/lib/ai/pricing';
import type { AdminCourseRow } from '@/lib/db/admin-queries';

type Filter = 'all' | 'tested' | 'untested';

const LEVEL_STYLES: Record<string, string> = {
  Introductory: 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-400',
  Undergraduate: 'bg-sky-500/10 text-sky-700 dark:text-sky-400',
  Graduate: 'bg-violet-500/10 text-violet-700 dark:text-violet-400',
  Unspecified: 'bg-muted text-muted-foreground',
};

export function CourseTable({ courses }: { courses: AdminCourseRow[] }) {
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<Filter>('all');

  const rows = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return courses.filter((course) => {
      if (filter === 'tested' && course.testSetCount === 0) return false;
      if (filter === 'untested' && course.testSetCount > 0) return false;
      if (!needle) return true;
      return (
        course.courseNumber.toLowerCase().includes(needle) ||
        course.title.toLowerCase().includes(needle) ||
        course.collegeName.toLowerCase().includes(needle) ||
        course.departmentCode.toLowerCase().includes(needle) ||
        course.departmentName.toLowerCase().includes(needle)
      );
    });
  }, [courses, query, filter]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-0 flex-1">
          <Search className="text-muted-foreground pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Filter by course, title, department or university…"
            className="h-9 pl-9"
          />
        </div>
        {(['all', 'tested', 'untested'] as Filter[]).map((value) => (
          <Button
            key={value}
            size="sm"
            variant={filter === value ? 'secondary' : 'ghost'}
            onClick={() => setFilter(value)}
            className="capitalize"
          >
            {value}
          </Button>
        ))}
        <Badge variant="outline" className="h-7 tabular-nums">
          {rows.length}
        </Badge>
      </div>

      <div className="overflow-x-auto rounded-xl border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-[8rem]">Course</TableHead>
              <TableHead>Title</TableHead>
              <TableHead>University</TableHead>
              <TableHead>Department</TableHead>
              <TableHead>Level</TableHead>
              <TableHead className="text-right">Tests</TableHead>
              <TableHead className="text-right">Taken</TableHead>
              <TableHead className="text-right">AI cost</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.slice(0, 500).map((course) => (
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
                  <Badge className={`border-0 text-[11px] ${LEVEL_STYLES[course.level]}`}>
                    {course.level}
                  </Badge>
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
            ))}
          </TableBody>
        </Table>
      </div>

      {rows.length > 500 ? (
        <p className="text-muted-foreground text-xs">
          Showing the first 500 of {rows.length.toLocaleString()} matches — narrow the filter to see
          more.
        </p>
      ) : null}

      <p className="text-muted-foreground text-xs">
        Level is derived from the course number (catalogs don&apos;t publish a course &ldquo;type&rdquo;),
        using the standard US convention where the leading digit marks class standing. Tests shows
        complete / total generated sets; tests are shared, so any of them is usable by every student.
      </p>
    </div>
  );
}
