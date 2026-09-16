import 'server-only';

import * as cheerio from 'cheerio';

import { scrapeFetch } from '../client';
import {
  CourseRawSchema,
  DepartmentRawSchema,
  type CourseRaw,
  type DepartmentRaw,
} from '@/lib/validation/schemas';
import {
  absolute,
  clean,
  extractPrerequisites,
  splitCourseTitle,
  type CatalogAdapter,
  type ScrapeCtx,
} from './types';

/**
 * CourseLeaf (CAT) — by far the most common catalog platform among top-200
 * schools. Pages are server-rendered, so the whole adapter runs on static
 * /fetch; no browser needed.
 */
export const courseleafAdapter: CatalogAdapter = {
  id: 'courseleaf',
  label: 'CourseLeaf',

  detect(html, url) {
    const haystack = html.toLowerCase();
    return (
      haystack.includes('courseleaf') ||
      haystack.includes('/ribbit/') ||
      haystack.includes('lfjsobjects') ||
      haystack.includes('class="courseblock') ||
      haystack.includes("class='courseblock") ||
      /catalog\.[^/]+\/(?:courses|coursesaz)/i.test(url)
    );
  },

  async getDepartments(ctx) {
    const direct = await findSubjectIndex(ctx, ctx.catalogUrl);
    if (direct && direct.departments.length >= STRONG_INDEX_SIZE) {
      ctx.state.coursesRoot = direct.url;
      return direct.departments;
    }

    // Some CourseLeaf installs are a hub of sub-catalogs rather than a catalog:
    // Yale's root just links to /ycps/ and /gsas/, and the subject index lives a
    // level down. Follow those links and try the same paths beneath each.
    //
    // Take the largest index found rather than the first plausible one — a
    // handbook or policy section can easily yield a handful of link-shaped
    // false positives, and the real subject list is always far bigger.
    const candidates = direct ? [direct] : [];

    for (const base of findSubCatalogs(ctx.rootHtml, ctx.catalogUrl)) {
      ctx.onProgress?.(`Looking inside ${shortUrl(base)}`);
      const nested = await findSubjectIndex(ctx, base);
      if (nested) {
        candidates.push(nested);
        if (nested.departments.length >= STRONG_INDEX_SIZE) break;
      }
    }

    const best = candidates.sort((a, b) => b.departments.length - a.departments.length)[0];
    if (!best || best.departments.length < MIN_INDEX_SIZE) return [];

    ctx.state.coursesRoot = best.url;
    return best.departments;
  },

  async getCourses(ctx, dept) {
    const url =
      dept.url ??
      joinUrl(String(ctx.state.coursesRoot ?? ctx.catalogUrl), `${dept.code.toLowerCase()}/`);
    ctx.onProgress?.(`Fetching ${dept.code} course list`);

    const res = await scrapeFetch(url);
    const fromSubjectPage =
      res.ok && res.html ? parseCourseBlocks(res.html, res.finalUrl, dept.code) : [];
    if (fromSubjectPage.length) return fromSubjectPage;

    // Some CourseLeaf installs (Yale) put only the program narrative on the
    // subject page and keep the course inventory in the catalog-wide search.
    // `/search/?P=<CODE>` is a stock CourseLeaf endpoint, so this is a general
    // fallback rather than a per-school special case.
    ctx.onProgress?.(`Searching the catalog for ${dept.code} courses`);
    const search = await scrapeFetch(searchUrl(ctx.catalogUrl, dept.code));
    if (!search.ok || !search.html) return [];

    return parseSearchResults(search.html, search.finalUrl, dept.code);
  },

  async getCourseDetail(ctx, course) {
    // The subject page's courseblock is already the richest CourseLeaf source,
    // and `source_url` points at it — so read that first.
    if (course.source_url) {
      const page = await scrapeFetch(course.source_url);
      if (page.ok && page.html) {
        const $ = cheerio.load(page.html);
        const block = $('.courseblock')
          .filter((_i, el) =>
            normalize($(el).find('.courseblocktitle').text()).startsWith(normalize(course.course_number)),
          )
          .first();

        if (block.length) {
          const blockHtml = `<div class="courseblock">${block.html() ?? ''}</div>`;
          const [detail] = parseCourseBlocks(blockHtml, course.source_url);
          return {
            ...mergeCourse(course, detail),
            raw_scraped_content: blockToMarkdown(blockHtml),
          };
        }
      }
    }

    // Fallback: CourseLeaf's single-course AJAX endpoint.
    const subject = course.course_number.split(/[\s-]/)[0];
    const number = course.course_number.slice(subject.length).trim();
    const ribbit = joinUrl(
      ctx.catalogUrl,
      `ribbit/index.cgi?page=getcourse.rjs&code=${encodeURIComponent(`${subject} ${number}`)}`,
    );

    const res = await scrapeFetch(ribbit);
    if (res.ok && res.html && res.html.includes('courseblock')) {
      const fragment = unwrapRibbit(res.html);
      const parsed = parseCourseBlocks(fragment, course.source_url ?? ctx.catalogUrl);
      const match = parsed.find(
        (candidate) => normalize(candidate.course_number) === normalize(course.course_number),
      );
      if (match) {
        return { ...mergeCourse(course, match), raw_scraped_content: blockToMarkdown(fragment) };
      }
    }

    return { ...course, raw_scraped_content: course.description ?? null };
  },
};

