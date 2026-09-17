'use client';

import { CheckCircle2, Flag, RotateCcw, XCircle } from 'lucide-react';
import { useMemo, useState } from 'react';

import { QuestionText } from '@/components/test/question-text';
import { DifficultyChart, TopicChart, type Breakdown } from '@/components/test/score-charts';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import type { Question } from '@/lib/supabase/types';
import { questionOptions } from '@/lib/supabase/types';
import { cn } from '@/lib/utils';

export interface GradedQuestion {
  question: Question;
  given: string | null;
  correct: boolean;
  flagged: boolean;
}

type Filter = 'all' | 'incorrect' | 'flagged';

export function ScoreReport({
  graded,
  score,
  total,
  courseLabel,
  sectionTitle,
  onRetake,
}: {
  graded: GradedQuestion[];
  score: number;
  total: number;
  courseLabel: string;
  sectionTitle: string;
  onRetake?: () => void;
}) {
  const [filter, setFilter] = useState<Filter>('all');

  const percentage = total ? Math.round((score / total) * 100) : 0;

  const byTopic = useMemo(() => groupBy(graded, (g) => g.question.topic ?? 'Untagged'), [graded]);
  const byDifficulty = useMemo(
    () =>
      // Keep the natural easy → hard order rather than alphabetical.
      ['easy', 'medium', 'hard']
        .map((level) => {
          const rows = graded.filter((g) => g.question.difficulty === level);
          return { label: level, correct: rows.filter((r) => r.correct).length, total: rows.length };
        })
        .filter((row) => row.total > 0),
    [graded],
  );

  const visible = graded.filter((g) =>
    filter === 'incorrect' ? !g.correct : filter === 'flagged' ? g.flagged : true,
  );

  return (
    <div className="space-y-6">
      {/* Score headline */}
      <Card>
        <CardContent className="flex flex-wrap items-center gap-6 py-7">
          <div>
            <p className="text-muted-foreground text-xs tracking-wide uppercase">Your score</p>
            <p className="mt-1 text-4xl font-semibold tabular-nums">
              {percentage}
              <span className="text-muted-foreground text-2xl">%</span>
            </p>
            <p className="text-muted-foreground mt-1 text-sm tabular-nums">
              {score} of {total} correct
            </p>
          </div>

          <div className="flex-1" />

          {onRetake ? (
            <Button variant="outline" onClick={onRetake}>
              <RotateCcw className="size-4" />
              Retake
            </Button>
          ) : null}
        </CardContent>
      </Card>

      {/* Analytics */}
      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Accuracy by topic</CardTitle>
          </CardHeader>
          <CardContent>
            <TopicChart data={byTopic} />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Results by difficulty</CardTitle>
          </CardHeader>
          <CardContent>
            <DifficultyChart data={byDifficulty} />
          </CardContent>
        </Card>
      </div>

      {/* Per-question review */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">
            Review · {courseLabel} · {sectionTitle}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <Tabs value={filter} onValueChange={(v) => setFilter(v as Filter)}>
            <TabsList className="mb-4">
              <TabsTrigger value="all">All ({graded.length})</TabsTrigger>
              <TabsTrigger value="incorrect">
                Incorrect ({graded.filter((g) => !g.correct).length})
              </TabsTrigger>
              <TabsTrigger value="flagged">
                Flagged ({graded.filter((g) => g.flagged).length})
              </TabsTrigger>
            </TabsList>

            <TabsContent value={filter} className="space-y-3">
              {visible.length ? (
                visible.map((row) => <ReviewRow key={row.question.id} row={row} />)
              ) : (
                <p className="text-muted-foreground py-8 text-center text-sm">
                  {filter === 'incorrect'
                    ? 'You got every question right.'
                    : 'You didn’t flag any questions.'}
                </p>
              )}
            </TabsContent>
          </Tabs>
        </CardContent>
      </Card>
    </div>
  );
}

function ReviewRow({ row }: { row: GradedQuestion }) {
  const { question, given, correct, flagged } = row;
  const options = questionOptions(question);

  return (
    <div className="print-break rounded-xl border p-4">
      <div className="flex items-start gap-3">
        <span className="mt-0.5 shrink-0">
          {correct ? (
            <CheckCircle2 className="size-4 text-emerald-600 dark:text-emerald-500" />
          ) : (
            <XCircle className="text-destructive size-4" />
          )}
        </span>

        <div className="min-w-0 flex-1">
          <div className="mb-1.5 flex flex-wrap items-center gap-1.5">
            <span className="text-muted-foreground font-mono text-xs tabular-nums">
              #{question.position + 1}
            </span>
            <Badge variant="secondary" className="text-[11px] capitalize">
              {question.difficulty}
            </Badge>
            {question.topic ? (
              <Badge variant="outline" className="text-[11px] font-normal">
                {question.topic}
              </Badge>
            ) : null}
            {flagged ? (
              <Badge variant="outline" className="gap-1 border-amber-500/50 text-[11px] text-amber-700 dark:text-amber-400">
                <Flag className="size-2.5 fill-current" />
                flagged
              </Badge>
            ) : null}
          </div>

          <QuestionText text={question.question} className="text-sm font-medium" />

          {options?.length ? (
            <ul className="mt-2.5 space-y-1">
              {options.map((option) => {
                const isAnswer = option === question.correct_answer;
                const isGiven = option === given;
                return (
                  <li
                    key={option}
                    className={cn(
                      'rounded-md px-2.5 py-1.5 text-sm',
                      isAnswer && 'bg-emerald-500/10 text-emerald-800 dark:text-emerald-300',
                      isGiven && !isAnswer && 'bg-destructive/10 text-destructive',
                      !isAnswer && !isGiven && 'text-muted-foreground',
                    )}
                  >
                    {option}
                    {isAnswer ? <span className="ml-2 text-xs">← correct</span> : null}
                    {isGiven && !isAnswer ? <span className="ml-2 text-xs">← your answer</span> : null}
                  </li>
                );
              })}
            </ul>
          ) : (
            <div className="mt-2.5 space-y-1.5 text-sm">
              <p>
                <span className="text-muted-foreground">Your answer: </span>
                <span className={cn(!correct && 'text-destructive')}>
                  {given || <em className="text-muted-foreground">left blank</em>}
                </span>
              </p>
              <p>
                <span className="text-muted-foreground">Model answer: </span>
                <span className="text-emerald-700 dark:text-emerald-400">
                  {question.correct_answer}
                </span>
              </p>
            </div>
          )}

          {question.explanation ? (
            <p className="text-muted-foreground mt-2.5 text-sm">{question.explanation}</p>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function groupBy(
  graded: GradedQuestion[],
  key: (g: GradedQuestion) => string,
): Breakdown[] {
  const buckets = new Map<string, { correct: number; total: number }>();
  for (const row of graded) {
    const label = key(row);
    const bucket = buckets.get(label) ?? { correct: 0, total: 0 };
    bucket.total++;
    if (row.correct) bucket.correct++;
    buckets.set(label, bucket);
  }
  return [...buckets.entries()]
    .map(([label, value]) => ({ label, ...value }))
    .sort((a, b) => b.total - a.total)
    .slice(0, 12);
}
