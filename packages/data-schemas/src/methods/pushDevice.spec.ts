import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { createPushDeviceModel } from '~/models/pushDevice';
import { createPushDeviceMethods } from './pushDevice';

const Device = createPushDeviceModel(mongoose);
const methods = createPushDeviceMethods(mongoose);
const subscription = {
  endpoint: 'https://fcm.googleapis.com/fcm/send/device',
  keys: { auth: 'private-auth', p256dh: 'private-key' },
};
let server: MongoMemoryServer;
beforeAll(async () => {
  server = await MongoMemoryServer.create();
  await mongoose.connect(server.getUri());
  await Device.init();
});
afterAll(async () => {
  await mongoose.disconnect();
  await server.stop();
});
beforeEach(async () => {
  await Device.deleteMany({});
});

test('saving a device is idempotent and public listings contain no credentials', async () => {
  const original = await methods.registerPushDevice('owner', subscription, 'Phone');
  expect(await methods.registerPushDevice('owner', subscription, 'Renamed')).toEqual({
    ...original,
    label: 'Renamed',
  });
  expect(await methods.listPushDevices('owner')).toEqual([{ ...original, label: 'Renamed' }]);
  expect(await methods.getPushSubscriptions('owner')).toEqual([{ id: original.id, subscription }]);
});

test('only the owner can list, send to or revoke their device', async () => {
  const device = await methods.registerPushDevice('owner', subscription, 'Phone');
  expect(await methods.listPushDevices('other')).toEqual([]);
  expect(await methods.getPushSubscriptions('other')).toEqual([]);
  expect(await methods.revokePushDevice('other', device.id)).toBe(false);
  expect(await methods.revokePushDevice('owner', device.id)).toBe(true);
  expect(await methods.revokePushDevice('owner', device.id)).toBe(false);
  expect(await methods.getPushSubscriptions('owner')).toEqual([]);
});

test('account deletion removes its subscriptions', async () => {
  await methods.registerPushDevice('owner', subscription, 'Phone');
  await methods.deleteUserPushDevices('owner');
  expect(await methods.getPushSubscriptions('owner')).toEqual([]);
});
