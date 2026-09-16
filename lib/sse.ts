/**
 * Minimal server-sent-event helpers shared by the scrape-progress routes.
 * Long scrapes stream their steps so the UI can show "Scraping catalog… 2/3"
 * instead of a spinner that might be doing nothing.
 */

export type SseEvent =
  | { type: 'progress'; message: string }
  /** Richer sibling of `progress`, used by the admin console's live log. */
  | {
      type: 'trace';
      level: 'step' | 'request' | 'info' | 'success' | 'warn' | 'error';
      message: string;
      detail?: string;
      /** Milliseconds since the run started. */
      at: number;
      /** Duration of the individual operation, when measurable. */
      ms?: number;
      status?: number;
      bytes?: number;
    }
  /** Marks the start/end of one college inside a bulk run. */
  | {
      type: 'college';
      phase: 'start' | 'done' | 'skipped';
      collegeId: string;
      name: string;
      rank: number | null;
      index: number;
      total: number;
      ok?: boolean;
      summary?: string;
      costUsd?: number;
      departmentCount?: number;
      courseCount?: number;
    }
  | { type: 'done'; payload: unknown }
  | { type: 'error'; message: string; recoverable: boolean; screenshot?: string | null };

export function sseResponse(run: (emit: (event: SseEvent) => void) => Promise<void>): Response {
  const encoder = new TextEncoder();

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let closed = false;
      const emit = (event: SseEvent) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
        } catch {
          closed = true;
        }
      };

      try {
        await run(emit);
      } catch (error) {
        emit({
          type: 'error',
          message: error instanceof Error ? error.message : 'Something went wrong.',
          recoverable: true,
        });
      } finally {
        closed = true;
        try {
          controller.close();
        } catch {
          /* already closed */
        }
      }
    },
  });

  return new Response(stream, {
    headers: {
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'no-cache, no-transform',
      connection: 'keep-alive',
      // Disable proxy buffering so steps arrive as they happen.
      'x-accel-buffering': 'no',
    },
  });
}
