# Open Terminal Workspace

Status: implemented and verified locally on `feat/open-terminal-workspace`. Not deployed. Homelab SSH and the public LibreChat URL were unreachable from the development machine during release preparation; no production configuration, containers, databases, tools or terminal files were changed.

## Configuration

Disabled by default. Add a policy to `librechat.yaml` only after confirming that Open Terminal still exposes its REST and WebSocket APIs:

```yaml
workspace:
  enabled: true
  ownerId: ${LIBRECHAT_WORKSPACE_OWNER_ID}
  baseUrl: http://open-terminal:8000
  rootPath: /home/user
```

Set `LIBRECHAT_WORKSPACE_OWNER_ID` to the existing owner's user ID in the private server environment. Reuse `OPEN_TERMINAL_API_KEY`; never put it in the YAML, frontend, Git or browser URL. `DOMAIN_CLIENT` must identify the browser origin. Policies without a matching owner, API key or enable flag fail closed. Tenant accounts are not supported.

Defaults and configurable bounds are declared in `packages/data-provider/src/workspace.ts`: upstream/connection/auth-recheck timeouts, file/path/response/frame/buffer sizes, maximum entries/shells/dimensions and scrollback. Defaults include 256 KiB text, 5 MiB upload, 16 MiB download, two shells and 1,000 terminal scrollback lines.

## Experience and boundaries

- The Workspace sidebar browses the existing persistent `/home/user`, edits UTF-8 text, creates text files, uploads and downloads files, and opens a real PTY in the selected directory. No database migration or agent-tool change is required.
- The shell stays mounted while switching sidebar panels. Closing it, logging out, reloading, or crossing the mobile/desktop layout breakpoint disconnects it and ends its foreground processes. Files remain. Use the existing agent execution tools for work that must outlive the UI.
- Files are shared with the agent workspace, not the homelab host. The interactive shell is separately owned under `X-Session-Id: librechat-workspace:<authenticated-owner>`; it is not automatically attached to a model's conversation-scoped terminal tools.
- The browsing-root check is lexical, not an OS jail. Symlinks can point outside it; the authorized owner shell already has the container user's filesystem permissions. Do not configure this for untrusted accounts or mount host secrets into the terminal container.
- Original bytes are used for text reads, not Open Terminal's PDF/office extraction. Invalid UTF-8, binary controls and document formats are not editable. Downloads are attachments with `nosniff`, and workspace responses are non-cacheable.
- Saving checks a SHA-256 version before writing; creating/uploading refuses existing filenames. This catches changes already made by an agent, but Open Terminal provides no atomic compare-and-swap: a concurrent external write between the check and write can race. Reload explicitly before overwriting changed content.
- PTYs require existing Open Terminal `/api/terminals` REST and WebSocket routes. MCP-only mode is incompatible. Do not apply the repository's pending MCP-only image/command while enabling this panel. Confirm live protocol availability first; this feature does not change the terminal service.

The browser sends its LibreChat bearer token as the first WebSocket frame, never as a query string. The proxy checks origin, JWT, owner policy and upstream session ownership, then authenticates the upstream using the server key. Token refresh reauthenticates without restarting the shell; periodic JWT/config checks close expired, revoked or unauthorized connections. Native errors are sanitized, input/dimensions/buffers are bounded, and disconnects delete only the validated owned shell. Unconnected creations have cleanup leases. A hard process crash can leave an orphan before the lease runs; inspect and delete only that owner's dedicated terminal sessions through the authenticated management APIs, rather than restarting Open Terminal or deleting files.

Implementation follows package boundaries: shared contracts/services in data-provider, config propagation in data-schemas, injected transport/handlers/socket service in API, thin legacy route wiring, and React/Tailwind UI. It uses MIT-licensed xterm.js and FitAddon, not copied Open WebUI UI components. The xterm notice ships at `/assets/xterm-LICENSE.txt`; all feature styles are Tailwind utilities.

## Local verification

```sh
npm run frontend
(cd packages/api && npx jest --runInBand src/workspace)
(cd packages/api && npx tsc --noEmit)
(cd packages/data-provider && npx tsc --noEmit)
(cd packages/data-schemas && npx tsc --noEmit)
(cd client && npx tsc --noEmit)
E2E_BASE_URL=http://localhost:3099 npx playwright test --config=e2e/playwright.config.workspace.ts
npm run lighthouse
```

The browser harness uses disposable MongoDB, real LibreChat JWT admission and an external synthetic Open Terminal service. It covers owner/non-owner/anonymous access, real terminal byte forwarding and sidebar persistence, file edit/reload, binary rejection, upload/download byte preservation, and screenshots at `http://localhost:3099/c/new`. Ignored artifacts are under `e2e/workspace/.test-results/`. Tests do not call production or a live model. Production protocol and native PTY verification remain required before release.

## Validation result (2026-10-08)

Final checks were run serially in systemd scopes with one CPU core, no swap, and at most 6 GiB total memory for each check and its child processes. API typechecking needed a 4 GiB Node heap (measured scope peak 4.2 GiB); smaller heap attempts exited without exhausting the machine. Browser verification used bundled `chromium-headless-shell`, and the fixture now honors the configured channel. The full Chromium attempt failed during context creation; the headless-shell rerun passed.

- 36 API tests, 3 UI tests and 28 app-config tests passed.
- All four affected workspaces passed `tsc --noEmit`; the production frontend/package build passed.
- Both browser tests passed, including real JWT owner admission, uploads/downloads, editing, terminal byte forwarding and panel switching. Desktop light/dark and mobile dark screenshots were personally viewed.
- ESLint, Prettier, import sorting, package JSON, design-rule suppression, circular dependency, config migration and unused-i18n checks passed. The unused-package check was skipped because `depcheck` is not installed; no global package was installed to satisfy it.
- Lighthouse passed on the current build under the one-core cap: median LCP 4,454 ms (4,500 ms budget), CLS 0.018 (0.1), and TBT 464 ms (500 ms). These are close to the budgets under this deliberately restricted CPU allocation.
- Logs are `/tmp/workspace-{api,api-types,client,contracts,build,browser,lint,static,imports,gates,lighthouse}-final.log`; screenshots are under ignored `e2e/workspace/.test-results/`.

Production-native protocol/PTY checks, deployment, and remote CI/review remain unverified. No production changes were made. This validation did not commit or push the feature branch.

## Release checklist

1. Check live Open Terminal command/version, authenticated file routes and PTY APIs. Retain REST/WebSocket mode and the existing terminal volume; resolve any MCP-only migration separately.
2. Save private config/environment/image identities and a Mongo archive. Do not rotate keys or automatically restore the database.
3. Build the feature image and preflight it against an isolated cloned database and private config. Verify owner-only access and an actual native PTY, plus file read/save/upload/download with unique disposable test filenames. Clean up only those test shells/files.
4. Check generation jobs and dedicated Workspace shells are idle. Do not interrupt active Pi turns or restart Open Terminal, Mongo, connectors or unrelated services.
5. Enable the owner policy and recreate only LibreChat. Check public health and personally view a live screenshot with its URL. General's existing tools/settings and all chats must remain unchanged.
6. Code/config rollback restores the prior LibreChat image and removes only the added workspace block/owner variable. Never restore Mongo automatically or remove the terminal volume. Remote CI/review is a separate unverified gate.
