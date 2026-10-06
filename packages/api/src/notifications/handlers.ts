import { notificationsConfigSchema } from 'librechat-data-provider';
import type { NotificationMethods, AppConfig } from '@librechat/data-schemas';
import type { Request, Response, RequestHandler } from 'express';
import { isPushReady } from './delivery';

export type NotificationRequest = Request & {
  config?: AppConfig;
  user?: { id?: string };
};

export function createNotificationHandlers(
  dependencies: Pick<NotificationMethods, 'listNotifications' | 'readNotification'> & {
    pushPrivateKey?: string;
  },
): { config: RequestHandler; list: RequestHandler; read: RequestHandler } {
  const config = (req: NotificationRequest, res: Response) => {
    const policy = notificationsConfigSchema.parse(req.config?.notifications ?? {});
    if (policy.push) policy.push.enabled = isPushReady(policy, dependencies.pushPrivateKey);
    res.json(policy);
  };
  const list = async (req: NotificationRequest, res: Response) => {
    const userId = req.user?.id;
    if (!userId) {
      res.status(401).json({ error: { code: 'NOT_AUTHORIZED' } });
      return;
    }
    const policy = notificationsConfigSchema.parse(req.config?.notifications ?? {});
    if (!policy.enabled) {
      res.status(403).json({ error: { code: 'DISABLED' } });
      return;
    }
    try {
      res.json(await dependencies.listNotifications(userId, policy.pageSize));
    } catch {
      res.status(503).json({ error: { code: 'NOTIFICATION_UNAVAILABLE' } });
    }
  };
  const read = async (req: NotificationRequest, res: Response) => {
    const userId = req.user?.id;
    if (!userId) {
      res.status(401).json({ error: { code: 'NOT_AUTHORIZED' } });
      return;
    }
    const policy = notificationsConfigSchema.parse(req.config?.notifications ?? {});
    if (!policy.enabled) {
      res.status(403).json({ error: { code: 'DISABLED' } });
      return;
    }
    const { id } = req.params;
    if (typeof id !== 'string' || !/^[a-f0-9]{64}$/.test(id)) {
      res.status(400).json({ error: { code: 'INVALID_INPUT' } });
      return;
    }
    try {
      const found = await dependencies.readNotification(userId, id);
      if (!found) {
        res.status(404).json({ error: { code: 'NOT_FOUND' } });
        return;
      }
      res.json({ ok: true });
    } catch {
      res.status(503).json({ error: { code: 'NOTIFICATION_UNAVAILABLE' } });
    }
  };
  return { config, list, read };
}
