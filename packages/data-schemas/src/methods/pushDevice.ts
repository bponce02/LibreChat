import { createHash } from 'node:crypto';
import type {
  NotificationPushSubscription,
  NotificationPushDevice,
  RegisterPushDeviceResult,
} from 'librechat-data-provider';
import type { Model } from 'mongoose';
import type { PushDeviceRecord, PushDeviceRegistryRecord } from '~/types/pushDevice';
import { notificationOwnerScope } from './notificationScope';

export interface PushDeviceMethods {
  registerPushDevice(
    userId: string,
    subscription: NotificationPushSubscription,
    label: string,
    maxDevices: number,
  ): Promise<RegisterPushDeviceResult>;
  listPushDevices(userId: string): Promise<NotificationPushDevice[]>;
  revokePushDevice(userId: string, deviceId: string): Promise<boolean>;
  deleteUserPushDevices(userId: string): Promise<void>;
}
const duplicateKey = (error: unknown) =>
  error != null && typeof error === 'object' && 'code' in error && error.code === 11000;
function project(device: PushDeviceRecord): NotificationPushDevice {
  return { id: device.id, label: device.label, createdAt: device.createdAt.toISOString() };
}

export function createPushDeviceMethods(mongoose: typeof import('mongoose')): PushDeviceMethods {
  const Registry = mongoose.models.PushDeviceRegistry as Model<PushDeviceRegistryRecord>;
  async function registerPushDevice(
    userId: string,
    subscription: NotificationPushSubscription,
    label: string,
    maxDevices: number,
  ): Promise<RegisterPushDeviceResult> {
    const scope = notificationOwnerScope(userId);
    if (
      !Number.isInteger(maxDevices) ||
      maxDevices < 1 ||
      maxDevices > 20 ||
      !label.trim() ||
      label.length > 100
    ) {
      throw new Error('Invalid push device admission parameters');
    }
    const endpoint = new URL(subscription.endpoint).href;
    const id = createHash('sha256').update(endpoint).digest('hex');
    const device: PushDeviceRecord = {
      id,
      label: label.trim(),
      createdAt: new Date(),
      subscription: { ...subscription, endpoint },
    };
    const filter = {
      ...scope,
      'devices.id': { $ne: id },
      [`devices.${maxDevices - 1}`]: { $exists: false },
    };
    for (const upsert of [true, false]) {
      const existing = await Registry.findOneAndUpdate(
        { ...scope, 'devices.id': id },
        {
          $set: { 'devices.$.label': device.label, 'devices.$.subscription': device.subscription },
        },
        { new: true },
      ).lean();
      const saved = existing?.devices.find((value) => value.id === id);
      if (saved) return { ok: true, device: project(saved) };
      try {
        const inserted = await Registry.findOneAndUpdate(
          filter,
          {
            $setOnInsert: scope,
            $push: { devices: device },
          },
          { upsert, new: true, setDefaultsOnInsert: false },
        ).lean();
        if (inserted) return { ok: true, device: project(device) };
      } catch (error) {
        if (!duplicateKey(error)) throw error;
      }
    }
    const current = await Registry.findOne(scope).lean();
    const saved = current?.devices.find((value) => value.id === id);
    if (saved) return { ok: true, device: project(saved) };
    return {
      ok: false,
      error: {
        code: (current?.devices.length ?? 0) >= maxDevices ? 'DEVICE_LIMIT' : 'DEVICE_CONFLICT',
      },
    };
  }
  async function listPushDevices(userId: string): Promise<NotificationPushDevice[]> {
    const registry = await Registry.findOne(notificationOwnerScope(userId))
      .select('devices.id devices.label devices.createdAt')
      .lean();
    return registry?.devices.map(project) ?? [];
  }
  async function revokePushDevice(userId: string, deviceId: string): Promise<boolean> {
    const result = await Registry.updateOne(
      { ...notificationOwnerScope(userId), 'devices.id': deviceId },
      { $pull: { devices: { id: deviceId } } },
    );
    return result.modifiedCount > 0;
  }
  async function deleteUserPushDevices(userId: string): Promise<void> {
    await Registry.deleteOne(notificationOwnerScope(userId));
  }
  return { registerPushDevice, listPushDevices, revokePushDevice, deleteUserPushDevices };
}
