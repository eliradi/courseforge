import { AlertCircle, Award, History, Minus, Target, TrendingDown, TrendingUp } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';

import { ProgressChart } from '@/components/dashboard/progress-chart';
import { RegenerateButton } from '@/components/dashboard/regenerate-button';
import { RetakeButton } from '@/components/dashboard/retake-button';
import { Breadcrumbs } from '@/components/layout/breadcrumbs';
import { EmptyState } from '@/components/layout/empty-state';
import { ScoreReport } from '@/components/test/score-report';
import { Button } from '@/components/ui/button';
import { loadAttemptReport } from '@/lib/db/attempt-report';
import { getCourseContext, listQuestions } from '@/lib/db/queries';
import { createAdminClient } from '@/lib/supabase/admin';
import { getUser } from '@/lib/supabase/server';
import type { Attempt, CourseSection, TestSet } from '@/lib/supabase/types';
import { cn } from '@/lib/utils';

export const metadata: Metadata = { title: 'Test results' };

/**
 * Everything about one test the user has taken: how each attempt went, how
 * they're trending, and the full per-question analysis of any attempt — with
 * a retake or a freshly generated set one click away.
 */
export default async function TestResultsPage({
  params,
  searchParams,
}: {
  params: Promise<{ testSetId: string }>;
  searchParams: Promise<{ attempt?: string }>;
}) {
  const { testSetId } = await params;
  const { attempt: attemptParam } = await searchParams;

  const user = await getUser();
  if (!user) redirect(`/auth/login?next=${encodeURIComponent(`/test/${testSetId}/results`)}`);

  const admin = createAdminClient();
  const { data: setRow } = await admin
    .from('test_sets')
    .select('*, course_sections!inner(*)')
    .eq('id', testSetId)
    .maybeSingle();
  if (!setRow) notFound();

  const testSet = setRow as TestSet & { course_sections: CourseSection };
  const section = testSet.course_sections;
  const context = await getCourseContext(section.course_id);
  if (!context) notFound();
  const { course, department, college } = context;

  const [questions, { data: attemptRows }] = await Promise.all([
    listQuestions(testSetId),
    admin
      .from('attempts')
      .select('*')
      .eq('test_set_id', testSetId)
      .eq('user_id', user.id)
      .not('submitted_at', 'is', null)
      .order('submitted_at', { ascending: true }),
  ]);

  const attempts = ((attemptRows ?? []) as Attempt[]).map((attempt, index) => {
    const total = attempt.total_questions || questions.length || 1;
    return {
      id: attempt.id,
      number: index + 1,
      submittedAt: attempt.submitted_at as string,
      score: attempt.score ?? 0,
      total,
      percentage: Math.round(((attempt.score ?? 0) / total) * 100),
    };
  });

  const selectedId =
    attempts.find((a) => a.id === attemptParam)?.id ?? attempts[attempts.length - 1]?.id ?? null;
  const report = selectedId
    ? await loadAttemptReport(testSetId, user.id, questions, selectedId)
    : null;

  const crumbs = [
    { label: 'Home', href: '/' },
    { label: course.course_number, href: `/course/${course.id}` },
    { label: section.title, href: `/course/${course.id}/tests` },
    { label: 'Results' },
  ];
  const courseLabel = `${course.course_number} — ${course.title}`;

  const actions = (
    <div className="flex flex-wrap gap-2">
      <RetakeButton testSetId={testSetId} size="default" />
      <RegenerateButton sectionId={section.id} currentCount={questions.length} size="default" />
    </div>
  );

  if (!attempts.length || !report) {
    return (
      <div className="mx-auto w-full max-w-4xl px-4 py-10">
        <Breadcrumbs items={crumbs} />
        <EmptyState
          icon={AlertCircle}
          title="You haven't finished this test yet"
          description="Take it once and your results and analytics will show up here."
          action={
            <Button nativeButton={false} render={<Link href={`/test/${testSetId}`} />}>
              Take the test
            </Button>
          }
        />
      </div>
    );
  }

  const percentages = attempts.map((a) => a.percentage);
  const latest = attempts[attempts.length - 1];
  const best = Math.max(...percentages);
  const average = Math.round(percentages.reduce((a, b) => a + b, 0) / percentages.length);
  const change = attempts.length > 1 ? latest.percentage - attempts[0].percentage : null;

  return (
    <div className="mx-auto w-full max-w-5xl px-4 py-10">
      <Breadcrumbs items={crumbs} />

      <header className="from-primary/[0.07] via-background to-brand-teal/[0.07] mb-6 rounded-3xl border bg-gradient-to-br p-6 shadow-sm sm:p-8">
        <p className="text-brand-teal text-sm font-semibold">
          {college.short_name ?? college.name} · {department.code} · {course.course_number}
        </p>
        <h1 className="mt-1 text-2xl font-semibold tracking-tight sm:text-3xl">{section.title}</h1>
        <p className="text-muted-foreground mt-1">{course.title}</p>

        <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Stat
            icon={Target}
            label="Latest"
            value={`${latest.percentage}%`}
            hint={`${latest.score}/${latest.total} correct`}
          />
          <Stat icon={Award} label="Best" value={`${best}%`} />
          <Stat
            icon={History}
            label="Attempts"
            value={String(attempts.length)}
            hint={`avg ${average}%`}
          />
          <Stat
            icon={change === null ? Minus : change >= 0 ? TrendingUp : TrendingDown}
            label="Change"
            value={change === null ? '—' : `${change > 0 ? '+' : ''}${change} pts`}
            hint={change === null ? 'retake to track progress' : 'since your first attempt'}
            tone={change === null ? undefined : change >= 0 ? 'up' : 'down'}
          />
        </div>

        <div className="mt-6 flex flex-wrap items-center justify-between gap-3">
          {actions}
          <p className="text-muted-foreground text-xs">
            Retake uses the same {questions.length} questions · a new test writes a fresh set
          </p>
        </div>
      </header>

      {attempts.length > 1 ? (
        <section className="bg-card mb-6 rounded-2xl border p-5 shadow-xs">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-base font-semibold">Score across attempts</h2>
            <nav aria-label="Attempts" className="flex flex-wrap gap-1.5">
              {attempts.map((attempt) => (
                <Link
                  key={attempt.id}
                  href={`/test/${testSetId}/results?attempt=${attempt.id}`}
                  scroll={false}
                  aria-current={attempt.id === selectedId ? 'true' : undefined}
                  className={cn(
                    'rounded-full border px-2.5 py-1 text-xs tabular-nums transition-colors',
                    attempt.id === selectedId
                      ? 'bg-primary text-primary-foreground border-primary'
                      : 'hover:bg-muted',
                  )}
                >
                  #{attempt.number} · {attempt.percentage}%
                </Link>
              ))}
            </nav>
          </div>
          <ProgressChart
            points={attempts.map((a) => ({
              date: a.submittedAt,
              percentage: a.percentage,
              label: `Attempt ${a.number}`,
            }))}
          />
        </section>
      ) : null}

      <h2 className="mb-3 text-lg font-semibold">
        {attempts.length > 1
          ? `Attempt ${attempts.find((a) => a.id === selectedId)?.number} analysis`
          : 'Analysis'}
        <span className="text-muted-foreground ml-2 text-sm font-normal">
          {new Date(report.submittedAt).toLocaleString(undefined, {
            dateStyle: 'medium',
            timeStyle: 'short',
          })}
        </span>
      </h2>

      <ScoreReport
        graded={report.rows}
        score={report.score}
        total={report.total}
        courseLabel={courseLabel}
        sectionTitle={section.title}
      />
    </div>
  );
}

function Stat({
  icon: Icon,
  label,
  value,
  hint,
  tone,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: string;
  hint?: string;
  tone?: 'up' | 'down';
}) {
  return (
    <div className="bg-card/80 rounded-2xl border p-4 backdrop-blur-sm">
      <p className="text-muted-foreground flex items-center gap-1.5 text-xs font-medium">
        <Icon className="size-3.5" />
        {label}
      </p>
      <p
        className={cn(
          'mt-1 text-2xl font-semibold tabular-nums',
          tone === 'up' && 'text-emerald-600 dark:text-emerald-400',
          tone === 'down' && 'text-destructive',
        )}
      >
        {value}
      </p>
      {hint ? <p className="text-muted-foreground mt-0.5 text-xs">{hint}</p> : null}
    </div>
  );
}
