import 'server-only';

import * as cheerio from 'cheerio';

import { scrapeFetch } from '../client';
import {
  CourseRawSchema,
  DepartmentRawSchema,
  type CourseRaw,
  type DepartmentRaw,
} from '@/lib/validation/schemas';
import { absolute, clean, extractPrerequisites, splitCourseTitle, type CatalogAdapter, type ScrapeCtx } from './types';
import { dedupeByNumber } from './courseleaf';

const MAX_PAGES = 40;

/**
 * Acalog (Modern Campus Catalog) — server-rendered PHP. Everything is static,
 * so this adapter never needs the browser. The course index is paginated via
 * `filter[cpage]`; detail lives on the popup-free `preview_course_nopop.php`.
 */
export const acalogAdapter: CatalogAdapter = {
  id: 'acalog',
  label: 'Acalog',

  detect(html, url) {
    const haystack = html.toLowerCase();
    return (
      haystack.includes('acalog') ||
      haystack.includes('content.php?catoid=') ||
      haystack.includes('preview_course_nopop.php') ||
      /\/(content|catalog)\.php\?/i.test(url)
    );
  },

  async getDepartments(ctx) {
    const index = await findCourseIndex(ctx);
    if (!index) return [];

    ctx.state.acalogIndex = index.url;
    ctx.state.catoid = index.catoid;
    ctx.state.navoid = index.navoid;

    const $ = cheerio.load(index.html);
    const found = new Map<string, DepartmentRaw>();

    // Departments are the options of the prefix/filter dropdown on the index.
    $('select option').each((_i, el) => {
      const label = clean($(el).text());
      const value = clean($(el).attr('value') ?? '');
      if (!label || !value || value === '0' || value === '-1') return;
      if (/^(select|all|choose|--)/i.test(label)) return;

      const paren = label.match(/^(.*?)\s*\(([A-Za-z&\s]{1,12})\)\s*$/);
      const lead = label.match(/^([A-Z][A-Z&]{1,9})\s*[-–—:]\s*(.+)$/);

      let code: string;
      let name: string;
      if (lead) {
        code = lead[1];
        name = lead[2];
      } else if (paren) {
        name = paren[1];
        code = paren[2].replace(/\s+/g, '');
      } else {
        return;
      }

      const parsed = DepartmentRawSchema.safeParse({
        code,
        name,
        url: `${index.url}${index.url.includes('?') ? '&' : '?'}filter%5B27%5D=${encodeURIComponent(value)}`,
      });
      if (parsed.success && !found.has(parsed.data.code)) found.set(parsed.data.code, parsed.data);
    });

    if (found.size >= 3) return [...found.values()].sort((a, b) => a.code.localeCompare(b.code));

    // Some installs omit the dropdown; derive subjects from the course prefixes.
    const courses = await paginateCourses(index.url, ctx);
    for (const course of courses) {
      const code = course.course_number.split(/[\s-]/)[0]?.toUpperCase();
      if (!code || code.length > 10) continue;
      if (!found.has(code)) {
        const parsed = DepartmentRawSchema.safeParse({ code, name: code, url: index.url });
        if (parsed.success) found.set(code, parsed.data);
      }
    }
    ctx.state.acalogCourses = courses;

    return [...found.values()].sort((a, b) => a.code.localeCompare(b.code));
  },

  async getCourses(ctx, dept) {
    const cached = ctx.state.acalogCourses as CourseRaw[] | undefined;
    if (cached?.length) {
      const prefix = dept.code.toUpperCase();
      const filtered = cached.filter((c) => c.course_number.toUpperCase().startsWith(prefix));
      if (filtered.length) return filtered;
    }

    const indexUrl = dept.url ?? (ctx.state.acalogIndex as string | undefined);
    if (!indexUrl) return [];

    const all = await paginateCourses(indexUrl, ctx, dept.code);
    const prefix = dept.code.toUpperCase();
    const filtered = all.filter((c) => c.course_number.toUpperCase().startsWith(prefix));
    return filtered.length ? filtered : all;
  },

  async getCourseDetail(ctx, course) {
    if (!course.source_url || !/preview_course/i.test(course.source_url)) {
      return { ...course, raw_scraped_content: course.description ?? null };
    }

    const res = await scrapeFetch(course.source_url);
    if (!res.ok || !res.html) return { ...course, raw_scraped_content: course.description ?? null };

    const $ = cheerio.load(res.html);
    $('script, style, nav, footer').remove();
    const body = clean($('#course_preview_title').parent().text() || $('body').text());

    return {
      ...course,
      description: course.description ?? body.slice(0, 8000),
      prerequisites: course.prerequisites ?? extractPrerequisites(body),
      raw_scraped_content: body.slice(0, 40_000),
    };
  },
};

