import { createHash } from 'node:crypto';
import type { NotificationPushSubscription, NotificationPushDevice } from 'librechat-data-provider';
import type { Model } from 'mongoose';
import type { PushDeviceRecord } from '~/types/pushDevice';
import { notificationOwnerScope } from './notificationScope';

export interface PushDeviceMethods {
  registerPushDevice(
    userId: string,
    subscription: NotificationPushSubscription,
    label: string,
  ): Promise<NotificationPushDevice>;
  listPushDevices(userId: string): Promise<NotificationPushDevice[]>;
  getPushSubscriptions(
    userId: string,
  ): Promise<Array<{ id: string; subscription: NotificationPushSubscription }>>;
  revokePushDevice(userId: string, deviceId: string): Promise<boolean>;
  deleteUserPushDevices(userId: string): Promise<void>;
}
function project(device: PushDeviceRecord): NotificationPushDevice {
  return { id: device.id, label: device.label, createdAt: device.createdAt.toISOString() };
}

export function createPushDeviceMethods(mongoose: typeof import('mongoose')): PushDeviceMethods {
  const Device = mongoose.models.PushDevice as Model<PushDeviceRecord>;
  async function registerPushDevice(
    userId: string,
    subscription: NotificationPushSubscription,
    label: string,
  ): Promise<NotificationPushDevice> {
    const endpoint = new URL(subscription.endpoint).href;
    const id = createHash('sha256').update(endpoint).digest('hex');
    const device = await Device.findOneAndUpdate(
      { ...notificationOwnerScope(userId), id },
      {
        $set: { label, subscription: { ...subscription, endpoint } },
        $setOnInsert: { createdAt: new Date() },
      },
      { upsert: true, new: true },
    ).lean();
    if (!device) throw new Error('Push device was not saved');
    return project(device);
  }
  async function listPushDevices(userId: string): Promise<NotificationPushDevice[]> {
    const devices = await Device.find(notificationOwnerScope(userId))
      .select('id label createdAt')
      .lean();
    return devices.map(project);
  }
  async function getPushSubscriptions(
    userId: string,
  ): Promise<Array<{ id: string; subscription: NotificationPushSubscription }>> {
    const devices = await Device.find(notificationOwnerScope(userId))
      .select('id subscription')
      .lean();
    return devices.map(({ id, subscription }) => ({ id, subscription }));
  }
  async function revokePushDevice(userId: string, deviceId: string): Promise<boolean> {
    const result = await Device.deleteOne({ ...notificationOwnerScope(userId), id: deviceId });
    return result.deletedCount > 0;
  }
  async function deleteUserPushDevices(userId: string): Promise<void> {
    await Device.deleteMany(notificationOwnerScope(userId));
  }
  return {
    registerPushDevice,
    listPushDevices,
    getPushSubscriptions,
    revokePushDevice,
    deleteUserPushDevices,
  };
}
