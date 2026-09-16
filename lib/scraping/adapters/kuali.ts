import 'server-only';

import { scrapeFetch, scrapeIntercept } from '../client';
import {
  CourseRawSchema,
  DepartmentRawSchema,
  type CourseRaw,
  type DepartmentRaw,
} from '@/lib/validation/schemas';
import { clean, extractPrerequisites, type CatalogAdapter, type ScrapeCtx } from './types';
import { dedupeByNumber } from './courseleaf';

interface KualiCourse {
  pid?: string;
  __catalogCourseId?: string;
  subjectCode?: string | { name?: string; id?: string };
  code?: string;
  number?: string;
  title?: string;
  description?: string;
  credits?: unknown;
  requisites?: string;
  [key: string]: unknown;
}

/**
 * Kuali Catalog — a React SPA. Its own bundle calls a JSON API; we capture those
 * calls once with /intercept and then talk to the API directly with cheap static
 * fetches. We never scrape the rendered DOM when the JSON is available.
 */
export const kualiAdapter: CatalogAdapter = {
  id: 'kuali',
  label: 'Kuali',

  detect(html, url) {
    const haystack = html.toLowerCase();
    return (
      haystack.includes('kuali') ||
      /kuali\.co/i.test(url) ||
      (haystack.includes('id="root"') && haystack.includes('/api/v1/catalog'))
    );
  },

  async getDepartments(ctx) {
    const courses = await loadAllCourses(ctx);
    if (!courses.length) return [];

    ctx.state.kualiCourses = courses;

    const found = new Map<string, DepartmentRaw>();
    for (const course of courses) {
      const code = subjectOf(course);
      if (!code) continue;
      if (found.has(code)) continue;
      const parsed = DepartmentRawSchema.safeParse({
        code,
        name: subjectNameOf(course) ?? code,
      });
      if (parsed.success) found.set(parsed.data.code, parsed.data);
    }

    return [...found.values()].sort((a, b) => a.code.localeCompare(b.code));
  },

  async getCourses(ctx, dept) {
    const all = (ctx.state.kualiCourses as KualiCourse[] | undefined) ?? (await loadAllCourses(ctx));
    const matching = all.filter((c) => subjectOf(c) === dept.code);

    const out: CourseRaw[] = [];
    for (const course of matching) {
      const parsed = toCourseRaw(course, ctx);
      if (parsed) out.push(parsed);
    }
    return dedupeByNumber(out);
  },

  async getCourseDetail(ctx, course) {
    const catalogId = ctx.state.kualiCatalogId as string | undefined;
    const apiBase = ctx.state.kualiApiBase as string | undefined;
    const pid = (ctx.state.kualiPidByNumber as Record<string, string> | undefined)?.[
      course.course_number.toUpperCase()
    ];

    if (apiBase && catalogId && pid) {
      const res = await scrapeFetch(`${apiBase}/api/v1/catalog/course/${catalogId}/${pid}`);
      if (res.ok && res.html) {
        try {
          const detail = JSON.parse(res.html) as KualiCourse;
          const description = stripHtml(String(detail.description ?? course.description ?? ''));
          return {
            ...course,
            description: description || course.description,
            prerequisites: stripHtml(String(detail.requisites ?? '')) || course.prerequisites,
            raw_scraped_content: JSON.stringify(detail).slice(0, 40_000),
          };
        } catch {
          /* fall through to the cached summary */
        }
      }
    }

    return {
      ...course,
      raw_scraped_content: [course.title, course.description, course.prerequisites]
        .filter(Boolean)
        .join('\n\n'),
    };
  },
};

/* ------------------------------------------------------------------ helpers */

