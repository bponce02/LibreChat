import { z } from 'zod';

export const pushTransportConfigSchema = z.object({
  enabled: z.boolean().default(false),
  publicKey: z.string().optional(),
  subject: z.string().optional(),
  allowedOrigins: z
    .array(z.string().url())
    .min(1)
    .max(20)
    .default([
      'https://fcm.googleapis.com',
      'https://updates.push.services.mozilla.com',
      'https://web.push.apple.com',
    ]),
  ttlSeconds: z.number().int().min(0).max(86400).default(3600),
  timeoutMs: z.number().int().min(1000).max(30000).default(10000),
});

export type PushTransportConfig = z.infer<typeof pushTransportConfigSchema>;
export interface NotificationPushPayload {
  version: 1;
  notificationId: string;
  conversationId: string;
  title: string;
  body: string;
}

export const notificationsConfigSchema = z.object({
  push: pushTransportConfigSchema.optional(),
  enabled: z.boolean().default(false),
  maxTitleLength: z.number().int().min(1).max(500).default(120),
  maxBodyLength: z.number().int().min(1).max(10000).default(2000),
  maxPerMinute: z.number().int().min(1).max(100).default(10),
  pageSize: z.number().int().min(1).max(100).default(50),
  pollIntervalMs: z.number().int().min(5000).max(300000).default(15000),
});

export type NotificationPolicy = z.infer<typeof notificationsConfigSchema>;

export interface NotificationInput {
  title: string;
  body: string;
}

export interface NotificationContext {
  userId: string;
  tenantId?: string;
  conversationId: string;
  toolCallId: string;
}

export interface NotificationItem extends NotificationInput {
  id: string;
  conversationId: string;
  createdAt: string;
  readAt: string | null;
}

export type NotificationResult =
  | { ok: true; notificationId: string; status: 'queued'; duplicate: boolean }
  | {
      ok: false;
      error: {
        code:
          | 'DISABLED'
          | 'INVALID_INPUT'
          | 'NOT_AUTHORIZED'
          | 'RATE_LIMITED'
          | 'IDEMPOTENCY_CONFLICT';
      };
    };

export interface NotificationList {
  notifications: NotificationItem[];
  unreadCount: number;
}
