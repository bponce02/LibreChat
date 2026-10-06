import { z } from 'zod';
import { notificationsConfigSchema } from 'librechat-data-provider';
import type { PushDeviceMethods } from '@librechat/data-schemas';
import type { RequestHandler, Response } from 'express';
import type { NotificationRequest } from './handlers';
import { validatePushSubscription } from './push';
import { isPushReady } from './delivery';

const registrationSchema = z
  .object({ label: z.string().trim().min(1).max(100), subscription: z.unknown() })
  .strict();

export function createPushDeviceHandlers(
  dependencies: Pick<
    PushDeviceMethods,
    'registerPushDevice' | 'listPushDevices' | 'revokePushDevice'
  > & { pushPrivateKey?: string },
): { register: RequestHandler; list: RequestHandler; revoke: RequestHandler } {
  const register = async (req: NotificationRequest, res: Response) => {
    const userId = req.user?.id;
    if (!userId) {
      res.status(401).json({ error: { code: 'NOT_AUTHORIZED' } });
      return;
    }
    const policy = notificationsConfigSchema.parse(req.config?.notifications ?? {});
    if (!policy.push || !isPushReady(policy, dependencies.pushPrivateKey)) {
      res.status(403).json({ error: { code: 'DISABLED' } });
      return;
    }
    const input = registrationSchema.safeParse(req.body);
    if (!input.success) {
      res.status(400).json({ error: { code: 'INVALID_INPUT' } });
      return;
    }
    const subscription = validatePushSubscription(
      input.data.subscription,
      policy.push.allowedOrigins,
    );
    if (!subscription.ok) {
      res.status(400).json({ error: subscription.error });
      return;
    }
    try {
      const result = await dependencies.registerPushDevice(
        userId,
        subscription.data,
        input.data.label,
      );
      res.json({ ok: true, device: result });
    } catch {
      res.status(503).json({ error: { code: 'NOTIFICATION_UNAVAILABLE' } });
    }
  };
  const list = async (req: NotificationRequest, res: Response) => {
    const userId = req.user?.id;
    if (!userId) {
      res.status(401).json({ error: { code: 'NOT_AUTHORIZED' } });
      return;
    }
    try {
      res.json({ devices: await dependencies.listPushDevices(userId) });
    } catch {
      res.status(503).json({ error: { code: 'NOTIFICATION_UNAVAILABLE' } });
    }
  };
  const revoke = async (req: NotificationRequest, res: Response) => {
    const userId = req.user?.id;
    if (!userId) {
      res.status(401).json({ error: { code: 'NOT_AUTHORIZED' } });
      return;
    }
    const id = req.params.id;
    if (typeof id !== 'string' || !/^[a-f0-9]{64}$/.test(id)) {
      res.status(400).json({ error: { code: 'INVALID_INPUT' } });
      return;
    }
    try {
      await dependencies.revokePushDevice(userId, id);
      res.json({ ok: true });
    } catch {
      res.status(503).json({ error: { code: 'NOTIFICATION_UNAVAILABLE' } });
    }
  };
  return { register, list, revoke };
}
