import { Schema } from 'mongoose';
import type { PushDeviceRecord, PushDeviceRegistryRecord } from '~/types/pushDevice';

const deviceSchema: Schema<PushDeviceRecord> = new Schema(
  {
    id: { type: String, required: true },
    label: { type: String, required: true },
    createdAt: { type: Date, required: true },
    subscription: {
      endpoint: { type: String, required: true },
      keys: {
        p256dh: { type: String, required: true },
        auth: { type: String, required: true },
      },
    },
  },
  { _id: false },
);

export const pushDeviceSchema: Schema<PushDeviceRegistryRecord> = new Schema({
  userId: { type: String, required: true },
  tenantId: { type: String },
  devices: { type: [deviceSchema], default: [] },
});
pushDeviceSchema.index({ tenantId: 1, userId: 1 }, { unique: true });
pushDeviceSchema.index({ 'devices.id': 1 }, { unique: true, sparse: true });
