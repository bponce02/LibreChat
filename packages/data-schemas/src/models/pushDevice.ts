import type { Model } from 'mongoose';
import type { PushDeviceRegistryRecord } from '~/types/pushDevice';
import { applyTenantIsolation } from '~/models/plugins/tenantIsolation';
import { pushDeviceSchema } from '~/schema/pushDevice';

export function createPushDeviceModel(
  mongoose: typeof import('mongoose'),
): Model<PushDeviceRegistryRecord> {
  applyTenantIsolation(pushDeviceSchema);
  return (
    mongoose.models.PushDeviceRegistry ||
    mongoose.model<PushDeviceRegistryRecord>('PushDeviceRegistry', pushDeviceSchema)
  );
}
