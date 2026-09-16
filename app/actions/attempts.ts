'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';

import { gradeAnswer } from '@/lib/grading';
import { createAdminClient } from '@/lib/supabase/admin';
import { getUser } from '@/lib/supabase/server';
import type { Attempt, Question } from '@/lib/supabase/types';
import { SubmitAttemptSchema } from '@/lib/validation/schemas';

const StartSchema = z.object({ testSetId: z.string().uuid() });

export interface StartAttemptResult {
  ok: boolean;
  attemptId?: string;
  error?: string;
}

/** Opens a new attempt against a completed test set the user owns. */
export async function startAttempt(input: { testSetId: string }): Promise<StartAttemptResult> {
  const parsed = StartSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: 'Invalid test set.' };

  const user = await getUser();
  if (!user) return { ok: false, error: 'Sign in to take tests.' };

  const admin = createAdminClient();

  const { data: testSet } = await admin
    .from('test_sets')
    .select('id, user_id, question_count')
    .eq('id', parsed.data.testSetId)
    .maybeSingle();

  if (!testSet) return { ok: false, error: 'That test set no longer exists.' };
  const row = testSet as { id: string; user_id: string; question_count: number };
  // Test sets are a shared library — anyone signed in may take one. The attempt
  // and its answers still belong to whoever took it.
  if (row.question_count === 0) return { ok: false, error: 'This test set has no questions yet.' };

  const { data, error } = await admin
    .from('attempts')
    .insert({
      test_set_id: row.id,
      user_id: user.id,
      total_questions: row.question_count,
    })
    .select()
    .single();

  if (error || !data) return { ok: false, error: error?.message ?? 'Could not start the attempt.' };
  return { ok: true, attemptId: (data as Attempt).id };
}

export interface SubmitAttemptResult {
  ok: boolean;
  score?: number;
  total?: number;
  error?: string;
}

/**
 * Grades and stores an attempt. Grading happens server-side against the stored
 * correct answers — the client never sees them before submission.
 */
export async function submitAttempt(input: {
  attemptId: string;
  answers: Array<{ questionId: string; answer: string | null; flagged: boolean }>;
}): Promise<SubmitAttemptResult> {
  const parsed = SubmitAttemptSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: 'Invalid submission.' };

  const user = await getUser();
  if (!user) return { ok: false, error: 'Sign in to submit.' };

  const admin = createAdminClient();

  const { data: attempt } = await admin
    .from('attempts')
    .select('id, user_id, test_set_id, submitted_at')
    .eq('id', parsed.data.attemptId)
    .maybeSingle();

  if (!attempt) return { ok: false, error: 'That attempt no longer exists.' };
  const attemptRow = attempt as Pick<Attempt, 'id' | 'user_id' | 'test_set_id' | 'submitted_at'>;
  if (attemptRow.user_id !== user.id) return { ok: false, error: 'That attempt belongs to someone else.' };
  if (attemptRow.submitted_at) return { ok: false, error: 'This attempt was already submitted.' };

  const { data: questions } = await admin
    .from('questions')
    .select('id, type, correct_answer')
    .eq('test_set_id', attemptRow.test_set_id);

  const answerKey = new Map(
    (questions ?? []).map((q) => {
      const row = q as Pick<Question, 'id' | 'type' | 'correct_answer'>;
      return [row.id, row];
    }),
  );

  let score = 0;
  const rows = parsed.data.answers
    .filter((a) => answerKey.has(a.questionId))
    .map((a) => {
      const question = answerKey.get(a.questionId)!;
      const isCorrect = gradeAnswer(question.type, question.correct_answer, a.answer);
      if (isCorrect) score++;
      return {
        attempt_id: attemptRow.id,
        question_id: a.questionId,
        answer: a.answer,
        is_correct: isCorrect,
        flagged: a.flagged,
      };
    });

  if (rows.length) {
    const { error } = await admin
      .from('attempt_answers')
      .upsert(rows, { onConflict: 'attempt_id,question_id' });
    if (error) return { ok: false, error: error.message };
  }

  const total = answerKey.size;
  await admin
    .from('attempts')
    .update({ submitted_at: new Date().toISOString(), score, total_questions: total })
    .eq('id', attemptRow.id);

  revalidatePath(`/test/${attemptRow.test_set_id}`);
  return { ok: true, score, total };
}
