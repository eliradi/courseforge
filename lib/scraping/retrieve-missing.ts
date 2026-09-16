import 'server-only';

import { createAdminClient } from '@/lib/supabase/admin';
import type { Department } from '@/lib/supabase/types';
import type { CatalogPlatform } from '@/lib/validation/schemas';
import { ensureCourses, ensureDepartments, type Progress } from './pipeline';

export interface RetrieveMissingOptions {
  /**
   * A department whose newest course is older than this is fetched again.
   * `null` means data never goes stale: only empty departments are fetched.
   */
  staleDays: number | null;
  /** Most departments to fetch in one call; `null` fetches every one that needs it. */
  departmentLimit: number | null;
  onProgress?: Progress;
  /** Checked between departments so a long run can be stopped. */
  shouldStop?: () => Promise<boolean>;
}

export interface RetrieveMissingResult {
  platform: CatalogPlatform | null;
  departmentCount: number;
  /** Departments whose courses were fetched in this call. */
  fetched: number;
  /** Of those, how many the catalog lists no current courses for. */
  empty: number;
  /** Departments skipped because their courses were already in the database. */
  alreadyInDb: number;
  /** Departments that still need courses but were beyond `departmentLimit`. */
  deferred: number;
  failed: number;
  /** Courses returned by the departments fetched in this call. */
  coursesFetched: number;
  stopped: boolean;
}

/**
 * Brings a university's course data up to date without re-fetching anything
 * that's already current.
 *
 * The department list is read from the database when it exists (and isn't
 * stale); only when a university has never been read, or its list is out of
 * date, is the catalog asked for it. Then each department is fetched only if it
 * has no courses, or its courses are older than the cutoff.
 *
 * Retrievals used to fetch the department list plus the first three
 * departments' courses every time, which left most of each "retrieved"
 * university empty and re-fetched the first three over and over.
 */
export async function retrieveMissingCourses(
  collegeId: string,
  options: RetrieveMissingOptions,
): Promise<RetrieveMissingResult> {
  const admin = createAdminClient();
  const cutoff =
    options.staleDays === null ? null : Date.now() - options.staleDays * 24 * 60 * 60 * 1000;
  const isStale = (iso: string | null | undefined) =>
    cutoff !== null && (!iso || new Date(iso).getTime() < cutoff);

  // ---- department list: from the database unless missing or stale ----------
  const { data: stored } = await admin
    .from('departments')
    .select('*')
    .eq('college_id', collegeId)
    .order('code');

  let departments = (stored ?? []) as Department[];
  let platform: CatalogPlatform | null = null;

  const listIsStale = departments.length > 0 && departments.every((d) => isStale(d.scraped_at));

  if (!departments.length || listIsStale) {
    options.onProgress?.(
      departments.length
        ? 'Department list is out of date — reading it from the catalog'
        : 'No departments stored yet — reading them from the catalog',
    );
    const result = await ensureDepartments(collegeId, {
      force: true,
      onProgress: options.onProgress,
    });
    departments = result.departments;
    platform = result.platform;
  } else {
    const { data: college } = await admin
      .from('colleges')
      .select('catalog_platform')
      .eq('id', collegeId)
      .maybeSingle();
    platform = (college?.catalog_platform as CatalogPlatform | null) ?? null;
    options.onProgress?.(`Using ${departments.length} departments already in the database`);
  }

  // ---- which departments actually need courses ------------------------------
  const { data: stats } = await admin
    .from('department_course_stats')
    .select('department_id, course_count, last_scraped_at, courses_scraped_at')
    .eq('college_id', collegeId);

  const statsById = new Map((stats ?? []).map((row) => [row.department_id, row]));

  // A department needs fetching if it was never checked, or its last check is
  // older than the cutoff. One checked and found empty is done, like any other.
  const needed = departments.filter((department) => {
    const stat = statsById.get(department.id);
    const checkedAt = stat?.courses_scraped_at ?? (stat?.course_count ? stat.last_scraped_at : null);
    if (!checkedAt) return true;
    return isStale(checkedAt);
  });

  const alreadyInDb = departments.length - needed.length;
  const toFetch = options.departmentLimit === null ? needed : needed.slice(0, options.departmentLimit);
  const deferred = needed.length - toFetch.length;

  options.onProgress?.(
    `${alreadyInDb} of ${departments.length} departments already in the database — fetching ${toFetch.length}` +
      (deferred ? ` (${deferred} more left for a later run)` : ''),
  );

  // ---- fetch ------------------------------------------------------------------
  let fetched = 0;
  let empty = 0;
  let failed = 0;
  let coursesFetched = 0;
  let stopped = false;

  for (const [index, department] of toFetch.entries()) {
    if (options.shouldStop && (await options.shouldStop())) {
      stopped = true;
      break;
    }

    options.onProgress?.(`[${index + 1}/${toFetch.length}] ${department.code} — ${department.name}`);
    try {
      const result = await ensureCourses(department.id, {
        force: true,
        onProgress: options.onProgress,
      });
      fetched++;
      coursesFetched += result.courses.length;
      if (result.empty) empty++;
      else options.onProgress?.(`${department.code}: ${result.courses.length} courses`);
    } catch (error) {
      failed++;
      options.onProgress?.(
        `${department.code} failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  return {
    platform,
    departmentCount: departments.length,
    fetched,
    empty,
    alreadyInDb,
    deferred: deferred + (stopped ? toFetch.length - fetched - failed : 0),
    failed,
    coursesFetched,
    stopped,
  };
}

/** One-line description of a retrieval, for logs and the admin table. */
export function describeRetrieval(result: RetrieveMissingResult): string {
  const parts = [
    `${result.departmentCount} departments`,
    `${result.fetched} fetched (${result.coursesFetched} courses)`,
    `${result.alreadyInDb} already in DB`,
  ];
  if (result.empty) parts.push(`${result.empty} with no current courses`);
  if (result.failed) parts.push(`${result.failed} failed`);
  if (result.deferred) parts.push(`${result.deferred} left for later`);
  return parts.join(' · ');
}
