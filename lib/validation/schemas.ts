import { z } from 'zod';

/* ------------------------------------------------------------------ shared */

export const CatalogPlatformSchema = z.enum([
  'courseleaf',
  'acalog',
  'banner',
  'kuali',
  'coursedog',
  'generic',
]);
export type CatalogPlatform = z.infer<typeof CatalogPlatformSchema>;

export const UrlSchema = z.string().url();

/* ------------------------------------------------- scraper-service payloads */

export const FetchRequestSchema = z.object({
  url: UrlSchema,
  headers: z.record(z.string(), z.string()).optional(),
  method: z.enum(['GET', 'POST']).optional(),
  body: z.string().optional(),
  timeoutMs: z.number().int().positive().max(60_000).optional(),
});

export const FetchResponseSchema = z.object({
  ok: z.boolean(),
  status: z.number(),
  finalUrl: z.string(),
  html: z.string(),
  headers: z.record(z.string(), z.string()).default({}),
});
export type FetchResponse = z.infer<typeof FetchResponseSchema>;

export const RenderRequestSchema = z.object({
  url: UrlSchema,
  waitFor: z.string().optional(),
  waitUntil: z.enum(['load', 'domcontentloaded', 'networkidle']).optional(),
  timeoutMs: z.number().int().positive().max(60_000).optional(),
  cookies: z
    .array(z.object({ name: z.string(), value: z.string(), domain: z.string().optional(), path: z.string().optional() }))
    .optional(),
});

export const RenderResponseSchema = z.object({
  ok: z.boolean(),
  status: z.number(),
  finalUrl: z.string(),
  html: z.string(),
  markdown: z.string(),
  cookies: z
    .array(z.object({ name: z.string(), value: z.string(), domain: z.string(), path: z.string() }))
    .default([]),
});
export type RenderResponse = z.infer<typeof RenderResponseSchema>;

export const InterceptRequestSchema = z.object({
  url: UrlSchema,
  urlPattern: z.string(),
  waitFor: z.string().optional(),
  maxCaptures: z.number().int().positive().max(50).optional(),
  timeoutMs: z.number().int().positive().max(60_000).optional(),
});

export const InterceptResponseSchema = z.object({
  ok: z.boolean(),
  finalUrl: z.string(),
  captures: z.array(
    z.object({
      url: z.string(),
      status: z.number(),
      contentType: z.string().nullable(),
      json: z.unknown().nullable(),
    }),
  ),
  cookies: z
    .array(z.object({ name: z.string(), value: z.string(), domain: z.string(), path: z.string() }))
    .default([]),
});
export type InterceptResponse = z.infer<typeof InterceptResponseSchema>;

export const CrawlRequestSchema = z.object({
  url: UrlSchema,
  maxDepth: z.number().int().min(0).max(2).optional(),
  maxPages: z.number().int().min(1).max(25).optional(),
  includePattern: z.string().optional(),
  render: z.boolean().optional(),
});

export const CrawlResponseSchema = z.object({
  ok: z.boolean(),
  pages: z.array(
    z.object({ url: z.string(), status: z.number(), html: z.string(), markdown: z.string() }),
  ),
});
export type CrawlResponse = z.infer<typeof CrawlResponseSchema>;

export const ScreenshotResponseSchema = z.object({
  ok: z.boolean(),
  finalUrl: z.string(),
  imageBase64: z.string(),
});

/* -------------------------------------------------------- scraped entities */

export const DepartmentRawSchema = z.object({
  code: z
    .string()
    .trim()
    .min(1)
    .max(24)
    .transform((s) => s.toUpperCase()),
  name: z.string().trim().min(1).max(200),
  url: z.string().optional().nullable(),
});
export type DepartmentRaw = z.infer<typeof DepartmentRawSchema>;

export const DepartmentListSchema = z.object({ departments: z.array(DepartmentRawSchema) });

export const CourseRawSchema = z.object({
  course_number: z.string().trim().min(1).max(40),
  title: z.string().trim().min(1).max(400),
  description: z.string().trim().max(8000).optional().nullable(),
  credits: z.string().trim().max(80).optional().nullable(),
  prerequisites: z.string().trim().max(2000).optional().nullable(),
  instructors: z.array(z.string().trim().min(1).max(160)).optional().nullable(),
  terms_offered: z.string().trim().max(200).optional().nullable(),
  syllabus_url: z.string().trim().max(1000).optional().nullable(),
  source_url: z.string().trim().max(1000).optional().nullable(),
});
export type CourseRaw = z.infer<typeof CourseRawSchema>;

export const CourseListSchema = z.object({ courses: z.array(CourseRawSchema) });

export const CourseDetailRawSchema = CourseRawSchema.extend({
  raw_scraped_content: z.string().max(200_000).optional().nullable(),
});
export type CourseDetailRaw = z.infer<typeof CourseDetailRawSchema>;

