import type { QuestionType } from '@/lib/supabase/types';

const SHORT_ANSWER_OVERLAP = 0.6;

function normalize(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, ' ');
}

function contentTokens(value: string): Set<string> {
  return new Set(
    normalize(value)
      .replace(/[^a-z0-9\s]/g, ' ')
      .split(/\s+/)
      .filter((token) => token.length > 3),
  );
}

/**
 * The single source of truth for marking an answer.
 *
 * MCQ and true/false are graded exactly (after normalising whitespace and case).
 * Short answers can't be string-matched reliably, so they're marked correct on a
 * strong token overlap with the model answer and are always surfaced in the
 * review so the student can judge for themselves.
 *
 * The server is authoritative — the quiz imports this only so the score screen
 * can render immediately without a second round trip.
 */
export function gradeAnswer(
  type: QuestionType | string,
  correctAnswer: string,
  given: string | null,
): boolean {
  if (!given?.trim()) return false;

  if (type === 'mcq' || type === 'true_false') {
    return normalize(given) === normalize(correctAnswer);
  }

  const expected = contentTokens(correctAnswer);
  if (!expected.size) return false;

  const actual = contentTokens(given);
  let hits = 0;
  for (const token of expected) if (actual.has(token)) hits++;

  return hits / expected.size >= SHORT_ANSWER_OVERLAP;
}
