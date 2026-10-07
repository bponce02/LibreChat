import { piSyncConfigSchema } from 'librechat-data-provider';
import type { PiSyncLink, PiSyncMessage, PiSyncStore } from '@librechat/data-schemas';
import type { PiSnapshot } from 'librechat-data-provider';
import { createPiSyncService, NO_PARENT } from './service';
import { guardPiTurn, attachPiTurn } from './handlers';

const policy = piSyncConfigSchema.parse({ enabled: true, ownerId: '0123456789abcdef01234567' });
function snapshot(): PiSnapshot {
  return {
    sessionId: 'session-one',
    cwd: '/projects/homelab',
    title: 'Fix deployment',
    leafId: 'entry-two',
    messages: [
      { entryId: 'entry-one', role: 'user', text: 'Hello 🌍', timestamp: '2026-10-01T00:00:00Z' },
      { entryId: 'entry-two', role: 'assistant', text: 'Hi!', timestamp: '2026-10-01T00:00:01Z' },
    ],
  };
}
function fixture() {
  const links = new Map<string, PiSyncLink>();
  const conversations = new Map<string, Parameters<PiSyncStore['saveConversation']>[1]>();
  const messages = new Map<string, PiSyncMessage>();
  const projects = new Map<string, string>();
  const ownerExists = jest.fn().mockResolvedValue(true);
  const isGenerating = jest.fn().mockResolvedValue(false);
  const store: PiSyncStore = {
    ownerExists,
    getLink: async (user, session) => links.get(`${user}:${session}`) ?? null,
    getLinkByConversation: async (user, id) =>
      [...links.values()].find((link) => link.user === user && link.conversationId === id) ?? null,
    saveLink: async (link) => {
      links.set(`${link.user}:${link.sessionId}`, structuredClone(link));
    },
    getConversation: async (user, id) => conversations.has(`${user}:${id}`),
    getMessage: async (user, id) => messages.get(`${user}:${id}`) ?? null,
    ensureProject: async (user, key, name) => {
      projects.set(`${user}:${key}`, name);
      return key.slice(0, 24);
    },
    saveConversation: async (user, value) => {
      conversations.set(`${user}:${value.conversationId}`, {
        ...conversations.get(`${user}:${value.conversationId}`),
        ...value,
      });
    },
    saveMessage: async (user, value) => {
      messages.set(`${user}:${value.messageId}`, value);
    },
  };
  const apply = createPiSyncService(store, isGenerating);
  return {
    links,
    conversations,
    messages,
    projects,
    store,
    isGenerating,
    ownerExists,
    sync: (value: unknown) => apply(value, policy),
    link: () => [...links.values()][0],
  };
}

test('groups sessions by project and replays without duplicates, including a restarted service', async () => {
  const f = fixture();
  const results = await Promise.all([f.sync(snapshot()), f.sync(snapshot())]);
  expect(results[0]).toEqual(results[1]);
  expect(f.projects.size).toBe(1);
  expect(f.conversations.size).toBe(1);
  expect(f.messages.size).toBe(2);
  expect(await createPiSyncService(f.store, f.isGenerating)(snapshot(), policy)).toEqual(
    results[0],
  );
  expect([...f.conversations.values()][0]).toMatchObject({
    model: 'pi/session-session-one',
    endpoint: 'Local Pi',
    title: 'Fix deployment',
  });
  expect([...f.messages.values()][0].parentMessageId).toBe(NO_PARENT);
  expect([...f.messages.values()][1].parentMessageId).toBe([...f.messages.values()][0].messageId);
});

