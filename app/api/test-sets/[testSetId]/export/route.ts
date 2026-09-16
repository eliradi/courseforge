import type { NextRequest } from 'next/server';

import { createAdminClient } from '@/lib/supabase/admin';
import { getUser } from '@/lib/supabase/server';
import type { Course, CourseSection, Question, TestSet } from '@/lib/supabase/types';
import { questionOptions } from '@/lib/supabase/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Exports a completed test set as JSON, or as printable HTML (PDF via print). */
export async function GET(request: NextRequest, context: { params: Promise<{ testSetId: string }> }) {
  const { testSetId } = await context.params;
  const format = new URL(request.url).searchParams.get('format') === 'html' ? 'html' : 'json';

  const user = await getUser();
  if (!user) return Response.json({ error: 'Sign in to export.' }, { status: 401 });

  const admin = createAdminClient();

  const { data: setRow } = await admin
    .from('test_sets')
    .select('*, course_sections!inner(*, courses!inner(*))')
    .eq('id', testSetId)
    .maybeSingle();

  if (!setRow) return Response.json({ error: 'Test set not found.' }, { status: 404 });

  // Generated tests are shared, so any signed-in user may export one.
  const testSet = setRow as TestSet & { course_sections: CourseSection & { courses: Course } };

  const { data: questionRows } = await admin
    .from('questions')
    .select('*')
    .eq('test_set_id', testSetId)
    .order('position');

  const questions = (questionRows ?? []) as Question[];
  const section = testSet.course_sections;
  const course = section.courses;
  const filenameBase = `${course.course_number}-${section.title}`
    .replace(/[^a-z0-9]+/gi, '-')
    .replace(/^-|-$/g, '')
    .toLowerCase();

  if (format === 'json') {
    const payload = {
      course: { number: course.course_number, title: course.title },
      section: { title: section.title, topics: section.topics },
      generated_at: testSet.created_at,
      model: testSet.model_used,
      question_count: questions.length,
      questions: questions.map((q) => ({
        position: q.position + 1,
        type: q.type,
        difficulty: q.difficulty,
        topic: q.topic,
        question: q.question,
        options: questionOptions(q),
        correct_answer: q.correct_answer,
        explanation: q.explanation,
      })),
    };

    return new Response(JSON.stringify(payload, null, 2), {
      headers: {
        'content-type': 'application/json; charset=utf-8',
        'content-disposition': `attachment; filename="${filenameBase}.json"`,
      },
    });
  }

  return new Response(renderPrintableHtml({ course, section, questions }), {
    headers: { 'content-type': 'text/html; charset=utf-8' },
  });
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** Self-contained printable page — "Save as PDF" from the browser print dialog. */
function renderPrintableHtml({
  course,
  section,
  questions,
}: {
  course: Course;
  section: CourseSection;
  questions: Question[];
}): string {
  const letters = ['A', 'B', 'C', 'D'];

  const body = questions
    .map((question) => {
      const options = questionOptions(question);
      const optionsHtml = options?.length
        ? `<ol class="options">${options
            .map((option, i) => `<li><span class="letter">${letters[i] ?? i + 1}.</span> ${escapeHtml(option)}</li>`)
            .join('')}</ol>`
        : question.type === 'true_false'
          ? '<ol class="options"><li><span class="letter">A.</span> True</li><li><span class="letter">B.</span> False</li></ol>'
          : '<div class="answer-space"></div>';

      return `
      <article class="q">
        <h3><span class="num">${question.position + 1}.</span> ${escapeHtml(question.question)}</h3>
        <p class="meta">${escapeHtml(question.topic ?? '')} · ${question.difficulty} · ${question.type.replace('_', ' ')}</p>
        ${optionsHtml}
        <details class="key">
          <summary>Answer</summary>
          <p><strong>${escapeHtml(question.correct_answer)}</strong></p>
          ${question.explanation ? `<p>${escapeHtml(question.explanation)}</p>` : ''}
        </details>
      </article>`;
    })
    .join('\n');

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(course.course_number)} — ${escapeHtml(section.title)}</title>
<style>
  :root { color-scheme: light; }
  * { box-sizing: border-box; }
  body {
    font: 15px/1.6 ui-sans-serif, system-ui, -apple-system, "Segoe UI", Inter, sans-serif;
    max-width: 44rem; margin: 0 auto; padding: 2.5rem 1.5rem; color: #16161a; background: #fff;
  }
  header { border-bottom: 2px solid #16161a; padding-bottom: 1rem; margin-bottom: 2rem; }
  h1 { font-size: 1.35rem; margin: 0 0 .25rem; }
  header p { margin: 0; color: #55555c; font-size: .875rem; }
  .q { margin: 0 0 1.75rem; break-inside: avoid; page-break-inside: avoid; }
  .q h3 { font-size: 1rem; font-weight: 600; margin: 0 0 .35rem; }
  .num { color: #55555c; margin-right: .35rem; }
  .meta { margin: 0 0 .6rem; font-size: .75rem; color: #7a7a82; text-transform: lowercase; }
  .options { list-style: none; margin: 0; padding: 0; }
  .options li { margin: .3rem 0; padding-left: .25rem; }
  .letter { display: inline-block; width: 1.4rem; color: #55555c; font-weight: 600; }
  .answer-space { border-bottom: 1px solid #c9c9d1; height: 3.5rem; margin: .5rem 0; }
  .key { margin-top: .6rem; font-size: .875rem; }
  .key summary { cursor: pointer; color: #4338ca; }
  .key p { margin: .35rem 0; }
  .hint { margin-top: 2.5rem; font-size: .75rem; color: #7a7a82; }
  @media print {
    body { padding: 0; }
    .hint { display: none; }
    .key { display: none; }
  }
</style>
</head>
<body>
  <header>
    <h1>${escapeHtml(course.course_number)} — ${escapeHtml(course.title)}</h1>
    <p>${escapeHtml(section.title)} · ${questions.length} questions</p>
  </header>
  ${body}
  <p class="hint">Use your browser's print dialog and choose “Save as PDF”. Answer keys are hidden when printing.</p>
</body>
</html>`;
}
