const STOPWORDS = new Set([
  'a', 'an', 'the', 'is', 'are', 'was', 'were', 'be', 'been', 'being', 'of', 'to', 'in', 'on',
  'for', 'with', 'and', 'or', 'but', 'if', 'as', 'at', 'by', 'from', 'that', 'this', 'these',
  'those', 'it', 'its', 'which', 'what', 'how', 'why', 'when', 'where', 'who', 'does', 'do',
  'did', 'can', 'could', 'would', 'should', 'will', 'following', 'best', 'most', 'true', 'false',
]);

/** Normalised content tokens — the basis for the similarity check. */
export function tokenize(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, ' ')
      .split(/\s+/)
      .filter((t) => t.length > 2 && !STOPWORDS.has(t)),
  );
}

export function jaccard(a: Set<string>, b: Set<string>): number {
  if (!a.size || !b.size) return 0;
  let intersection = 0;
  for (const token of a) if (b.has(token)) intersection++;
  return intersection / (a.size + b.size - intersection);
}

export const SIMILARITY_THRESHOLD = 0.8;

/**
 * Tracks the stems already accepted into a test set and rejects near-duplicates.
 * Deliberately simple — a normalised-token Jaccard check, run server-side.
 */
export class DuplicateFilter {
  private readonly seen: Array<Set<string>> = [];

  constructor(existingStems: string[] = []) {
    for (const stem of existingStems) this.seen.push(tokenize(stem));
  }

  /** True when `stem` is too close to something already accepted. */
  isDuplicate(stem: string): boolean {
    const tokens = tokenize(stem);
    if (tokens.size === 0) return true;
    return this.seen.some((other) => jaccard(tokens, other) > SIMILARITY_THRESHOLD);
  }

  accept(stem: string): void {
    this.seen.push(tokenize(stem));
  }

  get size(): number {
    return this.seen.length;
  }
}
