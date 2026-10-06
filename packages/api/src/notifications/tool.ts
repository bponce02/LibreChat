import { z } from 'zod';
import { tool } from '@langchain/core/tools';
import { notificationsConfigSchema } from 'librechat-data-provider';
import type { StructuredToolInterface } from '@langchain/core/tools';
import type { NotificationMethods } from '@librechat/data-schemas';
import type { NotificationPolicy } from 'librechat-data-provider';
import type { PushDeliveryDependencies } from './delivery';
import { createNotificationService } from './service';
import { deliverNotificationPush } from './delivery';

export interface NotificationToolDependencies {
  userId: string;
  tenantId?: string;
  conversationId?: string;
  config?: Partial<NotificationPolicy>;
  getConversation: (userId: string, conversationId: string) => Promise<object | null>;
  enqueue: NotificationMethods['enqueueNotification'];
  push?: PushDeliveryDependencies;
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
        const result = await notify(
          {
            userId: dependencies.userId,
            tenantId: dependencies.tenantId,
            conversationId: dependencies.conversationId,
            toolCallId,
          },
          input,
          policy,
        );
        if (!result.ok || result.duplicate || !dependencies.push) return JSON.stringify(result);
        const push = await deliverNotificationPush(dependencies.push, policy, dependencies.userId, {
          version: 1,
          notificationId: result.notificationId,
          conversationId: dependencies.conversationId,
          title: input.title.slice(0, 120),
          body: input.body.slice(0, 512),
        });
        return JSON.stringify({ ...result, push });
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
