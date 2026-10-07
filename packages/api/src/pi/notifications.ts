import { z } from 'zod';
import { piSyncConfigSchema, notificationsConfigSchema } from 'librechat-data-provider';
import type { AppConfig, PiSyncStore, NotificationMethods } from '@librechat/data-schemas';
import type { RequestHandler } from 'express';
import type { PushDeliveryDependencies } from '~/notifications/delivery';
import { createNotificationService } from '~/notifications/service';
import { deliverNotificationPush } from '~/notifications/delivery';
import { authorizePiPublisher } from './auth';
import { PiSyncError } from './service';

const inputSchema = z
  .object({
    sessionId: z.string().regex(/^[a-zA-Z0-9-]{1,64}$/),
    toolCallId: z.string().min(1).max(256),
    title: z.string().trim().min(1).max(120),
    body: z.string().trim().min(1).max(2000),
  })
  .strict();

export function createPiNotificationHandler(deps: {
  store: PiSyncStore;
  getConfig(): Promise<Pick<AppConfig, 'piSync' | 'notifications'>>;
  key?: string;
  standalone: boolean;
  enqueue: NotificationMethods['enqueueNotification'];
  push?: PushDeliveryDependencies;
}): RequestHandler {
  const notify = createNotificationService({
    authorize: (context) => deps.store.getConversation(context.userId, context.conversationId),
    enqueue: deps.enqueue,
  });
  return async (req, res) => {
    try {
      authorizePiPublisher(req, deps.key, deps.standalone);
      const parsed = inputSchema.safeParse(req.body);
      if (!parsed.success) throw new PiSyncError(400, 'INVALID_INPUT');
      const config = await deps.getConfig();
      const sync = piSyncConfigSchema.parse(config.piSync ?? {});
      if (!sync.enabled || !sync.ownerId) throw new PiSyncError(503, 'PI_SYNC_DISABLED');
      const input = parsed.data;
      const link = await deps.store.getLink(sync.ownerId, input.sessionId);
      if (!link || link.disabled) throw new PiSyncError(409, 'PI_SESSION_NOT_SYNCED');
      const policy = notificationsConfigSchema.parse(config.notifications ?? {});
      const result = await notify(
        {
          userId: sync.ownerId,
          conversationId: link.conversationId,
          toolCallId: `pi:${input.sessionId}:${input.toolCallId}`,
        },
        { title: input.title, body: input.body },
        policy,
      );
      if (!result.ok) {
        res.status(result.error.code === 'RATE_LIMITED' ? 429 : 400).json(result);
        return;
      }
      if (result.duplicate || !deps.push) {
        res.json(result);
        return;
      }
      const push = await deliverNotificationPush(deps.push, policy, sync.ownerId, {
        version: 1,
        notificationId: result.notificationId,
        conversationId: link.conversationId,
        title: input.title,
        body: input.body.slice(0, 512),
      });
      res.json({ ...result, push });
    } catch (error) {
      res.status(error instanceof PiSyncError ? error.status : 503).json({
        error: { code: error instanceof PiSyncError ? error.code : 'NOTIFICATION_UNAVAILABLE' },
      });
    }
  };
}
