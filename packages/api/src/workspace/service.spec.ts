import { workspaceConfigSchema } from 'librechat-data-provider';
import {
  WorkspaceError,
  createWorkspaceClient,
  workspaceBytes,
  workspacePath,
  workspacePolicy,
} from './service';

const actor = { id: 'owner' };
const policy = workspaceConfigSchema.parse({
  enabled: true,
  ownerId: actor.id,
  baseUrl: 'http://terminal:8000',
});
const transport = (responses: Response[]) => ({
  apiKey: 'private-server-key',
  fetch: jest
    .fn<ReturnType<typeof fetch>, Parameters<typeof fetch>>()
    .mockImplementation(async () => responses.shift() ?? new Response('{}')),
});
const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status });

describe('workspace policy and path boundary', () => {
  it.each([undefined, { id: 'other' }, { id: 'owner', tenantId: 'tenant' }])(
    'denies non-owner and tenant actors',
    (user) => {
      expect(() => workspacePolicy(policy, user, 'key')).toThrow(WorkspaceError);
    },
  );
  it('fails closed without an API key or an explicit enabled owner', () => {
    expect(() => workspacePolicy(policy, actor)).toThrow(WorkspaceError);
    expect(() => workspacePolicy({ enabled: true }, actor, 'key')).toThrow(WorkspaceError);
    expect(() => workspacePolicy({ ownerId: 'owner' }, actor, 'key')).toThrow(WorkspaceError);
  });
  it.each([
    '/etc/passwd',
    '/home/user-other/a',
    '/home/user/../../etc',
    '/home/user/a\\b',
    '/home/user/a\0b',
  ])('rejects escaped and ambiguous paths %s', (path) => {
    expect(() => workspacePath(path, policy)).toThrow(WorkspaceError);
  });
  it('normalizes paths within the browsing root', () => {
    expect(workspacePath('/home/user/a/../b', policy)).toBe('/home/user/b');
  });
});

describe('workspace upstream filesystem adapter', () => {
  it('bounds listings and fixes owner identity and server-only authentication', async () => {
    const native = transport([
      json({
        entries: ['a', 'b', '../escape'].map((name) => ({
          name,
          type: 'file',
          size: 1,
          writable: true,
        })),
      }),
    ]);
    const client = createWorkspaceClient(native, actor, { ...policy, maxEntries: 1 });
    expect(await client.list('/home/user')).toEqual({
      directory: '/home/user',
      entries: [{ name: 'a', type: 'file', size: 1, writable: true }],
      truncated: true,
    });
    expect(native.fetch.mock.calls[0][1]).toEqual(
      expect.objectContaining({
        redirect: 'error',
        headers: {
          Authorization: 'Bearer private-server-key',
          'X-Session-Id': 'librechat-workspace:owner',
        },
      }),
    );
  });
  it('reads original UTF-8 bytes instead of document extraction', async () => {
    const native = transport([new Response(Buffer.from('\ufeffhello\r\n'))]);
    const file = await createWorkspaceClient(native, actor, policy).read('/home/user/a');
    expect(file.content).toBe('\ufeffhello\r\n');
    expect(file.version).toMatch(/^[a-f0-9]{64}$/);
    expect(String(native.fetch.mock.calls[0][0])).toContain('/files/view?');
  });
  it.each([
    new Response(new Uint8Array([255])),
    new Response(new Uint8Array([0])),
    new Response('%PDF-1.4', { headers: { 'Content-Type': 'application/pdf' } }),
  ])('refuses binary and extracted document editing', async (response) => {
    await expect(
      createWorkspaceClient(transport([response]), actor, policy).read('/home/user/file'),
    ).rejects.toMatchObject({ code: 'UNSUPPORTED_FILE' });
  });
  it('rejects stale versions without issuing a write', async () => {
    const native = transport([new Response('changed by agent')]);
    await expect(
      createWorkspaceClient(native, actor, policy).write({
        path: '/home/user/a',
        content: 'my edit',
        version: 'stale',
      }),
    ).rejects.toMatchObject({ code: 'CONFLICT' });
    expect(native.fetch).toHaveBeenCalledTimes(1);
  });
  it('saves existing text only against the current hash', async () => {
    const native = transport([
      new Response('original'),
      new Response('original'),
      json({ ok: true }),
    ]);
    const client = createWorkspaceClient(native, actor, policy);
    const file = await client.read('/home/user/a');
    await client.write({ path: file.path, version: file.version, content: 'updated' });
    expect(native.fetch.mock.calls[2][1]).toEqual(
      expect.objectContaining({
        body: JSON.stringify({ path: '/home/user/a', content: 'updated' }),
      }),
    );
  });
  it('creates a new file only when the target does not exist', async () => {
    const native = transport([json({}, 404), json({ ok: true })]);
    await expect(
      createWorkspaceClient(native, actor, policy).write({
        path: '/home/user/new',
        content: 'new',
        version: null,
      }),
    ).resolves.toEqual({ ok: true });
  });
  it('does not overwrite uploaded filenames, including binary files', async () => {
    const native = transport([new Response(new Uint8Array([0, 255]))]);
    await expect(
      createWorkspaceClient(native, actor, policy).upload(
        '/home/user',
        'existing.bin',
        Buffer.from('new'),
      ),
    ).rejects.toMatchObject({ code: 'CONFLICT' });
    expect(native.fetch).toHaveBeenCalledTimes(1);
  });
  it('uploads raw bytes with a bounded multipart body', async () => {
    const native = transport([json({}, 404), json({ ok: true })]);
    await createWorkspaceClient(native, actor, policy).upload(
      '/home/user',
      'new.bin',
      Buffer.from([0, 255]),
    );
    expect(native.fetch.mock.calls[1][1]?.body).toBeInstanceOf(FormData);
  });
  it('downloads original bytes without making them browser-active content', async () => {
    const native = transport([new Response('<script>untrusted</script>')]);
    expect(
      await createWorkspaceClient(native, actor, policy).download('/home/user/a.html'),
    ).toEqual({ path: '/home/user/a.html', bytes: Buffer.from('<script>untrusted</script>') });
  });
  it('sanitizes upstream errors rather than exposing the response', async () => {
    await expect(
      createWorkspaceClient(transport([json({ error: 'private key' }, 500)]), actor, policy).list(
        '/home/user',
      ),
    ).rejects.toMatchObject({ code: 'WORKSPACE_UNAVAILABLE' });
  });
  it('bounds both declared and streamed response bytes', async () => {
    await expect(
      workspaceBytes(new Response('1234', { headers: { 'Content-Length': '4' } }), 3),
    ).rejects.toMatchObject({ code: 'FILE_TOO_LARGE' });
    await expect(workspaceBytes(new Response('1234'), 3)).rejects.toMatchObject({
      code: 'FILE_TOO_LARGE',
    });
  });
});
