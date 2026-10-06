import express from 'express';
import request from 'supertest';
import { createNotificationHandlers } from './handlers';

function fixture(enabled = true) {
  const listNotifications = jest.fn().mockResolvedValue({ notifications: [], unreadCount: 0 });
  const readNotification = jest.fn().mockResolvedValue(true);
  const handlers = createNotificationHandlers({ listNotifications, readNotification });
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    Object.defineProperty(req, 'user', { value: { id: 'owner' } });
    Object.defineProperty(req, 'config', { value: { notifications: { enabled } } });
    next();
  });
  app.get('/config', handlers.config);
  app.get('/', handlers.list);
  app.patch('/:id/read', handlers.read);
  return { app, listNotifications, readNotification };
}

test('reads are scoped to the authenticated owner, not query parameters', async () => {
  const f = fixture();
  await request(f.app).get('/?userId=victim&limit=100000').expect(200);
  expect(f.listNotifications).toHaveBeenCalledWith('owner', 50);
  await request(f.app)
    .patch(`/${'a'.repeat(64)}/read`)
    .send({ userId: 'victim' })
    .expect(200);
  expect(f.readNotification).toHaveBeenCalledWith('owner', 'a'.repeat(64));
});

test('disabled inbox never queries notification storage', async () => {
  const f = fixture(false);
  await request(f.app).get('/').expect(403);
  await request(f.app)
    .patch(`/${'a'.repeat(64)}/read`)
    .expect(403);
  const config = await request(f.app).get('/config').expect(200);
  expect(config.body.enabled).toBe(false);
  expect(f.listNotifications).not.toHaveBeenCalled();
  expect(f.readNotification).not.toHaveBeenCalled();
});

test('invalid and unknown notification IDs produce explicit errors', async () => {
  const f = fixture();
  await request(f.app).patch('/invalid/read').expect(400);
  expect(f.readNotification).not.toHaveBeenCalled();
  f.readNotification.mockResolvedValue(false);
  await request(f.app)
    .patch(`/${'a'.repeat(64)}/read`)
    .expect(404);
});

test('storage failures are not empty inboxes and do not leak diagnostics', async () => {
  const f = fixture();
  f.listNotifications.mockRejectedValue(new Error('private database credentials'));
  const response = await request(f.app).get('/').expect(503);
  expect(response.body).toEqual({ error: { code: 'NOTIFICATION_UNAVAILABLE' } });
});
