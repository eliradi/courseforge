import assert from 'node:assert/strict';
import test from 'node:test';

import { parseCourseBlocks, parseCourseHeading } from '../lib/scraping/adapters/courseleaf';
import { splitCourseTitle } from '../lib/scraping/adapters/types';

const BASE = 'https://catalog.example.edu/courses/x/';

// Trimmed from the live pages these layouts were fixed against.

const NOTRE_DAME = `
<div class="courseblock" data-coursecode="CBE 20255"><div class="cols noindent">
  <span class="text detail-code margin--tiny"><strong>CBE 20255</strong></span>
  <span class="text detail-title margin--tiny"><strong>Introduction to Chemical Engineering Analysis</strong></span>
  <span class="text detail-hours_html margin--tiny"><strong>(3 Credit Hours)</strong></span>
</div><div class="noindent"><div class="courseblockextra noindent">A foundation course in material and energy balances.</div></div>
<div class="noindent"><span class="text detail-prerequisites"><span class="label">Prerequisites:</span> (MATH 10560 or MATH 10860)</span></div></div>`;

const UNC = `
<div class="courseblock"><div class="cols noindent">
  <span class="text detail-code"><strong>CBPH 243.</strong></span>
  <span class="text detail-title"><strong>The Cellular Agriculture Revolution.</strong></span>
  <span class="text detail-hours"><strong>3 Credits.</strong></span>
</div><div class="noindent"><p class="courseblockextra">Learn the processes used to produce cultivated meat.</p></div></div>`;

const UT_AUSTIN = `
<div class="courseblock"><div class="cols noindent">
  <span class="text detail-ut_code margin--tiny">B A 101H</span>
  <span class="text detail-title margin--tiny">Professional Development and Career Planning: Honors</span>
  <span class="text detail-hours_html margin--tiny">1 Hour</span>
</div><div class="noindent"><div class="courseblockextra noindent">Professional development issues.</div></div></div>`;

const CLASSIC_MIT = `
<div class="courseblock"><h4 class="courseblocktitle"><strong>6.1010 Fundamentals of Programming</strong></h4>
<p class="courseblockextra"><span class="courseblockprereq">Prereq: None </span></p>
<p class="courseblockdesc">Introduces fundamental concepts of programming.</p></div>`;

test('CourseLeaf detail layout (Notre Dame) yields code, title, credits, description and prereqs', () => {
  const [course] = parseCourseBlocks(NOTRE_DAME, BASE);
  assert.equal(course.course_number, 'CBE 20255');
  assert.equal(course.title, 'Introduction to Chemical Engineering Analysis');
  assert.equal(course.credits, '3 Credit Hours');
  assert.match(course.description ?? '', /material and energy balances/);
  assert.equal(course.prerequisites, 'MATH 10560 or MATH 10860');
});

test('CourseLeaf detail layout (UNC) drops trailing periods', () => {
  const [course] = parseCourseBlocks(UNC, BASE);
  assert.equal(course.course_number, 'CBPH 243');
  assert.equal(course.title, 'The Cellular Agriculture Revolution');
  assert.equal(course.credits, '3 Credits');
});

test('CourseLeaf detail layout with a school-specific code class (UT Austin)', () => {
  const [course] = parseCourseBlocks(UT_AUSTIN, BASE);
  assert.equal(course.course_number, 'B A 101H');
  assert.equal(course.title, 'Professional Development and Career Planning: Honors');
  assert.equal(course.credits, '1 Hour');
});

test('the classic CourseLeaf layout still parses', () => {
  const [course] = parseCourseBlocks(CLASSIC_MIT, BASE);
  assert.equal(course.course_number, '6.1010');
  assert.equal(course.title, 'Fundamentals of Programming');
  assert.equal(course.prerequisites, null);
});

test('course headings with colon separators and cross-list suffixes', () => {
  const cases: Array<[string, string, string, string | null]> = [
    ['ACCT:1300 First-Year Seminar 1 s.h.', 'ACCT:1300', 'First-Year Seminar', '1 s.h'],
    ['ACCT:2100 Introduction to Financial Accounting 3 s.h.', 'ACCT:2100', 'Introduction to Financial Accounting', '3 s.h'],
    ['1.63[J] Advanced Fluid Dynamics', '1.63[J]', 'Advanced Fluid Dynamics', null],
    ['6.7700[J] Fundamentals of Probability', '6.7700[J]', 'Fundamentals of Probability', null],
  ];
  for (const [input, number, title, credits] of cases) {
    const parsed = splitCourseTitle(input);
    assert.equal(parsed.course_number, number, `number for ${input}`);
    assert.equal(parsed.title, title, `title for ${input}`);
    assert.equal(parsed.credits, credits, `credits for ${input}`);
  }
});

test('comma-form headings with comma-separated fields (Oregon State)', () => {
  const html = `
    <div class="courseblock"><h2 class="courseblocktitle"><strong>AEC LDEA,  LOWER DIVISION ED ABROAD,  0-16 Credits</strong></h2></div>
    <div class="courseblock"><h2 class="courseblocktitle"><strong>AEC 007,  +BEYOND OSU I: PREPARE,  0 Credits</strong></h2>
      <p class="courseblockdesc noindent">Explore career goals and interests.</p></div>
    <div class="courseblock"><h2 class="courseblocktitle"><strong>AEC 122,  *INTRODUCTION TO CLIMATE CHANGE ECONOMICS AND POLICY,  3 Credits</strong></h2>
      <p class="courseblockdesc noindent">Economics of climate policy.</p></div>`;
  const courses = parseCourseBlocks(html, BASE, 'AEC');
  assert.deepEqual(
    courses.map((c) => [c.course_number, c.title, c.credits, c.instructors ?? null]),
    [
      ['AEC 007', 'BEYOND OSU I: PREPARE', '0 Credits', null],
      ['AEC 122', 'INTRODUCTION TO CLIMATE CHANGE ECONOMICS AND POLICY', '3 Credits', null],
    ],
  );
});

test('comma-form headings keep instructor names (Yale style)', () => {
  const parsed = parseCourseHeading('CPSC 201a, Introduction to Computer Science  Jane Doe and John Roe', 'CPSC');
  assert.equal(parsed?.course_number, 'CPSC 201a');
  assert.equal(parsed?.title, 'Introduction to Computer Science');
  assert.deepEqual(parsed?.instructors, ['Jane Doe', 'John Roe']);
});
