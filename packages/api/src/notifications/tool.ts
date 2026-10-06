import { z } from 'zod';
import { tool } from '@langchain/core/tools';
import { notificationsConfigSchema } from 'librechat-data-provider';
import type { StructuredToolInterface } from '@langchain/core/tools';
import type { NotificationMethods } from '@librechat/data-schemas';
import type { NotificationPolicy } from 'librechat-data-provider';
import { createNotificationService } from './service';

export interface NotificationToolDependencies {
  userId: string;
  tenantId?: string;
  conversationId?: string;
  config?: Partial<NotificationPolicy>;
  getConversation: (userId: string, conversationId: string) => Promise<object | null>;
  enqueue: NotificationMethods['enqueueNotification'];
}

export function createNotificationTool(
  dependencies: NotificationToolDependencies,
): StructuredToolInterface | null {
  const policy = notificationsConfigSchema.parse(dependencies.config ?? {});
  if (!policy.enabled) return null;
  const notify = createNotificationService({
    authorize: async (context) =>
      (await dependencies.getConversation(context.userId, context.conversationId)) != null,
    enqueue: dependencies.enqueue,
  });
  return tool(
    async (input, config) => {
      const toolCallId = config.toolCall?.id;
      if (!toolCallId || !dependencies.conversationId) {
        return JSON.stringify({ ok: false, error: { code: 'NOT_AUTHORIZED' } });
      }
      try {
        return JSON.stringify(
          await notify(
            {
              userId: dependencies.userId,
              tenantId: dependencies.tenantId,
              conversationId: dependencies.conversationId,
              toolCallId,
            },
            input,
            policy,
          ),
        );
      } catch {
        return JSON.stringify({ ok: false, error: { code: 'NOTIFICATION_UNAVAILABLE' } });
      }
    },
    {
      name: 'notify_user',
      description:
        'Queue a notification in the current user’s LibreChat inbox. Use for requested reminders, important findings, or task outcomes. Do not include secrets. Queued does not mean delivered to a device. The recipient and source chat are fixed by the server.',
      schema: z
        .object({
          title: z.string().trim().min(1).max(policy.maxTitleLength),
          body: z.string().trim().min(1).max(policy.maxBodyLength),
        })
        .strict(),
    },
  );
}
