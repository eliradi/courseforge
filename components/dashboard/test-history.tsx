import {
  ArrowRight,
  Award,
  CalendarDays,
  ClipboardCheck,
  Gauge,
  History,
  Minus,
  TrendingDown,
  TrendingUp,
} from 'lucide-react';
import Link from 'next/link';

import { ProgressChart } from '@/components/dashboard/progress-chart';
import { RegenerateButton } from '@/components/dashboard/regenerate-button';
import { RetakeButton } from '@/components/dashboard/retake-button';
import type { TestHistory, TestHistoryEntry } from '@/lib/db/queries';
import { cn } from '@/lib/utils';

/** Tests beyond this many sit behind a "show more" toggle. */
const VISIBLE_TESTS = 6;

/**
 * The signed-in user's finished tests: a results summary, how they're
 * trending, and a card per test that opens its full analytics.
 */
export function TestHistorySection({ history }: { history: TestHistory }) {
  if (!history.entries.length) return null;

  const { totals, entries } = history;
  const visible = entries.slice(0, VISIBLE_TESTS);
  const hidden = entries.slice(VISIBLE_TESTS);

  return (
    <section className="from-brand-teal/[0.07] via-background to-primary/[0.06] mb-14 rounded-3xl border bg-gradient-to-br p-5 text-left shadow-sm sm:p-7">
      <header className="mb-6 flex items-center gap-3">
        <span className="from-brand-teal to-primary flex size-10 items-center justify-center rounded-2xl bg-gradient-to-br shadow-sm">
          <ClipboardCheck className="size-5 text-white" />
        </span>
        <div>
          <h2 className="text-xl font-semibold tracking-tight">Your tests</h2>
          <p className="text-muted-foreground text-sm">
            {totals.distinctTests} {totals.distinctTests === 1 ? 'test' : 'tests'} ·{' '}
            {totals.attemptsTaken} {totals.attemptsTaken === 1 ? 'attempt' : 'attempts'} · open one
            for the full breakdown
          </p>
        </div>
      </header>

      <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Summary icon={History} label="Attempts" value={String(totals.attemptsTaken)} />
        <Summary
          icon={Gauge}
          label="Average score"
          value={totals.averagePercentage === null ? '—' : `${totals.averagePercentage}%`}
        />
        <Summary
          icon={Award}
          label="Best score"
          value={totals.bestPercentage === null ? '—' : `${totals.bestPercentage}%`}
        />
        <Summary
          icon={totals.trend === null ? Minus : totals.trend >= 0 ? TrendingUp : TrendingDown}
          label="Trend"
          value={totals.trend === null ? '—' : `${totals.trend > 0 ? '+' : ''}${totals.trend} pts`}
          hint={totals.trend === null ? 'after 4 attempts' : 'recent vs. first tests'}
          tone={totals.trend === null ? undefined : totals.trend >= 0 ? 'up' : 'down'}
        />
      </div>

      {history.timeline.length >= 2 ? (
        <div className="bg-card/80 mb-5 rounded-2xl border p-4 backdrop-blur-sm">
          <h3 className="mb-2 text-sm font-semibold">Progress over time</h3>
          <ProgressChart points={history.timeline} />
        </div>
      ) : null}

      <ul className="grid gap-3 md:grid-cols-2">
        {visible.map((entry) => (
          <li key={entry.testSetId} className="min-w-0">
            <TestCard entry={entry} />
          </li>
        ))}
      </ul>

      {hidden.length ? (
        <details className="group mt-3">
          <summary className="text-primary cursor-pointer list-none text-center text-sm font-medium hover:underline">
            <span className="group-open:hidden">Show {hidden.length} more</span>
            <span className="hidden group-open:inline">Show fewer</span>
          </summary>
          <ul className="mt-3 grid gap-3 md:grid-cols-2">
            {hidden.map((entry) => (
              <li key={entry.testSetId} className="min-w-0">
                <TestCard entry={entry} />
              </li>
            ))}
          </ul>
        </details>
      ) : null}
    </section>
  );
}

function Summary({
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
    <div className="bg-card/80 rounded-2xl border p-3.5 backdrop-blur-sm">
      <p className="text-muted-foreground flex items-center gap-1.5 text-xs font-medium">
        <Icon className="size-3.5" />
        {label}
      </p>
      <p
        className={cn(
          'mt-1 text-2xl font-semibold tracking-tight tabular-nums',
          tone === 'up' && 'text-emerald-600 dark:text-emerald-400',
          tone === 'down' && 'text-destructive',
        )}
      >
        {value}
      </p>
      {hint ? <p className="text-muted-foreground text-[11px]">{hint}</p> : null}
    </div>
  );
}

