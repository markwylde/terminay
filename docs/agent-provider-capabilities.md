# Agent provider capabilities

Terminay observes third-party coding-agent CLIs without modifying, configuring,
hooking or wrapping them. Every fact it shows about an agent is derived from
artifacts the provider already writes for its own purposes, so what Terminay can
report differs by provider and is not under our control.

This page states what each provider supports. Every verdict is backed by a
conformance test that drives that provider's real CLI (see below), so the table
cannot quietly go stale.

## Verdicts

| | Meaning |
|---|---|
| **Y** | The provider records the fact explicitly and the mapping reads it. |
| **Y\*** | The provider records no explicit fact, and the state is derived from its own session journal by a named rule. |
| **N** | Neither is possible from the provider's own artifacts. The reason is stated in a footnote. |

An **N** is not an untested cell. The conformance run still performs the
gesture — it raises a real permission prompt, or provokes a real fault — and
then asserts that the state was never reported. A provider that starts
recording a capability it declares `N` fails its own test until this table is
corrected.

An inferred (`Y*`) state is marked as inferred on the agent entry, so a derived
state stays distinguishable from one read from an explicit record. An explicit
record always supersedes an inference.

## Matrix

| Capability | Claude Code | Codex | Grok | OpenCode |
|---|---|---|---|---|
| Detect | Y | Y | Y | Y |
| Title | Y | Y | Y | Y |
| Idle | Y | Y | Y | Y |
| Working | Y | Y | Y | Y |
| Waiting | Y\* | N[^codex-waiting] | Y | N[^opencode-waiting] |
| Blocked | Y | N[^codex-blocked] | N[^grok-blocked] | Y\* |
| Done | Y | Y | Y | Y |
| Sub:Enumerate | Y | Y | Y | Y |
| Sub:Status | Y | Y | Y | Y |
| Resume | Y | Y | Y | Y |
| Concurrent | Y | Y | Y | Y |

Every cell above is verified against that provider's real CLI, running in that
extension's own container, on the latest release of the CLI.

omp is a shipped provider whose conformance run is not yet complete, so it makes
no claim in this table.

[^codex-waiting]: Codex displays an approval prompt on screen but persists
    nothing that distinguishes it from ordinary work: no rollout carries an
    `exec_approval_request`, `request_permissions` or `request_user_input`
    record, even while the prompt is open. A Codex session awaiting approval is
    therefore reported as `working`, not `waiting`.

[^codex-blocked]: Codex records a halting fault as the *completion* of the turn
    it halted — an `event_msg task_complete` carrying `error` — rather than as a
    state the session sits in. It is reported as `done` with an error outcome.

[^grok-blocked]: Grok records no fault distinct from a turn outcome: a failed
    turn is a `turn_ended` carrying an error, which is a completion rather than a
    condition needing intervention.

[^opencode-waiting]: OpenCode persists no record of a permission request. Its
    `permission` table is empty, no permission event type exists, and every tool
    part is first written `pending` whether or not a prompt is shown.

## What each column means

- **Detect** — starting the CLI normally in a Terminay terminal produces an
  agent entry bound to that exact terminal, with no configuration changes.
- **Title** — the entry carries a label at every point in its life: a
  deterministic one before the provider chooses a title, then the provider's own
  title, replaced in place.
- **Idle** — a live session with no active work and no pending result. Distinct
  from `done`.
- **Working** — the whole time the provider is processing a turn or running tool
  or subagent work, and not once that work has stopped.
- **Waiting** — the provider is explicitly asking for approval, an answer, or
  other input.
- **Blocked** — the provider cannot proceed without intervention, labelled
  distinctly from waiting.
- **Done** — the turn completed, failed or was cancelled, carrying its outcome.
- **Sub:Enumerate** — every subagent appears as a named child of its root.
- **Sub:Status** — each child carries its own state, independent of its root and
  its siblings.
- **Resume** — quitting makes the root inactive; resuming rebinds the same root
  without duplicating it or replaying old transitions.

## Why some cells are derived

**Claude Code — Waiting and Blocked.** Claude Code flushes an assistant record
together with its `tool_result` only once the tool has completed, so its journal
never shows an outstanding call and writes nothing at all while a permission
prompt is open. Waiting is therefore derived from silence inside an open turn:
a window well above the longest quiet interval ordinary work produces, with the
inference suppressed in permission modes that never prompt and while a
descendant is still running, and cleared by the next record the provider writes.
Blocked is read directly from an explicit `isApiErrorMessage` record carrying
`apiErrorStatus` and `error`, so it is `Y` rather than an inference.

