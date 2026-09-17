import { serve } from '@hono/node-server';
import { Hono, type Context } from 'hono';
import { logger } from 'hono/logger';
import { z } from 'zod';

import { USER_AGENT, browserHealthy, poolStats, shutdownBrowser, withContext } from './browser.js';
import { extractLinks, htmlToMarkdown } from './markdown.js';

const PORT = Number(process.env.PORT ?? 8080);
const SECRET = process.env.SCRAPER_SERVICE_SECRET ?? '';
const DEFAULT_TIMEOUT = Number(process.env.DEFAULT_TIMEOUT_MS ?? 30_000);

const app = new Hono();
app.use('*', logger());

/* ------------------------------------------------------------------- auth */

app.use('*', async (c, next) => {
  if (c.req.path === '/health') return next();
  if (!SECRET) {
    return c.json({ ok: false, error: 'SCRAPER_SERVICE_SECRET is not configured' }, 500);
  }
  if (c.req.header('x-scraper-secret') !== SECRET) {
    return c.json({ ok: false, error: 'unauthorized' }, 401);
  }
  return next();
});

/* ---------------------------------------------------------------- helpers */

async function readBody<T extends z.ZodTypeAny>(c: Context, schema: T) {
  const json = await c.req.json().catch(() => null);
  return schema.safeParse(json) as z.SafeParseReturnType<unknown, z.infer<T>>;
}

function isPrivateHost(hostname: string): boolean {
  const h = hostname.toLowerCase();
  if (h === 'localhost' || h.endsWith('.localhost') || h.endsWith('.internal')) return true;
  if (/^(\d{1,3}\.){3}\d{1,3}$/.test(h)) {
    const [a, b] = h.split('.').map(Number);
    return (
      a === 127 || a === 10 || a === 0 || a === 169 ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168)
    );
  }
  return h === '::1' || h === '[::1]';
}

/** Blocks requests at private/loopback addresses so the service can't be used as an SSRF proxy. */
function assertPublicUrl(raw: string): URL {
  const url = new URL(raw);
  if (!['http:', 'https:'].includes(url.protocol)) throw new Error('only http(s) URLs are allowed');
  if (isPrivateHost(url.hostname)) throw new Error('refusing to fetch a private address');
  return url;
}

function errorBody(err: unknown) {
  const message = err instanceof Error ? err.message : String(err);
  return { ok: false, error: message };
}

/* ----------------------------------------------------------------- /health */

app.get('/health', async (c) =>
  c.json({
    ok: true,
    service: 'aceversity-scraper',
    browser: await browserHealthy(),
    pool: poolStats(),
    userAgent: USER_AGENT,
    uptimeSeconds: Math.round(process.uptime()),
  }),
);

/* ------------------------------------------------------------------ /fetch */
/* Static fetch, no browser. Always tried first — ~10x cheaper than /render.   */

const FetchSchema = z.object({
  url: z.string().url(),
  method: z.enum(['GET', 'POST']).default('GET'),
  headers: z.record(z.string()).optional(),
  body: z.string().optional(),
  timeoutMs: z.number().int().positive().max(60_000).optional(),
});

app.post('/fetch', async (c) => {
  const parsed = await readBody(c, FetchSchema);
  if (!parsed.success) return c.json({ ok: false, error: parsed.error.message }, 400);
  const { url, method, headers, body, timeoutMs } = parsed.data;

  try {
    assertPublicUrl(url);
  } catch (err) {
    return c.json(errorBody(err), 400);
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs ?? DEFAULT_TIMEOUT);

  try {
    const res = await fetch(url, {
      method,
      redirect: 'follow',
      signal: controller.signal,
      headers: {
        'user-agent': USER_AGENT,
        accept: 'text/html,application/xhtml+xml,application/xml,application/json;q=0.9,*/*;q=0.8',
        'accept-language': 'en-US,en;q=0.9',
        ...(method === 'POST' ? { 'content-type': 'application/x-www-form-urlencoded' } : {}),
        ...headers,
      },
      body,
    });

    const html = await res.text();
    return c.json({
      ok: res.ok,
      status: res.status,
      finalUrl: res.url || url,
      html,
      headers: Object.fromEntries(res.headers.entries()),
    });
  } catch (err) {
    return c.json({ ...errorBody(err), status: 0, finalUrl: url, html: '', headers: {} }, 200);
  } finally {
    clearTimeout(timer);
  }
});

/* ----------------------------------------------------------------- /render */

const RenderSchema = z.object({
  url: z.string().url(),
  waitFor: z.string().optional(),
  waitUntil: z.enum(['load', 'domcontentloaded', 'networkidle']).default('networkidle'),
  timeoutMs: z.number().int().positive().max(60_000).optional(),
  cookies: z
    .array(
      z.object({
        name: z.string(),
        value: z.string(),
        domain: z.string().optional(),
        path: z.string().optional(),
      }),
    )
    .optional(),
});

