/**
 * Dev harness: runs the real discovery + adapter pipeline against a live college
 * catalog and prints what it found. Not part of the app.
 *
 *   pnpm probe mit.edu "Massachusetts Institute of Technology" [DEPT_CODE]
 */
import { discoverCatalog } from '../lib/scraping/discover-catalog';
import { getAdapter } from '../lib/scraping/adapters/registry';
import type { ScrapeCtx } from '../lib/scraping/adapters/types';

async function main() {
  const [domain, name, deptCode] = process.argv.slice(2);
  if (!domain) {
    console.error('usage: pnpm probe <domain> [collegeName] [DEPT]');
    process.exit(1);
  }

  const result = await discoverCatalog(
    { name: name ?? domain, website_domain: domain },
    { onProgress: (m) => console.log('  ·', m) },
  );

  if (!result) {
    console.error('\n✗ no catalog found for', domain);
    process.exit(1);
  }

  console.log(`\n✓ catalog: ${result.catalogUrl}`);
  console.log(`  platform: ${result.platform}  confidence: ${result.confidence}  via: ${result.via}`);

  const adapter = getAdapter(result.platform);
  const ctx: ScrapeCtx = {
    catalogUrl: result.catalogUrl,
    domain,
    collegeName: name ?? domain,
    rootHtml: result.rootHtml,
    state: {},
    onProgress: (m) => console.log('  ·', m),
  };

  const departments = await adapter.getDepartments(ctx);
  console.log(`\n✓ ${departments.length} departments`);
  console.log(departments.slice(0, 10).map((d) => `  ${d.code.padEnd(8)} ${d.name}`).join('\n'));

  const target = deptCode
    ? departments.find((d) => d.code === deptCode.toUpperCase())
    : departments.find((d) => /^(CS|COMPSCI|CSCI|COMP)$/.test(d.code)) ?? departments[0];

  if (!target) {
    console.log('\n(no department to drill into)');
    process.exit(0);
  }

  console.log(`\n→ drilling into ${target.code} (${target.name})`);
  const courses = await adapter.getCourses(ctx, target);
  console.log(`✓ ${courses.length} courses`);
  console.log(
    courses.slice(0, 8).map((c) => `  ${c.course_number.padEnd(12)} ${c.title} [${c.credits ?? '-'}]`).join('\n'),
  );

  if (courses[0]) {
    const detail = await adapter.getCourseDetail(ctx, courses[0]);
    console.log(`\n→ detail for ${detail.course_number}`);
    console.log('  description:', (detail.description ?? '(none)').slice(0, 220));
    console.log('  prerequisites:', detail.prerequisites ?? '(none)');
    console.log('  raw content length:', detail.raw_scraped_content?.length ?? 0);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
