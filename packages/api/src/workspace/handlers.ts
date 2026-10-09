import { z } from 'zod';
import busboy from 'busboy';
import { posix } from 'node:path';
import { workspaceConfigSchema } from 'librechat-data-provider';
import type { Request, Response, RequestHandler } from 'express';
import type { AppConfig } from '@librechat/data-schemas';
import type { WorkspaceActor, WorkspaceTransport } from './service';
import { WorkspaceError, createWorkspaceClient, workspacePolicy } from './service';

export type WorkspaceRequest = Request & { config?: AppConfig; user?: Partial<WorkspaceActor> };
export interface WorkspaceLeases {
  created(id: string, client: ReturnType<typeof createWorkspaceClient>, timeout: number): void;
  closed(id: string): void;
}
export interface WorkspaceHandlers {
  noStore: RequestHandler;
  config: RequestHandler;
  list: RequestHandler;
  read: RequestHandler;
  write: RequestHandler;
  upload: RequestHandler;
  download: RequestHandler;
  sessions: RequestHandler;
  create: RequestHandler;
  close: RequestHandler;
}
function sessionId(value: unknown): string {
  if (typeof value !== 'string' || !/^[a-f0-9]{8}$/.test(value))
    throw new WorkspaceError(400, 'INVALID_INPUT');
  return value;
}
function uploadedFile(
  req: Request,
  limit: number,
  timeoutMs: number,
): Promise<{ name: string; bytes: Buffer }> {
  return new Promise((resolve, reject) => {
    const parser = busboy({
      headers: req.headers,
      limits: { fileSize: limit + 1, files: 1, fields: 0, parts: 2 },
    });
    const chunks: Buffer[] = [];
    let name: string | undefined;
    let failure = false;
    const fail = (error = new WorkspaceError(413, 'FILE_TOO_LARGE')) => {
      if (failure) return;
      failure = true;
      chunks.length = 0;
      reject(error);
      req.unpipe(parser);
      req.resume();
      parser.destroy();
    };
    const timeout = setTimeout(
      () => fail(new WorkspaceError(504, 'WORKSPACE_UNAVAILABLE')),
      timeoutMs,
    );
    timeout.unref();
    parser.on('file', (field, stream, info) => {
      if (field !== 'file') {
        fail();
        stream.resume();
        return;
      }
      name = info.filename;
      stream.on('data', (data: Buffer) => {
        if (!failure) chunks.push(data);
      });
      stream.on('limit', fail);
      stream.on('error', () => fail());
    });
    parser.on('filesLimit', fail);
    parser.on('fieldsLimit', fail);
    parser.on('partsLimit', fail);
    parser.on('error', () => fail());
    req.once('aborted', fail);
    parser.on('close', () => {
      clearTimeout(timeout);
      req.off('aborted', fail);
      if (!failure && name) resolve({ name, bytes: Buffer.concat(chunks) });
      else reject(new WorkspaceError(400, 'INVALID_INPUT'));
    });
    req.pipe(parser);
  });
}

export function createWorkspaceHandlers(
  transport: WorkspaceTransport,
  leases: WorkspaceLeases,
): WorkspaceHandlers {
  let creating = false;
  const run =
    (
      action: (
        req: WorkspaceRequest,
        res: Response,
        client: ReturnType<typeof createWorkspaceClient>,
        policy: ReturnType<typeof workspacePolicy>,
        actor: WorkspaceActor,
      ) => Promise<void>,
    ): RequestHandler =>
    async (req: WorkspaceRequest, res) => {
      const abort = new AbortController();
      const cancel = () => {
        if (!res.writableEnded) abort.abort();
      };
      res.once('close', cancel);
      try {
        const policy = workspacePolicy(req.config?.workspace, req.user, transport.apiKey);
        const actor: WorkspaceActor = {
          id: req.user!.id!,
          role: req.user?.role,
          tenantId: req.user?.tenantId,
        };
        await action(
          req,
          res,
          createWorkspaceClient(transport, actor, policy, abort.signal),
          policy,
          actor,
        );
      } catch (error) {
        if (!res.headersSent) {
          let failure = new WorkspaceError(503, 'WORKSPACE_UNAVAILABLE');
          if (error instanceof z.ZodError) failure = new WorkspaceError(400, 'INVALID_INPUT');
          if (error instanceof WorkspaceError) failure = error;
          res.status(failure.status).json({ error: { code: failure.code } });
        }
      } finally {
        res.off('close', cancel);
      }
    };
  return {
    noStore: (_req, res, next) => {
      res.setHeader('Cache-Control', 'no-store');
      next();
    },
    config: (req: WorkspaceRequest, res) => {
      const policy = workspaceConfigSchema.parse(req.config?.workspace ?? {});
      let enabled = false;
      try {
        workspacePolicy(policy, req.user, transport.apiKey);
        enabled = true;
      } catch {
        enabled = false;
      }
      if (!enabled) {
        res.json({ enabled: false });
        return;
      }
      res.json({
        enabled,
        rootPath: policy.rootPath,
        maxTextBytes: policy.maxTextBytes,
        maxUploadBytes: policy.maxUploadBytes,
        maxFrameBytes: policy.maxFrameBytes,
        maxBufferedBytes: policy.maxBufferedBytes,
        maxColumns: policy.maxColumns,
        maxRows: policy.maxRows,
        scrollback: policy.scrollback,
      });
    },
    list: run(async (req, res, client, policy) => {
      res.json(await client.list(req.query.path ?? policy.rootPath));
    }),
    read: run(async (req, res, client) => {
      res.json(await client.read(req.query.path));
    }),
    write: run(async (req, res, client) => {
      const input = z
        .object({
          path: z.string(),
          content: z.string(),
          version: z
            .string()
            .regex(/^[a-f0-9]{64}$/)
            .nullable(),
        })
        .strict()
        .parse(req.body);
      res.json(await client.write(input));
    }),
    upload: run(async (req, res, client, policy) => {
      const file = await uploadedFile(req, policy.maxUploadBytes, policy.timeoutMs);
      res.json(await client.upload(req.query.path, file.name, file.bytes));
    }),
    download: run(async (req, res, client) => {
      const { path, bytes } = await client.download(req.query.path);
      res.setHeader('Content-Type', 'application/octet-stream');
      res.setHeader('X-Content-Type-Options', 'nosniff');
      res.setHeader('Cache-Control', 'no-store');
      res.setHeader(
        'Content-Disposition',
        `attachment; filename="download"; filename*=UTF-8''${encodeURIComponent(posix.basename(path)).replace(/'/g, '%27')}`,
      );
      res.send(bytes);
    }),
    sessions: run(async (_req, res, client) => {
      res.json(await client.sessions());
    }),
    create: run(async (req, res, client, policy, actor) => {
      if (creating) throw new WorkspaceError(429, 'LIMIT');
      creating = true;
      try {
        const input = z.object({ directory: z.string() }).strict().parse(req.body);
        if ((await client.sessions()).length >= policy.maxSessions)
          throw new WorkspaceError(429, 'LIMIT');
        const session = await client.create(input.directory);
        leases.created(
          session.id,
          createWorkspaceClient(transport, actor, policy),
          policy.connectTimeoutMs,
        );
        res.status(201).json(session);
      } finally {
        creating = false;
      }
    }),
    close: run(async (req, res, client) => {
      const id = sessionId(req.params.id);
      await client.close(id);
      leases.closed(id);
      res.json({ ok: true });
    }),
  };
}
