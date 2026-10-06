import type { NotificationPushSubscription } from 'librechat-data-provider';

export interface PushDeviceRecord {
  userId: string;
  tenantId?: string | null;
  id: string;
  label: string;
  createdAt: Date;
  subscription: NotificationPushSubscription;
}
