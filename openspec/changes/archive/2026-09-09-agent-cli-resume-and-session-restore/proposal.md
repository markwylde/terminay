## Why

A user who restores a previous agent conversation with the CLI's own resume
command — `claude --resume` and a picker, `codex resume --last`, `grok --continue`
— does not get an Agents row for that session. The pane stays empty. The same
session launched as a new conversation can bind; restoring it does not. Status
looks broken specifically on the path people use to come back to work.

The Resume cell in the capability matrix is already `Y` for every listed
provider. The tests behind that cell either skip, drive a different argv than
the user typed, or inject a UUID the real restore command never puts on the
process. So the matrix claims a behaviour the running app does not have.

## What Changes

- Bind a restored session for every bundled CLI that documents a resume,
  continue, or session-restore command, including the forms that put no session
  UUID on argv: a picker (`claude --resume`, `codex resume`, `omp --resume`,
  last-session shortcuts (`--continue`, `codex resume --last`,
  OpenCode `--continue`), and explicit ids where the CLI accepts them.
- After a picker, bind once the user has selected a session and that session's
  journal or store is the one the CLI is writing. Until then, do not invent a
  binding.
- Keep identity on the provider's own association. Open-handle evidence is not
  allowed as the only resume rule for a CLI that closes its journal between
  writes (Codex resume today; Claude Code already has this constraint for new
  launches).
- Replace the Resume conformance gestures with the CLI's documented restore
  commands, including a picker where that is the default. Add fixture tests
  whose argv matches those commands. Add a real-app spec that types
  `claude --resume`, selects a session, and asserts the Agents row.
- Leave the Resume matrix cell `Y` only where the real-CLI run of that restore
  command actually rebinds. If a CLI cannot restore from its own artifacts,
  the cell becomes `N` with the reason, not a claimed `Y`.

## Capabilities

### New Capabilities

- None. Resume is already a named capability; this change makes the existing
  contract match the commands users type.

### Modified Capabilities

- `agent-status-and-sidebar`: Exact terminal identity binding and each
  provider's mapping must admit the CLI's documented restore commands, not only
  a new launch or an explicit UUID on argv.
- `agent-provider-conformance`: Resume verification must drive those restore
  commands (picker, `--continue`, `--last`, explicit id). A fixture or skipped
  test is not a Resume `Y`.

## Impact

- `extensions/agent-claude-code`, `agent-codex`, `agent-grok`, `agent-opencode`,
  `agent-omp`: binding for restore argv and, where needed, the
  association used when argv has no UUID.
- `tests/agent-conformance` and each `test/conformance.test.mjs`: resume
  gestures.
- Fixture unit tests per provider for picker / `--continue` / `--last` argv.
- `e2e/real-claude-code-agent-runtime.spec.ts` (resume picker in the app);
  Codex / Grok / OpenCode real-app resume coverage where a real-CLI e2e
  already exists.
- No protocol, client, or host-API change. Observation stays inside the
  existing public Extension API. Real-CLI tests stay opt-in and off the
  pull-request merge gate (ADR-0014 / ADR-0010).