test('reconciles remote IDs without overwriting streamed content', async () => {
  const f = fixture();
  const s = snapshot();
  const linked = await f.sync(s);
  const remote = {
    conversationId: linked.conversationId,
    userMessageId: 'remote-user',
    responseMessageId: 'remote-answer',
  };
  const values = [...f.messages.values()];
  await f.store.saveMessage(policy.ownerId!, {
    ...values[0],
    conversationId: linked.conversationId,
    messageId: 'remote-user',
    parentMessageId: values[1].messageId,
  });
  await f.store.saveMessage(policy.ownerId!, {
    ...values[1],
    conversationId: linked.conversationId,
    messageId: 'remote-answer',
    parentMessageId: 'remote-user',
    text: 'Streamed content',
  });
  s.messages.push(
    { ...s.messages[0], entryId: 'third', text: 'Question', remote },
    { ...s.messages[1], entryId: 'fourth', text: 'Answer', remote },
  );
  s.leafId = 'fourth';
  await f.sync(s);
  await f.sync(s);
  expect(f.messages.size).toBe(4);
  expect(f.link().lastMessageId).toBe('remote-answer');
  expect(f.messages.get(`${policy.ownerId}:remote-answer`)?.text).toBe('Streamed content');
});

test('rejects changed branches, busy replies, deleted chats and absent owner', async () => {
  const f = fixture();
  await f.sync(snapshot());
  const changed = snapshot();
  changed.messages[0].text = 'Other branch';
  await expect(f.sync(changed)).rejects.toMatchObject({ code: 'PI_BRANCH_CHANGED' });
  f.isGenerating.mockResolvedValue(true);
  await expect(f.sync(snapshot())).rejects.toMatchObject({ code: 'PI_REPLY_BUSY' });
  f.isGenerating.mockResolvedValue(false);
  f.conversations.clear();
  await expect(f.sync(snapshot())).rejects.toMatchObject({ code: 'PI_CHAT_DELETED' });
  expect(f.link().disabled).toBe(true);
  expect(f.conversations.size).toBe(0);
  f.ownerExists.mockResolvedValue(false);
  await expect(f.sync(snapshot())).rejects.toMatchObject({ code: 'PI_OWNER_UNAVAILABLE' });
});

test('recovers a partial write without losing the serialization queue', async () => {
  const f = fixture();
  jest.spyOn(f.store, 'saveMessage').mockRejectedValueOnce(new Error('interrupted'));
  await expect(f.sync(snapshot())).rejects.toThrow('interrupted');
  await f.sync(snapshot());
  expect(f.messages.size).toBe(2);
});

test('rejects invalid snapshots before persistence', async () => {
  const f = fixture();
  for (const update of [
    { sessionId: '../escape' },
    { cwd: {} },
    { messages: [{}] },
    { messages: [snapshot().messages[0], snapshot().messages[0]] },
  ]) {
    await expect(f.sync({ ...snapshot(), ...update })).rejects.toMatchObject({
      code: 'PI_SNAPSHOT_INVALID',
    });
  }
  expect(f.conversations.size).toBe(0);
});

test('guards binding, stale parent, edits, tools and attachments', async () => {
  const f = fixture();
  await f.sync(snapshot());
  const link = f.link();
  const body = { endpoint: 'Local Pi', model: link.model, parentMessageId: link.lastMessageId };
  expect(() => guardPiTurn(link, body)).not.toThrow();
  for (const update of [
    { model: 'other' },
    { parentMessageId: NO_PARENT },
    { isRegenerate: true },
    { files: [{}] },
    { tools: [{}] },
  ]) {
    expect(() => guardPiTurn(link, { ...body, ...update })).toThrow();
  }
});

test('turn identity is attached to a request-local endpoint without mutating cached config', () => {
  const endpoint = { name: 'Local Pi', headers: { 'x-pi-turn': 'untrusted', Other: 'keep' } };
  const req = { body: { endpoint: 'Local Pi' }, config: { endpoints: { custom: [endpoint] } } };
  const turn = {
    conversationId: 'chat',
    userMessageId: 'user',
    responseMessageId: 'reply',
    expectedLeaf: null,
  };
  attachPiTurn(req, turn);
  const headers = req.config.endpoints.custom[0].headers as Record<string, string>;
  expect(JSON.parse(Buffer.from(headers['X-Pi-Turn'], 'base64url').toString())).toEqual(turn);
  expect(headers['x-pi-turn']).toBeUndefined();
  expect(endpoint.headers['x-pi-turn']).toBe('untrusted');
});
