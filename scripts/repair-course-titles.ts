/**
 * Repairs courses stored by the old CourseLeaf parser without a real title.
 *
 *   pnpm repair-titles            # dry run: what would be refreshed
 *   pnpm repair-titles --apply    # refresh those departments and clean up
 *
 * Two kinds of broken row exist:
 *   - code only ("CHEM 40404" as both number and title) — a refresh updates them
 *     in place, since the course number was already right;
 *   - whole heading stored as the number ("6.C57[J] Optimization Methods") — a
 *     refresh inserts the corrected course beside it, so the old row is removed
 *     afterwards, but only if nothing (sections, tests) refers to it.
 */
import { ensureCourses } from '../lib/scraping/pipeline';
import { createAdminClient } from '../lib/supabase/admin';

const apply = process.argv.includes('--apply');

/** Ids per `.in()` filter — PostgREST puts them in the URL, which has a length limit. */
const ID_CHUNK = 150;

function chunks<T>(items: T[], size = ID_CHUNK): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

interface BrokenRow {
  id: string;
  department_id: string;
  course_number: string;
  title: string;
}

function isBroken(row: Pick<BrokenRow, 'course_number' | 'title'>): boolean {
  return (
    row.course_number === row.title ||
    (row.course_number.length === 40 && row.title.startsWith(row.course_number))
  );
}

async function brokenRows(): Promise<BrokenRow[]> {
  const admin = createAdminClient();
  const rows: BrokenRow[] = [];
  // Page through everything; the table is too big for one response.
  for (let from = 0; ; from += 1000) {
    const { data, error } = await admin
      .from('courses')
      .select('id, department_id, course_number, title')
      .order('id')
      .range(from, from + 999);
    if (error) throw error;
    if (!data?.length) break;
    rows.push(...data.filter(isBroken));
    if (data.length < 1000) break;
  }
  return rows;
}

async function main() {
  const admin = createAdminClient();
  const broken = await brokenRows();

  const byDepartment = new Map<string, BrokenRow[]>();
  for (const row of broken) {
    const list = byDepartment.get(row.department_id) ?? [];
    list.push(row);
    byDepartment.set(row.department_id, list);
  }

  const departments = [];
  for (const ids of chunks([...byDepartment.keys()])) {
    const { data, error } = await admin
      .from('departments')
      .select('id, code, colleges!inner(short_name, name)')
      .in('id', ids);
    if (error) throw error;
    departments.push(...(data ?? []));
  }

  const label = new Map(
    departments.map((d) => {
      const college = d.colleges as unknown as { short_name: string | null; name: string };
      return [d.id, `${college.short_name ?? college.name} ${d.code}`];
    }),
  );

  const perCollege = new Map<string, number>();
  for (const [id, rows] of byDepartment) {
    const college = (label.get(id) ?? '?').replace(/ [^ ]+$/, '');
    perCollege.set(college, (perCollege.get(college) ?? 0) + rows.length);
  }

  console.log(`${broken.length} broken courses in ${byDepartment.size} departments\n`);
  for (const [college, count] of [...perCollege].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${college.padEnd(24)} ${count}`);
  }

  if (!apply) {
    console.log(`\nDry run. Re-run with --apply to refresh these ${byDepartment.size} departments.`);
    console.log('Each department is one catalog request, spaced 1.5s apart per host.');
    return;
  }

  let refreshed = 0;
  let removed = 0;
  let failed = 0;

  for (const [departmentId, rows] of byDepartment) {
    const name = label.get(departmentId) ?? departmentId;
    try {
      const result = await ensureCourses(departmentId, { force: true });

      // A refresh fixes code-only rows in place. Any original row that is *still*
      // broken was superseded by a corrected row under a different number (or the
      // course is no longer listed) — remove it, but only if the refresh produced
      // courses and nothing (sections, tests) refers to it.
      const removable: string[] = [];
      for (const ids of chunks(rows.map((row) => row.id))) {
        const { data: afterRefresh, error } = await admin
          .from('courses')
          .select('id, course_number, title, course_sections(id)')
          .in('id', ids);
        if (error) throw error;
        for (const row of afterRefresh ?? []) {
          if (isBroken(row) && !(row.course_sections as unknown[] | null)?.length) removable.push(row.id);
        }
      }

      if (removable.length && result.courses.length) {
        for (const ids of chunks(removable)) {
          const { error } = await admin.from('courses').delete().in('id', ids);
          if (error) throw error;
        }
        removed += removable.length;
      }

      refreshed++;
      console.log(`  ✓ ${name}: ${result.courses.length} courses, ${removable.length} stale rows removed`);
    } catch (error) {
      failed++;
      console.log(`  ✗ ${name}: ${error instanceof Error ? error.message : error}`);
    }
  }

  const remaining = (await brokenRows()).length;
  console.log(`\n${refreshed} departments refreshed, ${failed} failed, ${removed} stale rows removed.`);
  console.log(`${remaining} broken courses remain.`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
