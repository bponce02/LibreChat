# PWA push implementation

Work branch: `feat/pwa-push-notifications`, based on `fork/homelab`. This feature is not connected end to end or deployed. Setting `notifications.push.enabled` does not yet subscribe a device or cause the notification tool to send push messages.

## Implemented

- `client/sw/push.js` is imported by the existing generated root worker; there is no second competing worker or change to the existing cache/healing strategy.
- A versioned, bounded payload displays a persistent notification. Retries use the same tag to replace the same visible notification rather than multiplying it.
- Clicking uses a server-supplied UUID to construct a same-origin, application-scope conversation URL. Payload URLs are not honored. An existing matching chat is focused; otherwise a new window opens rather than navigating another active conversation away.
- `packages/api/src/notifications/push.ts` provides an injectable Web Push transport and the `web-push` adapter. VAPID options are per call, not global SDK state. The private key is supplied only to the server-side factory, never shared configuration or the browser.
- Subscription destinations must be exact HTTPS origins in the operator-configured provider allowlist. Defaults are Google's FCM, Mozilla Push, and Apple Web Push. Userinfo, fragments, non-default ports not explicitly allowed, lookalike hosts and arbitrary internal destinations are rejected. Configure only trusted push providers, not user-controlled domains. The sender does not follow redirects.
- P-256 subscription keys and matching VAPID keys are validated before sending. Payload fields are strict; the 3,072-byte UTF-8 budget leaves room under typical 4,096-byte Web Push limits for encryption overhead.
- Provider acceptance, expired subscriptions, retryable failures, rejection and disabled state are distinct results. Acceptance is not proof a device displayed the notification. Provider diagnostics and endpoint/key material are not returned in results.

## Remaining before enabling

1. Owner/tenant-scoped device registration, atomic per-owner limits, authenticated subscribe/revoke routes, and account-deletion cleanup.
2. Explicit user-gesture opt-in/out in the inbox, platform support/permission states and installed-iOS guidance. Do not prompt on page load. Rotate or revoke subscriptions on logout/account changes so another account cannot receive prior-account content. Gate delivery against the current device binding.
3. A durable delivery outbox and bounded retry worker. Persist before acknowledging, claim leases atomically across replicas, and preserve tenant scope. Remove expired endpoints; do not delete valid endpoints on VAPID/configuration errors. Never make the agent wait for a device receipt.
4. Privacy-safe lock-screen copy by default. Any content preview must be explicit user opt-in; agents cannot choose device endpoints or links.
5. VAPID secret provisioning and rotation instructions, device-management controls, real encrypted provider delivery, revoke/logout tests and on-device verification.

## Checks

```sh
node --test client/sw/push.test.cjs
(cd packages/api && npx jest src/notifications --runInBand --coverage=false)
npx playwright install chromium
# Build shared packages and the production client before this lane.
E2E_BASE_URL=http://localhost:3099 npx playwright test --config=e2e/playwright.config.notifications.ts
```

The notification browser lane uses full Chromium's headless mode (`channel: chromium`). Playwright's lightweight headless shell reports notification permission denied even when its Permissions API override says granted; it cannot verify the native Notification API used here.

The worker browser test registers the real production `sw.js`, closes all app pages, dispatches a synthetic push event inside the real service worker and checks `registration.getNotifications()`. The display API is real; the provider delivery and event injection are not. Unit tests separately cover malformed payloads, click routing, provider allowlists and delivery-result classification.

An installed PWA and real push provider are still required to prove platform delivery. On iOS/iPadOS, Web Push requires a supported version (16.4+) and adding the app to the Home Screen. Android/desktop support and delivery depend on browser permission, OS notification settings, power/background policies and whether the browser is forcibly stopped. Do not promise delivery with an OS/browser force-quit or substitute a browser viewport screenshot for an installed-device test.
