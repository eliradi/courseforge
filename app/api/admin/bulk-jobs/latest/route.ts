import { getAdminUser } from '@/lib/auth/admin';
import { getBulkJob, latestBulkJobId } from '@/lib/bulk/jobs';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** The most recent job, so the dialog can reattach after a refresh or reconnect. */
export async function GET() {
  if (!(await getAdminUser())) return Response.json({ error: 'Not authorised.' }, { status: 401 });

  const id = await latestBulkJobId();
  return Response.json({ job: id ? await getBulkJob(id) : null });
}