/* ------------------------------------------------------------------ parsing */

/** Enough subjects that we can stop looking for a better index. */
const STRONG_INDEX_SIZE = 12;
/** Below this, a page is more likely a nav fragment than a subject list. */
const MIN_INDEX_SIZE = 5;

/** Where a CourseLeaf subject A-Z index usually lives, relative to a catalog root. */
const SUBJECT_INDEX_PATHS = [
  'courses/',
  'subjects/',
  'subjects-of-instruction/',
  'courses-of-instruction/',
  'coursesaz/',
  'course-descriptions/',
  'azcourses/',
  '',
];

/** Probes the usual subject-index paths beneath `base`, returning the first that parses. */
async function findSubjectIndex(
  ctx: ScrapeCtx,
  base: string,
): Promise<{ url: string; departments: DepartmentRaw[] } | null> {
  for (const path of SUBJECT_INDEX_PATHS) {
    const url = path ? joinUrl(base, path) : base;
    ctx.onProgress?.(`Reading subject index at ${shortUrl(url)}`);

    const res = await scrapeFetch(url);
    if (!res.ok || !res.html) continue;

    const departments = parseSubjectIndex(res.html, res.finalUrl);
    if (departments.length >= MIN_INDEX_SIZE) return { url: res.finalUrl, departments };
  }
  return null;
}

/**
 * Same-origin, one-segment-deep links from a catalog hub page, best first.
 *
 * A hub links to far more than its catalogs (support pages, admin sections), so
 * candidates are ranked by how catalog-like the slug and link text look — Yale's
 * "/ycps/ Yale College Programs of Study" has to beat "/global-affairs/".
 */
function findSubCatalogs(html: string, catalogUrl: string): string[] {
  let origin: string;
  try {
    origin = new URL(catalogUrl).origin;
  } catch {
    return [];
  }

  const $ = cheerio.load(html);
  const scored = new Map<string, number>();

  $('a[href]').each((_i, el) => {
    const href = absolute($(el).attr('href'), catalogUrl);
    if (!href || !href.startsWith(origin)) return;

    let parsed: URL;
    try {
      parsed = new URL(href);
    } catch {
      return;
    }

    const segments = parsed.pathname.split('/').filter(Boolean);
    if (segments.length !== 1) return;

    const slug = segments[0];
    if (/\.(pdf|docx?|xlsx?|html?)$/i.test(slug)) return;
    if (INDEX_SLUGS.has(slug.toLowerCase())) return;
    if (/^(search|archive|about|help|policies|admission|index)$/i.test(slug)) return;
    if (/handbook|policy|policies|calendar|archive|regulation/i.test(slug)) return;

    const text = clean($(el).text()).toLowerCase();
    let score = 0;

    // Known catalog section slugs across CourseLeaf schools.
    if (/^(ycps|gsas|college|undergraduate|graduate|catalog|bulletin|courses?)$/i.test(slug)) {
      score += 10;
    }
    if (/programs? of study|course|curriculum|catalog|bulletin|subjects/.test(text)) score += 6;
    if (/course|program|study|catalog/i.test(slug)) score += 3;
    // Short, acronym-ish slugs are usually catalog sections, not content pages.
    if (slug.length <= 6 && !slug.includes('-')) score += 2;

    scored.set(`${origin}/${slug}/`, Math.max(scored.get(`${origin}/${slug}/`) ?? 0, score));
  });

  return [...scored.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8)
    .map(([url]) => url);
}

