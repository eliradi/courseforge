import 'server-only';

import { generateText } from 'ai';

import { EXTRACTION_SETTINGS, FAST_MODEL, isAiConfigured } from './models';
import { buildSummaryPrompt } from './prompts';
import { readUsage, recordUsage } from './usage';

/**
 * Models sometimes ignore "no headings" and open with a markdown title or lead
 * each paragraph with a bold label. The course page renders paragraphs, not
 * markdown, so strip that structure before it reaches the database.
 */
function cleanSummary(raw: string): string {
  return raw
    .split(/\n/)
    // Drop markdown headings and horizontal rules outright.
    .filter((line) => !/^\s*(#{1,6}\s|[-*_]{3,}\s*$)/.test(line))
    .join('\n')
    // "**Paragraph one.** ..." -> "Paragraph one. ..."
    .replace(/\*\*(.+?)\*\*/g, '$1')
    .replace(/^\s*[-*+]\s+/gm, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** Two-paragraph course summary, generated once and cached on the course row. */
export async function generateCourseSummary(input: {
  college: string;
  courseNumber: string;
  courseTitle: string;
  description?: string | null;
  rawContent?: string | null;
}): Promise<string | null> {
  if (!isAiConfigured()) return null;
  if (!input.rawContent && !input.description) return null;

  try {
    const { text, usage } = await generateText({
      model: FAST_MODEL,
      prompt: buildSummaryPrompt(input),
      ...EXTRACTION_SETTINGS,
    });

    const { inputTokens, outputTokens } = readUsage(usage);
    await recordUsage({ operation: 'course_summary', model: FAST_MODEL, inputTokens, outputTokens });
    const summary = cleanSummary(text);
    return summary.length >= 60 ? summary : null;
  } catch (error) {
    console.error('[ai] summary failed:', error instanceof Error ? error.message : error);
    return null;
  }
}
