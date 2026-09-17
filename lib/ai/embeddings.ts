import 'server-only';

import { createHash } from 'node:crypto';

import { embed, embedMany } from 'ai';

import { createAdminClient } from '@/lib/supabase/admin';
import { EMBEDDING_DIMENSIONS, EMBEDDING_MODEL, isAiConfigured } from './models';
import { recordUsage, withUsageContext } from './usage';

/**
 * Course embeddings: one vector per course, used to find similar courses at
 * other universities by meaning rather than by shared title words.
 */

export interface EmbeddableCourse {
  id: string;
  collegeId: string;
  courseNumber: string;
  title: string;
  description: string | null;
  departmentName: string | null;
}

/** Long descriptions add cost without changing what a course is about. */
const MAX_DESCRIPTION_CHARS = 1500;

/** Inputs per embedding request. */
const BATCH_SIZE = 200;

/** Ids per `.in()` lookup — PostgREST puts them in the URL. */
const LOOKUP_CHUNK = 150;

const squash = (value: string) => value.toLowerCase().replace(/[^a-z0-9]/g, '');

/**
 * Whether a course says enough about itself to be compared by meaning. Rows
 * whose title is only the course code and that have no description (older
 * CourseLeaf parses — see `pnpm repair-titles`) would match anything sharing a
 * subject prefix, so they stay out of the index.
 */
export function isEmbeddable(course: Pick<EmbeddableCourse, 'courseNumber' | 'title' | 'description'>): boolean {
  if (course.description?.trim()) return true;
  const title = squash(course.title);
  return Boolean(title) && title !== squash(course.courseNumber);
}

export function courseEmbeddingText(
  course: Pick<EmbeddableCourse, 'title' | 'description' | 'departmentName'>,
): string {
  const description = course.description?.replace(/\s+/g, ' ').trim().slice(0, MAX_DESCRIPTION_CHARS);
  return [course.title.trim(), course.departmentName?.trim(), description].filter(Boolean).join('\n');
}

function hashOf(text: string): string {
  return createHash('sha1').update(`${EMBEDDING_MODEL}\n${text}`).digest('hex');
}

/** pgvector's text form, which PostgREST accepts for a vector column. */
export function toVectorLiteral(values: number[]): string {
  return `[${values.join(',')}]`;
}

export interface EmbedResult {
  embedded: number;
  unchanged: number;
  /** Courses with too little text to embed (and any stale vector for them removed). */
  skipped: number;
  tokens: number;
}

/**
 * Embeds the given courses, skipping any whose text hasn't changed since they
 * were last embedded. Cost is recorded per request under the course's college.
 */
export async function embedCourses(
  courses: EmbeddableCourse[],
  options: { onProgress?: (done: number, total: number) => void } = {},
): Promise<EmbedResult> {
  const result: EmbedResult = { embedded: 0, unchanged: 0, skipped: 0, tokens: 0 };
  if (!courses.length || !isAiConfigured()) return result;

  const admin = createAdminClient();

  const thin = courses.filter((course) => !isEmbeddable(course));
  result.skipped = thin.length;
  for (let i = 0; i < thin.length; i += LOOKUP_CHUNK) {
    const ids = thin.slice(i, i + LOOKUP_CHUNK).map((c) => c.id);
    const { error } = await admin.from('course_embeddings').delete().in('course_id', ids);
    if (error) throw new Error(`Could not clear embeddings: ${error.message}`);
  }

  const prepared = courses.filter(isEmbeddable).map((course) => {
    const text = courseEmbeddingText(course);
    return { course, text, hash: hashOf(text) };
  });

  const stored = new Map<string, string>();
  for (let i = 0; i < prepared.length; i += LOOKUP_CHUNK) {
    const ids = prepared.slice(i, i + LOOKUP_CHUNK).map((p) => p.course.id);
    const { data, error } = await admin
      .from('course_embeddings')
      .select('course_id, content_hash')
      .in('course_id', ids);
    if (error) throw new Error(`Could not read stored embeddings: ${error.message}`);
    for (const row of data ?? []) stored.set(row.course_id, row.content_hash);
  }

  const pending = prepared.filter((p) => stored.get(p.course.id) !== p.hash);
  result.unchanged = prepared.length - pending.length;

  // Batches stay within one college so each cost row is attributed correctly.
  const byCollege = new Map<string, typeof pending>();
  for (const item of pending) {
    const list = byCollege.get(item.course.collegeId) ?? [];
    list.push(item);
    byCollege.set(item.course.collegeId, list);
  }

  for (const [collegeId, items] of byCollege) {
    for (let i = 0; i < items.length; i += BATCH_SIZE) {
      const batch = items.slice(i, i + BATCH_SIZE);
      const response = await withUsageContext({ collegeId, courseId: null }, async () => {
        try {
          const out = await embedMany({
            model: EMBEDDING_MODEL,
            values: batch.map((b) => b.text),
            maxRetries: 3,
          });
          await recordUsage({
            operation: 'course_embedding',
            model: EMBEDDING_MODEL,
            inputTokens: out.usage?.tokens ?? 0,
            outputTokens: 0,
          });
          return out;
        } catch (error) {
          await recordUsage({
            operation: 'course_embedding',
            model: EMBEDDING_MODEL,
            inputTokens: 0,
            outputTokens: 0,
            succeeded: false,
          });
          throw error;
        }
      });

      const rows = batch.map((b, index) => {
        const vector = response.embeddings[index];
        if (vector.length !== EMBEDDING_DIMENSIONS) {
          throw new Error(
            `${EMBEDDING_MODEL} returned ${vector.length} dimensions; the database stores ${EMBEDDING_DIMENSIONS}.`,
          );
        }
        return {
          course_id: b.course.id,
          college_id: b.course.collegeId,
          embedding: toVectorLiteral(vector),
          model: EMBEDDING_MODEL,
          content_hash: b.hash,
          embedded_at: new Date().toISOString(),
        };
      });

      const { error } = await admin.from('course_embeddings').upsert(rows, { onConflict: 'course_id' });
      if (error) throw new Error(`Could not save embeddings: ${error.message}`);

      result.embedded += batch.length;
      result.tokens += response.usage?.tokens ?? 0;
      options.onProgress?.(result.unchanged + result.embedded, prepared.length);
    }
  }

  return result;
}

