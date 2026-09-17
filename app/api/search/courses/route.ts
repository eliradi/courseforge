import type { NextRequest } from 'next/server';
import { z } from 'zod';

import { embedQuery, ensureCourseEmbedding, toVectorLiteral } from '@/lib/ai/embeddings';
import { createClient } from '@/lib/supabase/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const QuerySchema = z.object({
  q: z.string().trim().min(2).max(120),
  /** Omitted to search every university. */
  college: z.string().uuid().optional(),
});

export interface CourseMatch {
  courseId: string;
  courseNumber: string;
  title: string;
  departmentId: string;
  departmentCode: string;
  departmentName: string;
  collegeId: string;
  collegeName: string;
  collegeShortName: string | null;
  collegeRank: number | null;
  /** How well it matches the query (used for ordering). */
  score: number;
  /** How close it is to being the very course the query names (0–1). */
  exactness: number;
  /** Share of the query's distinctive words present in the title; null if none were typed. */
  coverage: number | null;
  /** Likeness by meaning (cosine, 0–1) for "similar course" results; null for word matches. */
  similarity: number | null;
  hasSections: boolean;
  completeTestSets: number;
}

/** Response when no university is chosen: the best-matching courses anywhere. */
export interface AllCoursesSearchResponse {
  scope: 'all';
  query: string;
  results: CourseMatch[];
  /** 'meaning' when embeddings contributed, 'words' when only titles were compared. */
  method: 'meaning' | 'words';
}

export interface CourseSearchResponse {
  scope: 'college';
  query: string;
  college: {
    id: string;
    name: string;
    indexed: boolean;
    courseCount: number;
    departmentCount: number;
    /** Departments whose course list we've read — "not found" only means much if this is all of them. */
    departmentsSourced: number;
  };
  /** The best match at the chosen university, if it's close enough to call it the same course. */
  match: CourseMatch | null;
  /** Other candidates at the chosen university, best first. */
  atCollege: CourseMatch[];
  /** Similar courses at every other university we've indexed. */
  elsewhere: CourseMatch[];
  /**
   * What "similar" was measured against: the matched course itself (its title,
   * department and description), or the text the visitor typed.
   */
  elsewhereBasis: 'course' | 'query';
  /** 'meaning' when embeddings were used, 'words' when only title words were compared. */
  elsewhereMethod: 'meaning' | 'words';
}

/**
 * Exactness at or above this is treated as "this is the course you meant".
 * Uses the symmetric score — the ranking score rewards a query merely contained
 * in a longer title, which is right for suggestions but wrong for "we have it".
 */
const SAME_COURSE_EXACTNESS = 0.6;

/** Above this, a match is unambiguous on its own. */
const CERTAIN_EXACTNESS = 0.85;

/** Otherwise the winner must beat the best differently-named course by this much. */
const CLEAR_MARGIN = 0.08;

/**
 * Course-title shorthand that trigram matching can't bridge on its own
 * ("intro" shares few trigrams with "introduction"). Deliberately short: only
 * abbreviations with a single unambiguous expansion.
 */
const ABBREVIATIONS: Record<string, string> = {
  intro: 'introduction',
  adv: 'advanced',
  prin: 'principles',
  fund: 'fundamentals',
  lab: 'laboratory',
};

/**
 * Minimum cosine similarity for a "similar course". Comparing two full course
 * records scores higher than comparing a few typed words with one, hence two
 * thresholds. Tuned against real catalog data.
 */
const MIN_SIMILARITY_TO_COURSE = 0.6;
const MIN_SIMILARITY_TO_QUERY = 0.5;

const ELSEWHERE_LIMIT = 10;
const ELSEWHERE_PER_COLLEGE = 2;

/** All-universities search: a longer list, a few courses per university. */
const ALL_LIMIT = 15;
const ALL_PER_COLLEGE = 3;

/** A query needs real words for its meaning to be worth embedding ("6.7900" has none). */
function hasWords(query: string): boolean {
  return /[a-z]{3,}/i.test(query);
}

function expand(query: string): string {
  return query.replace(/\b([a-z]+)\b\.?/gi, (word, stem: string) => ABBREVIATIONS[stem.toLowerCase()] ?? word);
}

function normalizedTitle(title: string): string {
  return title.toLowerCase().replace(/[^a-z0-9]/g, '');
}

/**
 * The course the query names, or null if the answer isn't clear-cut.
 *
 * Cross-listed courses share a title, so they're one course for this purpose —
 * the winner only has to beat the best match with a *different* title.
 */
