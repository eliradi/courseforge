import { History, Minus, Plus, TrendingDown, TrendingUp } from 'lucide-react';
import Link from 'next/link';

import { ProgressChart } from '@/components/dashboard/progress-chart';
import { RetakeButton } from '@/components/dashboard/retake-button';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import type { TestHistory, TestHistoryEntry } from '@/lib/db/queries';
import { cn } from '@/lib/utils';

/** The signed-in user's completed tests, their results, and how they're trending. */
export function TestHistorySection({ history }: { history: TestHistory }) {
  if (!history.entries.length) return null;

  const { totals } = history;

  return (
    <section className="mb-14 text-left">
      <h2 className="mb-4 flex items-center gap-2 text-sm font-semibold">
        <History className="text-primary size-4" />
        Your test history
      </h2>

      <div className="mb-5 grid gap-3 sm:grid-cols-4">
        <Summary label="Tests taken" value={String(totals.attemptsTaken)} />
        <Summary label="Different tests" value={String(totals.distinctTests)} />
        <Summary
          label="Average"
          value={totals.averagePercentage === null ? '—' : `${totals.averagePercentage}%`}
        />
        <Summary
          label="Best"
          value={totals.bestPercentage === null ? '—' : `${totals.bestPercentage}%`}
        />
      </div>

      {history.timeline.length >= 2 ? (
        <Card className="mb-5">
          <CardContent className="py-5">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
              <h3 className="text-sm font-medium">Progress over time</h3>
              {totals.trend !== null ? <TrendBadge value={totals.trend} suffix="vs. your first tests" /> : null}
            </div>
            <ProgressChart points={history.timeline} />
          </CardContent>
        </Card>
      ) : null}

      <div className="space-y-3">
        {history.entries.map((entry) => (
          <HistoryRow key={entry.testSetId} entry={entry} />
        ))}
      </div>
    </section>
  );
}

function Summary({ label, value }: { label: string; value: string }) {
  return (
    <Card>
      <CardContent className="py-3.5">
        <p className="text-muted-foreground text-[11px] tracking-wide uppercase">{label}</p>
        <p className="mt-0.5 text-xl font-semibold tabular-nums">{value}</p>
      </CardContent>
    </Card>
  );
}

function TrendBadge({ value, suffix }: { value: number; suffix?: string }) {
  const Icon = value > 0 ? TrendingUp : value < 0 ? TrendingDown : Minus;
  const tone =
    value > 0
      ? 'text-emerald-700 dark:text-emerald-400 border-emerald-500/40'
      : value < 0
        ? 'text-destructive border-destructive/40'
        : 'text-muted-foreground';

  return (
    <Badge variant="outline" className={cn('gap-1 text-[11px] font-normal tabular-nums', tone)}>
      <Icon className="size-3" />
      {value > 0 ? '+' : ''}
      {value} pts
      {suffix ? <span className="text-muted-foreground ml-0.5">{suffix}</span> : null}
    </Badge>
  );
}

function HistoryRow({ entry }: { entry: TestHistoryEntry }) {
  const latest = entry.attempts[0];
  const repeated = entry.attempts.length > 1;

  return (
    <Card>
      <CardContent className="py-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <Link href={`/course/${entry.courseId}`} className="flex flex-wrap items-center gap-2">
              <Badge variant="secondary" className="shrink-0 font-mono text-[11px]">
                {entry.courseNumber}
              </Badge>
              <span className="truncate text-sm font-medium">{entry.sectionTitle}</span>
            </Link>
            <p className="text-muted-foreground mt-1 text-xs">
              {entry.collegeName} · {entry.departmentCode} · {entry.courseTitle}
            </p>
          </div>

          <div className="flex shrink-0 items-center gap-4 text-right">
            <div>
              <p className="text-muted-foreground text-[10px] tracking-wide uppercase">Latest</p>
              <p className="text-lg font-semibold tabular-nums">{entry.latestPercentage}%</p>
              <p className="text-muted-foreground text-[11px] tabular-nums">
                {latest.score}/{latest.total}
              </p>
            </div>
            {repeated ? (
              <div>
                <p className="text-muted-foreground text-[10px] tracking-wide uppercase">Best</p>
                <p className="text-lg font-semibold tabular-nums">{entry.bestPercentage}%</p>
                <p className="text-muted-foreground text-[11px]">
                  {entry.attempts.length} attempts
                </p>
              </div>
            ) : null}
          </div>
        </div>

        {repeated ? (
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <TrendBadge value={entry.improvement} />
            <span className="text-muted-foreground text-[11px]">
              {entry.attempts
                .slice()
                .reverse()
                .map((a) => `${a.percentage}%`)
                .join(' → ')}
            </span>
          </div>
        ) : null}

        <div className="mt-4 flex flex-wrap items-center gap-2">
          <RetakeButton testSetId={entry.testSetId} />
          <Button
            size="sm"
            variant="outline"
            nativeButton={false}
            render={<Link href={`/test/${entry.testSetId}?review=1`} />}
          >
            Review answers
          </Button>
          <Button
            size="sm"
            variant="ghost"
            nativeButton={false}
            render={<Link href={`/course/${entry.courseId}/tests`} />}
          >
            <Plus className="size-3.5" />
            Take a new one
          </Button>
          <span className="text-muted-foreground ml-auto text-[11px]">
            Last taken {new Date(latest.submittedAt).toLocaleDateString()}
          </span>
        </div>
      </CardContent>
    </Card>
  );
}
