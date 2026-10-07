import { ObjectId } from 'mongodb';
import { expect, test } from '@playwright/test';
import type { PiSnapshot } from 'librechat-data-provider';
import { withMongo } from '../specs/mock/db';
import { getAccessToken, requestJson } from '../specs/mock/helpers';
import { getE2EUser } from '../setup/user';
import { login } from '../setup/authenticate';

const key = 'e2e-pi-sync-key-not-a-real-secret-123456789';
test('native Pi import, live history refresh and binding protections', async ({ page }, info) => {
  const user = { ...getE2EUser(), email: 'pi-browser@example.com' };
  await withMongo(async (db) => {
    const original = await db.collection('users').findOne({ email: getE2EUser().email });
    if (!original) throw new Error('Missing isolated test user');
    await db.collection('users').insertOne({
      ...original,
      _id: new ObjectId('0123456789abcdef01234567'),
      email: user.email,
      username: 'pi-browser',
    });
  });
  const snapshot: PiSnapshot = {
    sessionId: 'browser-test',
    cwd: '/projects/homelab/worktree',
    title: 'Native Pi session',
    leafId: 'reply-one',
    messages: [
      {
        entryId: 'question-one',
        role: 'user',
        text: 'Check the homelab backup',
        timestamp: new Date().toISOString(),
      },
      {
        entryId: 'reply-one',
        role: 'assistant',
        text: 'The backup is healthy.',
        timestamp: new Date().toISOString(),
      },
    ],
  };
  expect((await page.request.post('/api/pi-sync', { data: snapshot })).status()).toBe(401);
  const sync = () =>
    page.request.post('/api/pi-sync', {
      headers: { Authorization: `Bearer ${key}` },
      data: snapshot,
    });
  const imported = await sync();
  expect(imported.status()).toBe(200);
  const link = (await imported.json()) as { conversationId: string; projectId: string };
  expect((await sync()).status()).toBe(200);
  await page.context().clearCookies();
  await page.goto('/login');
  await login(page, user);
  await page.waitForURL('**/c/new');
  await page.goto(`/c/${link.conversationId}`);
  await expect(page.getByText('The backup is healthy.', { exact: true })).toBeVisible();
  await expect(page.getByRole('status').filter({ hasText: 'Linked to Pi' })).toBeVisible();
  const token = await getAccessToken(page);
  const rejected = await page.request.post('/api/agents/chat/Local%20Pi', {
    headers: { Authorization: `Bearer ${token}` },
    data: {
      conversationId: link.conversationId,
      endpoint: 'Local Pi',
      model: 'pi/session-browser-test',
      parentMessageId: 'stale',
      text: 'hello',
    },
  });
  expect(rejected.status()).toBe(409);
  expect((await rejected.json()).error.code).toBe('PI_HISTORY_STALE');
  snapshot.messages.push(
    {
      entryId: 'question-two',
      role: 'user',
      text: 'And the database?',
      timestamp: new Date().toISOString(),
    },
    {
      entryId: 'reply-two',
      role: 'assistant',
      text: 'Database checks passed from the terminal.',
      timestamp: new Date().toISOString(),
    },
  );
  snapshot.leafId = 'reply-two';
  expect((await sync()).status()).toBe(200);
  await expect(
    page.getByText('Database checks passed from the terminal.', { exact: true }),
  ).toBeVisible({ timeout: 20000 });
  const messages = await requestJson<Array<{ messageId: string }>>(page, {
    path: `/api/messages/${link.conversationId}`,
    token,
    method: 'GET',
  });
  expect(messages).toHaveLength(4);
  const edit = await page.request.put(
    `/api/messages/${link.conversationId}/${messages[0].messageId}`,
    { headers: { Authorization: `Bearer ${token}` }, data: { text: 'changed' } },
  );
  expect(edit.status()).toBe(409);
  await info.attach('page-url', { body: page.url(), contentType: 'text/plain' });
  console.info('Pi sync source URL:', page.url());
  for (const theme of ['light', 'dark']) {
    await page.evaluate((value) => localStorage.setItem('color-theme', value), theme);
    await page.reload();
    await expect(
      page.getByText('Database checks passed from the terminal.', { exact: true }),
    ).toBeVisible();
    for (const viewport of [
      { width: 1440, height: 900 },
      { width: 390, height: 844 },
    ]) {
      await page.setViewportSize(viewport);
      await page.screenshot({
        path: info.outputPath(`${theme}-${viewport.width}.png`),
        fullPage: true,
      });
    }
  }
});
