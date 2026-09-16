import type { NextRequest } from 'next/server';

import { getAdminUser } from '@/lib/auth/admin';
import { getBulkJob } from '@/lib/bulk/jobs';
import { createAdminClient } from '@/lib/supabase/admin';

export const runtime = 'nodejs';
export const maxDuration = 800;
export const dynamic = 'force-dynamic';

const POLL_MS = 1000;
const HEARTBEAT_MS = 15_000;

/**
 * Streams a job's progress log, starting after `?after=<seq>`.
 *
 * Reading the log from the database is what makes this safe to drop: the job
 * doesn't care whether anyone is watching, and a browser that reconnects with
 * the last sequence number it saw picks up exactly where it left off.
 */
export async function GET(request: NextRequest, context: { params: Promise<{ jobId: string }> }) {
  if (!(await getAdminUser())) return Response.json({ error: 'Not authorised.' }, { status: 401 });

  const { jobId } = await context.params;
  // EventSource sends Last-Event-ID on its automatic reconnects, which is more
  // current than the `after` it was first opened with.
  let cursor =
    Number(request.headers.get('last-event-id') ?? '') ||
    Number(new URL(request.url).searchParams.get('after') ?? 0) ||
    0;

  const admin = createAdminClient();
  const encoder = new TextEncoder();

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let closed = false;
      const write = (chunk: string) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(chunk));
        } catch {
          closed = true;
        }
      };

      request.signal.addEventListener('abort', () => {
        closed = true;
      });

      let lastWrite = Date.now();
      let lastSnapshot = '';

      while (!closed) {
        const { data: events } = await admin
          .from('bulk_job_events')
          .select('seq, event')
          .eq('job_id', jobId)
          .gt('seq', cursor)
          .order('seq')
          .limit(500);

        for (const row of events ?? []) {
          cursor = row.seq;
          write(`id: ${row.seq}\ndata: ${JSON.stringify({ seq: row.seq, ...(row.event as object) })}\n\n`);
          lastWrite = Date.now();
        }

        // A full page means more is waiting — drain before sleeping.
        if ((events?.length ?? 0) === 500) continue;

        const job = await getBulkJob(jobId);
        if (!job) {
          write(`data: ${JSON.stringify({ type: 'gone' })}\n\n`);
          break;
        }

        // Only resend the job when something about it changed.
        const snapshot = JSON.stringify(job);
        if (snapshot !== lastSnapshot) {
          write(`data: ${JSON.stringify({ type: 'job', job })}\n\n`);
          lastSnapshot = snapshot;
          lastWrite = Date.now();
        }

        // Once the job has stopped and every event is out, the stream is done.
        if (job.status !== 'running') break;

        // SSE comment lines keep proxies and idle timers from closing a quiet stream.
        if (Date.now() - lastWrite > HEARTBEAT_MS) {
          write(': keepalive\n\n');
          lastWrite = Date.now();
        }

        await new Promise((resolve) => setTimeout(resolve, POLL_MS));
      }

      closed = true;
      try {
        controller.close();
      } catch {
        /* already closed */
      }
    },
  });

  return new Response(stream, {
    headers: {
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'no-cache, no-transform',
      connection: 'keep-alive',
      'x-accel-buffering': 'no',
    },
  });
}
