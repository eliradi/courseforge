import { BookOpen } from 'lucide-react';
import type { Metadata } from 'next';
import { Suspense } from 'react';

import { CourseTable } from '@/components/admin/course-table';
import { EmptyState } from '@/components/layout/empty-state';
import {
  COURSE_FILTERS,
  COURSE_SORTS,
  listAdminCourses,
  type CourseFilter,
  type CourseSort,
} from '@/lib/db/admin-queries';

export const metadata: Metadata = { title: 'Admin · Courses' };
export const dynamic = 'force-dynamic';

type Params = { q?: string; filter?: string; sort?: string; dir?: string; page?: string };

function pick<T extends string>(value: string | undefined, allowed: readonly T[], fallback: T): T {
  return allowed.includes(value as T) ? (value as T) : fallback;
}

export default async function AdminCoursesPage({ searchParams }: { searchParams: Promise<Params> }) {
  const params = await searchParams;
  const query = (params.q ?? '').slice(0, 120);
  const filter: CourseFilter = pick(params.filter, COURSE_FILTERS, 'all');
  const sort: CourseSort = pick(params.sort, COURSE_SORTS, 'course');
  const desc = params.dir === 'desc';
  const page = Math.max(1, Number.parseInt(params.page ?? '1', 10) || 1);

  const data = await listAdminCourses({ query, filter, sort, desc, page });

  if (!data.total) {
    return (
      <EmptyState
        icon={BookOpen}
        title="No courses retrieved yet"
        description="Trigger a retrieval from the Universities tab to populate the catalog cache."
      />
    );
  }

  return (
    <Suspense>
      <CourseTable data={data} query={query} filter={filter} sort={{ key: sort, desc }} />
    </Suspense>
  );
}
