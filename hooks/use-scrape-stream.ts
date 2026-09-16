'use client';

import { useCallback, useRef, useState } from 'react';

export interface ScrapeError {
  message: string;
  recoverable: boolean;
  screenshot?: string | null;
}

export interface ScrapeStreamState<T> {
  running: boolean;
  steps: string[];
  error: ScrapeError | null;
  data: T | null;
}

/**
 * Drives one of the SSE scrape routes and exposes its step-by-step progress.
 * Any in-flight run is aborted when a new one starts.
 */
export function useScrapeStream<T>(url: string) {
  const [state, setState] = useState<ScrapeStreamState<T>>({
    running: false,
    steps: [],
    error: null,
    data: null,
  });

  const abortRef = useRef<AbortController | null>(null);

  const run = useCallback(
    async (body: Record<string, unknown> = {}): Promise<T | null> => {
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;

      setState({ running: true, steps: [], error: null, data: null });

      try {
        const response = await fetch(url, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(body),
          signal: controller.signal,
        });

        if (!response.ok || !response.body) {
          throw new Error(`The server responded with ${response.status}.`);
        }

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';
        let result: T | null = null;

        // SSE frames are separated by a blank line.
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const frames = buffer.split('\n\n');
          buffer = frames.pop() ?? '';

          for (const frame of frames) {
            const line = frame.split('\n').find((l) => l.startsWith('data: '));
            if (!line) continue;

            let event: { type: string; message?: string; payload?: unknown; recoverable?: boolean; screenshot?: string | null };
            try {
              event = JSON.parse(line.slice(6));
            } catch {
              continue;
            }

            if (event.type === 'progress' && event.message) {
              setState((prev) => ({ ...prev, steps: [...prev.steps, event.message!] }));
            } else if (event.type === 'done') {
              result = event.payload as T;
              setState((prev) => ({ ...prev, running: false, data: result }));
            } else if (event.type === 'error') {
              setState((prev) => ({
                ...prev,
                running: false,
                error: {
                  message: event.message ?? 'Something went wrong.',
                  recoverable: event.recoverable ?? true,
                  screenshot: event.screenshot ?? null,
                },
              }));
              return null;
            }
          }
        }

        setState((prev) => ({ ...prev, running: false }));
        return result;
      } catch (error) {
        if (controller.signal.aborted) return null;
        setState((prev) => ({
          ...prev,
          running: false,
          error: {
            message: error instanceof Error ? error.message : 'The request failed.',
            recoverable: true,
          },
        }));
        return null;
      }
    },
    [url],
  );

  const reset = useCallback(() => {
    abortRef.current?.abort();
    setState({ running: false, steps: [], error: null, data: null });
  }, []);

  return { ...state, run, reset };
}
