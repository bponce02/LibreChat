import { basename } from 'node:path';
import { createHash } from 'node:crypto';
import { piSnapshotSchema } from 'librechat-data-provider';
import type { PiSyncConfig } from 'librechat-data-provider';
import type { PiSyncStore } from '@librechat/data-schemas';

export const NO_PARENT = '00000000-0000-0000-0000-000000000000';
const digest = (value: string) => createHash('sha256').update(value).digest('hex');
export const piSyncId = (value: string): string => {
  const hex = digest(value);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-5${hex.slice(13, 16)}-a${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
};
export class PiSyncError extends Error {
  constructor(
    public status: number,
    public code: string,
  ) {
    super(code);
  }
}
export function createPiSyncService(
  store: PiSyncStore,
  isGenerating: (conversationId: string) => Promise<boolean>,
): (
  snapshot: unknown,
  config: PiSyncConfig,
) => Promise<{ conversationId: string; projectId: string; messages: number }> {
  let queue = Promise.resolve();
  async function apply(input: unknown, config: PiSyncConfig) {
    const owner = config.ownerId;
    if (!config.enabled || !owner) throw new PiSyncError(503, 'PI_SYNC_DISABLED');
    if (Buffer.byteLength(JSON.stringify(input) ?? '') > config.maxSnapshotBytes)
      throw new PiSyncError(413, 'PI_SNAPSHOT_TOO_LARGE');
    const parsed = piSnapshotSchema.safeParse(input);
    if (!parsed.success) throw new PiSyncError(400, 'PI_SNAPSHOT_INVALID');
    const snapshot = parsed.data;
    if (
      snapshot.messages.length > config.maxMessages ||
      snapshot.messages.some((message) => message.text.length > config.maxMessageChars) ||
      new Set(snapshot.messages.map((message) => message.entryId)).size !== snapshot.messages.length
    )
      throw new PiSyncError(400, 'PI_SNAPSHOT_INVALID');
    if (!(await store.ownerExists(owner))) throw new PiSyncError(503, 'PI_OWNER_UNAVAILABLE');
    const sessionId = snapshot.sessionId;
    const conversationId = piSyncId(`${owner}:pi:${sessionId}`);
    const model = `pi/session-${sessionId}`;
    let link = await store.getLink(owner, sessionId);
    if (link?.disabled) throw new PiSyncError(409, 'PI_SYNC_DISABLED');
    if (await isGenerating(conversationId)) throw new PiSyncError(409, 'PI_REPLY_BUSY');
    const previous = link?.entries ?? [];
    const entries = snapshot.messages.map((m) =>
      digest(JSON.stringify([m.entryId, m.role, m.text, m.remote])),
    );
    if (previous.some((entry, i) => entries[i] !== entry))
      throw new PiSyncError(409, 'PI_BRANCH_CHANGED');
    if (link && !(await store.getConversation(owner, conversationId))) {
      await store.saveLink({ ...link, disabled: true });
      throw new PiSyncError(409, 'PI_CHAT_DELETED');
    }
    if (!link) {
      const projectKey = digest(snapshot.cwd);
      const projectId = await store.ensureProject(
        owner,
        projectKey,
        basename(snapshot.cwd) || 'Pi',
      );
      const title = (
        snapshot.title ||
        snapshot.messages.find((m) => m.role === 'user')?.text ||
        `Pi ${sessionId.slice(-8)}`
      )
        .replace(/\s+/g, ' ')
        .slice(0, 120);
      await store.saveConversation(owner, {
        conversationId,
        title,
        endpoint: 'Local Pi',
        endpointType: 'custom',
        model,
        chatProjectId: projectId,
      });
      link = {
        user: owner,
        sessionId,
        conversationId,
        model,
        projectId,
        entries: [],
        lastMessageId: NO_PARENT,
        leafId: null,
      };
      await store.saveLink(link);
    }
    let parentMessageId = NO_PARENT;
    for (let i = 0; i < snapshot.messages.length; i++) {
      const message = snapshot.messages[i];
      const remote = message.remote?.conversationId === conversationId ? message.remote : undefined;
      const remoteMessageId =
        message.role === 'user' ? remote?.userMessageId : remote?.responseMessageId;
      const messageId = remoteMessageId ?? piSyncId(`${conversationId}:${message.entryId}`);
      if (i >= previous.length) {
        const existing = await store.getMessage(owner, messageId);
        if (
          existing &&
          (existing.conversationId !== conversationId ||
            existing.isCreatedByUser !== (message.role === 'user') ||
            existing.parentMessageId !== parentMessageId)
        )
          throw new PiSyncError(409, 'PI_MESSAGE_CONFLICT');
        if (!existing || !remote) {
          await store.saveMessage(owner, {
            messageId,
            conversationId,
            parentMessageId,
            text: message.text,
            content: [{ type: 'text', text: message.text }],
            isCreatedByUser: message.role === 'user',
            sender: message.role === 'user' ? 'User' : 'Local Pi',
            endpoint: 'Local Pi',
            model,
            error: false,
            unfinished: false,
            createdAt: new Date(message.timestamp),
          });
        } else if (existing.unfinished || existing.error) {
          throw new PiSyncError(409, 'PI_REPLY_INCOMPLETE');
        }
      }
      parentMessageId = messageId;
    }
    await store.saveConversation(owner, {
      conversationId,
      endpoint: 'Local Pi',
      endpointType: 'custom',
      model,
    });
    await store.saveLink({
      ...link,
      entries,
      lastMessageId: parentMessageId,
      leafId: snapshot.leafId,
    });
    return { conversationId, projectId: link.projectId, messages: entries.length };
  }
  return (snapshot: unknown, config: PiSyncConfig) => {
    const operation = queue.then(() => apply(snapshot, config));
    queue = operation.then(
      () => undefined,
      () => undefined,
    );
    return operation;
  };
}
