import { BookMarked, Bot, Dog, Flag, Layers, Leaf, Link2, type LucideIcon } from 'lucide-react';

import type { CatalogPlatform, CatalogSource } from '@/lib/supabase/types';

export interface Provenance {
  /** Short label for the badge. */
  label: string;
  /** Full sentence for the tooltip. */
  detail: string;
  icon: LucideIcon;
  /** Broad bucket: a known catalog product, a hand-entered URL, or a raw scrape. */
  kind: 'platform' | 'manual' | 'scraped';
}

/** The catalog products we have purpose-built adapters for. */
const PLATFORMS: Record<Exclude<CatalogPlatform, 'generic'>, { label: string; icon: LucideIcon; detail: string }> = {
  courseleaf: {
    label: 'CourseLeaf',
    icon: Leaf,
    detail: 'Read from the school’s CourseLeaf catalog — structured HTML, no browser needed.',
  },
  acalog: {
    label: 'Acalog',
    icon: BookMarked,
    detail: 'Read from the school’s Acalog catalog, paginated straight from the server-rendered pages.',
  },
  coursedog: {
    label: 'Coursedog',
    icon: Dog,
    detail: 'Read from the school’s Coursedog catalog through its own JSON API.',
  },
  banner: {
    label: 'Banner',
    icon: Flag,
    detail: 'Read from Ellucian Banner — a session cookie, then the registrar’s JSON endpoints.',
  },
  kuali: {
    label: 'Kuali',
    icon: Layers,
    detail: 'Read from the school’s Kuali catalog by capturing the JSON its own front-end requests.',
  },
};

const MANUAL: Provenance = {
  label: 'Direct URL',
  icon: Link2,
  detail: 'Someone pasted this catalog URL by hand after automatic discovery came up short.',
  kind: 'manual',
};

const SCRAPED: Provenance = {
  label: 'Scraped',
  icon: Bot,
  detail: 'No known catalog platform here — the pages were rendered and read with AI-assisted extraction.',
  kind: 'scraped',
};

/**
 * How a college's course data was obtained.
 *
 * A hand-entered URL wins over the platform badge: it's the part a person had to
 * intervene for, so it's the more useful thing to surface.
 */
export function catalogProvenance(
  platform: CatalogPlatform | null,
  source: CatalogSource | null,
): Provenance | null {
  if (source === 'manual') return MANUAL;
  if (!platform) return null;
  if (platform === 'generic') return SCRAPED;

  const entry = PLATFORMS[platform];
  if (!entry) return null;

  return { label: entry.label, detail: entry.detail, icon: entry.icon, kind: 'platform' };
}

/** "1,240" — counts in the picker are read at a glance, so they get separators. */
export function formatCount(value: number): string {
  return value.toLocaleString('en-US');
}

/** How the catalog URL itself was located, for the tooltip's second line. */
export function describeDiscovery(source: CatalogSource | null): string | null {
  switch (source) {
    case 'heuristic':
      return 'Catalog found by probing the usual catalog subdomains and paths.';
    case 'sitemap':
      return 'Catalog found in the site’s sitemap.xml.';
    case 'homepage':
      return 'Catalog found by following links from the homepage.';
    case 'search':
      return 'Catalog found via web search.';
    case 'manual':
      return null; // already said in the main detail line
    default:
      return null;
  }
}
