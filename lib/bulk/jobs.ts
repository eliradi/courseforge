import 'server-only';

import { matchesRegion } from '@/lib/colleges';
import { createAdminClient } from '@/lib/supabase/admin';
import { HEARTBEAT_STALE_MS, isRunnerActive, type BulkParams } from './runner';

export type BulkStatus = 'running' | 'completed' | 'cancelled' | 'interrupted' | 'failed';

export interface BulkItem {
  collegeId: string;
  name: string;
  rank: number | null;
  position: number;
  status: 'pending' | 'running' | 'ok' | 'failed' | 'skipped';
  summary: string | null;
  costUsd: number;
}

export interface BulkJobState {
  id: string;
  params: BulkParams;
  status: BulkStatus;
  total: number;
  processed: number;
  succeeded: number;
  failed: number;
  totalCostUsd: number;
  error: string | null;
  createdAt: string;
  finishedAt: string | null;
  heartbeatAt: string;
  items: BulkItem[];
}

/**
 * Picks the universities a job should touch: inside the ranking window, and
 * holding no course data, data older than the cutoff, or — when asked — current
 * data with departments that were never filled in.
 */
async function selectCandidates(params: BulkParams): Promise<Array<{ id: string }>> {
  const admin = createAdminClient();
  const cutoff = Date.now() - params.staleDays * 24 * 60 * 60 * 1000;

  const [colleges, stats] = await Promise.all([
    admin
      .from('colleges')
      .select('id, rank, country')
      .order('rank', { ascending: true, nullsFirst: false }),
    admin
      .from('college_stats')
      .select('college_id, course_count, last_scraped_at, department_count, departments_sourced'),
  ]);

  const statsById = new Map((stats.data ?? []).map((row) => [row.college_id, row]));

  return (colleges.data ?? [])
    .filter((college) => {
      if (college.rank === null) return false;
      if (!matchesRegion(college.country, params.region)) return false;
      if (college.rank < params.rankFrom || college.rank > params.rankTo) return false;

      const stat = statsById.get(college.id);
      if (!stat?.course_count) return true;
      if (!stat.last_scraped_at) return true;
      if (new Date(stat.last_scraped_at).getTime() < cutoff) return true;
      // Current data, but some departments were never filled in.
      return (
        params.includePartial &&
        (stat.departments_sourced ?? 0) < (stat.department_count ?? 0)
      );
    })
    .slice(0, params.maxColleges)
    .map((college) => ({ id: college.id }));
}

/** Freezes the candidate list into a job. The caller starts the runner. */
export async function createBulkJob(params: BulkParams, userId: string): Promise<string> {
  const admin = createAdminClient();
  const candidates = await selectCandidates(params);

  const { data: job, error } = await admin
    .from('bulk_jobs')
    .insert({
      created_by: userId,
      params: params as unknown as Record<string, number>,
      total: candidates.length,
      status: candidates.length ? 'running' : 'completed',
      finished_at: candidates.length ? null : new Date().toISOString(),
    })
    .select('id')
    .single();

  if (error || !job) throw new Error(error?.message ?? 'Could not create the job.');

  if (candidates.length) {
    const { error: itemsError } = await admin.from('bulk_job_items').insert(
      candidates.map((candidate, position) => ({
        job_id: job.id,
        college_id: candidate.id,
        position,
      })),
    );
    if (itemsError) throw new Error(itemsError.message);
  }

  return job.id;
}

/**
 * The job as the dialog should see it.
 *
 * A job recorded as `running` whose runner isn't alive in this process and whose
 * heartbeat has gone quiet was orphaned — its server restarted or crashed. It's
 * reported (and persisted) as `interrupted` so the UI can offer to resume it.
 */
export async function getBulkJob(jobId: string): Promise<BulkJobState | null> {
  const admin = createAdminClient();

  const [{ data: job }, { data: items }] = await Promise.all([
    admin.from('bulk_jobs').select('*').eq('id', jobId).maybeSingle(),
    admin
      .from('bulk_job_items')
      .select('college_id, position, status, summary, cost_usd, colleges!inner(name, rank)')
      .eq('job_id', jobId)
      .order('position'),
  ]);

  if (!job) return null;

  let status = job.status as BulkStatus;
  const stale = Date.now() - new Date(job.heartbeat_at).getTime() > HEARTBEAT_STALE_MS;

  if (status === 'running' && !isRunnerActive(jobId) && stale) {
    status = 'interrupted';
    await admin.from('bulk_jobs').update({ status: 'interrupted' }).eq('id', jobId).eq('status', 'running');
  }

  return {
    id: job.id,
    params: job.params as unknown as BulkParams,
    status,
    total: job.total,
    processed: job.processed,
    succeeded: job.succeeded,
    failed: job.failed,
    totalCostUsd: Number(job.total_cost_usd ?? 0),
    error: job.error,
    createdAt: job.created_at,
    finishedAt: job.finished_at,
    heartbeatAt: job.heartbeat_at,
    items: ((items ?? []) as unknown as Array<{
      college_id: string;
      position: number;
      status: BulkItem['status'];
      summary: string | null;
      cost_usd: number | string;
      colleges: { name: string; rank: number | null };
    }>).map((item) => ({
      collegeId: item.college_id,
      name: item.colleges.name,
      rank: item.colleges.rank,
      position: item.position,
      status: item.status,
      summary: item.summary,
      costUsd: Number(item.cost_usd ?? 0),
    })),
  };
}

export async function latestBulkJobId(): Promise<string | null> {
  const admin = createAdminClient();
  const { data } = await admin
    .from('bulk_jobs')
    .select('id')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  return data?.id ?? null;
}

export async function requestCancel(jobId: string): Promise<void> {
  const admin = createAdminClient();
  await admin.from('bulk_jobs').update({ cancel_requested: true }).eq('id', jobId);
}

/** Readies an interrupted job to pick up where it stopped. The caller starts the runner. */
export async function prepareResume(jobId: string): Promise<void> {
  const admin = createAdminClient();
  await admin
    .from('bulk_jobs')
    .update({ status: 'running', cancel_requested: false, heartbeat_at: new Date().toISOString() })
    .eq('id', jobId);
}
