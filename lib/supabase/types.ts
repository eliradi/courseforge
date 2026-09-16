/**
 * Friendly aliases over the generated schema types.
 * Regenerate the source with:
 *   pnpm db:types
 */
import type { Database } from './database.types';

export type { Database };

type Tables = Database['public']['Tables'];

export type College = Tables['colleges']['Row'];
export type Department = Tables['departments']['Row'];
export type Course = Tables['courses']['Row'];
export type Textbook = Tables['textbooks']['Row'];
export type CourseSection = Tables['course_sections']['Row'];
export type TestSet = Tables['test_sets']['Row'];
export type Question = Tables['questions']['Row'];
export type Attempt = Tables['attempts']['Row'];
export type AttemptAnswer = Tables['attempt_answers']['Row'];

export type CollegeInsert = Tables['colleges']['Insert'];
export type DepartmentInsert = Tables['departments']['Insert'];
export type CourseInsert = Tables['courses']['Insert'];
export type TextbookInsert = Tables['textbooks']['Insert'];
export type CourseSectionInsert = Tables['course_sections']['Insert'];
export type QuestionInsert = Tables['questions']['Insert'];
export type AttemptAnswerInsert = Tables['attempt_answers']['Insert'];

/** Column values are plain `text` in Postgres; these narrow them for the app. */
export type CatalogPlatform =
  | 'courseleaf'
  | 'acalog'
  | 'banner'
  | 'kuali'
  | 'coursedog'
  | 'generic';
export type CatalogSource = 'heuristic' | 'sitemap' | 'homepage' | 'search' | 'manual';
export type TextbookSource = 'catalog' | 'bookstore' | 'syllabus' | 'ai_inferred';
export type SectionSource = 'textbook_toc' | 'syllabus' | 'ai_derived';
export type TestSetStatus = 'pending' | 'generating' | 'complete' | 'failed';
export type QuestionType = 'mcq' | 'true_false' | 'short_answer';
export type Difficulty = 'easy' | 'medium' | 'hard';

/** `questions.options` is jsonb; this is the shape we always write. */
export function questionOptions(question: Pick<Question, 'options'>): string[] | null {
  return Array.isArray(question.options) ? (question.options as string[]) : null;
}
