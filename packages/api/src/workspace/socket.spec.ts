import express from 'express';
import { createServer } from 'node:http';
import { WebSocket, WebSocketServer } from 'ws';
import { setTimeout as delay } from 'node:timers/promises';
import { workspaceConfigSchema } from 'librechat-data-provider';
import type { AppConfig } from '@librechat/data-schemas';
import type { RawData } from 'ws';
import { createWorkspaceService } from './socket';

function message(
  socket: WebSocket,
  predicate: (data: Buffer, binary: boolean) => boolean,
): Promise<Buffer> {
  return new Promise((resolve) => {
    const receive = (raw: RawData, binary: boolean) => {
      const data = Buffer.from(raw as Uint8Array);
      if (predicate(data, binary)) {
        socket.off('message', receive);
        resolve(data);
      }
    };
    socket.on('message', receive);
  });
}
function closed(socket: WebSocket): Promise<number> {
  return new Promise((resolve) => socket.once('close', (code) => resolve(code)));
}

async function fixture() {
  const nativeRequests: { method: string; authorization?: string; scope?: string; url?: string }[] =
    [];
  const nativeFrames: { data: Buffer; binary: boolean }[] = [];
  let active = true;
  let authorized = true;
  let enabled = true;
  const native = createServer((req, res) => {
    nativeRequests.push({
      method: req.method!,
      authorization: req.headers.authorization,
      scope: req.headers['x-session-id'] as string,
      url: req.url,
    });
    res.setHeader('Content-Type', 'application/json');
    if (req.headers.authorization !== 'Bearer server-only-key') {
      res.statusCode = 401;
      res.end('{}');
      return;
    }
    if (req.method === 'DELETE') {
      active = false;
      res.end('{}');
      return;
    }
    if (req.url === '/api/terminals') {
      if (req.method === 'POST') {
        active = true;
        res.end('{"id":"01234567"}');
      } else res.end(active ? '[{"id":"01234567"}]' : '[]');
    } else if (req.url === '/files/cwd') res.end('{}');
    else if (active && req.url === '/api/terminals/01234567') res.end('{"id":"01234567"}');
    else {
      res.statusCode = 404;
      res.end('{}');
    }
  });
  const nativeSockets = new WebSocketServer({ server: native });
  nativeSockets.on('connection', (socket) => {
    socket.on('message', (raw, binary) => {
      const data = Buffer.from(raw as Uint8Array);
      nativeFrames.push({ data, binary });
      if (binary) socket.send(data, { binary: true });
    });
  });
  await new Promise<void>((resolve) => native.listen(0, '127.0.0.1', resolve));
  const address = native.address();
  if (!address || typeof address === 'string') throw new Error('Missing address');
  const policy = workspaceConfigSchema.parse({
    enabled: true,
    ownerId: 'owner',
    baseUrl: `http://127.0.0.1:${address.port}`,
    connectTimeoutMs: 1000,
    reauthIntervalMs: 10000,
  });
  const config = () => ({ workspace: { ...policy, enabled } }) as AppConfig;
  const service = createWorkspaceService({
    apiKey: 'server-only-key',
    fetch: globalThis.fetch,
    Socket: WebSocket,
    SocketServer: WebSocketServer,
    origin: 'http://client',
    getConfig: async () => config(),
    authenticate: (_strategy, _options, callback) => (req, _res, _next) => {
      const token = req.headers.authorization;
      if (authorized && (token === 'Bearer owner-token' || token === 'Bearer renewed-token'))
        callback(null, { id: 'owner' });
      else if (token === 'Bearer other-token') callback(null, { id: 'other' });
      else callback(null, false);
    },
  });
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    Object.assign(req, { user: { id: 'owner' }, config: config() });
    next();
  });
  app.get('/config', service.handlers.config);
  app.post('/terminals', service.handlers.create);
  const proxy = createServer(app);
  await service.attach(proxy);
  await new Promise<void>((resolve) => proxy.listen(0, '127.0.0.1', resolve));
  const proxyAddress = proxy.address();
  if (!proxyAddress || typeof proxyAddress === 'string') throw new Error('Missing address');
  const http = `http://127.0.0.1:${proxyAddress.port}`;
  const url = `ws://127.0.0.1:${proxyAddress.port}/api/workspace/socket`;
  const clients: WebSocket[] = [];
  const connect = async (origin = 'http://client') => {
    const socket = new WebSocket(url, { origin });
    clients.push(socket);
    socket.on('error', () => {});
    await new Promise<void>((resolve, reject) => {
      socket.once('open', resolve);
      socket.once('error', reject);
    });
    return socket;
  };
  const ready = async () => {
    const socket = await connect();
    const response = message(socket, (_data, binary) => !binary);
    socket.send(JSON.stringify({ type: 'auth', token: 'owner-token', sessionId: '01234567' }));
    expect(JSON.parse((await response).toString())).toEqual({ type: 'ready' });
    return socket;
  };
  return {
    http,
    url,
    connect,
    ready,
    nativeFrames,
    nativeRequests,
    revoke: () => {
      authorized = false;
    },
    disable: () => {
      enabled = false;
    },
    reset: () => {
      active = false;
    },
    isActive: () => active,
    shutdown: async () => {
      for (const socket of clients) socket.terminate();
      await delay(30);
      for (const socket of nativeSockets.clients) socket.terminate();
      nativeSockets.close();
      await Promise.all([
        new Promise<void>((resolve) => proxy.close(() => resolve())),
        new Promise<void>((resolve) => native.close(() => resolve())),
      ]);
    },
  };
}

