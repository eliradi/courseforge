import 'server-only';

import * as cheerio from 'cheerio';

import { scrapeFetch, scrapeRender } from '../client';
import {
  CourseRawSchema,
  DepartmentRawSchema,
  type CourseRaw,
  type DepartmentRaw,
} from '@/lib/validation/schemas';
import { clean, extractPrerequisites, type CatalogAdapter, type ScrapeCtx } from './types';
import { dedupeByNumber } from './courseleaf';

type Cookie = { name: string; value: string; domain?: string; path?: string };

/**
 * Ellucian Banner. SSB9 is a JSON API sitting behind a session cookie: render
 * the class-search page once to mint the cookie, then every subsequent call is
 * a cheap static /fetch. SSB8 is the legacy form-POST + table HTML path.
 */
export const bannerAdapter: CatalogAdapter = {
  id: 'banner',
  label: 'Ellucian Banner',

  detect(html, url) {
    return (
      /\/StudentRegistrationSsb\/ssb\//i.test(url) ||
      /\/StudentRegistrationSsb\/ssb\//i.test(html) ||
      /bwckctlg\.p_/i.test(url) ||
      /bwckctlg\.p_|bwckschd\.p_/i.test(html)
    );
  },

  async getDepartments(ctx) {
    const ssb9 = ssb9Base(ctx.catalogUrl) ?? ssb9BaseFromHtml(ctx.rootHtml, ctx.catalogUrl);

    if (ssb9) {
      ctx.state.ssb9Base = ssb9;
      const session = await establishSession(ssb9, ctx);
      if (session) {
        const term = await latestTerm(ssb9, session, ctx);
        if (term) {
          ctx.state.term = term;
          const subjects = await fetchSubjects(ssb9, term, session, ctx);
          if (subjects.length) return subjects;
        }
      }
    }

    // SSB8 fallback: the subject <select> on bwckctlg.p_disp_cat_term_date.
    return ssb8Subjects(ctx);
  },

  async getCourses(ctx, dept) {
    const ssb9 = ctx.state.ssb9Base as string | undefined;
    const term = ctx.state.term as string | undefined;
    const session = ctx.state.cookies as Cookie[] | undefined;

    if (ssb9 && term && session) {
      return ssb9Courses(ssb9, term, dept, session, ctx);
    }
    return ssb8Courses(ctx, dept);
  },

  async getCourseDetail(ctx, course) {
    // Banner's search payload already carries the full description; there is no
    // richer detail page worth a second round trip.
    return {
      ...course,
      raw_scraped_content: [course.title, course.description, course.prerequisites]
        .filter(Boolean)
        .join('\n\n')
        .slice(0, 40_000),
    };
  },
};

/* --------------------------------------------------------------------- SSB9 */

function ssb9Base(url: string): string | null {
  const match = url.match(/^(https?:\/\/[^/]+(?:\/[^/]+)*?\/StudentRegistrationSsb\/ssb)\b/i);
  return match ? match[1] : null;
}

