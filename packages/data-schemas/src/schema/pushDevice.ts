import { Schema } from 'mongoose';
import type { PushDeviceRecord } from '~/types/pushDevice';

export const pushDeviceSchema: Schema<PushDeviceRecord> = new Schema({
  userId: { type: String, required: true },
  tenantId: { type: String },
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
});
pushDeviceSchema.index({ tenantId: 1, userId: 1, id: 1 }, { unique: true });
