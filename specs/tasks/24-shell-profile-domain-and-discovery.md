# Shell profile domain and discovery

## Goal

Introduce the server-owned shell-profile model, platform discovery, validation,
and idempotent migration needed by the canonical terminal launch resolver.

Governing features:

- [Shell profiles and terminal launch](../features/shell-profiles-and-terminal-launch.md)
- [Settings, shortcuts, and desktop integration](../features/settings-shortcuts-and-desktop-integration.md)
- [Server-owned workspace state](../features/server-owned-workspace-state.md)

## Current gap

Shell configuration is one `program` string, a generic startup mode, and one
shell-parsed argument string. Candidate selection is host code rather than a
server capability, discovered shells are not visible, and the settings schema
cannot represent named profiles, argument boundaries, environment overlays,
WSL distributions, availability, or stable default references.

## Implementation slices

- [x] Define bounded protocol/domain types for System default, discovered, and
  custom profiles; structured native/WSL targets; startup mode; argument arrays;
  environment overlays; presentation metadata; availability; source; order;
  and default references.
- [x] Enforce 16-KiB per-profile and 32-KiB aggregate encoded budgets, return
  environment-redacted catalogue/settings summaries, and expose one bounded
  profile detail only to write-authorized clients.
- [x] Advance the server settings schema and normalize every nested profile
  field explicitly. Reject protected environment names, secret-like fields,
  duplicate ids/names, invalid references, unsupported target shapes, and
  over-limit collections.
- [x] Implement idempotent migration from `shell.program`,
  `shell.startupMode`, and `shell.extraArgs`, including deterministic migrated
  ids, safe one-time argument parsing, repository backup, retry behaviour, and
  an unavailable state for values that require review.
- [x] Implement a server-owned discovery/validation service for macOS, Linux,
  Windows native shells, Git Bash, and installed WSL distributions. Keep
  discovered candidates separate from durable settings and canonicalize and
  deduplicate host paths.
- [x] Add read-authorized profile catalogue/discovery capabilities and
  write-authorized custom-profile/default mutations with revisions, command-id
  idempotency, conflict results, a shared mutation lock, and referential-
  integrity checks. Referenced deletion fails until server/project defaults are
  reassigned through their own revisioned authorities.
- [x] Add project-default profile identity to canonical project state and named
  revisioned commands to set, replace, and clear it without accepting an
  executable or environment from the client.
- [x] Permit discovered profiles for current-catalogue one-off launch, but
  require System default or a durable custom profile for server/project
  defaults; copying discovery data creates the durable identity explicitly.
- [x] Record bounded metadata-only audit/diagnostic outcomes for discovery,
  validation, migration, and mutation; never record environment values.
- [x] Reserve the profile subtree from generic settings mutations and reserve
  profile-default project commands from generic workspace mutation so dedicated
  validation and referential checks cannot be bypassed.

## Acceptance checks

- A clean macOS/Linux server resolves System default from the account shell and
  returns deduplicated executable `/etc/shells` candidates; a missing or invalid
  inherited `SHELL` does not override the account shell.
- Windows fixtures discover PowerShell 7, Windows PowerShell, Command Prompt,
  Git Bash, and structured WSL distributions only when available.
- Two servers with different shells return independent catalogues, and a client
  cannot persist a profile or project default outside its connected server.
- Profile validation preserves argument boundaries and `null` environment
  removal while rejecting protected names, secret material, command strings,
  malformed WSL targets, and bounded-limit violations.
- Migration fixtures cover default legacy settings, explicit programs, System
  default plus legacy arguments, quoted/escaped arguments, invalid legacy
  values, retry after interruption, and reset.
- Renaming or reordering preserves profile identity. Deleting a referenced
  profile reports every blocking server/project reference; after they are
  independently reassigned, deletion rechecks and succeeds without a dangling
  reference.
- Discovery changes availability without silently deleting a custom profile or
  changing a selected default.
- A discovered profile can launch once but cannot become a durable default until
  copied into a validated custom profile.

## Definition of done

The server owns a tested, revisioned, migratable shell-profile catalogue and
project-default reference model; all protocol and normalization tests pass on
platform fixtures; and no production PTY route has been switched to the new
model until Task 25 supplies the single launch boundary.
