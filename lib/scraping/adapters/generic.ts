import 'server-only';

import * as cheerio from 'cheerio';

import { extractObject } from '@/lib/ai/extract';
import { scrapeCrawl, scrapeFetch, scrapeRender } from '../client';
import {
  CourseListSchema,
  CourseRawSchema,
  DepartmentListSchema,
  type CourseRaw,
  type DepartmentRaw,
} from '@/lib/validation/schemas';
import { absolute, clean, extractPrerequisites, splitCourseTitle, type CatalogAdapter, type ScrapeCtx } from './types';
import { dedupeByNumber } from './courseleaf';

const MAX_MARKDOWN = 60_000;

/**
 * Last-resort adapter for catalogs we have no fingerprint for. Renders to
 * markdown and hands it to the fast model with the same Zod schemas every other
 * adapter returns, so downstream code stays platform-agnostic.
 *
 * Colleges landing here are logged so purpose-built adapters can be added later.
 */
export const genericAdapter: CatalogAdapter = {
  id: 'generic',
  label: 'Generic',

  // Registry tries this last, so it always claims whatever is left.
  detect() {
    return true;
  },

  async getDepartments(ctx) {
    console.info(`[scraping] generic adapter handling ${ctx.domain} (${ctx.catalogUrl})`);
    ctx.onProgress?.('No known catalog platform — using AI extraction');

    // A heuristic pass first: it's free and usually enough.
    const heuristic = heuristicDepartments(ctx.rootHtml, ctx.catalogUrl);
    if (heuristic.length >= 8) return heuristic;

    const rendered = await scrapeRender(ctx.catalogUrl, { waitUntil: 'networkidle' });
    const markdown = rendered.markdown || (await fetchMarkdown(ctx.catalogUrl));
    if (markdown) {
      ctx.onProgress?.('Extracting departments with AI');
      const extracted = await extractObject({
        schema: DepartmentListSchema,
    operation: 'extract_departments',
        system:
          'You extract academic department/subject lists from university course catalog pages. ' +
          'Only return real academic subjects that appear on the page. Never invent departments.',
        prompt: buildDepartmentPrompt(ctx, markdown),
      });

      if (extracted?.departments.length) {
        const byCode = new Map<string, DepartmentRaw>();
        for (const dept of extracted.departments) {
          const url = dept.url ? absolute(dept.url, rendered.finalUrl || ctx.catalogUrl) : null;
          if (!byCode.has(dept.code)) byCode.set(dept.code, { ...dept, url });
        }
        // Merge in anything the heuristic found that the model missed.
        for (const dept of heuristic) if (!byCode.has(dept.code)) byCode.set(dept.code, dept);
        return [...byCode.values()].sort((a, b) => a.code.localeCompare(b.code));
      }
    }

    return heuristic;
  },

  async getCourses(ctx, dept) {
    const target = dept.url ?? ctx.catalogUrl;
    ctx.onProgress?.(`Reading ${dept.code} course list`);

    let markdown = await fetchMarkdown(target);
    let sourceUrl = target;

    if (markdown.length < 400) {
      const rendered = await scrapeRender(target, { waitUntil: 'networkidle' });
      markdown = rendered.markdown;
      sourceUrl = rendered.finalUrl || target;
    }

    const heuristic = heuristicCourses(markdown, sourceUrl);
    if (heuristic.length >= 5) return heuristic;

    // Course lists sometimes span pages that aren't linked from one another.
    if (markdown.length < 1000) {
      ctx.onProgress?.(`Crawling for ${dept.code} course pages`);
      const crawl = await scrapeCrawl(target, {
        maxDepth: 2,
        maxPages: 12,
        includePattern: escapeRegExp(dept.code.toLowerCase()),
      });
      markdown = crawl.pages.map((p) => p.markdown).join('\n\n---\n\n');
    }

    if (!markdown.trim()) return heuristic;

    ctx.onProgress?.(`Extracting ${dept.code} courses with AI`);
    const extracted = await extractObject({
      schema: CourseListSchema,
    operation: 'extract_courses',
      system:
        'You extract course listings from university catalog pages. Copy values exactly as they ' +
        'appear. Never invent a course that is not on the page. Omit fields that are absent.',
      prompt: buildCoursePrompt(ctx, dept, markdown),
    });

    const aiCourses = (extracted?.courses ?? []).map((c) => ({
      ...c,
      source_url: c.source_url ? (absolute(c.source_url, sourceUrl) ?? sourceUrl) : sourceUrl,
    }));

    return dedupeByNumber([...aiCourses, ...heuristic]);
  },

  async getCourseDetail(ctx, course) {
    const target = course.source_url ?? ctx.catalogUrl;
    let markdown = await fetchMarkdown(target);

    if (markdown.length < 300) {
      const rendered = await scrapeRender(target, { waitUntil: 'networkidle' });
      markdown = rendered.markdown;
    }

    // Narrow the page down to the passage mentioning this course.
    const focused = focusOnCourse(markdown, course.course_number);

    const extracted = await extractObject({
      schema: CourseListSchema,
    operation: 'extract_courses',
      system: 'Extract the single course matching the requested course number. Copy text verbatim.',
      prompt:
        `Course number: ${course.course_number}\nCourse title: ${course.title}\n\n` +
        `Return exactly one course object for this course, using only the page content below.\n\n` +
        `<page>\n${focused.slice(0, 20_000)}\n</page>`,
    });

    const detail = extracted?.courses?.[0];

    return {
      ...course,
      description: detail?.description ?? course.description,
      credits: detail?.credits ?? course.credits,
      prerequisites: detail?.prerequisites ?? course.prerequisites ?? extractPrerequisites(focused),
      instructors: detail?.instructors ?? course.instructors,
      terms_offered: detail?.terms_offered ?? course.terms_offered,
      syllabus_url: detail?.syllabus_url
        ? absolute(detail.syllabus_url, target)
        : (course.syllabus_url ?? findSyllabusLink(markdown, target)),
      raw_scraped_content: focused.slice(0, 40_000) || markdown.slice(0, 40_000),
    };
  },
};

