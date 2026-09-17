import 'server-only';

import { createAdminClient } from '@/lib/supabase/admin';
import type { CatalogPlatform, CatalogSource } from '@/lib/supabase/types';

/* ------------------------------------------------------------------- users */

export interface AdminUserRow {
  id: string;
  email: string | null;
  createdAt: string;
  lastSignInAt: string | null;
  isAdmin: boolean;
  favoriteColleges: string[];
  favoriteCourses: string[];
  testSetsCreated: number;
  attemptsTaken: number;
  averageScore: number | null;
  bestScore: number | null;
  aiCalls: number;
  totalTokens: number;
  costUsd: number;
  recentResults: Array<{
    attemptId: string;
    courseNumber: string;
    sectionTitle: string;
    score: number | null;
    total: number;
    submittedAt: string | null;
  }>;
}

export async function listAdminUsers(): Promise<AdminUserRow[]> {
  const admin = createAdminClient();

  const { data: authData } = await admin.auth.admin.listUsers({ perPage: 1000 });
  const users = authData?.users ?? [];
  if (!users.length) return [];

  const [favorites, testSets, attempts, costs] = await Promise.all([
    admin
      .from('favorites')
      .select('user_id, colleges(name), courses(course_number, title)'),
    admin.from('test_sets').select('user_id'),
    admin
      .from('attempts')
      .select(
        'id, user_id, score, total_questions, submitted_at, test_sets!inner(course_sections!inner(title, courses!inner(course_number)))',
      )
      .not('submitted_at', 'is', null)
      .order('submitted_at', { ascending: false }),
    admin.from('user_ai_cost').select('user_id, call_count, total_tokens, cost_usd'),
  ]);

  const favoritesByUser = new Map<string, { colleges: string[]; courses: string[] }>();
  for (const row of favorites.data ?? []) {
    const entry = favoritesByUser.get(row.user_id) ?? { colleges: [], courses: [] };
    const college = row.colleges as { name: string } | null;
    const course = row.courses as { course_number: string; title: string } | null;
    if (college) entry.colleges.push(college.name);
    if (course) entry.courses.push(`${course.course_number} ${course.title}`);
    favoritesByUser.set(row.user_id, entry);
  }

  const testSetsByUser = new Map<string, number>();
  for (const row of testSets.data ?? []) {
    testSetsByUser.set(row.user_id, (testSetsByUser.get(row.user_id) ?? 0) + 1);
  }

  interface AttemptRow {
    id: string;
    user_id: string;
    score: number | null;
    total_questions: number;
    submitted_at: string | null;
    test_sets: { course_sections: { title: string; courses: { course_number: string } } };
  }

  const attemptsByUser = new Map<string, AttemptRow[]>();
  for (const row of (attempts.data ?? []) as unknown as AttemptRow[]) {
    const list = attemptsByUser.get(row.user_id) ?? [];
    list.push(row);
    attemptsByUser.set(row.user_id, list);
  }

  const costByUser = new Map<string, { calls: number; tokens: number; cost: number }>();
  for (const row of costs.data ?? []) {
    if (!row.user_id) continue;
    costByUser.set(row.user_id, {
      calls: row.call_count ?? 0,
      tokens: row.total_tokens ?? 0,
      cost: Number(row.cost_usd ?? 0),
    });
  }

  return users.map((user) => {
    const userAttempts = attemptsByUser.get(user.id) ?? [];
    const percentages = userAttempts
      .filter((a) => a.total_questions > 0 && a.score !== null)
      .map((a) => ((a.score ?? 0) / a.total_questions) * 100);

    const cost = costByUser.get(user.id);
    const favorite = favoritesByUser.get(user.id) ?? { colleges: [], courses: [] };

    return {
      id: user.id,
      email: user.email ?? null,
      createdAt: user.created_at,
      lastSignInAt: user.last_sign_in_at ?? null,
      isAdmin: (user.app_metadata as { role?: unknown } | null)?.role === 'admin',
      favoriteColleges: favorite.colleges,
      favoriteCourses: favorite.courses,
      testSetsCreated: testSetsByUser.get(user.id) ?? 0,
      attemptsTaken: userAttempts.length,
      averageScore: percentages.length
        ? Math.round(percentages.reduce((a, b) => a + b, 0) / percentages.length)
        : null,
      bestScore: percentages.length ? Math.round(Math.max(...percentages)) : null,
      aiCalls: cost?.calls ?? 0,
      totalTokens: cost?.tokens ?? 0,
      costUsd: cost?.cost ?? 0,
      recentResults: userAttempts.slice(0, 5).map((a) => ({
        attemptId: a.id,
        courseNumber: a.test_sets.course_sections.courses.course_number,
        sectionTitle: a.test_sets.course_sections.title,
        score: a.score,
        total: a.total_questions,
        submittedAt: a.submitted_at,
      })),
    };
  });
}

/* ------------------------------------------------------------ universities */

export interface OperationSnapshot {
  at: string | null;
  costUsd: number;
  tokens: number;
  ok: boolean | null;
}