/**
 * Embeds courses as part of a scrape without ever failing it — similar-course
 * search is a nice-to-have next to the catalog data itself.
 */
export async function embedCoursesQuietly(courses: EmbeddableCourse[]): Promise<void> {
  try {
    await embedCourses(courses);
  } catch (error) {
    console.error('[embeddings] could not embed courses:', error instanceof Error ? error.message : error);
  }
}

/* --------------------------------------------------------------- queries --- */

/** Recent query embeddings — the home page asks again on every pause in typing. */
const queryCache = new Map<string, number[]>();
const QUERY_CACHE_SIZE = 500;

/** Embedding for free text typed by a visitor, or null if embeddings are unavailable. */
export async function embedQuery(text: string): Promise<number[] | null> {
  if (!isAiConfigured()) return null;
  const key = text.trim().toLowerCase().replace(/\s+/g, ' ');
  if (!key) return null;

  const cached = queryCache.get(key);
  if (cached) {
    // Re-insert to keep recently used entries at the end.
    queryCache.delete(key);
    queryCache.set(key, cached);
    return cached;
  }

  try {
    const { embedding, usage } = await embed({ model: EMBEDDING_MODEL, value: key, maxRetries: 1 });
    await recordUsage({
      operation: 'search_embedding',
      model: EMBEDDING_MODEL,
      inputTokens: usage?.tokens ?? 0,
      outputTokens: 0,
    });
    queryCache.set(key, embedding);
    if (queryCache.size > QUERY_CACHE_SIZE) {
      const oldest = queryCache.keys().next().value;
      if (oldest !== undefined) queryCache.delete(oldest);
    }
    return embedding;
  } catch (error) {
    console.error('[embeddings] query embedding failed:', error instanceof Error ? error.message : error);
    return null;
  }
}

/** Makes sure one course has an embedding (e.g. scraped before embeddings existed). */
export async function ensureCourseEmbedding(courseId: string): Promise<boolean> {
  const admin = createAdminClient();
  const { data: existing } = await admin
    .from('course_embeddings')
    .select('course_id')
    .eq('course_id', courseId)
    .maybeSingle();
  if (existing) return true;

  const { data: course } = await admin
    .from('courses')
    .select('id, course_number, title, description, departments!inner(name, college_id)')
    .eq('id', courseId)
    .maybeSingle();
  if (!course) return false;

  try {
    const { embedded } = await embedCourses([
      {
        id: course.id,
        collegeId: course.departments.college_id,
        courseNumber: course.course_number,
        title: course.title,
        description: course.description,
        departmentName: course.departments.name,
      },
    ]);
    return embedded > 0;
  } catch (error) {
    console.error('[embeddings] could not embed course:', error instanceof Error ? error.message : error);
    return false;
  }
}
