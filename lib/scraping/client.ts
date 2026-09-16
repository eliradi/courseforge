import 'server-only';

import {
  CrawlResponseSchema,
  FetchResponseSchema,
  InterceptResponseSchema,
  RenderResponseSchema,
  ScreenshotResponseSchema,
  type CrawlResponse,
  type FetchResponse,
  type InterceptResponse,
  type RenderResponse,
} from '@/lib/validation/schemas';
import { hostQueue } from './queue';
import { trace } from './trace';

const DEFAULT_TIMEOUT_MS = 30_000;
/** Headroom over the scraper's own timeout so the service can answer first. */
const CLIENT_TIMEOUT_MARGIN_MS = 15_000;
const MAX_TIMEOUT_MS = 90_000;

function clientTimeout(payload: unknown): number {
  const requested =
    payload && typeof payload === 'object' && 'timeoutMs' in payload
      ? Number((payload as { timeoutMs?: unknown }).timeoutMs)
      : NaN;
  const base = Number.isFinite(requested) && requested > 0 ? requested : DEFAULT_TIMEOUT_MS;
  return Math.min(base + CLIENT_TIMEOUT_MARGIN_MS, MAX_TIMEOUT_MS);
}

export class ScraperError extends Error {
  constructor(
    message: string,
    readonly endpoint: string,
    readonly url: string,
  ) {
    super(message);
    this.name = 'ScraperError';
  }
}

function serviceConfig() {
  const base = process.env.SCRAPER_SERVICE_URL;
  const secret = process.env.SCRAPER_SERVICE_SECRET;
  if (!base) throw new Error('SCRAPER_SERVICE_URL is not set');
  if (!secret) throw new Error('SCRAPER_SERVICE_SECRET is not set');
  return { base: base.replace(/\/$/, ''), secret };
}

export function isScraperConfigured(): boolean {
  return Boolean(process.env.SCRAPER_SERVICE_URL && process.env.SCRAPER_SERVICE_SECRET);
}

async function callOnce(endpoint: string, payload: unknown): Promise<unknown> {
  const { base, secret } = serviceConfig();
  const startedAt = Date.now();
  const target = (payload as { url?: string }).url ?? '';

  const res = await fetch(`${base}${endpoint}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-scraper-secret': secret },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(clientTimeout(payload)),
    cache: 'no-store',
  });

  if (!res.ok && res.status !== 200) {
    const text = await res.text().catch(() => '');
    trace({
      level: 'error',
      message: `${endpoint} failed`,
      detail: `${target} — ${res.status} ${text.slice(0, 160)}`,
      ms: Date.now() - startedAt,
      status: res.status,
    });
    throw new Error(`scraper ${endpoint} returned ${res.status}: ${text.slice(0, 200)}`);
  }

  const json = (await res.json()) as { status?: number; html?: string; markdown?: string; ok?: boolean };

  trace({
    level: 'request',
    message: `${endpoint} ${target || '(no url)'}`,
    ms: Date.now() - startedAt,
    status: typeof json.status === 'number' ? json.status : undefined,
    bytes: (json.html ?? json.markdown ?? '').length || undefined,
    detail:
      json.ok === false
        ? json.status === 0
          ? 'no response — host does not resolve or refused the connection'
          : 'the scraper reported a failure'
        : undefined,
  });

  return json;
}

/**
 * One retry with backoff, then give up. Every call is serialized per target host
 * by `hostQueue` so we never hammer a single school's catalog.
 */
async function call(endpoint: string, url: string, payload: unknown): Promise<unknown> {
  return hostQueue(url, async () => {
    try {
      return await callOnce(endpoint, payload);
    } catch (firstError) {
      await new Promise((r) => setTimeout(r, 1500));
      try {
        return await callOnce(endpoint, payload);
      } catch {
        throw new ScraperError(
          firstError instanceof Error ? firstError.message : String(firstError),
          endpoint,
          url,
        );
      }
    }
  });
}

export interface FetchOptions {
  method?: 'GET' | 'POST';
  headers?: Record<string, string>;
  body?: string;
  timeoutMs?: number;
}

/** Static fetch — no browser. Always prefer this; /render costs ~10x more. */
export async function scrapeFetch(url: string, options: FetchOptions = {}): Promise<FetchResponse> {
  const raw = await call('/fetch', url, { url, ...options });
  const parsed = FetchResponseSchema.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, status: 0, finalUrl: url, html: '', headers: {} };
  }
  return parsed.data;
}

export interface RenderOptions {
  waitFor?: string;
  waitUntil?: 'load' | 'domcontentloaded' | 'networkidle';
  timeoutMs?: number;
  cookies?: Array<{ name: string; value: string; domain?: string; path?: string }>;
}

export async function scrapeRender(url: string, options: RenderOptions = {}): Promise<RenderResponse> {
  const raw = await call('/render', url, { url, ...options });
  const parsed = RenderResponseSchema.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, status: 0, finalUrl: url, html: '', markdown: '', cookies: [] };
  }
  return parsed.data;
}

export async function scrapeIntercept(
  url: string,
  urlPattern: string,
  options: { waitFor?: string; maxCaptures?: number; timeoutMs?: number } = {},
): Promise<InterceptResponse> {
  const raw = await call('/intercept', url, { url, urlPattern, ...options });
  const parsed = InterceptResponseSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, finalUrl: url, captures: [], cookies: [] };
  return parsed.data;
}

export async function scrapeCrawl(
  url: string,
  options: { maxDepth?: number; maxPages?: number; includePattern?: string; render?: boolean } = {},
): Promise<CrawlResponse> {
  const raw = await call('/crawl', url, {
    url,
    maxDepth: 2,
    maxPages: 25,
    timeoutMs: 60_000,
    ...options,
  });
  const parsed = CrawlResponseSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, pages: [] };
  return parsed.data;
}

/** Debug aid — captured on final scrape failure so a human can see what the page looked like. */
export async function scrapeScreenshot(url: string): Promise<string | null> {
  try {
    const raw = await call('/screenshot', url, { url, fullPage: false });
    const parsed = ScreenshotResponseSchema.safeParse(raw);
    return parsed.success && parsed.data.imageBase64 ? parsed.data.imageBase64 : null;
  } catch {
    return null;
  }
}

/** Health probe used by the college page to explain a missing scraper service. */
export async function scraperHealth(): Promise<{ ok: boolean; detail: string }> {
  try {
    const { base, secret } = serviceConfig();
    const res = await fetch(`${base}/health`, {
      headers: { 'x-scraper-secret': secret },
      signal: AbortSignal.timeout(8000),
      cache: 'no-store',
    });
    if (!res.ok) return { ok: false, detail: `health returned ${res.status}` };
    const body = (await res.json()) as { browser?: boolean };
    return body.browser === false
      ? { ok: false, detail: 'scraper is up but Chromium failed to launch' }
      : { ok: true, detail: 'ready' };
  } catch (err) {
    return { ok: false, detail: err instanceof Error ? err.message : 'unreachable' };
  }
}