/** Path segments that are the index itself, never a subject. */
const INDEX_SLUGS = new Set([
  'courses',
  'coursesaz',
  'subjects',
  'course-descriptions',
  'courses-of-instruction',
  'azcourses',
  'index',
  '',
]);

function parseSubjectIndex(html: string, baseUrl: string): DepartmentRaw[] {
  const $ = cheerio.load(html);
  const found = new Map<string, DepartmentRaw>();

  // CourseLeaf A–Z indexes render one link per subject. The shapes vary by
  // school: "Computer Science (CS)", "CS - Computer Science", and MIT's
  // "Aeronautics and Astronautics (Course 16)" with a numeric slug.
  $('a[href]').each((_i, el) => {
    const href = absolute($(el).attr('href'), baseUrl);
    if (!href) return;
    if (
      !/\/(courses|coursesaz|subjects|subjects-of-instruction|course-descriptions|courses-of-instruction|azcourses)\//i.test(
        href,
      )
    ) {
      return;
    }

    const text = clean($(el).text()).replace(/\u200b/g, '');
    if (!text || text.length > 120) return;

    // Catalogs link a printable PDF of the index alongside the real subjects.
    if (/\.(pdf|docx?|xlsx?|csv)(\?|$)/i.test(href)) return;

    const slug = href.replace(/[?#].*$/, '').replace(/\/$/, '').split('/').pop() ?? '';
    if (!slug || INDEX_SLUGS.has(slug.toLowerCase())) return;
    if (/\.(html?|php|aspx)$/i.test(slug)) return;

    const { code, name } = deriveSubject(text, slug);
    if (!code || !name) return;
    const parsed = DepartmentRawSchema.safeParse({ code, name, url: href });
    if (!parsed.success) return;

    const existing = found.get(parsed.data.code);
    // Prefer the entry with the more descriptive name.
    if (!existing || existing.name.length < parsed.data.name.length) {
      found.set(parsed.data.code, parsed.data);
    }
  });

  return dedupeCodes([...found.values()]).sort((a, b) => a.code.localeCompare(b.code));
}

/**
 * Works out a subject code and display name from an index link.
 *
 * Catalogs vary: some print the code ("CS - Computer Science", "Computer
 * Science (CS)"), some carry it only in the URL slug (MIT's /subjects/6/), and
 * some — Yale among them — print neither, just the department name behind a
 * word slug. In that last case an acronym of the name is the only readable key
 * available; the real course numbers still come from the course blocks, so this
 * only ever affects the badge shown next to the department.
 */
function deriveSubject(text: string, slug: string): { code: string; name: string } {
  // "CS - Computer Science"
  const lead = text.match(/^([A-Z][A-Z&]{1,9})\s*[-–—:]\s*(.{2,})$/);
  if (lead) return { code: clean(lead[1]), name: clean(lead[2]) };

  // "Computer Science (CS)" — only when the parenthetical is a bare code.
  const paren = text.match(/^(.*?)\s*\(([A-Za-z&][A-Za-z&\s]{0,11})\)\s*$/);
  if (paren) {
    return { code: clean(paren[2]).replace(/\s+/g, ''), name: clean(paren[1]) };
  }

  const name =
    clean(
      text
        // "Aeronautics and Astronautics (Course 16)"
        .replace(/\s*\([^)]*\)\s*$/, '')
        // "Course 16 Aeronautics and Astronautics"
        .replace(/^course\s+[\w.]+\s*[-–—:]?\s*/i, ''),
    ) || clean(text);

  // A short slug is a real code (MIT's "6", "cms"); a word slug is not.
  if (slug.length <= 8 && !slug.includes('-')) {
    const code = slug.toUpperCase();
    const escaped = code.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    // "AS Aerospace Studies" — the label repeats the subject code.
    return { code, name: clean(name.replace(new RegExp(`^${escaped}\\s+`, 'i'), '')) || name };
  }

  return { code: acronym(name) || slug.slice(0, 12).toUpperCase(), name };
}

