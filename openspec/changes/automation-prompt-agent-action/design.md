## Context

An automation action is a tagged union: `runCommand` launches a terminal in
the automation space, `runMacro` and `writeText` act on an event's subject
terminal. A run-command run is built by `nonInteractiveLaunch`, which turns the
resolved shell profile into a `-l -c <command>` (or PowerShell / cmd / WSL
equivalent) launch and overlays the bounded `TERMINAY_*` context on the
profile's environment.

Users want to give an agent CLI a prompt of several lines. Today that text has
to be shell-escaped into the command line.

In-force ADRs that bear on this: ADR-0030 (automations run in a server-owned
space with workspace-scoped MCP), ADR-0031 (MCP authority is scope × user
permission policy), ADR-0011 (trust boundaries), ADR-0017 (every project
executes on its server). This design stays inside all four.

## Goals / Non-Goals

**Goals:**

- Write a prompt as plain multi-line text, with no shell escaping.
- Keep the command explicit and user-authored, so any agent CLI works.
- Reuse the run-command path whole: same space, lifecycle, limits, log.

**Non-Goals:**

- Any knowledge of `claude`, `codex`, `opencode`, or their flags.
- Templating the prompt over event context. The command already sees
  `TERMINAY_*`; a prompt that needs them can be composed in the command.
- Presets, a provider picker, or detecting whether the agent "finished".

## Decisions

### A distinct action kind, `promptAgent`

`{ kind: 'promptAgent', command, prompt, shellProfileId?, cwd?, maxDurationSeconds }`.

Alternative: an optional `prompt` on `runCommand`. Rejected — the editor
offers it as its own action, an empty prompt would have to mean "not a prompt
action", and "Run a command" would silently gain an environment variable.
A separate kind keeps each action's contract exact.

The many `kind === 'runCommand'` tests that really mean "launches its own
terminal" move to one predicate, `launchesRunTerminal(action)`, in server-core
and its twin in the client model, so the two kinds cannot drift.

### The prompt travels as the `PROMPT` environment variable

`nonInteractiveLaunch` takes extra environment for the run and sets
`PROMPT` after the profile environment, so it wins over an inherited value.
Under WSL it is added to `WSLENV` like the context variables.

Alternative: substitute a shell-quoted prompt for `$PROMPT` in the command
text. Rejected — it needs correct quoting for every shell family (POSIX, fish,
PowerShell, cmd, nu), and a quoting bug there is command injection from prompt
text. An environment variable crosses the process boundary as data; the user's
shell does the expansion it always does. This is the boundary the decision
protects: prompt text is never parsed as shell by Terminay.

Consequence: expansion follows the user's shell. zsh does not word-split, so
`claude $PROMPT` passes one argument; bash and sh do, so there it is
`claude "$PROMPT"`. The editor's hint says so.

The name `PROMPT` is what the user asked for and what reads naturally. zsh and
cmd give the name a meaning for interactive prompts, but a run is launched
non-interactively (`-l -c`, `/c`), where measured behaviour is that the value
survives intact. It is not in the `TERMINAY_` namespace because it is the
user's content, not Terminay context, and is not subject to the context's
newline-free, bounded-value rules.

### Bounds

Command: unchanged (16 KiB). Prompt: 32 KiB of UTF-8, no NUL, not blank —
well under every platform's per-variable environment limit. Line endings are
kept as written.

### Surfaces

- Editor: "Prompt an agent" in the Action select; Command (monospace, single
  line) then Prompt (multi-line textarea), then the shared working directory,
  shell, and stop-after rows.
- List / run detail / MCP `get_automation`: command as code, prompt in full.
- MCP `create_automation` / `update_automation`: accept the new kind; it is
  governed by the same automation scope and permission policy as any other
  definition write (ADR-0031). No new authority.
- Audit and telemetry: the prompt, like the command, is never logged.

## Risks / Trade-offs

- [An interactive agent never exits, so the run ends as timed out] → That is
  run-command behaviour and the user's choice of command (`claude -p`, `codex
  exec`). The existing "Stop after" and "Keep it open" settings cover both
  styles; nothing is hardcoded.
- [bash users write `$PROMPT` unquoted and get word-splitting] → Hint text
  under the Command field; the placeholder shows the quoted form.
- [A login profile that reassigns `PROMPT`] → Rare for non-interactive login
  shells; noted in the hint. The variable name is a product decision.
- [Older clients do not know the kind] → Client validation rejects the state
  it cannot parse, as it does for any unknown action; clients ship with the
  server bundle, so skew is brief.

## Migration Plan

Additive. No schema version change; existing automations are untouched.
Rollback removes the kind; a stored `promptAgent` automation would then fail
normalization on load and must be deleted first.

## Open Questions

None.
