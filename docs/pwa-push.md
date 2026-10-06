# Personal PWA notifications

This fork targets a personal homelab, not a multi-user notification platform.

## How it works

1. Open **Notifications** and click **Enable notifications on this device**.
2. Allow the browser prompt. The app saves that device's subscription.
3. When an agent calls `notify_user`, LibreChat saves the inbox entry and immediately attempts Web Push to your registered devices.
4. Clicking the push opens its chat. The same button disables notifications and unsubscribes the device.

There is no delivery queue, retry worker, device quota or cross-account binding system. Failed push does not lose the inbox entry. Expired subscriptions are removed on send; other failures are reported in the tool's `push` result, without retrying. `accepted` means the provider accepted the request, not that the OS displayed it. Replayed tool calls do not send another push.

Subscriptions are ordinary owner-scoped records; authentication, key validation and the provider-origin allowlist remain. The earlier experimental quota registry has been removed, not layered underneath this implementation. It was never deployed, so no production migration is needed.

## Setup

Generate a VAPID pair once from the repository root:

```sh
npx web-push generate-vapid-keys --json
```

Keep the private key in the LibreChat **server/container environment** as `LIBRECHAT_WEB_PUSH_PRIVATE_KEY`. Do not put it in client configuration or Git. Set the public key and a real contact address in `librechat.yaml`:

```yaml
notifications:
  enabled: true
  push:
    enabled: true
    publicKey: YOUR_PUBLIC_KEY
    subject: mailto:you@example.com
```

The enable button stays disabled when the keys/contact are missing or inconsistent. Changing the VAPID pair requires re-enabling notifications on each device. The server must be able to reach its browser push providers.

Use HTTPS and a production client build (development mode does not register the worker). On iPhone/iPad, add the app to the Home Screen and open it there; Web Push requires iOS/iPadOS 16.4+. OS permissions, power policies and force-quitting the browser can prevent delivery.

Agent notification titles and messages can appear on the lock screen. Use this on your own devices; subscriptions persist until disabled, expired, or the account is deleted. This is not a shared-device/account-switching system.

## Verification and deployment status

Unit tests cover subscription lifecycle, direct delivery, failed/expired sends, deduplication and safe errors. The browser test exercises enable → agent call → provider acceptance → disable, with real app routes/database and SDK encryption; browser subscription acquisition and the external push provider are fixtures. Another test exercises the actual worker Notification API with all app windows closed.

Desktop/mobile light/dark screenshots, explicit typechecks and production builds are checked locally. Run the dedicated lane after building:

```sh
npx playwright install chromium
E2E_BASE_URL=http://localhost:3099 npx playwright test --config=e2e/playwright.config.notifications.ts
```

The test VAPID key is deterministic and only for the disposable fixture. Do not reuse it in deployment. Nothing has been deployed or tested against a real installed phone yet; that last check requires configuring the server key and enabling notifications on the actual device.
