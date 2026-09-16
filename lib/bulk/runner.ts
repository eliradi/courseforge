import 'server-only';

import { withUsageContext } from '@/lib/ai/usage';
import { recordOperationRun } from '@/lib/db/operation-runs';
import { discoverCatalog } from '@/lib/scraping/discover-catalog';
import { ensureCourses, ensureDepartments } from '@/lib/scraping/pipeline';
import { withTrace, type TraceEvent } from '@/lib/scraping/trace';
import { createAdminClient } from '@/lib/supabase/admin';

export interface BulkParams {
  staleDays: number;
  rankFrom: number;
  rankTo: number;
  maxColleges: number;
  departmentLimit: number;
}

/** A job whose heartbeat is older than this has lost its runner. */
export const HEARTBEAT_STALE_MS = 90_000;

/**
 * Runners alive in this process. A job id in here is genuinely being worked on;
 * anything else marked `running` in the database belonged to a process that has
 * since gone away.
 *
 * Kept on globalThis because dev-mode recompiles re-evaluate this module, and a
 * fresh Set would make a still-running job look abandoned.
 */
const globalForBulk = globalThis as unknown as { __courseforgeBulkRunners?: Set<string> };
const active = (globalForBulk.__courseforgeBulkRunners ??= new Set<string>());

export function isRunnerActive(jobId: string): boolean {
  return active.has(jobId);
}

type JobEvent =
  | ({ type: 'trace' } & Omit<TraceEvent, 'at'> & { at: number })
  | {
      type: 'college';
      phase: 'start' | 'done';
      collegeId: string;
      name: string;
      rank: number | null;
      index: number;
      total: number;
      ok?: boolean;
      summary?: string;
      costUsd?: number;
    }
  | { type: 'status'; status: string; processed: number; succeeded: number; failed: number; totalCostUsd: number };

/**
 * Buffers job events and writes them in batches.
 *
 * A single retrieval can emit hundreds of trace events; a database round trip
 * per event would slow the job noticeably. Flushing also refreshes the job's
 * heartbeat, which is how a lost runner is detected.
 */
class EventWriter {
  private buffer: Array<{ job_id: string; seq: number; event: JobEvent }> = [];
  private timer: NodeJS.Timeout | null = null;
  private flushing: Promise<void> = Promise.resolve();

  constructor(
    private readonly jobId: string,
    private seq: number,
  ) {}

  push(event: JobEvent): void {
    this.buffer.push({ job_id: this.jobId, seq: ++this.seq, event });
    if (this.buffer.length >= 25) void this.flush();
    else if (!this.timer) this.timer = setTimeout(() => void this.flush(), 500);
  }

  async flush(): Promise<void> {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    const batch = this.buffer.splice(0);

    // Serialise flushes so sequence numbers land in order.
    this.flushing = this.flushing.then(async () => {
      const admin = createAdminClient();
      if (batch.length) {
        const { error } = await admin.from('bulk_job_events').insert(batch);
        if (error) console.error('[bulk] could not write events:', error.message);
      }
      await admin
        .from('bulk_jobs')
        .update({ heartbeat_at: new Date().toISOString() })
        .eq('id', this.jobId);
    });
    return this.flushing;
  }
}

async function nextSeq(jobId: string): Promise<number> {
  const admin = createAdminClient();
  const { data } = await admin
    .from('bulk_job_events')
    .select('seq')
    .eq('job_id', jobId)
    .order('seq', { ascending: false })
    .limit(1)
    .maybeSingle();
  return data?.seq ?? 0;
}

async function cancelRequested(jobId: string): Promise<boolean> {
  const admin = createAdminClient();
  const { data } = await admin
    .from('bulk_jobs')
    .select('cancel_requested')
    .eq('id', jobId)
    .maybeSingle();
  return Boolean(data?.cancel_requested);
}

/**
 * Works through a job's unfinished universities.
 *
 * Safe to call on a fresh job or to resume an interrupted one: it only touches
 * items still `pending` (or `running`, which means a previous runner died on
 * them). Each university is checked first and retrieved only if the check
 * succeeds, and records its own operation runs so per-university cost lands in
 * the admin table.
 *
 * Never throws — the caller starts this detached from any request.
 */
