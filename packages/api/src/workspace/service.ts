import { z } from 'zod';
import { posix } from 'node:path';
import { createHash } from 'node:crypto';
import { workspaceConfigSchema } from 'librechat-data-provider';
import type {
  WorkspaceConfig,
  WorkspaceFile,
  WorkspaceListing,
  WorkspaceSession,
  WorkspaceWrite,
} from 'librechat-data-provider';

export interface WorkspaceActor {
  id: string;
  role?: string;
  tenantId?: string;
}
export interface WorkspaceTransport {
  apiKey?: string;
  fetch: (url: string, init?: RequestInit) => Promise<Response>;
}
export class WorkspaceError extends Error {
  constructor(
    public status: number,
    public code: string,
  ) {
    super(code);
  }
}
export function workspacePolicy(
  config: Partial<WorkspaceConfig> | undefined,
  actor: Partial<WorkspaceActor> | undefined,
  apiKey?: string,
): WorkspaceConfig {
  const policy = workspaceConfigSchema.parse(config ?? {});
  if (!actor?.id) throw new WorkspaceError(401, 'NOT_AUTHORIZED');
  if (!policy.enabled || !apiKey) throw new WorkspaceError(403, 'DISABLED');
  if (!policy.ownerId || policy.ownerId !== actor.id || actor.tenantId)
    throw new WorkspaceError(403, 'NOT_AUTHORIZED');
  return policy;
}
export function workspacePath(value: unknown, policy: WorkspaceConfig): string {
  if (
    typeof value !== 'string' ||
    value.length > policy.maxPathLength ||
    value.includes('\0') ||
    value.includes('\\')
  )
    throw new WorkspaceError(400, 'INVALID_PATH');
  const root = posix.normalize(policy.rootPath);
  const path = posix.normalize(value);
  if (
    !posix.isAbsolute(value) ||
    (path !== root && !path.startsWith(`${root.replace(/\/$/, '')}/`))
  )
    throw new WorkspaceError(400, 'INVALID_PATH');
  return path;
}
export function workspaceHeaders(actor: WorkspaceActor, apiKey: string): Record<string, string> {
  return { Authorization: `Bearer ${apiKey}`, 'X-Session-Id': `librechat-workspace:${actor.id}` };
}
export function workspaceBase(policy: WorkspaceConfig): URL {
  const url = new URL(policy.baseUrl);
  if (
    !['http:', 'https:'].includes(url.protocol) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  )
    throw new WorkspaceError(503, 'WORKSPACE_UNAVAILABLE');
  return url;
}
export async function workspaceBytes(response: Response, limit: number): Promise<Buffer> {
  if (!response.ok) {
    await response.body?.cancel();
    if (response.status === 404) throw new WorkspaceError(404, 'NOT_FOUND');
    if (response.status === 429) throw new WorkspaceError(429, 'LIMIT');
    throw new WorkspaceError(503, 'WORKSPACE_UNAVAILABLE');
  }
  if (!response.body) throw new WorkspaceError(503, 'WORKSPACE_UNAVAILABLE');
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > limit) throw new WorkspaceError(413, 'FILE_TOO_LARGE');
      chunks.push(value);
    }
    return Buffer.concat(chunks);
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}
const listingSchema = z.object({
  entries: z.array(
    z.object({
      name: z.string(),
      type: z.enum(['file', 'directory']),
      size: z.number().nonnegative(),
      writable: z.boolean(),
    }),
  ),
});
const sessionSchema = z.object({ id: z.string().regex(/^[a-f0-9]{8}$/) });
const version = (content: string): string => createHash('sha256').update(content).digest('hex');