function pickExactMatch(matches: CourseMatch[]): CourseMatch | null {
  // A course can only be "the one" if it contains every distinctive word typed —
  // "Introduction to Africology" is never "introduction to psychology".
  const eligible = matches.filter((m) => m.coverage === null || m.coverage >= 1);
  if (!eligible.length) return null;
  const ranked = [...eligible].sort((a, b) => b.exactness - a.exactness || b.score - a.score);
  const best = ranked[0];
  if (best.exactness < SAME_COURSE_EXACTNESS) return null;
  if (best.exactness >= CERTAIN_EXACTNESS) return best;

  const rival = ranked.find((m) => normalizedTitle(m.title) !== normalizedTitle(best.title));
  if (!rival) return best;
  return best.exactness - rival.exactness >= CLEAR_MARGIN ? best : null;
}

type Row = {
  course_id: string;
  course_number: string;
  title: string;
  department_id: string;
  department_code: string;
  department_name: string;
  college_id: string;
  college_name: string;
  college_short_name: string | null;
  college_rank: number | null;
  score: number;
  exactness: number;
  coverage: number | null;
  has_sections: boolean;
  complete_test_sets: number;
};

function toMatch(row: Row): CourseMatch {
  return {
    courseId: row.course_id,
    courseNumber: row.course_number,
    title: row.title,
    departmentId: row.department_id,
    departmentCode: row.department_code,
    departmentName: row.department_name,
    collegeId: row.college_id,
    collegeName: row.college_name,
    collegeShortName: row.college_short_name,
    collegeRank: row.college_rank,
    score: Number(row.score),
    exactness: Number(row.exactness),
    coverage: row.coverage === null ? null : Number(row.coverage),
    similarity: null,
    hasSections: row.has_sections,
    completeTestSets: row.complete_test_sets,
  };
}

type SimilarRow = Omit<Row, 'score' | 'exactness' | 'coverage'> & { similarity: number };

function similarToMatch(row: SimilarRow): CourseMatch {
  return {
    ...toMatch({ ...row, score: row.similarity, exactness: 0, coverage: null }),
    similarity: Number(row.similarity),
  };
}

type Supabase = Awaited<ReturnType<typeof createClient>>;

/**
 * Courses at other universities that are about the same thing, by embedding.
 * Returns null when embeddings can't answer (not configured, no vector for the
 * course, or an error), so the caller can fall back to word matching.
 */
async function similarByMeaning(
  supabase: Supabase,
  collegeId: string | null,
  target: { courseId: string } | { query: string },
  limits = { limit: ELSEWHERE_LIMIT, perCollege: ELSEWHERE_PER_COLLEGE },
): Promise<CourseMatch[] | null> {
  const common = {
    p_exclude_college_id: collegeId ?? undefined,
    p_limit: limits.limit,
    p_per_college: limits.perCollege,
  };

  if ('courseId' in target) {
    // Courses scraped before embeddings existed get one on first lookup.
    if (!(await ensureCourseEmbedding(target.courseId))) return null;
    const { data, error } = await supabase.rpc('similar_courses', {
      ...common,
      p_course_id: target.courseId,
      p_min_similarity: MIN_SIMILARITY_TO_COURSE,
    });
    if (error) {
      console.error('[search] similar_courses failed:', error.message);
      return null;
    }
    return ((data ?? []) as SimilarRow[]).map(similarToMatch);
  }

  const vector = await embedQuery(target.query);
  if (!vector) return null;
  const { data, error } = await supabase.rpc('similar_courses', {
    ...common,
    p_embedding: toVectorLiteral(vector),
    p_min_similarity: MIN_SIMILARITY_TO_QUERY,
  });
  if (error) {
    console.error('[search] similar_courses failed:', error.message);
    return null;
  }
  return ((data ?? []) as SimilarRow[]).map(similarToMatch);
}

/** `primary` first, then `secondary`, without repeats and within the per-university cap. */
function mergeSimilar(
  primary: CourseMatch[],
  secondary: CourseMatch[],
  limits = { limit: ELSEWHERE_LIMIT, perCollege: ELSEWHERE_PER_COLLEGE },
): CourseMatch[] {
  const out: CourseMatch[] = [];
  const seen = new Set<string>();
  const perCollege = new Map<string, number>();
  for (const m of [...primary, ...secondary]) {
    if (out.length >= limits.limit) break;
    const count = perCollege.get(m.collegeId) ?? 0;
    // A course listed under several departments is still one course.
    const key = `${m.collegeId}|${m.courseNumber}|${normalizedTitle(m.title)}`;
    if (seen.has(key) || count >= limits.perCollege) continue;
    seen.add(key);
    perCollege.set(m.collegeId, count + 1);
    out.push(m);
  }
  return out;
}

/**
 * No university chosen: courses matching the query at any university. Titles
 * containing the typed words lead; courses about the same thing by meaning
 * fill in the rest.
 */
