# Migration and compatibility cleanup

## Goal

Migrate existing Desktop data safely, prove product parity, remove transitional
implementations, and leave the server-backed architecture as the only product
authority.

## Governing specifications

- [Terminay core](../CORE.md)
- [Server-owned workspace state](../features/server-owned-workspace-state.md)
- [Connections and client hosts](../features/connections-and-client-hosts.md)
- Every feature specification whose state or service belongs to the server.

## Why this is active

The architecture changes persistence, credentials, UI ownership, connection
profiles, and remote origins. A flag-day replacement can lose user state, and
removing old paths before full parity can make recovery impossible.

## Dependencies

- [Workspace and protocol foundation](../tasks_completed/4-workspace-and-protocol-foundation.md)
- [Server-owned workspace model](./5-server-owned-workspace-model.md)
- [Standalone and embedded server runtime](./6-standalone-and-embedded-server-runtime.md)
- [Desktop connection host and Local mode](./7-desktop-connection-host-and-local-mode.md)
- [Server terminal service](./8-server-terminal-service.md)
- [Server activity and agent services](./9-server-activity-and-agent-services.md)
- [Server MCP control](./10-server-mcp-control.md)
- [Server files and file viewer](./11-server-files-and-file-viewer.md)
- [Server Git, worktrees, and Quick Push](./12-server-git-worktrees-and-quick-push.md)
- [Server recordings](./13-server-recordings.md)
- [Server settings, secrets, and macros](./14-server-settings-secrets-and-macros.md)
- [Server AI metadata and dictation](./15-server-ai-and-dictation.md)
- [Shared responsive server UI](./16-shared-responsive-server-ui.md)
- [Full WebRTC server connections](./17-full-webrtc-server-connections.md)
- [Connection menu and web host](./18-connection-menu-and-web-host.md)

## Work slices

### Data inventory and import

- [x] Inventory/version settings, macros, safe-storage secrets, remote devices,
  reconnect grants, audit records, TLS paths, recordings, and connection
  metadata from every supported Desktop release via bounded alias-aware
  preflight (`inspectLegacyMigration.storeVersions`); values remain excluded.
- [x] Implement idempotent embedded import with completion marker, backup,
  resumable failure, and no plaintext secret files.
- [x] Preserve project files and recordings in place and represent missing
  paths explicitly in the bounded migration inventory (`inspectLegacyMigration`)
  (`packages/server-core/test/migration-inventory.test.mjs`).
- [ ] Explain that renderer-only historic layouts cannot be recovered; persist
  the new canonical workspace immediately.
- [x] Report renderer-only historic layouts as unrecoverable during migration
  preflight (`inspectLegacyMigration`, `packages/server-core/test/migration-inventory.test.mjs`).
- [x] Detect cloned/colliding server identities and require explicit
  resolution.

### Manager and connection migration

- [x] Move or redirect sanitized `app.terminay.com` manager metadata to
  `web.terminay.com` without copying cross-origin credentials
  (`sanitizeManagerProfiles`, `packages/server-core/test/migration-compatibility.test.mjs`).
- [ ] Preserve existing `<session>.terminay.com` origins and valid reconnect
  grants.
- [x] Migrate Desktop connection profiles separately from server trust state
  (`separateConnectionProfilesFromTrust`,
  `packages/server-core/test/migration-compatibility.test.mjs`).
- [x] Verify pairing fragments and credentials never enter either manager
  origin; non-canonical profile URLs are rejected and trust/profile outputs
  omit credential-bearing fields (`sanitizeManagerProfiles`, same test).

### Compatibility and rollback

- [ ] Define temporary flags/adapters for old renderer and terminal-only remote
  paths during development.
- [x] Define minimum versions and precise incompatibility errors across Desktop,
  server, bundled UI, bootstrap, and signaling. Compatibility-matrix tests
  assert deterministic minimum-version errors before migration or backup.
- [ ] Deploy backward-compatible hosted changes before dependent clients.
- [x] Keep direct server-bundled UI as the recovery client via explicit
  credential-free fallback metadata (`createRecoveryClientFallback`,
  `packages/server-core/test/migration-recovery.test.mjs`).
- [ ] Restore pre-migration Electron state on rollback only before server-only
  mutations commit; provide explicit backup recovery after that boundary.

### Parity and cleanup

- [ ] Complete the feature matrix for Local Desktop, remote Desktop, wide web,
  and mobile web.
- [ ] Run existing E2E suites through the application protocol plus full real
  pairing/reconnect coverage.
- [ ] Remove broad application preload IPC, renderer workspace authority,
  hidden Electron WebRTC hosting, old terminal-only remote protocol/UI, and
  temporary adapters only after parity.
- [x] Verify feature specifications remain present-tense product contracts;
  migration-progress qualifiers were removed from the recording and
  server-runtime compatibility contracts; progress remains in this task.

## Acceptance checks

- A supported Desktop profile migrates settings, macros, secrets, remote trust,
  profiles, and recordings without plaintext leakage or data loss.
- Interrupted import resumes or rolls back from a tested backup.
- Existing session origins reconnect or receive one explicit repair path.
- Local Desktop, three remote Desktop windows, wide web, and mobile web pass
  the feature parity matrix.
- Old duplicate application/remote authorities are absent from production.

## Definition of done

Existing users have a tested recoverable migration, the full product passes
through the server architecture, and no transitional implementation remains as
a second authority.