export interface WorkspaceClient {
  list(directory: unknown): Promise<WorkspaceListing>;
  read(path: unknown): Promise<WorkspaceFile>;
  write(input: WorkspaceWrite): Promise<{ ok: true }>;
  upload(directory: unknown, name: string, data: Buffer): Promise<{ ok: true }>;
  download(path: unknown): Promise<{ path: string; bytes: Buffer }>;
  sessions(): Promise<WorkspaceSession[]>;
  create(directory: unknown): Promise<WorkspaceSession>;
  session(id: string): Promise<WorkspaceSession>;
  close(id: string): Promise<void>;
}
export function createWorkspaceClient(
  transport: WorkspaceTransport,
  actor: WorkspaceActor,
  policy: WorkspaceConfig,
  signal?: AbortSignal,
): WorkspaceClient {
  const base = workspaceBase(policy).toString().replace(/\/$/, '');
  const headers = workspaceHeaders(actor, transport.apiKey!);
  const request = (path: string, init?: RequestInit) =>
    transport.fetch(`${base}${path}`, {
      ...init,
      redirect: 'error',
      signal: signal
        ? AbortSignal.any([signal, AbortSignal.timeout(policy.timeoutMs)])
        : AbortSignal.timeout(policy.timeoutMs),
      headers: { ...headers, ...init?.headers },
    });
  const json = async (path: string, init?: RequestInit): Promise<unknown> =>
    JSON.parse(
      (await workspaceBytes(await request(path, init), policy.maxResponseBytes)).toString('utf8'),
    ) as unknown;
  const post = (path: string, value: object) =>
    json(path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(value),
    });
  const list = async (directory: unknown): Promise<WorkspaceListing> => {
    const path = workspacePath(directory, policy);
    const parsed = listingSchema.parse(
      await json(`/files/list?directory=${encodeURIComponent(path)}`),
    );
    const entries = parsed.entries.filter(
      (entry) => entry.name !== '.' && entry.name !== '..' && !/[\0/\\]/.test(entry.name),
    );
    return {
      directory: path,
      entries: entries.slice(0, policy.maxEntries),
      truncated: entries.length > policy.maxEntries,
    };
  };
  const read = async (input: unknown): Promise<WorkspaceFile> => {
    const path = workspacePath(input, policy);
    const response = await request(`/files/view?path=${encodeURIComponent(path)}`);
    const data = await workspaceBytes(response, policy.maxTextBytes);
    const mime = response.headers.get('content-type') ?? '';
    if (/application\/(?:pdf|zip|vnd\.)/.test(mime))
      throw new WorkspaceError(415, 'UNSUPPORTED_FILE');
    let content: string;
    try {
      content = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(data);
    } catch {
      throw new WorkspaceError(415, 'UNSUPPORTED_FILE');
    }
    for (const character of content) {
      const code = character.charCodeAt(0);
      if (code < 32 && ![9, 10, 13].includes(code))
        throw new WorkspaceError(415, 'UNSUPPORTED_FILE');
    }
    return { path, content, version: version(content) };
  };
  return {
    list,
    read,
    async write(input: WorkspaceWrite): Promise<{ ok: true }> {
      const path = workspacePath(input.path, policy);
      if (Buffer.byteLength(input.content) > policy.maxTextBytes)
        throw new WorkspaceError(413, 'FILE_TOO_LARGE');
      let current: WorkspaceFile | null = null;
      try {
        current = await read(path);
      } catch (error) {
        if (!(error instanceof WorkspaceError) || error.code !== 'NOT_FOUND') throw error;
      }
      if ((current?.version ?? null) !== input.version) throw new WorkspaceError(409, 'CONFLICT');
      await post('/files/write', { path, content: input.content });
      return { ok: true };
    },
    async upload(directory: unknown, name: string, data: Buffer): Promise<{ ok: true }> {
      const path = workspacePath(directory, policy);
      if (!name || name === '.' || name === '..' || /[\0/\\]/.test(name))
        throw new WorkspaceError(400, 'INVALID_PATH');
      workspacePath(`${path}/${name}`, policy);
      if (data.length > policy.maxUploadBytes) throw new WorkspaceError(413, 'FILE_TOO_LARGE');
      const existing = await request(`/files/view?path=${encodeURIComponent(`${path}/${name}`)}`);
      await existing.body?.cancel();
      if (existing.ok) throw new WorkspaceError(409, 'CONFLICT');
      if (existing.status !== 404) throw new WorkspaceError(503, 'WORKSPACE_UNAVAILABLE');
      const body = new FormData();
      body.append('file', new Blob([new Uint8Array(data)]), name);
      await json(`/files/upload?directory=${encodeURIComponent(path)}`, { method: 'POST', body });
      return { ok: true };
    },
    async download(input: unknown): Promise<{ path: string; bytes: Buffer }> {
      const path = workspacePath(input, policy);
      const response = await request(`/files/view?path=${encodeURIComponent(path)}`);
      return { path, bytes: await workspaceBytes(response, policy.maxDownloadBytes) };
    },
    async sessions(): Promise<WorkspaceSession[]> {
      return z.array(sessionSchema).parse(await json('/api/terminals'));
    },
    async create(directory: unknown): Promise<WorkspaceSession> {
      const path = workspacePath(directory, policy);
      await post('/files/cwd', { path });
      return sessionSchema.parse(await post('/api/terminals', {}));
    },
    async session(id: string): Promise<WorkspaceSession> {
      return sessionSchema.parse(await json(`/api/terminals/${id}`));
    },
    async close(id: string): Promise<void> {
      await json(`/api/terminals/${id}`, { method: 'DELETE' });
    },
  };
}
