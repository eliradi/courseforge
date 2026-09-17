import 'server-only';

import { embedCoursesQuietly } from '@/lib/ai/embeddings';
import { generateCourseSummary } from '@/lib/ai/summary';
import { withUsageContext } from '@/lib/ai/usage';
import { recordOperationRun } from '@/lib/db/operation-runs';
import {
  getCollege,
  getCourseContext,
  getDepartment,
  isStale,
  listCourses,
  listDepartments,
  listSections,
  listTextbooks,
  markCoursesChecked,
  upsertSections,
  replaceTextbooks,
  saveCourseDetail,
  saveCourseSummary,
  updateCollegeCatalog,
  upsertCourses,
  upsertDepartments,
} from '@/lib/db/queries';
import type { College, Course, CourseSection, Department, Textbook } from '@/lib/supabase/types';
import type { CatalogPlatform } from '@/lib/validation/schemas';
import { getAdapter } from './adapters/registry';
import type { ScrapeCtx } from './adapters/types';
import { isScraperConfigured, ScraperError, scrapeScreenshot } from './client';
import { discoverCatalog } from './discover-catalog';
import { deriveSections } from './sections';
import { findTextbooks } from './textbooks';

export type Progress = (message: string) => void;

export class PipelineError extends Error {
  constructor(
    message: string,
    readonly recoverable: boolean = true,
    /** Base64 PNG of the page we choked on, when we could capture one. */
    readonly screenshot?: string | null,
  ) {
    super(message);
    this.name = 'PipelineError';
  }
}

function assertScraper(): void {
  if (!isScraperConfigured()) {
    throw new PipelineError(
      'The scraper service is not configured. Set SCRAPER_SERVICE_URL and SCRAPER_SERVICE_SECRET.',
      false,
    );
  }
}

/* --------------------------------------------------------------- catalog --- */

async function resolveCatalog(
  college: College,
  options: { manualUrl?: string; force?: boolean; onProgress?: Progress },
): Promise<{ catalogUrl: string; platform: CatalogPlatform; rootHtml: string }> {
  const cachedIsUsable =
    !options.force &&
    !options.manualUrl &&
    college.catalog_url &&
    !isStale(college.catalog_discovered_at, 90);

  if (cachedIsUsable) {
    options.onProgress?.('Using the catalog we found earlier');
    // We still need the root HTML for adapters that fingerprint off it.
    const { scrapeFetch } = await import('./client');
    const res = await scrapeFetch(college.catalog_url!);
    if (res.ok && res.html) {
      return {
        catalogUrl: college.catalog_url!,
        platform: (college.catalog_platform as CatalogPlatform | null) ?? 'generic',
        rootHtml: res.html,
      };
    }
    options.onProgress?.('Cached catalog URL no longer responds — rediscovering');
  }

  const discovered = await discoverCatalog(college, {
    manualUrl: options.manualUrl,
    onProgress: options.onProgress,
  });

  if (!discovered) {
    await updateCollegeCatalog(college.id, {
      catalog_error: 'Could not locate a course catalog automatically.',
    }).catch(() => undefined);
    throw new PipelineError(
      `We couldn't find a course catalog on ${college.website_domain}. Paste the catalog URL below and we'll use that instead.`,
    );
  }

  await updateCollegeCatalog(college.id, {
    catalog_url: discovered.catalogUrl,
    catalog_platform: discovered.platform,
    catalog_source: discovered.via,
    catalog_error: null,
  });

  return {
    catalogUrl: discovered.catalogUrl,
    platform: discovered.platform,
    rootHtml: discovered.rootHtml,
  };
}

function buildCtx(
  college: College,
  catalog: { catalogUrl: string; rootHtml: string },
  onProgress?: Progress,
): ScrapeCtx {
  return {
    catalogUrl: catalog.catalogUrl,
    domain: college.website_domain,
    collegeName: college.name,
    rootHtml: catalog.rootHtml,
    state: {},
    onProgress,
  };
}

/* ----------------------------------------------------------- departments --- */

export interface DepartmentsResult {
  departments: Department[];
  platform: CatalogPlatform;
  catalogUrl: string;
  fromCache: boolean;
}

/**
 * Serves the cached department list when it's fresh; otherwise runs discovery
 * plus the platform adapter and refreshes the shared cache.
 */
export async function ensureDepartments(
  collegeId: string,
  options: { force?: boolean; manualUrl?: string; onProgress?: Progress } = {},
): Promise<DepartmentsResult> {
  // Everything below may make AI calls; tag their cost with this college.
  return withUsageContext({ collegeId }, () => ensureDepartmentsInner(collegeId, options));
}

