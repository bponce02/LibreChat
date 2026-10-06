import webPush from 'web-push';
import { expect, test } from '@playwright/test';
import type { NotificationPushDevice } from 'librechat-data-provider';
import { fetchJson, getAccessToken, requestJson } from '../specs/mock/helpers';

test('authenticated device registration, metadata listing and revocation use the real API', async ({
  page,
}) => {
  await page.goto('/c/new');
  const token = await getAccessToken(page);
  const subscription = {
    endpoint: 'https://fcm.googleapis.com/fcm/send/e2e-registration-only',
    expirationTime: null,
    keys: {
      p256dh: webPush.generateVAPIDKeys().publicKey,
      auth: Buffer.alloc(16, 2).toString('base64url'),
    },
  };
  const body = { label: 'Browser test device', subscription };
  expect((await page.request.post('/api/notifications/devices', { data: body })).status()).toBe(
    401,
  );
  const registered = await requestJson<{ ok: true; device: NotificationPushDevice }>(page, {
    path: '/api/notifications/devices',
    token,
    method: 'POST',
    body,
  });
  expect(registered.ok).toBe(true);
  expect(registered.device.label).toBe(body.label);
  const devices = await fetchJson<{ devices: NotificationPushDevice[] }>(
    page,
    '/api/notifications/devices',
    token,
  );
  expect(devices.devices).toContainEqual(registered.device);
  expect(JSON.stringify(devices)).not.toContain(subscription.endpoint);
  expect(JSON.stringify(devices)).not.toContain(subscription.keys.auth);
  for (let attempt = 0; attempt < 2; attempt++) {
    expect(
      await requestJson(page, {
        path: `/api/notifications/devices/${registered.device.id}`,
        token,
        method: 'DELETE',
      }),
    ).toEqual({ ok: true });
  }
  expect(
    (
      await fetchJson<{ devices: NotificationPushDevice[] }>(
        page,
        '/api/notifications/devices',
        token,
      )
    ).devices,
  ).not.toContainEqual(registered.device);
});
