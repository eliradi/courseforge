import 'server-only';

import type { GradedQuestion } from '@/components/test/score-report';
import { createAdminClient } from '@/lib/supabase/admin';
import type { Attempt, AttemptAnswer, Question } from '@/lib/supabase/types';

export interface AttemptReport {
  attemptId: string;
  submittedAt: string;
  rows: GradedQuestion[];
  score: number;
  total: number;
}

/**
 * Rebuilds the graded view of one of the user's submitted attempts — the given
 * one, or their most recent. Returns null if there is none, or if the attempt
 * belongs to someone else or another test.
 */
export async function loadAttemptReport(
  testSetId: string,
  userId: string,
  questions: Question[],
  attemptId?: string | null,
): Promise<AttemptReport | null> {
  const admin = createAdminClient();

  let query = admin
    .from('attempts')
    .select('*')
    .eq('test_set_id', testSetId)
    .eq('user_id', userId)
    .not('submitted_at', 'is', null);
  query = attemptId
    ? query.eq('id', attemptId)
    : query.order('submitted_at', { ascending: false }).limit(1);

  const { data: attemptRow } = await query.maybeSingle();
  if (!attemptRow) return null;
  const attempt = attemptRow as Attempt;

  const { data: answerRows } = await admin
    .from('attempt_answers')
    .select('*')
    .eq('attempt_id', attempt.id);

  const answers = new Map(((answerRows ?? []) as AttemptAnswer[]).map((a) => [a.question_id, a]));

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
    attemptId: attempt.id,
    submittedAt: attempt.submitted_at ?? attempt.started_at,
    rows,
    score: attempt.score ?? rows.filter((r) => r.correct).length,
    total: attempt.total_questions || questions.length,
  };
}
