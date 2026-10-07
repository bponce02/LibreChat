import { ContentTypes } from 'librechat-data-provider';
import type { Model } from 'mongoose';
import type { ConversationMethods } from './conversation';
import type { PiSyncLink, PiSyncStore } from '~/types/pi';
import type { ChatProjectMethods } from './chatProject';
import type { MessageMethods } from './message';

export function createPiSyncMethods(
  mongoose: typeof import('mongoose'),
  db: Pick<ConversationMethods, 'getConvo' | 'saveConvo'> &
    Pick<MessageMethods, 'getMessage' | 'saveMessage'> &
    Pick<ChatProjectMethods, 'listChatProjects' | 'createChatProject'>,
): { piSyncStore: PiSyncStore; deleteUserPiLinks(user: string): Promise<void> } {
  const Link = mongoose.models.PiSyncLink as Model<PiSyncLink>;
  const piSyncStore: PiSyncStore = {
    ownerExists: async (user) => Boolean(await mongoose.models.User.exists({ _id: user })),
    getLink: (user, sessionId) =>
      Link.findOne({ user, sessionId }).select('-_id -__v').lean().exec(),
    getLinkByConversation: (user, conversationId) =>
      Link.findOne({ user, conversationId }).select('-_id -__v').lean().exec(),
    async saveLink(link) {
      await Link.updateOne(
        { user: link.user, sessionId: link.sessionId },
        { $set: link },
        { upsert: true },
      );
    },
    getConversation: async (user, conversationId) =>
      Boolean(await db.getConvo(user, conversationId)),
    async getMessage(user, messageId) {
      const message = await db.getMessage({ user, messageId });
      if (!message) return null;
      return {
        conversationId: message.conversationId,
        parentMessageId: message.parentMessageId ?? '',
        isCreatedByUser: message.isCreatedByUser,
        unfinished: Boolean(message.unfinished),
        error: Boolean(message.error),
      };
    },
    async ensureProject(user, projectKey, name) {
      const description = `Pi session sync: ${projectKey}`;
      let cursor: string | null = null;
      do {
        const page = await db.listChatProjects(user, { limit: 100, cursor });
        const existing = page.projects.find((project) => project.description === description);
        if (existing) return String(existing._id);
        cursor = page.nextCursor;
      } while (cursor);
      return String((await db.createChatProject(user, { name, description }))._id);
    },
    async saveConversation(user, value) {
      if (!(await db.saveConvo({ userId: user, isTemporary: false }, value)))
        throw new Error('PI_CONVERSATION_WRITE_FAILED');
    },
    async saveMessage(user, value) {
      const saved = await db.saveMessage(
        { userId: user, isTemporary: false },
        { ...value, user, content: [{ type: ContentTypes.TEXT, text: value.text }] },
      );
      if (!saved) throw new Error('PI_MESSAGE_WRITE_FAILED');
    },
  };
  return {
    piSyncStore,
    async deleteUserPiLinks(user) {
      await Link.deleteMany({ user });
    },
  };
}
