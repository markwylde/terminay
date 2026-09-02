## Context

See proposal.md. The goal was to observe a user-started interactive `omp`
process by using OMP's terminal-scoped breadcrumb to bind its exact JSONL
session to the exact PTY, then reduce durable records into the existing
canonical agent model.

Out of scope, deliberately: any change in the oh-my-pi repository; wrapping
`omp`, installing a plugin, or registering Terminay as an omp MCP server;
spawning `omp --rpc` or `omp acp`; claiming `waiting` or `blocked` for omp
permission prompts, since no journal record exists for them; and Windows
journal binding, which has the same darwin/linux `lsof`/procfs limit as Codex.

The OMP journal facts implemented against, without importing oh-my-pi:

- Sessions root `~/.omp/agent/sessions/<encoded-cwd>/<timestamp>_<id>.jsonl`,
  with `PI_CODING_AGENT_DIR`, then `OMP_PROFILE`, then `PI_PROFILE`, and Linux
  XDG after migration.
- A physical first line that is a 256-byte `type: "title"` slot; the logical
  first record is `type: "session"` with an `id`.
- A terminal breadcrumb under `terminal-sessions/<tty-derived-id>` holding the
  exact cwd and session-file path, with an optional `fresh` marker before lazy
  JSONL materialization.
- Live tool start as `type: "custom"` with `customType: "tool_execution_start"`,
  and exit as `customType: "session_exit"`.
- Children at `<parent-stem>/<agentId>.jsonl`.
- A process title of `omp`, which on a macOS shebang run may still appear as
  `bun`.

## Goals / Non-Goals

Goals:
- Zero-configuration observation: ordinary `omp` with no extra flags, hooks, or
  MCP.
- Exact terminal binding, so two `omp` terminals in the same cwd never share a
  row.
- No change to Codex or Claude Code behaviour.

Non-Goals:
- Projecting tool arguments, assistant text, or tool output.
- Any authoritative state derived from cwd, newest mtime, or terminal titles.

## Decisions

- **Breadcrumb is the only binding.** OMP's terminal id is derived from the
  exact PTY TTY and the matching bounded breadcrumb is resolved under the
  effective OMP root. Its cwd, path, and `fresh` fields are validated, and only
  a materialized root JSONL below an allowed sessions root is admitted. Newest
  mtime or encoded cwd alone never establishes a binding.
- **Roots versus children.** Only encoded-cwd root `*.jsonl` files are roots;
  nested `<parent-stem>/*.jsonl` files are children and map to
  `subagent.started` / `subagent.stopped`.
- **Title slot is skipped, not parsed.** The 256-byte physical `title` line is
  skipped before inspection; a `type: "title"` line must never be mistaken for
  Codex `session_meta`, and a stable `type: "session"` id is required.
- **Rebinding is expected.** The breadcrumb is rechecked while OMP remains
  foreground, rebinding on session switch. Because OMP v18 may atomically
  replace and close JSONL writers, the tailer handles atomic replacement as well
  as shrink and reset, and open-FD sampling is treated only as supplementary
  evidence.
- **A `bun` process is admitted only with proof.** The existing leave-shell
  discovery window lets a `bun`-named wrapper begin OMP discovery, but the row
  appears only when that exact PTY TTY has a valid OMP breadcrumb target.
- **Fresh sessions wait.** A fresh, pre-file `omp` stays on terminal-activity
  fallback until its breadcrumb target materializes, rather than stealing
  another session.

## Risks / Trade-offs

- Breadcrumb-only binding means a session with a missing or malformed breadcrumb
  is not shown authoritatively; that is preferred to a heuristic match.
- OMP permission prompts leave no journal record, so `waiting` and `blocked` are
  not claimed for omp.
- Windows is unsupported for journal binding, matching the existing Codex limit.
