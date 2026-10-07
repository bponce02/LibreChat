# Native Pi session sync (personal homelab)

The maintained fork imports Pi history directly; no Docker image patch is needed. One configured owner and one laptop gateway are supported. No account-management or replicated-worker layer is added.

## Setup

Keep the existing `Local Pi` custom endpoint connected to the OpenAI-compatible Pi gateway. Add to `librechat.yaml`:

```yaml
piSync:
  enabled: true
  ownerId: <your existing Mongo user ID>
```

Set a random server-only `PI_SYNC_KEY` of at least 32 characters. On the laptop use that same secret via `PI_LIBRECHAT_SYNC_KEY_FILE` and set `PI_LIBRECHAT_SYNC_URL=https://librechat.develium.dev/api/pi-sync`. These settings activate the existing `pi-connectors` snapshot publisher. Do not reuse the gateway API key. Use HTTPS. Leave sync disabled until you intentionally want session text copied into LibreChat storage/backups.

The owner must exist; snapshots cannot choose a recipient. Strict tenant-isolated deployments are unsupported. Database indexes for `PiSyncLink` must exist before enabling if automatic indexes are disabled. Existing prototype bindings use the same collection, identifiers and fingerprints.

## Behavior

- One project per working directory, including worktrees, and one deterministic conversation per Pi session.
- The active Pi branch is authoritative. Tool payloads and reasoning are not imported.
- Browser replies carry server-generated message IDs and the expected Pi leaf to the gateway; synchronization reconciles streamed replies without copying them twice.
- New terminal messages refresh automatically in an open linked chat. The composer shows binding status and a retry control if status lookup fails.
- Endpoint/model changes, stale parents, regeneration, message edits/deletes and branching in LibreChat are rejected. Edit or fork in Pi instead. A changed history prefix fails closed; it never rewrites the stored chat.
- Deleting a linked chat disables automatic recreation on the next snapshot. Account deletion cleans up bindings.
- Sync retries partial writes idempotently. It waits while LibreChat is persisting a generation. The service is for one LibreChat process.

Configuration defaults: 15-second browser polling, 2 MiB snapshots, 2,000 messages, 256 Ki characters per message. These bounds are configurable under `piSync`; defaults preserve the prototype's import limits.

## Verification

Focused API tests exercise replay, partial writes, turn correlation, branch changes, identity guards and input validation. A real disposable Mongo test exercises the native store. `e2e/playwright.config.pi.ts` checks authenticated reads, import replay, automatic terminal-message refresh and mutation guards in the real app, with mobile/desktop light/dark screenshots.

The browser test imports synthetic snapshots; it does not prove live laptop transport. The existing gateway SDK/Unix-socket tests cover that transport separately. No production rollout is implied by these checks.
