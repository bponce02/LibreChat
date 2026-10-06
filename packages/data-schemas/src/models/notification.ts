import type { Model } from 'mongoose';
import type { NotificationRecord, NotificationQuotaRecord } from '~/types/notification';
import { notificationSchema, notificationQuotaSchema } from '~/schema/notification';
import { applyTenantIsolation } from '~/models/plugins/tenantIsolation';

export function createNotificationModel(
  mongoose: typeof import('mongoose'),
): Model<NotificationRecord> {
  applyTenantIsolation(notificationSchema);
  return (
    mongoose.models.Notification ||
    mongoose.model<NotificationRecord>('Notification', notificationSchema)
  );
}

export function createNotificationQuotaModel(
  mongoose: typeof import('mongoose'),
): Model<NotificationQuotaRecord> {
  applyTenantIsolation(notificationQuotaSchema);
  return (
    mongoose.models.NotificationQuota ||
    mongoose.model<NotificationQuotaRecord>('NotificationQuota', notificationQuotaSchema)
  );
}
