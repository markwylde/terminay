## Context

The Claude Code provider has two lanes for a bound root. The session file
lane reads `~/.claude/sessions/<pid>.json` on every change to the sessions
directory and is the only thing that moves the root between working, waiting
and done. The journal lane follows `<sessionId>.jsonl` under the project
directory derived from the file's `cwd` and supplies title, prompt, model,
tools and subagent launches.

Both lanes assume the cwd the CLI was bound with is the cwd it keeps. The
CLI does not promise that: `EnterWorktree` changes the process cwd, rewrites
the session file with the new `cwd`, and moves the journal to the project
directory for that cwd, carrying its whole history. The evidence for this
change is a real session whose journal holds 256 records under the original
cwd and 698 under the worktree, in one file below the worktree's project
directory, and whose store entry never advanced past the `tool.finished`
immediately before the `EnterWorktree` call.

No boundary moves. The session file is still read only through the terminal
context's file broker, still beneath `.claude/sessions`, and still keyed by
the pid of the bound descendant. The relocated journal is resolved by the
existing `journalFor` rule — the directory derived from the new cwd first,
then one bounded lookup by exact filename below `.claude/projects`, verified
against the journal's own first record — so a cwd change cannot bind a
journal the session id does not name.

## Goals / Non-Goals

**Goals:**

- A session that changes cwd keeps reporting status and tool activity.
- The bind-time cwd rule is untouched; a file that disagrees with the
  process it claims to describe still binds nothing.
- The replayed journal re-opens nothing that is already closed.

**Non-Goals:**

- Rebinding the canonical root. The host refuses a live context that
  publishes a binding with a different `providerSessionId`, and a cwd change
  keeps the same one, so nothing needs rebinding.
- Logging from inside a provider. The extension API has no diagnostics
  surface, and adding one is its own change.
- Other providers.

## Decisions

**Identity is pid plus `startedAt`; cwd is data once bound.** The
bind-time cwd equality exists to reject a file that describes some other
process — a stale file left by a crash, a pid reused by an unrelated `claude`.
Both cases are already caught by the pid match and the five-second
`startedAt` tolerance against the observed process start. Once a file has
bound, its cwd changing is the CLI telling us where it now is, not evidence
that the file belongs to someone else. `acceptSessionFile` therefore takes the
cwd it must match as an explicit argument; the bind path passes the observed
process cwd, the watch loop passes nothing.

**A cwd change with the same session id is a relocation, not a switch.**
The existing conversation switch (`/clear`, in-process `/resume`) resets the
mapping and cancels every open child, because a different conversation is
starting. A relocation is the same conversation continuing from a different
directory, so the mapping state — started, titled, status, `idleSince`,
children, completed — is kept. The provider re-resolves the journal, disposes
the old follower, follows the new file and injects a `truncate` chunk carrying
a relocation record ahead of it. The record exists so the decoder resets on a
clean boundary and so the boundary is a recognised record rather than an
unknown one; the mapping keeps all of its state across it.

**The replay is safe because it already was.** A bound journal is replayed
from its start on every bind and on every host `replace` event. The mapping
already treats records at or before `idleSince` as history, keeps launched
children in `completed`, starts the session once, and lets a title stand.
Tool records replayed from before the move re-emit their `tool.started` and
`tool.finished` pairs; the store preserves state across both, so the row's
state cannot be moved by the replay, only its active-tool list flickers for
the duration of the replay. That is the same cost the host's own `replace`
already carries.

**Status changes are compared against the last word seen, not the bind-time
word.** `renamedSessions` initialised its comparison from the file it bound
with and updated it on each yield, which was correct while every listing was
accepted. It now yields on any change of session id, status or cwd and
records all three, so a status change written in the same rewrite as a cwd
change is not swallowed.

**If the relocated journal cannot be resolved, the status lane continues
alone.** A journal that has not yet appeared under the new project directory
is not a reason to stop reading the status file. The root keeps its state
lane and the next cwd or status change tries the journal again. This is the
existing behaviour for a `/clear` whose new journal is not yet written.

## Risks / Trade-offs

- A relocation replays the whole journal. For a long session that is a
  burst of metadata and tool events with no state change. The alternative —
  skipping the consumed prefix by byte count — assumes the CLI moved the file
  byte-for-byte, which is true today and unverifiable from the outside.
- `ExitWorktree` is another cwd change, handled the same way. Whether the
  CLI moves the journal back was not observed; if it does not, `journalFor`
  falls through to the bounded lookup and finds it where it is.
