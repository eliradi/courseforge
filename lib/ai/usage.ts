import 'server-only';

import { AsyncLocalStorage } from 'node:async_hooks';

import { createAdminClient } from '@/lib/supabase/admin';
import { costOf, rateFor } from './pricing';

export interface UsageContext {
  userId?: string | null;
  collegeId?: string | null;
  courseId?: string | null;
  testSetId?: string | null;
}

/**
 * Ambient attribution for model calls.
 *
 * Scraping and profile building fan out through many layers before reaching an
 * AI call, so rather than threading ids through every adapter signature the
 * pipeline wraps its work in `withUsageContext` and the recorder reads it here.
 */
const storage = new AsyncLocalStorage<UsageContext>();

export function withUsageContext<T>(context: UsageContext, fn: () => Promise<T>): Promise<T> {
  const parent = storage.getStore() ?? {};
  return storage.run({ ...parent, ...context }, fn);
}

export function currentUsageContext(): UsageContext {
  return storage.getStore() ?? {};
}

export interface UsageRecord {
  operation: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  succeeded?: boolean;
}

/**
 * Writes one row to the cost ledger. Never throws — a bookkeeping failure must
 * not take down the operation it was measuring.
 */
export async function recordUsage(record: UsageRecord): Promise<void> {
  const context = currentUsageContext();
  const rate = rateFor(record.model);
  const inputTokens = Math.max(0, Math.round(record.inputTokens || 0));
  const outputTokens = Math.max(0, Math.round(record.outputTokens || 0));

  try {
    const admin = createAdminClient();
    await admin.from('ai_usage').insert({
      user_id: context.userId ?? null,
      college_id: context.collegeId ?? null,
      course_id: context.courseId ?? null,
      test_set_id: context.testSetId ?? null,
      operation: record.operation,
      model: record.model,
      input_tokens: inputTokens,
      output_tokens: outputTokens,
      total_tokens: inputTokens + outputTokens,
      input_rate: rate.input,
      output_rate: rate.output,
      cost_usd: costOf(record.model, inputTokens, outputTokens),
      succeeded: record.succeeded ?? true,
    });
  } catch (error) {
    console.error('[ai] could not record usage:', error instanceof Error ? error.message : error);
  }
}

/** Normalises the AI SDK's usage object, which varies by call type and version. */
export function readUsage(usage: unknown): { inputTokens: number; outputTokens: number } {
  const value = (usage ?? {}) as Record<string, unknown>;
  const num = (...keys: string[]) => {
    for (const key of keys) {
      const candidate = value[key];
      if (typeof candidate === 'number' && Number.isFinite(candidate)) return candidate;
    }
    return 0;
  };
  return {
    inputTokens: num('inputTokens', 'promptTokens'),
    outputTokens: num('outputTokens', 'completionTokens'),
  };
}
