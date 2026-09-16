import { after } from 'next/server';

import { getAdminUser } from '@/lib/auth/admin';
import { getBulkJob, prepareResume } from '@/lib/bulk/jobs';
import { isRunnerActive, runBulkJob } from '@/lib/bulk/runner';

export const runtime = 'nodejs';
export const maxDuration = 800;
export const dynamic = 'force-dynamic';

/** Restarts an interrupted job on the universities it hadn't finished. */
export async function POST(_request: Request, context: { params: Promise<{ jobId: string }> }) {
  if (!(await getAdminUser())) return Response.json({ error: 'Not authorised.' }, { status: 401 });

  const { jobId } = await context.params;
  const job = await getBulkJob(jobId);
  if (!job) return Response.json({ error: 'Job not found.' }, { status: 404 });

  if (isRunnerActive(jobId)) {
    return Response.json({ job, note: 'Already running.' });
  }
  if (job.status === 'completed') {
    return Response.json({ error: 'That job already finished.' }, { status: 409 });
  }

  await prepareResume(jobId);
  after(() => runBulkJob(jobId));
  return Response.json({ job: await getBulkJob(jobId) });
}
