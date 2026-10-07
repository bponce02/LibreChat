# Fork development: Pi sync, agent notifications, and codemode

Maintained integration branch: `fork/homelab`, initially developed on `feat/pi-sync-agent-notifications`, based on this fork's `origin/main` (the fork currently publishes no `dev` branch). See [fork maintenance](fork-maintenance.md) for the mirror, feature-branch and upstream-update workflow. `origin` is `bponce02/LibreChat`; `upstream` is `LibreChat-AI/LibreChat`. Do not change the live homelab deployment as part of local development.

## Required features

### Native Pi session integration

Implemented locally on `feat/native-pi-session-sync`: native snapshot route, project/chat/message storage, binding/history guards, request-local turn correlation and automatic open-chat refresh/status. The real disposable-Mongo and browser import/refresh/guard checks pass. One configured owner and one gateway; no multi-user management. See [native Pi sync](pi-sync.md). Live rollout and Pi notification-tool forwarding remain separate steps.

Port the homelab's tested prototype into native package boundaries, not image-build source patches:

- Owner-scoped Pi session bindings and history fingerprints in `packages/data-schemas`.
- Authentication, synchronization, identity checks, and request correlation in `packages/api`.
- Shared contracts/configuration in `packages/data-provider`.
- Named chats under repository/worktree Projects, automatically bound to the correct Pi session.
- Live history refresh, busy/offline states, and explicit stale-context errors in the frontend.
- Preserve Pi as the history authority. Never infer the active branch from the final JSONL entry, silently retarget a chat, or duplicate streamed replies during synchronization.
- Keep the laptop gateway separate. Native LibreChat integration replaces the patch installer, not the transport.

Reference prototype: sibling `homelab/pi-connectors` and `homelab/librechat/pi-sync`. That prototype is not yet activated in the live deployment. Do not copy its legacy CJS implementation directly into `/api`; follow this repository's TypeScript and dependency-injection boundaries.

### General agent notification tool

Notifications are an agent capability, not only automatic completion alerts. Example model arguments: `{ title, body }`. Recipient identity, tenant, originating conversation, and retry identity come from the authenticated run, never model arguments.

- Durable, owner-scoped inbox with unread/read state and links back to the originating conversation.
- Agent-callable tool with bounded input, explicit configuration, rate limits, and durable deduplication.
- Return queued/accepted status, not a claim that a device displayed the notification.
- Reuse existing frontend reply-alert preferences and accessibility patterns where appropriate. `useReplyAlerts.ts` already provides open-browser reply notifications and sound; it is not a durable general notification service or closed-browser push implementation.
- Browser/mobile Web Push uses opt-in device subscriptions, the existing service worker and direct best-effort sending. For this personal app, there is no delivery queue or retry worker. Keep destinations user-configured; agents cannot choose arbitrary recipients or URLs.
- Pi should eventually reach the same authenticated notification service through a tool integration.

Implemented locally: `notify_user` registration, authenticated inbox/config/read routes, durable Mongo storage and quotas, account-deletion cleanup, and a localized sidebar inbox with an unread badge, polling, read state, and conversation links. The actual agent tool → database → browser flow passes against an isolated server and synthetic model. This is not deployed. Pi's connection to the same notification service remains pending. On `feat/pwa-push-notifications`, device push now uses a simple enable/disable button and immediate sending from `notify_user`. Device quotas and cross-account binding machinery were removed. See [PWA push](pwa-push.md) for setup and test limits; actual-phone delivery is not yet verified.

Enable in `librechat.yaml` and add **Notify User** to the agent's tools:

```yaml
notifications:
  enabled: true
  maxTitleLength: 120
  maxBodyLength: 2000
  maxPerMinute: 10
  pageSize: 50
  pollIntervalMs: 15000
```

Only `enabled` is needed; the other values show defaults. With configuration omitted, the tool is unavailable and the inbox is hidden. The tool accepts `{ title, body }`, not recipient identities or URLs. It obtains the caller, tenant, conversation and LangChain tool-call ID from the run and checks conversation ownership before writing. Retries share a durable identity; changing the content of an already accepted call returns `IDEMPOTENCY_CONFLICT`. Distinct requests share an atomic per-owner/tenant minute quota. Unique notification/quota indexes must exist before enabling this on a deployment that disables Mongoose automatic index creation.

`GET /api/notifications/config`, `GET /api/notifications`, and `PATCH /api/notifications/:id/read` require JWT authentication. List/read use the authenticated user and tenant, not query/body recipients. The bounded inbox puts unread entries first so older unread updates remain reachable as newer ones are marked read. It is not a paginated archive of all read notifications. Notifications persist independently of their source conversation until account deletion; deleting the conversation does not erase the notification text, and its link may no longer resolve. Do not put secrets in notification content.

