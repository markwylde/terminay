# Server settings, secrets, and macros

## Goal

Classify settings by authority and move server preferences, vault-backed
secrets, and macro persistence/execution into Terminay Server.

## Governing specifications

- [Settings, shortcuts, and desktop integration](../features/settings-shortcuts-and-desktop-integration.md)
- [Macros](../features/macros.md)
- [Server-owned workspace state](../features/server-owned-workspace-state.md)

## Why this is active

Settings and macros are Electron JSON, secret storage depends on Electron safe
storage, and macro rendering can expose plaintext secrets to the renderer.
Standalone and remote use require explicit ownership and a vault that never
uses the client as a secret relay.

## Dependencies

- [Standalone and embedded server runtime](./6-standalone-and-embedded-server-runtime.md)
- [Server-owned workspace model](./5-server-owned-workspace-model.md)

## Work slices

### Settings classification

- [x] Inventory every setting and classify it as server, connection host,
  device-specific override, or transient client state.
- [x] Define revisioned server schemas, defaults, normalization, migrations,
  sanitized reads, and reset.
- [x] Define precedence for server values and explicit device overrides without
  changing shared workspace meaning.
- [x] Keep native accelerators, window geometry, updater, and OS integration in
  Desktop while sharing command/settings presentation. The versioned
  `DesktopPresentationMetadata` boundary projects only accelerator labels and
  bindings from `SettingsClient`; geometry, updater status, and OS capability
  flags remain host-local. `apps/terminay-desktop/test/desktop-presentation.test.mjs`
  covers all four areas and the bridge capability gates.

### Vault

- [x] Implement the selected server vault and headless unlock/key-management
  experience with a server-core passphrase envelope adapter, atomic file
  storage boundary, zeroization, lock/restart, and metadata-only tests.
- [x] Add embedded one-time import from Electron safe storage without plaintext
  files or logs.
- [x] Expose configured/locked/unavailable metadata, never secret values.
- [x] Compose settings and vault services in embedded/standalone runtime with
  metadata-only diagnostics and exact target-scoped server callbacks.
- [x] Implement set, replace, test, delete, rotation, restart lock, and
  audit-safe error behaviour.

### Macros

- [x] Move definitions, normalization, revision conflicts, reset, scheduling,
  waits, cancellation, and execution to server-core.
- [x] Keep field entry and a non-secret preview client-side. The shared macro
  parameter modal owns field entry and preview rendering; `macroSettings.ts`
  now accepts only the server-compatible data-only Eta subset, fails closed on
  executable tags, and keeps secret steps as opaque placeholders. The focused
  `macro-preview.test.mjs` fixture covers fields, conditionals, rejection, and
  redaction.
- [x] Resolve secret placeholders and write output directly to the exact
  authorized PTY on the server.
- [x] Define per-run continue/cancel behaviour after launching-client
  disconnect.
- [x] Bound templates, fields, output, delays, waits, and concurrent runs.

### Tests

- [x] Cover every setting's classification and serialization boundary. The
  server-core settings test enumerates the complete `SETTING_AUTHORITY` table
  and verifies that only server-owned entries survive serialization.
- [x] Test two-client updates, stale revisions, migration, reset, and
  device-override precedence.
- [x] Verify plaintext secrets never appear in protocol snapshots, logs, test
  traces, connection storage, or macro preview.
- [x] Run macro editing/execution E2E locally and remotely, including
  disconnect, cancellation, inactivity waits, and exact target validation.
- [x] Route the production settings editor's persisted updates and reset
  through the shared `SettingsClient`, while secret-value operations remain
  preload-only. `task14-settings-client-path.test.mjs` verifies this boundary.

## Acceptance checks

- Server settings and macros persist and synchronize across two clients.
- Desktop-only preferences do not appear on a headless server.
- Embedded secrets migrate without plaintext artifacts.
- A remote macro uses a secret without the client receiving it.
- Concurrent macro/settings edits produce revisions or conflicts, not silent
  overwrite.

## Definition of done

Settings have explicit ownership, server secrets remain inside the server
vault, and macro execution is client-independent and transport-neutral.
