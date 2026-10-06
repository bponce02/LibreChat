export interface NotificationRecord {
  notificationId: string;
  userId: string;
  tenantId?: string | null;
  conversationId: string;
  toolCallId: string;
  fingerprint: string;
  title: string;
  body: string;
  createdAt: Date;
  readAt: Date | null;
}

export interface NotificationQuotaRecord {
  userId: string;
  tenantId?: string | null;
  minute: number;
  keys: string[];
  expiresAt: Date;
}
