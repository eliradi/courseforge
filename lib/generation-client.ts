/**
 * Browser side of `/api/test-sets/generate`: starts a run for a section and
 * reads its server-sent events until it finishes.
 */

export interface GenerationOutcome {
  ok: boolean;
  testSetId?: string;
  /** Questions written, even when the run stopped early. */
  generated?: number;
  error?: string;
}

interface GenerationEvent {
  type: string;
  message?: string;
  payload?: { testSetId?: string; status?: string; generated?: number; error?: string };
}

export async function generateTestForSection(
  courseSectionId: string,
  questionCount: number,
  onProgress: (generated: number, target: number) => void,
): Promise<GenerationOutcome> {
  const response = await fetch('/api/test-sets/generate', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ courseSectionId, questionCount }),
  });

  if (!response.ok || !response.body) {
    const body = await response.json().catch(() => ({}));
    return { ok: false, error: body.error ?? `Server responded ${response.status}` };
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const frames = buffer.split('\n\n');
    buffer = frames.pop() ?? '';

    for (const frame of frames) {
      const line = frame.split('\n').find((l) => l.startsWith('data: '));
      if (!line) continue;
      let event: GenerationEvent;
      try {
        event = JSON.parse(line.slice(6));
      } catch {
        continue;
      }

      if (event.type === 'progress') {
        const match = event.message?.match(/(\d+)\s*\/\s*(\d+)/);
        if (match) onProgress(Number(match[1]), Number(match[2]));
      } else if (event.type === 'done') {
        const payload = event.payload ?? {};
        return {
          ok: payload.status === 'complete',
          testSetId: payload.testSetId,
          generated: payload.generated,
          error: payload.error,
        };
      } else if (event.type === 'error') {
        return { ok: false, error: event.message ?? 'Generation failed.' };
      }
    }
  }

  return { ok: false, error: 'The connection closed before generation finished.' };
}