One consequence is worth knowing: in an *interactive* Claude Code session the
CLI writes a `system`/`turn_duration` record roughly three milliseconds after
the fault, which completes the turn and supersedes the block. A live observer
polling at any human-scale interval will show `done`, not `blocked`. The state
is reported correctly; the CLI simply does not leave it standing long enough to
be seen outside print mode.

**Codex — Resume works, and a resume does not replay history.** `codex resume
<id>` reopens the same rollout file and holds it read-write from startup, so the
existing writer rule rebinds the same root. An adopted rollout replays only its
header and its last turn, and the subagents of the earlier session are not
re-attached, so a resumed session reports its completed state rather than
replaying every past turn as new activity.

**Grok — Blocked is unavailable.** Grok records no fault distinct from a turn
outcome: a failed turn is a `turn_ended` carrying an error, which is a
completion rather than a condition needing intervention. Nothing is synthesized
from it.

**OpenCode — Waiting is unavailable.** OpenCode persists no record of a
permission request: its `permission` table is empty, no permission event type
exists in the store, and every tool part is first written `pending` whether or
not a prompt is shown (over 6,900 `pending` parts on a real store, across every
tool). Nothing durable distinguishes a prompt from ordinary streaming, so no
`waiting` is derived. The approval prompt is a live TUI interaction that never
reaches the store.

**OpenCode — Blocked.** OpenCode records no explicitly blocking condition, so
blocked is derived from an assistant error that halts a turn with no completion
following. An abort is excluded: on a real store 77 of 99 recorded errors are
`MessageAbortedError`, and treating those as blocked would paint every
user-stopped turn red. Codex is the only matrix provider that records a
blocking condition explicitly.

## What has been confirmed against a real CLI

Every cell above is implemented, but they were confirmed at different depths.
Confirmed by reading real sessions or driving a real CLI on a developer
machine: Claude Code's binding, record-flush timing, subagent journals and
quiet-interval measurements; OpenCode's store layout, permission parts, task
children and error names; Grok's subagent `meta.json` lifecycle and its full
set of event types.

**Codex — Waiting.** Codex shows an approval prompt on screen but persists
nothing for it. With `-a on-request -s read-only` and a write left at the
prompt, the live rollout carried no `exec_approval_request`,
`request_permissions` or `request_user_input` record, and no rollout on this
machine has ever carried one. Nothing in the journal distinguishes an
outstanding prompt from ordinary work, so `waiting` is **N**; the mapping for
those record types stays in place should a future Codex write them.

Every cell in the matrix has now been observed against the real CLI in that
extension's container, including Claude Code's `blocked`, whose
`isApiErrorMessage` record was previously present in the format but never seen
set.

## Running the conformance tests

Each provider's test lives in its own extension package and drives the real CLI
in a real PTY. They are opt-in and credential-gated, skip rather than fail
without a provisioned authenticated CLI, and never run on the pull-request merge
gate.

```bash
# One provider at a time, with that CLI authenticated on this machine.
TERMINAY_CONFORMANCE_CODEX=1       npm run test:conformance -w terminay-agent-codex
TERMINAY_CONFORMANCE_CLAUDE_CODE=1 npm run test:conformance -w terminay-agent-claude-code
TERMINAY_CONFORMANCE_GROK=1        npm run test:conformance -w terminay-agent-grok
TERMINAY_CONFORMANCE_OPENCODE=1    npm run test:conformance -w terminay-agent-opencode
```

Each run spends real model tokens, so keep them off automated pull-request runs.
A run works in a disposable directory and does not touch files outside it.

## Adding or changing a provider

A provider's fixtures must reproduce the evidence its real CLI actually
presents, and the timing at which it presents it. Two defects shipped because
fixtures encoded a belief rather than reality: Claude Code was bound only
through an open writable journal handle it never holds, and Grok was documented
as unable to report subagent status after its CLI had gained it.

When reviewing a provider change, ask:

1. Is every form of evidence a fixture supplies evidence the real CLI actually
   produces in normal operation?
2. Is each record available as early as the fixture presents it, or does the CLI
   flush it later?
3. Does the matrix row still match what the CLI does today?

The conformance test is what answers these against the CLI rather than against
our beliefs about it.
