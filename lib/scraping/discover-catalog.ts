import 'server-only';

import * as cheerio from 'cheerio';

import { extractObject } from '@/lib/ai/extract';
import { CatalogConfirmSchema, type CatalogPlatform } from '@/lib/validation/schemas';
import { detectAdapter } from './adapters/registry';
import { clean } from './adapters/types';
import { scrapeFetch } from './client';
import { isAllowed } from './robots';

export interface DiscoveryResult {
  catalogUrl: string;
  platform: CatalogPlatform;
  rootHtml: string;
  confidence: number;
  via: 'heuristic' | 'sitemap' | 'homepage' | 'search' | 'manual';
}

/** Probed in order — catalog subdomains first, they're the strongest signal. */
function candidateUrls(domain: string): string[] {
  const d = domain.replace(/^www\./, '');
  return [
    `https://catalog.${d}`,
    `https://catalogs.${d}`,
    `https://catalogue.${d}`,
    `https://bulletin.${d}`,
    `https://bulletins.${d}`,
    `https://coursecatalog.${d}`,
    `https://courses.${d}`,
    `https://guide.${d}`,
    `https://classes.${d}`,
    `https://${d}/catalog`,
    `https://${d}/courses`,
    `https://${d}/bulletin`,
    `https://${d}/course-catalog`,
    `https://${d}/academics/catalog`,
    `https://registrar.${d}/catalog`,
    `https://registrar.${d}/catalogs`,
    `https://catalog.${d}/courses`,
    // Common outside the US: "handbook" (Australia, NZ), "course catalogue"
    // (Canada, Europe) and "module catalogue" (UK).
    `https://handbook.${d}`,
    `https://coursecatalogue.${d}`,
    `https://${d}/handbook`,
    `https://${d}/module-catalogue`,
  ];
}

const CATALOG_WORDS = /catalog|bulletin|course|academics|curriculum|schedule of classes|handbook|module/i;

/**
 * Scores how catalog-like a fetched page is. Cheap signals only — the model is
 * asked to confirm just the single best candidate.
 */
function scorePage(url: string, html: string): number {
  let score = 0;
  const lower = html.toLowerCase();

  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return 0;
  }

  const domain = parsed.hostname.replace(/^www\./, '');
  const isCatalogSubdomain = /^(catalog|catalogs|catalogue|bulletin|bulletins|coursecatalog|coursecatalogue|courses|guide|classes|handbook)\./i.test(
    parsed.hostname,
  );

  if (isCatalogSubdomain) score += 40;
  if (CATALOG_WORDS.test(parsed.pathname)) score += 15;
  // Shallower paths are more likely to be the catalog root.
  score += Math.max(0, 12 - parsed.pathname.split('/').filter(Boolean).length * 4);

  const $ = cheerio.load(html);
  const title = clean($('title').text());
  if (CATALOG_WORDS.test(title)) score += 20;
  if (/course catalog|academic catalog|general catalog|course catalogue|undergraduate bulletin|academic bulletin|course guide|course handbook|module catalogue/i.test(title)) {
    score += 20;
  }

  // Platform fingerprints are the strongest evidence there is.
  const hasFingerprint =
    lower.includes('courseblock') ||
    lower.includes('preview_course') ||
    lower.includes('/studentregistrationssb/') ||
    lower.includes('courseleaf') ||
    lower.includes('coursedog') ||
    lower.includes('kuali');

  if (lower.includes('courseblock')) score += 35;
  if (lower.includes('preview_course')) score += 35;
  if (lower.includes('/studentregistrationssb/')) score += 30;
  if (lower.includes('courseleaf')) score += 30;
  if (lower.includes('coursedog')) score += 30;
  if (lower.includes('kuali')) score += 25;

  // Pages that list many subject links look like a catalog index.
  const subjectLinks = $('a[href]').filter((_i, el) => CATALOG_WORDS.test($(el).attr('href') ?? '')).length;
  score += Math.min(25, subjectLinks);

  // Pages on the university's own www host are marketing far more often than
  // they are catalogs. Unless the page carries a platform fingerprint or sits
  // under an explicit /catalog or /bulletin path, treat it as a weak candidate —
  // this is what keeps "/academics" landing pages, news posts and presidential
  // letters from beating a real catalog we simply haven't probed yet.
  const isMarketingHost = parsed.hostname === domain || parsed.hostname === `www.${domain}`;
  if (isMarketingHost && !hasFingerprint && !/catalog|bulletin|course|handbook|module/i.test(parsed.pathname)) {
    score -= 45;
  }

  // News posts, events and profiles mention courses constantly but list none.
  if (/\/(news|blog|events?|stories|story|articles?|posts?|people|profiles?)\//i.test(parsed.pathname)) {
    score -= 60;
  }
  if ($('article time, .post-date, [property="article:published_time"]').length) score -= 25;

  // Penalise obvious non-catalogs.
  if (/admission|apply now|give to|athletics|news|alumni/i.test(title)) score -= 15;
  if (html.length < 800) score -= 25;

  return score;
}

