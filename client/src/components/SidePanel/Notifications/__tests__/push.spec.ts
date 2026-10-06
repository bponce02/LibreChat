import { webcrypto, createHash } from 'node:crypto';
import { dataService } from 'librechat-data-provider';
import { readPushState, setDevicePush } from '../push';

jest.mock('librechat-data-provider', () => {
  const actual = jest.requireActual('librechat-data-provider');
  return { ...actual, dataService: { ...actual.dataService } };
});
const originalCrypto = Object.getOwnPropertyDescriptor(globalThis, 'crypto');
const originalNotification = Object.getOwnPropertyDescriptor(globalThis, 'Notification');
const originalWorker = Object.getOwnPropertyDescriptor(navigator, 'serviceWorker');
const endpoint = 'https://fcm.googleapis.com/fcm/send/device';
const id = createHash('sha256').update(endpoint).digest('hex');
const permission = jest.fn();
const unsubscribe = jest.fn();
const subscribe = jest.fn();
const getSubscription = jest.fn();
const subscription = {
  endpoint,
  unsubscribe,
  toJSON: () => ({ endpoint, keys: { auth: 'auth', p256dh: 'key' } }),
};

beforeEach(() => {
  Object.defineProperty(globalThis, 'crypto', { configurable: true, value: webcrypto });
  Object.defineProperty(globalThis, 'Notification', {
    configurable: true,
    value: { permission: 'granted', requestPermission: permission },
  });
  Object.defineProperty(navigator, 'serviceWorker', {
    configurable: true,
    value: {
      getRegistration: async () => ({ active: {}, pushManager: { getSubscription, subscribe } }),
    },
  });
  permission.mockResolvedValue('granted');
  unsubscribe.mockResolvedValue(true);
  getSubscription.mockResolvedValue(null);
  subscribe.mockResolvedValue(subscription);
  jest.spyOn(dataService, 'registerPushDevice').mockResolvedValue({
    ok: true,
    device: { id, label: 'Phone', createdAt: '2026-01-01T00:00:00Z' },
  });
  jest.spyOn(dataService, 'revokePushDevice').mockResolvedValue({ ok: true });
  jest
    .spyOn(dataService, 'listPushDevices')
    .mockResolvedValue({ devices: [{ id, label: 'Phone', createdAt: '2026-01-01T00:00:00Z' }] });
});
afterEach(() => {
  jest.restoreAllMocks();
  jest.clearAllMocks();
  for (const [target, key, descriptor] of [
    [globalThis, 'crypto', originalCrypto],
    [globalThis, 'Notification', originalNotification],
    [navigator, 'serviceWorker', originalWorker],
  ] as const) {
    if (descriptor) Object.defineProperty(target, key, descriptor);
    else Reflect.deleteProperty(target, key);
  }
});

test('enable requests permission, subscribes and registers; reload state comes from browser and server', async () => {
  await setDevicePush(true, 'AQID', 'Phone');
  expect(permission).toHaveBeenCalledTimes(1);
  expect(subscribe).toHaveBeenCalledWith({
    userVisibleOnly: true,
    applicationServerKey: expect.any(Uint8Array),
  });
  expect(dataService.registerPushDevice).toHaveBeenCalledWith({
    label: 'Phone',
    subscription: subscription.toJSON(),
  });
  getSubscription.mockResolvedValue(subscription);
  expect(await readPushState()).toBe(true);
});

test('denied permission never subscribes or writes to the server', async () => {
  permission.mockResolvedValue('denied');
  await expect(setDevicePush(true, 'AQID', 'Phone')).rejects.toThrow('PERMISSION_DENIED');
  expect(subscribe).not.toHaveBeenCalled();
  expect(dataService.registerPushDevice).not.toHaveBeenCalled();
});

test('registration failure removes the new browser subscription', async () => {
  jest.mocked(dataService.registerPushDevice).mockRejectedValue(new Error('unavailable'));
  await expect(setDevicePush(true, 'AQID', 'Phone')).rejects.toThrow('unavailable');
  expect(unsubscribe).toHaveBeenCalledTimes(1);
});

test('disable removes the server entry and browser subscription without prompting', async () => {
  getSubscription.mockResolvedValue(subscription);
  await setDevicePush(false, '', 'Phone');
  expect(dataService.revokePushDevice).toHaveBeenCalledWith(id);
  expect(unsubscribe).toHaveBeenCalledTimes(1);
  expect(permission).not.toHaveBeenCalled();
});
