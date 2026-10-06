const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const { test } = require('node:test');
const assert = require('node:assert/strict');

const source = fs.readFileSync(path.join(__dirname, 'push.js'), 'utf8');
const payload = {
  version: 1,
  notificationId: 'a'.repeat(64),
  conversationId: '12345678-1234-4234-8234-123456789abc',
  title: 'LibreChat',
  body: 'You have a new notification.',
};
function fixture(windows = []) {
  const handlers = new Map();
  const displayed = [];
  const opened = [];
  vm.runInNewContext(source, {
    URL,
    self: {
      addEventListener: (name, handler) => handlers.set(name, handler),
      registration: {
        scope: 'https://chat.example/app/',
        showNotification: async (title, options) => displayed.push({ title, options }),
      },
      clients: { matchAll: async () => windows, openWindow: async (url) => opened.push(url) },
    },
  });
  async function dispatch(name, properties) {
    const pending = [];
    handlers.get(name)({ ...properties, waitUntil: (promise) => pending.push(promise) });
    await Promise.all(pending);
  }
  return { displayed, opened, dispatch };
}

test('push displays a bounded notification without an open app and uses a stable retry tag', async () => {
  const f = fixture();
  await f.dispatch('push', { data: { text: () => JSON.stringify(payload) } });
  assert.equal(f.displayed.length, 1);
  assert.equal(f.displayed[0].options.tag, `librechat-${payload.notificationId}`);
  assert.equal(f.displayed[0].options.icon, 'https://chat.example/app/assets/icon-192x192.png');
  assert.equal(f.displayed[0].options.data.conversationId, payload.conversationId);
});

test('malformed, oversized, unknown-version and path-injection payloads are rejected', async () => {
  const f = fixture();
  const invalid = [
    null,
    {},
    { ...payload, version: 2 },
    { ...payload, title: '' },
    { ...payload, title: 'a'.repeat(121) },
    { ...payload, body: 'a'.repeat(513) },
    { ...payload, conversationId: '../admin' },
    { ...payload, notificationId: 'invalid' },
  ];
  for (const value of invalid)
    await f.dispatch('push', { data: { text: () => JSON.stringify(value) } });
  await f.dispatch('push', { data: { text: () => '{' } });
  await f.dispatch('push', { data: { text: () => 'a'.repeat(4097) } });
  await f.dispatch('push', {});
  assert.equal(f.displayed.length, 0);
});

test('click constructs an app-scoped URL, ignoring supplied external destinations', async () => {
  const f = fixture([
    { url: 'https://other.example/app/', focus: () => assert.fail('cross-origin focus') },
  ]);
  let closed = false;
  await f.dispatch('notificationclick', {
    notification: {
      close: () => {
        closed = true;
      },
      data: { ...payload, url: 'https://evil.example' },
    },
  });
  assert.equal(closed, true);
  assert.deepEqual(f.opened, [`https://chat.example/app/c/${payload.conversationId}`]);
});

test('click focuses an existing matching chat without navigating another active conversation', async () => {
  let focused = false;
  const f = fixture([
    {
      url: `https://chat.example/app/c/${payload.conversationId}`,
      focus: async () => {
        focused = true;
      },
    },
  ]);
  await f.dispatch('notificationclick', { notification: { close: () => {}, data: payload } });
  assert.equal(focused, true);
  assert.equal(f.opened.length, 0);
});
