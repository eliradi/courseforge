import 'server-only';

import * as cheerio from 'cheerio';

import { extractObject } from '@/lib/ai/extract';
import { TextbookListSchema, type TextbookRaw } from '@/lib/validation/schemas';
import type { Course } from '@/lib/supabase/types';
import type { TextbookSource } from '@/lib/supabase/types';
import { scrapeFetch, scrapeRender } from './client';
import { clean } from './adapters/types';

export interface TextbookResult {
  textbooks: TextbookRaw[];
  source: TextbookSource;
}

interface TextbookContext {
  collegeName: string;
  domain: string;
  departmentCode: string;
  course: Pick<Course, 'course_number' | 'title' | 'description' | 'syllabus_url' | 'raw_scraped_content'>;
  onProgress?: (message: string) => void;
}

const EXTRACTION_SYSTEM =
  'You extract required and recommended course textbooks from university course materials. ' +
  'Only report books that are actually listed in the text. Never invent a title, author or ISBN. ' +
  'If no books are listed, return an empty array.';

/**
 * Tries each source in order and stops at the first that yields a book:
 *   syllabus → catalog detail → campus bookstore → AI inference.
 * The returned `source` drives the badge shown next to each row in the UI.
 */
export async function findTextbooks(ctx: TextbookContext): Promise<TextbookResult> {
  // 1. Syllabus page.
  if (ctx.course.syllabus_url) {
    ctx.onProgress?.('Checking syllabus for required texts');
    const text = await pageText(ctx.course.syllabus_url);
    if (text) {
      const books = await extractFrom(text, ctx, 'syllabus');
      if (books.length) return { textbooks: books, source: 'syllabus' };
    }
  }

  // 2. Whatever the catalog detail scrape already captured.
  if (ctx.course.raw_scraped_content && /text|book|isbn|required material/i.test(ctx.course.raw_scraped_content)) {
    ctx.onProgress?.('Checking catalog entry for required texts');
    const books = await extractFrom(ctx.course.raw_scraped_content, ctx, 'catalog');
    if (books.length) return { textbooks: books, source: 'catalog' };
  }

  // 3. Campus bookstore.
  ctx.onProgress?.('Checking campus bookstore');
  const bookstore = await bookstoreLookup(ctx);
  if (bookstore.length) return { textbooks: bookstore, source: 'bookstore' };

  // 4. AI inference — clearly badged as inferred in the UI.
  ctx.onProgress?.('Inferring the standard textbook for this course');
  const inferred = await inferTextbook(ctx);
  return { textbooks: inferred, source: 'ai_inferred' };
}

/* ------------------------------------------------------------------ helpers */

async function pageText(url: string): Promise<string> {
  const res = await scrapeFetch(url);
  let html = res.ok ? res.html : '';

  if (!html || html.length < 500) {
    const rendered = await scrapeRender(url, { waitUntil: 'networkidle' });
    if (rendered.markdown) return rendered.markdown.slice(0, 40_000);
    html = rendered.html;
  }

  if (!html) return '';
  const $ = cheerio.load(html);
  $('script, style, nav, footer, header, noscript').remove();
  return clean($('main').text() || $('body').text()).slice(0, 40_000);
}

async function extractFrom(
  text: string,
  ctx: TextbookContext,
  origin: string,
): Promise<TextbookRaw[]> {
  // Focus on the passage around the textbook heading when there is one.
  const focused = focusOnTextbooks(text);
  if (!focused.trim()) return [];

  const result = await extractObject({
    schema: TextbookListSchema,
    operation: 'extract_textbooks',
    system: EXTRACTION_SYSTEM,
    prompt: [
      `Course: ${ctx.course.course_number} — ${ctx.course.title}`,
      `Source: ${origin}`,
      '',
      'Extract every textbook or required reading listed below. Mark `required: false` for',
      'optional/recommended texts. Include ISBN and edition only when printed.',
      '',
      `<content>\n${focused}\n</content>`,
    ].join('\n'),
  });

  return result?.textbooks ?? [];
}

function focusOnTextbooks(text: string): string {
  const match = text.match(
    /(?:required\s+(?:texts?|materials?|readings?)|textbooks?|course\s+materials?|required\s+book)[\s\S]{0,4000}/i,
  );
  return (match ? match[0] : text).slice(0, 12_000);
}

/* --------------------------------------------------------------- bookstore */

function schoolSlug(collegeName: string, domain: string): string[] {
  const fromDomain = domain.replace(/^www\./, '').split('.')[0];
  const fromName = collegeName
    .toLowerCase()
    .replace(/^(the|university of|college of)\s+/i, '')
    .replace(/[^a-z0-9]+/g, '');
  return [...new Set([fromDomain, fromName].filter(Boolean))];
}

/**
 * The two big campus-bookstore operators expose course-material lookups at
 * predictable hosts. Both are JS-heavy, so these need a real render.
 */
async function bookstoreLookup(ctx: TextbookContext): Promise<TextbookRaw[]> {
  const slugs = schoolSlug(ctx.collegeName, ctx.domain);
  const candidates: string[] = [];

  for (const slug of slugs) {
    candidates.push(`https://${slug}.bncollege.com/course-materials-results`);
    candidates.push(`https://www.bkstr.com/${slug}store/course-materials-results`);
  }
  candidates.push(`https://bookstore.${ctx.domain.replace(/^www\./, '')}`);

  for (const url of candidates.slice(0, 5)) {
    const rendered = await scrapeRender(url, { waitUntil: 'networkidle', timeoutMs: 25_000 });
    if (!rendered.ok || rendered.markdown.length < 300) continue;
    if (!/course material|textbook|isbn/i.test(rendered.markdown)) continue;

    const books = await extractFrom(
      `${rendered.markdown}\n\nLooking for: ${ctx.departmentCode} ${ctx.course.course_number}`,
      ctx,
      'bookstore',
    );
    if (books.length) return books;
  }

  return [];
}

/* -------------------------------------------------------------- AI fallback */

async function inferTextbook(ctx: TextbookContext): Promise<TextbookRaw[]> {
  const result = await extractObject({
    schema: TextbookListSchema,
    operation: 'infer_textbook',
    system:
      'You name the textbook most commonly assigned for a given university course. ' +
      'Return at most two well-known, real books. Only give an ISBN if you are confident it is correct; ' +
      'otherwise omit it. If you cannot identify a standard text, return an empty array.',
    prompt: [
      `College: ${ctx.collegeName}`,
      `Course: ${ctx.course.course_number} — ${ctx.course.title}`,
      ctx.course.description ? `Description: ${ctx.course.description.slice(0, 1500)}` : '',
      '',
      'Which textbook(s) would a course like this most commonly use?',
    ]
      .filter(Boolean)
      .join('\n'),
  });

  return (result?.textbooks ?? []).slice(0, 2);
}
