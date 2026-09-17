'use client';

import { usePathname } from 'next/navigation';

/**
 * Renders its children everywhere except the listed paths — e.g. the site
 * header on the landing page, which has its own logo and floating controls.
 */
export function HideOnPaths({ paths, children }: { paths: string[]; children: React.ReactNode }) {
  return paths.includes(usePathname()) ? null : children;
}
