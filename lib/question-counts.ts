/** Test lengths a user can choose when generating a set. Safe for client and server. */
export const QUESTION_COUNTS = [10, 25, 40, 70, 100] as const;

export type QuestionCount = (typeof QUESTION_COUNTS)[number];

/** Short enough to generate in about a minute. */
export const DEFAULT_QUESTION_COUNT: QuestionCount = 25;

export function isQuestionCount(value: unknown): value is QuestionCount {
  return QUESTION_COUNTS.includes(value as QuestionCount);
}
