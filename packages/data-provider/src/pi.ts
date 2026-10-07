import { z } from 'zod';

const entryId = z.string().regex(/^[a-zA-Z0-9-]{1,64}$/);
const remoteId = z.string().regex(/^[a-zA-Z0-9_-]{1,128}$/);
export const piSyncConfigSchema = z.object({
  enabled: z.boolean().default(false),
  ownerId: z
    .string()
    .regex(/^[a-f0-9]{24}$/)
    .optional(),
  pollIntervalMs: z.number().int().min(5000).max(300000).default(15000),
  maxSnapshotBytes: z
    .number()
    .int()
    .min(1024)
    .max(10 * 1024 * 1024)
    .default(2 * 1024 * 1024),
  maxMessages: z.number().int().min(1).max(10000).default(2000),
  maxMessageChars: z
    .number()
    .int()
    .min(1)
    .max(1024 * 1024)
    .default(256 * 1024),
});
export type PiSyncConfig = z.infer<typeof piSyncConfigSchema>;
export const piSnapshotSchema = z.object({
  sessionId: entryId,
  cwd: z.string().startsWith('/').max(4096),
  title: z.string().max(4096).optional(),
  leafId: entryId.nullable(),
  messages: z.array(
    z.object({
      entryId,
      role: z.enum(['user', 'assistant']),
      text: z.string(),
      timestamp: z.string().refine((value) => Number.isFinite(Date.parse(value))),
      remote: z
        .object({ conversationId: remoteId, userMessageId: remoteId, responseMessageId: remoteId })
        .optional(),
    }),
  ),
});
export type PiSnapshot = z.infer<typeof piSnapshotSchema>;
export interface PiSyncStatus {
  sessionId: string;
  leafId: string | null;
  lastMessageId: string;
  disabled: boolean;
  pollIntervalMs: number;
}
