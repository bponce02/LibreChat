import webPush from 'web-push';
import { pushTransportConfigSchema } from 'librechat-data-provider';
import { createPushTransport } from './push';

const credentials = webPush.generateVAPIDKeys();

const subscription = {
  endpoint: 'https://fcm.googleapis.com/fcm/send/test-device',
  keys: {
    p256dh: webPush.generateVAPIDKeys().publicKey,
    auth: Buffer.alloc(16, 1).toString('base64url'),
  },
};
const payload = {
  version: 1 as const,
  notificationId: 'a'.repeat(64),
  conversationId: '12345678-1234-4234-8234-123456789abc',
  title: 'LibreChat',
  body: 'You have a new notification.',
};
function fixture() {
  const send = jest.fn().mockResolvedValue({ statusCode: 201, headers: {}, body: '' });
  const config = pushTransportConfigSchema.parse({
    enabled: true,
    publicKey: credentials.publicKey,
    subject: 'mailto:admin@example.test',
  });
  return {
    send,
    config,
    deliver: createPushTransport({ send, config, privateKey: credentials.privateKey }),
  };
}

test('transport supplies VAPID per call, bounded delivery options and the payload to the sender', async () => {
  const f = fixture();
  expect(await f.deliver(subscription, payload)).toEqual({ status: 'accepted' });
  expect(f.send).toHaveBeenCalledWith(subscription, JSON.stringify(payload), {
    vapidDetails: {
      subject: 'mailto:admin@example.test',
      publicKey: credentials.publicKey,
      privateKey: credentials.privateKey,
    },
    TTL: 3600,
    timeout: 10000,
    urgency: 'normal',
  });
});

test.each([
  'http://fcm.googleapis.com/private',
  'https://127.0.0.1/private',
  'https://169.254.169.254/latest/meta-data',
  'https://fcm.googleapis.com.evil.example/private',
  'https://fcm.googleapis.com:8443/private',
  'https://user:secret@fcm.googleapis.com/private',
  'https://fcm.googleapis.com/private#fragment',
])('rejects unapproved destination %s without network access', async (endpoint) => {
  const f = fixture();
  expect(await f.deliver({ ...subscription, endpoint }, payload)).toEqual({ status: 'rejected' });
  expect(f.send).not.toHaveBeenCalled();
});

test.each([
  [404, 'expired'],
  [410, 'expired'],
  [429, 'retry'],
  [503, 'retry'],
  [401, 'rejected'],
  [400, 'rejected'],
])('classifies provider status %s without exposing diagnostics', async (statusCode, status) => {
  const f = fixture();
  f.send.mockRejectedValue({ statusCode, body: 'secret credential diagnostic' });
  expect(await f.deliver(subscription, payload)).toEqual({ status });
});

test('network failures produce a retry result, not a delivery claim', async () => {
  const f = fixture();
  f.send.mockRejectedValue(new Error('private subscription endpoint'));
  expect(await f.deliver(subscription, payload)).toEqual({ status: 'retry' });
});

test('disabled transport does no work and missing credentials fail at initialization', async () => {
  const f = fixture();
  const disabled = createPushTransport({
    config: pushTransportConfigSchema.parse({}),
    send: f.send,
  });
  expect(await disabled(subscription, payload)).toEqual({ status: 'disabled' });
  expect(f.send).not.toHaveBeenCalled();
  expect(() => createPushTransport({ config: f.config, send: f.send })).toThrow('VAPID');
});

test('mismatched VAPID credentials fail before any network call', () => {
  const f = fixture();
  expect(() =>
    createPushTransport({
      config: f.config,
      send: f.send,
      privateKey: webPush.generateVAPIDKeys().privateKey,
    }),
  ).toThrow('matching VAPID');
  expect(f.send).not.toHaveBeenCalled();
});

test('payloads cannot inject paths, extra fields or oversized preview content', async () => {
  const f = fixture();
  const withUrl = { ...payload, url: 'https://evil.example' };
  expect(await f.deliver(subscription, withUrl)).toEqual({ status: 'rejected' });
  expect(
    await f.deliver(
      { ...subscription, keys: { ...subscription.keys, p256dh: 'B'.repeat(87) } },
      payload,
    ),
  ).toEqual({ status: 'rejected' });
  expect(await f.deliver(subscription, { ...payload, conversationId: '../admin' })).toEqual({
    status: 'rejected',
  });
  expect(await f.deliver(subscription, { ...payload, body: 'x'.repeat(513) })).toEqual({
    status: 'rejected',
  });
  expect(
    await f.deliver({ ...subscription, keys: { ...subscription.keys, auth: 'invalid' } }, payload),
  ).toEqual({ status: 'rejected' });
  expect(f.send).not.toHaveBeenCalled();
});
