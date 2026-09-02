## Why

Settings and macros lived in Electron JSON files and secret storage depended on
Electron safe storage, so a headless server had no settings authority and a
remote client could not run a macro without the renderer holding the plaintext
secret it interpolated. Standalone and remote use need explicit ownership of
every setting and a vault that never uses the client as a secret relay.

## What Changes

- Classify every setting as server, connection host, device override, or
  transient client state, with revisioned server schemas, defaults,
  normalization, migrations, sanitized reads, and reset.
- Define precedence between server values and explicit device overrides without
  changing shared workspace meaning. Native accelerators, window geometry,
  updater state, and OS integration stay in Desktop and are projected to the UI
  through a versioned `DesktopPresentationMetadata` boundary.
- Move macro definitions, normalization, revision conflicts, reset, scheduling,
  waits, cancellation, and execution into server-core. Field entry and a
  non-secret preview stay client-side over a data-only Eta subset that fails
  closed on executable tags.
- Resolve secret placeholders inside the server and write the rendered output
  directly to the exact authorized PTY, so the client never receives the value.
- **BREAKING** Server secrets move into the server vault. Embedded Desktop
  performs a one-time import from Electron safe storage without writing
  plaintext files or logs.

## Capabilities

### New Capabilities
_None._

### Modified Capabilities
- `settings-shortcuts-and-desktop-integration`: settings gain an explicit
  authority classification, a server settings client boundary, and vault
  metadata disclosure rules.
- `macros`: persistence, scheduling, and execution become server-owned, with
  secret interpolation confined to the vault boundary.
- `server-owned-workspace-state`: adds the server secret vault, its headless
  envelope and unlock, and revisioned settings broadcast.

## Impact

`packages/server-core` settings and vault services, the embedded and standalone
runtime composition, the shared settings editor and `SettingsClient`, the macro
parameter modal and `macroSettings.ts` renderer, Desktop safe-storage import,
and the Desktop presentation bridge.
