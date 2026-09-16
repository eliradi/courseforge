import 'server-only';

import { generateObject } from 'ai';

import { createAdminClient } from '@/lib/supabase/admin';
import type { Course, CourseSection, Textbook } from '@/lib/supabase/types';
import { QuestionSchema, questionBatchSchema, type QuestionInput } from '@/lib/validation/schemas';
import { DuplicateFilter } from './dedupe';
import { GENERATION_SETTINGS, PRIMARY_MODEL, assertAiConfigured } from './models';
import { readUsage, recordUsage, withUsageContext } from './usage';
import { recordOperationRun, scopeForTestSet } from '@/lib/db/operation-runs';
import {
  buildBatchPlans,
  buildQuestionPrompt,
  QUESTION_SYSTEM_PROMPT,
  type BatchPlan,
} from './prompts';

export const TARGET_QUESTIONS = 100;
export const BATCH_SIZE = 25;
const MAX_BATCH_ATTEMPTS = 3; // the initial call plus two retries
const TOP_UP_ATTEMPTS = 3;

export interface GenerationContext {
  testSetId: string;
  /** Who is paying for this run, for the admin cost ledger. */
  userId?: string | null;
  courseId?: string | null;
  collegeId?: string | null;
  college: string;
  course: Pick<Course, 'course_number' | 'title' | 'description' | 'ai_summary' | 'raw_scraped_content'>;
  section: Pick<CourseSection, 'title' | 'topics'>;
  textbook?: Pick<Textbook, 'title'> | null;
}

export interface GenerationOutcome {
  status: 'complete' | 'failed';
  generated: number;
  error?: string;
}

/**
 * Generates a full test set in batches, persisting after each one so the UI's
 * progress bar advances and a failure never loses completed work.
 *
 * Resumable: pass a test set that already has questions and it fills only the
 * remaining batches, continuing the position numbering.
 */
export async function generateTestSet(ctx: GenerationContext): Promise<GenerationOutcome> {
  assertAiConfigured();
  const startedAt = new Date();

  // Derive anything the caller didn't supply, so a run is always attributable.
  const derived =
    ctx.collegeId && ctx.courseId
      ? { collegeId: ctx.collegeId, courseId: ctx.courseId }
      : await scopeForTestSet(ctx.testSetId);

  return withUsageContext(
    {
      userId: ctx.userId ?? null,
      courseId: ctx.courseId ?? derived.courseId,
      collegeId: ctx.collegeId ?? derived.collegeId,
      testSetId: ctx.testSetId,
    },
    async () => {
      const outcome = await generateTestSetInner(ctx);
      await recordOperationRun({
        kind: 'test_generation',
        scope: {
          collegeId: ctx.collegeId ?? derived.collegeId,
          courseId: ctx.courseId ?? derived.courseId,
          testSetId: ctx.testSetId,
          userId: ctx.userId ?? null,
        },
        startedAt,
        ok: outcome.status === 'complete',
        summary: `${outcome.generated} questions · ${outcome.status}`,
      });
      return outcome;
    },
  );
}

async function generateTestSetInner(ctx: GenerationContext): Promise<GenerationOutcome> {
  const admin = createAdminClient();

  // Existing questions let us resume, and seed the duplicate filter.
  const { data: existing } = await admin
    .from('questions')
    .select('position, question, type, difficulty')
    .eq('test_set_id', ctx.testSetId)
    .order('position');

  const alreadyHave = existing?.length ?? 0;
  if (alreadyHave >= TARGET_QUESTIONS) {
    await admin
      .from('test_sets')
      .update({ status: 'complete', question_count: alreadyHave, error: null })
      .eq('id', ctx.testSetId);
    return { status: 'complete', generated: alreadyHave };
  }

  const duplicates = new DuplicateFilter((existing ?? []).map((q) => q.question));
  const stems = (existing ?? []).map((q) => q.question.slice(0, 80));

  // Running tally across the whole set, so the top-up pass can close whatever
  // gap the per-batch runs left behind.
  const tally: Array<Pick<QuestionInput, 'type' | 'difficulty'>> = (existing ?? []).map((q) => ({
    type: q.type as QuestionInput['type'],
    difficulty: q.difficulty as QuestionInput['difficulty'],
  }));

  const plans = buildBatchPlans(TARGET_QUESTIONS, BATCH_SIZE);
  let position = alreadyHave;

  await admin
    .from('test_sets')
    .update({ status: 'generating', model_used: PRIMARY_MODEL, error: null })
    .eq('id', ctx.testSetId);

  for (const plan of plans) {
    // Skip batches already satisfied by a previous run.
    if (position >= (plan.index + 1) * BATCH_SIZE) continue;

    const needed = Math.min(plan.count, TARGET_QUESTIONS - position);
    if (needed <= 0) break;

    const accepted: QuestionInput[] = [];
    let lastError: string | null = null;

    for (let attempt = 1; attempt <= MAX_BATCH_ATTEMPTS && accepted.length < needed; attempt++) {
      // Questions get discarded (invalid MCQ, duplicate stem), so each retry
      // asks only for what this batch is still missing — by type and difficulty,
      // not just by count. Without this the set drifts towards whichever type
      // the model happens to emit first and the 70/15/15 mix is lost.
      const shortfall = remainingPlan(plan, accepted, needed);
      const isFinalAttempt = attempt === MAX_BATCH_ATTEMPTS;

      try {
        const batch = await generateBatch(ctx, shortfall, plans.length, stems);

        for (const question of batch) {
          if (accepted.length >= needed) break;
          if (duplicates.isDuplicate(question.question)) continue;
          // Hold the quota except on the last attempt, where filling the batch
          // matters more than hitting the mix exactly.
          if (!isFinalAttempt && !fitsQuota(question, plan, accepted)) continue;

          duplicates.accept(question.question);
          stems.push(question.question.slice(0, 80));
          accepted.push(question);
        }
      } catch (error) {
        lastError = error instanceof Error ? error.message : String(error);
        console.error(`[ai] batch ${plan.index} attempt ${attempt} failed:`, lastError);
      }

      if (accepted.length < needed && attempt < MAX_BATCH_ATTEMPTS) {
        await new Promise((r) => setTimeout(r, 1000 * attempt));
      }
    }

    if (!accepted.length) {
      // Keep everything generated so far and let the user resume.
      await admin
        .from('test_sets')
        .update({
          status: 'failed',
          question_count: position,
          error: lastError ?? 'The model returned no usable questions for this batch.',
        })
        .eq('id', ctx.testSetId);

      return {
        status: 'failed',
        generated: position,
        error: lastError ?? 'The model returned no usable questions for this batch.',
      };
    }

    const rows = accepted.map((q, i) => ({
      test_set_id: ctx.testSetId,
      position: position + i,
      type: q.type,
      difficulty: q.difficulty,
      question: q.question,
      options: q.type === 'mcq' ? (q.options ?? null) : null,
      correct_answer: q.correct_answer,
      explanation: q.explanation ?? null,
      topic: q.topic,
    }));

    const { error: insertError } = await admin.from('questions').insert(rows);
    if (insertError) {
      await admin
        .from('test_sets')
        .update({ status: 'failed', question_count: position, error: insertError.message })
        .eq('id', ctx.testSetId);
      return { status: 'failed', generated: position, error: insertError.message };
    }

    position += accepted.length;
    tally.push(...accepted.map((q) => ({ type: q.type, difficulty: q.difficulty })));

    // Advance the progress bar after every batch.
    await admin.from('test_sets').update({ question_count: position }).eq('id', ctx.testSetId);
  }

  // ---- top-up -------------------------------------------------------------
  // A batch can come up a question or two short when the model repeats itself.
  // Rather than call the whole set failed, ask for exactly the questions the
  // set is still missing — which also pulls the final mix back onto target.
  for (let attempt = 1; attempt <= TOP_UP_ATTEMPTS && position < TARGET_QUESTIONS; attempt++) {
    const shortfall = globalShortfall(tally, TARGET_QUESTIONS - position);

    let topUp: QuestionInput[] = [];
    try {
      topUp = await generateBatch(ctx, shortfall, plans.length, stems);
    } catch (error) {
      console.error('[ai] top-up attempt failed:', error instanceof Error ? error.message : error);
      continue;
    }

    const fresh: QuestionInput[] = [];
    for (const question of topUp) {
      if (position + fresh.length >= TARGET_QUESTIONS) break;
      if (duplicates.isDuplicate(question.question)) continue;
      duplicates.accept(question.question);
      stems.push(question.question.slice(0, 80));
      fresh.push(question);
    }

    if (!fresh.length) continue;

    const { error: topUpError } = await admin.from('questions').insert(
      fresh.map((q, i) => ({
        test_set_id: ctx.testSetId,
        position: position + i,
        type: q.type,
        difficulty: q.difficulty,
        question: q.question,
        options: q.type === 'mcq' ? (q.options ?? null) : null,
        correct_answer: q.correct_answer,
        explanation: q.explanation ?? null,
        topic: q.topic,
      })),
    );
    if (topUpError) break;

    position += fresh.length;
    tally.push(...fresh.map((q) => ({ type: q.type, difficulty: q.difficulty })));
    await admin.from('test_sets').update({ question_count: position }).eq('id', ctx.testSetId);
  }

  const complete = position >= TARGET_QUESTIONS;
  await admin
    .from('test_sets')
    .update({
      status: complete ? 'complete' : 'failed',
      question_count: position,
      error: complete ? null : `Only ${position} of ${TARGET_QUESTIONS} questions could be generated.`,
    })
    .eq('id', ctx.testSetId);

  return {
    status: complete ? 'complete' : 'failed',
    generated: position,
    error: complete ? undefined : `Only ${position} of ${TARGET_QUESTIONS} questions could be generated.`,
  };
}

/* ---------------------------------------------------------------- quotas */

function countBy<K extends string>(
  questions: QuestionInput[],
  key: (q: QuestionInput) => K,
): Record<K, number> {
  const out = {} as Record<K, number>;
  for (const question of questions) {
    const k = key(question);
    out[k] = (out[k] ?? 0) + 1;
  }
  return out;
}

