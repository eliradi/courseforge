import 'server-only';

/**
 * Every model id the app uses, in one place.
 *
 * AI SDK v5 resolves bare `provider/model` strings through the Vercel AI
 * Gateway whenever AI_GATEWAY_API_KEY is set, so we never import a provider SDK
 * directly. Override either id via env to swap models without a code change.
 */

/** Question generation — the quality-critical path. */
export const PRIMARY_MODEL = process.env.AI_PRIMARY_MODEL ?? 'anthropic/claude-sonnet-4.5';

/** Summaries, extraction cleanup, catalog confirmation — high volume, low stakes. */
export const FAST_MODEL = process.env.AI_FAST_MODEL ?? 'anthropic/claude-haiku-4.5';

export function isAiConfigured(): boolean {
  return Boolean(process.env.AI_GATEWAY_API_KEY);
}

export class AiNotConfiguredError extends Error {
  constructor() {
    super('AI_GATEWAY_API_KEY is not set — AI features are unavailable.');
    this.name = 'AiNotConfiguredError';
  }
}

export function assertAiConfigured(): void {
  if (!isAiConfigured()) throw new AiNotConfiguredError();
}

/** Shared generation settings: deterministic enough to be reproducible, warm enough to vary. */
export const GENERATION_SETTINGS = {
  temperature: 0.7,
  maxRetries: 2,
} as const;

export const EXTRACTION_SETTINGS = {
  temperature: 0.1,
  maxRetries: 2,
} as const;
