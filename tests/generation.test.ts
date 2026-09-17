import assert from 'node:assert/strict';
import test from 'node:test';

import { DuplicateFilter, jaccard, tokenize } from '../lib/ai/dedupe';
import { buildBatchPlans } from '../lib/ai/prompts';
import { courseLevel } from '../lib/db/admin-queries';
import { gradeAnswer } from '../lib/grading';
import { splitCourseTitle, extractPrerequisites } from '../lib/scraping/adapters/types';
import { QuestionSchema } from '../lib/validation/schemas';

/* ------------------------------------------------------------ batch plans */

test('a 100-question set is split into four batches of 25', () => {
  const plans = buildBatchPlans(100, 25);
  assert.equal(plans.length, 4);
  for (const plan of plans) assert.equal(plan.count, 25);
});

test('every selectable test length plans exactly that many questions', () => {
  for (const total of [10, 25, 40, 70, 100]) {
    const plans = buildBatchPlans(total, 25);
    assert.equal(plans.length, Math.ceil(total / 25));
    const sum = (pick: (p: (typeof plans)[number]) => number) =>
      plans.reduce((acc, plan) => acc + pick(plan), 0);
    assert.equal(sum((p) => p.count), total);
    assert.equal(sum((p) => p.types.mcq + p.types.true_false + p.types.short_answer), total);
    assert.equal(sum((p) => p.difficulties.easy + p.difficulties.medium + p.difficulties.hard), total);
  }
});

test('a 10-question set keeps every question type and difficulty', () => {
  const [plan] = buildBatchPlans(10, 25);
  assert.equal(plan.types.mcq, 7);
  assert.ok(plan.types.true_false >= 1 && plan.types.short_answer >= 1);
  assert.ok(plan.difficulties.easy >= 1 && plan.difficulties.hard >= 1);
});

test('the type mix across a full set is exactly 70 MCQ / 15 T-F / 15 short answer', () => {
  const plans = buildBatchPlans(100, 25);
  const total = (key: 'mcq' | 'true_false' | 'short_answer') =>
    plans.reduce((sum, plan) => sum + plan.types[key], 0);

  assert.equal(total('mcq'), 70);
  assert.equal(total('true_false'), 15);
  assert.equal(total('short_answer'), 15);
});

test('the difficulty mix across a full set is exactly 30 easy / 45 medium / 25 hard', () => {
  const plans = buildBatchPlans(100, 25);
  const total = (key: 'easy' | 'medium' | 'hard') =>
    plans.reduce((sum, plan) => sum + plan.difficulties[key], 0);

  assert.equal(total('easy'), 30);
  assert.equal(total('medium'), 45);
  assert.equal(total('hard'), 25);
});

test('every batch is internally consistent and no batch is single-typed', () => {
  for (const plan of buildBatchPlans(100, 25)) {
    const types = plan.types.mcq + plan.types.true_false + plan.types.short_answer;
    const difficulties =
      plan.difficulties.easy + plan.difficulties.medium + plan.difficulties.hard;

    assert.equal(types, plan.count, `batch ${plan.index} type counts must sum to its size`);
    assert.equal(difficulties, plan.count, `batch ${plan.index} difficulty counts must sum to its size`);
    assert.ok(plan.types.mcq > 0 && plan.types.true_false > 0, 'batches should be mixed');
    assert.ok(plan.difficulties.easy > 0 && plan.difficulties.hard > 0, 'difficulties should be mixed');
  }
});

test('apportionment still balances for set sizes that do not divide evenly', () => {
  const plans = buildBatchPlans(50, 20);
  assert.deepEqual(plans.map((p) => p.count), [20, 20, 10]);
  assert.equal(
    plans.reduce((sum, p) => sum + p.types.mcq + p.types.true_false + p.types.short_answer, 0),
    50,
  );
});

/* -------------------------------------------------------------- de-duping */

test('near-identical stems are rejected as duplicates', () => {
  const filter = new DuplicateFilter(['What is the time complexity of binary search on a sorted array?']);
  assert.ok(
    filter.isDuplicate('What is the time complexity of a binary search on a sorted array?'),
    'a reworded duplicate should be caught',
  );
});

test('questions on the same topic but testing different things are kept', () => {
  const filter = new DuplicateFilter(['What is the time complexity of binary search on a sorted array?']);
  assert.equal(
    filter.isDuplicate('Why does binary search require the input to be sorted beforehand?'),
    false,
  );
});

test('jaccard similarity ignores stopwords and punctuation', () => {
  assert.equal(jaccard(tokenize('The dynamic programming table'), tokenize('dynamic programming table!')), 1);
});

/* ------------------------------------------------------ question validation */

const baseQuestion = {
  difficulty: 'medium' as const,
  question: 'Which data structure gives amortised O(1) append?',
  explanation: 'Dynamic arrays double their capacity, so appends amortise to constant time.',
  topic: 'Data structures',
};

