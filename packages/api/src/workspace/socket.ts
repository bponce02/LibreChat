import { workspaceConfigSchema } from 'librechat-data-provider';
import type { WebSocket, WebSocketServer, RawData } from 'ws';
import type { Server, IncomingMessage } from 'node:http';
import type { AppConfig } from '@librechat/data-schemas';
import type { Request, RequestHandler } from 'express';
import type { WorkspaceHandlers, WorkspaceLeases } from './handlers';
import type { WorkspaceActor, WorkspaceTransport } from './service';
import {
  WorkspaceError,
  createWorkspaceClient,
  workspaceBase,
  workspaceHeaders,
  workspacePolicy,
} from './service';
import { createWorkspaceHandlers } from './handlers';

export interface WorkspaceDependencies extends WorkspaceTransport {
  Socket: typeof WebSocket;
  SocketServer: typeof WebSocketServer;
  origin: string;
  authenticate: (
    strategy: 'jwt',
    options: { session: false },
    callback: (error: unknown, user: WorkspaceActor | false) => void,
  ) => RequestHandler;
  getConfig: (options: { userId?: string; role?: string; tenantId?: string }) => Promise<AppConfig>;
}
function bytes(data: RawData): Buffer {
  if (Array.isArray(data)) return Buffer.concat(data);
  if (data instanceof ArrayBuffer) return Buffer.from(data);
  return data;
}
function authenticate(
  deps: WorkspaceDependencies,
  req: IncomingMessage,
  token: string,
): Promise<WorkspaceActor> {
  return new Promise((resolve, reject) => {
    req.headers.authorization = `Bearer ${token}`;
    deps.authenticate('jwt', { session: false }, (error, user) => {
      delete req.headers.authorization;
      if (error || !user || !user.id) reject(new WorkspaceError(401, 'NOT_AUTHORIZED'));
      else resolve(user);
    })(req as Request, {} as never, () => reject(new WorkspaceError(401, 'NOT_AUTHORIZED')));
  });
}