const ACRONYM_STOPWORDS = new Set(['and', 'of', 'the', 'for', 'in', 'to', '&']);

function acronym(name: string): string {
  const words = name
    .replace(/[^A-Za-z\s&]/g, ' ')
    .split(/\s+/)
    .filter((word) => word && !ACRONYM_STOPWORDS.has(word.toLowerCase()));

  if (!words.length) return '';
  // A single word gets its first four letters ("Spanish" -> SPAN).
  if (words.length === 1) return words[0].slice(0, 4).toUpperCase();
  return words
    .map((word) => word[0])
    .join('')
    .slice(0, 6)
    .toUpperCase();
}

/** Derived acronyms can collide; keep them unique per index. */
function dedupeCodes(departments: DepartmentRaw[]): DepartmentRaw[] {
  const used = new Set<string>();
  return departments.map((department) => {
    let code = department.code;
    for (let n = 2; used.has(code); n++) code = `${department.code}${n}`.slice(0, 24);
    used.add(code);
    return { ...department, code };
  });
}

function parseCourseBlocks(html: string, baseUrl: string, deptCode?: string): CourseRaw[] {
  const $ = cheerio.load(html);
  const courses: CourseRaw[] = [];

  $('.courseblock').each((_i, el) => {
    const block = $(el);
    // Raw, not cleaned — parseCourseHeading needs the original spacing.
    const titleText =
      block.find('.courseblocktitle').first().text() || block.find('h3, h4, strong').first().text();
    if (!clean(titleText)) return;

    const heading = parseCourseHeading(titleText, deptCode);
    if (!heading) return;
    const { course_number, title, credits } = heading;

    const description = clean(block.find('.courseblockdesc').first().text());

    // CourseLeaf tags these fields explicitly on most installs — far more
    // reliable than mining the description prose. When the tag is present we
    // trust it outright, including when it says "None"; only an absent tag
    // falls through to regex mining.
    const prereqEl = block.find('.courseblockprereq').first();
    const taggedPrereq = clean(prereqEl.text());
    const taggedTerms = clean(block.find('.courseblockterms').first().text());
    const taggedHours = clean(block.find('.courseblockhours').first().text());
    const taggedInstructors = clean(block.find('.courseblockinstructors').first().text());

    const extras = clean(block.find('.courseblockextra, .noindent').text());
    const prose = [description, extras].filter(Boolean).join('\n\n');

    const anchor =
      block.find('a.schedlink[href]').first().attr('href') ??
      block.find('a[href^="/courses"], a[href^="/subjects"]').first().attr('href');

    const parsed = CourseRawSchema.safeParse({
      course_number,
      title,
      description: description || null,
      credits: credits ?? taggedHours ?? extractCredits(block.text()),
      prerequisites: prereqEl.length
        ? stripLabel(taggedPrereq, /^pre-?req(uisite)?s?\s*[:\-–]?\s*/i)
        : extractPrerequisites(prose),
      terms_offered: taggedTerms || extractTerms(prose),
      instructors:
        splitInstructors(taggedInstructors) ?? heading.instructors ?? extractInstructors(prose),
      source_url: absolute(anchor, baseUrl) ?? baseUrl,
    });
    if (parsed.success) courses.push(parsed.data);
  });

  return dedupeByNumber(courses);
}

export interface ParsedHeading {
  course_number: string;
  title: string;
  credits: string | null;
  instructors: string[] | null;
}

/**
 * Parses a CourseLeaf course heading.
 *
 * Handles the plain form ("CS 100 Computer Science Orientation credit: 1 Hour")
 * and Yale's denser one:
 *   "* ANTH 1171a   / ARCG 1171a, Great Civilizations of the Ancient World  Piphal Heng"
 * — an optional marker, cross-listed codes, the title after a comma, and the
 * instructors after a run of whitespace.
 *
 * `raw` must NOT have had its whitespace collapsed: the double space before the
 * instructor is the only thing separating them from the title.
 */
