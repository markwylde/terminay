## Context

Agent status has a correct core and an unverified edge. The canonical model
(`packages/server-core/src/activity/agentStore.ts`), the RAG colours
(`src/components/AgentStatusIndicator.css`), the tab glyph, and the acknowledgement
model all behave as specified and are covered by tests. What is not covered is
whether any given provider extension can actually observe the facts the model
needs from a *real* CLI.

Claude Code is the demonstration. `extensions/agent-claude-code/src/provider.ts`
binds a session only by asking the host for journals a PTY descendant currently
holds open for writing. Claude Code appends and closes; on a live host two
running `claude` processes held 30 open files between them and none under
`~/.claude/projects`. Every unit test in that package supplies a synthetic
`openFiles` result, so the suite proves the one path the real CLI never takes.
The spec's primary rule — the root journal created for the process's working
directory after that process started — exists on paper and nowhere in code.

The terminal-activity fallback below it is sound. `reducer.ts` sets `claimed`
only through `explicitSeen`, which is latched in exactly two places — a real
`OSC 9;4` progress signal and a real `OSC 133`/`633` command signal — never from
a process name. A Claude Code terminal emitting neither is therefore never
claimed, `applyRawActivity` proceeds, and `src/components/TerminalTab.tsx`
bridges `recent → working`. The fallback needs no change; only the binding does.

Constraints carried into this design:

- **Zero injection.** Terminay never modifies, configures, wraps, hooks, or
  instruments a provider CLI. Every capability is met by observing artifacts the
  provider already writes, or it is declared unsupported. This is the boundary
  ADR-0011 protects between Terminay and untrusted provider binaries.
- **Extension host boundary.** Provider-specific discovery and parsing live in
  separately hosted extension children using only the public Extension API; raw
  provider records never cross into the server. ADR-0009 keeps observation
  environment-routed, so a provider must never reach the server's own home
  directory when the terminal runs elsewhere.
- **Merge-gate CI.** ADR-0010 scopes pull-request CI to merge confidence. A
  suite that needs four authenticated third-party CLIs and spends real model
  tokens does not belong on that gate.

## Goals / Non-Goals

**Goals:**

- Claude Code binds and reports the full lifecycle from a normally launched CLI.
- A single written matrix says what each provider observes explicitly, what is
  derived from its journal, and what is genuinely unavailable.
- Every cell is proven by an integration test in that provider's own extension,
  driving its real CLI, so the matrix cannot quietly go stale.
- Quitting and resuming a session are covered for every provider.
- OpenCode joins the matrix as a bundled provider.

**Non-Goals:**

- Cursor Agent and omp conformance. They remain shipped providers; adding them
  to the matrix is follow-on work.
- Changing the canonical state model, the RAG colours, the reducer, or the
  acknowledgement semantics. They are correct.
- Making the real-CLI conformance tests part of pull-request CI.
- Driving these tests through a running Terminay instance.
- Reading OpenCode's or Cursor's conversation payloads to obtain a capability.

## Decisions

### 1. Directory observation, not open-handle polling, is Claude Code's primary rule

Claude Code's association is: the descendant `claude` process's CWD determines
the provider-encoded project directory under `~/.claude/projects`, and the root
journal is the one that appears there after that process started.

The Extension API already carries everything but one fact:
`resolveHomeDirectory`, `listDirectory`, `watchDirectory`, and process
`startedAt` all exist. What `AgentDiscoveredFile` exposes is `size` and
`modifiedAt` — no creation time. Two ways to close that:

- **(a) Watch-delta.** Take the first `watchDirectory` snapshot at discovery and
  treat a `.jsonl` that appears in a later snapshot as created after process
  start. Needs no API change and is exact for the common case — a fresh `claude`
  writes its journal within a second or two of starting.
- **(b) Add `createdAt` to `AgentDiscoveredFile`.** A one-field, additive API
  change; the host already stats these files.

**Chosen: both, (b) as the rule and (a) as the mechanism.** `createdAt` makes
the rule directly checkable and removes the discovery race where the journal
already exists before Terminay's first snapshot (a `claude` started before
Terminay attached, or a rebind after a foreground change). The watcher is still
how live admission happens. `modifiedAt`-based selection stays forbidden — a
`createdAt` compared against a process start time is provider-documented
association, not a nearest-file heuristic.

