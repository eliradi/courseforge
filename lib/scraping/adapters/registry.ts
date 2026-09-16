import 'server-only';

import type { CatalogPlatform } from '@/lib/validation/schemas';
import type { CatalogAdapter } from './types';
import { acalogAdapter } from './acalog';
import { bannerAdapter } from './banner';
import { coursedogAdapter } from './coursedog';
import { courseleafAdapter } from './courseleaf';
import { genericAdapter } from './generic';
import { kualiAdapter } from './kuali';

/** Priority order: specific fingerprints first, generic always last. */
export const ADAPTERS: readonly CatalogAdapter[] = [
  courseleafAdapter,
  acalogAdapter,
  coursedogAdapter,
  bannerAdapter,
  kualiAdapter,
  genericAdapter,
] as const;

/** First adapter whose detect() returns true wins; the result is cached on the college row. */
export function detectAdapter(html: string, url: string): CatalogAdapter {
  for (const adapter of ADAPTERS) {
    try {
      if (adapter.detect(html, url)) return adapter;
    } catch {
      // A broken fingerprint must not stop the chain.
    }
  }
  return genericAdapter;
}

export function getAdapter(platform: CatalogPlatform | null | undefined): CatalogAdapter {
  return ADAPTERS.find((a) => a.id === platform) ?? genericAdapter;
}

export function adapterLabel(platform: CatalogPlatform | null | undefined): string {
  return getAdapter(platform).label;
}