/* ---------------------------------------------------------------- textbooks */

export const TextbookRawSchema = z.object({
  title: z.string().trim().min(2).max(400),
  authors: z.string().trim().max(400).optional().nullable(),
  edition: z.string().trim().max(80).optional().nullable(),
  isbn: z
    .string()
    .trim()
    .max(32)
    .optional()
    .nullable()
    .transform((v) => (v ? v.replace(/[^0-9Xx]/g, '') || null : null)),
  required: z.boolean().default(true),
});
export type TextbookRaw = z.infer<typeof TextbookRawSchema>;

export const TextbookListSchema = z.object({ textbooks: z.array(TextbookRawSchema) });

/* ----------------------------------------------------------------- sections */

export const SectionRawSchema = z.object({
  title: z.string().trim().min(2).max(300),
  topics: z.array(z.string().trim().min(1).max(200)).min(1).max(20),
});
export type SectionRaw = z.infer<typeof SectionRawSchema>;

export const SectionListSchema = z.object({
  sections: z.array(SectionRawSchema).min(1).max(30),
});

/* ---------------------------------------------------------------- questions */

export const QuestionTypeSchema = z.enum(['mcq', 'true_false', 'short_answer']);
export const DifficultySchema = z.enum(['easy', 'medium', 'hard']);

export const QuestionSchema = z
  .object({
    type: QuestionTypeSchema,
    difficulty: DifficultySchema,
    question: z.string().trim().min(10).max(1200),
    options: z.array(z.string().trim().min(1).max(500)).optional().nullable(),
    correct_answer: z.string().trim().min(1).max(1200),
    explanation: z.string().trim().min(5).max(1200),
    topic: z.string().trim().min(1).max(200),
  })
  .superRefine((q, ctx) => {
    if (q.type === 'mcq') {
      if (!q.options || q.options.length !== 4) {
        ctx.addIssue({
          code: 'custom',
          path: ['options'],
          message: 'MCQ questions must have exactly 4 options',
        });
        return;
      }
      const norm = (s: string) => s.trim().toLowerCase();
      if (!q.options.some((o) => norm(o) === norm(q.correct_answer))) {
        ctx.addIssue({
          code: 'custom',
          path: ['correct_answer'],
          message: 'MCQ correct_answer must exactly match one of the options',
        });
      }
      if (new Set(q.options.map(norm)).size !== 4) {
        ctx.addIssue({ code: 'custom', path: ['options'], message: 'MCQ options must be distinct' });
      }
    }

    if (q.type === 'true_false') {
      if (!['true', 'false'].includes(q.correct_answer.trim().toLowerCase())) {
        ctx.addIssue({
          code: 'custom',
          path: ['correct_answer'],
          message: 'true_false correct_answer must be "True" or "False"',
        });
      }
    }
  });
export type QuestionInput = z.infer<typeof QuestionSchema>;

/** Shape handed to generateObject — kept free of superRefine so the model sees a clean JSON schema. */
export const QuestionGenSchema = z.object({
  type: QuestionTypeSchema.describe('mcq, true_false, or short_answer'),
  difficulty: DifficultySchema,
  question: z.string().describe('The question stem. Original wording — never copied from a book.'),
  options: z
    .array(z.string())
    .describe('Exactly 4 answer options for mcq; omit or leave empty for other types.')
    .optional(),
  correct_answer: z
    .string()
    .describe('For mcq, must be verbatim one of options. For true_false, "True" or "False".'),
  explanation: z.string().describe('1-3 sentences explaining why the answer is correct.'),
  topic: z.string().describe('One topic drawn from the section topic list.'),
});

export const questionBatchSchema = (count: number) =>
  z.object({ questions: z.array(QuestionGenSchema).length(count) });

/* ------------------------------------------------------- misc AI responses */

/**
 * Deliberately permissive. Range and length caps on generated fields are a
 * silent failure mode — the model writes a 500-character reason or a confidence
 * of 95 instead of 0.95, the response fails schema validation, and the whole
 * call is discarded. The caller normalises instead (see confirmWithAi).
 */
export const CatalogConfirmSchema = z.object({
  is_course_catalog: z.boolean().describe('True only if this page indexes academic subjects or courses.'),
  confidence: z.number().describe('How confident you are, from 0 to 1.'),
  reason: z.string().describe('One or two sentences explaining the judgement.'),
});

export const CourseSummarySchema = z.object({
  summary: z.string().min(80).max(3000),
});

/* -------------------------------------------------------- server-action io */

export const ManualCatalogUrlSchema = z.object({
  collegeId: z.string().uuid(),
  catalogUrl: UrlSchema,
});

export const SubmitAttemptSchema = z.object({
  attemptId: z.string().uuid(),
  answers: z.array(
    z.object({
      questionId: z.string().uuid(),
      answer: z.string().max(2000).nullable(),
      flagged: z.boolean().default(false),
    }),
  ),
});