Several candidates are normal, not ambiguous. A live host showed one `claude`
process with two post-start journals in its project directory — one born at
process start and still being appended, one born 40 minutes later and dormant.
A `claude` process writes a new journal per conversation, so "exactly one, else
bind nothing" would have left that terminal dark. The existing renewable root
binding requirement already has the answer: authority follows the journal
receiving current appends, which is live-write evidence rather than a
closest-match heuristic. Binding nothing is reserved for two candidates being
appended concurrently. The open-writable path stays as the specified fallback,
tried second.

Alternative rejected: matching the newest journal in the project directory. That
is exactly the "closest-match logic" the spec forbids, and it misbinds whenever
two terminals sit in one repository.

### 2. OpenCode is read as a SQLite store, restricted to lifecycle tables

OpenCode has no JSONL journal. Its state is `opencode.db` under
`~/.local/share/opencode` (XDG-relocatable), with `session` (id, project_id,
parent_id, slug, title, directory), an append-only `event` log keyed by
`aggregate_id`/`seq`, and `message`/`part` holding conversation payloads.

This is the Cursor situation, and it takes the Cursor answer: bind on the exact
writable store held by the PTY tree, then read only what is lifecycle. The
distinction the Cursor requirement draws — never read the SQLite *conversation
payloads* — maps cleanly here: `session`, `event`, and the identity/kind/outcome
fields are lifecycle; `message.data` and `part.data` are content and stay inside
the extension child, unread and unlogged.

`session.slug` (e.g. `curious-eagle`) is OpenCode's deterministic pre-title
identifier, which satisfies the Title capability's "before the provider has
chosen one" half without falling back to a generic label. `session.parent_id`
gives subagents natively.

Reading a live SQLite database that another process is writing needs read-only,
WAL-aware access with a bounded retry on `SQLITE_BUSY`; the extension must never
take a write lock on a provider's store. Whether this justifies extending the
Extension API with a bounded read-only SQLite accessor, or whether the extension
child opens it directly under its existing `agent-observation` permission, is an
open question below.

### 3. Conformance tests live in each extension and drive a real CLI in a real PTY

The tests belong beside the code that has to be right about the provider. Each
extension package gets a conformance test that spawns a real shell in a real
PTY, launches its provider's CLI as a user would, drives it by writing to the
PTY, and asserts the canonical lifecycle events its own `observe` emits. No
Terminay server, no workspace, no UI.

That placement matters more than it first appears. The defects this change fixes
are all in the layer between a provider's real behaviour and an extension's
belief about it — journals held open or not, records flushed early or late,
subagents in-process or on disk. A test that goes through a whole application to
reach that layer is slower, flakier, and further from the thing under test. A
test that spawns `claude` and watches what the Claude Code extension makes of it
sits exactly on the seam that broke.

Assertions are on emitted events, never on provider files read directly by the
test. A test that reads the journal itself would re-encode the same beliefs the
extension holds and could pass while the extension is wrong — the failure mode
this whole change exists to end.

The mechanics go in one shared harness: PTY and shell, CLI launch, input,
a real observation context over the live process tree and filesystem, event
collection, `awaitState` with a timeout, teardown on success, timeout and
failure alike. Each provider supplies only its own gestures — how it launches,
the subagent prompt, how to leave an input request outstanding, how to provoke a
halting fault, how to quit, how to resume — plus its matrix row. Every capability
assertion is written once in the harness and runs for all four, so a capability
cannot be verified for one provider and quietly skipped for another.

The observation context should be built from the adapter logic already in
`packages/server-core/src/extensions/localAgentObservation.ts` rather than a
second implementation, or the harness would test a fiction of production.

Alternative rejected: Playwright against a running Terminay instance. It proves
the whole stack but is the wrong instrument for provider-format drift, and the
existing `e2e/real-codex-agent-runtime.spec.ts` is being retired into this.

Alternative rejected: mocking each provider's journal. That is what the current
tests do, and it is the reason this bug shipped.

### 4. Quit and resume are part of every provider's conformance run

A session's life includes ending and coming back. Quitting must make a root
inactive rather than leaving it stuck reporting `working` — the most visible
possible failure, a terminal that claims to be busy forever. Resuming must
rebind the same root rather than growing a second one, and must not replay a
completed session's history as fresh activity.

The existing spec already has renewable root binding and a Grok resume scenario,
but nothing exercises either against a real CLI. Making Resume a matrix column
puts it on the same footing as the states, and the quit/resume leg runs for every
provider rather than for whichever one someone remembered.

