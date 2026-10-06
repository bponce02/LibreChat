import { dataService } from 'librechat-data-provider';

export function supportsPush(): boolean {
  return (
    window.isSecureContext === true &&
    'serviceWorker' in navigator &&
    'PushManager' in window &&
    'Notification' in window
  );
}

async function deviceId(endpoint: string): Promise<string> {
  const hash = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(new URL(endpoint).href),
  );
  return Array.from(new Uint8Array(hash), (value) => value.toString(16).padStart(2, '0')).join('');
}

export async function readPushState(): Promise<boolean> {
  const registration = await navigator.serviceWorker.getRegistration();
  const subscription = await registration?.pushManager.getSubscription();
  if (!subscription) return false;
  const id = await deviceId(subscription.endpoint);
  const { devices } = await dataService.listPushDevices();
  return Notification.permission === 'granted' && devices.some((device) => device.id === id);
}

export async function setDevicePush(
  enabled: boolean,
  publicKey: string,
  label: string,
): Promise<void> {
  if (enabled && (await Notification.requestPermission()) !== 'granted')
    throw new Error('PERMISSION_DENIED');
  const registration = await navigator.serviceWorker.getRegistration();
  if (!registration?.active) throw new Error('WORKER_NOT_READY');
  const previous = await registration.pushManager.getSubscription();
  if (previous) {
    await dataService.revokePushDevice(await deviceId(previous.endpoint));
    if (!(await previous.unsubscribe())) throw new Error('UNSUBSCRIBE_FAILED');
  }
  if (!enabled) return;
  const key = Uint8Array.from(atob(publicKey.replace(/-/g, '+').replace(/_/g, '/')), (char) =>
    char.charCodeAt(0),
  );
  const subscription = await registration.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: key,
  });
  try {
    const keys = subscription.toJSON().keys;
    if (!keys?.auth || !keys.p256dh) throw new Error('INVALID_SUBSCRIPTION');
    await dataService.registerPushDevice({
      label,
      subscription: {
        endpoint: subscription.endpoint,
        keys: { auth: keys.auth, p256dh: keys.p256dh },
      },
    });
  } catch (error) {
    await subscription.unsubscribe().catch(() => false);
    throw error;
  }
}
