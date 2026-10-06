import webPush from 'web-push';
import { createNotificationTool } from './tool';

const vapid = webPush.generateVAPIDKeys();
const subscription = {
  endpoint: 'https://fcm.googleapis.com/fcm/send/test',
  keys: {
    p256dh: webPush.generateVAPIDKeys().publicKey,
    auth: Buffer.alloc(16, 1).toString('base64url'),
  },
};
const conversationId = '12345678-1234-4234-8234-123456789abc';
const call = {
  type: 'tool_call' as const,
  id: 'call',
  name: 'notify_user',
  args: { title: 'Backup complete', body: 'Everything finished.' },
};
function fixture() {
  const send = jest.fn().mockImplementation(async (device, payload, options) => {
    const encrypted = webPush.generateRequestDetails(device, payload, options);
    expect(encrypted.headers['Content-Encoding']).toBe('aes128gcm');
    expect(encrypted.body).not.toBeNull();
    expect(String(encrypted.body)).not.toContain('Everything finished.');
    return { statusCode: 201, headers: {}, body: '' };
  });
  const getPushSubscriptions = jest.fn().mockResolvedValue([{ id: 'device', subscription }]);
  const revokePushDevice = jest.fn().mockResolvedValue(true);
  const enqueue = jest.fn().mockResolvedValue({
    ok: true,
    notificationId: 'a'.repeat(64),
    duplicate: false,
    status: 'queued',
  });
  const tool = createNotificationTool({
    userId: 'owner',
    conversationId,
    config: {
      enabled: true,
      push: {
        enabled: true,
        publicKey: vapid.publicKey,
        subject: 'mailto:test@example.test',
        allowedOrigins: ['https://fcm.googleapis.com'],
        ttlSeconds: 3600,
        timeoutMs: 10000,
      },
    },
    getConversation: jest.fn().mockResolvedValue({ conversationId }),
    enqueue,
    push: { send, getPushSubscriptions, revokePushDevice, privateKey: vapid.privateKey },
  })!;
  return { tool, send, getPushSubscriptions, revokePushDevice, enqueue };
}

test('notify_user stores its inbox entry and immediately submits encrypted push', async () => {
  const f = fixture();
  const result = await f.tool.invoke(call);
  expect(JSON.parse(String(result.content))).toMatchObject({
    ok: true,
    status: 'queued',
    push: { accepted: 1, failed: 0 },
  });
  expect(f.getPushSubscriptions).toHaveBeenCalledWith('owner');
  expect(f.send).toHaveBeenCalledWith(
    subscription,
    JSON.stringify({ version: 1, notificationId: 'a'.repeat(64), conversationId, ...call.args }),
    expect.any(Object),
  );
});

test('push failure does not lose the inbox entry or start retries', async () => {
  const f = fixture();
  f.send.mockRejectedValue(new Error('private credentials'));
  const result = await f.tool.invoke(call);
  expect(JSON.parse(String(result.content))).toMatchObject({
    ok: true,
    push: { accepted: 0, failed: 1 },
  });
  expect(f.send).toHaveBeenCalledTimes(1);
  expect(String(result.content)).not.toContain('private');
});

test('expired subscriptions are removed', async () => {
  const f = fixture();
  f.send.mockRejectedValue({ statusCode: 410 });
  await f.tool.invoke(call);
  expect(f.revokePushDevice).toHaveBeenCalledWith('owner', 'device');
});

test('replayed notification tool calls do not send another push', async () => {
  const f = fixture();
  f.enqueue.mockResolvedValue({
    ok: true,
    notificationId: 'a'.repeat(64),
    duplicate: true,
    status: 'queued',
  });
  await f.tool.invoke(call);
  expect(f.send).not.toHaveBeenCalled();
});