export function createWorkspaceService(deps: WorkspaceDependencies): {
  handlers: WorkspaceHandlers;
  attach: (server: Server) => Promise<void>;
} {
  const pending = new Map<
    string,
    { timer: ReturnType<typeof setTimeout>; close: () => Promise<void> }
  >();
  const leases: WorkspaceLeases = {
    created(id, client, timeout) {
      const timer = setTimeout(() => {
        pending.delete(id);
        void client.close(id).catch(() => {});
      }, timeout);
      timer.unref();
      pending.set(id, { timer, close: () => client.close(id) });
    },
    closed(id) {
      const lease = pending.get(id);
      if (lease) clearTimeout(lease.timer);
      pending.delete(id);
    },
  };
  const handlers = createWorkspaceHandlers(deps, leases);
  const attach = async (server: Server): Promise<void> => {
    const basePolicy = workspaceConfigSchema.parse((await deps.getConfig({})).workspace ?? {});
    const sockets = new deps.SocketServer({ noServer: true, maxPayload: basePolicy.maxFrameBytes });
    server.once('close', () => {
      for (const client of sockets.clients) client.terminate();
      sockets.close();
      for (const lease of pending.values()) {
        clearTimeout(lease.timer);
        void lease.close().catch(() => {});
      }
      pending.clear();
    });
    server.on('upgrade', (req, socket, head) => {
      if (req.url !== '/api/workspace/socket') {
        if (server.listenerCount('upgrade') === 1)
          socket.end('HTTP/1.1 404 Not Found\r\nConnection: close\r\n\r\n');
        return;
      }
      if (!deps.origin || req.headers.origin !== new URL(deps.origin).origin) {
        socket.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n');
        return;
      }
      sockets.handleUpgrade(req, socket, head, (client) => {
        const timer = setTimeout(
          () => client.close(1008, 'Authentication required'),
          basePolicy.connectTimeoutMs,
        );
        timer.unref();
        client.on('error', () => {});
        client.once('message', (raw, binary) => {
          void (async () => {
            let upstream: WebSocket | undefined;
            let closeSession: (() => Promise<void>) | undefined;
            try {
              if (binary || bytes(raw).length > basePolicy.maxFrameBytes)
                throw new WorkspaceError(401, 'NOT_AUTHORIZED');
              const input = JSON.parse(bytes(raw).toString('utf8')) as {
                type?: string;
                token?: string;
                sessionId?: string;
              };
              if (
                input.type !== 'auth' ||
                typeof input.token !== 'string' ||
                !input.token ||
                typeof input.sessionId !== 'string' ||
                !/^[a-f0-9]{8}$/.test(input.sessionId)
              )
                throw new WorkspaceError(401, 'NOT_AUTHORIZED');
              const actor = await authenticate(deps, req, input.token);
              const config = await deps.getConfig({
                userId: actor.id,
                role: actor.role,
                tenantId: actor.tenantId,
              });
              const policy = workspacePolicy(config.workspace, actor, deps.apiKey);
              const api = createWorkspaceClient(deps, actor, policy);
              await api.session(input.sessionId);
              closeSession = () => api.close(input.sessionId!);
              leases.closed(input.sessionId);
              if (client.readyState !== 1) {
                await closeSession();
                return;
              }
              clearTimeout(timer);
              const url = workspaceBase(policy);
              url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
              url.pathname = `${url.pathname.replace(/\/$/, '')}/api/terminals/${input.sessionId}`;
              upstream = new deps.Socket(url, {
                headers: workspaceHeaders(actor, deps.apiKey!),
                handshakeTimeout: policy.connectTimeoutMs,
                maxPayload: policy.maxFrameBytes,
                followRedirects: false,
              });
              let currentToken = input.token;
              let validating = false;
              const revalidate = async (token: string) => {
                if (validating) return;
                validating = true;
                try {
                  const refreshed = await authenticate(deps, req, token);
                  const latest = await deps.getConfig({
                    userId: refreshed.id,
                    role: refreshed.role,
                    tenantId: refreshed.tenantId,
                  });
                  workspacePolicy(latest.workspace, refreshed, deps.apiKey);
                  if (refreshed.id !== actor.id) throw new Error('Identity changed');
                  currentToken = token;
                } catch {
                  client.close(1008, 'Authentication required');
                } finally {
                  validating = false;
                }
              };
              const authCheck = setInterval(() => {
                void revalidate(currentToken);
              }, policy.reauthIntervalMs);
              authCheck.unref();
              const stop = () => {
                clearInterval(authCheck);
                upstream?.close();
                void closeSession?.().catch(() => {});
              };
              client.once('close', stop);
              upstream.on('error', () => {
                if (client.readyState === 1) client.close(1011, 'Workspace unavailable');
              });
              upstream.on('close', (code) => {
                if (client.readyState === 1)
                  client.close(
                    code === 1000 || code === 1001 ? 1000 : 1011,
                    'Terminal disconnected',
                  );
                void closeSession?.().catch(() => {});
              });
              upstream.on('open', () => {
                if (client.readyState !== 1) {
                  stop();
                  return;
                }
                upstream!.send(JSON.stringify({ type: 'auth', token: deps.apiKey }));
                client.send(JSON.stringify({ type: 'ready' }));
              });
              upstream.on('message', (data, isBinary) => {
                if (!isBinary || client.readyState !== 1) return;
                if (client.bufferedAmount > policy.maxBufferedBytes) {
                  client.close(1008, 'Client too slow');
                  stop();
                  return;
                }
                client.send(data, { binary: true });
              });
              client.on('message', (data, isBinary) => {
                if (upstream?.readyState !== 1) return;
                if (
                  bytes(data).length > policy.maxFrameBytes ||
                  upstream.bufferedAmount > policy.maxBufferedBytes
                ) {
                  client.close(1008, 'Input limit');
                  stop();
                  return;
                }
                if (isBinary) upstream.send(data, { binary: true });
                else {
                  try {
                    const resize = JSON.parse(bytes(data).toString('utf8')) as {
                      type?: string;
                      cols?: number;
                      rows?: number;
                      token?: string;
                    };
                    if (
                      resize.type === 'reauth' &&
                      typeof resize.token === 'string' &&
                      resize.token
                    ) {
                      void revalidate(resize.token);
                      return;
                    }
                    if (
                      resize.type !== 'resize' ||
                      !Number.isInteger(resize.cols) ||
                      !Number.isInteger(resize.rows) ||
                      resize.cols! < 2 ||
                      resize.cols! > policy.maxColumns ||
                      resize.rows! < 2 ||
                      resize.rows! > policy.maxRows
                    )
                      throw new Error('Invalid resize');
                    upstream.send(
                      JSON.stringify({ type: 'resize', cols: resize.cols, rows: resize.rows }),
                    );
                  } catch {
                    client.close(1008, 'Invalid input');
                    stop();
                  }
                }
              });
            } catch {
              if (client.readyState === 1) client.close(1008, 'Workspace unavailable');
              upstream?.close();
              void closeSession?.().catch(() => {});
            } finally {
              clearTimeout(timer);
            }
          })();
        });
        client.once('close', () => clearTimeout(timer));
      });
    });
  };
  return { handlers, attach };
}
