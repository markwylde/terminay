## Context

`convertEol` has defaulted to `true` since the app was bootstrapped, in both the client defaults (`src/terminalSettings.ts`) and the server defaults (`packages/server-core/src/settings/defaults.ts`). It is a server-owned setting (`SERVER_OWNED_TERMINAL_SETTING_KEYS`, `classification.ts`), so the authoritative value lives in the revisioned server settings snapshot that `ServerSettingsRepository` persists (`server-settings.v1.json` for the embedded server). That snapshot stores every setting explicitly. Each existing install therefore holds `"convertEol": true`, and changing the default alone would reach no existing user.

The PTY line discipline already translates LF to CR LF (`onlcr`) for programs in cooked mode. Programs in raw mode, such as `agy`, vim and most TUIs, turn `onlcr` off on purpose and send a bare LF when they mean "down one row, same column". With `convertEol` on, xterm.js adds a CR, and those programs draw text in the wrong columns.

The server's headless presentation checkpoint (`presentationCheckpoint.ts`, per ADR-0095) builds its `@xterm/headless` terminal without `convertEol`, so it has always used standard semantics. A reattached terminal's replayed screen can therefore differ today from the live view the user saw.

## Goals / Non-Goals

**Goals:**
- Raw-mode programs render in Terminay as they do in iTerm2, Ghostty and xterm.
- Existing installs pick up the fix without the user doing anything.
- A user who turns the setting on after this change keeps that choice.

**Non-Goals:**
- Removing the setting. It stays available for sources that send bare LF expecting a new line.
- Making the server's headless presentation checkpoint honour an opted-in `convertEol: true`. **Known limitation:** with the setting on, a live view and the screen replayed from a checkpoint after reload or reattach can differ for raw-mode programs, because the checkpoint always uses standard LF semantics. This mismatch already exists today for every user. This change removes it for the default, and the opt-in case stays as it is, as an accepted limitation of an option intended for unusual sources.

## Decisions

### Default `convertEol` to `false` in both default tables

Both the client and server defaults change, so a fresh server, a reset setting, and a client that has not received the snapshot yet all agree. The alternative of changing only the server default would leave the client briefly rendering with the old default before the snapshot arrives.

### One-time reset via server settings schema version 3

`SETTINGS_SCHEMA_VERSION` goes from 2 to 3. `migrateServerSettings` sets `convertEol` to `false` when the source snapshot's `schemaVersion` is missing or below 3 and the stored value is `true`. `migrateServerSettings` is the snapshot-load path; it is used by `ServerSettingsRepository.load()` and the initial state. The reset deliberately does **not** live in `normalizeSettingsAndSecrets`/`normalizeServerSettings`. The repository runs those on every settings command, passing a bare settings object with no `schemaVersion`, so a reset there would immediately undo an explicit opt-in and would also wipe it on any unrelated settings change. The repository's existing load path then backs up the raw snapshot and commits the migrated one, because the content differs. Once the snapshot is at v3 the value is never touched again, so a later explicit opt-in survives restarts.

Alternatives considered:
- *A marker field, such as `convertEolDefaultReset`.* That adds a user-visible setting key to MCP and the settings schema for a one-off. The schema version already exists for exactly this purpose.
- *Treating every `true` as the old default on every load.* That makes an explicit opt-in impossible.

A stored `true` written before v3 can't be told apart from the old default, so a user who deliberately chose `true` before this change is reset once. That is accepted: the setting is obscure, it was never surfaced as a recommendation, and it can be turned back on.

The existing shell-profile migration guards with `schemaVersion === SETTINGS_SCHEMA_VERSION`. It changes to "is a number ≥ 2", so v2 snapshots are not migrated again as shell v1 tuples once the constant is 3.

### Boundary

The migration runs inside Terminay Server's settings repository, which owns server-scoped settings. Hosts and renderers stay protocol-blind (ADR-0018, which supersedes ADR-0008 and keeps that boundary). They only receive the migrated snapshot and never rewrite server settings themselves.

## Risks / Trade-offs

- [A remote or SSH source, or a Windows ConPTY host, sends bare LF expecting a new line, so output stair-steps] → The setting remains available. Mainstream terminals don't convert either, and the PTY normally owns this translation.
- [Downgrade: an older Terminay reading a v3 snapshot] → The older migration path returns early because `shellProfiles` is present. It rewrites the snapshot as v2, and a later upgrade resets `convertEol` once more. This only matters to someone who downgrades after opting in.
- [Someone who opted in before this change loses their choice once] → Accepted, as above. Marked BREAKING in the proposal and called out in the PR description.
- [The migration placed in the per-command normaliser would defeat opt-in] → It lives only in `migrateServerSettings`; a repository test applies `convertEol: true`, then an unrelated change, then a reload, and asserts it stays `true`.
- [Opted-in live view differs from the checkpoint replay] → Known limitation; see Non-Goals.

## Migration Plan

Ships with the server. On first load, the repository runs its existing backup-then-commit path and writes v3. The Desktop and standalone backends keep only the first `.pre-migration.json` they ever wrote (`wx`, and EEXIST is ignored), so on an install that was migrated before, the v2 snapshot itself is not preserved. Rollback for this change is therefore to turn **Convert LF to CRLF** back on, which is the only value the migration alters.

## Open Questions

None.
