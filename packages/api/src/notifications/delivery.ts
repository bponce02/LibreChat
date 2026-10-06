import type { NotificationPolicy, NotificationPushPayload } from 'librechat-data-provider';
import type { PushDeviceMethods } from '@librechat/data-schemas';
import type { PushSender } from './push';
import { createPushTransport, webPushSender } from './push';

export interface PushDeliveryDependencies {
  getPushSubscriptions: PushDeviceMethods['getPushSubscriptions'];
  revokePushDevice: PushDeviceMethods['revokePushDevice'];
  privateKey?: string;
  send: PushSender;
}
export function isPushReady(policy: NotificationPolicy, privateKey?: string): boolean {
  if (!policy.enabled || !policy.push?.enabled) return false;
  try {
    createPushTransport({ config: policy.push, privateKey, send: webPushSender });
    return true;
  } catch {
    return false;
  }
}

export async function deliverNotificationPush(
  dependencies: PushDeliveryDependencies,
  policy: NotificationPolicy,
  userId: string,
  payload: NotificationPushPayload,
): Promise<{ accepted: number; failed: number }> {
  if (!policy.enabled || !policy.push?.enabled) return { accepted: 0, failed: 0 };
  try {
    const send = createPushTransport({
      config: policy.push,
      privateKey: dependencies.privateKey,
      send: dependencies.send,
    });
    const devices = await dependencies.getPushSubscriptions(userId);
    const results = await Promise.allSettled(
      devices.map(async (device) => {
        const result = await send(device.subscription, payload);
        if (result.status === 'expired') await dependencies.revokePushDevice(userId, device.id);
        return result.status === 'accepted';
      }),
    );
    const accepted = results.filter(
      (result) => result.status === 'fulfilled' && result.value,
    ).length;
    return { accepted, failed: results.length - accepted };
  } catch {
    return { accepted: 0, failed: 1 };
  }
}