/* ------------------------------------------------------------------ prompts */

function buildDepartmentPrompt(ctx: ScrapeCtx, markdown: string): string {
  return [
    `College: ${ctx.collegeName} (${ctx.domain})`,
    `Catalog page: ${ctx.catalogUrl}`,
    '',
    'Extract every academic department or subject listed on this catalog page.',
    '- `code` is the short subject abbreviation (CS, MATH, ECON). If only a name is shown, derive a sensible code.',
    '- `name` is the full department name.',
    '- `url` is the absolute or relative link to that subject\'s course list, when one is present.',
    'Ignore navigation, policies, admissions, and non-academic links.',
    '',
    `<page>\n${markdown.slice(0, MAX_MARKDOWN)}\n</page>`,
  ].join('\n');
}

function buildCoursePrompt(ctx: ScrapeCtx, dept: DepartmentRaw, markdown: string): string {
  return [
    `College: ${ctx.collegeName}`,
    `Department: ${dept.code} — ${dept.name}`,
    '',
    'Extract every course listed on this page.',
    '- `course_number` exactly as printed (e.g. "CS 229", "6.006", "MATH-101").',
    '- `title` is the course title without the number or credits.',
    '- Include description, credits, prerequisites, instructors and terms only when shown.',
    'Do not invent courses. If the page lists none, return an empty array.',
    '',
    `<page>\n${markdown.slice(0, MAX_MARKDOWN)}\n</page>`,
  ].join('\n');
}

/* ----------------------------------------------------------------- heuristics */

async function fetchMarkdown(url: string): Promise<string> {
  const res = await scrapeFetch(url);
  if (!res.ok || !res.html) return '';
  const $ = cheerio.load(res.html);
  $('script, style, nav, footer, header, noscript').remove();
  return clean($('main').text() || $('body').text()).slice(0, MAX_MARKDOWN);
}

function heuristicDepartments(html: string, baseUrl: string): DepartmentRaw[] {
  const $ = cheerio.load(html);
  const found = new Map<string, DepartmentRaw>();

  $('a[href]').each((_i, el) => {
    const text = clean($(el).text());
    const href = absolute($(el).attr('href'), baseUrl);
    if (!text || !href || text.length > 100) return;

    const paren = text.match(/^(.*?)\s*\(([A-Z][A-Z&]{1,9})\)\s*$/);
    const lead = text.match(/^([A-Z][A-Z&]{1,9})\s*[-–—:]\s*(.{3,})$/);
    if (!paren && !lead) return;

    const code = (paren ? paren[2] : lead![1]).replace(/\s+/g, '');
    const name = clean(paren ? paren[1] : lead![2]);
    if (!code || !name) return;
    if (!found.has(code)) found.set(code, { code: code.toUpperCase(), name, url: href });
  });

  return [...found.values()].sort((a, b) => a.code.localeCompare(b.code));
}

/** Catches the very common "CS 229. Machine Learning. 3 Units." line format. */
function heuristicCourses(text: string, sourceUrl: string): CourseRaw[] {
  const courses: CourseRaw[] = [];
  const lines = text.split('\n');

  for (let i = 0; i < lines.length; i++) {
    const line = clean(lines[i]);
    if (line.length < 8 || line.length > 300) continue;
    if (!/^[A-Z][A-Z&]{1,9}[\s-]?\d/.test(line)) continue;

    const { course_number, title, credits } = splitCourseTitle(line);
    if (!course_number || !title || title.length < 3) continue;

    const description = clean(lines.slice(i + 1, i + 4).join(' ')).slice(0, 4000);
    const parsed = CourseRawSchema.safeParse({
      course_number,
      title,
      description: description || null,
      credits,
      prerequisites: extractPrerequisites(description),
      source_url: sourceUrl,
    });
    if (parsed.success) courses.push(parsed.data);
  }

  return dedupeByNumber(courses);
}

function focusOnCourse(markdown: string, courseNumber: string): string {
  const needle = courseNumber.replace(/\s+/g, '\\s*');
  const match = markdown.match(new RegExp(`${needle}[\\s\\S]{0,4000}`, 'i'));
  return match ? match[0] : markdown.slice(0, 8000);
}

function findSyllabusLink(markdown: string, baseUrl: string): string | null {
  const match = markdown.match(/\[(?:[^\]]*syllab[^\]]*)\]\(([^)]+)\)/i);
  return match ? absolute(match[1], baseUrl) : null;
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
