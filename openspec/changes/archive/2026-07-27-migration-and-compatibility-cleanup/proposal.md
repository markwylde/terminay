## Why

The server-backed architecture changes persistence, credentials, UI ownership,
connection profiles, and remote origins. A flag-day replacement can lose user
state, and removing the old Electron-owned paths before full parity can make
recovery impossible. Existing Desktop installations therefore need a tested,
recoverable migration before any transitional implementation is deleted.

## What Changes

- Add a bounded, alias-aware migration preflight that inventories settings,
  macros, safe-storage secrets, remote devices, reconnect grants, audit records,
  TLS paths, recordings, and connection metadata from every supported Desktop
  release, excluding values.
- Add an idempotent embedded import with a completion marker, a backup, resumable
  failure, and no plaintext secret files; project files and recordings stay in
  place and missing paths are represented explicitly.
- Detect cloned or colliding server identities and require explicit resolution;
  report renderer-only historic layouts as unrecoverable and commit the new
  canonical workspace snapshot immediately.
- Move or redirect sanitized `app.terminay.com` manager metadata to
  `web.terminay.com` without copying cross-origin credentials, preserve existing
  `<session>.terminay.com` origins and valid reconnect grants, and migrate Desktop
  connection profiles separately from server trust state.
- Define minimum versions and precise incompatibility errors across Desktop,
  server, bundled UI, bootstrap, and signaling, and enforce backward-compatible
  hosted deployment ordering before dependent clients.
- Keep the direct server-bundled UI as a credential-free recovery client, and
  restore pre-migration Electron state on rollback only before server-only
  mutations commit, with explicit backup recovery after that boundary.
- **BREAKING** Remove the broad application preload IPC, renderer workspace
  authority, hidden Electron WebRTC hosting, the terminal-only remote protocol and
  UI, and the temporary compatibility adapters, replacing them with narrow frozen
  versioned host capabilities that carry no project or server data authority.
- **BREAKING** Require canonical live subscriptions before a feature client can be
  constructed, so a query/command-only compatibility bridge can no longer leave a
  stale renderer projection looking authoritative.

## Capabilities

### New Capabilities
_None._

### Modified Capabilities
- `server-owned-workspace-state`: adds migration import, inventory, rollback, and
  recovery guarantees, and removes renderer-held second authorities over
  server-owned data.
- `connections-and-client-hosts`: reduces the Desktop host surface to narrow
  versioned native-presentation capabilities, defines minimum-version
  incompatibility reporting and hosted deployment ordering, and keeps the
  server-bundled UI as a recovery client.

## Impact

`packages/server-core` migration runner, inventory, and recovery; the Desktop
preload and its host bridges; `packages/client-core` feature facades; the shared
renderer composition root; the compatibility matrix and boundary test suites; and
the static web build contract.
