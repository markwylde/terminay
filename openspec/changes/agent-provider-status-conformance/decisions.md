# Decisions taken during implementation

## OpenCode's SQLite read boundary

**Question** (design.md, Open Questions): does reading OpenCode's `opencode.db`
justify a bounded read-only SQLite accessor in the Extension API, or does the
extension child open it directly under its existing `agent-observation`
permission?

**Decision: the extension child opens it directly, read-only.**

The precedent already exists and is shipped. `extensions/agent-cursor/src/cursorAgent.ts:4`
imports `DatabaseSync` from `node:sqlite` and opens Cursor's `store.db` with
`{ readOnly: true }` inside the extension child, after canonicalizing the path
beneath an allowed root (`safeBeneath`). OpenCode is the same shape of problem
and takes the same answer, so there is one way agent extensions read a
provider's SQLite store rather than two.

A new public accessor would have to be designed around one consumer, would widen
the Extension API surface for a capability only two bundled providers need, and
would not add a boundary the child does not already have: an extension child
granted `agent-observation` can already read the provider's files.

The constraints that make this safe are enforced in the provider rather than by
a new API:

- the store is opened `readOnly`, so no write lock is ever taken on a live
  provider database;
- the path is canonicalized beneath the effective OpenCode data root before it
  is opened, and a path escaping that root is refused;
- reads are bounded by explicit `LIMIT`s and column allowlists;
- `message.data` and `part.data` are never selected, so conversation payloads
  never leave the child.

No new repository-level ADR is warranted: this follows ADR-0014's existing
boundary rather than establishing a new one.

## Live admission of a Claude Code journal (task 2.5)

The task text asked for `watchDirectory` inside `observe()` so a `claude`
process that has not yet written its journal binds on the first write. That
mechanism conflicts with the host's observation model, which runs at most one
bounded sample per session.

The outcome the task wants is already provided by the host:
`packages/server-core/src/activity/extensionAgentRuntime.ts:264` retries a
`not-bound` result through its discovery window and then keeps discovery armed
by topology polling. A journal written after a first unbound observation is
therefore admitted on a later sample. This is covered by a test rather than by a
watcher inside `observe()`.

`watchDirectory` is still used where it belongs: admitting *children* created
after the root has bound.

## Terminal-activity interpreter work (originally group 3)

Dropped. The proposal claimed a "legacy Claude Code interpreter profile" claimed
the session and suppressed the raw-output fallback. No such code exists.
`packages/server-core/src/activity/reducer.ts` latches `claimed` only through
`explicitSeen`, set in exactly two places — a real `OSC 9;4` progress signal and
a real `OSC 133`/`633` command signal — never from a process name. A Claude Code
terminal emitting neither was never claimed and the fallback always applied.

The spec delta for `terminal-activity-signals` was removed rather than left
describing behaviour that already holds.
