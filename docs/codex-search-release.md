# Homelab release: Codex native search

Production: https://librechat.develium.dev

- LibreChat source: `48f12a8f2`, image `local/librechat-homelab:48f12a8f2`.
- Connector source: homelab `da61ac3`, image `local/pi-codex-connector:48f12a8f2`.
- **General** now selects `codex_web_search`. Its existing tools, instructions, model, permissions and approval settings were preserved through an authenticated partial agent update.
- Existing subscription OAuth and connector client key are unchanged. No Pi extension reload or gateway restart is needed.

The helper comes from the MIT-licensed Evizero Pi extension; its notice is included in both source and connector image. See [configuration and implementation](codex-search.md).

## Verification

- 30 connector tests, 25 focused API tests and 27 app configuration tests passed.
- API/data-schema/connector typechecks, changed-file lint and static checks passed. Static checks compared against the existing fork feature branch; full upstream-diff gates and remote CI were not represented as completed.
- Lighthouse passed. Two browser cases covered direct agent calls and codemode calls, including visible source links and no approval prompts.
- An isolated production-image preflight used a separate database containing only users, roles, conversations and messages. Schedules, agents, devices and Pi sync were excluded. The packaged QuickJS runtime worked and the production search tool completed a real subscription-backed native search with 18 sources.
- Both accounts had no active generation jobs before each applicable restart; the connector had no open requests before replacement. Only the connector and LibreChat were recreated. Mongo, other services and the laptop gateway were not restarted.
- Authenticated live reads confirmed new/previous tools and 32 existing owner conversations; the public app returned HTTP 200. A live browser verified **Codex Web Search** in General at `/c/new?agent_id=agent_VBiqk9r51OJ-awLxEvr5u` without submitting a prompt or rewriting an existing conversation.
- The temporary preflight container/database and temporary environment/config/JWT files were removed. Private recovery backups remain.

## Recovery

Backup directory on Homelab: `/home/melissa/.local/state/librechat-fork/rollback-codex-search-48f12a8f2/`. It contains the pre-rollout configuration, image identities and private Mongo archive. Protect it as sensitive user data. Do not restore the archive automatically; doing so would erase later messages and settings.

For a code-only rollback, wait for active jobs/requests to finish. Remove only `codex_web_search` from General, remove the added `codexSearch` YAML block, restore the old fork overlay (`local/librechat-homelab:174ee2b46`) and recreate only LibreChat.

The old connector release directory is retained at `/home/melissa/homelab-releases/pi-connectors-9ecfd0b/pi-connectors`. Its original image and Compose definition are unchanged. Recreate only its service with `docker compose -p pi-connectors -f <original-compose-path> up -d --no-deps --no-build codex-connector` if a connector rollback is needed. Do not copy the saved Compose file to an arbitrary directory and run it there: its private bind paths are relative to the original release directory.
