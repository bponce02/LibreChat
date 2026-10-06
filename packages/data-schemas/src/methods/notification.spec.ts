import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { createNotificationModel, createNotificationQuotaModel } from '~/models/notification';
import { createNotificationMethods } from './notification';
import { tenantStorage } from '~/config/tenantContext';

let server: MongoMemoryServer;
const Notification = createNotificationModel(mongoose);
const Quota = createNotificationQuotaModel(mongoose);
const methods = createNotificationMethods(mongoose);
const context = { userId: 'owner', conversationId: 'chat', toolCallId: 'call' };
const input = { title: 'Backup', body: 'Finished successfully' };

beforeAll(async () => {
  server = await MongoMemoryServer.create();
  await mongoose.connect(server.getUri());
  await Promise.all([Notification.init(), Quota.init()]);
});
afterAll(async () => {
  await mongoose.disconnect();
  await server.stop();
});
beforeEach(async () => {
  await Promise.all([Notification.deleteMany({}), Quota.deleteMany({})]);
});

test('concurrent retry persists one notification and charges one quota slot', async () => {
  const results = await Promise.all(
    Array.from({ length: 10 }, () => methods.enqueueNotification(context, input, 1)),
  );
  expect(results.every((result) => result.ok)).toBe(true);
  expect(await Notification.countDocuments()).toBe(1);
  expect((await Quota.findOne().lean())?.keys).toHaveLength(1);
  expect((await methods.listNotifications('owner', 10)).unreadCount).toBe(1);
});

test('quota bounds concurrent distinct events and replays accepted events at capacity', async () => {
  const results = await Promise.all(
    Array.from({ length: 12 }, (_, index) =>
      methods.enqueueNotification({ ...context, toolCallId: `call-${index}` }, input, 3),
    ),
  );
  expect(results.filter((result) => result.ok)).toHaveLength(3);
  expect(await Notification.countDocuments()).toBe(3);
  const firstAccepted = results.findIndex((result) => result.ok);
  expect(
    await methods.enqueueNotification(
      { ...context, toolCallId: `call-${firstAccepted}` },
      input,
      3,
    ),
  ).toMatchObject({ ok: true, duplicate: true });
});

test('different content cannot replace an accepted tool call', async () => {
  await methods.enqueueNotification(context, input, 3);
  expect(await methods.enqueueNotification(context, { ...input, body: 'Changed' }, 3)).toEqual({
    ok: false,
    error: { code: 'IDEMPOTENCY_CONFLICT' },
  });
  expect((await methods.listNotifications('owner', 10)).notifications[0].body).toBe(input.body);
});

test('listing and marking read are owner scoped and idempotent', async () => {
  const result = await methods.enqueueNotification(context, input, 3);
  if (!result.ok) throw new Error('Expected stored notification');
  expect(await methods.listNotifications('other', 10)).toEqual({
    notifications: [],
    unreadCount: 0,
  });
  expect(await methods.readNotification('other', result.notificationId)).toBe(false);
  expect(await methods.readNotification('owner', result.notificationId)).toBe(true);
  const first = await methods.listNotifications('owner', 10);
  expect(first.unreadCount).toBe(0);
  expect(await methods.readNotification('owner', result.notificationId)).toBe(true);
  expect(await methods.listNotifications('owner', 10)).toEqual(first);
});

test('unread entries remain reachable when the inbox exceeds its page size', async () => {
  await methods.enqueueNotification(context, input, 3);
  const newer = await methods.enqueueNotification({ ...context, toolCallId: 'newer' }, input, 3);
  if (!newer.ok) throw new Error('Expected stored notification');
  await methods.readNotification('owner', newer.notificationId);
  const page = await methods.listNotifications('owner', 1);
  expect(page.notifications).toHaveLength(1);
  expect(page.notifications[0].readAt).toBeNull();
  expect(page.unreadCount).toBe(1);
});

test('same user and tool IDs stay isolated between tenants', async () => {
  for (const tenantId of ['tenant-a', 'tenant-b']) {
    await tenantStorage.run({ tenantId }, async () => {
      expect(await methods.enqueueNotification({ ...context, tenantId }, input, 1)).toMatchObject({
        ok: true,
        duplicate: false,
      });
      expect((await methods.listNotifications('owner', 10)).notifications).toHaveLength(1);
    });
  }
  expect((await methods.listNotifications('owner', 10)).notifications).toHaveLength(0);
  await expect(
    tenantStorage.run({ tenantId: 'tenant-a' }, async () =>
      methods.enqueueNotification({ ...context, tenantId: 'tenant-b' }, input, 1),
    ),
  ).rejects.toThrow('tenant context');
});

test('account cleanup removes inbox and quotas only for its owner', async () => {
  await methods.enqueueNotification(context, input, 1);
  await methods.enqueueNotification({ ...context, userId: 'other' }, input, 1);
  await methods.deleteUserNotifications('owner');
  expect((await methods.listNotifications('owner', 10)).notifications).toHaveLength(0);
  expect((await methods.listNotifications('other', 10)).notifications).toHaveLength(1);
  expect(await Quota.countDocuments({ userId: 'owner' })).toBe(0);
});
