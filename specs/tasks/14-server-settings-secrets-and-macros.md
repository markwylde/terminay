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

- [ ] Inventory every setting and classify it as server, connection host,
  device-specific override, or transient client state.
- [ ] Define revisioned server schemas, defaults, normalization, migrations,
  sanitized reads, and reset.
- [ ] Define precedence for server values and explicit device overrides without
  changing shared workspace meaning.
- [ ] Keep native accelerators, window geometry, updater, and OS integration in
  Desktop while sharing command/settings presentation.

### Vault

- [ ] Implement the selected server vault and headless unlock/key-management
  experience.
- [ ] Add embedded one-time import from Electron safe storage without plaintext
  files or logs.
- [ ] Expose configured/locked/unavailable metadata, never secret values.
- [ ] Implement set, replace, test, delete, rotation, restart lock, and
  audit-safe error behaviour.

### Macros

- [ ] Move definitions, normalization, revision conflicts, reset, scheduling,
  waits, cancellation, and execution to server-core.
- [ ] Keep field entry and a non-secret preview client-side.
- [ ] Resolve secret placeholders and write output directly to the exact
  authorized PTY on the server.
- [ ] Define per-run continue/cancel behaviour after launching-client
  disconnect.
- [ ] Bound templates, fields, output, delays, waits, and concurrent runs.

### Tests

- [ ] Cover every setting's classification and serialization boundary.
- [ ] Test two-client updates, stale revisions, migration, reset, and
  device-override precedence.
- [ ] Verify plaintext secrets never appear in protocol snapshots, logs, test
  traces, connection storage, or macro preview.
- [ ] Run macro editing/execution E2E locally and remotely, including
  disconnect, cancellation, inactivity waits, and exact target validation.

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
