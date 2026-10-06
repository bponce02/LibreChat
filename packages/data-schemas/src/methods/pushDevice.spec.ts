import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { tenantStorage, SYSTEM_TENANT_ID } from '~/config/tenantContext';
import { createPushDeviceModel } from '~/models/pushDevice';
import { createPushDeviceMethods } from './pushDevice';

const Registry = createPushDeviceModel(mongoose);
const methods = createPushDeviceMethods(mongoose);
const subscription = (id: string) => ({
  endpoint: `https://fcm.googleapis.com/fcm/send/${id}`,
  keys: { auth: 'private-auth', p256dh: 'private-key' },
});
let server: MongoMemoryServer;
beforeAll(async () => {
  server = await MongoMemoryServer.create();
  await mongoose.connect(server.getUri());
  await Registry.init();
});
afterAll(async () => {
  await mongoose.disconnect();
  await server.stop();
});
beforeEach(async () => {
  await tenantStorage.run({ tenantId: SYSTEM_TENANT_ID }, () => Registry.deleteMany({}));
});

test('concurrent distinct registrations obey the atomic owner limit', async () => {
  const results = await Promise.all(
    Array.from({ length: 15 }, (_, id) =>
      methods.registerPushDevice('owner', subscription(String(id)), 'Phone', 3),
    ),
  );
  expect(results.filter((result) => result.ok)).toHaveLength(3);
  expect(await methods.listPushDevices('owner')).toHaveLength(3);
  expect(
    results
      .filter((result) => !result.ok)
      .every((result) => !result.ok && result.error.code === 'DEVICE_LIMIT'),
  ).toBe(true);
});

test('concurrent retries use one slot and can update a label at capacity', async () => {
  const results = await Promise.all(
    Array.from({ length: 10 }, () =>
      methods.registerPushDevice('owner', subscription('one'), 'Phone', 1),
    ),
  );
  expect(results.every((result) => result.ok)).toBe(true);
  const original = (await methods.listPushDevices('owner'))[0];
  expect(
    await methods.registerPushDevice('owner', subscription('one'), 'Renamed', 1),
  ).toMatchObject({ ok: true, device: { ...original, label: 'Renamed' } });
  const list = await methods.listPushDevices('owner');
  expect(list).toHaveLength(1);
  expect(JSON.stringify(list)).not.toMatch(/private-|endpoint|subscription|keys/);
});

test('device endpoints cannot be taken over by another owner or tenant', async () => {
  const result = await methods.registerPushDevice('owner', subscription('one'), 'Phone', 5);
  if (!result.ok) throw new Error('Expected device');
  expect(await methods.registerPushDevice('other', subscription('one'), 'Other', 5)).toEqual({
    ok: false,
    error: { code: 'DEVICE_CONFLICT' },
  });
  expect(await methods.revokePushDevice('other', result.device.id)).toBe(false);
  await tenantStorage.run({ tenantId: 'tenant-a' }, async () => {
    expect(await methods.listPushDevices('owner')).toEqual([]);
    expect(
      await methods.registerPushDevice('owner', subscription('one'), 'Other tenant', 5),
    ).toEqual({ ok: false, error: { code: 'DEVICE_CONFLICT' } });
    expect(await methods.revokePushDevice('owner', result.device.id)).toBe(false);
  });
});

test('revocation frees capacity without removing other devices and empty registries coexist', async () => {
  for (const user of ['first', 'second']) {
    const result = await methods.registerPushDevice(user, subscription(user), 'Phone', 1);
    if (!result.ok) throw new Error('Expected device');
    expect(await methods.revokePushDevice(user, result.device.id)).toBe(true);
    expect(await methods.revokePushDevice(user, result.device.id)).toBe(false);
    expect(await methods.listPushDevices(user)).toEqual([]);
  }
  expect(
    await methods.registerPushDevice('first', subscription('replacement'), 'Replacement', 1),
  ).toMatchObject({ ok: true });
});

test('account cleanup stays tenant scoped and releases endpoint ownership', async () => {
  await methods.registerPushDevice('owner', subscription('one'), 'Phone', 2);
  await tenantStorage.run({ tenantId: 'tenant-a' }, () =>
    methods.registerPushDevice('owner', subscription('two'), 'Other tenant', 2),
  );
  await methods.deleteUserPushDevices('owner');
  expect(await methods.listPushDevices('owner')).toEqual([]);
  expect(
    await methods.registerPushDevice('other', subscription('one'), 'New owner', 2),
  ).toMatchObject({ ok: true });
  expect(
    await tenantStorage.run({ tenantId: 'tenant-a' }, () => methods.listPushDevices('owner')),
  ).toHaveLength(1);
});

test('system context cannot perform owner operations', async () => {
  await expect(
    tenantStorage.run({ tenantId: SYSTEM_TENANT_ID }, () => methods.listPushDevices('owner')),
  ).rejects.toThrow('owning user');
});