async function searchAll(supabase: Supabase, rawQuery: string, q: string): Promise<Response> {
  const limits = { limit: ALL_LIMIT, perCollege: ALL_PER_COLLEGE };
  const [words, byMeaning] = await Promise.all([
    supabase.rpc('search_courses', { q, p_limit: ALL_LIMIT, p_per_college: ALL_PER_COLLEGE }),
    hasWords(q) ? similarByMeaning(supabase, null, { query: q }, limits) : Promise.resolve(null),
  ]);
  if (words.error) {
    return Response.json({ error: words.error.message ?? 'Search failed.' }, { status: 500 });
  }

  const byWords = ((words.data ?? []) as Row[]).map(toMatch);
  const body: AllCoursesSearchResponse = {
    scope: 'all',
    query: rawQuery,
    results: mergeSimilar(byWords, byMeaning ?? [], limits),
    method: byMeaning?.length ? 'meaning' : 'words',
  };
  return Response.json(body, { headers: { 'cache-control': 'private, max-age=30' } });
}

/**
 * Public course lookup: "is this course already in your system at this
 * university, and is anything similar taught elsewhere?" — or, with no
 * university given, "where is a course like this taught?"
 *
 * Reads only what's already stored — it never triggers a scrape.
 */
export async function GET(request: NextRequest) {
  const parsed = QuerySchema.safeParse(Object.fromEntries(new URL(request.url).searchParams));
  if (!parsed.success) {
    return Response.json({ error: 'Provide q (2–120 characters).' }, { status: 400 });
  }

  const { q: rawQuery, college: collegeId } = parsed.data;
  const q = expand(rawQuery);
  const supabase = await createClient();

  if (!collegeId) return searchAll(supabase, rawQuery, q);

  const [
    { data: college },
    { count },
    { count: departmentCount },
    { count: departmentsSourced },
    atCollege,
    elsewhere,
  ] = await Promise.all([
    supabase.from('colleges').select('id, name').eq('id', collegeId).maybeSingle(),
    supabase
      .from('courses')
      .select('id, departments!inner(college_id)', { count: 'exact', head: true })
      .eq('departments.college_id', collegeId),
    supabase.from('departments').select('id', { count: 'exact', head: true }).eq('college_id', collegeId),
    supabase
      .from('departments')
      .select('id', { count: 'exact', head: true })
      .eq('college_id', collegeId)
      .not('courses_scraped_at', 'is', null),
    supabase.rpc('search_courses', { q, p_college_id: collegeId, p_limit: 8 }),
    supabase.rpc('search_courses', {
      q,
      p_exclude_college_id: collegeId,
      p_limit: ELSEWHERE_LIMIT,
      p_per_college: ELSEWHERE_PER_COLLEGE,
      p_rank_by: 'exactness',
    }),
  ]);

  if (!college) return Response.json({ error: 'That university was not found.' }, { status: 404 });
  if (atCollege.error || elsewhere.error) {
    return Response.json(
      { error: (atCollege.error ?? elsewhere.error)?.message ?? 'Search failed.' },
      { status: 500 },
    );
  }

  const here = ((atCollege.data ?? []) as Row[]).map(toMatch);
  const best = pickExactMatch(here);

  // Similar courses elsewhere: by meaning when we can — compared with the
  // matched course when there is one, otherwise with what was typed.
  const byWords = ((elsewhere.data ?? []) as Row[]).map(toMatch);
  const elsewhereBasis = best ? 'course' : 'query';
  const byMeaning = best
    ? await similarByMeaning(supabase, collegeId, { courseId: best.courseId })
    : hasWords(q)
      ? await similarByMeaning(supabase, collegeId, { query: q })
      : null;

  // A whole course record is a strong signal, so its neighbours lead. A few
  // typed words are a weak one: titles containing every one of them are the
  // surer hits there, and meaning fills in the rest. Either way the other list
  // covers what the first missed (e.g. courses not yet indexed).
  const similar = !byMeaning
    ? byWords
    : best
      ? mergeSimilar(byMeaning, byWords)
      : mergeSimilar(byWords, byMeaning);

  const body: CourseSearchResponse = {
    scope: 'college',
    query: rawQuery,
    college: {
      id: college.id,
      name: college.name,
      indexed: (count ?? 0) > 0,
      courseCount: count ?? 0,
      departmentCount: departmentCount ?? 0,
      departmentsSourced: departmentsSourced ?? 0,
    },
    match: best,
    atCollege: best ? here.filter((m) => m.courseId !== best.courseId) : here,
    elsewhere: similar,
    elsewhereBasis,
    elsewhereMethod: byMeaning ? 'meaning' : 'words',
  };

  return Response.json(body, { headers: { 'cache-control': 'private, max-age=30' } });
}
