import { Schema } from 'mongoose';
import type { NotificationRecord, NotificationQuotaRecord } from '~/types/notification';

export const notificationSchema: Schema<NotificationRecord> = new Schema({
  notificationId: { type: String, required: true },
  userId: { type: String, required: true },
  tenantId: { type: String },
  conversationId: { type: String, required: true },
  toolCallId: { type: String, required: true },
  fingerprint: { type: String, required: true },
  title: { type: String, required: true },
  body: { type: String, required: true },
  createdAt: { type: Date, required: true },
  readAt: { type: Date, default: null },
});

notificationSchema.index({ tenantId: 1, userId: 1, notificationId: 1 }, { unique: true });
notificationSchema.index({ tenantId: 1, userId: 1, readAt: 1, createdAt: -1, notificationId: -1 });

export const notificationQuotaSchema: Schema<NotificationQuotaRecord> = new Schema({
  userId: { type: String, required: true },
  tenantId: { type: String },
  minute: { type: Number, required: true },
  keys: { type: [String], default: [] },
  expiresAt: { type: Date, required: true },
});

notificationQuotaSchema.index({ tenantId: 1, userId: 1, minute: 1 }, { unique: true });
notificationQuotaSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });
