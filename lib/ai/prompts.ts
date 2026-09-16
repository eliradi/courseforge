import 'server-only';

import type { Difficulty, QuestionType } from '@/lib/supabase/types';

/* -------------------------------------------------------------- batch plans */

export interface BatchPlan {
  index: number;
  count: number;
  types: Record<QuestionType, number>;
  difficulties: Record<Difficulty, number>;
}

/** Target mix per 100 questions, straight from the spec. */
export const TYPE_MIX: Record<QuestionType, number> = {
  mcq: 0.7,
  true_false: 0.15,
  short_answer: 0.15,
};

export const DIFFICULTY_MIX: Record<Difficulty, number> = {
  easy: 0.3,
  medium: 0.45,
  hard: 0.25,
};

/** Largest-remainder apportionment so the parts always re-sum to `total`. */
function apportion<K extends string>(total: number, weights: Record<K, number>): Record<K, number> {
  const keys = Object.keys(weights) as K[];
  const exact = keys.map((k) => ({ k, value: total * weights[k] }));
  const out = {} as Record<K, number>;

  let assigned = 0;
  for (const { k, value } of exact) {
    out[k] = Math.floor(value);
    assigned += out[k];
  }

  // Hand the leftovers to whichever keys were rounded down hardest.
  const remainders = exact
    .map(({ k, value }) => ({ k, frac: value - Math.floor(value) }))
    .sort((a, b) => b.frac - a.frac);

  let i = 0;
  while (assigned < total && remainders.length) {
    out[remainders[i % remainders.length].k] += 1;
    assigned++;
    i++;
  }

  return out;
}

/**
 * Builds the per-batch plan for a whole test set.
 *
 * The exact global mix is expanded into a flat list of 100 (type, difficulty)
 * slots, interleaved, then cut into batches. Doing it this way means the totals
 * across the finished set are exact, and every batch is still the same size.
 */
export function buildBatchPlans(total: number, batchSize: number): BatchPlan[] {
  const typeCounts = apportion(total, TYPE_MIX);
  const difficultyCounts = apportion(total, DIFFICULTY_MIX);

  const typeSlots: QuestionType[] = [];
  for (const [type, count] of Object.entries(typeCounts) as Array<[QuestionType, number]>) {
    for (let i = 0; i < count; i++) typeSlots.push(type);
  }

  const difficultySlots: Difficulty[] = [];
  for (const [difficulty, count] of Object.entries(difficultyCounts) as Array<[Difficulty, number]>) {
    for (let i = 0; i < count; i++) difficultySlots.push(difficulty);
  }

  // Deal both lists round-robin so no batch ends up all-hard or all-MCQ.
  const dealt = <T>(slots: T[]): T[] => {
    const batches = Math.ceil(total / batchSize);
    const buckets: T[][] = Array.from({ length: batches }, () => []);
    slots.forEach((slot, i) => buckets[i % batches].push(slot));
    return buckets.flat();
  };

  const types = dealt(typeSlots);
  const difficulties = dealt(difficultySlots);

  const plans: BatchPlan[] = [];
  for (let start = 0, index = 0; start < total; start += batchSize, index++) {
    const slice = { from: start, to: Math.min(start + batchSize, total) };
    const batchTypes = types.slice(slice.from, slice.to);
    const batchDifficulties = difficulties.slice(slice.from, slice.to);

    plans.push({
      index,
      count: slice.to - slice.from,
      types: {
        mcq: batchTypes.filter((t) => t === 'mcq').length,
        true_false: batchTypes.filter((t) => t === 'true_false').length,
        short_answer: batchTypes.filter((t) => t === 'short_answer').length,
      },
      difficulties: {
        easy: batchDifficulties.filter((d) => d === 'easy').length,
        medium: batchDifficulties.filter((d) => d === 'medium').length,
        hard: batchDifficulties.filter((d) => d === 'hard').length,
      },
    });
  }

  return plans;
}

/* ------------------------------------------------------------ question prompt */

export interface QuestionPromptInput {
  college: string;
  courseNumber: string;
  courseTitle: string;
  courseDescription?: string | null;
  courseSummary?: string | null;
  sectionTitle: string;
  sectionTopics: string[];
  syllabusExcerpt?: string | null;
  textbookTitle?: string | null;
  plan: BatchPlan;
  totalBatches: number;
  /** First ~80 chars of every stem already in the set, to avoid repeats. */
  excludeQuestions: string[];
}

