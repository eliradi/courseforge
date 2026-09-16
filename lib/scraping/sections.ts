import 'server-only';

import { extractObject } from '@/lib/ai/extract';
import { SectionListSchema, type SectionRaw } from '@/lib/validation/schemas';
import type { Course, SectionSource, Textbook } from '@/lib/supabase/types';
import { scrapeFetch, scrapeRender } from './client';
import { clean } from './adapters/types';

export interface SectionResult {
  sections: SectionRaw[];
  source: SectionSource;
}

interface SectionContext {
  course: Pick<Course, 'course_number' | 'title' | 'description' | 'syllabus_url' | 'raw_scraped_content' | 'ai_summary'>;
  textbooks: Textbook[];
  onProgress?: (message: string) => void;
}

/**
 * Section/chapter derivation — this is what test generation is built on, so it
 * tries hard before giving up:
 *   textbook table of contents → syllabus weekly schedule → AI-derived outline.
 */
export async function deriveSections(ctx: SectionContext): Promise<SectionResult> {
  const primary = ctx.textbooks.find((t) => t.required) ?? ctx.textbooks[0];

  // 1. Table of contents for the assigned textbook.
  if (primary) {
    ctx.onProgress?.(`Looking up the table of contents for "${primary.title}"`);
    const toc = await tableOfContents(primary, ctx);
    if (toc.length >= 5) {
      const merged = await mergeWithSyllabus(toc, ctx);
      return { sections: merged, source: 'textbook_toc' };
    }
  }

  // 2. Syllabus weekly topic schedule.
  const syllabus = await syllabusSections(ctx);
  if (syllabus.length >= 5) return { sections: syllabus, source: 'syllabus' };

  // 3. AI-derived outline from the course description + standard curriculum.
  ctx.onProgress?.('Deriving a section outline for this course');
  const derived = await aiOutline(ctx, primary);
  return { sections: derived, source: 'ai_derived' };
}

/* ------------------------------------------------- textbook table of contents */

async function tableOfContents(
  textbook: Pick<Textbook, 'title' | 'authors' | 'isbn'>,
  ctx: SectionContext,
): Promise<SectionRaw[]> {
  let markdown = '';

  // Google Books exposes a ToC for most academic titles when we have an ISBN.
  if (textbook.isbn) {
    const rendered = await scrapeRender(`https://books.google.com/books?vid=ISBN${textbook.isbn}`, {
      waitUntil: 'networkidle',
      timeoutMs: 25_000,
    });
    if (rendered.ok && /contents|chapter/i.test(rendered.markdown)) {
      markdown = rendered.markdown;
    }
  }

  // Fall back to the Google Books API, which often carries a description
  // containing the chapter list.
  if (!markdown) {
    const query = encodeURIComponent(
      textbook.isbn ? `isbn:${textbook.isbn}` : `intitle:${textbook.title}`,
    );
    const res = await scrapeFetch(`https://www.googleapis.com/books/v1/volumes?q=${query}&maxResults=3`);
    if (res.ok && res.html) {
      try {
        const json = JSON.parse(res.html) as {
          items?: Array<{ volumeInfo?: { description?: string; title?: string } }>;
        };
        markdown = (json.items ?? [])
          .map((i) => i.volumeInfo?.description ?? '')
          .filter(Boolean)
          .join('\n\n');
      } catch {
        /* not JSON */
      }
    }
  }

  if (!markdown || markdown.length < 200) return [];

  const focused = focusOnToc(markdown);
  const result = await extractObject({
    schema: SectionListSchema,
    operation: 'sections_from_toc',
    system:
      'You turn a book table of contents into a chapter list. Use the chapter titles exactly as ' +
      'printed. For each chapter, list the topics it covers. Never invent chapters that are not shown.',
    prompt: [
      `Textbook: ${textbook.title}${textbook.authors ? ` by ${textbook.authors}` : ''}`,
      `Used in: ${ctx.course.course_number} — ${ctx.course.title}`,
      '',
      'Extract the chapters. Title each section like "Chapter 3: Dynamic Programming".',
      '',
      `<content>\n${focused}\n</content>`,
    ].join('\n'),
  });

  return result?.sections ?? [];
}

function focusOnToc(text: string): string {
  const match = text.match(/(?:table of contents|contents|chapters?)[\s\S]{0,8000}/i);
  return clean(match ? match[0] : text).slice(0, 12_000);
}

/* ------------------------------------------------------------ syllabus path */

async function syllabusSections(ctx: SectionContext): Promise<SectionRaw[]> {
  if (!ctx.course.syllabus_url) return [];

  ctx.onProgress?.('Reading the syllabus schedule');
  const res = await scrapeFetch(ctx.course.syllabus_url);
  let text = res.ok ? res.html : '';
  if (!text || text.length < 500) {
    const rendered = await scrapeRender(ctx.course.syllabus_url, { waitUntil: 'networkidle' });
    text = rendered.markdown || rendered.html;
  }
  if (!text) return [];

  const result = await extractObject({
    schema: SectionListSchema,
    operation: 'sections_from_syllabus',
    system:
      'You extract a course topic schedule from a syllabus. Use only topics that appear in the ' +
      'document. Never invent weeks or units.',
    prompt: [
      `Course: ${ctx.course.course_number} — ${ctx.course.title}`,
      '',
      'Extract the weekly/unit topic schedule as an ordered list of sections.',
      '',
      `<syllabus>\n${clean(text).slice(0, 25_000)}\n</syllabus>`,
    ].join('\n'),
  });

  return result?.sections ?? [];
}

/** When a syllabus exists, use it to enrich the ToC-derived topics. */
async function mergeWithSyllabus(toc: SectionRaw[], ctx: SectionContext): Promise<SectionRaw[]> {
  const syllabus = await syllabusSections(ctx);
  if (!syllabus.length) return toc;

  return toc.map((section, index) => {
    const counterpart = syllabus[index];
    if (!counterpart) return section;
    const topics = [...new Set([...section.topics, ...counterpart.topics])].slice(0, 20);
    return { ...section, topics };
  });
}

/* ---------------------------------------------------------------- AI outline */

async function aiOutline(
  ctx: SectionContext,
  textbook: Pick<Textbook, 'title' | 'authors'> | undefined,
): Promise<SectionRaw[]> {
  const result = await extractObject({
    schema: SectionListSchema,
    operation: 'derive_sections',
    system:
      'You design realistic course outlines. Produce the sections a well-taught version of this ' +
      'course would actually cover, in teaching order, matching the level implied by the course ' +
      'number. Each section needs 3-6 specific topics — not vague headings.',
    prompt: [
      `Course: ${ctx.course.course_number} — ${ctx.course.title}`,
      ctx.course.description ? `Catalog description: ${ctx.course.description.slice(0, 2000)}` : '',
      ctx.course.ai_summary ? `Summary: ${ctx.course.ai_summary.slice(0, 1500)}` : '',
      textbook ? `Assigned textbook: ${textbook.title}${textbook.authors ? ` by ${textbook.authors}` : ''}` : '',
      '',
      'Produce between 10 and 15 sections covering a full term.',
    ]
      .filter(Boolean)
      .join('\n'),
  });

  return result?.sections ?? fallbackOutline(ctx);
}

/** Absolute last resort so the page is never empty when AI is unavailable. */
function fallbackOutline(ctx: SectionContext): SectionRaw[] {
  return [
    {
      title: `Unit 1: Introduction to ${ctx.course.title}`,
      topics: ['Course overview', 'Core terminology', 'Foundational concepts'],
    },
  ];
}
