import {
  BookMarked,
  CalendarDays,
  FileText,
  GraduationCap,
  ListChecks,
  Sparkles,
  Users,
} from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';

import { CourseBuilder } from '@/components/course/course-builder';
import { FavoriteToggle } from '@/components/favorite-toggle';
import { SectionList } from '@/components/course/section-list';
import { TextbookTable } from '@/components/course/textbook-table';
import { Breadcrumbs } from '@/components/layout/breadcrumbs';
import { EmptyState } from '@/components/layout/empty-state';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { isAiConfigured } from '@/lib/ai/models';
import {
  getCourseContext,
  getFavoriteIds,
  listSections,
  listTestSetsForCourse,
  listTextbooks,
} from '@/lib/db/queries';
import { getUser } from '@/lib/supabase/server';
import type { SectionSource } from '@/lib/supabase/types';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ courseId: string }>;
}): Promise<Metadata> {
  const { courseId } = await params;
  const context = await getCourseContext(courseId);
  return {
    title: context ? `${context.course.course_number} — ${context.course.title}` : 'Course',
  };
}

export default async function CoursePage({ params }: { params: Promise<{ courseId: string }> }) {
  const { courseId } = await params;

  const context = await getCourseContext(courseId);
  if (!context) notFound();

  const { course, department, college } = context;
  const user = await getUser();
  const [textbooks, sections, testSets, favorites] = await Promise.all([
    listTextbooks(courseId),
    listSections(courseId),
    listTestSetsForCourse(courseId),
    getFavoriteIds(user?.id ?? null),
  ]);

  // Anything missing means the profile hasn't been built for this course yet.
  const needsBuild = !course.detail_scraped_at || sections.length === 0;
  const aiEnabled = isAiConfigured();

  return (
    <div className="mx-auto w-full max-w-4xl px-4 py-10">
      <Breadcrumbs
        items={[
          { label: 'Colleges', href: '/' },
          { label: college.name, href: `/college/${college.id}` },
          { label: department.code, href: `/college/${college.id}/dept/${department.id}` },
          { label: course.course_number },
        ]}
      />

      {/* 1 — Header */}
      <header className="mb-8">
        <p className="text-muted-foreground text-sm">
          {college.name} · {department.name}
        </p>

        <div className="mt-2 flex items-start gap-3">
          <h1 className="min-w-0 flex-1 text-3xl font-semibold">
            <span className="text-muted-foreground font-mono text-2xl">{course.course_number}</span>{' '}
            {course.title}
          </h1>
          <FavoriteToggle
            target={{ courseId }}
            initialFavorited={favorites.courseIds.has(courseId)}
            signedIn={Boolean(user)}
            label={`${course.course_number} ${course.title}`}
            className="mt-1.5"
          />
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-2">
          {course.credits ? (
            <Badge variant="secondary" className="gap-1.5">
              <GraduationCap className="size-3" />
              {course.credits}
            </Badge>
          ) : null}
          {course.terms_offered ? (
            <Badge variant="secondary" className="gap-1.5">
              <CalendarDays className="size-3" />
              {course.terms_offered}
            </Badge>
          ) : null}
          {course.instructors?.length ? (
            <Badge variant="secondary" className="gap-1.5">
              <Users className="size-3" />
              {course.instructors.slice(0, 3).join(', ')}
              {course.instructors.length > 3 ? ` +${course.instructors.length - 3}` : ''}
            </Badge>
          ) : null}
        </div>

        {course.prerequisites ? (
          <p className="text-muted-foreground mt-4 text-sm">
            <span className="text-foreground font-medium">Prerequisites:</span>{' '}
            {course.prerequisites}
          </p>
        ) : null}
      </header>

      <div className="space-y-6">
        {needsBuild ? (
          <Card>
            <CardContent className="py-5">
              <CourseBuilder courseId={courseId} autoStart label="Build this course profile" />
            </CardContent>
          </Card>
        ) : null}

        {/* 2 — Description */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <FileText className="text-muted-foreground size-4" />
              Description
            </CardTitle>
          </CardHeader>
          <CardContent>
            {course.description ? (
              <p className="text-sm leading-relaxed">{course.description}</p>
            ) : (
              <p className="text-muted-foreground text-sm">
                The catalog didn&apos;t include a description for this course.
              </p>
            )}
            {course.source_url ? (
              <p className="text-muted-foreground mt-4 text-xs">
                From{' '}
                <a
                  href={course.source_url}
                  target="_blank"
                  rel="noreferrer noopener"
                  className="hover:text-foreground underline underline-offset-2"
                >
                  the official catalog
                </a>
              </p>
            ) : null}
          </CardContent>
        </Card>

        {/* 3 — AI summary */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Sparkles className="text-muted-foreground size-4" />
              AI summary
            </CardTitle>
          </CardHeader>
          <CardContent>
            {course.ai_summary ? (
              <div className="space-y-3">
                {course.ai_summary.split(/\n\s*\n/).map((paragraph, i) => (
                  <p key={i} className="text-sm leading-relaxed">
                    {paragraph}
                  </p>
                ))}
              </div>
            ) : (
              <p className="text-muted-foreground text-sm">
                {aiEnabled
                  ? 'No summary yet — rebuild the profile to generate one.'
                  : 'Set AI_GATEWAY_API_KEY to generate course summaries.'}
              </p>
            )}
          </CardContent>
        </Card>

        {/* 4 — Textbooks */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <BookMarked className="text-muted-foreground size-4" />
              Textbooks
            </CardTitle>
          </CardHeader>
          <CardContent>
            <TextbookTable textbooks={textbooks} />
          </CardContent>
        </Card>

        {/* 5 — Syllabus */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <FileText className="text-muted-foreground size-4" />
              Syllabus
            </CardTitle>
          </CardHeader>
          <CardContent>
            {course.syllabus_url ? (
              <a
                href={course.syllabus_url}
                target="_blank"
                rel="noreferrer noopener"
                className="text-primary text-sm underline underline-offset-2"
              >
                {course.syllabus_url}
              </a>
            ) : (
              <p className="text-muted-foreground text-sm">
                No syllabus was linked from the catalog. The section outline below is built from the
                textbook contents and course description instead.
              </p>
            )}
          </CardContent>
        </Card>

        {/* 6 — Sections + test creation */}
        <Card>
          <CardHeader className="flex-row items-center justify-between gap-3">
            <CardTitle className="flex items-center gap-2 text-base">
              <ListChecks className="text-muted-foreground size-4" />
              Sections &amp; chapters
            </CardTitle>
            {testSets.length ? (
              <Button size="sm" variant="outline" nativeButton={false} render={<Link href={`/course/${courseId}/tests`} />}>
                Test dashboard
              </Button>
            ) : null}
          </CardHeader>
          <CardContent>
            {sections.length ? (
              <SectionList
                sections={sections}
                sectionSource={(sections[0]?.source as SectionSource | undefined) ?? null}
                existingSets={testSets}
                signedIn={Boolean(user)}
                aiEnabled={aiEnabled}
              />
            ) : (
              <EmptyState
                icon={ListChecks}
                title="No sections derived yet"
                description={
                  aiEnabled
                    ? 'We build the section outline from the textbook contents, the syllabus, or the course description.'
                    : 'Section derivation needs AI. Set AI_GATEWAY_API_KEY to enable it.'
                }
                action={<CourseBuilder courseId={courseId} autoStart={false} label="Derive sections" />}
              />
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
