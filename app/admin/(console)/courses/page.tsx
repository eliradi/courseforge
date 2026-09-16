import { BookOpen } from 'lucide-react';
import type { Metadata } from 'next';

import { CourseTable } from '@/components/admin/course-table';
import { EmptyState } from '@/components/layout/empty-state';
import { listAdminCourses } from '@/lib/db/admin-queries';

export const metadata: Metadata = { title: 'Admin · Courses' };
export const dynamic = 'force-dynamic';

export default async function AdminCoursesPage() {
  const courses = await listAdminCourses();

  if (!courses.length) {
    return (
      <EmptyState
        icon={BookOpen}
        title="No courses retrieved yet"
        description="Trigger a retrieval from the Universities tab to populate the catalog cache."
      />
    );
  }

  return <CourseTable courses={courses} />;
}
