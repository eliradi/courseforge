import 'server-only';

import { AsyncLocalStorage } from 'node:async_hooks';

export type TraceLevel = 'step' | 'request' | 'info' | 'success' | 'warn' | 'error';

export interface TraceEvent {
  level: TraceLevel;
  message: string;
  /** Secondary line — a URL, a count, an error string. */
  detail?: string;
  /** Milliseconds the underlying operation took, when it was measurable. */
  ms?: number;
  /** HTTP status for request events. */
  status?: number;
  /** Response size in bytes, for request events. */
  bytes?: number;
  at: number;
}

export type TraceSink = (event: Omit<TraceEvent, 'at'>) => void;

/**
 * Ambient tracing for a scrape run.
 *
 * The scraping stack is many layers deep — discovery calls adapters which call
 * the scraper client — and threading a logger through every signature would be
 * noise. The admin console wraps a run in `withTrace` and every layer below can
 * report what it's doing without knowing who's listening.
 */
const storage = new AsyncLocalStorage<TraceSink>();

export function withTrace<T>(sink: TraceSink, fn: () => Promise<T>): Promise<T> {
  return storage.run(sink, fn);
}

export function trace(event: Omit<TraceEvent, 'at'>): void {
  const sink = storage.getStore();
  if (!sink) return;
  try {
    sink(event);
  } catch {
    // A broken listener must never break the scrape it is watching.
  }
}

export function isTracing(): boolean {
  return storage.getStore() !== undefined;
}