async function loadAllCourses(ctx: ScrapeCtx): Promise<KualiCourse[]> {
  ctx.onProgress?.('Capturing Kuali catalog API');

  const intercepted = await scrapeIntercept(ctx.catalogUrl, '/api/v1/catalog/', {
    waitFor: '#root',
    maxCaptures: 20,
  });

  let origin: string;
  try {
    origin = new URL(intercepted.finalUrl || ctx.catalogUrl).origin;
  } catch {
    origin = ctx.catalogUrl;
  }
  ctx.state.kualiApiBase = origin;

  // The courses payload is the biggest array the SPA pulls down.
  let best: KualiCourse[] = [];
  for (const capture of intercepted.captures) {
    const idMatch = capture.url.match(/\/api\/v1\/catalog\/(?:courses|programs)\/([a-z0-9]+)/i);
    if (idMatch) ctx.state.kualiCatalogId = idMatch[1];

    const rows = asCourseArray(capture.json);
    if (rows.length > best.length) best = rows;
  }

  // With the catalog id known we can hit the courses endpoint directly — this
  // catches installs where the SPA lazily paginates instead of bulk-loading.
  const catalogId = ctx.state.kualiCatalogId as string | undefined;
  if (catalogId) {
    const direct = await scrapeFetch(`${origin}/api/v1/catalog/courses/${catalogId}`);
    if (direct.ok && direct.html) {
      try {
        const rows = asCourseArray(JSON.parse(direct.html));
        if (rows.length > best.length) best = rows;
      } catch {
        /* not JSON — keep whatever intercept found */
      }
    }
  }

  const pidByNumber: Record<string, string> = {};
  for (const course of best) {
    const number = numberOf(course);
    const pid = course.pid ?? course.__catalogCourseId;
    if (number && typeof pid === 'string') pidByNumber[number.toUpperCase()] = pid;
  }
  ctx.state.kualiPidByNumber = pidByNumber;

  return best;
}

function asCourseArray(json: unknown): KualiCourse[] {
  if (Array.isArray(json)) return json.filter((r) => r && typeof r === 'object') as KualiCourse[];
  if (json && typeof json === 'object') {
    for (const key of ['courses', 'data', 'items', 'results']) {
      const value = (json as Record<string, unknown>)[key];
      if (Array.isArray(value)) return value.filter((r) => r && typeof r === 'object') as KualiCourse[];
    }
  }
  return [];
}

function subjectOf(course: KualiCourse): string | null {
  const raw = course.subjectCode;
  const fromField =
    typeof raw === 'string' ? raw : typeof raw === 'object' && raw ? (raw.name ?? null) : null;
  if (fromField) return clean(fromField).toUpperCase().slice(0, 12) || null;

  const code = typeof course.code === 'string' ? course.code : null;
  const match = code?.match(/^([A-Za-z&]{2,10})/);
  return match ? match[1].toUpperCase() : null;
}

function subjectNameOf(course: KualiCourse): string | null {
  const raw = course.subjectCode;
  if (raw && typeof raw === 'object' && typeof raw.name === 'string') return clean(raw.name);
  return null;
}

function numberOf(course: KualiCourse): string | null {
  const subject = subjectOf(course);
  const number = course.number ?? course.code;
  if (typeof number !== 'string') return null;
  const trimmed = clean(number);
  if (subject && trimmed.toUpperCase().startsWith(subject)) return trimmed;
  return subject ? `${subject} ${trimmed}` : trimmed;
}

function toCourseRaw(course: KualiCourse, ctx: ScrapeCtx): CourseRaw | null {
  const course_number = numberOf(course);
  if (!course_number) return null;

  const description = stripHtml(String(course.description ?? ''));
  const parsed = CourseRawSchema.safeParse({
    course_number,
    title: clean(String(course.title ?? course_number)),
    description: description || null,
    credits: creditsOf(course),
    prerequisites: stripHtml(String(course.requisites ?? '')) || extractPrerequisites(description),
    source_url: ctx.catalogUrl,
  });
  return parsed.success ? parsed.data : null;
}

function creditsOf(course: KualiCourse): string | null {
  const credits = course.credits;
  if (typeof credits === 'string' || typeof credits === 'number') return String(credits);
  if (credits && typeof credits === 'object') {
    const value = credits as { value?: unknown; chosen?: unknown; min?: unknown; max?: unknown };
    if (value.value != null) return String(value.value);
    if (value.min != null && value.max != null) return `${value.min}-${value.max}`;
    if (value.chosen != null) return String(value.chosen);
  }
  return null;
}

function stripHtml(html: string): string {
  return clean(
    html
      .replace(/<br\s*\/?>/gi, ' ')
      .replace(/<[^>]+>/g, ' ')
      .replace(/&nbsp;/g, ' ')
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&#39;/g, "'")
      .replace(/&quot;/g, '"'),
  );
}
