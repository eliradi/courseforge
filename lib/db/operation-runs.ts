import 'server-only';

import { createAdminClient } from '@/lib/supabase/admin';

export type OperationKind =
  | 'catalog_check'
  | 'course_retrieval'
  | 'course_profile'
  | 'test_generation';

export interface OperationScope {
  collegeId?: string | null;
  courseId?: string | null;
  testSetId?: string | null;
  userId?: string | null;
}

/**
 * Records that an operation ran, rolling up whatever it spent on AI.
 *
 * Cost is summed from ai_usage within the run's own window rather than passed
 * in, so a caller can't forget to account for a nested model call. Never throws:
 * bookkeeping must not break the work it measures.
 */
export async function recordOperationRun(args: {
  kind: OperationKind;
  scope: OperationScope;
  startedAt: Date;
  ok: boolean;
  summary?: string;
}): Promise<{ costUsd: number; totalTokens: number }> {
  const startedAtIso = args.startedAt.toISOString();
  const empty = { costUsd: 0, totalTokens: 0 };

  try {
    const admin = createAdminClient();

    // Scope the roll-up as tightly as the run allows: a test-set run should not
    // absorb a concurrent college-wide scrape's cost.
    let query = admin
      .from('ai_usage')
      .select('cost_usd, total_tokens')
      .gte('created_at', startedAtIso);

    if (args.scope.testSetId) query = query.eq('test_set_id', args.scope.testSetId);
    else if (args.scope.courseId) query = query.eq('course_id', args.scope.courseId);
    else if (args.scope.collegeId) query = query.eq('college_id', args.scope.collegeId);

    const { data } = await query;

    const totals = (data ?? []).reduce(
      (acc, row) => ({
        costUsd: acc.costUsd + Number(row.cost_usd ?? 0),
        totalTokens: acc.totalTokens + (row.total_tokens ?? 0),
      }),
      empty,
    );

    await admin.from('operation_runs').insert({
      kind: args.kind,
      college_id: args.scope.collegeId ?? null,
      course_id: args.scope.courseId ?? null,
      test_set_id: args.scope.testSetId ?? null,
      user_id: args.scope.userId ?? null,
      ok: args.ok,
      summary: args.summary ?? null,
      total_tokens: totals.totalTokens,
      cost_usd: totals.costUsd,
      started_at: startedAtIso,
    });

    return totals;
  } catch (error) {
    console.error(
      '[db] could not record operation run:',
      error instanceof Error ? error.message : error,
    );
    return empty;
  }
}

/**
 * Resolves the course and college a test set belongs to.
 *
 * Callers shouldn't have to supply these just so the run is attributable — and
 * when one forgets, the run silently drops out of every per-college view. The
 * test set id is always present, so derive from it.
 */
export async function scopeForTestSet(
  testSetId: string,
): Promise<{ collegeId: string | null; courseId: string | null }> {
  try {
    const admin = createAdminClient();
    const { data } = await admin
      .from('test_sets')
      .select('course_sections!inner(course_id, courses!inner(departments!inner(college_id)))')
      .eq('id', testSetId)
      .maybeSingle();

    const section = (
      data as {
        course_sections?: {
          course_id: string;
          courses: { departments: { college_id: string } };
        };
      } | null
    )?.course_sections;

    return {
      collegeId: section?.courses?.departments?.college_id ?? null,
      courseId: section?.course_id ?? null,
    };
  } catch {
    return { collegeId: null, courseId: null };
  }
}