### 5. Inference from the session journal is in scope; inference from the terminal is not

Providers differ in what they bother to record, and that variation is not
something we can negotiate away — we do not touch their configuration. Where a
provider records no explicit fact, the state is derived from its journal rather
than declared unavailable.

The line is the evidence source, not the act of inferring. The existing non-goal
forbids inferring canonical state from *terminal* evidence — raw text, titles,
spinner frames, process names, escape-sequence bodies — and from file metadata
like mtime and filename proximity. It says nothing against reasoning over the
journal itself, which is precisely what a file-based watcher is for. Recorded
absence between two explicitly recorded boundaries is journal evidence.

Measurements taken from real sessions on this host set the shape of the Claude
Code rules:

- Turn boundaries are explicit and reliable. `mode`/`permission-mode`/
  `atis-latch`/`bridge-session`/`last-prompt` are written as a header block at
  the start of *every* turn (23 headers across 23 turns in a live session), and
  `system`/`turn_duration` closes each turn. Idle, Working and Done need no
  inference at all.
- Within a turn, the longest quiet interval during ordinary uninterrupted work
  was **66.7 s** (median 0.07 s, p90 5.1 s). Between turns — the genuinely idle
  window — gaps ran to 188 s and 508 s, but those are explicitly bounded by
  `turn_duration` on one side and the next turn header on the other, so they
  never enter the in-turn window.
- The journal never shows an outstanding tool call. Across 34 completed sessions
  and a live mid-turn session with 66 tool calls, unanswered `tool_use` records:
  **zero**. Claude Code flushes the assistant record and its `tool_result`
  together on completion.

Two consequences follow, and both are corrections to the current mapping:

1. **`AskUserQuestion` is not a live waiting signal.** Its record only appears
   after the question has been answered, so
   `extensions/agent-claude-code/src/mapping.ts` currently raises `waiting` at
   the moment the wait ends. It must stop being treated as a live signal.
2. **Waiting must come from quiescence.** In-turn silence past a window
   comfortably above 66.7 s, with the writer alive, is the only journal-visible
   trace of an open prompt.

Quiescence alone would false-positive on a long silent tool run, so two gates
narrow it. `permissionMode` is recorded per turn: a `bypassPermissions` session
never prompts, so the inference is suppressed outright. And a descendant
performing work withholds it — which is process evidence used only to *suppress*
a journal-based inference, never to create a state. That asymmetry is what keeps
this on the right side of the existing non-goal.

Blocked takes the same treatment: `isApiErrorMessage` is a real field in Claude
Code's assistant records, and an error that halts a turn with no `turn_duration`
following is a condition needing intervention. Grok and OpenCode get the
equivalent rule over their own fault records. Only Codex records an explicitly
blocking condition, so only Codex's Blocked cell is unqualified.

The matrix distinguishes `Y` from `Y*` for exactly this reason. Every cell is
covered, and the reader can still see which states rest on an explicit record
and which on a derived one.

Alternative rejected: collapsing waiting and blocked into one "requires input"
column. It would hide the distinction the red indicator's accessible label
already makes, and Codex genuinely supports both.

Alternative rejected: declaring these capabilities unavailable. That was the
first draft of this design, and it was wrong — it treated a provider's silence
as our limit rather than as a thing to reason about.

### 6. Fixture parity is a spec requirement, not a review convention

The rule that a fixture must not supply evidence the real CLI never produces is
written into the conformance spec. It is the check that would have caught
Claude Code, and it is cheap to apply during review of any new provider.

## Risks / Trade-offs

- **Directory observation is broader than open-handle observation.** Watching a
  project directory sees journals for sessions in other terminals rooted in the
  same repository. → The `createdAt`-after-process-start rule plus the
  bind-nothing-on-ambiguity rule keeps this safe; ambiguity is the designed
  outcome, not a failure to fix.

- **Reading a live SQLite store risks lock contention with OpenCode itself.** →
  Read-only WAL access, bounded retry, never a write lock. A store that cannot
  be read safely degrades to terminal-activity fallback like any other missing
  evidence.

- **The real-CLI tests are slow, cost model tokens, and are flaky by nature.** →
  Opt-in, credential-gated, skipped without a provisioned CLI, off the merge
  gate per ADR-0010. They run on demand and on a schedule, and a skip is a pass.