export const QUESTION_SYSTEM_PROMPT = [
  'You are an experienced university instructor writing exam questions.',
  '',
  'Hard rules:',
  '- Every question must be written originally by you. Never reproduce or lightly reword a passage,',
  '  exercise, or problem from a textbook or any other copyrighted source.',
  '- Test understanding of the concepts, not recall of a specific book\'s wording.',
  '- Each question must be answerable from the section topics alone.',
  '- Tag every question with one topic taken verbatim from the provided topic list.',
  '',
  'Multiple choice:',
  '- Exactly 4 options. Every option must be textually distinct — never repeat the same',
  '  answer twice, even with different wording or capitalisation.',
  '- All four must be plausible, mutually exclusive, and similar in length and specificity.',
  '- Distractors must encode real, common misconceptions — never filler.',
  '- `correct_answer` must be the full text of one option, copied character for character.',
  '- Never use "all of the above", "none of the above", or "both A and B".',
  '- Do not prefix options with "A.", "B.", letters, or numbers.',
  '',
  'True/false:',
  '- `correct_answer` is exactly "True" or "False". Balance the two across the batch.',
  '- Avoid absolutes like "always"/"never" that give the answer away.',
  '',
  'Short answer:',
  '- Answerable in one to three sentences; `correct_answer` is a model answer of that length.',
  '',
  'Explanations are 1-3 sentences and say why the answer is right, not merely restate it.',
].join('\n');

export function buildQuestionPrompt(input: QuestionPromptInput): string {
  const { plan } = input;

  const parts: string[] = [
    `College: ${input.college}`,
    `Course: ${input.courseNumber} — ${input.courseTitle}`,
    `Section: ${input.sectionTitle}`,
    '',
    'Topics covered by this section (tag each question with one of these, verbatim):',
    ...input.sectionTopics.map((t) => `- ${t}`),
  ];

  if (input.courseDescription) {
    parts.push('', `Course description: ${input.courseDescription.slice(0, 1200)}`);
  }
  if (input.courseSummary) {
    parts.push('', `Course summary: ${input.courseSummary.slice(0, 1200)}`);
  }
  if (input.syllabusExcerpt) {
    parts.push('', `Syllabus excerpt: ${input.syllabusExcerpt.slice(0, 1200)}`);
  }
  if (input.textbookTitle) {
    parts.push(
      '',
      `Students use "${input.textbookTitle}" — match its level and vocabulary, but never copy from it.`,
    );
  }

  parts.push(
    '',
    `This is batch ${plan.index + 1} of ${input.totalBatches} for this section.`,
    `Write exactly ${plan.count} questions with this exact composition:`,
    `- ${plan.types.mcq} multiple choice (type "mcq")`,
    `- ${plan.types.true_false} true/false (type "true_false")`,
    `- ${plan.types.short_answer} short answer (type "short_answer")`,
    '',
    'And exactly this difficulty spread:',
    `- ${plan.difficulties.easy} easy — recall and recognition of a single idea`,
    `- ${plan.difficulties.medium} medium — apply a concept to a described situation`,
    `- ${plan.difficulties.hard} hard — multi-step reasoning, comparison, or edge cases`,
    '',
    'Spread the questions evenly across the topic list rather than clustering on one topic.',
  );

  if (input.excludeQuestions.length) {
    parts.push(
      '',
      'These questions are already in this test set. Write questions that test different things —',
      'not rephrasings of these:',
      ...input.excludeQuestions.slice(0, 120).map((q) => `- ${q}`),
    );
  }

  return parts.join('\n');
}

/* ------------------------------------------------------------ summary prompt */

export function buildSummaryPrompt(input: {
  college: string;
  courseNumber: string;
  courseTitle: string;
  description?: string | null;
  rawContent?: string | null;
}): string {
  return [
    `College: ${input.college}`,
    `Course: ${input.courseNumber} — ${input.courseTitle}`,
    '',
    'Write exactly two paragraphs summarising this course for a student deciding whether to take it.',
    'Paragraph 1: what the course covers and how it is taught.',
    'Paragraph 2: what a student will be able to do afterwards, and what background helps.',
    'Use only the material below — do not speculate beyond it. No headings, no bullet points.',
    '',
    `<course_material>`,
    (input.rawContent ?? input.description ?? '').slice(0, 12_000),
    `</course_material>`,
  ].join('\n');
}
