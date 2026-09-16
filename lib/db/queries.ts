import 'server-only';

import { createAdminClient } from '@/lib/supabase/admin';
import { createClient } from '@/lib/supabase/server';
import type {
  College,
  Course,
  CourseSection,
  Department,
  Question,
  TestSet,
  Textbook,
} from '@/lib/supabase/types';
import type { CourseDetailRaw, CourseRaw, DepartmentRaw } from '@/lib/validation/schemas';

/** Shared scrape caches are considered fresh for 30 days. */
export const CACHE_TTL_DAYS = 30;

export function isStale(timestamp: string | null | undefined, days = CACHE_TTL_DAYS): boolean {
  if (!timestamp) return true;
  const age = Date.now() - new Date(timestamp).getTime();
  return age > days * 24 * 60 * 60 * 1000;
}

/* ----------------------------------------------------------------- colleges */

export async function listColleges(): Promise<College[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('colleges')
    .select('*')
    .order('rank', { ascending: true, nullsFirst: false });

  if (error) throw new Error(`Failed to load colleges: ${error.message}`);
  return data ?? [];
}

export async function getCollege(id: string): Promise<College | null> {
  const supabase = await createClient();
  const { data } = await supabase.from('colleges').select('*').eq('id', id).maybeSingle();
  return data ?? null;
}

export async function updateCollegeCatalog(
  id: string,
  patch: Partial<
    Pick<College, 'catalog_url' | 'catalog_platform' | 'catalog_error' | 'catalog_source'>
  >,
): Promise<void> {
  const admin = createAdminClient();
  const { error } = await admin
    .from('colleges')
    .update({ ...patch, catalog_discovered_at: new Date().toISOString() })
    .eq('id', id);
  if (error) throw new Error(`Failed to update college catalog: ${error.message}`);
}

/* -------------------------------------------------------------- departments */

export async function listDepartments(collegeId: string): Promise<Department[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('departments')
    .select('*')
    .eq('college_id', collegeId)
    .order('code');

  if (error) throw new Error(`Failed to load departments: ${error.message}`);
  return data ?? [];
}

export async function getDepartment(id: string): Promise<Department | null> {
  const supabase = await createClient();
  const { data } = await supabase.from('departments').select('*').eq('id', id).maybeSingle();
  return data ?? null;
}

export async function upsertDepartments(
  collegeId: string,
  departments: DepartmentRaw[],
): Promise<Department[]> {
  if (!departments.length) return [];

  const admin = createAdminClient();
  const now = new Date().toISOString();

  const { data, error } = await admin
    .from('departments')
    .upsert(
      departments.map((d) => ({
        college_id: collegeId,
        code: d.code,
        name: d.name,
        catalog_url: d.url ?? null,
        scraped_at: now,
      })),
      { onConflict: 'college_id,code' },
    )
    .select();

  if (error) throw new Error(`Failed to save departments: ${error.message}`);

  await pruneEmptyDepartments(collegeId, departments.map((d) => d.code));
  return data ?? [];
}

/**
 * Drops departments a re-scrape no longer lists — but only ones with no courses
 * cached under them. Deleting a populated department would cascade into courses
 * and any test sets built from them, and a catalog hiccup is not worth that.
 */
async function pruneEmptyDepartments(collegeId: string, keepCodes: string[]): Promise<void> {
  const admin = createAdminClient();

  const { data: existing } = await admin
    .from('departments')
    .select('id, code, courses(id)')
    .eq('college_id', collegeId);

  const keep = new Set(keepCodes);
  const removable = (existing ?? [])
    .filter((row) => {
      const dept = row as { id: string; code: string; courses: unknown[] | null };
      return !keep.has(dept.code) && (dept.courses?.length ?? 0) === 0;
    })
    .map((row) => (row as { id: string }).id);

  if (removable.length) {
    await admin.from('departments').delete().in('id', removable);
  }
}

/* ------------------------------------------------------------------ courses */

export async function listCourses(departmentId: string): Promise<Course[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('courses')
    .select('*')
    .eq('department_id', departmentId)
    .order('course_number');

  if (error) throw new Error(`Failed to load courses: ${error.message}`);
  return data ?? [];
}

