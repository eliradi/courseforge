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

export async function listAdminCourses(limit = 1000): Promise<AdminCourseRow[]> {
  const admin = createAdminClient();

  const { data: courses } = await admin
    .from('courses')
    .select(
      'id, course_number, title, credits, ai_summary, course_sections(id), departments!inner(code, name, colleges!inner(id, name, short_name))',
    )
    .order('course_number')
    .limit(limit);

  if (!courses?.length) return [];

  const [testSets, costs] = await Promise.all([
    admin
      .from('test_sets')
      .select('id, status, course_sections!inner(course_id), attempts(id, submitted_at)'),
    // Aggregated in the database — a `.in(...)` over every course id overflows
    // the PostgREST query string once a catalog is a few hundred courses deep.
    admin.from('course_ai_cost').select('course_id, cost_usd'),
  ]);

  interface TestSetRow {
    id: string;
    status: string;
    course_sections: { course_id: string };
    attempts: Array<{ id: string; submitted_at: string | null }> | null;
  }

  const byCourse = new Map<string, { total: number; complete: number; attempts: number }>();
  for (const row of (testSets.data ?? []) as unknown as TestSetRow[]) {
    const courseId = row.course_sections.course_id;
    const entry = byCourse.get(courseId) ?? { total: 0, complete: 0, attempts: 0 };
    entry.total++;
    if (row.status === 'complete') entry.complete++;
    entry.attempts += (row.attempts ?? []).filter((a) => a.submitted_at).length;
    byCourse.set(courseId, entry);
  }

  const costByCourse = new Map<string, number>();
  for (const row of costs.data ?? []) {
    if (!row.course_id) continue;
    costByCourse.set(row.course_id, Number(row.cost_usd ?? 0));
  }

  return courses.map((course) => {
    const department = course.departments as unknown as {
      code: string;
      name: string;
      colleges: { id: string; name: string; short_name: string | null };
    };
    const tests = byCourse.get(course.id) ?? { total: 0, complete: 0, attempts: 0 };

    return {
      id: course.id,
      courseNumber: course.course_number,
      title: course.title,
      level: courseLevel(course.course_number),
      credits: course.credits,
      departmentCode: department.code,
      departmentName: department.name,
      collegeName: department.colleges.short_name ?? department.colleges.name,
      collegeId: department.colleges.id,
      sectionCount: (course.course_sections as Array<{ id: string }> | null)?.length ?? 0,
      testSetCount: tests.total,
      completeTestSets: tests.complete,
      attemptsTaken: tests.attempts,
      costUsd: costByCourse.get(course.id) ?? 0,
      hasSummary: Boolean(course.ai_summary),
    };
  });
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
      admin.from('ai_usage').select('total_tokens, cost_usd'),
      admin.from('college_stats').select('course_count'),
    ]);

  const totals = (usage.data ?? []).reduce(
    (acc, row) => ({
      calls: acc.calls + 1,
      tokens: acc.tokens + (row.total_tokens ?? 0),
      cost: acc.cost + Number(row.cost_usd ?? 0),
    }),
    { calls: 0, tokens: 0, cost: 0 },
  );

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
