import type { NextRequest } from 'next/server';
import { z } from 'zod';

import { createTestSet } from '@/app/actions/test-sets';
import { generateTestSet, TARGET_QUESTIONS } from '@/lib/ai/generate-questions';
import { isAiConfigured } from '@/lib/ai/models';
import { createAdminClient } from '@/lib/supabase/admin';
import { getUser } from '@/lib/supabase/server';
import { sseResponse } from '@/lib/sse';
import type { Course, CourseSection, TestSet } from '@/lib/supabase/types';

export const runtime = 'nodejs';
export const maxDuration = 800;
export const dynamic = 'force-dynamic';

const BodySchema = z.union([
  z.object({ courseSectionId: z.string().uuid() }),
  // Resuming an existing set after a partial failure.
  z.object({ testSetId: z.string().uuid() }),
]);

/**
 * Runs (or resumes) a test-set generation and streams batch progress.
 *
 * Progress is emitted as "n/100 questions" so the client can drive a progress
 * bar; `test_sets.question_count` is updated after every batch too, so a client
 * that reconnects — or a Realtime subscriber — sees the same numbers.
 */
export async function POST(request: NextRequest) {
  const user = await getUser();
  if (!user) return Response.json({ error: 'Sign in to generate tests.' }, { status: 401 });

  if (!isAiConfigured()) {
    return Response.json(
      { error: 'AI is not configured on this deployment. Set AI_GATEWAY_API_KEY.' },
      { status: 503 },
    );
  }

  const parsed = BodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: 'Invalid request body.' }, { status: 400 });

  const admin = createAdminClient();

  // Resolve (or create) the test set this run belongs to.
  let testSetId: string;
  if ('testSetId' in parsed.data) {
    const { data } = await admin
      .from('test_sets')
      .select('id, user_id')
      .eq('id', parsed.data.testSetId)
      .maybeSingle();

    if (!data) return Response.json({ error: 'That test set no longer exists.' }, { status: 404 });
    // Resuming writes questions into an existing set, so it stays owner-only.
    if ((data as TestSet).user_id !== user.id) {
      return Response.json(
        { error: 'Only the person who started this test set can resume it.' },
        { status: 403 },
      );
    }
    testSetId = (data as TestSet).id;
  } else {
    const created = await createTestSet({ courseSectionId: parsed.data.courseSectionId });
    if (!created.ok || !created.testSetId) {
      return Response.json({ error: created.error ?? 'Could not start generation.' }, { status: 400 });
    }
    testSetId = created.testSetId;
  }

  // Gather everything the prompt needs.
  const { data: setRow } = await admin
    .from('test_sets')
    .select('*, course_sections!inner(*, courses!inner(*, departments!inner(*, colleges!inner(id, name))))')
    .eq('id', testSetId)
    .maybeSingle();

  if (!setRow) return Response.json({ error: 'Test set not found.' }, { status: 404 });

  const row = setRow as TestSet & {
    course_sections: CourseSection & {
      courses: Course & { departments: { colleges: { id: string; name: string } } };
    };
  };
  const section = row.course_sections;
  const course = section.courses;
  const collegeName = course.departments.colleges.name;

  const { data: textbooks } = await admin
    .from('textbooks')
    .select('title, required')
    .eq('course_id', course.id)
    .order('required', { ascending: false })
    .limit(1);

  return sseResponse(async (emit) => {
    emit({ type: 'progress', message: `0/${TARGET_QUESTIONS} questions` });

    // Mirror question_count into the stream after every batch write.
    const poll = setInterval(async () => {
      const { data } = await admin
        .from('test_sets')
        .select('question_count')
        .eq('id', testSetId)
        .maybeSingle();
      const count = (data as { question_count?: number } | null)?.question_count;
      if (typeof count === 'number') {
        emit({ type: 'progress', message: `${count}/${TARGET_QUESTIONS} questions` });
      }
    }, 4000);

    try {
      const outcome = await generateTestSet({
        testSetId,
        userId: user.id,
        courseId: course.id,
        collegeId: course.departments.colleges.id,
        college: collegeName,
        course,
        section,
        textbook: textbooks?.[0] ?? null,
      });

      emit({
        type: 'done',
        payload: { testSetId, status: outcome.status, generated: outcome.generated, error: outcome.error },
      });
    } catch (error) {
      await admin
        .from('test_sets')
        .update({
          status: 'failed',
          error: error instanceof Error ? error.message : 'Generation failed.',
        })
        .eq('id', testSetId);

      emit({
        type: 'error',
        message: error instanceof Error ? error.message : 'Generation failed.',
        recoverable: true,
      });
    } finally {
      clearInterval(poll);
    }
  });
}