async function ensureDepartmentsInner(
  collegeId: string,
  options: { force?: boolean; manualUrl?: string; onProgress?: Progress },
): Promise<DepartmentsResult> {
  const college = await getCollege(collegeId);
  if (!college) throw new PipelineError('That college no longer exists.', false);

  // Unforced calls come from students browsing: anything already cached is
  // served as-is, whatever its age. Only forced calls (Re-scrape, admin
  // retrieval, bulk jobs) go back to the catalog.
  if (!options.force && !options.manualUrl) {
    const cached = await listDepartments(collegeId);
    if (cached.length > 0) {
      return {
        departments: cached,
        platform: (college.catalog_platform as CatalogPlatform | null) ?? 'generic',
        catalogUrl: college.catalog_url ?? '',
        fromCache: true,
      };
    }
  }

  assertScraper();

  const catalog = await resolveCatalog(college, options);
  const adapter = getAdapter(catalog.platform);
  const ctx = buildCtx(college, catalog, options.onProgress);

  options.onProgress?.(`Scraping departments (${adapter.label})`);

  let departments;
  try {
    departments = await adapter.getDepartments(ctx);
  } catch (error) {
    throw await toPipelineError(error, catalog.catalogUrl);
  }

  if (!departments.length) {
    throw new PipelineError(
      `We reached ${college.name}'s catalog but couldn't read a department list from it. You can paste a more specific catalog URL below.`,
      true,
      await captureScreenshot(catalog.catalogUrl),
    );
  }

  options.onProgress?.(`Parsing ${departments.length} departments`);
  const saved = await upsertDepartments(collegeId, departments);

  return {
    departments: saved.sort((a, b) => a.code.localeCompare(b.code)),
    platform: catalog.platform,
    catalogUrl: catalog.catalogUrl,
    fromCache: false,
  };
}

/* --------------------------------------------------------------- courses --- */

export interface CoursesResult {
  courses: Course[];
  fromCache: boolean;
  /**
   * The catalog was read and lists no current courses for this department —
   * typically a retired code whose courses are all inactive. Not an error.
   */
  empty: boolean;
}

export async function ensureCourses(
  departmentId: string,
  options: { force?: boolean; onProgress?: Progress } = {},
): Promise<CoursesResult> {
  const department = await getDepartment(departmentId);
  if (!department) throw new PipelineError('That department no longer exists.', false);

  return withUsageContext({ collegeId: department.college_id }, () =>
    ensureCoursesInner(departmentId, options),
  );
}

async function ensureCoursesInner(
  departmentId: string,
  options: { force?: boolean; onProgress?: Progress },
): Promise<CoursesResult> {
  const department = await getDepartment(departmentId);
  if (!department) throw new PipelineError('That department no longer exists.', false);

  // As above: cached courses are served whatever their age unless forced — and
  // a department we already checked and found empty stays empty until someone
  // deliberately refreshes it.
  if (!options.force) {
    const cached = await listCourses(departmentId);
    if (cached.length > 0) {
      return { courses: cached, fromCache: true, empty: false };
    }
    if (department.courses_scraped_at) {
      return { courses: [], fromCache: true, empty: true };
    }
  }

  assertScraper();

  const college = await getCollege(department.college_id);
  if (!college) throw new PipelineError('That college no longer exists.', false);

  const catalog = await resolveCatalog(college, { onProgress: options.onProgress });
  const adapter = getAdapter(catalog.platform);
  const ctx = buildCtx(college, catalog, options.onProgress);

  options.onProgress?.(`Scraping ${department.code} courses`);

  let courses;
  try {
    courses = await adapter.getCourses(ctx, {
      code: department.code,
      name: department.name,
      url: department.catalog_url,
    });
  } catch (error) {
    throw await toPipelineError(error, department.catalog_url ?? catalog.catalogUrl);
  }

  // The catalog answered. Record that, whatever it said.
  await markCoursesChecked(departmentId);

  if (!courses.length) {
    options.onProgress?.(
      `${department.code}: the catalog lists no current courses — recorded as empty`,
    );
    return { courses: [], fromCache: false, empty: true };
  }

  options.onProgress?.(`Saving ${courses.length} courses`);
  const saved = await upsertCourses(departmentId, courses);

  // Keep "similar courses" current. Unchanged courses are skipped by hash.
  options.onProgress?.('Indexing courses for similar-course search');
  await embedCoursesQuietly(
    saved.map((c) => ({
      id: c.id,
      collegeId: department.college_id,
      courseNumber: c.course_number,
      title: c.title,
      description: c.description,
      departmentName: department.name,
    })),
  );

  return { courses: saved.sort(byCourseNumber), fromCache: false, empty: false };
}

export function byCourseNumber(a: Course, b: Course): number {
  return a.course_number.localeCompare(b.course_number, undefined, {
    numeric: true,
    sensitivity: 'base',
  });
}

/* -------------------------------------------------------- course profile --- */

export interface CourseProfile {
  course: Course;
  department: Department;
  college: College;
  textbooks: Textbook[];
  sections: CourseSection[];
}

/**
 * Fills in everything the course page shows: catalog detail, the cached AI
 * summary, textbooks, and the derived section list. Each stage is independent —
 * one failing never blanks the rest of the page.
 */