/* ------------------------------------------------------------------ helpers */

interface AcalogIndex {
  url: string;
  html: string;
  catoid: string | null;
  navoid: string | null;
}

async function findCourseIndex(ctx: ScrapeCtx): Promise<AcalogIndex | null> {
  const $root = cheerio.load(ctx.rootHtml);
  const candidates: string[] = [];

  $root('a[href]').each((_i, el) => {
    const href = absolute($root(el).attr('href'), ctx.catalogUrl);
    const text = clean($root(el).text()).toLowerCase();
    if (!href) return;
    if (!/content\.php\?/i.test(href)) return;
    if (/course/i.test(text) || /course/i.test(href)) candidates.push(href);
  });

  if (/preview_course|content\.php\?/i.test(ctx.catalogUrl)) candidates.unshift(ctx.catalogUrl);

  for (const url of candidates.slice(0, 6)) {
    ctx.onProgress?.('Locating Acalog course index');
    const res = await scrapeFetch(url);
    if (!res.ok || !res.html) continue;
    if (!/preview_course|acalog-course|course_preview/i.test(res.html)) continue;

    const parsed = new URL(res.finalUrl);
    return {
      url: res.finalUrl,
      html: res.html,
      catoid: parsed.searchParams.get('catoid'),
      navoid: parsed.searchParams.get('navoid'),
    };
  }

  return null;
}

async function paginateCourses(indexUrl: string, ctx: ScrapeCtx, label?: string): Promise<CourseRaw[]> {
  const collected: CourseRaw[] = [];
  const seenNumbers = new Set<string>();

  for (let page = 1; page <= MAX_PAGES; page++) {
    const url = withPage(indexUrl, page);
    ctx.onProgress?.(`Reading ${label ?? 'catalog'} page ${page}`);

    const res = await scrapeFetch(url);
    if (!res.ok || !res.html) break;

    const pageCourses = parseAcalogList(res.html, res.finalUrl);
    let added = 0;
    for (const course of pageCourses) {
      const key = course.course_number.toUpperCase().replace(/[^A-Z0-9]/g, '');
      if (seenNumbers.has(key)) continue;
      seenNumbers.add(key);
      collected.push(course);
      added++;
    }

    // Acalog keeps serving the last page forever — stop when nothing is new.
    if (added === 0) break;
  }

  return dedupeByNumber(collected);
}

function withPage(url: string, page: number): string {
  try {
    const u = new URL(url);
    u.searchParams.set('filter[cpage]', String(page));
    return u.toString();
  } catch {
    return url;
  }
}

function parseAcalogList(html: string, baseUrl: string): CourseRaw[] {
  const $ = cheerio.load(html);
  const courses: CourseRaw[] = [];

  $('a[href*="preview_course"]').each((_i, el) => {
    const text = clean($(el).text());
    if (!text || text.length < 4) return;

    const { course_number, title, credits } = splitCourseTitle(text);
    if (!course_number || !title) return;

    // The description usually sits in the sibling block after the link.
    const container = $(el).closest('li, td, div');
    const description = clean(container.text()).replace(text, '').slice(0, 4000) || null;

    const parsed = CourseRawSchema.safeParse({
      course_number,
      title,
      description,
      credits,
      prerequisites: description ? extractPrerequisites(description) : null,
      source_url: absolute($(el).attr('href'), baseUrl) ?? baseUrl,
    });
    if (parsed.success) courses.push(parsed.data);
  });

  return courses;
}
