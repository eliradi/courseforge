import type { Metadata } from 'next';
import { notFound } from 'next/navigation';

import { CourseList } from '@/components/college/course-list';
import { Breadcrumbs } from '@/components/layout/breadcrumbs';
import { Badge } from '@/components/ui/badge';
import { getCollege, getDepartment, getFavoriteIds, listCourses } from '@/lib/db/queries';
import { getUser } from '@/lib/supabase/server';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ deptId: string }>;
}): Promise<Metadata> {
  const { deptId } = await params;
  const department = await getDepartment(deptId);
  return { title: department ? `${department.code} — ${department.name}` : 'Department' };
}

export default async function DepartmentPage({
  params,
}: {
  params: Promise<{ id: string; deptId: string }>;
}) {
  const { id, deptId } = await params;

  const [college, department] = await Promise.all([getCollege(id), getDepartment(deptId)]);
  if (!college || !department || department.college_id !== college.id) notFound();

  const user = await getUser();
  const [courses, favorites] = await Promise.all([
    listCourses(deptId),
    getFavoriteIds(user?.id ?? null),
  ]);
  // Courses already in the database are used as-is. Only a department that has
  // never been checked is scraped automatically — one we checked and found empty
  // stays that way until someone presses Re-scrape.
  const needsScrape = courses.length === 0 && !department.courses_scraped_at;
  const checkedEmpty = courses.length === 0 && Boolean(department.courses_scraped_at);

  return (
    <div className="mx-auto w-full max-w-5xl px-4 py-10">
      <Breadcrumbs
        items={[
          { label: 'Colleges', href: '/' },
          { label: college.name, href: `/college/${college.id}` },
          { label: department.code },
        ]}
      />

      <header className="mb-8">
        <Badge variant="outline" className="font-mono text-[11px]">
          {department.code}
        </Badge>
        <h1 className="mt-3 text-3xl font-semibold">{department.name}</h1>
        <p className="text-muted-foreground mt-1.5 text-sm">
          {college.name} · pick a course to see its full profile and build practice tests.
        </p>
      </header>

      <CourseList
        department={department}
        initialCourses={courses}
        needsScrape={needsScrape}
        checkedEmpty={checkedEmpty}
        favoriteCourseIds={[...favorites.courseIds]}
        signedIn={Boolean(user)}
      />
    </div>
  );
}
