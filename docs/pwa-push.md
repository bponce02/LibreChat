# PWA push implementation

Work branch: `feat/pwa-push-notifications`, based on `fork/homelab`. This feature is not connected end to end or deployed. Setting `notifications.push.enabled` does not by itself subscribe a browser or cause the notification tool to send push messages. Server-side device registration/revocation is implemented; browser opt-in controls and delivery scheduling are not connected yet.

## Implemented

- `client/sw/push.js` is imported by the existing generated root worker; there is no second competing worker or change to the existing cache/healing strategy.
- A versioned, bounded payload displays a persistent notification. Retries use the same tag to replace the same visible notification rather than multiplying it.
- Clicking uses a server-supplied UUID to construct a same-origin, application-scope conversation URL. Payload URLs are not honored. An existing matching chat is focused; otherwise a new window opens rather than navigating another active conversation away.
- `packages/api/src/notifications/push.ts` provides an injectable Web Push transport and the `web-push` adapter. VAPID options are per call, not global SDK state. The private key is supplied only to the server-side factory, never shared configuration or the browser.
- Subscription destinations must be exact HTTPS origins in the operator-configured provider allowlist. Defaults are Google's FCM, Mozilla Push, and Apple Web Push. Userinfo, fragments, non-default ports not explicitly allowed, lookalike hosts and arbitrary internal destinations are rejected. Configure only trusted push providers, not user-controlled domains. The sender does not follow redirects.
- P-256 subscription keys and matching VAPID keys are validated before sending. Payload fields are strict; the 3,072-byte UTF-8 budget leaves room under typical 4,096-byte Web Push limits for encryption overhead.
- Provider acceptance, expired subscriptions, retryable failures, rejection and disabled state are distinct results. Acceptance is not proof a device displayed the notification. Provider diagnostics and endpoint/key material are not returned in results.

### Device registry and API

- `POST /api/notifications/devices` accepts `{ label, subscription }`, including standard browser subscription JSON with a nullable `expirationTime`. It validates the destination and P-256 key before writing. Owner and tenant come from authentication/request context, never the request body.
- `GET /api/notifications/devices` returns only IDs, labels and creation times. Endpoints and key material remain server-side delivery credentials; protect database access and backups accordingly.
- `DELETE /api/notifications/devices/:id` is owner-scoped and idempotent. Listing and revocation remain available when push is disabled, so configuration changes cannot prevent removing stored credentials.
- `notifications.push.maxDevices` defaults to 5 (configurable from 1 to 20). One registry document per owner/tenant permits atomic conditional array admission without requiring Mongo transactions. Concurrent registrations cannot exceed the cap; repeated registration of the same endpoint updates its label without consuming another slot.
- A global sparse unique multikey index on device IDs prevents one endpoint from being registered to different owners or tenants. This index intentionally does not include tenant ID. A conflicting browser must unsubscribe and create a fresh subscription, not transfer another account's binding. Both registry indexes must exist before enabling on installations that disable automatic index creation.
- Account deletion removes the owner's registry. Tests cover concurrent registration/retry, capacity, cross-owner/tenant isolation, conflict, metadata-only listing, revocation and cleanup. HTTP and real-server browser tests cover the authenticated route lifecycle and safe error codes.

## Remaining before enabling

1. Explicit user-gesture opt-in/out in the inbox, platform support/permission states and installed-iOS guidance. Do not prompt on page load. Rotate or revoke subscriptions on logout/account changes so another account cannot receive prior-account content. Gate delivery against the current device binding.
2. A durable delivery outbox and bounded retry worker. Persist before acknowledging, claim leases atomically across replicas, and preserve tenant scope. Remove expired endpoints; do not delete valid endpoints on VAPID/configuration errors. Never make the agent wait for a device receipt.
3. Privacy-safe lock-screen copy by default. Any content preview must be explicit user opt-in; agents cannot choose device endpoints or links.
4. VAPID secret provisioning and rotation instructions, device-management controls, real encrypted provider delivery, revoke/logout tests and on-device verification.

## Checks

```sh
node --test client/sw/push.test.cjs
(cd packages/api && npx jest src/notifications --runInBand --coverage=false)
(cd packages/data-schemas && npx jest src/methods/notification.spec.ts src/methods/pushDevice.spec.ts --runInBand --coverage=false)
npx playwright install chromium
# Build shared packages and the production client before this lane.
E2E_BASE_URL=http://localhost:3099 npx playwright test --config=e2e/playwright.config.notifications.ts
```

The notification browser lane uses full Chromium's headless mode (`channel: chromium`). Playwright's lightweight headless shell reports notification permission denied even when its Permissions API override says granted; it cannot verify the native Notification API used here.

The worker browser test registers the real production `sw.js`, closes all app pages, dispatches a synthetic push event inside the real service worker and checks `registration.getNotifications()`. The display API is real; the provider delivery and event injection are not. Unit tests separately cover malformed payloads, click routing, provider allowlists and delivery-result classification.

An installed PWA and real push provider are still required to prove platform delivery. On iOS/iPadOS, Web Push requires a supported version (16.4+) and adding the app to the Home Screen. Android/desktop support and delivery depend on browser permission, OS notification settings, power/background policies and whether the browser is forcibly stopped. Do not promise delivery with an OS/browser force-quit or substitute a browser viewport screenshot for an installed-device test.
