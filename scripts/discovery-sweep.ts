/**
 * Dev harness: runs catalog discovery across a sample of seeded colleges and
 * reports which adapter each one lands on. Used to spot schools falling through
 * to the generic (AI-assisted) path so adapters can be added for them.
 *
 *   pnpm sweep [limit] [offset]
 */
import { createAdminClient } from '../lib/supabase/admin';
import { discoverCatalog } from '../lib/scraping/discover-catalog';

async function main() {
  const limit = Number(process.argv[2] ?? 20);
  const offset = Number(process.argv[3] ?? 0);

  const supabase = createAdminClient();
  const { data: colleges, error } = await supabase
    .from('colleges')
    .select('id, name, website_domain, rank')
    .order('rank', { ascending: true })
    .range(offset, offset + limit - 1);

  if (error || !colleges) throw error ?? new Error('no colleges');

  const tally: Record<string, number> = {};

  for (const college of colleges) {
    const started = Date.now();
    let line: string;
    try {
      const result = await discoverCatalog(college);
      if (result) {
        tally[result.platform] = (tally[result.platform] ?? 0) + 1;
        line = `${result.platform.padEnd(11)} ${result.catalogUrl}`;
      } else {
        tally.none = (tally.none ?? 0) + 1;
        line = 'NOT FOUND';
      }
    } catch (err) {
      tally.error = (tally.error ?? 0) + 1;
      line = `ERROR ${err instanceof Error ? err.message : err}`;
    }
    const secs = ((Date.now() - started) / 1000).toFixed(1);
    console.log(`${String(college.rank).padStart(3)} ${college.website_domain.padEnd(22)} ${line}  (${secs}s)`);
  }

  console.log('\n--- platform tally ---');
  for (const [platform, count] of Object.entries(tally).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${platform.padEnd(11)} ${count}`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