function ssb9BaseFromHtml(html: string, baseUrl: string): string | null {
  const match = html.match(/(https?:\/\/[^"'\s]*\/StudentRegistrationSsb\/ssb)/i);
  if (match) return match[1];
  const relative = html.match(/["'](\/[^"'\s]*\/StudentRegistrationSsb\/ssb)/i);
  if (relative) {
    try {
      return new URL(relative[1], baseUrl).toString();
    } catch {
      return null;
    }
  }
  return null;
}

/** One browser render mints JSESSIONID; everything after it is a static fetch. */
async function establishSession(base: string, ctx: ScrapeCtx): Promise<Cookie[] | null> {
  ctx.onProgress?.('Establishing Banner session');
  const res = await scrapeRender(`${base}/classSearch/classSearch`, { waitUntil: 'domcontentloaded' });
  if (!res.cookies.length) return null;
  const cookies = res.cookies.map((c) => ({ name: c.name, value: c.value, domain: c.domain, path: c.path }));
  ctx.state.cookies = cookies;
  return cookies;
}

function cookieHeader(cookies: Cookie[]): Record<string, string> {
  return { cookie: cookies.map((c) => `${c.name}=${c.value}`).join('; ') };
}

async function getJson(url: string, cookies: Cookie[]): Promise<unknown | null> {
  const res = await scrapeFetch(url, {
    headers: { ...cookieHeader(cookies), accept: 'application/json, text/plain, */*' },
  });
  if (!res.ok || !res.html) return null;
  try {
    return JSON.parse(res.html);
  } catch {
    return null;
  }
}

async function latestTerm(base: string, cookies: Cookie[], ctx: ScrapeCtx): Promise<string | null> {
  ctx.onProgress?.('Selecting current term');
  const json = await getJson(`${base}/classSearch/getTerms?searchTerm=&offset=1&max=25`, cookies);
  if (!Array.isArray(json)) return null;

  const terms = json
    .filter((t): t is { code: string; description: string } =>
      Boolean(t && typeof t === 'object' && 'code' in t),
    )
    // Term codes sort chronologically as numbers (202508 > 202501).
    .sort((a, b) => Number(b.code) - Number(a.code));

  // Skip "View Only" / archived terms when a live one exists.
  const live = terms.find((t) => !/view only/i.test(t.description ?? ''));
  return (live ?? terms[0])?.code ?? null;
}

async function fetchSubjects(
  base: string,
  term: string,
  cookies: Cookie[],
  ctx: ScrapeCtx,
): Promise<DepartmentRaw[]> {
  ctx.onProgress?.('Fetching Banner subject list');
  const json = await getJson(
    `${base}/classSearch/get_subject?searchTerm=&term=${encodeURIComponent(term)}&offset=1&max=500`,
    cookies,
  );
  if (!Array.isArray(json)) return [];

  const departments: DepartmentRaw[] = [];
  for (const entry of json) {
    if (!entry || typeof entry !== 'object') continue;
    const { code, description } = entry as { code?: string; description?: string };
    const parsed = DepartmentRawSchema.safeParse({ code, name: description ?? code });
    if (parsed.success) departments.push(parsed.data);
  }
  return departments.sort((a, b) => a.code.localeCompare(b.code));
}

async function ssb9Courses(
  base: string,
  term: string,
  dept: DepartmentRaw,
  cookies: Cookie[],
  ctx: ScrapeCtx,
): Promise<CourseRaw[]> {
  const pageSize = 50;
  const courses: CourseRaw[] = [];

  for (let offset = 0; offset < 20; offset++) {
    ctx.onProgress?.(`Fetching ${dept.code} courses (page ${offset + 1})`);
    const url =
      `${base}/courseSearchResults/courseSearchResults?txt_subject=${encodeURIComponent(dept.code)}` +
      `&txt_term=${encodeURIComponent(term)}&pageOffset=${offset * pageSize}&pageMaxSize=${pageSize}&sortColumn=subjectDescription&sortDirection=asc`;

    const json = (await getJson(url, cookies)) as
      | { data?: Array<Record<string, unknown>>; totalCount?: number }
      | null;
    const rows = json?.data;
    if (!Array.isArray(rows) || rows.length === 0) break;

    for (const row of rows) {
      const subject = String(row.subject ?? row.subjectCode ?? dept.code);
      const number = String(row.courseNumber ?? row.courseNumberDisplay ?? '');
      if (!number) continue;

      const description = typeof row.courseDescription === 'string' ? clean(row.courseDescription) : null;
      const creditHigh = row.creditHourHigh ?? row.creditHours;
      const creditLow = row.creditHourLow;
      const credits =
        creditLow && creditHigh && creditLow !== creditHigh
          ? `${creditLow}-${creditHigh} credits`
          : creditHigh
            ? `${creditHigh} credits`
            : null;

      const parsed = CourseRawSchema.safeParse({
        course_number: `${subject} ${number}`,
        title: clean(String(row.courseTitle ?? row.title ?? number)),
        description,
        credits,
        prerequisites: description ? extractPrerequisites(description) : null,
        terms_offered: typeof row.termDesc === 'string' ? row.termDesc : null,
        source_url: url,
      });
      if (parsed.success) courses.push(parsed.data);
    }

    if (rows.length < pageSize) break;
    if (json?.totalCount && courses.length >= json.totalCount) break;
  }

  return dedupeByNumber(courses);
}

/* --------------------------------------------------------------------- SSB8 */

function ssb8Base(url: string): string | null {
  const match = url.match(/^(https?:\/\/[^/]+(?:\/[^/]+)*?)\/bwckctlg\.p_/i);
  if (match) return match[1];
  const generic = url.match(/^(https?:\/\/[^/]+)/i);
  return generic ? `${generic[1]}/pls/bprod` : null;
}

async function ssb8Subjects(ctx: ScrapeCtx): Promise<DepartmentRaw[]> {
  const base = ssb8Base(ctx.catalogUrl);
  if (!base) return [];

  ctx.state.ssb8Base = base;
  ctx.onProgress?.('Reading Banner (SSB8) subject list');

  for (const path of ['/bwckctlg.p_disp_cat_term_date', '/bwckctlg.p_disp_dyn_ctlg']) {
    const res = await scrapeFetch(`${base}${path}`);
    if (!res.ok || !res.html) continue;

    const $ = cheerio.load(res.html);
    const departments: DepartmentRaw[] = [];

    $('select[name="sel_subj"] option, select[name="sel_subj_all"] option').each((_i, el) => {
      const code = clean($(el).attr('value') ?? '');
      const name = clean($(el).text());
      if (!code || code === '%' || code === 'dummy') return;
      const parsed = DepartmentRawSchema.safeParse({ code, name: name || code });
      if (parsed.success) departments.push(parsed.data);
    });

    if (departments.length) {
      // The term select on the same page tells us which term to POST with.
      const term = clean($('select[name="p_calling_proc"] option, select[name="p_term"] option').first().attr('value') ?? '');
      if (term) ctx.state.ssb8Term = term;
      return departments.sort((a, b) => a.code.localeCompare(b.code));
    }
  }

  return [];
}

async function ssb8Courses(ctx: ScrapeCtx, dept: DepartmentRaw): Promise<CourseRaw[]> {
  const base = ctx.state.ssb8Base as string | undefined;
  if (!base) return [];

  const term = (ctx.state.ssb8Term as string | undefined) ?? defaultTermCode();
  const body = new URLSearchParams({
    call_proc_in: 'bwckctlg.p_disp_dyn_ctlg',
    sel_subj: 'dummy',
    sel_levl: 'dummy',
    sel_schd: 'dummy',
    sel_coll: 'dummy',
    sel_divs: 'dummy',
    sel_dept: 'dummy',
    sel_attr: 'dummy',
    sel_crse_strt: '',
    sel_crse_end: '',
    sel_title: '',
    sel_from_cred: '',
    sel_to_cred: '',
    term_in: term,
  });
  body.append('sel_subj', dept.code);

  ctx.onProgress?.(`Fetching ${dept.code} courses`);
  const res = await scrapeFetch(`${base}/bwckctlg.p_display_courses`, {
    method: 'POST',
    body: body.toString(),
  });
  if (!res.ok || !res.html) return [];

  const $ = cheerio.load(res.html);
  const courses: CourseRaw[] = [];

  $('td.nttitle').each((_i, el) => {
    const titleText = clean($(el).text());
    // Format: "CS 229 - Machine Learning"
    const match = titleText.match(/^([A-Z][A-Z&\s]{0,9}\s*\d[\w.]*)\s*-\s*(.+)$/);
    if (!match) return;

    const descCell = $(el).closest('tr').next('tr').find('td.ntdefault').first();
    const description = clean(descCell.text());

    const parsed = CourseRawSchema.safeParse({
      course_number: clean(match[1]),
      title: clean(match[2]),
      description: description || null,
      credits: description.match(/([\d.]+(?:\s*(?:-|to)\s*[\d.]+)?)\s*Credit hours/i)?.[0] ?? null,
      prerequisites: extractPrerequisites(description),
      source_url: res.finalUrl,
    });
    if (parsed.success) courses.push(parsed.data);
  });

  return dedupeByNumber(courses);
}

function defaultTermCode(): string {
  const now = new Date();
  const year = now.getFullYear();
  // Banner term codes: YYYY + 01 spring / 05 summer / 08 fall.
  const month = now.getMonth() + 1;
  const suffix = month <= 4 ? '01' : month <= 7 ? '05' : '08';
  return `${year}${suffix}`;
}
