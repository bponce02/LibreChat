import webPush from 'web-push';
import { expect, test } from '@playwright/test';
import type { NotificationList } from 'librechat-data-provider';
import {
  fetchJson,
  getAccessToken,
  requestJson,
  sendMessageAndWaitForCompletion,
} from '../specs/mock/helpers';
import { openAgentBuilder } from '../specs/mock/agents.helpers';

test('agent tool persists an owner-scoped notification and the inbox reads it', async ({
  page,
  context,
  baseURL,
}, testInfo) => {
  const pageErrors: string[] = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.addInitScript(() =>
    localStorage.setItem('color-theme', sessionStorage.getItem('e2e-mode') ?? 'light'),
  );
  await context.grantPermissions(['notifications'], { origin: baseURL });
  await page.addInitScript(
    (subscription) => {
      const current = () => ({
        endpoint: subscription.endpoint,
        toJSON: () => subscription,
        unsubscribe: async () => {
          sessionStorage.removeItem('e2e-push');
          return true;
        },
      });
      Object.defineProperty(PushManager.prototype, 'getSubscription', {
        value: async () => (sessionStorage.getItem('e2e-push') ? current() : null),
      });
      Object.defineProperty(PushManager.prototype, 'subscribe', {
        value: async () => {
          sessionStorage.setItem('e2e-push', 'yes');
          return current();
        },
      });
    },
    {
      endpoint: 'https://fcm.googleapis.com/fcm/send/e2e-ui',
      keys: {
        p256dh: webPush.generateVAPIDKeys().publicKey,
        auth: Buffer.alloc(16, 1).toString('base64url'),
      },
    },
  );
  await page.goto('/c/new');
  await page.evaluate(() => navigator.serviceWorker.ready.then(() => true));
  await page.getByTestId('nav-panel-notifications').click();
  await expect(page.getByText('No notifications yet.', { exact: false })).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath('empty-inbox.png'), fullPage: true });
  await page
    .getByRole('button', { name: 'Enable notifications on this device', exact: true })
    .click();
  await expect(
    page.getByRole('button', { name: 'Disable notifications on this device', exact: true }),
  ).toBeVisible();
  expect((await page.request.get('/api/notifications')).status()).toBe(401);
  const token = await getAccessToken(page);
  const agent = await requestJson<{ id: string; name: string }>(page, {
    path: '/api/agents',
    token,
    method: 'POST',
    body: {
      name: 'Notification smoke test',
      provider: 'openAI',
      model: 'gpt-4o-mini',
      tools: ['notify_user'],
      instructions: 'Send an update when the task finishes.',
    },
  });
  const form = await openAgentBuilder(page);
  await form.getByRole('combobox', { name: 'Agent', exact: true }).click();
  await page.getByRole('option', { name: agent.name }).click();
  await form.getByRole('button', { name: 'Select Agent' }).click();
  await sendMessageAndWaitForCompletion(page, 'E2E_NOTIFY_USER:inbox');
  await expect(
    page
      .getByTestId('screenshot-target')
      .getByText('E2E notification queued; push accepted', { exact: true }),
  ).toBeVisible();
  const conversationPath = new URL(page.url()).pathname;
  const inbox = await fetchJson<NotificationList>(page, '/api/notifications', token);
  expect(inbox.notifications).toHaveLength(1);
  expect(inbox.unreadCount).toBe(1);
  expect(inbox.notifications[0]).toMatchObject({
    title: 'Backup complete',
    conversationId: conversationPath.slice(3),
  });
  await page.getByTestId('nav-panel-notifications').click();
  await expect(page.getByRole('heading', { name: 'Backup complete' })).toBeVisible();
  await expect(page.getByText('1 unread', { exact: true })).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath('desktop-inbox.png'), fullPage: true });
  await page.getByRole('button', { name: 'Mark as read', exact: true }).click();
  await expect(page.getByText('0 unread', { exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Backup complete' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Mark as read' })).toHaveCount(0);
  await page.getByRole('link', { name: 'Open chat' }).click();
  await expect(page).toHaveURL(new RegExp(conversationPath));
  await testInfo.attach('page-url', { body: page.url(), contentType: 'text/plain' });
  console.info('Notification inbox source URL:', page.url());
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole('button', { name: 'Open sidebar', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Backup complete' })).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath('mobile-inbox.png'), fullPage: true });
  await page.evaluate(() => sessionStorage.setItem('e2e-mode', 'dark'));
  await page.reload();
  await page.getByRole('button', { name: 'Open sidebar', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Backup complete' })).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath('mobile-dark-inbox.png'), fullPage: true });
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Backup complete' })).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath('desktop-dark-inbox.png'), fullPage: true });
  await page.route('**/api/notifications', (route) =>
    route.fulfill({
      status: 503,
      contentType: 'application/json',
      body: JSON.stringify({ error: { code: 'NOTIFICATION_UNAVAILABLE' } }),
    }),
  );
  await page.reload();
  await expect(page.getByText('Notifications could not be loaded.')).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath('error-inbox.png'), fullPage: true });
  await page.unroute('**/api/notifications');
  await page.getByRole('button', { name: 'Retry', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Backup complete' })).toBeVisible();
  await page
    .getByRole('button', { name: 'Disable notifications on this device', exact: true })
    .click();
  await expect(
    page.getByRole('button', { name: 'Enable notifications on this device', exact: true }),
  ).toBeVisible();
  await page.reload();
  await expect(
    page.getByRole('button', { name: 'Enable notifications on this device', exact: true }),
  ).toBeVisible();
  await context.clearPermissions();
  await context.grantPermissions([], { origin: baseURL });
  await page.reload();
  expect(await page.evaluate(() => Notification.permission)).toBe('denied');
  await page
    .getByRole('button', { name: 'Enable notifications on this device', exact: true })
    .click();
  await expect(page.getByText('Notifications are blocked.', { exact: false })).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath('permission-blocked.png'), fullPage: true });
  expect(pageErrors).toEqual([]);
});