export function parseCourseHeading(raw: string, deptCode?: string): ParsedHeading | null {
  const heading = raw
    .replace(/\u00a0/g, ' ')
    // Markers CourseLeaf puts on cross-listed or restricted courses.
    .replace(/^[\s*•[\]]+/, '')
    .replace(/[\s[\]]+$/, '')
    .trim();
  if (!heading) return null;

  const comma = heading.indexOf(',');

  // Comma form: a list of course codes, then the title, then the instructors.
  // Cross-listed courses put several codes before the comma, separated by "/".
  const codes =
    comma > 0
      ? heading
          .slice(0, comma)
          .split('/')
          .map((part) => clean(part))
          .filter(Boolean)
      : [];

  if (codes.length && codes.every(isCourseCode)) {

    const prefix = deptCode?.toUpperCase();
    const course_number =
      (prefix && codes.find((code) => code.toUpperCase().startsWith(prefix))) || codes[0];

    const [rawTitle, ...rest] = heading.slice(comma + 1).replace(/^\s+/, '').split(/\s{2,}/);
    const withoutCredits = splitCourseTitle(clean(rawTitle));
    const title = clean(rawTitle) === withoutCredits.title ? clean(rawTitle) : withoutCredits.title;
    if (!title) return null;

    return {
      course_number,
      title,
      credits: withoutCredits.credits,
      instructors: namesFrom(rest),
    };
  }

  // Plain form: "CS 100   Computer Science Orientation   credit: 1 Hour."
  // Whitespace runs here separate the title and credits, not an instructor, so
  // the whole heading goes to splitCourseTitle rather than being split first.
  const parsed = splitCourseTitle(clean(heading));
  if (!parsed.course_number || !parsed.title) return null;

  return { ...parsed, instructors: null };
}

/** "ANTH 1171a", "CS 100", "6.1010" — a bare code, not a code plus prose. */
function isCourseCode(value: string): boolean {
  return /^[A-Za-z][A-Za-z&.]{0,9}\s?\d[\w.\-]*$/.test(value) || /^\d+[A-Za-z]?(\.[\w.]+)?$/.test(value);
}

function namesFrom(chunks: string[]): string[] | null {
  const names = chunks
    .flatMap((chunk) => clean(chunk).split(/\s+and\s+|,/))
    .map((name) => clean(name))
    .filter(
      (name) => name.length > 2 && name.length < 80 && !/^staff$/i.test(name) && /[A-Za-z]/.test(name),
    );
  return names.length ? names.slice(0, 10) : null;
}

function searchUrl(catalogUrl: string, code: string): string {
  try {
    return `${new URL(catalogUrl).origin}/search/?P=${encodeURIComponent(code)}`;
  } catch {
    return catalogUrl;
  }
}

/**
 * Parses CourseLeaf's catalog-search results.
 *
 * The layout differs from a subject page: the title is an <h3> on the enclosing
 * <article>, and the .courseblock holds only the description. Titles look like
 *   "* AMST 4459b / ANTH 465 / ANTH 4865b, Multispecies Worlds  Kathryn Dudley"
 * — an optional marker, cross-listed codes, the title after the comma, then the
 * instructors separated by a run of whitespace.
 */
function parseSearchResults(html: string, baseUrl: string, deptCode: string): CourseRaw[] {
  const $ = cheerio.load(html);
  const courses: CourseRaw[] = [];

  $('article.search-courseresult').each((_i, el) => {
    const article = $(el);
    const heading = parseCourseHeading(article.find('h3').first().text(), deptCode);
    if (!heading) return;

    const description = clean(article.find('.courseblockdesc').first().text());

    const parsed = CourseRawSchema.safeParse({
      course_number: heading.course_number,
      title: heading.title,
      description: description || null,
      credits: heading.credits ?? extractCredits(description),
      prerequisites: extractPrerequisites(description),
      terms_offered: extractTerms(description),
      instructors: heading.instructors,
      source_url: absolute(article.find('a[href]').first().attr('href'), baseUrl) ?? baseUrl,
    });
    if (parsed.success) courses.push(parsed.data);
  });

  return dedupeByNumber(courses);
}

