import type { NextRequest } from 'next/server';
import { z } from 'zod';

import { sseResponse } from '@/lib/sse';
import { ensureDepartments, PipelineError } from '@/lib/scraping/pipeline';

export const runtime = 'nodejs';
export const maxDuration = 300;
export const dynamic = 'force-dynamic';

const BodySchema = z.object({
  force: z.boolean().optional(),
  manualUrl: z.string().url().optional(),
});

/** Streams the catalog-discovery + department-scrape pipeline as SSE progress events. */
export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const parsed = BodySchema.safeParse(await request.json().catch(() => ({})));

  if (!parsed.success) {
    return Response.json({ error: 'Invalid request body' }, { status: 400 });
  }

  return sseResponse(async (emit) => {
    try {
      const result = await ensureDepartments(id, {
        force: parsed.data.force,
        manualUrl: parsed.data.manualUrl,
        onProgress: (message) => emit({ type: 'progress', message }),
      });

      emit({
        type: 'done',
        payload: {
          departments: result.departments,
          platform: result.platform,
          catalogUrl: result.catalogUrl,
          fromCache: result.fromCache,
        },
      });
    } catch (error) {
      if (error instanceof PipelineError) {
        emit({
          type: 'error',
          message: error.message,
          recoverable: error.recoverable,
          screenshot: error.screenshot ?? null,
        });
        return;
      }
      throw error;
    }
  });
}
