import { Schema } from 'mongoose';
import type { Model } from 'mongoose';
import type { PiSyncLink } from '~/types/pi';
import { applyTenantIsolation } from '~/models/plugins/tenantIsolation';

export function createPiSyncLinkModel(mongoose: typeof import('mongoose')): Model<PiSyncLink> {
  const schema = new Schema<PiSyncLink>({
    user: { type: String, required: true },
    sessionId: { type: String, required: true },
    conversationId: { type: String, required: true },
    model: String,
    projectId: String,
    entries: [String],
    lastMessageId: String,
    leafId: { type: String, default: null },
    disabled: Boolean,
  });
  schema.index({ user: 1, sessionId: 1 }, { unique: true });
  schema.index({ user: 1, conversationId: 1 }, { unique: true });
  applyTenantIsolation(schema);
  return mongoose.models.PiSyncLink || mongoose.model<PiSyncLink>('PiSyncLink', schema);
}
