import { getAdminUser } from '@/lib/auth/admin';
import { getBulkJob, requestCancel } from '@/lib/bulk/jobs';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Asks a running job to stop. The runner honours it between steps, so the
 * university in progress finishes first. Closing the browser no longer cancels.
 */
export async function POST(_request: Request, context: { params: Promise<{ jobId: string }> }) {
  if (!(await getAdminUser())) return Response.json({ error: 'Not authorised.' }, { status: 401 });

  const { jobId } = await context.params;
  await requestCancel(jobId);
  return Response.json({ job: await getBulkJob(jobId) });
}
