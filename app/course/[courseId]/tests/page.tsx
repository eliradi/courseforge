import { ListChecks } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';

import { Breadcrumbs } from '@/components/layout/breadcrumbs';
import { EmptyState } from '@/components/layout/empty-state';
import { TestSetCard } from '@/components/test/test-set-card';
import { Button } from '@/components/ui/button';
import { getCourseContext, listSections, listTestSetsForCourse } from '@/lib/db/queries';
import { getUser } from '@/lib/supabase/server';

export const metadata: Metadata = { title: 'Test dashboard' };

export default async function TestsPage({ params }: { params: Promise<{ courseId: string }> }) {
  const { courseId } = await params;

  const user = await getUser();
  if (!user) redirect(`/auth/login?next=${encodeURIComponent(`/course/${courseId}/tests`)}`);

  const context = await getCourseContext(courseId);
  if (!context) notFound();

  const { course, department, college } = context;
  const [sections, testSets] = await Promise.all([
    listSections(courseId),
    listTestSetsForCourse(courseId),
  ]);

  const sectionsById = new Map(sections.map((s) => [s.id, s]));

  // Group by section, in section order, so the dashboard mirrors the course page.
  const grouped = sections
    .map((section) => ({
      section,
      sets: testSets.filter((t) => t.course_section_id === section.id),
    }))
    .filter((group) => group.sets.length > 0);

  const orphaned = testSets.filter((t) => !sectionsById.has(t.course_section_id));

  return (
    <div className="mx-auto w-full max-w-4xl px-4 py-10">
      <Breadcrumbs
        items={[
          { label: 'Colleges', href: '/' },
          { label: college.name, href: `/college/${college.id}` },
          { label: department.code, href: `/college/${college.id}/dept/${department.id}` },
          { label: course.course_number, href: `/course/${courseId}` },
          { label: 'Tests' },
        ]}
      />

      <header className="mb-8">
        <h1 className="text-3xl font-semibold">Test dashboard</h1>
        <p className="text-muted-foreground mt-1.5 text-sm">
          {course.course_number} — {course.title}
        </p>
        <p className="text-muted-foreground mt-1 text-xs">
          Generated tests are shared — anything another student has already generated for a section
          is here for you to take too.
        </p>
      </header>

      {grouped.length || orphaned.length ? (
        <div className="space-y-8">
          {grouped.map(({ section, sets }) => (
            <section key={section.id}>
              <h2 className="text-muted-foreground mb-3 text-xs font-semibold tracking-wide uppercase">
                {section.title}
              </h2>
              <div className="space-y-3">
                {sets.map((testSet) => (
                  <TestSetCard
                    key={testSet.id}
                    testSet={testSet}
                    section={section}
                    courseTitle={course.title}
                    isOwner={testSet.user_id === user.id}
                  />
                ))}
              </div>
            </section>
          ))}

          {orphaned.length ? (
            <section>
              <h2 className="text-muted-foreground mb-3 text-xs font-semibold tracking-wide uppercase">
                Sections no longer in this course
              </h2>
              <div className="space-y-3">
                {orphaned.map((testSet) => (
                  <TestSetCard
                    key={testSet.id}
                    testSet={testSet}
                    section={undefined}
                    courseTitle={course.title}
                    isOwner={testSet.user_id === user.id}
                  />
                ))}
              </div>
            </section>
          ) : null}
        </div>
      ) : (
        <EmptyState
          icon={ListChecks}
          title="No tests yet"
          description="Generate a test from any section on the course page and it will show up here."
          action={
            <Button nativeButton={false} render={<Link href={`/course/${courseId}`} />}>Back to the course</Button>
          }
        />
      )}
    </div>
  );
}
