## 1. Settings classification

- [x] 1.1 Inventory every setting and classify it as server, connection host,
  device-specific override, or transient client state, verified by the
  `SETTING_AUTHORITY` table enumeration test
- [x] 1.2 Define revisioned server schemas, defaults, normalization, migrations,
  sanitized reads, and reset, verified by server-core settings tests
- [x] 1.3 Define precedence for server values and explicit device overrides
  without changing shared workspace meaning, verified by device-override
  precedence tests
- [x] 1.4 Keep native accelerators, window geometry, updater, and OS integration
  in Desktop while sharing command/settings presentation through the versioned
  `DesktopPresentationMetadata` boundary, verified by
  `apps/terminay-desktop/test/desktop-presentation.test.mjs` covering all four
  areas and the bridge capability gates

## 2. Vault

- [x] 2.1 Implement the server vault and headless unlock/key-management flow
  with a server-core passphrase envelope adapter, atomic file storage boundary,
  zeroization, and lock/restart, verified by metadata-only tests
- [x] 2.2 Add embedded one-time import from Electron safe storage, verified by
  asserting no plaintext files or log lines are produced
- [x] 2.3 Expose configured/locked/unavailable metadata and never secret values,
  verified by vault metadata tests
- [x] 2.4 Compose settings and vault services in the embedded and standalone
  runtime with metadata-only diagnostics and exact target-scoped server
  callbacks, verified by composition tests
- [x] 2.5 Implement set, replace, test, delete, rotation, restart lock, and
  audit-safe error behaviour, verified by vault operation tests

## 3. Macros

- [x] 3.1 Move definitions, normalization, revision conflicts, reset,
  scheduling, waits, cancellation, and execution to server-core, verified by
  server-core macro tests
- [x] 3.2 Keep field entry and a non-secret preview client-side over the
  data-only Eta subset that fails closed on executable tags and renders secret
  steps as opaque placeholders, verified by `macro-preview.test.mjs` covering
  fields, conditionals, rejection, and redaction
- [x] 3.3 Resolve secret placeholders and write output directly to the exact
  authorized PTY on the server, verified by macro execution tests
- [x] 3.4 Define per-run continue/cancel behaviour after launching-client
  disconnect, verified by disconnect policy tests
- [x] 3.5 Bound templates, fields, output, delays, waits, and concurrent runs,
  verified by bounded-run tests

## 4. Tests

- [x] 4.1 Cover every setting's classification and serialization boundary,
  verified by the server-core settings test enumerating the complete
  `SETTING_AUTHORITY` table
- [x] 4.2 Test two-client updates, stale revisions, migration, reset, and
  device-override precedence, verified by server-core settings tests
- [x] 4.3 Verify plaintext secrets never appear in protocol snapshots, logs,
  test traces, connection storage, or macro preview, verified by redaction
  assertions
- [x] 4.4 Run macro editing and execution end to end locally and remotely,
  including disconnect, cancellation, inactivity waits, and exact target
  validation, verified by the E2E suite
- [x] 4.5 Route the production settings editor's persisted updates and reset
  through the shared `SettingsClient` while secret-value operations remain
  preload-only, verified by `task14-settings-client-path.test.mjs`

## 5. Acceptance

- [x] 5.1 Server settings and macros persist and synchronize across two clients
- [x] 5.2 Desktop-only preferences do not appear on a headless server
- [x] 5.3 Embedded secrets migrate without plaintext artifacts
- [x] 5.4 A remote macro uses a secret without the client receiving it
- [x] 5.5 Concurrent macro/settings edits produce revisions or conflicts, not a
  silent overwrite