/** Drops a leading "Prereq:" style label, returning null when nothing useful is left. */
function stripLabel(value: string, label: RegExp): string | null {
  if (!value) return null;
  const stripped = clean(value.replace(label, ''));
  if (!stripped) return null;
  if (/^(none|n\/a|no prerequisites?)\.?$/i.test(stripped)) return null;
  return stripped.slice(0, 2000);
}

function splitInstructors(value: string): string[] | null {
  if (!value) return null;
  const names = clean(value.replace(/^instructors?\s*[:\-–]?\s*/i, ''))
    .split(/[;,]|\sand\s/)
    .map((n) => clean(n))
    .filter((n) => n.length > 2 && n.length < 80 && /[A-Za-z]/.test(n));
  return names.length ? names.slice(0, 10) : null;
}

function blockToMarkdown(html: string): string {
  const $ = cheerio.load(html);
  const parts: string[] = [];
  $('.courseblock').each((_i, el) => {
    const block = $(el);
    parts.push(`## ${clean(block.find('.courseblocktitle').text())}`);
    block.find('p, div').each((_j, node) => {
      const text = clean($(node).text());
      if (text && !parts.includes(text)) parts.push(text);
    });
  });
  if (!parts.length) parts.push(clean($.text()));
  return parts.join('\n\n').slice(0, 40_000);
}

/* ---------------------------------------------------------------- utilities */

/** Detail may be sparser than the list entry — only ever fill in blanks. */
function mergeCourse(base: CourseRaw, detail: CourseRaw | undefined): CourseRaw {
  if (!detail) return base;
  return {
    ...base,
    title: base.title || detail.title,
    description:
      (detail.description?.length ?? 0) > (base.description?.length ?? 0)
        ? detail.description
        : base.description,
    credits: base.credits ?? detail.credits,
    prerequisites: base.prerequisites ?? detail.prerequisites,
    instructors: base.instructors ?? detail.instructors,
    terms_offered: base.terms_offered ?? detail.terms_offered,
    syllabus_url: base.syllabus_url ?? detail.syllabus_url,
  };
}

function unwrapRibbit(body: string): string {
  // The .rjs endpoint answers with JSON-ish text wrapping the HTML fragment.
  const match = body.match(/<div class="searchresult[\s\S]*$/i) ?? body.match(/<div class="courseblock[\s\S]*$/i);
  return match ? match[0] : body;
}

function joinUrl(base: string, path: string): string {
  try {
    return new URL(path, base.endsWith('/') ? base : `${base}/`).toString();
  } catch {
    return base;
  }
}

function shortUrl(url: string): string {
  try {
    const u = new URL(url);
    return `${u.hostname}${u.pathname}`;
  } catch {
    return url;
  }
}

function normalize(s: string): string {
  return s.toUpperCase().replace(/[^A-Z0-9]/g, '');
}

function extractCredits(text: string): string | null {
  const match = clean(text).match(/(\d+(?:\.\d+)?(?:\s*(?:-|–|to)\s*\d+(?:\.\d+)?)?)\s*(credit|unit|hour)s?/i);
  return match ? `${match[1]} ${match[2]}s` : null;
}

function extractTerms(text: string): string | null {
  const match = text.match(
    /(?:typically offered|offered|terms? offered|when offered)\s*[:\-–]?\s*((?:fall|spring|summer|winter|every|annually|alternate)[^.\n]{0,120})/i,
  );
  return match ? clean(match[1]) : null;
}

function extractInstructors(text: string): string[] | null {
  const match = text.match(/(?:instructors?|taught by|faculty)\s*[:\-–]\s*([^.\n]{3,200})/i);
  if (!match) return null;
  const names = clean(match[1])
    .split(/[;,]|\sand\s/)
    .map((n) => clean(n))
    .filter((n) => n.length > 2 && n.length < 80 && /[A-Za-z]/.test(n));
  return names.length ? names.slice(0, 10) : null;
}

export function dedupeByNumber(courses: CourseRaw[]): CourseRaw[] {
  const seen = new Map<string, CourseRaw>();
  for (const course of courses) {
    const key = normalize(course.course_number);
    const existing = seen.get(key);
    // Keep whichever copy carries the richer description.
    if (!existing || (course.description?.length ?? 0) > (existing.description?.length ?? 0)) {
      seen.set(key, course);
    }
  }
  return [...seen.values()];
}
