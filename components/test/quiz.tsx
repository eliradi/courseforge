'use client';

import { ArrowLeft, ArrowRight, Check, Flag, Loader2 } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useMemo, useState } from 'react';
import { toast } from 'sonner';

import { startAttempt, submitAttempt } from '@/app/actions/attempts';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { gradeAnswer } from '@/lib/grading';
import type { Question } from '@/lib/supabase/types';
import { questionOptions } from '@/lib/supabase/types';
import { cn } from '@/lib/utils';
import { QuestionText } from './question-text';
import { ScoreReport, type GradedQuestion } from './score-report';

interface AnswerState {
  answer: string | null;
  flagged: boolean;
}

export function Quiz({
  testSetId,
  attemptId: initialAttemptId,
  questions,
  courseLabel,
  sectionTitle,
}: {
  testSetId: string;
  attemptId: string | null;
  questions: Question[];
  courseLabel: string;
  sectionTitle: string;
}) {
  const router = useRouter();
  const [attemptId, setAttemptId] = useState(initialAttemptId);
  const [index, setIndex] = useState(0);
  const [answers, setAnswers] = useState<Record<string, AnswerState>>({});
  const [submitting, setSubmitting] = useState(false);
  const [graded, setGraded] = useState<GradedQuestion[] | null>(null);
  const [score, setScore] = useState<{ score: number; total: number } | null>(null);

  const current = questions[index];
  const answered = useMemo(
    () => Object.values(answers).filter((a) => a.answer !== null && a.answer !== '').length,
    [answers],
  );

  function setAnswer(questionId: string, answer: string) {
    setAnswers((prev) => ({
      ...prev,
      [questionId]: { answer, flagged: prev[questionId]?.flagged ?? false },
    }));
  }

  function toggleFlag(questionId: string) {
    setAnswers((prev) => ({
      ...prev,
      [questionId]: {
        answer: prev[questionId]?.answer ?? null,
        flagged: !prev[questionId]?.flagged,
      },
    }));
  }

  async function submit() {
    if (!attemptId) {
      toast.error('This attempt has expired. Start the test again.');
      return;
    }

    setSubmitting(true);
    const result = await submitAttempt({
      attemptId,
      answers: questions.map((q) => ({
        questionId: q.id,
        answer: answers[q.id]?.answer ?? null,
        flagged: answers[q.id]?.flagged ?? false,
      })),
    });
    setSubmitting(false);

    if (!result.ok) {
      toast.error(result.error ?? 'Could not submit your answers.');
      return;
    }

    // Grading is authoritative on the server; recompute the same view locally
    // so the report renders without another round trip.
    setGraded(
      questions.map((q) => ({
        question: q,
        given: answers[q.id]?.answer ?? null,
        correct: gradeAnswer(q.type, q.correct_answer, answers[q.id]?.answer ?? null),
        flagged: answers[q.id]?.flagged ?? false,
      })),
    );
    setScore({ score: result.score ?? 0, total: result.total ?? questions.length });
    router.refresh();
  }

  async function retake() {
    const result = await startAttempt({ testSetId });
    if (!result.ok || !result.attemptId) {
      toast.error(result.error ?? 'Could not start a new attempt.');
      return;
    }
    setAttemptId(result.attemptId);
    setAnswers({});
    setIndex(0);
    setGraded(null);
    setScore(null);
  }

  if (graded && score) {
    return (
      <ScoreReport
        graded={graded}
        score={score.score}
        total={score.total}
        courseLabel={courseLabel}
        sectionTitle={sectionTitle}
        onRetake={() => void retake()}
      />
    );
  }

  if (!current) return null;

  const options = questionOptions(current);
  const state = answers[current.id];
  const isLast = index === questions.length - 1;

  return (
    <div className="space-y-5">
      {/* Progress */}
      <div className="space-y-2">
        <div className="text-muted-foreground flex items-center justify-between text-xs tabular-nums">
          <span>
            Question {index + 1} of {questions.length}
          </span>
          <span>{answered} answered</span>
        </div>
        <Progress value={((index + 1) / questions.length) * 100} className="h-1.5" />
      </div>

      <Card>
        <CardContent className="space-y-5 py-6">
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="secondary" className="text-[11px] capitalize">
              {current.difficulty}
            </Badge>
            {current.topic ? (
              <Badge variant="outline" className="text-[11px] font-normal">
                {current.topic}
              </Badge>
            ) : null}
            <div className="flex-1" />
            <Button
              size="sm"
              variant={state?.flagged ? 'secondary' : 'ghost'}
              onClick={() => toggleFlag(current.id)}
            >
              <Flag className={cn('size-3.5', state?.flagged && 'fill-current')} />
              {state?.flagged ? 'Flagged' : 'Flag'}
            </Button>
          </div>

          <h2 className="text-base font-medium">
            <QuestionText text={current.question} />
          </h2>

          {current.type === 'short_answer' ? (
            <Textarea
              value={state?.answer ?? ''}
              onChange={(e) => setAnswer(current.id, e.target.value)}
              placeholder="Answer in one to three sentences…"
              rows={5}
              aria-label="Your answer"
            />
          ) : (
            <RadioGroup
              value={state?.answer ?? ''}
              onValueChange={(value) => setAnswer(current.id, String(value))}
              className="gap-2"
            >
              {(options ?? ['True', 'False']).map((option) => {
                const id = `${current.id}-${option}`;
                const selected = state?.answer === option;
                return (
                  <Label
                    key={option}
                    htmlFor={id}
                    className={cn(
                      'flex cursor-pointer items-start gap-3 rounded-lg border p-3.5 text-sm font-normal transition-colors',
                      selected ? 'border-primary bg-primary/5' : 'hover:bg-muted/50',
                    )}
                  >
                    <RadioGroupItem id={id} value={option} className="mt-0.5" />
                    <span className="leading-relaxed">{option}</span>
                  </Label>
                );
              })}
            </RadioGroup>
          )}
        </CardContent>
      </Card>

      {/* Navigation */}
      <div className="flex items-center gap-2">
        <Button
          variant="outline"
          disabled={index === 0}
          onClick={() => setIndex((i) => Math.max(0, i - 1))}
        >
          <ArrowLeft className="size-4" />
          Previous
        </Button>

        <div className="flex-1" />

        {isLast ? (
          <Button onClick={() => void submit()} disabled={submitting}>
            {submitting ? <Loader2 className="size-4 animate-spin" /> : <Check className="size-4" />}
            Submit test
          </Button>
        ) : (
          <Button onClick={() => setIndex((i) => Math.min(questions.length - 1, i + 1))}>
            Next
            <ArrowRight className="size-4" />
          </Button>
        )}
      </div>

      {/* Question jump grid */}
      <div className="flex flex-wrap gap-1.5">
        {questions.map((question, i) => {
          const s = answers[question.id];
          return (
            <button
              key={question.id}
              type="button"
              onClick={() => setIndex(i)}
              aria-label={`Go to question ${i + 1}`}
              aria-current={i === index}
              className={cn(
                'size-7 rounded-md border text-[11px] font-medium tabular-nums transition-colors',
                i === index && 'border-primary ring-primary/40 ring-2',
                s?.flagged
                  ? 'border-amber-500/60 bg-amber-500/15 text-amber-700 dark:text-amber-400'
                  : s?.answer
                    ? 'bg-primary/10 text-primary border-primary/30'
                    : 'text-muted-foreground hover:bg-muted',
              )}
            >
              {i + 1}
            </button>
          );
        })}
      </div>

      {!isLast && answered === questions.length ? (
        <Button variant="outline" className="w-full" onClick={() => void submit()} disabled={submitting}>
          {submitting ? <Loader2 className="size-4 animate-spin" /> : <Check className="size-4" />}
          Submit — all {questions.length} answered
        </Button>
      ) : null}
    </div>
  );
}
