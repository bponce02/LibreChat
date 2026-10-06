import { z } from 'zod';
import webPush from 'web-push';
import { ECDH, createECDH } from 'node:crypto';
import type { PushTransportConfig, NotificationPushPayload } from 'librechat-data-provider';
import type { SendResult, PushSubscription, RequestOptions } from 'web-push';
export type PushDeliveryResult = {
  status: 'accepted' | 'expired' | 'retry' | 'rejected' | 'disabled';
};
export type PushSender = (
  subscription: PushSubscription,
  payload: string,
  options: RequestOptions,
) => Promise<SendResult>;
export const webPushSender: PushSender = (subscription, payload, options) =>
  webPush.sendNotification(subscription, payload, options);

const subscriptionSchema = z
  .object({
    endpoint: z.string().url().max(2048),
    keys: z
      .object({
        p256dh: z
          .string()
          .regex(/^[A-Za-z0-9_-]{87}=?$/)
          .refine((value) => {
            try {
              const key = Buffer.from(value, 'base64url');
              if (key.length !== 65 || key[0] !== 4) return false;
              ECDH.convertKey(key, 'prime256v1');
              return true;
            } catch {
              return false;
            }
          }),
        auth: z.string().regex(/^[A-Za-z0-9_-]{22}(==)?$/),
      })
      .strict(),
  })
  .strict();
const payloadSchema = z
  .object({
    version: z.literal(1),
    notificationId: z.string().regex(/^[a-f0-9]{64}$/),
    conversationId: z.string().uuid(),
    title: z.string().trim().min(1).max(120),
    body: z.string().trim().min(1).max(512),
  })
  .strict();

export function createPushTransport(dependencies: {
  config: PushTransportConfig;
  privateKey?: string;
  send: PushSender;
}): (
  subscription: PushSubscription,
  payload: NotificationPushPayload,
) => Promise<PushDeliveryResult> {
  const { config, privateKey, send } = dependencies;
  if (config.enabled && (!config.publicKey || !privateKey || !config.subject)) {
    throw new Error('Push requires VAPID credentials and a contact subject');
  }
  if (config.enabled) {
    try {
      const subject = new URL(config.subject!);
      const pair = createECDH('prime256v1');
      pair.setPrivateKey(Buffer.from(privateKey!, 'base64url'));
      if (
        !['https:', 'mailto:'].includes(subject.protocol) ||
        subject.username ||
        subject.password ||
        pair.getPublicKey().toString('base64url') !== config.publicKey!.replace(/=+$/, '')
      ) {
        throw new Error('Invalid credentials');
      }
    } catch {
      throw new Error(
        'Push requires a matching VAPID key pair and an HTTPS or mailto contact subject',
      );
    }
  }
  const origins = new Set(config.allowedOrigins);
  for (const origin of origins) {
    const url = new URL(origin);
    if (url.protocol !== 'https:' || url.origin !== origin || url.username || url.password) {
      throw new Error('Push provider allowlist must contain exact HTTPS origins');
    }
  }
  return async (subscription, payload) => {
    if (!config.enabled) return { status: 'disabled' };
    const parsedSubscription = subscriptionSchema.safeParse(subscription);
    const parsedPayload = payloadSchema.safeParse(payload);
    if (!parsedSubscription.success || !parsedPayload.success) return { status: 'rejected' };
    const endpoint = new URL(parsedSubscription.data.endpoint);
    if (
      endpoint.protocol !== 'https:' ||
      endpoint.username ||
      endpoint.password ||
      endpoint.hash ||
      !origins.has(endpoint.origin)
    )
      return { status: 'rejected' };
    const body = JSON.stringify(parsedPayload.data);
    if (Buffer.byteLength(body, 'utf8') > 3072) return { status: 'rejected' };
    try {
      const result = await send(parsedSubscription.data, body, {
        vapidDetails: {
          subject: config.subject!,
          publicKey: config.publicKey!,
          privateKey: privateKey!,
        },
        TTL: config.ttlSeconds,
        timeout: config.timeoutMs,
        urgency: 'normal',
      });
      if (result.statusCode >= 200 && result.statusCode < 300) return { status: 'accepted' };
      return classifyStatus(result.statusCode);
    } catch (error) {
      const status =
        error != null &&
        typeof error === 'object' &&
        'statusCode' in error &&
        typeof error.statusCode === 'number'
          ? error.statusCode
          : 0;
      return classifyStatus(status);
    }
  };
}

function classifyStatus(status: number): PushDeliveryResult {
  if (status === 404 || status === 410) return { status: 'expired' };
  if (!status || status === 408 || status === 429 || status >= 500) return { status: 'retry' };
  return { status: 'rejected' };
}
