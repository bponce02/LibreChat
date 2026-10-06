import type { NotificationPushSubscription } from 'librechat-data-provider';

export interface PushDeviceRecord {
  id: string;
  label: string;
  createdAt: Date;
  subscription: NotificationPushSubscription;
}
export interface PushDeviceRegistryRecord {
  userId: string;
  tenantId?: string | null;
  devices: PushDeviceRecord[];
}
