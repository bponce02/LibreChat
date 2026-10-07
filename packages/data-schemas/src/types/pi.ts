export interface PiSyncLink {
  user: string;
  sessionId: string;
  conversationId: string;
  model: string;
  projectId: string;
  entries: string[];
  lastMessageId: string;
  leafId: string | null;
  disabled?: boolean;
}

export interface PiSyncMessage {
  messageId: string;
  conversationId: string;
  parentMessageId: string;
  text: string;
  content: Array<{ type: 'text'; text: string }>;
  isCreatedByUser: boolean;
  sender: string;
  endpoint: string;
  model: string;
  error: boolean;
  unfinished: boolean;
  createdAt: Date;
}

export interface PiSyncStore {
  ownerExists(user: string): Promise<boolean>;
  getLink(user: string, sessionId: string): Promise<PiSyncLink | null>;
  getLinkByConversation(user: string, conversationId: string): Promise<PiSyncLink | null>;
  saveLink(link: PiSyncLink): Promise<void>;
  getConversation(user: string, conversationId: string): Promise<boolean>;
  getMessage(
    user: string,
    messageId: string,
  ): Promise<Pick<
    PiSyncMessage,
    'conversationId' | 'parentMessageId' | 'isCreatedByUser' | 'unfinished' | 'error'
  > | null>;
  ensureProject(user: string, projectKey: string, name: string): Promise<string>;
  saveConversation(
    user: string,
    value: {
      conversationId: string;
      endpoint: string;
      endpointType: string;
      model: string;
      title?: string;
      chatProjectId?: string;
    },
  ): Promise<void>;
  saveMessage(user: string, value: PiSyncMessage): Promise<void>;
}
