## Why

Shell configuration was one `program` string, a generic startup mode, and one shell-parsed
argument string. Candidate selection lived in host code rather than being a server capability,
discovered shells were not visible, and the settings schema could not represent named profiles,
argument boundaries, environment overlays, WSL distributions, availability, or stable default
references.

## What Changes

- Introduce a server-owned shell-profile domain covering System default, discovered, and custom
  profiles, with structured native and WSL targets, startup modes, argument arrays, environment
  overlays, presentation metadata, availability, source, order, and default references.
- Add a server-owned discovery and validation service for macOS, Linux, Windows native shells,
  Git Bash, and installed WSL distributions.
- Advance the server settings schema with explicit normalization and rejection rules, and add
  bounded per-profile and aggregate encoded budgets.
- Add read-authorized catalogue and discovery capabilities and write-authorized custom-profile
  and default mutations with revisions, command-id idempotency, conflict results, a shared
  mutation lock, and referential-integrity checks.
- Add a project-default profile identity to canonical project state with named revisioned
  commands to set, replace, and clear it.
- Implement idempotent migration from `shell.program`, `shell.startupMode`, and
  `shell.extraArgs`.
- Reserve the profile subtree from generic settings mutations and profile-default project
  commands from generic workspace mutation.

## Capabilities

### New Capabilities

_None._

### Modified Capabilities

- `shell-profiles-and-terminal-launch`: adds the server-owned profile catalogue, discovery,
  validation, bounds, defaults, and legacy migration.

## Impact

Server settings schema and repository, canonical project state, the application protocol's
profile catalogue and mutation commands, and platform discovery on macOS, Linux, and Windows.
No production PTY route is switched to the new model by this change.
