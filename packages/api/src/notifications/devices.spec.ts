import express from 'express';
import webPush from 'web-push';
import request from 'supertest';
import { createPushDeviceHandlers } from './devices';

const vapid = webPush.generateVAPIDKeys();
const subscription = {
  endpoint: 'https://fcm.googleapis.com/fcm/send/test-device',
  expirationTime: null,
  keys: {
    p256dh: webPush.generateVAPIDKeys().publicKey,
    auth: Buffer.alloc(16, 1).toString('base64url'),
  },
};
const device = { id: 'a'.repeat(64), label: 'Phone', createdAt: '2026-01-01T00:00:00Z' };
function fixture({ enabled = true, owner = 'owner' } = {}) {
  const registerPushDevice = jest.fn().mockResolvedValue(device);
  const listPushDevices = jest.fn().mockResolvedValue([device]);
  const revokePushDevice = jest.fn().mockResolvedValue(true);
  const handlers = createPushDeviceHandlers({
    pushPrivateKey: vapid.privateKey,
    registerPushDevice,
    listPushDevices,
    revokePushDevice,
  });
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    Object.defineProperty(req, 'user', { value: { id: owner } });
    Object.defineProperty(req, 'config', {
      value: {
        notifications: {
          enabled,
          push: { enabled, publicKey: vapid.publicKey, subject: 'mailto:test@example.test' },
        },
      },
    });
    next();
  });
  app.post('/', handlers.register);
  app.get('/', handlers.list);
  app.delete('/:id', handlers.revoke);
  return { app, registerPushDevice, listPushDevices, revokePushDevice };
}

test('standard browser subscription JSON is normalized and bound to the authenticated owner', async () => {
  const f = fixture();
  const response = await request(f.app)
    .post('/?userId=victim')
    .send({ label: ' Phone ', subscription })
    .expect(200);
  expect(response.body).toEqual({ ok: true, device });
  expect(f.registerPushDevice).toHaveBeenCalledWith(
    'owner',
    { endpoint: subscription.endpoint, keys: subscription.keys },
    'Phone',
  );
});

test('registration rejects extra recipients, invalid curve keys and internal endpoints before storage', async () => {
  const f = fixture();
  await request(f.app)
    .post('/')
    .send({ userId: 'victim', label: 'Phone', subscription })
    .expect(400);
  await request(f.app)
    .post('/')
    .send({
      label: 'Phone',
      subscription: { ...subscription, endpoint: 'https://127.0.0.1/secrets' },
    })
    .expect(400);
  await request(f.app)
    .post('/')
    .send({
      label: 'Phone',
      subscription: { ...subscription, keys: { ...subscription.keys, p256dh: 'B'.repeat(87) } },
    })
    .expect(400);
  expect(f.registerPushDevice).not.toHaveBeenCalled();
});

test('disabled registration still allows listing and revoking existing devices', async () => {
  const f = fixture({ enabled: false });
  await request(f.app).post('/').send({ label: 'Phone', subscription }).expect(403);
  await request(f.app).get('/?userId=victim').expect(200);
  await request(f.app).delete(`/${device.id}`).expect(200);
  expect(f.registerPushDevice).not.toHaveBeenCalled();
  expect(f.listPushDevices).toHaveBeenCalledWith('owner');
  expect(f.revokePushDevice).toHaveBeenCalledWith('owner', device.id);
});

test('unauthenticated handlers never access device storage', async () => {
  const f = fixture({ owner: '' });
  await request(f.app).get('/').expect(401);
  await request(f.app).post('/').send({ label: 'Phone', subscription }).expect(401);
  await request(f.app).delete(`/${device.id}`).expect(401);
  expect(f.registerPushDevice).not.toHaveBeenCalled();
  expect(f.listPushDevices).not.toHaveBeenCalled();
  expect(f.revokePushDevice).not.toHaveBeenCalled();
});

test('revoke validates IDs and does not disclose existence outside the owner scope', async () => {
  const f = fixture();
  await request(f.app).delete('/invalid').expect(400);
  expect(f.revokePushDevice).not.toHaveBeenCalled();
  f.revokePushDevice.mockResolvedValue(false);
  const response = await request(f.app).delete(`/${device.id}`).expect(200);
  expect(response.body).toEqual({ ok: true });
});

test('storage outages expose only safe errors', async () => {
  const f = fixture();
  f.registerPushDevice.mockRejectedValue(new Error('private endpoint and keys'));
  const outage = await request(f.app).post('/').send({ label: 'Phone', subscription }).expect(503);
  expect(outage.body).toEqual({ error: { code: 'NOTIFICATION_UNAVAILABLE' } });
});
