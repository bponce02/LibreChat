import { z } from 'zod';

export const notificationsConfigSchema = z.object({
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
