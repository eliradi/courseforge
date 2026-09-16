'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';

import { TARGET_QUESTIONS } from '@/lib/ai/generate-questions';
import { isAiConfigured } from '@/lib/ai/models';
import { createAdminClient } from '@/lib/supabase/admin';
import { getUser } from '@/lib/supabase/server';
import { DAILY_TEST_SET_CAP, countTestSetsToday, getSection } from '@/lib/db/queries';
import type { TestSet } from '@/lib/supabase/types';

const CreateSchema = z.object({ courseSectionId: z.string().uuid() });

export interface CreateTestSetResult {
  ok: boolean;
  testSetId?: string;
  error?: string;
}

/**
 * Creates the `test_sets` row for a section and hands back its id.
 *
 * Generation itself runs in `/api/test-sets/generate`, which streams batch
 * progress to the browser — a hundred questions takes minutes, which is far
 * longer than a server action should hold a request open.
 */
export async function createTestSet(input: {
  courseSectionId: string;
}): Promise<CreateTestSetResult> {
  const parsed = CreateSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: 'Invalid section.' };

  const user = await getUser();
  if (!user) return { ok: false, error: 'Sign in to generate tests.' };

  if (!isAiConfigured()) {
    return { ok: false, error: 'AI is not configured on this deployment.' };
  }

  const section = await getSection(parsed.data.courseSectionId);
  if (!section) return { ok: false, error: 'That section no longer exists.' };

  const used = await countTestSetsToday(user.id);
  if (used >= DAILY_TEST_SET_CAP) {
    return {
      ok: false,
      error: `You've hit the daily limit of ${DAILY_TEST_SET_CAP} test sets. Try again tomorrow.`,
    };
  }

  const admin = createAdminClient();
  const { data, error } = await admin
    .from('test_sets')
    .insert({
      course_section_id: section.id,
      user_id: user.id,
      status: 'generating',
      question_count: 0,
      target_count: TARGET_QUESTIONS,
    })
    .select()
    .single();

  if (error || !data) return { ok: false, error: error?.message ?? 'Could not create the test set.' };

  revalidatePath(`/course/${section.course_id}/tests`);
  return { ok: true, testSetId: (data as TestSet).id };
}

const IdSchema = z.object({ testSetId: z.string().uuid() });

/** Deletes a test set the signed-in user owns. */
export async function deleteTestSet(input: { testSetId: string }): Promise<{ ok: boolean; error?: string }> {
  const parsed = IdSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: 'Invalid test set.' };

  const user = await getUser();
  if (!user) return { ok: false, error: 'Sign in first.' };

  const admin = createAdminClient();
  const { error } = await admin
    .from('test_sets')
    .delete()
    .eq('id', parsed.data.testSetId)
    .eq('user_id', user.id);

  if (error) return { ok: false, error: error.message };
  return { ok: true };
}