/** What this batch still owes, so a retry asks for the gap rather than a fresh full batch. */
function remainingPlan(plan: BatchPlan, accepted: QuestionInput[], needed: number): BatchPlan {
  const haveTypes = countBy(accepted, (q) => q.type);
  const haveDifficulties = countBy(accepted, (q) => q.difficulty);
  const gap = (target: number, have: number | undefined) => Math.max(0, target - (have ?? 0));

  return {
    index: plan.index,
    count: Math.max(1, needed - accepted.length),
    types: {
      mcq: gap(plan.types.mcq, haveTypes.mcq),
      true_false: gap(plan.types.true_false, haveTypes.true_false),
      short_answer: gap(plan.types.short_answer, haveTypes.short_answer),
    },
    difficulties: {
      easy: gap(plan.difficulties.easy, haveDifficulties.easy),
      medium: gap(plan.difficulties.medium, haveDifficulties.medium),
      hard: gap(plan.difficulties.hard, haveDifficulties.hard),
    },
  };
}

/**
 * The set-wide gap against the 70/15/15 and 30/45/25 targets, as a plan the
 * prompt builder can consume. Used by the top-up pass.
 */
function globalShortfall(
  tally: Array<Pick<QuestionInput, 'type' | 'difficulty'>>,
  missing: number,
): BatchPlan {
  const target = buildBatchPlans(TARGET_QUESTIONS, TARGET_QUESTIONS)[0];
  const haveTypes = countBy(tally as QuestionInput[], (q) => q.type);
  const haveDifficulties = countBy(tally as QuestionInput[], (q) => q.difficulty);
  const gap = (t: number, have: number | undefined) => Math.max(0, t - (have ?? 0));

  return {
    index: 0,
    count: missing,
    types: {
      mcq: gap(target.types.mcq, haveTypes.mcq),
      true_false: gap(target.types.true_false, haveTypes.true_false),
      short_answer: gap(target.types.short_answer, haveTypes.short_answer),
    },
    difficulties: {
      easy: gap(target.difficulties.easy, haveDifficulties.easy),
      medium: gap(target.difficulties.medium, haveDifficulties.medium),
      hard: gap(target.difficulties.hard, haveDifficulties.hard),
    },
  };
}

/** True when this batch still has room for the question's type and difficulty. */
function fitsQuota(question: QuestionInput, plan: BatchPlan, accepted: QuestionInput[]): boolean {
  const haveTypes = countBy(accepted, (q) => q.type);
  const haveDifficulties = countBy(accepted, (q) => q.difficulty);

  return (
    (haveTypes[question.type] ?? 0) < plan.types[question.type] &&
    (haveDifficulties[question.difficulty] ?? 0) < plan.difficulties[question.difficulty]
  );
}

/* ------------------------------------------------------------- single batch */

async function generateBatch(
  ctx: GenerationContext,
  plan: BatchPlan,
  totalBatches: number,
  stems: string[],
): Promise<QuestionInput[]> {
  const { object, usage } = await generateObject({
    model: PRIMARY_MODEL,
    schema: questionBatchSchema(plan.count),
    system: QUESTION_SYSTEM_PROMPT,
    prompt: buildQuestionPrompt({
      college: ctx.college,
      courseNumber: ctx.course.course_number,
      courseTitle: ctx.course.title,
      courseDescription: ctx.course.description,
      courseSummary: ctx.course.ai_summary,
      sectionTitle: ctx.section.title,
      sectionTopics: ctx.section.topics,
      syllabusExcerpt: ctx.course.raw_scraped_content?.slice(0, 2000) ?? null,
      textbookTitle: ctx.textbook?.title ?? null,
      plan,
      totalBatches,
      excludeQuestions: stems,
    }),
    ...GENERATION_SETTINGS,
  });

  const { inputTokens, outputTokens } = readUsage(usage);
  await recordUsage({
    operation: 'question_batch',
    model: PRIMARY_MODEL,
    inputTokens,
    outputTokens,
  });

  // The generation schema is permissive so the model gets a clean JSON schema;
  // the strict refinements (MCQ option count, answer membership) are applied here.
  const valid: QuestionInput[] = [];
  for (const raw of object.questions) {
    const parsed = QuestionSchema.safeParse({
      ...raw,
      options: raw.type === 'mcq' ? raw.options : null,
      topic: normalizeTopic(raw.topic, ctx.section.topics),
    });
    if (parsed.success) {
      valid.push(parsed.data);
    } else {
      console.warn('[ai] discarded invalid question:', parsed.error.issues[0]?.message);
    }
  }

  return valid;
}

/** Snaps a returned topic back onto the section's own topic list where possible. */
function normalizeTopic(topic: string | undefined, topics: string[]): string {
  const fallback = topics[0] ?? 'General';
  if (!topic) return fallback;

  const needle = topic.trim().toLowerCase();
  const exact = topics.find((t) => t.toLowerCase() === needle);
  if (exact) return exact;

  const partial = topics.find(
    (t) => t.toLowerCase().includes(needle) || needle.includes(t.toLowerCase()),
  );
  return partial ?? topic.trim();
}