- **Driving a TUI by writing to a PTY is inherently brittle** — prompts move,
  key handling changes, a stray keystroke lands in the shell instead of the CLI.
  → Gestures are per-provider descriptor fields, so a CLI changing its interface
  is a one-line fix in one place rather than a rewrite. Where a provider accepts
  its first turn as a command-line argument, the descriptor should prefer that
  over typing, as the existing Codex e2e test already found necessary.

- **A conformance test that leaks a CLI process leaves a real agent running on a
  developer's machine, burning tokens.** → Teardown on success, timeout and
  failure alike is a harness responsibility with its own self-test, not
  something each provider's test is trusted to remember.

- **Providers change their storage formats without warning.** → That is what the
  suite is for: it fails loudly against a real CLI instead of passing against a
  fixture frozen at the format's old shape.

- **A quiescence inference can fire on something that is not a prompt.** A model
  thinking for two minutes, or a tool that produces no descendant we can see,
  would read as `waiting`. → The window sits well above the 66.7 s measured
  ceiling, `bypassPermissions` sessions are excluded outright, live descendants
  suppress it, and any appended record clears it immediately. A false `waiting`
  therefore costs one red dot that corrects itself on the next record. It is
  still the weakest cell in the matrix, and it is marked `Y*` so that is legible.

- **A measured window is measured on one host, on one provider version.** → The
  spec requires the measurement to be recorded with the window and re-taken when
  the mapping version changes, and the conformance suite exercises the real
  condition rather than injecting the inference's inputs.

- **`createdAt` is an additive Extension API change.** → Optional field, no
  existing consumer breaks; providers that do not need it ignore it.

## Migration Plan

No data migration and no persisted-state change. The Claude Code fix is
additive — the primary rule is tried first, the existing fallback second — so a
`--resume` session that binds today continues to bind identically. OpenCode
arrives disabled-by-absence until its extension is registered in
`extensions/builtins.json`; the **Agent status and sidebar** setting already
governs the feature as a whole and needs no new switch.

Rollback is per-provider: removing OpenCode from `builtins.json` withdraws it
without touching the others, and the interpreter-claim change is a single
predicate that can be reverted independently of the Claude Code fix.

## Open Questions

- **Does the Extension API need a bounded read-only SQLite accessor?** Cursor
  already binds on a `store.db` but deliberately reads nothing from it — it
  hops to a JSONL transcript. OpenCode has no transcript to hop to, so it would
  be the first provider to read SQLite for lifecycle. A shared, permissioned,
  read-only accessor in the API is the safer boundary; letting the extension
  child open the file directly is less work and stays inside its existing
  `agent-observation` permission. This should be settled before the OpenCode
  tasks start.

- **Where do the conformance tests run?** Nightly on a self-hosted runner with
  the four CLIs provisioned is the obvious answer, but ADR-0010 does not
  currently describe a scheduled lane, and credential provisioning for four
  third-party CLIs is a real operational commitment. If a scheduled lane is
  added, that is a change to CI's shape and may warrant revisiting ADR-0010.

- **Where does the shared harness ship?** A subpath of
  `@terminay/extension-api/testing` matches the existing
  `createAgentExtensionHarness` pattern every extension already imports, but it
  would put PTY spawning and a real observation context into the public API
  package. A separate dev-only package keeps the public surface clean at the
  cost of another workspace package. Settle this before task group 8 starts.

- **How does each provider provoke a halting fault on demand?** Blocked is the
  one capability with no obvious safe gesture — an exhausted quota or a failed
  auth is not something a test should cause deliberately against a real account.
  A revoked or deliberately invalid credential in a disposable provider home is
  the likeliest answer, but it needs to be worked out per provider and may mean
  Blocked is verified separately from the main session run.

- **What is the Claude Code input-request window?** The design fixes the method
  — comfortably above the 66.7 s in-turn ceiling measured here — but not the
  number. 90 s is the smallest defensible value and 120 s the safer one; the
  difference is how long a red dot takes to appear against how often a slow
  turn produces a false one. It should be set from a wider measurement across
  several hosts and repository sizes during task 3, not picked now.

- **Should an inferred state be visually distinct?** The spec requires the entry
  to carry that it was inferred, but not what any surface does with it. A
  tooltip qualifier on an inferred `waiting` would be honest without adding a
  fourth colour. Worth deciding before the matrix is published.
