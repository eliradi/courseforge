import { after, type NextRequest } from 'next/server';
import { z } from 'zod';

import { getAdminUser } from '@/lib/auth/admin';
import { createBulkJob, getBulkJob } from '@/lib/bulk/jobs';
import { runBulkJob } from '@/lib/bulk/runner';

export const runtime = 'nodejs';
export const maxDuration = 800;
export const dynamic = 'force-dynamic';

const BodySchema = z
  .object({
    staleDays: z.number().int().min(0).max(3650),
    rankFrom: z.number().int().min(1).max(200),
    rankTo: z.number().int().min(1).max(200),
    maxColleges: z.number().int().min(1).max(200),
    departmentLimit: z.number().int().min(0).max(25),
  })
  .refine((body) => body.rankFrom <= body.rankTo, {
    message: 'rankFrom must not be greater than rankTo',
    path: ['rankFrom'],
  });

/**
 * Creates a bulk job and starts it running server-side.
 *
 * The runner is not tied to this request: the response returns immediately with
 * the job id, and the browser follows progress through the events endpoint —
 * which it can drop and reconnect to without affecting the job.
 */
export async function POST(request: NextRequest) {
  const admin = await getAdminUser();
  if (!admin) return Response.json({ error: 'Not authorised.' }, { status: 401 });

  const parsed = BodySchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) return Response.json({ error: 'Invalid request body.' }, { status: 400 });

  try {
    const jobId = await createBulkJob(parsed.data, admin.id);
    // `after` keeps the runner alive past the response where the platform
    // supports it; on a long-lived Node server it simply continues.
    after(() => runBulkJob(jobId));
    return Response.json({ job: await getBulkJob(jobId) });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : 'Could not start the job.' },
      { status: 500 },
    );
  }
}
