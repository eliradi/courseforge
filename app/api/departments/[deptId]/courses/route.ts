import type { NextRequest } from 'next/server';
import { z } from 'zod';

import { sseResponse } from '@/lib/sse';
import { ensureCourses, PipelineError } from '@/lib/scraping/pipeline';

export const runtime = 'nodejs';
export const maxDuration = 300;
export const dynamic = 'force-dynamic';

const BodySchema = z.object({ force: z.boolean().optional() });

/** Streams the course-list scrape for one department. */
export async function POST(request: NextRequest, context: { params: Promise<{ deptId: string }> }) {
  const { deptId } = await context.params;
  const parsed = BodySchema.safeParse(await request.json().catch(() => ({})));

  return sseResponse(async (emit) => {
    try {
      const result = await ensureCourses(deptId, {
        force: parsed.success ? parsed.data.force : false,
        onProgress: (message) => emit({ type: 'progress', message }),
      });
      emit({ type: 'done', payload: { courses: result.courses, fromCache: result.fromCache } });
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