app.post('/render', async (c) => {
  const parsed = await readBody(c, RenderSchema);
  if (!parsed.success) return c.json({ ok: false, error: parsed.error.message }, 400);
  const { url, waitFor, waitUntil, timeoutMs, cookies } = parsed.data;

  try {
    assertPublicUrl(url);
  } catch (err) {
    return c.json(errorBody(err), 400);
  }

  const timeout = timeoutMs ?? DEFAULT_TIMEOUT;

  try {
    const result = await withContext(
      async (ctx) => {
        const page = await ctx.newPage();
        const response = await page.goto(url, { waitUntil, timeout });

        if (waitFor) {
          await page.waitForSelector(waitFor, { timeout: Math.min(timeout, 15_000) }).catch(() => {
            // Selector never appeared — return whatever did render rather than failing outright.
          });
        }

        const html = await page.content();
        const finalUrl = page.url();
        const pageCookies = await ctx.cookies();
        await page.close().catch(() => undefined);

        return {
          ok: true,
          status: response?.status() ?? 0,
          finalUrl,
          html,
          markdown: htmlToMarkdown(html),
          cookies: pageCookies.map((k) => ({
            name: k.name,
            value: k.value,
            domain: k.domain,
            path: k.path,
          })),
        };
      },
      { cookies },
    );

    return c.json(result);
  } catch (err) {
    return c.json(
      { ...errorBody(err), status: 0, finalUrl: url, html: '', markdown: '', cookies: [] },
      200,
    );
  }
});

/* -------------------------------------------------------------- /intercept */
/* Renders a SPA catalog while capturing the JSON its own XHRs return.        */

const InterceptSchema = z.object({
  url: z.string().url(),
  urlPattern: z.string(),
  waitFor: z.string().optional(),
  maxCaptures: z.number().int().positive().max(50).default(20),
  timeoutMs: z.number().int().positive().max(60_000).optional(),
});

app.post('/intercept', async (c) => {
  const parsed = await readBody(c, InterceptSchema);
  if (!parsed.success) return c.json({ ok: false, error: parsed.error.message }, 400);
  const { url, urlPattern, waitFor, maxCaptures, timeoutMs } = parsed.data;

  try {
    assertPublicUrl(url);
  } catch (err) {
    return c.json(errorBody(err), 400);
  }

  let pattern: RegExp;
  try {
    pattern = new RegExp(urlPattern, 'i');
  } catch (err) {
    return c.json(errorBody(err), 400);
  }

  const timeout = timeoutMs ?? DEFAULT_TIMEOUT;

  try {
    const result = await withContext(async (ctx) => {
      const page = await ctx.newPage();
      const captures: Array<{
        url: string;
        status: number;
        contentType: string | null;
        json: unknown | null;
      }> = [];

      page.on('response', (response) => {
        if (captures.length >= maxCaptures) return;
        const responseUrl = response.url();
        if (!pattern.test(responseUrl)) return;
        const contentType = response.headers()['content-type'] ?? null;
        if (contentType && !contentType.includes('json')) return;

        // Body reads are async; collect the promise but never let it reject the run.
        void response
          .json()
          .then((json) => {
            if (captures.length < maxCaptures) {
              captures.push({ url: responseUrl, status: response.status(), contentType, json });
            }
          })
          .catch(() => undefined);
      });

      await page.goto(url, { waitUntil: 'networkidle', timeout }).catch(() => undefined);
      if (waitFor) {
        await page.waitForSelector(waitFor, { timeout: Math.min(timeout, 15_000) }).catch(() => undefined);
      }
      // Give in-flight XHR bodies a moment to resolve into `captures`.
      await page.waitForTimeout(1500);

      const finalUrl = page.url();
      const pageCookies = await ctx.cookies();
      await page.close().catch(() => undefined);

      return {
        ok: true,
        finalUrl,
        captures,
        cookies: pageCookies.map((k) => ({
          name: k.name,
          value: k.value,
          domain: k.domain,
          path: k.path,
        })),
      };
    });

    return c.json(result);
  } catch (err) {
    return c.json({ ...errorBody(err), finalUrl: url, captures: [], cookies: [] }, 200);
  }
});

/* ------------------------------------------------------------------ /crawl */
/* Bounded same-domain BFS. Hard caps: depth 2, 25 pages.                     */

const CrawlSchema = z.object({
  url: z.string().url(),
  maxDepth: z.number().int().min(0).max(2).default(2),
  maxPages: z.number().int().min(1).max(25).default(25),
  includePattern: z.string().optional(),
  render: z.boolean().default(false),
});