export async function getCourse(id: string): Promise<Course | null> {
  const supabase = await createClient();
  const { data } = await supabase.from('courses').select('*').eq('id', id).maybeSingle();
  return data ?? null;
}

/** Course plus the department and college it belongs to, for breadcrumbs. */
export async function getCourseContext(courseId: string): Promise<{
  course: Course;
  department: Department;
  college: College;
} | null> {
  const supabase = await createClient();
  const { data } = await supabase
    .from('courses')
    .select('*, departments!inner(*, colleges!inner(*))')
    .eq('id', courseId)
    .maybeSingle();

  if (!data) return null;

  const row = data as Course & { departments: Department & { colleges: College } };
  const { departments, ...course } = row;
  const { colleges, ...department } = departments;
  return { course: course as Course, department: department as Department, college: colleges };
}

export async function upsertCourses(
  departmentId: string,
  courses: CourseRaw[],
): Promise<Course[]> {
  if (!courses.length) return [];

  const admin = createAdminClient();
  const now = new Date().toISOString();

  // Upsert in chunks — some departments list well over a thousand courses.
  const saved: Course[] = [];
  const CHUNK = 500;

  for (let i = 0; i < courses.length; i += CHUNK) {
    const { data, error } = await admin
      .from('courses')
      .upsert(
        courses.slice(i, i + CHUNK).map((c) => ({
          department_id: departmentId,
          course_number: c.course_number,
          title: c.title,
          description: c.description ?? null,
          credits: c.credits ?? null,
          prerequisites: c.prerequisites ?? null,
          instructors: c.instructors ?? null,
          terms_offered: c.terms_offered ?? null,
          syllabus_url: c.syllabus_url ?? null,
          source_url: c.source_url ?? null,
          scraped_at: now,
        })),
        { onConflict: 'department_id,course_number', ignoreDuplicates: false },
      )
      .select();

    if (error) throw new Error(`Failed to save courses: ${error.message}`);
    saved.push(...(data ?? []));
  }

  return saved;
}

/**
 * Records that a department's course list was read successfully — including
 * when it held no courses, so an empty department isn't mistaken for one that
 * was never sourced.
 */
export async function markCoursesChecked(departmentId: string): Promise<void> {
  const admin = createAdminClient();
  await admin
    .from('departments')
    .update({ courses_scraped_at: new Date().toISOString() })
    .eq('id', departmentId);
}

export async function saveCourseDetail(courseId: string, detail: CourseDetailRaw): Promise<void> {
  const admin = createAdminClient();
  const { error } = await admin
    .from('courses')
    .update({
      description: detail.description ?? null,
      credits: detail.credits ?? null,
      prerequisites: detail.prerequisites ?? null,
      instructors: detail.instructors ?? null,
      terms_offered: detail.terms_offered ?? null,
      syllabus_url: detail.syllabus_url ?? null,
      raw_scraped_content: detail.raw_scraped_content ?? null,
      detail_scraped_at: new Date().toISOString(),
    })
    .eq('id', courseId);

  if (error) throw new Error(`Failed to save course detail: ${error.message}`);
}

export async function saveCourseSummary(courseId: string, summary: string): Promise<void> {
  const admin = createAdminClient();
  await admin.from('courses').update({ ai_summary: summary }).eq('id', courseId);
}

/* ---------------------------------------------------------------- textbooks */

export async function listTextbooks(courseId: string): Promise<Textbook[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from('textbooks')
    .select('*')
    .eq('course_id', courseId)
    .order('required', { ascending: false });
  return data ?? [];
}

export async function replaceTextbooks(
  courseId: string,
  textbooks: Array<Omit<Textbook, 'id' | 'course_id' | 'created_at'>>,
): Promise<Textbook[]> {
  const admin = createAdminClient();
  await admin.from('textbooks').delete().eq('course_id', courseId);
  if (!textbooks.length) return [];

  const { data, error } = await admin
    .from('textbooks')
    .insert(textbooks.map((t) => ({ ...t, course_id: courseId })))
    .select();

  if (error) throw new Error(`Failed to save textbooks: ${error.message}`);
  return data ?? [];
}

/* ----------------------------------------------------------- course_sections */

export async function listSections(courseId: string): Promise<CourseSection[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from('course_sections')
    .select('*')
    .eq('course_id', courseId)
    .order('position');
  return data ?? [];
}

