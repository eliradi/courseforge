/**
 * Dev harness: runs a real test-set generation against a seeded course section
 * and reports the resulting question mix, so the 70/15/15 and 30/45/25 targets
 * can be checked against live model output.
 *
 *   pnpm generate-probe <COURSE_NUMBER> [SECTION_POSITION]
 */
import { generateTestSet } from '../lib/ai/generate-questions';
import { createAdminClient } from '../lib/supabase/admin';

const TEST_EMAIL = 'courseforge-verify@example.com';

async function ensureUser(): Promise<string> {
  const admin = createAdminClient();
  const { data: list } = await admin.auth.admin.listUsers({ perPage: 200 });
  const existing = list?.users.find((u) => u.email === TEST_EMAIL);
  if (existing) return existing.id;

  const { data, error } = await admin.auth.admin.createUser({
    email: TEST_EMAIL,
    password: 'courseforge-verify-pw-1',
    email_confirm: true,
  });
  if (error || !data.user) throw error ?? new Error('could not create verification user');
  return data.user.id;
}

async function main() {
  const courseNumber = process.argv[2] ?? '6.1010';
  const position = Number(process.argv[3] ?? 0);

  const admin = createAdminClient();
  const userId = await ensureUser();

  const { data: course } = await admin
    .from('courses')
    .select('*, departments!inner(*, colleges!inner(name))')
    .eq('course_number', courseNumber)
    .maybeSingle();
  if (!course) throw new Error(`course ${courseNumber} not found`);

  const collegeName = (course as { departments: { colleges: { name: string } } }).departments.colleges.name;

  const { data: section } = await admin
    .from('course_sections')
    .select('*')
    .eq('course_id', course.id)
    .eq('position', position)
    .maybeSingle();
  if (!section) throw new Error(`section at position ${position} not found`);

  const { data: textbooks } = await admin
    .from('textbooks')
    .select('title, required')
    .eq('course_id', course.id)
    .order('required', { ascending: false })
    .limit(1);

  const { data: testSet, error } = await admin
    .from('test_sets')
    .insert({ course_section_id: section.id, user_id: userId, status: 'generating', target_count: 100 })
    .select()
    .single();
  if (error || !testSet) throw error ?? new Error('could not create test set');

  console.log(`course:   ${courseNumber} — ${course.title}`);
  console.log(`section:  ${section.title}`);
  console.log(`topics:   ${section.topics.join(', ')}`);
  console.log(`test set: ${testSet.id}\n`);

  const started = Date.now();
  const outcome = await generateTestSet({
    testSetId: testSet.id,
    college: collegeName,
    course,
    section,
    textbook: textbooks?.[0] ?? null,
  });
  const elapsed = ((Date.now() - started) / 1000).toFixed(0);

  console.log(`\noutcome: ${outcome.status} · ${outcome.generated} questions in ${elapsed}s`);
  if (outcome.error) console.log(`error:   ${outcome.error}`);

  const { data: questions } = await admin
    .from('questions')
    .select('*')
    .eq('test_set_id', testSet.id)
    .order('position');

  const rows = questions ?? [];
  const tally = <T extends string>(key: (q: (typeof rows)[number]) => T) => {
    const out: Record<string, number> = {};
    for (const q of rows) out[key(q)] = (out[key(q)] ?? 0) + 1;
    return out;
  };

  console.log('\ntype mix:      ', tally((q) => q.type), '(target: mcq 70, true_false 15, short_answer 15)');
  console.log('difficulty mix:', tally((q) => q.difficulty), '(target: easy 30, medium 45, hard 25)');
  console.log('distinct topics:', new Set(rows.map((q) => q.topic)).size, 'of', section.topics.length);

  const mcqs = rows.filter((q) => q.type === 'mcq');
  const badOptions = mcqs.filter((q) => !Array.isArray(q.options) || (q.options as string[]).length !== 4);
  const badAnswers = mcqs.filter(
    (q) => !(q.options as string[] | null)?.some((o) => o.trim().toLowerCase() === q.correct_answer.trim().toLowerCase()),
  );
  console.log('mcq with != 4 options:', badOptions.length, '· mcq answer not among options:', badAnswers.length);

  const stems = rows.map((q) => q.question.toLowerCase().replace(/[^a-z0-9 ]/g, '').trim());
  console.log('exact duplicate stems:', stems.length - new Set(stems).size);

  console.log('\nsample:');
  for (const q of rows.slice(0, 3)) {
    console.log(`\n  [${q.type}/${q.difficulty}] ${q.question}`);
    if (Array.isArray(q.options)) for (const o of q.options as string[]) console.log(`     - ${o}`);
    console.log(`     answer: ${q.correct_answer}`);
    console.log(`     why:    ${q.explanation}`);
    console.log(`     topic:  ${q.topic}`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
