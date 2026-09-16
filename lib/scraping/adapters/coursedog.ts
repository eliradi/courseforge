import 'server-only';

import { scrapeFetch, scrapeIntercept } from '../client';
import {
  CourseRawSchema,
  DepartmentRawSchema,
  type CourseRaw,
  type DepartmentRaw,
} from '@/lib/validation/schemas';
import { clean, type CatalogAdapter, type ScrapeCtx } from './types';
import { dedupeByNumber } from './courseleaf';

const API_ROOT = 'https://app.coursedog.com/api/v1';
const PAGE_SIZE = 200;
const MAX_PAGES = 60;

interface CoursedogCourse {
  _id?: string;
  code?: string;
  courseNumber?: string;
  subjectCode?: string;
  name?: string;
  longName?: string;
  description?: string;
  departments?: string[];
  college?: string;
  status?: string;
  credits?: {
    numberOfCredits?: number;
    creditHours?: { min?: number; max?: number };
  };
  requisites?: { requisitesFreeform?: { value?: string; showInCatalog?: boolean } };
  customFields?: Record<string, unknown>;
}

interface CoursedogConfig {
  /** Tenant slug in the API path, e.g. "ucsb". */
  school: string;
  catalogId: string;
  searchConfigId?: string;
  /** Sent as Origin — the API rejects requests without it. */
  origin: string;
}

/**
 * Coursedog — a Nuxt SPA over a public JSON API.
 *
 * We intercept the SPA's own network calls once to learn the tenant slug and
 * catalog id, then talk to the API directly with cheap static fetches. The DOM
 * is never scraped.
 */
export const coursedogAdapter: CatalogAdapter = {
  id: 'coursedog',
  label: 'Coursedog',

  detect(html, url) {
    const haystack = html.toLowerCase();
    return (
      haystack.includes('coursedog') ||
      haystack.includes('app.coursedog.com') ||
      /coursedog/i.test(url)
    );
  },

  async getDepartments(ctx) {
    const config = await resolveConfig(ctx);
    if (!config) return [];

    ctx.state.coursedog = config;

    // The course-search configuration carries the department filter options —
    // exactly the code/name pairs we want.
    if (config.searchConfigId) {
      const json = await getJson(
        `${API_ROOT}/ca/${config.school}/search-configurations/${config.searchConfigId}`,
        config.origin,
      );

      const filters = (json as { filters?: Array<Record<string, unknown>> } | null)?.filters ?? [];
      const departmentFilter = filters.find((f) => f.questionId === 'departments');
      const options =
        ((departmentFilter?.config as { options?: Array<{ value?: string; label?: string }> })?.options) ?? [];

      const departments: DepartmentRaw[] = [];
      for (const option of options) {
        const parsed = DepartmentRawSchema.safeParse({
          code: option.value,
          name: option.label ?? option.value,
        });
        if (parsed.success) departments.push(parsed.data);
      }

      if (departments.length) {
        return departments.sort((a, b) => a.code.localeCompare(b.code));
      }
    }

    // Fallback: derive the department list from a page of courses.
    ctx.onProgress?.('Deriving departments from the course list');
    const sample = await fetchCoursePage(config, { skip: 0, limit: PAGE_SIZE });
    const found = new Map<string, DepartmentRaw>();
    for (const course of sample.data) {
      for (const code of course.departments ?? []) {
        const parsed = DepartmentRawSchema.safeParse({ code, name: code });
        if (parsed.success && !found.has(parsed.data.code)) found.set(parsed.data.code, parsed.data);
      }
    }
    return [...found.values()].sort((a, b) => a.code.localeCompare(b.code));
  },

  async getCourses(ctx, dept) {
    const config = (ctx.state.coursedog as CoursedogConfig | undefined) ?? (await resolveConfig(ctx));
    if (!config) return [];
    ctx.state.coursedog = config;

    const courses: CourseRaw[] = [];
    let total = Infinity;

    for (let page = 0; page < MAX_PAGES && page * PAGE_SIZE < total; page++) {
      ctx.onProgress?.(`Fetching ${dept.code} courses (page ${page + 1})`);

      const result = await fetchCoursePage(config, {
        skip: page * PAGE_SIZE,
        limit: PAGE_SIZE,
        departments: dept.code,
      });

      total = result.listLength;
      if (!result.data.length) break;

      for (const raw of result.data) {
        const parsed = toCourseRaw(raw, ctx);
        if (parsed) courses.push(parsed);
      }
    }

    return dedupeByNumber(courses);
  },

  async getCourseDetail(ctx, course) {
    // The search payload is already the complete course record — Coursedog has
    // no richer detail endpoint to spend a round trip on.
    return {
      ...course,
      raw_scraped_content: [
        `${course.course_number} — ${course.title}`,
        course.description,
        course.prerequisites ? `Prerequisites: ${course.prerequisites}` : null,
        course.credits ? `Credits: ${course.credits}` : null,
      ]
        .filter(Boolean)
        .join('\n\n')
        .slice(0, 40_000),
    };
  },
};

