# Homelab release: Workspace

Live: https://librechat.develium.dev/c/new?agent_id=agent_VBiqk9r51OJ-awLxEvr5u

- Source/image tag: `361f0ecdc`, image `local/librechat-homelab:361f0ecdc`, image ID `sha256:50475d5178da0eb32b13fa8e9f40438f494be02337a9aaa8de8dfa3fd5247fba`.
- Workspace is enabled for the existing owner with a literal `ownerId` and the existing server-side Open Terminal key. No extra account, approval layer, credential rotation or agent-tool selection was added.
- The owner explicitly requested skipping an isolated preflight. A direct rollout followed config/image backups and an idle check; only LibreChat was recreated.
- Open Terminal remains `ghcr.io/open-webui/open-terminal:0.14.0` in `run` mode, with its REST/WebSocket APIs and separate existing MCP adapter. Its container and persistent files were not replaced.

## Verification

Local: 36 API tests, 3 UI tests, 28 app-config tests, two browser cases, affected-workspace typechecks, production build, static gates and Lighthouse passed. The unused-package gate was skipped because `depcheck` was not installed. Checks were run serially with CPU/memory limits after the earlier unbounded parallel attempt; the API typechecker used a 4 GiB heap under a 6 GiB total cap. Remote image building used a dedicated builder limited to one CPU core and 6 GiB, then stopped that builder.

Live:

- Authenticated capability/file requests and public/internal health returned HTTP 200.
- A resource-limited real browser verified a native shell, text create/edit/reload, and upload/download byte preservation. A harmless octal-encoded `printf` produced `native shell verified`, proving shell output rather than just typed-command echo.
- The browser used a temporary server-generated owner bearer token, not a second login or agent. Desktop and mobile screenshots were personally viewed. Source URL is above; screenshots are `/tmp/librechat-workspace-live-{desktop,mobile}.png` on the development machine.
- The two unique test files were content-checked and deleted; the test shell was closed. The dedicated Workspace session list was empty afterward. Temporary bearer-token/profile files were removed.
- Before/after counts were 33 owner conversations and 515 messages. General retained all 82 selected tools and the same full-document SHA-256 fingerprint. No model prompt or existing chat was submitted/edited for verification.
- Mongo, Open Terminal, the MCP adapter, connectors and laptop gateway were not restarted. Remote CI/review was not checked.

## Recovery

Private backup: `/home/melissa/.local/state/librechat-fork/rollback-workspace-361f0ecdc/`. It contains prior YAML, fork environment, Compose overlay, image identity and the before-state summary. The prior `local/librechat-homelab:48f12a8f2` image remains available.

For code/config rollback, wait for owned shells and chat jobs to be idle, restore only the prior fork overlay and remove the added top-level workspace block, then recreate only LibreChat. Restore the whole saved YAML only if no later changes need preservation. The environment/key was not changed. Do not restore Mongo or delete/recreate the terminal volume. UI shell lifecycle and browsing-root limitations are documented in [Workspace](workspace.md).
