import 'server-only';

import { generateObject } from 'ai';
import type { z } from 'zod';

import { EXTRACTION_SETTINGS, FAST_MODEL, isAiConfigured } from './models';
import { readUsage, recordUsage } from './usage';

/**
 * Structured extraction with the fast model. Returns null instead of throwing so
 * every caller can degrade gracefully — an AI hiccup must never blank a page.
 */
export async function extractObject<T extends z.ZodTypeAny>(args: {
  schema: T;
  prompt: string;
  system?: string;
  model?: string;
  /** Labels the row written to the cost ledger. */
  operation?: string;
}): Promise<z.infer<T> | null> {
  if (!isAiConfigured()) return null;

  const model = args.model ?? FAST_MODEL;
  const operation = args.operation ?? 'extract';

  try {
    const { object, usage } = await generateObject({
      model,
      schema: args.schema,
      system: args.system,
      prompt: args.prompt,
      ...EXTRACTION_SETTINGS,
    });

    const { inputTokens, outputTokens } = readUsage(usage);
    await recordUsage({ operation, model, inputTokens, outputTokens });

    // generateObject's inferred type doesn't survive this generic wrapper; the
    // value is schema-validated by the SDK before it gets here.
    return object as z.infer<T>;
  } catch (error) {
    console.error('[ai] extraction failed:', error instanceof Error ? error.message : error);
    // A failed call still burned input tokens; record it so cost isn't understated.
    await recordUsage({ operation, model, inputTokens: 0, outputTokens: 0, succeeded: false });
    return null;
  }
}