/** Below this we would rather show the manual-URL escape hatch than guess. */
const MIN_ACCEPTABLE_SCORE = 30;

async function probe(url: string): Promise<{ url: string; html: string; score: number } | null> {
  if (!(await isAllowed(url))) return null;

  const res = await scrapeFetch(url);
  if (!res.ok || res.status >= 400 || !res.html || res.html.length < 500) return null;

  return { url: res.finalUrl || url, html: res.html, score: scorePage(res.finalUrl || url, res.html) };
}

/** Links whose text or href look catalog-ish, harvested from the homepage nav. */
async function homepageCandidates(domain: string): Promise<string[]> {
  const res = await scrapeFetch(`https://${domain.replace(/^www\./, '')}`);
  if (!res.ok || !res.html) return [];

  const $ = cheerio.load(res.html);
  const out = new Set<string>();

  $('a[href]').each((_i, el) => {
    const href = $(el).attr('href');
    const text = clean($(el).text());
    if (!href) return;
    if (!CATALOG_WORDS.test(text) && !CATALOG_WORDS.test(href)) return;
    try {
      const abs = new URL(href, res.finalUrl || `https://${domain}`);
      if (!abs.hostname.endsWith(domain.replace(/^www\./, ''))) return;
      abs.hash = '';
      out.add(abs.toString());
    } catch {
      /* skip */
    }
  });

  return [...out].slice(0, 12);
}

async function sitemapCandidates(domain: string): Promise<string[]> {
  const d = domain.replace(/^www\./, '');
  const res = await scrapeFetch(`https://${d}/sitemap.xml`);
  if (!res.ok || !res.html || !res.html.includes('<loc')) return [];

  const locs = [...res.html.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/gi)].map((m) => m[1]);

  // A sitemap index points at more sitemaps; follow the catalog-looking one.
  if (res.html.includes('<sitemapindex')) {
    const nested = locs.find((l) => CATALOG_WORDS.test(l));
    if (nested) {
      const inner = await scrapeFetch(nested);
      if (inner.ok && inner.html) {
        return [...inner.html.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/gi)]
          .map((m) => m[1])
          .filter((l) => CATALOG_WORDS.test(l))
          .slice(0, 12);
      }
    }
  }

  return locs.filter((l) => CATALOG_WORDS.test(l)).slice(0, 12);
}

/** Optional last resort before showing the manual-URL escape hatch. */
async function braveSearch(collegeName: string, domain: string): Promise<string[]> {
  const key = process.env.BRAVE_SEARCH_API_KEY;
  if (!key) return [];

  try {
    const res = await fetch(
      `https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(
        `${collegeName} course catalog site:${domain}`,
      )}&count=5`,
      {
        headers: { accept: 'application/json', 'x-subscription-token': key },
        signal: AbortSignal.timeout(10_000),
      },
    );
    if (!res.ok) return [];
    const json = (await res.json()) as { web?: { results?: Array<{ url?: string }> } };
    return (json.web?.results ?? []).map((r) => r.url).filter((u): u is string => Boolean(u));
  } catch {
    return [];
  }
}

