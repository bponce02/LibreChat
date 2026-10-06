import { expect, test } from '@playwright/test';

declare const registration: ServiceWorkerRegistration;

// This exercises the real production worker and Notification API, not a push provider or OS install.
test('production worker handles a push payload with all app windows closed', async ({
  page,
  context,
  baseURL,
}) => {
  await context.grantPermissions(['notifications'], { origin: baseURL });
  await page.goto('/c/new');
  await page.evaluate(async () => {
    await navigator.serviceWorker.register('/sw.js');
    await navigator.serviceWorker.ready;
  });
  const worker = context
    .serviceWorkers()
    .find((candidate) => new URL(candidate.url()).pathname === '/sw.js');
  expect(worker).toBeDefined();
  expect(await page.evaluate(() => Notification.permission)).toBe('granted');
  await page.close();
  expect(context.pages()).toHaveLength(0);
  const notifications = await worker!.evaluate(async () => {
    const payload = {
      version: 1,
      notificationId: 'b'.repeat(64),
      conversationId: '12345678-1234-4234-8234-123456789abc',
      title: 'LibreChat',
      body: 'You have a new notification.',
    };
    const pending: Promise<void>[] = [];
    const event = new Event('push');
    Object.defineProperties(event, {
      data: { value: { text: () => JSON.stringify(payload) } },
      waitUntil: { value: (promise: Promise<void>) => pending.push(promise) },
    });
    self.dispatchEvent(event);
    await Promise.all(pending);
    const shown = await registration.getNotifications();
    const result = shown.map((notification) => ({
      title: notification.title,
      body: notification.body,
      tag: notification.tag,
    }));
    shown.forEach((notification) => notification.close());
    return result;
  });
  expect(notifications).toEqual([
    {
      title: 'LibreChat',
      body: 'You have a new notification.',
      tag: `librechat-${'b'.repeat(64)}`,
    },
  ]);
});
