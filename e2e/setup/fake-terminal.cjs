const http = require('node:http');
const { posix } = require('node:path');
const { randomBytes } = require('node:crypto');
const busboy = require('busboy');
const { WebSocketServer } = require('ws');

const files = new Map([
  ['/home/user/readme.txt', Buffer.from('Shared workspace\n')],
  ['/home/user/projects/notes.md', Buffer.from('# Notes\n')],
  ['/home/user/image.bin', Buffer.from([0, 255, 12])],
]);
const sessions = new Map();
const owner = (req) => req.headers['x-session-id'];
const reply = (res, status, value) => {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(value));
};
const server = http.createServer(async (req, res) => {
  if (req.url === '/health') {
    res.end('ok');
    return;
  }
  if (req.headers.authorization !== 'Bearer e2e-terminal-server-key') {
    reply(res, 401, { secret: 'provider-secret-must-never-leak' });
    return;
  }
  const url = new URL(req.url, 'http://localhost');
  const path = url.searchParams.get('path');
  if (url.pathname === '/files/list') {
    const directory = url.searchParams.get('directory');
    if (directory === '/home/user/slow') {
      setTimeout(() => reply(res, 500, {}), 1000);
      return;
    }
    const entries = [];
    const seen = new Set();
    for (const [file, bytes] of files) {
      if (!file.startsWith(`${directory}/`)) continue;
      const relative = file.slice(directory.length + 1);
      const name = relative.split('/')[0];
      if (seen.has(name)) continue;
      seen.add(name);
      entries.push({
        name,
        type: relative.includes('/') ? 'directory' : 'file',
        size: bytes.length,
        writable: true,
      });
    }
    reply(res, 200, { dir: directory, writable: true, entries });
    return;
  }
  if (url.pathname === '/files/view') {
    const bytes = files.get(path);
    if (!bytes) {
      reply(res, 404, {});
      return;
    }
    res.writeHead(200, {
      'Content-Type': path.endsWith('.bin') ? 'application/octet-stream' : 'text/plain',
    });
    res.end(bytes);
    return;
  }
  if (url.pathname === '/files/upload') {
    const parser = busboy({ headers: req.headers });
    parser.on('file', (_name, stream, info) => {
      const chunks = [];
      stream.on('data', (data) => chunks.push(data));
      stream.on('end', () =>
        files.set(`${url.searchParams.get('directory')}/${info.filename}`, Buffer.concat(chunks)),
      );
    });
    parser.on('close', () => reply(res, 200, { ok: true }));
    req.pipe(parser);
    return;
  }
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString()) : {};
  if (url.pathname === '/files/write') {
    files.set(body.path, Buffer.from(body.content));
    reply(res, 200, { path: body.path });
    return;
  }
  if (url.pathname === '/files/cwd') {
    reply(res, 200, { path: body.path });
    return;
  }
  if (url.pathname === '/api/terminals' && req.method === 'GET') {
    reply(
      res,
      200,
      [...sessions].filter(([_id, scope]) => scope === owner(req)).map(([id]) => ({ id })),
    );
    return;
  }
  if (url.pathname === '/api/terminals' && req.method === 'POST') {
    const id = randomBytes(4).toString('hex');
    sessions.set(id, owner(req));
    reply(res, 200, { id });
    return;
  }
  if (url.pathname.startsWith('/api/terminals/')) {
    const id = posix.basename(url.pathname);
    if (sessions.get(id) !== owner(req)) {
      reply(res, 404, {});
      return;
    }
    if (req.method === 'DELETE') sessions.delete(id);
    reply(res, 200, { id });
    return;
  }
  reply(res, 404, {});
});
const ws = new WebSocketServer({ server });
ws.on('connection', (socket, req) => {
  const id = posix.basename(req.url);
  socket.once('message', (data) => {
    const auth = JSON.parse(data.toString());
    if (auth.token !== 'e2e-terminal-server-key' || sessions.get(id) !== owner(req)) {
      socket.close(4001);
      return;
    }
    socket.send(Buffer.from('$ '));
    socket.on('message', (input, binary) => {
      if (!binary) return;
      socket.send(Buffer.from(input));
      if (input.toString().includes('\r'))
        socket.send(Buffer.from('\r\nworkspace terminal ready\r\n$ '));
    });
  });
  socket.once('close', () => sessions.delete(id));
});
server.listen(8793, '127.0.0.1');
