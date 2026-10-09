import { test, expect } from '@playwright/test';
import { WebSocket } from 'ws';

test('workspace: JWT owner admission, no anonymous or other-account access, and private upstream credentials', async ({
  page,
  request,
  baseURL,
}) => {
  const capability = page.waitForRequest((req) => req.url().includes('/api/workspace/config'));
  await page.goto('/c/new');
  const authorization = (await capability).headers().authorization;
  expect(authorization).toMatch(/^Bearer /);
  const owner = await request.get('/api/workspace/config', {
    headers: { Authorization: authorization },
  });
  expect(await owner.json()).toMatchObject({ enabled: true, rootPath: '/home/user' });
  expect((await owner.text()).includes('e2e-terminal-server-key')).toBe(false);
  expect((await request.get('/api/workspace/files?path=/home/user')).status()).toBe(401);
  const email = `workspace-other-${Date.now()}@example.com`;
  const password = 'workspace-public-test-password';
  const registration = await request.post('/api/auth/register', {
    data: { name: 'Other account', email, password, confirm_password: password },
  });
  expect(registration.ok()).toBe(true);
  const login = await request.post('/api/auth/login', { data: { email, password } });
  expect(login.ok()).toBe(true);
  const { token } = await login.json();
  expect(typeof token).toBe('string');
  const other = { Authorization: `Bearer ${token}` };
  expect(await (await request.get('/api/workspace/config', { headers: other })).json()).toEqual({
    enabled: false,
  });
  expect(
    (await request.get('/api/workspace/files?path=/home/user', { headers: other })).status(),
  ).toBe(403);
  expect(
    (
      await request.post('/api/workspace/terminals', {
        headers: other,
        data: { directory: '/home/user' },
      })
    ).status(),
  ).toBe(403);
  const url = new URL('/api/workspace/socket', baseURL);
  url.protocol = 'ws:';
  const socket = new WebSocket(url, { origin: baseURL });
  socket.on('error', () => {});
  const ended = new Promise<number>((resolve) => socket.once('close', resolve));
  socket.once('open', () =>
    socket.send(JSON.stringify({ type: 'auth', token, sessionId: '01234567' })),
  );
  expect(await ended).toBe(1008);
  expect(
    (
      await request.get('/api/workspace/file?path=/etc/passwd', {
        headers: { Authorization: authorization },
      })
    ).status(),
  ).toBe(400);
});
