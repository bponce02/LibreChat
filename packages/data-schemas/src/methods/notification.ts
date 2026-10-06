import { createHash } from 'node:crypto';
import type {
  NotificationContext,
  NotificationInput,
  NotificationItem,
  NotificationList,
  NotificationResult,
} from 'librechat-data-provider';
import type { Model } from 'mongoose';
import type { NotificationRecord, NotificationQuotaRecord } from '~/types/notification';
import { notificationOwnerScope as ownerScope } from './notificationScope';

const hash = (values: string[]) =>
  createHash('sha256').update(JSON.stringify(values)).digest('hex');
const duplicateKey = (error: unknown) =>
  error != null && typeof error === 'object' && 'code' in error && error.code === 11000;

function project(record: NotificationRecord): NotificationItem {
  return {
    id: record.notificationId,
    title: record.title,
    body: record.body,
    conversationId: record.conversationId,
    createdAt: record.createdAt.toISOString(),
    readAt: record.readAt?.toISOString() ?? null,
  };
}

export interface NotificationMethods {
  enqueueNotification(
    context: NotificationContext,
    input: NotificationInput,
    maxPerMinute: number,
  ): Promise<NotificationResult>;
  listNotifications(userId: string, limit: number): Promise<NotificationList>;
  readNotification(userId: string, notificationId: string): Promise<boolean>;
  deleteUserNotifications(userId: string): Promise<void>;
}

export function createNotificationMethods(
  mongoose: typeof import('mongoose'),
): NotificationMethods {
  const Notification = mongoose.models.Notification as Model<NotificationRecord>;
  const Quota = mongoose.models.NotificationQuota as Model<NotificationQuotaRecord>;

  async function enqueueNotification(
    context: NotificationContext,
    input: NotificationInput,
    maxPerMinute: number,
  ): Promise<NotificationResult> {
    const scope = ownerScope(context.userId, context.tenantId);
    if (
      !context.conversationId ||
      !context.toolCallId ||
      !Number.isInteger(maxPerMinute) ||
      maxPerMinute < 1
    ) {
      throw new Error('Invalid notification admission parameters');
    }
    const notificationId = hash([
      context.tenantId ?? '',
      context.userId,
      context.conversationId,
      context.toolCallId,
    ]);
    const fingerprint = hash([input.title, input.body]);
    const filter = { ...scope, notificationId };
    const existing = await Notification.findOne(filter).lean();
    const replay = (record: NotificationRecord): NotificationResult =>
      record.fingerprint === fingerprint
        ? { ok: true, notificationId, status: 'queued', duplicate: true }
        : { ok: false, error: { code: 'IDEMPOTENCY_CONFLICT' } };
    if (existing) return replay(existing);

    const now = new Date();
    const minute = Math.floor(now.getTime() / 60000);
    const quotaFilter = {
      ...scope,
      minute,
      $or: [{ keys: notificationId }, { [`keys.${maxPerMinute - 1}`]: { $exists: false } }],
    };
    try {
      await Quota.findOneAndUpdate(
        quotaFilter,
        {
          $addToSet: { keys: notificationId },
          $setOnInsert: { expiresAt: new Date((minute + 2) * 60000) },
        },
        { upsert: true, new: true },
      );
    } catch (error) {
      if (!duplicateKey(error)) throw error;
      const admitted = await Quota.findOneAndUpdate(
        quotaFilter,
        { $addToSet: { keys: notificationId } },
        { new: true },
      );
      if (!admitted) return { ok: false, error: { code: 'RATE_LIMITED' } };
    }
    try {
      const result = await Notification.findOneAndUpdate(
        filter,
        {
          $setOnInsert: {
            ...scope,
            notificationId,
            fingerprint,
            conversationId: context.conversationId,
            toolCallId: context.toolCallId,
            title: input.title,
            body: input.body,
            createdAt: now,
            readAt: null,
          },
        },
        { upsert: true, new: true, includeResultMetadata: true },
      );
      if (!result.value) throw new Error('Notification persistence returned no record');
      if (result.lastErrorObject?.updatedExisting) return replay(result.value);
      return { ok: true, notificationId, status: 'queued', duplicate: false };
    } catch (error) {
      if (!duplicateKey(error)) throw error;
      const saved = await Notification.findOne(filter).lean();
      if (!saved) throw error;
      return replay(saved);
    }
  }

  async function listNotifications(userId: string, limit: number): Promise<NotificationList> {
    if (!Number.isInteger(limit) || limit < 1 || limit > 100)
      throw new Error('Invalid notification page size');
    const scope = ownerScope(userId);
    const [records, unreadCount] = await Promise.all([
      Notification.find(scope)
        .sort({ readAt: 1, createdAt: -1, notificationId: -1 })
        .limit(limit)
        .lean(),
      Notification.countDocuments({ ...scope, readAt: null }),
    ]);
    return { notifications: records.map(project), unreadCount };
  }

  async function readNotification(userId: string, notificationId: string): Promise<boolean> {
    const filter = { ...ownerScope(userId), notificationId };
    const result = await Notification.updateOne(
      { ...filter, readAt: null },
      { $set: { readAt: new Date() } },
    );
    return result.matchedCount > 0 || (await Notification.exists(filter)) != null;
  }

  async function deleteUserNotifications(userId: string): Promise<void> {
    const scope = ownerScope(userId);
    await Promise.all([Notification.deleteMany(scope), Quota.deleteMany(scope)]);
  }

  return { enqueueNotification, listNotifications, readNotification, deleteUserNotifications };
}