export async function runBulkJob(jobId: string): Promise<void> {
  if (active.has(jobId)) return;
  active.add(jobId);

  const admin = createAdminClient();
  const began = Date.now();
  const writer = new EventWriter(jobId, await nextSeq(jobId));

  // Events refresh the heartbeat, but a single scrape step can be quiet for a
  // minute. Beat on a timer too, so only a genuinely dead runner goes stale.
  const heartbeat = setInterval(() => {
    void admin
      .from('bulk_jobs')
      .update({ heartbeat_at: new Date().toISOString() })
      .eq('id', jobId);
  }, 15_000);

  const trace = (event: Omit<TraceEvent, 'at'>) =>
    writer.push({ type: 'trace', ...event, at: Date.now() - began });

  try {
    const { data: job } = await admin.from('bulk_jobs').select('*').eq('id', jobId).maybeSingle();
    if (!job) return;

    const params = job.params as unknown as BulkParams;

    await admin
      .from('bulk_jobs')
      .update({ status: 'running', error: null, finished_at: null, heartbeat_at: new Date().toISOString() })
      .eq('id', jobId);

    const { data: items } = await admin
      .from('bulk_job_items')
      .select('college_id, position, status, colleges!inner(id, name, rank, website_domain)')
      .eq('job_id', jobId)
      .in('status', ['pending', 'running'])
      .order('position');

    const remaining = (items ?? []) as unknown as Array<{
      college_id: string;
      position: number;
      status: string;
      colleges: { id: string; name: string; rank: number | null; website_domain: string };
    }>;

    trace({
      level: 'info',
      message: job.processed > 0 ? `Resuming — ${remaining.length} universities left` : `${remaining.length} universities to process`,
      detail: `Ranks ${params.rankFrom}–${params.rankTo} · stale after ${params.staleDays} days · ${params.departmentLimit} departments each`,
    });

    let { processed, succeeded, failed } = job;
    let totalCost = Number(job.total_cost_usd ?? 0);

    for (const item of remaining) {
      if (await cancelRequested(jobId)) {
        trace({ level: 'warn', message: 'Cancelled', detail: `Stopped after ${processed} of ${job.total}.` });
        await writer.flush();
        await admin
          .from('bulk_jobs')
          .update({ status: 'cancelled', finished_at: new Date().toISOString(), current_college_id: null })
          .eq('id', jobId);
        writer.push({ type: 'status', status: 'cancelled', processed, succeeded, failed, totalCostUsd: totalCost });
        await writer.flush();
        return;
      }

      const college = item.colleges;
      const index = item.position + 1;

      await admin
        .from('bulk_job_items')
        .update({ status: 'running', updated_at: new Date().toISOString() })
        .eq('job_id', jobId)
        .eq('college_id', college.id);
      await admin.from('bulk_jobs').update({ current_college_id: college.id }).eq('id', jobId);

      writer.push({
        type: 'college',
        phase: 'start',
        collegeId: college.id,
        name: college.name,
        rank: college.rank,
        index,
        total: job.total,
      });

      const outcome = await processCollege(college, params, trace, () => cancelRequested(jobId));

      processed++;
      totalCost += outcome.costUsd;
      if (outcome.ok) succeeded++;
      else failed++;

      await admin
        .from('bulk_job_items')
        .update({
          status: outcome.ok ? 'ok' : 'failed',
          summary: outcome.summary.slice(0, 500),
          cost_usd: outcome.costUsd,
          updated_at: new Date().toISOString(),
        })
        .eq('job_id', jobId)
        .eq('college_id', college.id);

      await admin
        .from('bulk_jobs')
        .update({ processed, succeeded, failed, total_cost_usd: totalCost })
        .eq('id', jobId);

      writer.push({
        type: 'college',
        phase: 'done',
        collegeId: college.id,
        name: college.name,
        rank: college.rank,
        index,
        total: job.total,
        ok: outcome.ok,
        summary: outcome.summary,
        costUsd: outcome.costUsd,
      });
    }

    trace({
      level: 'success',
      message: 'Bulk run finished',
      detail: `${succeeded} succeeded · ${failed} failed · ${totalCost.toFixed(4)} USD`,
    });
    await writer.flush();

    await admin
      .from('bulk_jobs')
      .update({ status: 'completed', finished_at: new Date().toISOString(), current_college_id: null })
      .eq('id', jobId);
    writer.push({ type: 'status', status: 'completed', processed, succeeded, failed, totalCostUsd: totalCost });
    await writer.flush();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error('[bulk] runner failed:', message);
    trace({ level: 'error', message: 'Runner failed', detail: message });
    await writer.flush().catch(() => undefined);
    await admin
      .from('bulk_jobs')
      .update({ status: 'failed', error: message.slice(0, 500), finished_at: new Date().toISOString() })
      .eq('id', jobId);
  } finally {
    clearInterval(heartbeat);
    active.delete(jobId);
  }
}

async function processCollege(
  college: { id: string; name: string; website_domain: string },
  params: BulkParams,
  trace: (event: Omit<TraceEvent, 'at'>) => void,
  shouldStop: () => Promise<boolean>,
): Promise<{ ok: boolean; summary: string; costUsd: number }> {
  const admin = createAdminClient();
  let costUsd = 0;

  try {
    return await withTrace(trace, () =>
      withUsageContext({ collegeId: college.id }, async () => {
        const checkStartedAt = new Date();
        trace({ level: 'step', message: `Checking ${college.name}`, detail: college.website_domain });

        const discovered = await discoverCatalog(college, {
          onProgress: (message) => trace({ level: 'step', message }),
        });

        const check = await recordOperationRun({
          kind: 'catalog_check',
          scope: { collegeId: college.id },
          startedAt: checkStartedAt,
          ok: Boolean(discovered),
          summary: discovered ? `${discovered.platform} · found via ${discovered.via}` : 'no catalog found',
        });
        costUsd += check.costUsd;

        if (!discovered) {
          trace({ level: 'warn', message: `${college.name}: no catalog found` });
          return { ok: false, summary: 'no catalog found', costUsd };
        }

        await admin
          .from('colleges')
          .update({
            catalog_url: discovered.catalogUrl,
            catalog_platform: discovered.platform,
            catalog_source: discovered.via,
            catalog_discovered_at: new Date().toISOString(),
            catalog_error: null,
          })
          .eq('id', college.id);

        trace({
          level: 'success',
          message: `${college.name}: ${discovered.platform}`,
          detail: `${discovered.catalogUrl} · via ${discovered.via}`,
        });

        const retrievalStartedAt = new Date();
        try {
          const { departments } = await ensureDepartments(college.id, {
            force: true,
            onProgress: (message) => trace({ level: 'step', message }),
          });

          let courses = 0;
          for (const department of departments.slice(0, params.departmentLimit)) {
            if (await shouldStop()) break;
            try {
              const result = await ensureCourses(department.id, {
                force: true,
                onProgress: (message) => trace({ level: 'step', message }),
              });
              courses += result.courses.length;
              trace({
                level: 'success',
                message: `${college.name} · ${department.code}: ${result.courses.length} courses`,
              });
            } catch (error) {
              trace({
                level: 'error',
                message: `${college.name} · ${department.code} failed`,
                detail: error instanceof Error ? error.message : String(error),
              });
            }
          }

          const summary = `${departments.length} departments · ${courses} courses`;
          const retrieval = await recordOperationRun({
            kind: 'course_retrieval',
            scope: { collegeId: college.id },
            startedAt: retrievalStartedAt,
            ok: true,
            summary,
          });
          costUsd += retrieval.costUsd;
          return { ok: true, summary, costUsd };
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          const retrieval = await recordOperationRun({
            kind: 'course_retrieval',
            scope: { collegeId: college.id },
            startedAt: retrievalStartedAt,
            ok: false,
            summary: message.slice(0, 300),
          });
          costUsd += retrieval.costUsd;
          trace({ level: 'error', message: `${college.name}: retrieval failed`, detail: message });
          return { ok: false, summary: message, costUsd };
        }
      }),
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    trace({ level: 'error', message: `${college.name} failed`, detail: message });
    return { ok: false, summary: message, costUsd };
  }
}
