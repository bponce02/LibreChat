import { z } from 'zod';

export const codemodeConfigSchema = z.object({
  enabled: z.boolean().default(false),
  timeoutMs: z.number().int().min(100).max(120000).default(30000),
  memoryBytes: z
    .number()
    .int()
    .min(1024 * 1024)
    .max(256 * 1024 * 1024)
    .default(32 * 1024 * 1024),
  maxCodeBytes: z
    .number()
    .int()
    .min(1024)
    .max(1024 * 1024)
    .default(64 * 1024),
  maxOutputBytes: z
    .number()
    .int()
    .min(1024)
    .max(1024 * 1024)
    .default(32 * 1024),
  maxValueBytes: z
    .number()
    .int()
    .min(1024)
    .max(1024 * 1024)
    .default(128 * 1024),
  maxToolCalls: z.number().int().min(1).max(1000).default(50),
  maxImages: z.number().int().min(1).max(20).default(8),
  maxImageBytes: z
    .number()
    .int()
    .min(1024)
    .max(10 * 1024 * 1024)
    .default(2 * 1024 * 1024),
  concurrency: z.number().int().min(1).max(20).default(4),
});
export type CodemodeConfig = z.infer<typeof codemodeConfigSchema>;
export interface CodemodeToolDescriptor {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}
export interface CodemodeImage {
  type: 'image_url';
  image_url: { url: string };
}
export interface CodemodeResult {
  ok: boolean;
  output: string[];
  images?: string[];
  error?:
    | 'DISABLED'
    | 'INVALID_CODE'
    | 'TIMEOUT'
    | 'CANCELLED'
    | 'LIMIT'
    | 'SCRIPT_ERROR'
    | 'UNAVAILABLE';
}
