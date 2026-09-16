import { AlertCircle } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';

import { Breadcrumbs } from '@/components/layout/breadcrumbs';
import { EmptyState } from '@/components/layout/empty-state';
import { Quiz } from '@/components/test/quiz';
import { ScoreReport, type GradedQuestion } from '@/components/test/score-report';
import { Button } from '@/components/ui/button';
import { createAdminClient } from '@/lib/supabase/admin';
import { getUser } from '@/lib/supabase/server';
import type { Attempt, AttemptAnswer, Course, CourseSection, Question, TestSet } from '@/lib/supabase/types';
import { getCourseContext, listQuestions } from '@/lib/db/queries';

export const metadata: Metadata = { title: 'Take test' };

export default async function TestPage({
  params,
  searchParams,
}: {
  params: Promise<{ testSetId: string }>;
  searchParams: Promise<{ attempt?: string; review?: string }>;
}) {
  const { testSetId } = await params;
  const { attempt: attemptParam, review } = await searchParams;

  const user = await getUser();
  if (!user) redirect(`/auth/login?next=${encodeURIComponent(`/test/${testSetId}`)}`);

  const admin = createAdminClient();
  const { data: setRow } = await admin
    .from('test_sets')
    .select('*, course_sections!inner(*, courses!inner(id))')
    .eq('id', testSetId)
    .maybeSingle();

  if (!setRow) notFound();

  // Shared library: any signed-in user can open any generated test.
  const testSet = setRow as TestSet & {
    course_sections: CourseSection & { courses: Pick<Course, 'id'> };
  };

  const section = testSet.course_sections;
  const context = await getCourseContext(section.courses.id);
  if (!context) notFound();

  const { course, department, college } = context;
  const questions = await listQuestions(testSetId);

  const crumbs = [
    { label: 'Colleges', href: '/' },
    { label: college.name, href: `/college/${college.id}` },
    { label: department.code, href: `/college/${college.id}/dept/${department.id}` },
    { label: course.course_number, href: `/course/${course.id}` },
    { label: 'Tests', href: `/course/${course.id}/tests` },
    { label: section.title },
  ];

  const courseLabel = `${course.course_number} — ${course.title}`;

  if (!questions.length) {
    return (
      <div className="mx-auto w-full max-w-3xl px-4 py-10">
        <Breadcrumbs items={crumbs} />
        <EmptyState
          icon={AlertCircle}
          title="This test has no questions yet"
          description={
            testSet.status === 'generating'
              ? 'Generation is still running. The dashboard shows live progress.'
              : 'Generation did not produce any questions. You can retry it from the dashboard.'
          }
          action={
            <Button nativeButton={false} render={<Link href={`/course/${course.id}/tests`} />}>Go to the dashboard</Button>
          }
        />
      </div>
    );
  }

  // Review mode: show the most recent submitted attempt instead of a fresh quiz.
  if (review) {
    const graded = await loadLatestAttempt(testSetId, user.id, questions);

    return (
      <div className="mx-auto w-full max-w-4xl px-4 py-10">
        <Breadcrumbs items={crumbs} />
        <h1 className="mb-6 text-2xl font-semibold">Review · {section.title}</h1>

        {graded ? (
          <ScoreReport
            graded={graded.rows}
            score={graded.score}
            total={graded.total}
            courseLabel={courseLabel}
            sectionTitle={section.title}
          />
        ) : (
          <EmptyState
            icon={AlertCircle}
            title="You haven't taken this test yet"
            description="Take it once and your answers will show up here."
            action={
              <Button nativeButton={false} render={<Link href={`/course/${course.id}/tests`} />}>Back to the dashboard</Button>
            }
          />
        )}
      </div>
    );
  }

  // Only accept an attempt id that actually belongs to this user and test set.
  let attemptId: string | null = null;
  if (attemptParam) {
    const { data } = await admin
      .from('attempts')
      .select('id, user_id, test_set_id, submitted_at')
      .eq('id', attemptParam)
      .maybeSingle();

    const row = data as Pick<Attempt, 'id' | 'user_id' | 'test_set_id' | 'submitted_at'> | null;
    if (row && row.user_id === user.id && row.test_set_id === testSetId && !row.submitted_at) {
      attemptId = row.id;
    }
  }

  if (!attemptId) {
    const { data } = await admin
      .from('attempts')
      .insert({ test_set_id: testSetId, user_id: user.id, total_questions: questions.length })
      .select('id')
      .single();
    attemptId = (data as { id: string } | null)?.id ?? null;
  }

  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-10">
      <Breadcrumbs items={crumbs} />

      <header className="mb-6">
        <h1 className="text-2xl font-semibold">{section.title}</h1>
        <p className="text-muted-foreground mt-1 text-sm">{courseLabel}</p>
      </header>

      <Quiz
        testSetId={testSetId}
        attemptId={attemptId}
        questions={questions}
        courseLabel={courseLabel}
        sectionTitle={section.title}
      />
    </div>
  );
}

/** Rebuilds the graded view for the user's most recent submitted attempt. */
async function loadLatestAttempt(
  testSetId: string,
  userId: string,
  questions: Question[],
): Promise<{ rows: GradedQuestion[]; score: number; total: number } | null> {
  const admin = createAdminClient();

  const { data: attemptRow } = await admin
    .from('attempts')
    .select('*')
    .eq('test_set_id', testSetId)
    .eq('user_id', userId)
    .not('submitted_at', 'is', null)
    .order('submitted_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!attemptRow) return null;
  const attempt = attemptRow as Attempt;

  const { data: answerRows } = await admin
    .from('attempt_answers')
    .select('*')
    .eq('attempt_id', attempt.id);

  const answers = new Map(
    ((answerRows ?? []) as AttemptAnswer[]).map((a) => [a.question_id, a]),
  );

  const rows: GradedQuestion[] = questions.map((question) => {
    const answer = answers.get(question.id);
    return {
      question,
      given: answer?.answer ?? null,
      correct: answer?.is_correct ?? false,
      flagged: answer?.flagged ?? false,
    };
  });

  return {
    rows,
    score: attempt.score ?? rows.filter((r) => r.correct).length,
    total: attempt.total_questions || questions.length,
  };
}