/* ------------------------------------------------------------------ helpers */

async function getJson(url: string, origin: string): Promise<unknown | null> {
  const res = await scrapeFetch(url, {
    headers: { origin, referer: `${origin}/`, accept: 'application/json' },
  });
  if (!res.ok || !res.html) return null;
  try {
    return JSON.parse(res.html);
  } catch {
    return null;
  }
}

async function fetchCoursePage(
  config: CoursedogConfig,
  options: { skip: number; limit: number; departments?: string },
): Promise<{ listLength: number; data: CoursedogCourse[] }> {
  const params = new URLSearchParams({
    catalogId: config.catalogId,
    skip: String(options.skip),
    limit: String(options.limit),
    orderBy: 'code',
    formatDependents: 'false',
  });
  if (options.departments) params.set('departments', options.departments);

  // The `$filters` path segment must stay percent-encoded.
  const url = `${API_ROOT}/cm/${config.school}/courses/search/%24filters?${params.toString()}`;
  const json = (await getJson(url, config.origin)) as {
    listLength?: number;
    data?: CoursedogCourse[];
  } | null;

  return { listLength: json?.listLength ?? 0, data: json?.data ?? [] };
}

/**
 * Learns the tenant slug, catalog id and search-config id by watching the SPA's
 * own API traffic once.
 */
async function resolveConfig(ctx: ScrapeCtx): Promise<CoursedogConfig | null> {
  const cached = ctx.state.coursedog as CoursedogConfig | undefined;
  if (cached) return cached;

  let origin: string;
  try {
    origin = new URL(ctx.catalogUrl).origin;
  } catch {
    return null;
  }

  ctx.onProgress?.('Reading the Coursedog catalog API');

  const coursesUrl = joinPath(ctx.catalogUrl, 'courses');
  const intercepted = await scrapeIntercept(coursesUrl, 'app\\.coursedog\\.com/api', {
    maxCaptures: 25,
    timeoutMs: 45_000,
  });

  let school: string | null = null;
  let catalogId: string | null = null;
  let searchConfigId: string | null = null;

  for (const capture of intercepted.captures) {
    const courses = capture.url.match(/\/api\/v1\/cm\/([^/]+)\/courses\/search/i);
    if (courses) {
      school = courses[1];
      const id = new URL(capture.url).searchParams.get('catalogId');
      if (id) catalogId = id;
    }

    const search = capture.url.match(/\/api\/v1\/ca\/([^/]+)\/search-configurations\/([^/?]+)/i);
    if (search) {
      school ??= search[1];
      searchConfigId = search[2];
    }
  }

  if (!school || !catalogId) return null;

  return { school, catalogId, searchConfigId: searchConfigId ?? undefined, origin };
}

function joinPath(base: string, path: string): string {
  try {
    return new URL(path, base.endsWith('/') ? base : `${base}/`).toString();
  } catch {
    return base;
  }
}

function toCourseRaw(raw: CoursedogCourse, ctx: ScrapeCtx): CourseRaw | null {
  if (raw.status && raw.status.toLowerCase() !== 'active') return null;

  const code = clean(raw.code ?? '');
  const subject = clean(raw.subjectCode ?? '');
  const number = clean(raw.courseNumber ?? '');

  // `code` is the printed identifier ("ANTH W3"); fall back to subject+number.
  const course_number = code || (subject && number ? `${subject} ${number}` : '');
  if (!course_number) return null;

  const prerequisites = clean(
    stripHtml(raw.requisites?.requisitesFreeform?.value ?? ''),
  );

  const parsed = CourseRawSchema.safeParse({
    course_number,
    title: clean(raw.name ?? raw.longName ?? course_number),
    description: clean(stripHtml(raw.description ?? '')) || null,
    credits: formatCredits(raw.credits),
    prerequisites: prerequisites || null,
    instructors: instructorsOf(raw),
    source_url: ctx.catalogUrl,
  });

  return parsed.success ? parsed.data : null;
}

function formatCredits(credits: CoursedogCourse['credits']): string | null {
  if (!credits) return null;
  const { min, max } = credits.creditHours ?? {};
  if (min != null && max != null && min !== max) return `${min}-${max} credits`;
  const value = credits.numberOfCredits ?? min;
  if (value == null) return null;
  return `${value} ${value === 1 ? 'credit' : 'credits'}`;
}

function instructorsOf(raw: CoursedogCourse): string[] | null {
  const names = raw.customFields?.instructorNames;
  if (typeof names !== 'string') return null;
  const list = names
    .split(/[;,]/)
    .map((n) => clean(n))
    .filter((n) => n.length > 2 && n.toUpperCase() !== 'STAFF');
  return list.length ? list.slice(0, 10) : null;
}

function stripHtml(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, ' ')
    .replace(/<\/p>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&#39;|&rsquo;/g, "'")
    .replace(/&quot;|&ldquo;|&rdquo;/g, '"');
}