export async function getSection(id: string): Promise<CourseSection | null> {
  const supabase = await createClient();
  const { data } = await supabase.from('course_sections').select('*').eq('id', id).maybeSingle();
  return data ?? null;
}

/**
 * Rewrites a course's section outline in place.
 *
 * Deliberately an upsert on (course_id, position) rather than a delete-and-
 * insert: course_sections cascades into test_sets and then questions, so
 * rebuilding a course profile used to silently destroy every test anyone had
 * generated for it. Sections that fall off the end of a shorter new outline are
 * only removed when no test set references them.
 */
export async function upsertSections(
  courseId: string,
  sections: Array<Omit<CourseSection, 'id' | 'course_id' | 'created_at'>>,
): Promise<CourseSection[]> {
  if (!sections.length) return listSections(courseId);

  const admin = createAdminClient();

  const { error } = await admin
    .from('course_sections')
    .upsert(
      sections.map((section) => ({ ...section, course_id: courseId })),
      { onConflict: 'course_id,position' },
    );

  if (error) throw new Error(`Failed to save course sections: ${error.message}`);

  await pruneUnusedSections(courseId, sections.length);
  return listSections(courseId);
}

/** Drops trailing sections a shorter outline left behind, unless tests depend on them. */
async function pruneUnusedSections(courseId: string, keepCount: number): Promise<void> {
  const admin = createAdminClient();

  const { data: trailing } = await admin
    .from('course_sections')
    .select('id, test_sets(id)')
    .eq('course_id', courseId)
    .gte('position', keepCount);

  const removable = (trailing ?? [])
    .filter((row) => ((row as { test_sets: unknown[] | null }).test_sets?.length ?? 0) === 0)
    .map((row) => (row as { id: string }).id);

  if (removable.length) {
    await admin.from('course_sections').delete().in('id', removable);
  }
}

/* ---------------------------------------------------------------- test sets */

/**
 * Every test set for a course, from every user — generated tests are a shared
 * library, so a section someone else already paid to generate is reusable.
 */
export async function listTestSetsForCourse(courseId: string): Promise<TestSet[]> {
  const supabase = await createClient();
  const { data: sections } = await supabase
    .from('course_sections')
    .select('id')
    .eq('course_id', courseId);

  const ids = (sections ?? []).map((s) => s.id);
  if (!ids.length) return [];

  const { data } = await supabase
    .from('test_sets')
    .select('*')
    .in('course_section_id', ids)
    .order('created_at', { ascending: false });

  return data ?? [];
}

export async function getTestSet(id: string): Promise<TestSet | null> {
  const supabase = await createClient();
  const { data } = await supabase.from('test_sets').select('*').eq('id', id).maybeSingle();
  return data ?? null;
}

export async function listQuestions(testSetId: string): Promise<Question[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from('questions')
    .select('*')
    .eq('test_set_id', testSetId)
    .order('position');
  return data ?? [];
}

/** Per-user daily cap on generation runs, enforced server-side. */
export const DAILY_TEST_SET_CAP = 10;

export async function countTestSetsToday(userId: string): Promise<number> {
  const admin = createAdminClient();
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const { count } = await admin
    .from('test_sets')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', userId)
    .gte('created_at', since);
  return count ?? 0;
}

/* -------------------------------------------------------------------- stats */

export interface CollegeStats {
  departmentCount: number;
  courseCount: number;
  testSetCount: number;
  attemptsTaken: number;
  lastScrapedAt: string | null;
}

/**
 * Per-college aggregates for the picker: how much of a catalog we've cached and
 * how many tests have been taken there.
 *
 * Counting attempts spans every user's rows, so this reads the `college_stats`
 * view with the service role. The view is aggregate-only — no user ids leave it
 * — and it is not granted to anon/authenticated, so it never reaches the client
 * as anything but the numbers rendered into the page.
 */
export async function getCollegeStats(): Promise<Map<string, CollegeStats>> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from('college_stats')
    .select('college_id, department_count, course_count, test_set_count, attempts_taken, last_scraped_at');

  if (error) {
    // Stats are decoration — the picker must still render without them.
    console.error('[db] college stats unavailable:', error.message);
    return new Map();
  }

  const stats = new Map<string, CollegeStats>();
  for (const row of data ?? []) {
    if (!row.college_id) continue;
    stats.set(row.college_id, {
      departmentCount: row.department_count ?? 0,
      courseCount: row.course_count ?? 0,
      testSetCount: row.test_set_count ?? 0,
      attemptsTaken: row.attempts_taken ?? 0,
      lastScrapedAt: row.last_scraped_at ?? null,
    });
  }
  return stats;
}