describe('workspace websocket and terminal lifecycle', () => {
  let test: Awaited<ReturnType<typeof fixture>>;
  beforeEach(async () => {
    test = await fixture();
  });
  afterEach(async () => {
    await test.shutdown();
  });

  it('forwards terminal bytes and safe resize frames without exposing the provider key', async () => {
    const socket = await test.ready();
    const input = Buffer.from('echo 日本語\r');
    const output = message(socket, (data, binary) => binary && data.equals(input));
    socket.send(input);
    expect(await output).toEqual(input);
    socket.send(JSON.stringify({ type: 'resize', cols: 80, rows: 24 }));
    await delay(30);
    expect(test.nativeFrames[0]).toEqual({
      data: Buffer.from(JSON.stringify({ type: 'auth', token: 'server-only-key' })),
      binary: false,
    });
    expect(test.nativeFrames[test.nativeFrames.length - 1]?.data.toString()).toBe(
      JSON.stringify({ type: 'resize', cols: 80, rows: 24 }),
    );
    expect(test.nativeRequests[0]).toEqual(
      expect.objectContaining({
        authorization: 'Bearer server-only-key',
        scope: 'librechat-workspace:owner',
      }),
    );
  });
  it.each(['other-token', 'invalid-token'])(
    'denies %s before contacting the upstream',
    async (token) => {
      const socket = await test.connect();
      const end = closed(socket);
      socket.send(JSON.stringify({ type: 'auth', token, sessionId: '01234567' }));
      expect(await end).toBe(1008);
      expect(test.nativeRequests).toHaveLength(0);
    },
  );
  it('rejects a forged or nonexistent session without deleting it', async () => {
    const socket = await test.connect();
    const end = closed(socket);
    socket.send(JSON.stringify({ type: 'auth', token: 'owner-token', sessionId: 'deadbeef' }));
    expect(await end).toBe(1008);
    expect(test.nativeRequests.some((request) => request.method === 'DELETE')).toBe(false);
  });
  it('rejects a cross-site upgrade', async () => {
    await expect(test.connect('http://attacker')).rejects.toThrow('403');
    expect(test.nativeRequests).toHaveLength(0);
  });
  it('times out a client that never authenticates', async () => {
    const socket = await test.connect();
    expect(await closed(socket)).toBe(1008);
    expect(test.nativeRequests).toHaveLength(0);
  });
  it('rejects oversized resize values and cleans up its shell', async () => {
    const socket = await test.ready();
    const end = closed(socket);
    socket.send(JSON.stringify({ type: 'resize', cols: 100000, rows: 24 }));
    expect(await end).toBe(1008);
    await delay(30);
    expect(test.isActive()).toBe(false);
  });
  it('rejects oversized websocket frames', async () => {
    const socket = await test.ready();
    const end = closed(socket);
    socket.send(Buffer.alloc(16385));
    expect(await end).toBe(1009);
  });
  it('allows a renewed owner token without restarting or forwarding it to the native shell', async () => {
    const socket = await test.ready();
    socket.send(JSON.stringify({ type: 'reauth', token: 'renewed-token' }));
    await delay(30);
    const bytes = Buffer.from('still connected');
    const result = message(socket, (data, binary) => binary && data.equals(bytes));
    socket.send(bytes);
    expect(await result).toEqual(bytes);
    expect(test.nativeFrames.some((frame) => frame.data.toString().includes('renewed-token'))).toBe(
      false,
    );
  });
  it('fails closed if a new token changes identity', async () => {
    const socket = await test.ready();
    const end = closed(socket);
    socket.send(JSON.stringify({ type: 'reauth', token: 'other-token' }));
    expect(await end).toBe(1008);
  });
  it('rechecks authorization even when a client refuses to reauthenticate', async () => {
    const socket = await test.ready();
    const end = closed(socket);
    test.revoke();
    expect(await end).toBe(1008);
  }, 15000);
  it('hides disabled capabilities and refuses creating shells', async () => {
    test.disable();
    expect(await (await fetch(`${test.http}/config`)).json()).toEqual({ enabled: false });
    expect(
      (
        await fetch(`${test.http}/terminals`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: '{"directory":"/home/user"}',
        })
      ).status,
    ).toBe(403);
    expect(test.nativeRequests).toHaveLength(0);
  });
  it('leases new shells and closes them if the browser never connects', async () => {
    test.reset();
    expect(
      (
        await fetch(`${test.http}/terminals`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: '{"directory":"/home/user"}',
        })
      ).status,
    ).toBe(201);
    expect(test.isActive()).toBe(true);
    await delay(1100);
    expect(test.isActive()).toBe(false);
  });
});
