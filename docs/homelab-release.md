# Homelab release: 174ee2b46

Deployed to https://librechat.develium.dev using `local/librechat-homelab:174ee2b46` (manifest `sha256:c4b3858296668c0404343c0926844ad85efb845e27bc5a3a28ae2440fcc551b5`). The base compose file is unchanged; `librechat/docker-compose.fork.yml` in the homelab checkout selects the versioned image and private fork environment file.

Enabled: inbox/push configuration, native single-owner Pi sync, JavaScript codemode with selected-tool dispatch and opaque image forwarding. The General agent has `codemode` and `notify_user` added; existing tools and approval settings were preserved. No new approval prompts are introduced. Existing execution-policy denials still fail closed.

## Checks

- 70 focused API tests, package typechecks, Pi connector tests and Lighthouse passed locally.
- Isolated browser checks exercised agent → codemode → notification without prompts, Pi import/live refresh/protections and Pi notification replay.
- The built production image was checked against an isolated clone containing only users, roles, conversations and messages. No schedules, devices or agents were cloned. The temporary container/database were removed afterward.
- Both live accounts reported no active generation jobs before replacing LibreChat. Mongo and companion services were not restarted.
- After rollout, authenticated reads showed 17 existing owner conversations, available fork tools, valid push readiness and a functioning packaged QuickJS worker. The public app returned HTTP 200.
- Two idle Pi sessions imported automatically. A laptop-forwarded deployment notification reached the live inbox once. There were no registered push devices, so this did not prove OS delivery.
- A real Chromium preview displayed the live inbox at `/c/new`; no model prompt or existing conversation rewrite was used for verification.

Existing Pi processes require `/reload` after their current turn finishes to register the new notification tool. New sessions load it automatically. The device owner must enable push through the sidebar button; permission is never requested automatically.

The image and source commits are local/self-hosted. No remote Git push or remote CI run is implied.

## Operations and rollback

On `Homelab`, run compose from `/home/melissa/homelab/librechat`:

```sh
sudo docker compose -f docker-compose.yml -f docker-compose.fork.yml up -d --no-deps librechat
```

Private credentials live in `config/env/librechat/fork.env`, excluded from Git. The laptop sync key is a private `0600` file under `~/.local/state/pi-gateway/`; notification forwarding references that file rather than embedding the credential in tool arguments.

Rollback backup: `/home/melissa/.local/state/librechat-fork/rollback-174ee2b46/`. It contains the previous config/compose/image identity and a private Mongo archive. Preserve it as sensitive user data.

To roll back code, first wait for active jobs to finish and remove the two added General-agent tools using the agent builder. Disable laptop history publishing while leaving active local sessions alone. Restore the backed-up `librechat.yaml`, then recreate only LibreChat with the base compose file (no fork overlay). Keep imported chats read-only after rollback, since bound-history protections exist only in the fork.

Do not automatically restore the Mongo archive: that would erase conversations or other changes made after the backup. Use it only for an explicitly approved data recovery. No database data was deleted by this rollout.
