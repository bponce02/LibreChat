import { z } from 'zod';

export const codexSearchConfigSchema = z.object({
  enabled: z.boolean().default(false),
  baseUrl: z.string().url().default('http://codex-connector:8788/v1'),
  model: z.string().min(1).optional(),
  timeoutMs: z.number().int().min(1000).max(300000).default(120000),
  maxQueryLength: z.number().int().min(1).max(16000).default(4000),
  maxAnswerLength: z.number().int().min(100).max(64000).default(16000),
  maxResponseBytes: z.number().int().min(1024).max(1048576).default(131072),
  maxSources: z.number().int().min(1).max(20).default(20),
});
export type CodexSearchConfig = z.infer<typeof codexSearchConfigSchema>;