export async function ensureCourseProfile(
  courseId: string,
  options: { force?: boolean; onProgress?: Progress } = {},
): Promise<CourseProfile> {
  const context = await getCourseContext(courseId);
  if (!context) throw new PipelineError('That course no longer exists.', false);

  const startedAt = new Date();
  return withUsageContext({ collegeId: context.college.id, courseId }, async () => {
    try {
      const profile = await ensureCourseProfileInner(courseId, options);
      await recordOperationRun({
        kind: 'course_profile',
        scope: { collegeId: context.college.id, courseId },
        startedAt,
        ok: true,
        summary: `${profile.sections.length} sections · ${profile.textbooks.length} textbooks`,
      });
      return profile;
    } catch (error) {
      await recordOperationRun({
        kind: 'course_profile',
        scope: { collegeId: context.college.id, courseId },
        startedAt,
        ok: false,
        summary: error instanceof Error ? error.message.slice(0, 300) : 'failed',
      });
      throw error;
    }
  });
}

async function ensureCourseProfileInner(
  courseId: string,
  options: { force?: boolean; onProgress?: Progress },
): Promise<CourseProfile> {
  const context = await getCourseContext(courseId);
  if (!context) throw new PipelineError('That course no longer exists.', false);

  let { course } = context;
  const { department, college } = context;

  // 1. Full catalog detail for this one course.
  // The course row from the department listing already carries its description,
  // credits and prerequisites. Only go back to the catalog when forced, or when
  // the course has no content at all to build a profile from.
  const hasContent = Boolean(course.description?.trim() || course.raw_scraped_content?.trim());
  const needsDetail = options.force || (!course.detail_scraped_at && !hasContent);
  if (needsDetail && isScraperConfigured()) {
    options.onProgress?.('Reading the full catalog entry');
    try {
      const catalog = await resolveCatalog(college, { onProgress: options.onProgress });
      const adapter = getAdapter(catalog.platform);
      const ctx = buildCtx(college, catalog, options.onProgress);

      const detail = await adapter.getCourseDetail(ctx, {
        course_number: course.course_number,
        title: course.title,
        description: course.description,
        credits: course.credits,
        prerequisites: course.prerequisites,
        instructors: course.instructors,
        terms_offered: course.terms_offered,
        syllabus_url: course.syllabus_url,
        source_url: course.source_url,
      });

      await saveCourseDetail(courseId, detail);
      course = {
        ...course,
        ...detail,
        instructors: detail.instructors ?? course.instructors,
        detail_scraped_at: new Date().toISOString(),
      } as Course;
      await embedCoursesQuietly([
        {
          id: course.id,
          collegeId: college.id,
          courseNumber: course.course_number,
          title: course.title,
          description: course.description,
          departmentName: department.name,
        },
      ]);
    } catch (error) {
      // A detail failure is not fatal — we still have the list-level record.
      console.error('[pipeline] course detail failed:', error);
    }
  }

  // 2. AI summary, generated once and cached on the row.
  if (!course.ai_summary) {
    options.onProgress?.('Writing the course summary');
    const summary = await generateCourseSummary({
      college: college.name,
      courseNumber: course.course_number,
      courseTitle: course.title,
      description: course.description,
      rawContent: course.raw_scraped_content,
    });
    if (summary) {
      await saveCourseSummary(courseId, summary);
      course = { ...course, ai_summary: summary };
    }
  }

  // 3. Textbooks.
  let textbooks = await listTextbooks(courseId);
  if (options.force || !textbooks.length) {
    options.onProgress?.('Looking for required textbooks');
    try {
      const found = await findTextbooks({
        collegeName: college.name,
        domain: college.website_domain,
        departmentCode: department.code,
        course,
        onProgress: options.onProgress,
      });
      if (found.textbooks.length) {
        textbooks = await replaceTextbooks(
          courseId,
          found.textbooks.map((t) => ({
            title: t.title,
            authors: t.authors ?? null,
            edition: t.edition ?? null,
            isbn: t.isbn ?? null,
            required: t.required,
            source: found.source,
          })),
        );
      }
    } catch (error) {
      console.error('[pipeline] textbook lookup failed:', error);
    }
  }

  // 4. Sections — this is what test generation runs on.
  let sections = await listSections(courseId);
  if (options.force || !sections.length) {
    options.onProgress?.('Deriving course sections');
    try {
      const derived = await deriveSections({ course, textbooks, onProgress: options.onProgress });
      if (derived.sections.length) {
        sections = await upsertSections(
          courseId,
          derived.sections.map((s, index) => ({
            position: index,
            title: s.title,
            topics: s.topics,
            source: derived.source,
          })),
        );
      }
    } catch (error) {
      console.error('[pipeline] section derivation failed:', error);
    }
  }

  return { course, department, college, textbooks, sections };
}

/* --------------------------------------------------------------- helpers --- */

async function captureScreenshot(url: string): Promise<string | null> {
  try {
    return await scrapeScreenshot(url);
  } catch {
    return null;
  }
}

async function toPipelineError(error: unknown, url: string): Promise<PipelineError> {
  if (error instanceof PipelineError) return error;

  const message =
    error instanceof ScraperError
      ? `The scraper couldn't reach ${hostOf(url)} (${error.message}).`
      : error instanceof Error
        ? error.message
        : 'The scrape failed for an unknown reason.';

  return new PipelineError(message, true, await captureScreenshot(url));
}

function hostOf(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return url;
  }
}
