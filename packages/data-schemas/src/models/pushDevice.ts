import type { Model } from 'mongoose';
import type { PushDeviceRecord } from '~/types/pushDevice';
import { applyTenantIsolation } from '~/models/plugins/tenantIsolation';
import { pushDeviceSchema } from '~/schema/pushDevice';

export function createPushDeviceModel(
  mongoose: typeof import('mongoose'),
): Model<PushDeviceRecord> {
  applyTenantIsolation(pushDeviceSchema);
  return (
    mongoose.models.PushDevice || mongoose.model<PushDeviceRecord>('PushDevice', pushDeviceSchema)
  );
}