app.post('/crawl', async (c) => {
  const parsed = await readBody(c, CrawlSchema);
  if (!parsed.success) return c.json({ ok: false, error: parsed.error.message }, 400);
  const { url, maxDepth, maxPages, includePattern, render } = parsed.data;

  let start: URL;
  try {
    start = assertPublicUrl(url);
  } catch (err) {
    return c.json(errorBody(err), 400);
  }

  let include: RegExp | null = null;
  if (includePattern) {
    try {
      include = new RegExp(includePattern, 'i');
    } catch (err) {
      return c.json(errorBody(err), 400);
    }
  }

  const pages: Array<{ url: string; status: number; html: string; markdown: string }> = [];
  const seen = new Set<string>([start.toString()]);
  let frontier: Array<{ url: string; depth: number }> = [{ url: start.toString(), depth: 0 }];

  const fetchStatic = async (target: string) => {
    const res = await fetch(target, {
      headers: { 'user-agent': USER_AGENT, accept: 'text/html,*/*;q=0.8' },
      redirect: 'follow',
      signal: AbortSignal.timeout(DEFAULT_TIMEOUT),
    });
    const contentType = res.headers.get('content-type') ?? '';
    if (!contentType.includes('html')) return { status: res.status, html: '' };
    return { status: res.status, html: await res.text() };
  };

  try {
    while (frontier.length && pages.length < maxPages) {
      const next: Array<{ url: string; depth: number }> = [];

      for (const node of frontier) {
        if (pages.length >= maxPages) break;

        let status = 0;
        let html = '';
        try {
          if (render) {
            const rendered = await withContext(async (ctx) => {
              const page = await ctx.newPage();
              const response = await page.goto(node.url, {
                waitUntil: 'domcontentloaded',
                timeout: DEFAULT_TIMEOUT,
              });
              const content = await page.content();
              await page.close().catch(() => undefined);
              return { status: response?.status() ?? 0, html: content };
            });
            status = rendered.status;
            html = rendered.html;
          } else {
            const fetched = await fetchStatic(node.url);
            status = fetched.status;
            html = fetched.html;
          }
        } catch {
          continue; // a dead link shouldn't end the crawl
        }

        if (!html) continue;
        pages.push({ url: node.url, status, html, markdown: htmlToMarkdown(html) });

        if (node.depth >= maxDepth) continue;

        for (const link of extractLinks(html, node.url)) {
          if (seen.size > maxPages * 12) break;
          let candidate: URL;
          try {
            candidate = new URL(link.href);
          } catch {
            continue;
          }
          candidate.hash = '';
          const normalized = candidate.toString();
          if (candidate.hostname !== start.hostname) continue;
          if (include && !include.test(normalized)) continue;
          if (seen.has(normalized)) continue;
          seen.add(normalized);
          next.push({ url: normalized, depth: node.depth + 1 });
        }
      }

      frontier = next;
    }

    return c.json({ ok: true, pages });
  } catch (err) {
    return c.json({ ...errorBody(err), pages }, 200);
  }
});

/* ------------------------------------------------------------- /screenshot */

const ScreenshotSchema = z.object({
  url: z.string().url(),
  fullPage: z.boolean().default(false),
  timeoutMs: z.number().int().positive().max(60_000).optional(),
});

app.post('/screenshot', async (c) => {
  const parsed = await readBody(c, ScreenshotSchema);
  if (!parsed.success) return c.json({ ok: false, error: parsed.error.message }, 400);
  const { url, fullPage, timeoutMs } = parsed.data;

  try {
    assertPublicUrl(url);
  } catch (err) {
    return c.json(errorBody(err), 400);
  }

  try {
    const result = await withContext(
      async (ctx) => {
        const page = await ctx.newPage();
        await page.goto(url, {
          waitUntil: 'domcontentloaded',
          timeout: timeoutMs ?? DEFAULT_TIMEOUT,
        });
        const buffer = await page.screenshot({ fullPage, type: 'png' });
        const finalUrl = page.url();
        await page.close().catch(() => undefined);
        return { ok: true, finalUrl, imageBase64: buffer.toString('base64') };
      },
      { blockAssets: false },
    );
    return c.json(result);
  } catch (err) {
    return c.json({ ...errorBody(err), finalUrl: url, imageBase64: '' }, 200);
  }
});

/* --------------------------------------------------------------- lifecycle */

app.notFound((c) => c.json({ ok: false, error: 'not found' }, 404));

app.onError((err, c) => {
  console.error('[scraper] unhandled', err);
  return c.json(errorBody(err), 500);
});

const server = serve({ fetch: app.fetch, port: PORT }, (info) => {
  console.log(`[scraper] listening on :${info.port}`);
});

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    console.log(`[scraper] ${signal} — shutting down`);
    server.close(() => {
      void shutdownBrowser().finally(() => process.exit(0));
    });
  });
}

export default app;