/** Asks the fast model to confirm the winning candidate really is a catalog index. */
async function confirmWithAi(url: string, html: string): Promise<number> {
  const $ = cheerio.load(html);
  $('script, style, noscript').remove();
  const excerpt = clean($('body').text()).slice(0, 4000);
  const title = clean($('title').text());

  const verdict = await extractObject({
    schema: CatalogConfirmSchema,
    operation: 'confirm_catalog',
    system:
      'You judge whether a web page is a university course catalog index — a page that lists ' +
      'academic subjects/departments or course listings. Admissions, news and program-marketing ' +
      'pages are not course catalogs.',
    prompt: `URL: ${url}\nTitle: ${title}\n\n<page_text>\n${excerpt}\n</page_text>`,
  });

  if (!verdict) return 0.5; // AI unavailable — trust the heuristic score.
  if (!verdict.is_course_catalog) return 0;

  // Models sometimes answer in percent; normalise, then clamp.
  const raw = Number(verdict.confidence);
  if (!Number.isFinite(raw)) return 0.5;
  const normalized = raw > 1 ? raw / 100 : raw;
  return Math.min(1, Math.max(0, normalized));
}

export interface DiscoveryOptions {
  onProgress?: (message: string) => void;
  /** Skip discovery and validate this URL instead (manual escape hatch). */
  manualUrl?: string;
}

export async function discoverCatalog(
  college: { name: string; website_domain: string },
  options: DiscoveryOptions = {},
): Promise<DiscoveryResult | null> {
  const { onProgress } = options;

  if (options.manualUrl) {
    onProgress?.('Validating the catalog URL you provided');
    const res = await scrapeFetch(options.manualUrl);
    if (!res.ok || !res.html) return null;
    const url = res.finalUrl || options.manualUrl;
    return {
      catalogUrl: url,
      platform: detectAdapter(res.html, url).id,
      rootHtml: res.html,
      confidence: 1,
      via: 'manual',
    };
  }

  const domain = college.website_domain.replace(/^www\./, '');
  const seen = new Set<string>();
  const scored: Array<{ url: string; html: string; score: number; via: DiscoveryResult['via'] }> = [];

  const consider = async (urls: string[], via: DiscoveryResult['via'], stopAt: number) => {
    for (const url of urls) {
      if (scored.some((s) => s.score >= stopAt)) return;
      if (seen.has(url)) continue;
      seen.add(url);
      const hit = await probe(url);
      if (hit) scored.push({ ...hit, via });
    }
  };

  // 1. URL heuristics — cheap and correct for most of the top 200.
  onProgress?.('Locating course catalog');
  await consider(candidateUrls(domain), 'heuristic', 70);

  // 2. Sitemap + homepage nav mining.
  if (!scored.some((s) => s.score >= 70)) {
    onProgress?.('Checking sitemap and homepage navigation');
    const [sitemap, homepage] = await Promise.all([
      sitemapCandidates(domain),
      homepageCandidates(domain),
    ]);
    await consider(sitemap, 'sitemap', 70);
    await consider(homepage, 'homepage', 70);
  }

  // 3. Optional web search, only if everything above came up empty.
  if (!scored.length) {
    onProgress?.('Searching the web for the catalog');
    await consider(await braveSearch(college.name, domain), 'search', 40);
  }

  if (!scored.length) return null;

  scored.sort((a, b) => b.score - a.score);
  const winner = scored[0];

  // A confidently wrong catalog is worse than admitting we didn't find one.
  if (winner.score < MIN_ACCEPTABLE_SCORE) return null;

  // 4. Confirm with the fast model, then fingerprint the platform.
  onProgress?.('Confirming catalog page');
  const confidence = winner.score >= 90 ? 1 : await confirmWithAi(winner.url, winner.html);
  if (confidence < 0.4 && winner.score < 60) return null;

  const adapter = detectAdapter(winner.html, winner.url);
  onProgress?.(`Detected ${adapter.label} catalog`);

  return {
    catalogUrl: winner.url,
    platform: adapter.id,
    rootHtml: winner.html,
    confidence,
    via: winner.via,
  };
}
