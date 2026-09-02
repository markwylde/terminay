## Context

See proposal.md. Three previously Electron-owned concerns had to cross into the
server at once, because they are entangled: a macro step interpolates a secret,
a secret lives in a store, and both the macro and the store are configured
through settings. Splitting them would have left a period where a headless
server could hold macros but not the secrets they need.

## Goals / Non-Goals

Goals: one explicit owner per setting; a vault that is the only holder of
plaintext secrets; macro execution that survives the disconnect of the client
that launched it.

Non-Goals: moving genuinely host-local state — native accelerators, window
geometry, updater status, OS capability flags — into the server. Those stay in
Desktop and are only projected for presentation.

## Decisions

- **A single `SETTING_AUTHORITY` table.** Classification is data, not scattered
  conditionals, so the boundary is enumerable and testable: the server-core
  settings test walks the complete table and asserts only server-owned entries
  survive serialization.
- **Secrets never cross the protocol boundary.** This crosses the client/server
  trust boundary, so the rule is absolute: the server resolves placeholders and
  writes rendered output straight to the exact authorized PTY. Protocol
  snapshots, logs, test traces, connection storage, and macro preview expose
  configured/locked/unavailable metadata only, never values.
- **A data-only template subset.** `macroSettings.ts` accepts only the
  server-compatible data-only Eta subset and fails closed on executable tags, so
  the client-side preview cannot become a second, divergent renderer. Secret
  steps render as opaque placeholders.
- **Versioned `DesktopPresentationMetadata`.** The Desktop bridge projects only
  accelerator labels and bindings from `SettingsClient`; geometry, updater
  status, and OS capability flags remain host-local behind bridge capability
  gates.
- **A passphrase envelope adapter with an atomic file storage boundary.** The
  headless vault zeroizes on lock and restart and its tests assert on metadata
  only.

## Risks / Trade-offs

Moving macro execution to the server makes a launching client's disconnect a
policy question rather than an accident; per-run continue/cancel behaviour is
defined explicitly. Bounds on templates, fields, output, delays, waits, and
concurrent runs are required because a macro is now a server-side resource
consumer.

## Migration Plan

Embedded Desktop imports existing Electron safe-storage secrets into the vault
once, without producing plaintext files or logs. Server settings carry revisions
so concurrent edits from two clients produce a conflict rather than a silent
overwrite.
