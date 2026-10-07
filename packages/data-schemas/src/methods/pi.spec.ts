import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { createModels } from '~/models';
import { createMethods } from './index';

let mongo: MongoMemoryServer;
let db: ReturnType<typeof createMethods>;
let owner: string;
beforeAll(async () => {
  mongo = await MongoMemoryServer.create();
  await mongoose.connect(mongo.getUri());
  createModels(mongoose);
  db = createMethods(mongoose);
  const user = await mongoose.models.User.collection.insertOne({
    name: 'Pi',
    email: 'pi@example.com',
  });
  owner = String(user.insertedId);
}, 60000);
afterAll(async () => {
  await mongoose.disconnect();
  await mongo.stop();
});

test('native store persists real projects, conversations, messages and bindings', async () => {
  const store = db.piSyncStore;
  expect(await store.ownerExists(owner)).toBe(true);
  const projectId = await store.ensureProject(owner, 'project-key', 'homelab');
  expect(await store.ensureProject(owner, 'project-key', 'homelab')).toBe(projectId);
  const conversationId = '11111111-1111-5111-a111-111111111111';
  await store.saveConversation(owner, {
    conversationId,
    endpoint: 'Local Pi',
    endpointType: 'custom',
    model: 'pi/session-test',
    title: 'Native Pi',
    chatProjectId: projectId,
  });
  await store.saveMessage(owner, {
    conversationId,
    messageId: '22222222-2222-5222-a222-222222222222',
    parentMessageId: '00000000-0000-0000-0000-000000000000',
    text: 'Hello',
    content: [{ type: 'text', text: 'Hello' }],
    isCreatedByUser: true,
    sender: 'User',
    endpoint: 'Local Pi',
    model: 'pi/session-test',
    error: false,
    unfinished: false,
    createdAt: new Date(),
  });
  await store.saveConversation(owner, {
    conversationId,
    endpoint: 'Local Pi',
    endpointType: 'custom',
    model: 'pi/session-test',
  });
  const link = {
    user: owner,
    sessionId: 'test',
    conversationId,
    model: 'pi/session-test',
    projectId,
    entries: ['fingerprint'],
    lastMessageId: '22222222-2222-5222-a222-222222222222',
    leafId: 'leaf',
  };
  await store.saveLink(link);
  await store.saveLink((await store.getLink(owner, 'test'))!);
  expect(await store.getLinkByConversation(owner, conversationId)).toEqual(link);
  expect(await store.getConversation(owner, conversationId)).toBe(true);
  expect(await store.getMessage(owner, link.lastMessageId)).toMatchObject({
    conversationId,
    isCreatedByUser: true,
  });
  expect(await store.getLink('other', 'test')).toBeNull();
  expect(String((await db.getConvo(owner, conversationId))?.chatProjectId)).toBe(projectId);
  await db.deleteUserPiLinks(owner);
  expect(await store.getLink(owner, 'test')).toBeNull();
});