/* ---------------------------------------------------------------- favorites */

export interface FavoriteCollege {
  college: College;
  stats: CollegeStats | null;
}

export interface FavoriteCourse {
  course: Course;
  department: Pick<Department, 'id' | 'code' | 'name'>;
  college: Pick<College, 'id' | 'name' | 'short_name'>;
  sectionCount: number;
}

export interface Favorites {
  collegeIds: Set<string>;
  courseIds: Set<string>;
}

/** Just the ids, for rendering the star's on/off state across long lists. */
export async function getFavoriteIds(userId: string | null): Promise<Favorites> {
  const empty = { collegeIds: new Set<string>(), courseIds: new Set<string>() };
  if (!userId) return empty;

  const admin = createAdminClient();
  const { data, error } = await admin
    .from('favorites')
    .select('college_id, course_id')
    .eq('user_id', userId);

  if (error) {
    console.error('[db] favourites unavailable:', error.message);
    return empty;
  }

  const favorites = { collegeIds: new Set<string>(), courseIds: new Set<string>() };
  for (const row of data ?? []) {
    if (row.college_id) favorites.collegeIds.add(row.college_id);
    if (row.course_id) favorites.courseIds.add(row.course_id);
  }
  return favorites;
}

/** The full favourites list for the dashboard, newest first. */
export async function listFavorites(userId: string): Promise<{
  colleges: FavoriteCollege[];
  courses: FavoriteCourse[];
}> {
  const admin = createAdminClient();

  const { data, error } = await admin
    .from('favorites')
    .select(
      'created_at, colleges(*), courses(*, course_sections(id), departments!inner(id, code, name, colleges!inner(id, name, short_name)))',
    )
    .eq('user_id', userId)
    .order('created_at', { ascending: false });

  if (error) {
    console.error('[db] favourites unavailable:', error.message);
    return { colleges: [], courses: [] };
  }

  const stats = await getCollegeStats();
  const colleges: FavoriteCollege[] = [];
  const courses: FavoriteCourse[] = [];

  for (const row of data ?? []) {
    const college = row.colleges as College | null;
    if (college) {
      colleges.push({ college, stats: stats.get(college.id) ?? null });
      continue;
    }

    const course = row.courses as
      | (Course & {
          course_sections: Array<{ id: string }> | null;
          departments: Pick<Department, 'id' | 'code' | 'name'> & {
            colleges: Pick<College, 'id' | 'name' | 'short_name'>;
          };
        })
      | null;

    if (course) {
      const { course_sections, departments, ...rest } = course;
      const { colleges: parentCollege, ...department } = departments;
      courses.push({
        course: rest as Course,
        department,
        college: parentCollege,
        sectionCount: course_sections?.length ?? 0,
      });
    }
  }

  return { colleges, courses };
}

/* ------------------------------------------------------------- test history */

export interface AttemptRecord {
  id: string;
  score: number;
  total: number;
  percentage: number;
  submittedAt: string;
}

export interface TestHistoryEntry {
  testSetId: string;
  courseId: string;
  courseNumber: string;
  courseTitle: string;
  collegeName: string;
  departmentCode: string;
  sectionTitle: string;
  questionCount: number;
  /** Newest first. */
  attempts: AttemptRecord[];
  firstPercentage: number;
  latestPercentage: number;
  bestPercentage: number;
  /** Latest minus first, so repeat attempts show whether they're improving. */
  improvement: number;
}

export interface TestHistory {
  entries: TestHistoryEntry[];
  /** Chronological, for the progress chart. */
  timeline: Array<{ date: string; percentage: number; label: string }>;
  totals: {
    attemptsTaken: number;
    distinctTests: number;
    averagePercentage: number | null;
    bestPercentage: number | null;
    /** Average of the last three vs the first three, in percentage points. */
    trend: number | null;
  };
}

