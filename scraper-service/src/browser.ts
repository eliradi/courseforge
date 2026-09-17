import { chromium, type Browser, type BrowserContext } from 'playwright';

export const USER_AGENT =
  process.env.SCRAPER_USER_AGENT ??
  'AceversityBot/1.0 (+https://github.com/aceversity/aceversity; educational course-catalog indexer)';

const MAX_CONTEXTS = Number(process.env.MAX_CONCURRENT_CONTEXTS ?? 3);

let browserPromise: Promise<Browser> | null = null;

/** Single shared Chromium instance for the life of the process. */
async function getBrowser(): Promise<Browser> {
  if (!browserPromise) {
    browserPromise = chromium
      .launch({
        headless: true,
        args: [
          '--no-sandbox',
          '--disable-dev-shm-usage',
          '--disable-gpu',
          '--disable-blink-features=AutomationControlled',
        ],
      })
      .then((browser) => {
        browser.on('disconnected', () => {
          browserPromise = null;
        });
        return browser;
      })
      .catch((err) => {
        browserPromise = null;
        throw err;
      });
  }
  return browserPromise;
}

/* ------------------------------------------------------------ context pool */
/* A counting semaphore capping how many browser contexts exist concurrently.  */

let inUse = 0;
const waiters: Array<() => void> = [];

function acquire(): Promise<void> {
  if (inUse < MAX_CONTEXTS) {
    inUse++;
    return Promise.resolve();
  }
  return new Promise<void>((resolve) => waiters.push(resolve));
}

function release(): void {
  const next = waiters.shift();
  if (next) {
    next(); // hand the slot straight to the next waiter
    return;
  }
  inUse--;
}

export interface ContextOptions {
  cookies?: Array<{ name: string; value: string; domain?: string; path?: string; url?: string }>;
  blockAssets?: boolean;
}

/**
 * Runs `fn` with a fresh, isolated browser context. At most MAX_CONTEXTS run at
 * a time; the rest queue. The context is always closed, including on throw.
 */
export async function withContext<T>(
  fn: (ctx: BrowserContext) => Promise<T>,
  options: ContextOptions = {},
): Promise<T> {
  await acquire();
  let context: BrowserContext | undefined;
  try {
    const browser = await getBrowser();
    context = await browser.newContext({
      userAgent: USER_AGENT,
      viewport: { width: 1440, height: 900 },
      ignoreHTTPSErrors: true,
      javaScriptEnabled: true,
    });

    if (options.blockAssets !== false) {
      // Catalog pages are text; skipping media is a large latency win.
      await context.route('**/*', (route) => {
        const type = route.request().resourceType();
        if (type === 'image' || type === 'media' || type === 'font') return route.abort();
        return route.continue();
      });
    }

    if (options.cookies?.length) {
      await context.addCookies(
        options.cookies.map((c) => ({
          name: c.name,
          value: c.value,
          domain: c.domain,
          path: c.path ?? '/',
          url: c.domain ? undefined : c.url,
        })) as Parameters<BrowserContext['addCookies']>[0],
      );
    }

    return await fn(context);
  } finally {
    await context?.close().catch(() => undefined);
    release();
  }
}

export async function browserHealthy(): Promise<boolean> {
  try {
    const browser = await getBrowser();
    return browser.isConnected();
  } catch {
    return false;
  }
}

export function poolStats() {
  return { inUse, queued: waiters.length, max: MAX_CONTEXTS };
}

export async function shutdownBrowser(): Promise<void> {
  if (!browserPromise) return;
  const browser = await browserPromise.catch(() => null);
  browserPromise = null;
  await browser?.close().catch(() => undefined);
}
