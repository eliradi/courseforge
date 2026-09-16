import type { NextRequest } from 'next/server';
import { z } from 'zod';

import { getAdminUser } from '@/lib/auth/admin';
import { withUsageContext } from '@/lib/ai/usage';
import { createAdminClient } from '@/lib/supabase/admin';
import { discoverCatalog } from '@/lib/scraping/discover-catalog';
import { PipelineError } from '@/lib/scraping/pipeline';
import { describeRetrieval, retrieveMissingCourses } from '@/lib/scraping/retrieve-missing';
import { withTrace } from '@/lib/scraping/trace';
import { recordOperationRun } from '@/lib/db/operation-runs';
import { sseResponse, type SseEvent } from '@/lib/sse';

export const runtime = 'nodejs';
export const maxDuration = 800;
export const dynamic = 'force-dynamic';

const BodySchema = z.object({
  mode: z.enum(['probe', 'retrieve']),
  /** `null` fetches every department that is still missing courses. */
  departmentLimit: z.number().int().min(0).max(1000).nullable().default(null),
});

/**
 * Streams a catalog probe or retrieval, step by step.
 *
 * The admin console shows this live in a dialog, so the stream carries every
 * scraper request — URL, status, size, duration — alongside the pipeline's own
 * progress, rather than just a final result.
 */
export async function POST(
  request: NextRequest,
  context: { params: Promise<{ collegeId: string }> },
) {
  if (!(await getAdminUser())) {
    return Response.json({ error: 'Not authorised.' }, { status: 401 });
  }

  const { collegeId } = await context.params;
  const parsed = BodySchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) return Response.json({ error: 'Invalid request body.' }, { status: 400 });

  const { mode, departmentLimit } = parsed.data;
  const admin = createAdminClient();

  const { data: college } = await admin
    .from('colleges')
    .select('id, name, website_domain, catalog_url, catalog_platform, catalog_source')
    .eq('id', collegeId)
    .maybeSingle();

  if (!college) return Response.json({ error: 'College not found.' }, { status: 404 });

  const startedAt = new Date().toISOString();

  return sseResponse(async (emit) => {
    const began = Date.now();

    const send = (event: Omit<Extract<SseEvent, { type: 'trace' }>, 'type' | 'at'>) =>
      emit({ type: 'trace', at: Date.now() - began, ...event });

    send({
      level: 'info',
      message: `${mode === 'probe' ? 'Checking retrieval method' : 'Retrieving courses'} for ${college.name}`,
      detail: college.website_domain,
    });

    if (college.catalog_url) {
      send({
        level: 'info',
        message: 'Known catalog',
        detail: `${college.catalog_url} · ${college.catalog_platform ?? 'unknown platform'} · found via ${college.catalog_source ?? 'unknown route'}`,
      });
    } else {
      send({ level: 'info', message: 'No catalog cached yet — starting from scratch' });
    }

    try {
      const result = await withTrace(send, () =>
        withUsageContext({ collegeId }, async () => {
          if (mode === 'probe') {
            send({ level: 'step', message: 'Running catalog discovery (no scraping)' });
            const discovered = await discoverCatalog(college, {
              onProgress: (message) => send({ level: 'step', message }),
            });

            if (!discovered) {
              send({
                level: 'warn',
                message: 'No catalog found',
                detail: `Nothing on ${college.website_domain} looked like a course catalog. A URL can be pasted by hand on the college page.`,
              });
              return { ok: false, summary: 'No catalog found' };
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
              .eq('id', collegeId);

            send({
              level: 'success',
              message: `Detected ${discovered.platform}`,
              detail: `${discovered.catalogUrl} · found via ${discovered.via} · confidence ${discovered.confidence}`,
            });
            return {
              ok: true,
              summary: `${discovered.platform} · found via ${discovered.via}`,
              platform: discovered.platform,
              catalogUrl: discovered.catalogUrl,
            };
          }

          // Fill in what's missing only — departments that already have courses
          // in the database are not fetched again.
          send({ level: 'step', message: 'Retrieving departments and courses that are missing' });
          const result = await retrieveMissingCourses(collegeId, {
            staleDays: null,
            departmentLimit,
            onProgress: (message) => send({ level: 'step', message }),
          });

          const { data: refreshed } = await admin
            .from('colleges')
            .select('catalog_url, catalog_platform')
            .eq('id', collegeId)
            .maybeSingle();

          const summary = describeRetrieval(result);
          send({
            level: result.failed && !result.fetched ? 'warn' : 'success',
            message: summary,
            detail: refreshed?.catalog_url ?? undefined,
          });

          return {
            ok: !(result.failed && !result.fetched),
            summary,
            platform: result.platform ?? refreshed?.catalog_platform ?? undefined,
            catalogUrl: refreshed?.catalog_url ?? undefined,
            departmentCount: result.departmentCount,
            courseCount: result.coursesFetched,
          };
        }),
      );

      const { costUsd } = await recordOperationRun({
        kind: mode === 'probe' ? 'catalog_check' : 'course_retrieval',
        scope: { collegeId },
        startedAt: new Date(startedAt),
        ok: result.ok,
        summary: result.summary,
      });

      send({
        level: result.ok ? 'success' : 'warn',
        message: 'Finished',
        detail: `${result.summary} · AI cost ${costUsd.toFixed(4)} USD · ${((Date.now() - began) / 1000).toFixed(1)}s`,
      });

      emit({ type: 'done', payload: { ...result, costUsd, elapsedMs: Date.now() - began } });
    } catch (error) {
      const message =
        error instanceof PipelineError || error instanceof Error
          ? error.message
          : 'The run failed for an unknown reason.';

      await recordOperationRun({
        kind: mode === 'probe' ? 'catalog_check' : 'course_retrieval',
        scope: { collegeId },
        startedAt: new Date(startedAt),
        ok: false,
        summary: message.slice(0, 300),
      });

      send({ level: 'error', message: 'Run failed', detail: message });

      emit({
        type: 'error',
        message,
        recoverable: true,
      });
    }
  });
}
