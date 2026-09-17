import 'server-only';

import { scrapeFetch } from './client';

interface RobotsRules {
  disallow: string[];
  allow: string[];
  fetchedAt: number;
}

const CACHE_TTL_MS = 60 * 60 * 1000;
const cache = new Map<string, RobotsRules>();

/**
 * Minimal robots.txt support: reads the rules for our own User-Agent, falling
 * back to `*`. On any failure we allow — a missing robots.txt is not a refusal.
 */
async function loadRules(origin: string): Promise<RobotsRules> {
  const cached = cache.get(origin);
  if (cached && Date.now() - cached.fetchedAt < CACHE_TTL_MS) return cached;

  const empty: RobotsRules = { disallow: [], allow: [], fetchedAt: Date.now() };

  try {
    const res = await scrapeFetch(`${origin}/robots.txt`);
    if (!res.ok || !res.html || res.html.length > 500_000) {
      cache.set(origin, empty);
      return empty;
    }

    const rules: RobotsRules = { disallow: [], allow: [], fetchedAt: Date.now() };
    let applies = false;
    let sawOurAgent = false;

    for (const rawLine of res.html.split('\n')) {
      const line = rawLine.split('#')[0].trim();
      if (!line) continue;

      const [rawKey, ...rest] = line.split(':');
      const key = rawKey.trim().toLowerCase();
      const value = rest.join(':').trim();

      if (key === 'user-agent') {
        const agent = value.toLowerCase();
        if (agent.includes('aceversity')) {
          // A block naming us specifically overrides anything matched via '*'.
          if (!sawOurAgent) {
            rules.disallow = [];
            rules.allow = [];
          }
          sawOurAgent = true;
          applies = true;
        } else if (agent === '*' && !sawOurAgent) {
          applies = true;
        } else {
          applies = false;
        }
        continue;
      }

      if (!applies || !value) continue;
      if (key === 'disallow') rules.disallow.push(value);
      if (key === 'allow') rules.allow.push(value);
    }

    cache.set(origin, rules);
    return rules;
  } catch {
    cache.set(origin, empty);
    return empty;
  }
}

function matches(path: string, rule: string): boolean {
  if (rule === '/') return true;
  // robots.txt wildcards: '*' matches any run, '$' anchors the end.
  const pattern = rule
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replace(/\*/g, '.*')
    .replace(/\\\$$/, '$');
  try {
    return new RegExp(`^${pattern}`).test(path);
  } catch {
    return path.startsWith(rule);
  }
}

export async function isAllowed(url: string): Promise<boolean> {
  let target: URL;
  try {
    target = new URL(url);
  } catch {
    return false;
  }

  const rules = await loadRules(target.origin);
  const path = `${target.pathname}${target.search}`;

  // Longest matching rule wins, and Allow beats Disallow at equal length.
  let verdict = true;
  let bestLength = -1;

  for (const rule of rules.disallow) {
    if (matches(path, rule) && rule.length > bestLength) {
      bestLength = rule.length;
      verdict = false;
    }
  }
  for (const rule of rules.allow) {
    if (matches(path, rule) && rule.length >= bestLength) {
      bestLength = rule.length;
      verdict = true;
    }
  }

  return verdict;
}