The sidebar requests OS notification permission only when its enable button is clicked. New tool notifications immediately attempt push to registered devices; push failures do not erase the inbox entry. `queued` means accepted into the durable inbox, not displayed on a device. Normal chat reply alerts remain independent.

Local verification:

- Focused service/tool/HTTP/catalog, real-Mongo concurrency/tenant/storage, and inbox component tests.
- Existing account-deletion controller regression tests.
- Explicit typechecks in `packages/api`, `packages/data-schemas`, `packages/data-provider`, and `client`; package and production client builds.
- `E2E_BASE_URL=http://localhost:3099 npx playwright test --config=e2e/playwright.config.notifications.ts`: real agent execution, JWT guard, persisted read state across reloads, error/retry, desktop/mobile and light/dark screenshots. This harness always creates disposable MongoDB and refuses to reuse an existing server; no live model credentials are needed.
- Standard Lighthouse lane with synthetic 250 ms Mongo-query latency passed: median LCP 3.68 s (budget 4.5 s), CLS 0.018 (0.1), TBT 125 ms (500 ms). This checks the default-disabled startup path, not notification-enabled performance under sustained traffic.

Browser artifacts live under ignored `e2e/notifications/.test-results/`; each run attaches its source conversation URL. The inbox backend and frontend/browser coverage are committed separately on `fork/homelab`. Nothing has been pushed or deployed.

### Native codemode

Requested in addition to Pi synchronization and general notifications. This is a native LibreChat agent tool, not a dependency on a running Pi session and not a replacement for the Pi gateway.

Target model-facing API:

```js
const matches = await searchTools('service status');
const descriptor = await describeTool(matches[0].name);
const results = await Promise.allSettled([
  tools.service_status({ service: 'backups' }),
  tools.service_status({ service: 'database' }),
]);
text(results.filter((result) => result.status === 'fulfilled').map((result) => result.value));
```

Names above illustrate the interface; they do not declare tools that exist today.

Requirements:

- A JavaScript sandbox with top-level `await`, tool discovery, tool description, tool invocation, and explicit bounded output (`text`, `image`, and `return`). Only selected script output enters model context.
- Discover only the tools authorized and available to the current user, tenant, agent, and run. Describing a tool must not leak credentials or other users' integrations.
- Tool calls pass through LibreChat's existing validation, authorization, approval, cancellation, logging, and result-protection boundaries. No alternate direct MCP/provider path and no approval bypass through batching.
- Tool inputs and outputs crossing the sandbox boundary are bounded and serializable. Image forwarding should use bounded host-managed references rather than large string dumps.
- No direct filesystem, network, process, environment, credential, module import, or Node.js access. Node's `vm` alone is not an acceptable security boundary for model-authored code.
- Evaluate an embedded isolated engine such as QuickJS in a terminable worker/process. Specify memory, execution time, output, tool-call count, and concurrency limits in `librechat.yaml`; disabled by default. Validate the sandbox against synchronous infinite loops as well as unresolved promises and asynchronous tool activity before enabling it.
- Cancellation must stop sandbox execution and pending dispatch; do not promise rollback for tools that have already acted. Preserve completed results/errors for debugging without injecting all intermediate output into model context.
- No recursive codemode invocation. Notifications are available inside codemode only if the same agent is authorized to use the notification tool.
- Keep direct tools available initially. Deferred discovery/tool exposure modes and persisted cross-script state can follow after a safe basic execution path is proven.
- Tests: tool discovery isolation, argument validation, required approvals, partial failures, quotas, infinite loops, cancellation, output truncation, injection through tool results, and notification deduplication under parallel calls.

Status: requirements recorded; runtime implementation not started. Codemode does not become available merely by adding this document.

## Development order

1. Finish the notification backend foundation and focused database/service tests.
2. Deliver notification tool + authenticated inbox API + localized frontend together; add device push separately.
3. Port native Pi synchronization and add frontend cache refresh and binding/status affordances.
4. Implement codemode as an opt-in agent capability using the same host tool dispatcher and approval boundaries.
5. Exercise the complete experience against an isolated LibreChat database and synthetic providers, then plan a versioned homelab rollout.

Run focused Jest tests in each owning workspace and explicit workspace typechecks. For startup/auth/config/message-loading changes, include the repository's Lighthouse lane before completion. Visually verify frontend changes with real browser screenshots. Keep upstream changes and fork features in separable commits; no runtime patch installer in the maintained fork.
