# Maintaining the homelab fork

## Branch ownership

- `upstream`: `https://github.com/LibreChat-AI/LibreChat.git`.
- `origin`: `https://github.com/bponce02/LibreChat.git`.
- `main` mirrors upstream `main`; never put homelab feature commits there.
- `fork/homelab` is the maintained integration branch. Deployment candidates come from reviewed, tested commits on this branch, not an automatically advancing image tag.
- `feat/*` branches start from `fork/homelab`. Merge only after feature tests, typechecks, builds, and applicable browser/performance checks pass. Keep Pi sync, notifications, and codemode separate.

The initial integration baseline is `e1dfc10449ff713faffacd60273fddcfe2c0a698`. Fetching upstream confirmed `main` and `upstream/main` matched when this workflow was established. Local commits and branch creation do not push or deploy anything.

## Upstream update procedure

Start with clean checkouts and preserve uncommitted work; do not use a bare stash pop. Run the following in a dedicated update checkout (or a native Herdr worktree when working through Herdr):

```sh
git fetch --no-tags upstream main
git fetch --no-tags origin
git switch main
git merge --ff-only upstream/main
git switch -c sync/upstream-YYYY-MM-DD fork/homelab
git merge --no-ff upstream/main
```

If the fast-forward fails, investigate the divergent commits rather than resetting or force-pushing. If the upstream merge conflicts, resolve the native integration points below; do not regenerate source patches. Review upstream release notes and dependency/schema/configuration changes even when Git merges cleanly. Never rebase or force-push the shared integration branch.

Verify the update branch before merging it into `fork/homelab`. Push the mirror and integration branch explicitly only after review; never use `git push --all`. A native Herdr update worktree must be committed and finished through `herdr_finish_worktree`, not a manual worktree merge.

## Notification integration points

Most behavior lives under `packages/api/src/notifications`, notification-specific database modules, and `client/src/components/SidePanel/Notifications`. The remaining seams are intentional:

- Shared configuration, contracts and API exports in `packages/data-provider`.
- Database model/method exports, application configuration mapping and account deletion cleanup.
- Agent tool registry, manifest, loader and catalog filtering.
- Express route exports and mounting; keep behavior in the TypeScript package.
- Sidebar navigation, badge rendering, English localization and data-provider hooks.
- Existing PWA worker generation/registration when adding push; do not install a competing root worker.

## Release checks

Install with the repository-supported Node/npm versions and `npm ci`. Build shared packages, then run explicit `npx tsc --noEmit` in each affected workspace. Run focused notification tests in `packages/api`, `packages/data-schemas`, and `client`, plus account-deletion controller tests in `api`.

Build the production client and run:

```sh
E2E_BASE_URL=http://localhost:3099 npx playwright test --config=e2e/playwright.config.notifications.ts
npm run lighthouse:run
```

The notification lane uses a disposable database and a synthetic provider, not production. Verify desktop/mobile and light/dark screenshots, source URLs, error/retry behavior, restored sessions, and disabled-by-default behavior. For push, add real worker tests and on-device installed-PWA checks; browser emulation is not proof of OS delivery.

The PWA feature branch adds `.github/workflows/fork-notifications.yml` for pull requests targeting `fork/homelab`. It runs focused tests, typechecks, production builds and isolated browser checks on Node 24 without provider secrets. It has not run remotely until these local commits are pushed and a PR is opened. Keep the existing Lighthouse gate as an additional release requirement.

Run scoped import sorting, lint, formatting, and `git diff --check`. Review the exact candidate SHA, build a pinned image, back up the database, and schedule deployment separately. Do not restart the live app during active conversations. Roll back the image to the prior pinned SHA if needed; do not assume database changes can be rolled back by an image change.
