import 'server-only';

import PQueue from 'p-queue';

/**
 * Scraping etiquette: one in-flight request per host with a 1.5s gap between
 * them, and no more than 3 hosts being worked at once process-wide.
 */
const HOST_DELAY_MS = 1500;
const GLOBAL_CONCURRENCY = 3;

const globalQueue = new PQueue({ concurrency: GLOBAL_CONCURRENCY });
const perHost = new Map<string, PQueue>();

function hostOf(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return 'unknown';
  }
}

function queueFor(host: string): PQueue {
  let queue = perHost.get(host);
  if (!queue) {
    queue = new PQueue({ concurrency: 1, interval: HOST_DELAY_MS, intervalCap: 1 });
    perHost.set(host, queue);
  }
  return queue;
}

export async function hostQueue<T>(url: string, task: () => Promise<T>): Promise<T> {
  const queue = queueFor(hostOf(url));
  // No queue-level timeouts here — the scraper client owns the per-call timeout,
  // so p-queue's own `void` result branch can never occur.
  return globalQueue.add(() => queue.add(task)) as Promise<T>;
}
