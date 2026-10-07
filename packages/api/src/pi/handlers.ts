import { piSyncConfigSchema } from 'librechat-data-provider';
import type { AppConfig, PiSyncLink, PiSyncStore } from '@librechat/data-schemas';
import type { Request, Response, RequestHandler } from 'express';
import { createPiSyncService, PiSyncError } from './service';
import { authorizePiPublisher } from './auth';

type PiRequest = Request & { user?: { id?: string } };

export function guardPiTurn(link: PiSyncLink, body: Record<string, unknown>): void {
  if (link.disabled) throw new PiSyncError(409, 'PI_SYNC_DISABLED');
  if (body.endpoint !== 'Local Pi' || body.model !== link.model)
    throw new PiSyncError(409, 'PI_SESSION_BOUND');
  if (
    [
      'isRegenerate',
      'isContinued',
      'editedContent',
      'responseMessageId',
      'overrideConvoId',
      'overrideUserMessageId',
      'overrideParentMessageId',
      'compact',
      'agent_id',
    ].some((key) => body[key]) ||
    [body.files, body.tools].some((value) => Array.isArray(value) && value.length)
  )
    throw new PiSyncError(400, 'PI_TEXT_ONLY');
  if (body.parentMessageId !== link.lastMessageId) throw new PiSyncError(409, 'PI_HISTORY_STALE');
}

export function createPiSyncHandlers(deps: {
  store: PiSyncStore;
  getConfig(): Promise<Pick<AppConfig, 'piSync'>>;
  key?: string;
  standalone: boolean;
  getJob(conversationId: string): Promise<{ status: string } | null | undefined>;
}): {
  sync: RequestHandler;
  guard: RequestHandler;
  protectHistory: RequestHandler;
  status: RequestHandler;
} {
  const sync = createPiSyncService(deps.store, async (conversationId) => {
    const job = await deps.getJob(conversationId);
    return job != null && !['complete', 'error', 'aborted'].includes(job.status);
  });
  const fail = (res: Response, error: unknown) =>
    res
      .status(error instanceof PiSyncError ? error.status : 503)
      .json({ error: { code: error instanceof PiSyncError ? error.code : 'PI_SYNC_UNAVAILABLE' } });
  return {
    async sync(req, res) {
      try {
        authorizePiPublisher(req, deps.key, deps.standalone);
        const config = piSyncConfigSchema.parse((await deps.getConfig()).piSync ?? {});
        res.json(await sync(req.body, config));
      } catch (error) {
        fail(res, error);
      }
    },
    async status(req: PiRequest, res) {
      try {
        if (!req.user?.id) throw new PiSyncError(401, 'NOT_AUTHORIZED');
        const id = req.params.conversationId;
        if (typeof id !== 'string') throw new PiSyncError(400, 'INVALID_INPUT');
        const link = await deps.store.getLinkByConversation(req.user.id, id);
        const config = piSyncConfigSchema.parse((await deps.getConfig()).piSync ?? {});
        res.json(
          link
            ? {
                sessionId: link.sessionId,
                leafId: link.leafId,
                lastMessageId: link.lastMessageId,
                disabled: Boolean(link.disabled),
                pollIntervalMs: config.pollIntervalMs,
              }
            : null,
        );
      } catch (error) {
        fail(res, error);
      }
    },
    async guard(req: PiRequest, res, next) {
      try {
        delete req.body?.piExpectedLeaf;
        delete req.body?.piTurn;
        if (
          req.method !== 'POST' ||
          typeof req.body?.conversationId !== 'string' ||
          !req.user?.id
        ) {
          next();
          return;
        }
        const link = await deps.store.getLinkByConversation(req.user.id, req.body.conversationId);
        if (link) {
          guardPiTurn(link, req.body);
          res.locals.piExpectedLeaf = link.leafId;
        }
        next();
      } catch (error) {
        fail(res, error);
      }
    },
    async protectHistory(req: PiRequest, res, next) {
      try {
        if (
          req.method === 'GET' ||
          req.path.endsWith('/feedback') ||
          req.path.endsWith('/owner-text')
        ) {
          next();
          return;
        }
        if (!req.user?.id) throw new PiSyncError(401, 'NOT_AUTHORIZED');
        const segments = req.path.split('/').filter(Boolean);
        let conversationId = segments[0];
        if (['branch', 'artifact'].includes(conversationId)) {
          const messageId = req.body?.messageId ?? segments[1];
          if (typeof messageId === 'string')
            conversationId =
              (await deps.store.getMessage(req.user.id, messageId))?.conversationId ?? '';
        }
        if (conversationId && (await deps.store.getLinkByConversation(req.user.id, conversationId)))
          throw new PiSyncError(409, 'PI_HISTORY_READ_ONLY');
        next();
      } catch (error) {
        fail(res, error);
      }
    },
  };
}

export function attachPiTurn(
  req: {
    body: { endpoint?: string };
    config: { endpoints?: { custom?: Array<{ name: string; headers?: Record<string, string> }> } };
  },
  turn: {
    conversationId: string;
    userMessageId: string;
    responseMessageId: string;
    expectedLeaf?: string | null;
  },
): void {
  if (req.body.endpoint !== 'Local Pi') return;
  const header = Buffer.from(JSON.stringify(turn)).toString('base64url');
  req.config = {
    ...req.config,
    endpoints: {
      ...req.config.endpoints,
      custom: req.config.endpoints?.custom?.map((endpoint) =>
        endpoint.name === 'Local Pi'
          ? {
              ...endpoint,
              headers: {
                ...Object.fromEntries(
                  Object.entries(endpoint.headers ?? {}).filter(
                    ([key]) => key.toLowerCase() !== 'x-pi-turn',
                  ),
                ),
                'X-Pi-Turn': header,
              },
            }
          : endpoint,
      ),
    },
  };
}
