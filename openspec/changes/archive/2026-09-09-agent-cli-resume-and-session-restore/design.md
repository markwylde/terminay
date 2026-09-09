## Context

Agent status is an observation problem inside the extension child. The child
sees the PTY process tree and provider files through the public observation
API; it does not wrap the CLI, edit its config, or read conversation payloads.
ADR-0009 keeps that observation environment-routed. ADR-0011 keeps the
untrusted-provider-binary boundary: we consume what the CLI already writes.
ADR-0014 says every Resume `Y` is proven against the real CLI. ADR-0010 keeps
that proof off the pull-request merge gate.

Today Claude Code binds an explicit `--resume <uuid>`, then a journal appended
in the process CWD's project directory after process start, then an open
handle. `claude --resume` with no value is a picker; argv never gains a UUID.
If the restored journal's mtime does not beat `startedAt` in that encoded
directory — or the selected session lives under a different project encoding —
the pane stays empty. That is the reported bug.

Codex binds only a writer-held rollout. `codex resume --last` restores a
session and holds no writable handle between appends, so it never rebinds.
Grok can bind a writer-held `events.jsonl` or `active_sessions.json`;
`--continue` / `--resume` still need those associations to fire after quit.
OpenCode binds a writer-held `opencode.db`. Cursor and omp already have
non-handle associations (store.db, terminal breadcrumb) but their restore
argv is untested.

The conformance resume gestures today are `claude --continue`,
`codex resume --last`, `grok --continue`, `opencode --continue`. They skip
unless an env var is set. The Claude app e2e launches a new `claude`, not the
picker. Codex app e2e has no resume. Grok app e2e resumes a stub binary.

In-force ADRs: 0001–0006, 0008–0014. ADR-0008 supersedes ADR-0007.

## Goals / Non-Goals

**Goals:**

- Bind every documented restore command of the six bundled CLIs, including
  pickers and last-session shortcuts with no UUID on argv.
- Keep identity on each provider's own association. Do not add CWD, newest-file,
  or terminal-title binding.
- Drive those commands from fixtures, from the opt-in real-CLI harness, and
  from a real-app spec for `claude --resume`.
- A Resume `Y` exists only where the real-CLI restore command rebound.

**Non-Goals:**

- Wrapping, configuring, or injecting into any CLI.
- Running real-CLI tests on ordinary pull requests.
- Changing the canonical event model or Agents UI layout.
- Inventing a session while a picker is still on screen.

## Decisions

### 1. Restore argv is a first-class binding input, not a special case of new launch

**Boundary:** extension-child observation. The child reads `foreground.arguments`
the host already supplies.

**Choice:** classify argv as (a) explicit session id, (b) last-session shortcut,
(c) picker with no id, (d) neither. (a) binds that id through the existing
path. (b) and (c) bind the journal or store that process actually writes after
it started, using the same provider association as a new launch — Claude
project directory, Codex sessions root, Grok sessions / `active_sessions.json`,
OpenCode store, Cursor store.db, omp breadcrumb.

**Rejected:** treating picker/`--continue` as "new launch" and hoping post-start
mtime is enough without tests of that argv. That is the current Claude Code
path, and it failed in the running app.

### 2. Codex resume uses the sessions tree plus process start, not open-handle alone

**Boundary:** same observation API; no new host IPC.

**Choice:** for a Codex process whose argv is `resume`, `resume --last`, or
`resume <id>`, admit an eligible CLI root rollout under that process tree's
`CODEX_HOME/sessions` (or `~/.codex/sessions`) that was appended after the
process started, even if no writable handle is held. Explicit `resume <id>`
still prefers that id's rollout. Open-handle remains the rule for a normal
`codex` launch that does hold the file.

**Rejected:** waiting for Codex to keep the rollout open. It does not.
**Rejected:** newest file in `~/.codex/sessions` without process start or CLI
originator checks. That is a heuristic.

### 3. Picker binds on first post-selection write, not on argv changing

**Choice:** argv for `claude --resume` stays `--resume`. Binding waits until a
root journal in the associated project directory is appended after process
start. Discovery retries already cover `not-bound` while the picker is up.
Selecting a session that belongs to another cwd's project directory is bound
only if that CLI's own association points there (explicit id, or a write we
can attribute to this process). We do not scan every project directory.

**Rejected:** parsing TUI picker text. Terminal output is not identity
(existing spec).

### 4. Tests must type the documented command

**Choice:**

- Unit fixtures: argv is `--resume` with no UUID, `--continue`,
  `resume --last`, etc. Open files empty where the real CLI holds none.
- Conformance resume gesture: Claude `claude --resume` then select the just-quit
  session (arrow/enter against the picker); Codex `codex resume --last`; Grok
  `grok --continue`; OpenCode `opencode --continue`. If a picker cannot be
  driven reliably, that is recorded and the cell is not `Y` until it can.
- App e2e: `claude --resume`, select, assert the Agents row. Codex/Grok
  real-app resume added beside existing real-app specs, still opt-in.

**Rejected:** counting `claude --continue` as proof of `claude --resume`.
Different argv, different user path.

### 5. No new public API

**Choice:** stay inside the existing observation helpers (`descendants`,
`openFiles`, `listDirectory`, `resolveHomeDirectory`, `stat`, `createdAt` /
`modifiedAt`). If Codex resume needs `createdAt` on listed files, that field
already exists on `AgentDiscoveredFile`.

**Rejected:** a new host "resume identity" RPC. It would move provider knowledge
into the server.

## Risks / Trade-offs

- **[Risk]** Claude picker selects a session whose project encoding is not the
  current CWD → **Mitigation:** explicit `--resume <uuid>` still binds by id;
  picker without a post-start write in the CWD project directory stays
  unbound rather than scanning all of `~/.claude/projects`. Record as `N` only
  if the real CLI cannot be bound any other way.
- **[Risk]** Codex `resume --last` still writes nothing we can attribute to
  this process → **Mitigation:** measure on a real CLI before claiming `Y`;
  flip the cell to `N` with the reason rather than leave a lying `Y`.
- **[Risk]** Driving a TUI picker in a PTY is flaky → **Mitigation:** prefer
  `--continue` / `--last` as the harness default where the CLI documents them
  as last-session restore; keep one app e2e on the picker because that is the
  reported bug. Do not mark picker `Y` from the last-session test alone.
- **[Risk]** Real-CLI tests stay skippable → **Mitigation:** unit fixtures of
  the real argv must pass on every PR; the opt-in run is still required before
  the matrix cell stays `Y` (ADR-0014). Implementation tasks do not tick Resume
  `Y` on a skip.

## Migration Plan

Ship on the agent-status branch. No persisted schema change. Rollback is revert
of the provider binding and tests; Agents falls back to terminal activity as
today.

## Open Questions

- Does Claude's `--resume` picker list only sessions for the current cwd, or
  all projects? Measured during apply against the real CLI; it decides whether
  CWD-scoped listing is enough.
- Can `codex resume --last` be attributed without an open handle using only
  post-start mtime on an eligible CLI rollout? If not, Resume for Codex becomes
  `N` rather than a synthetic binding.
- No in-force ADR needs revisiting. ADR-0014 already requires real-CLI proof
  for Resume; this change stops claiming that proof for argv we never drove.