/** Ring colour follows the grade: strong, fair, or needs work. */
function scoreTone(percentage: number): string {
  if (percentage >= 80) return '#10b981';
  if (percentage >= 60) return 'var(--brand-teal)';
  if (percentage >= 40) return '#f59e0b';
  return '#ef4444';
}

function ScoreRing({ percentage }: { percentage: number }) {
  return (
    <div
      className="relative flex size-16 shrink-0 items-center justify-center rounded-full"
      style={{
        background: `conic-gradient(${scoreTone(percentage)} ${percentage * 3.6}deg, var(--muted) 0deg)`,
      }}
      role="img"
      aria-label={`Latest score ${percentage}%`}
    >
      <div className="bg-card flex size-[52px] flex-col items-center justify-center rounded-full">
        <span className="text-base leading-none font-semibold tabular-nums">{percentage}</span>
        <span className="text-muted-foreground text-[9px] font-medium">%</span>
      </div>
    </div>
  );
}

function TestCard({ entry }: { entry: TestHistoryEntry }) {
  const latest = entry.attempts[0];
  const repeated = entry.attempts.length > 1;
  const resultsHref = `/test/${entry.testSetId}/results`;

  return (
    <div className="group bg-card/80 hover:border-primary/40 relative flex h-full flex-col rounded-2xl border p-4 shadow-xs backdrop-blur-sm transition-all duration-200 hover:-translate-y-0.5 hover:shadow-md">
      <div className="flex items-start gap-4">
        <ScoreRing percentage={entry.latestPercentage} />

        <div className="min-w-0 flex-1">
          <p className="text-muted-foreground flex items-center gap-1.5 truncate text-xs">
            <span className="bg-primary/10 text-primary rounded-md px-1.5 py-0.5 font-mono text-[11px] font-semibold">
              {entry.courseNumber}
            </span>
            <span className="truncate">{entry.collegeName}</span>
          </p>
          <Link
            href={resultsHref}
            className="group-hover:text-primary mt-1 line-clamp-2 text-[15px] leading-snug font-semibold transition-colors after:absolute after:inset-0 after:rounded-2xl"
          >
            {entry.sectionTitle}
          </Link>
          <p className="text-muted-foreground mt-0.5 truncate text-xs">{entry.courseTitle}</p>
        </div>
      </div>

      <div className="text-muted-foreground mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
        <span className="tabular-nums">
          {latest.score}/{latest.total} correct
        </span>
        {repeated ? (
          <>
            <span className="tabular-nums">best {entry.bestPercentage}%</span>
            <span className="tabular-nums">{entry.attempts.length} attempts</span>
            <span
              className={cn(
                'flex items-center gap-0.5 font-medium tabular-nums',
                entry.improvement > 0 && 'text-emerald-600 dark:text-emerald-400',
                entry.improvement < 0 && 'text-destructive',
              )}
            >
              {entry.improvement > 0 ? (
                <TrendingUp className="size-3" />
              ) : entry.improvement < 0 ? (
                <TrendingDown className="size-3" />
              ) : (
                <Minus className="size-3" />
              )}
              {entry.improvement > 0 ? '+' : ''}
              {entry.improvement} pts
            </span>
          </>
        ) : null}
        <span className="flex items-center gap-1">
          <CalendarDays className="size-3" />
          {new Date(latest.submittedAt).toLocaleDateString(undefined, {
            month: 'short',
            day: 'numeric',
          })}
        </span>
      </div>

      {/* Above the stretched link, so the buttons act on their own. */}
      <div className="relative z-10 mt-4 flex flex-wrap items-center gap-2 border-t pt-3">
        <RetakeButton testSetId={entry.testSetId} />
        <RegenerateButton sectionId={entry.sectionId} currentCount={entry.questionCount} />
        <Link
          href={resultsHref}
          className="text-primary ml-auto flex items-center gap-1 text-xs font-medium hover:underline"
        >
          Results
          <ArrowRight className="size-3.5 transition-transform group-hover:translate-x-0.5" />
        </Link>
      </div>
    </div>
  );
}
