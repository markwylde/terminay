## 1. Domain and protocol types

- [x] 1.1 Define bounded protocol/domain types for System default, discovered, and custom profiles; structured native/WSL targets; startup mode; argument arrays; environment overlays; presentation metadata; availability; source; order; and default references, verified by protocol type tests.
- [x] 1.2 Enforce 16-KiB per-profile and 32-KiB aggregate encoded budgets, return environment-redacted catalogue/settings summaries, and expose one bounded profile detail only to write-authorized clients, verified by bounds and redaction tests.

## 2. Settings schema and migration

- [x] 2.1 Advance the server settings schema and normalize every nested profile field explicitly, rejecting protected environment names, secret-like fields, duplicate ids/names, invalid references, unsupported target shapes, and over-limit collections, verified by normalization tests.
- [x] 2.2 Implement idempotent migration from `shell.program`, `shell.startupMode`, and `shell.extraArgs` with deterministic migrated ids, safe one-time argument parsing, repository backup, retry behaviour, and an unavailable state for values requiring review, verified by migration fixtures covering default legacy settings, explicit programs, System default plus legacy arguments, quoted/escaped arguments, invalid legacy values, retry after interruption, and reset.

## 3. Discovery

- [x] 3.1 Implement a server-owned discovery/validation service for macOS, Linux, Windows native shells, Git Bash, and installed WSL distributions, keeping discovered candidates separate from durable settings and canonicalizing and deduplicating host paths, verified by platform fixtures.
- [x] 3.2 Verify a clean macOS/Linux server resolves System default from the account shell and returns deduplicated executable `/etc/shells` candidates, and that a missing or invalid inherited `SHELL` does not override the account shell.
- [x] 3.3 Verify Windows fixtures discover PowerShell 7, Windows PowerShell, Command Prompt, Git Bash, and structured WSL distributions only when available.

## 4. Capabilities and mutations

- [x] 4.1 Add read-authorized profile catalogue/discovery capabilities and write-authorized custom-profile/default mutations with revisions, command-id idempotency, conflict results, a shared mutation lock, and referential-integrity checks, verified by protocol tests including a deletion that reports every blocking reference and succeeds after independent reassignment.
- [x] 4.2 Add project-default profile identity to canonical project state with named revisioned commands to set, replace, and clear it without accepting an executable or environment from the client, verified by project-state tests.
- [x] 4.3 Permit discovered profiles for current-catalogue one-off launch while requiring System default or a durable custom profile for server/project defaults, verified by a test proving a discovered profile launches once but cannot become a durable default until copied.
- [x] 4.4 Verify two servers with different shells return independent catalogues and a client cannot persist a profile or project default outside its connected server.
- [x] 4.5 Verify renaming or reordering preserves profile identity, and that discovery changes availability without deleting a custom profile or changing a selected default.

## 5. Boundaries and diagnostics

- [x] 5.1 Record bounded metadata-only audit/diagnostic outcomes for discovery, validation, migration, and mutation, verified by tests asserting no environment value is recorded.
- [x] 5.2 Reserve the profile subtree from generic settings mutations and profile-default project commands from generic workspace mutation, verified by tests proving dedicated validation cannot be bypassed.