/**
 * Every test this user has finished, grouped by test set.
 *
 * Read through the user's own client so RLS scopes attempts to them — the join
 * reaches into the shared test library and the public catalog cache, but the
 * attempt rows themselves can only ever be their own.
 */
export async function getTestHistory(userId: string | null): Promise<TestHistory> {
  const empty: TestHistory = {
    entries: [],
    timeline: [],
    totals: {
      attemptsTaken: 0,
      distinctTests: 0,
      averagePercentage: null,
      bestPercentage: null,
      trend: null,
    },
  };
  if (!userId) return empty;

  const supabase = await createClient();
  const { data, error } = await supabase
    .from('attempts')
    .select(
      'id, score, total_questions, submitted_at, test_set_id, ' +
        'test_sets!inner(question_count, course_sections!inner(title, courses!inner(id, course_number, title, departments!inner(code, colleges!inner(name, short_name)))))',
    )
    .eq('user_id', userId)
    .not('submitted_at', 'is', null)
    .order('submitted_at', { ascending: false });

  if (error) {
    console.error('[db] test history unavailable:', error.message);
    return empty;
  }

  interface Row {
    id: string;
    score: number | null;
    total_questions: number;
    submitted_at: string;
    test_set_id: string;
    test_sets: {
      question_count: number;
      course_sections: {
        title: string;
        courses: {
          id: string;
          course_number: string;
          title: string;
          departments: { code: string; colleges: { name: string; short_name: string | null } };
        };
      };
    };
  }

  const rows = (data ?? []) as unknown as Row[];
  if (!rows.length) return empty;

  const byTestSet = new Map<string, TestHistoryEntry>();

  for (const row of rows) {
    const total = row.total_questions || row.test_sets.question_count || 0;
    if (!total) continue;

    const attempt: AttemptRecord = {
      id: row.id,
      score: row.score ?? 0,
      total,
      percentage: Math.round(((row.score ?? 0) / total) * 100),
      submittedAt: row.submitted_at,
    };

    const existing = byTestSet.get(row.test_set_id);
    if (existing) {
      existing.attempts.push(attempt);
      continue;
    }

    const section = row.test_sets.course_sections;
    const course = section.courses;
    byTestSet.set(row.test_set_id, {
      testSetId: row.test_set_id,
      courseId: course.id,
      courseNumber: course.course_number,
      courseTitle: course.title,
      collegeName: course.departments.colleges.short_name ?? course.departments.colleges.name,
      departmentCode: course.departments.code,
      sectionTitle: section.title,
      questionCount: row.test_sets.question_count,
      attempts: [attempt],
      firstPercentage: 0,
      latestPercentage: 0,
      bestPercentage: 0,
      improvement: 0,
    });
  }

  const entries = [...byTestSet.values()].map((entry) => {
    // Rows arrive newest-first, so the last attempt in the list is the earliest.
    const percentages = entry.attempts.map((a) => a.percentage);
    const latest = percentages[0];
    const first = percentages[percentages.length - 1];
    return {
      ...entry,
      firstPercentage: first,
      latestPercentage: latest,
      bestPercentage: Math.max(...percentages),
      improvement: latest - first,
    };
  });

  const chronological = [...rows]
    .filter((row) => (row.total_questions || row.test_sets.question_count) > 0)
    .reverse();

  const timeline = chronological.map((row) => {
    const total = row.total_questions || row.test_sets.question_count;
    return {
      date: row.submitted_at,
      percentage: Math.round(((row.score ?? 0) / total) * 100),
      label: `${row.test_sets.course_sections.courses.course_number} · ${row.test_sets.course_sections.title}`,
    };
  });

  const allPercentages = timeline.map((point) => point.percentage);
  const average = (values: number[]) =>
    values.length ? values.reduce((a, b) => a + b, 0) / values.length : 0;

  // Only claim a trend once there's enough history for it to mean something.
  const trend =
    allPercentages.length >= 4
      ? Math.round(average(allPercentages.slice(-3)) - average(allPercentages.slice(0, 3)))
      : null;

  return {
    entries,
    timeline,
    totals: {
      attemptsTaken: allPercentages.length,
      distinctTests: entries.length,
      averagePercentage: allPercentages.length ? Math.round(average(allPercentages)) : null,
      bestPercentage: allPercentages.length ? Math.max(...allPercentages) : null,
      trend,
    },
  };
}