export interface AdminCollegeRow {
  id: string;
  rank: number | null;
  name: string;
  shortName: string | null;
  state: string | null;
  country: string;
  /** Which ranking `rank` comes from — US News or QS World. */
  rankSource: string;
  domain: string;
  catalogUrl: string | null;
  platform: CatalogPlatform | null;
  source: CatalogSource | null;
  catalogError: string | null;
  departmentCount: number;
  /** Departments that actually have courses stored. */
  departmentsWithCourses: number;
  /** Departments whose course list has been read — including empty ones. */
  departmentsSourced: number;
  courseCount: number;
  testSetCount: number;
  attemptsTaken: number;
  aiCalls: number;
  totalTokens: number;
  costUsd: number;
  lastScrapedAt: string | null;
  /** Latest run of each operation, with what it cost. */
  operations: {
    catalogCheck: OperationSnapshot;
    retrieval: OperationSnapshot;
    courseProfile: OperationSnapshot;
    testGeneration: OperationSnapshot;
  };
}

const NO_RUN: OperationSnapshot = { at: null, costUsd: 0, tokens: 0, ok: null };

export async function listAdminColleges(): Promise<AdminCollegeRow[]> {
  const admin = createAdminClient();

  const [colleges, stats, costs, operations] = await Promise.all([
    admin.from('colleges').select('*').order('rank', { ascending: true, nullsFirst: false }),
    admin.from('college_stats').select('*'),
    admin.from('college_ai_cost').select('*'),
    admin.from('college_latest_operations').select('*'),
  ]);

  const statsById = new Map((stats.data ?? []).map((row) => [row.college_id, row]));
  const costById = new Map((costs.data ?? []).map((row) => [row.college_id, row]));
  const opsById = new Map((operations.data ?? []).map((row) => [row.college_id, row]));

  return (colleges.data ?? []).map((college) => {
    const stat = statsById.get(college.id);
    const cost = costById.get(college.id);
    const ops = opsById.get(college.id);

    const snapshot = (
      at: string | null | undefined,
      costUsd: number | null | undefined,
      tokens: number | null | undefined,
      ok: boolean | null | undefined,
    ): OperationSnapshot =>
      at ? { at, costUsd: Number(costUsd ?? 0), tokens: tokens ?? 0, ok: ok ?? null } : NO_RUN;

    return {
      id: college.id,
      rank: college.rank,
      name: college.name,
      shortName: college.short_name,
      state: college.state,
      country: college.country,
      rankSource: college.rank_source,
      domain: college.website_domain,
      catalogUrl: college.catalog_url,
      platform: college.catalog_platform as CatalogPlatform | null,
      source: college.catalog_source as CatalogSource | null,
      catalogError: college.catalog_error,
      departmentCount: stat?.department_count ?? 0,
      departmentsWithCourses: stat?.departments_with_courses ?? 0,
      departmentsSourced: stat?.departments_sourced ?? 0,
      courseCount: stat?.course_count ?? 0,
      testSetCount: stat?.test_set_count ?? 0,
      attemptsTaken: stat?.attempts_taken ?? 0,
      aiCalls: cost?.call_count ?? 0,
      totalTokens: cost?.total_tokens ?? 0,
      costUsd: Number(cost?.cost_usd ?? 0),
      lastScrapedAt: stat?.last_scraped_at ?? null,
      operations: {
        catalogCheck: snapshot(
          ops?.catalog_check_at,
          ops?.catalog_check_cost,
          ops?.catalog_check_tokens,
          ops?.catalog_check_ok,
        ),
        retrieval: snapshot(
          ops?.retrieval_at,
          ops?.retrieval_cost,
          ops?.retrieval_tokens,
          ops?.retrieval_ok,
        ),
        courseProfile: snapshot(
          ops?.profile_at,
          ops?.profile_cost,
          ops?.profile_tokens,
          ops?.profile_ok,
        ),
        testGeneration: snapshot(
          ops?.test_generation_at,
          ops?.test_generation_cost,
          ops?.test_generation_tokens,
          ops?.test_generation_ok,
        ),
      },
    };
  });
}

/* ----------------------------------------------------------------- courses */

export interface AdminCourseRow {
  id: string;
  courseNumber: string;
  title: string;
  level: string;
  credits: string | null;
  departmentCode: string;
  departmentName: string;
  collegeName: string;
  collegeId: string;
  sectionCount: number;
  testSetCount: number;
  completeTestSets: number;
  attemptsTaken: number;
  costUsd: number;
  hasSummary: boolean;
}

/**
 * Catalogs don't publish a course "type", so level is derived from the course
 * number. US catalogs number by class standing, but the scale varies: three- and
 * four-digit schemes put the tier in the leading digit (CS 229 -> 2xx, CS 5840 ->
 * 5xxx), while two-digit schemes (Stanford's AFRICAAM 10) run 1-99 flat. MIT-style
 * dotted numbers carry the tier after the dot (6.1010 -> 1xxx).
 *
 * The admin course list computes this in SQL (`public.course_level`, migration
 * 0014) so it can sort on it; keep the two in step.
 */