test('a well-formed MCQ passes validation', () => {
  const result = QuestionSchema.safeParse({
    ...baseQuestion,
    type: 'mcq',
    options: ['Dynamic array', 'Sorted array', 'Binary search tree', 'Linked list with no tail'],
    correct_answer: 'Dynamic array',
  });
  assert.ok(result.success, 'valid MCQ should parse');
});

test('an MCQ without exactly four options is rejected', () => {
  const result = QuestionSchema.safeParse({
    ...baseQuestion,
    type: 'mcq',
    options: ['Dynamic array', 'Sorted array', 'Linked list'],
    correct_answer: 'Dynamic array',
  });
  assert.equal(result.success, false);
});

test('an MCQ whose answer is not one of its options is rejected', () => {
  const result = QuestionSchema.safeParse({
    ...baseQuestion,
    type: 'mcq',
    options: ['Sorted array', 'Binary search tree', 'Linked list', 'Hash table'],
    correct_answer: 'Dynamic array',
  });
  assert.equal(result.success, false);
});

test('an MCQ with repeated options is rejected', () => {
  const result = QuestionSchema.safeParse({
    ...baseQuestion,
    type: 'mcq',
    options: ['Dynamic array', 'dynamic array', 'Linked list', 'Hash table'],
    correct_answer: 'Dynamic array',
  });
  assert.equal(result.success, false);
});

test('a true/false answer must be True or False', () => {
  assert.ok(
    QuestionSchema.safeParse({ ...baseQuestion, type: 'true_false', correct_answer: 'True' }).success,
  );
  assert.equal(
    QuestionSchema.safeParse({ ...baseQuestion, type: 'true_false', correct_answer: 'Maybe' }).success,
    false,
  );
});

/* ------------------------------------------------------- catalog parsing */

test('course titles parse across the catalog formats we support', () => {
  const cases: Array<[string, string, string, string | null]> = [
    ['6.1000 Introduction to Programming', '6.1000', 'Introduction to Programming', null],
    ['CS 100   Computer Science Orientation   credit: 1 Hour.', 'CS 100', 'Computer Science Orientation', '1 Hour'],
    ['CS 229 Machine Learning (3)', 'CS 229', 'Machine Learning', '3'],
    ['ENGL 1010. Composition I. 3 Credit Hours.', 'ENGL 1010', 'Composition I', '3 Credit Hours'],
    ['21A.100 Introduction to Anthropology', '21A.100', 'Introduction to Anthropology', null],
  ];

  for (const [input, number, title, credits] of cases) {
    const parsed = splitCourseTitle(input);
    assert.equal(parsed.course_number, number, `number for ${input}`);
    assert.equal(parsed.title, title, `title for ${input}`);
    assert.equal(parsed.credits, credits, `credits for ${input}`);
  }
});

test('prerequisite extraction stops at the sentence and ignores "none"', () => {
  assert.equal(
    extractPrerequisites('Prerequisite: MATH 101. Enrollment is limited to majors.'),
    'MATH 101',
  );
  assert.equal(extractPrerequisites('Prereq: None. Offered every fall.'), null);
  assert.equal(extractPrerequisites('A survey of modern algebra.'), null);
});

/* ------------------------------------------------------------- grading */

test('multiple choice is graded exactly, ignoring case and stray whitespace', () => {
  assert.equal(gradeAnswer('mcq', 'Dynamic array', '  dynamic   array '), true);
  assert.equal(gradeAnswer('mcq', 'Dynamic array', 'Linked list'), false);
  assert.equal(gradeAnswer('mcq', 'Dynamic array', null), false);
  assert.equal(gradeAnswer('mcq', 'Dynamic array', '   '), false);
});

test('true/false is graded exactly', () => {
  assert.equal(gradeAnswer('true_false', 'True', 'true'), true);
  assert.equal(gradeAnswer('true_false', 'True', 'False'), false);
});

test('short answers are graded on overlap with the model answer', () => {
  const model = 'Binary search requires sorted input because it discards half the range each step.';
  assert.equal(
    gradeAnswer('short_answer', model, 'It requires sorted input since each step discards half the range.'),
    true,
  );
  assert.equal(gradeAnswer('short_answer', model, 'Because computers are fast.'), false);
});

/* ------------------------------------------------------- course levels */

test('course level is derived across the numbering schemes catalogs use', () => {
  const cases: Array<[string, string]> = [
    ['CS 106A', 'Introductory'],      // three-digit, 1xx
    ['CS 229', 'Undergraduate'],      // three-digit, 2xx
    ['CS 5840', 'Graduate'],          // four-digit, 5xxx
    ['6.1010', 'Introductory'],       // MIT dotted, 1xxx after the dot
    ['6.5840', 'Graduate'],           // MIT dotted, 5xxx after the dot
    ['AFRICAAM10', 'Introductory'],   // flat two-digit
    ['MUSIC 72', 'Undergraduate'],    // flat two-digit, upper half
    ['SEMINAR', 'Unspecified'],       // no number at all
  ];

  for (const [input, expected] of cases) {
    assert.equal(courseLevel(input), expected, `level for ${input}`);
  }
});
