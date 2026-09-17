/**
 * Rate card, in US dollars per million tokens.
 *
 * Keys are the Gateway model ids from lib/ai/models.ts. Rates are stamped onto
 * every ai_usage row at call time, so changing a number here only affects future
 * calls — historical cost stays accurate.
 *
 * Verify against current published pricing before trusting these for billing.
 */
export interface Rate {
  input: number;
  output: number;
}

const RATES: Record<string, Rate> = {
  'anthropic/claude-sonnet-4.5': { input: 3, output: 15 },
  'anthropic/claude-haiku-4.5': { input: 1, output: 5 },
  'anthropic/claude-sonnet-5': { input: 2, output: 10 },
  'anthropic/claude-opus-5': { input: 5, output: 25 },
  'openai/text-embedding-3-small': { input: 0.02, output: 0 },
};

/** Used when a model id has no entry, so an unknown model still records tokens. */
const UNKNOWN_RATE: Rate = { input: 0, output: 0 };

export function rateFor(model: string): Rate {
  return RATES[model] ?? RATES[model.replace(/^[^/]+\//, '')] ?? UNKNOWN_RATE;
}

export function costOf(model: string, inputTokens: number, outputTokens: number): number {
  const rate = rateFor(model);
  return (inputTokens / 1_000_000) * rate.input + (outputTokens / 1_000_000) * rate.output;
}

/** "$0.0412" / "$12.40" — small costs still need to be legible. */
export function formatUsd(value: number): string {
  if (!Number.isFinite(value) || value === 0) return '$0.00';
  if (value < 0.01) return `$${value.toFixed(4)}`;
  if (value < 1) return `$${value.toFixed(3)}`;
  return `$${value.toFixed(2)}`;
}

export function formatTokens(value: number): string {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(1)}k`;
  return String(value);
}