export function courseLevel(courseNumber: string): string {
  const dotted = courseNumber.match(/\.\s*(\d+)/);
  const plain = courseNumber.match(/(\d+)/);
  const digits = dotted?.[1] ?? plain?.[1];
  if (!digits) return 'Unspecified';

  const value = Number(digits);
  if (!Number.isFinite(value)) return 'Unspecified';

  let tier: number;
  if (value < 100) {
    // Flat 1-99 scheme: no hundreds digit to read, so split it in half.
    tier = value < 50 ? 1 : 2;
  } else if (value < 1000) {
    tier = Math.floor(value / 100);
  } else {
    tier = Math.floor(value / 1000);
  }

  if (tier <= 1) return 'Introductory';
  if (tier <= 4) return 'Undergraduate';
  return 'Graduate';
}

export const COURSE_SORTS = [
  'course',
  'title',
  'university',
  'department',
  'level',
  'sections',
  'tests',
  'taken',
  'cost',
] as const;
export type CourseSort = (typeof COURSE_SORTS)[number];

export const COURSE_FILTERS = ['all', 'tested', 'untested'] as const;
export type CourseFilter = (typeof COURSE_FILTERS)[number];

export const COURSE_PAGE_SIZE = 500;

export interface AdminCourseQuery {
  query?: string;
  filter?: CourseFilter;
  sort?: CourseSort;
  desc?: boolean;
  page?: number;
}

export interface AdminCoursePage {
  rows: AdminCourseRow[];
  /** Courses matching the search and filter. */
  matching: number;
  /** Every course in the database. */
  total: number;
  page: number;
  pageCount: number;
  pageSize: number;
}

/**
 * One page of the admin course list. Filtering, sorting (including on test,
 * attempt and cost aggregates) and paging all happen in `admin_course_list`.
 */
export async function listAdminCourses(options: AdminCourseQuery = {}): Promise<AdminCoursePage> {
  const admin = createAdminClient();
  const page = Math.max(1, Math.floor(options.page ?? 1));

  const [list, totalCount] = await Promise.all([
    admin.rpc('admin_course_list', {
      p_query: options.query?.trim() || undefined,
      p_tested: options.filter ?? 'all',
      p_sort: options.sort ?? 'course',
      p_desc: options.desc ?? false,
      p_limit: COURSE_PAGE_SIZE,
      p_offset: (page - 1) * COURSE_PAGE_SIZE,
    }),
    admin.from('courses').select('id', { count: 'exact', head: true }),
  ]);

  if (list.error) throw new Error(`Could not list courses: ${list.error.message}`);

  const data = list.data ?? [];
  const matching = Number(data[0]?.total_count ?? 0);

  return {
    rows: data.map((row) => ({
      id: row.id,
      courseNumber: row.course_number,
      title: row.title,
      level: row.level,
      credits: row.credits,
      departmentCode: row.department_code,
      departmentName: row.department_name,
      collegeName: row.college_name,
      collegeId: row.college_id,
      sectionCount: row.section_count,
      testSetCount: row.test_set_count,
      completeTestSets: row.complete_test_sets,
      attemptsTaken: row.attempts_taken,
      costUsd: Number(row.cost_usd ?? 0),
      hasSummary: row.has_summary,
    })),
    matching,
    total: totalCount.count ?? 0,
    page,
    pageCount: Math.max(1, Math.ceil(matching / COURSE_PAGE_SIZE)),
    pageSize: COURSE_PAGE_SIZE,
  };
}

/* -------------------------------------------------------------- dashboard */

export interface AdminTotals {
  users: number;
  colleges: number;
  indexedColleges: number;
  courses: number;
  testSets: number;
  questions: number;
  attempts: number;
  aiCalls: number;
  totalTokens: number;
  costUsd: number;
}

export async function getAdminTotals(): Promise<AdminTotals> {
  const admin = createAdminClient();

  const count = async (table: 'colleges' | 'courses' | 'test_sets' | 'questions' | 'attempts') => {
    const { count: value } = await admin.from(table).select('id', { count: 'exact', head: true });
    return value ?? 0;
  };

  const [authData, colleges, courses, testSets, questions, attempts, usage, stats] =
    await Promise.all([
      admin.auth.admin.listUsers({ perPage: 1000 }),
      count('colleges'),
      count('courses'),
      count('test_sets'),
      count('questions'),
      count('attempts'),
      // Summed in the database — the ledger is far past PostgREST's 1000-row cap.
      admin.from('ai_cost_total').select('call_count, total_tokens, cost_usd').maybeSingle(),
      admin.from('college_stats').select('course_count'),
    ]);

  const totals = {
    calls: Number(usage.data?.call_count ?? 0),
    tokens: Number(usage.data?.total_tokens ?? 0),
    cost: Number(usage.data?.cost_usd ?? 0),
  };

  return {
    users: authData.data?.users.length ?? 0,
    colleges,
    indexedColleges: (stats.data ?? []).filter((row) => (row.course_count ?? 0) > 0).length,
    courses,
    testSets,
    questions,
    attempts,
    aiCalls: totals.calls,
    totalTokens: totals.tokens,
    costUsd: totals.cost,
  };
}
