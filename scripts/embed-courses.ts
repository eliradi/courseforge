/**
 * Builds the embeddings behind "similar courses at other universities".
 *
 *   pnpm embed-courses              # embed every course that's new or changed
 *   pnpm embed-courses --dry-run    # count what would be embedded, no API calls
 *
 * Safe to re-run: courses whose title, department and description are unchanged
 * since they were last embedded are skipped. Scraping keeps new courses indexed,
 * so this is only needed once, or after changing AI_EMBEDDING_MODEL.
 */
import {
  courseEmbeddingText,
  embedCourses,
  isEmbeddable,
  type EmbeddableCourse,
} from '../lib/ai/embeddings';
import { EMBEDDING_MODEL, isAiConfigured } from '../lib/ai/models';
import { costOf, formatUsd } from '../lib/ai/pricing';
import { createAdminClient } from '../lib/supabase/admin';

const dryRun = process.argv.includes('--dry-run');
const PAGE = 1000;

async function coursesFor(collegeId: string): Promise<EmbeddableCourse[]> {
  const admin = createAdminClient();
  const out: EmbeddableCourse[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await admin
      .from('courses')
      .select('id, course_number, title, description, departments!inner(name, college_id)')
      .eq('departments.college_id', collegeId)
      .order('id')
      .range(from, from + PAGE - 1);
    if (error) throw new Error(error.message);
    for (const row of data ?? []) {
      out.push({
        id: row.id,
        collegeId,
        courseNumber: row.course_number,
        title: row.title,
        description: row.description,
        departmentName: row.departments.name,
      });
    }
    if (!data || data.length < PAGE) return out;
  }
}

async function main() {
  if (!dryRun && !isAiConfigured()) {
    console.error('AI_GATEWAY_API_KEY is not set.');
    process.exit(1);
  }

  const admin = createAdminClient();
  const { data: colleges, error } = await admin.from('colleges').select('id, name, rank').order('rank');
  if (error) throw new Error(error.message);

  console.log(`${dryRun ? 'Dry run — ' : ''}embedding with ${EMBEDDING_MODEL}\n`);
  const totals = { courses: 0, embedded: 0, unchanged: 0, skipped: 0, tokens: 0, chars: 0, failed: 0 };

  for (const college of colleges ?? []) {
    const courses = await coursesFor(college.id);
    if (!courses.length) continue;
    totals.courses += courses.length;
    const label = `${String(college.rank ?? '').padStart(3)} ${college.name}`;

    if (dryRun) {
      const usable = courses.filter(isEmbeddable);
      totals.skipped += courses.length - usable.length;
      totals.chars += usable.reduce((sum, c) => sum + courseEmbeddingText(c).length, 0);
      console.log(`${label}: ${usable.length} of ${courses.length} courses embeddable`);
      continue;
    }

    const started = Date.now();
    try {
      const result = await embedCourses(courses);
      totals.embedded += result.embedded;
      totals.unchanged += result.unchanged;
      totals.skipped += result.skipped;
      totals.tokens += result.tokens;
      console.log(
        `${label}: ${result.embedded} embedded, ${result.unchanged} unchanged, ${result.skipped} too thin` +
          ` · ${result.tokens} tokens · ${((Date.now() - started) / 1000).toFixed(1)}s`,
      );
    } catch (err) {
      totals.failed += courses.length;
      console.error(`${label}: FAILED — ${err instanceof Error ? err.message : err}`);
    }
  }

  console.log('\n---');
  if (dryRun) {
    // ~4 characters per token for English text.
    const tokens = Math.round(totals.chars / 4);
    console.log(
      `${totals.courses} courses (${totals.skipped} too thin to embed) · ~${tokens.toLocaleString()} tokens · ~${formatUsd(costOf(EMBEDDING_MODEL, tokens, 0))} if all are new`,
    );
    return;
  }
  console.log(
    `${totals.courses} courses: ${totals.embedded} embedded, ${totals.unchanged} unchanged,` +
      ` ${totals.skipped} too thin, ${totals.failed} failed` +
      ` · ${totals.tokens.toLocaleString()} tokens · ${formatUsd(costOf(EMBEDDING_MODEL, totals.tokens, 0))}`,
  );
  if (totals.failed) process.exit(1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
