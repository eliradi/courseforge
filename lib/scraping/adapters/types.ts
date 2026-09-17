import type {
  CourseDetailRaw,
  CourseRaw,
  DepartmentRaw,
  CatalogPlatform,
} from '@/lib/validation/schemas';

/** Everything an adapter needs to know about the catalog it is working on. */
export interface ScrapeCtx {
  /** Catalog root, e.g. https://catalog.mit.edu */
  catalogUrl: string;
  /** Official college domain, e.g. mit.edu */
  domain: string;
  collegeName: string;
  /** HTML of the catalog root, already fetched by the discovery pipeline. */
  rootHtml: string;
  /** Per-adapter scratch space (Banner session cookies, Kuali catalog ids, …). */
  state: Record<string, unknown>;
  /** Progress reporter — surfaced to the user as live pipeline steps. */
  onProgress?: (message: string) => void;
}

export interface CatalogAdapter {
  id: CatalogPlatform;
  /** Human label for the UI badge. */
  label: string;
  /** Fingerprint from catalog root HTML + URL. */
  detect(html: string, url: string): boolean;
  getDepartments(ctx: ScrapeCtx): Promise<DepartmentRaw[]>;
  getCourses(ctx: ScrapeCtx, dept: DepartmentRaw): Promise<CourseRaw[]>;
  getCourseDetail(ctx: ScrapeCtx, course: CourseRaw): Promise<CourseDetailRaw>;
}

export function absolute(href: string | undefined | null, base: string): string | null {
  if (!href) return null;
  try {
    return new URL(href, base).toString();
  } catch {
    return null;
  }
}

export function clean(text: string | undefined | null): string {
  return (text ?? '')
    .replace(/ /g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Credit suffixes seen across CourseLeaf/Acalog/Banner catalog titles. */
const CREDIT_PATTERNS: RegExp[] = [
  // "credit: 1 Hour." / "credit: 3 to 5 Hours."
  /\s*[.,;:—–-]?\s*credits?\s*:\s*([^.]*?(?:credit\s*hours?|hours?|units?|credits?))\s*\.?\s*$/i,
  // "3 Units" / "4 credits" / "0-12 units" / Iowa's "3 s.h.", optionally parenthesised
  /\s*[.,;—–-]?\s*\(?\s*((?:\d+(?:\.\d+)?)(?:\s*(?:-|–|to)\s*\d+(?:\.\d+)?)?\s*(?:credit\s*hours?|credits?|units?|hours?|s\.\s?h\.?))\s*\.?\s*\)?\s*$/i,
  // Bare "(3)" or "(1-4)"
  /\s*\(\s*(\d+(?:\.\d+)?(?:\s*(?:-|–|to)\s*\d+(?:\.\d+)?)?)\s*\)\s*$/,
];

/**
 * Course numbers come in two families:
 *   letter-led  — "CS 229", "MATH-101", "ECON 101A", Iowa's "ACCT:3500"
 *   digit-led   — MIT style "6.1000", "18.01", "21A.100", cross-listed "1.63[J]"
 */
const NUMBER_PATTERNS: RegExp[] = [
  /^([A-Za-z][A-Za-z&./]{0,9}[\s:-]?\d[\w.\-/]*(?:\s*\[[A-Z]\])?)\s*[-–—:.]?\s+(.+)$/,
  /^(\d+[A-Za-z]?(?:\.[\w.]+)?(?:\[[A-Z]\])?)\s*[-–—:.]?\s+(.+)$/,
];

/** Splits "CS 229 Machine Learning (3)" into its parts. */
export function splitCourseTitle(raw: string): {
  course_number: string;
  title: string;
  credits: string | null;
} {
  const text = clean(raw).replace(/\s*[.•]\s*$/, '');

  let credits: string | null = null;
  let head = text;
  for (const pattern of CREDIT_PATTERNS) {
    const match = head.match(pattern);
    if (match && match.index !== undefined && match.index > 4) {
      credits = clean(match[1]);
      head = clean(head.slice(0, match.index));
      break;
    }
  }

  for (const pattern of NUMBER_PATTERNS) {
    const match = head.match(pattern);
    if (!match) continue;
    const course_number = clean(match[1]).replace(/\s+/g, ' ').replace(/[.,;:]+$/, '');
    const title = clean(match[2]);
    // A "number" longer than the title is almost certainly a mis-parse.
    if (course_number.length <= 20 && title.length >= 2) {
      return { course_number, title, credits };
    }
  }

  return { course_number: head.slice(0, 40), title: head, credits };
}

/**
 * Pulls a "Prerequisite: ..." clause out of a description blob. Deliberately
 * non-greedy — it stops at the first sentence break so it can't swallow the
 * rest of the entry, which is the usual failure mode here.
 */
export function extractPrerequisites(description: string): string | null {
  const match = description.match(
    /(?:pre-?requisites?|prereq(?:uisite)?\(s\)?|prereq)\s*[:\-–]\s*([^.\n]{0,400})/i,
  );
  if (!match) return null;
  const value = clean(match[1]);
  if (!value) return null;
  if (/^(none|n\/a|no prerequisites?)$/i.test(value)) return null;
  return value;
}
