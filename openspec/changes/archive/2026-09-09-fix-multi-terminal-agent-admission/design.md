## Context

Two defects, one behind the other.

**Admission.** The privileged host owns terminal-session identity. It issues
an observation context to an extension child for one exact terminal at one
exact incarnation, and refuses a second admission of the same context. The
identifier carrying that identity is built in
`packages/server-core/src/activity/extensionAgentRuntime.ts`:

```ts
this.makeContextId =
  options.contextId ??
  ((_identity, incarnation) => `extension-agent:${authorityNonce}:${incarnation}`);
```

`identity` is discarded. `incarnation` is per-terminal and starts at `1`, so
two terminals at incarnation 1 are indistinguishable and the host's own
uniqueness check turns into a global lock. This is fixed on the branch and
verified by reverting the fix.

**Binding.** Once admitted, each Claude Code terminal must find its own
journal. Two terminals in one repository share one provider-encoded project
directory under `~/.claude/projects`, and each lists the other's journal beside
its own. The provider on `main` picked the most recently appended journal; the
provider on this branch picks the first journal created after the process
started and, when there is none, falls back to the most recently appended
journal (`ownJournal`, `provider.ts:430`). `claude --resume` and `--continue`
append to a journal created before the process, so for them the creation list
is always empty and the fallback always fires. A brand-new terminal was shown
another terminal's session. Every version of this rule has failed, because
file times do not say which process wrote a file.

### What the CLI actually records

Every interactive `claude` process writes one file keyed by its own pid:

```
$ cat ~/.claude/sessions/81679.json
{"pid":81679,
 "sessionId":"6a2f403e-8c17-4284-8caf-44ea5b7befb5",
 "cwd":"/Users/mark/Documents/Projects/terminay/terminay",
 "startedAt":1788774848318,
 "procStart":"Mon Sep  7 09:54:07 2026",
 "version":"2.1.263","kind":"interactive","entrypoint":"cli",
 "pidDomain":"darwin", ...}
```

Facts observed on this host, against the live process, and relied on below:

- `sessionId` names the journal directly:
  `~/.claude/projects/<encoded cwd>/<sessionId>.jsonl`.
- The file tracks in-process session changes. Pid 81679 was started with
  `claude --resume` onto session `484fb342…`; after `/clear` the same file
  named `6a2f403e…`, and that journal is the one receiving appends. The
  handover quotes the earlier value from the same pid.
- `startedAt` is epoch milliseconds and agrees with the process start to
  within a second. `procStart` is a ctime string in UTC, while `ps` reports
  local time, so `procStart` is not used for comparison.
- The file is rewritten while the process runs (`updatedAt`, `status`), so
  its own modification time means nothing and is not read.
- The file is removed on exit. One live `claude`, one file.
- A sibling `<pid>.<digest>.key` holds a peer token. It is never read.

## Goals / Non-Goals

**Goals**

- Two or more terminals of one provider each observed, each with its own root.
- A Claude Code terminal bound to the session its own process reports, in a
  directory holding any number of other sessions, whether the process was
  started fresh, with `--resume`, or with `--continue`.
- No timestamp anywhere in Claude Code journal selection.
- Coverage that would have caught both defects, at all three levels — unit
  fixture, real-CLI conformance, and the running application — with the unit
  fixture modelling what production actually supplies.

**Non-Goals**

- Changing the protocol or anything the renderer sees.
- Re-deriving the session id from the `--resume` argument. The session file
  already carries the resumed id, and carries the right one after `/clear` or
  `/resume` inside the process, which the argument never can.
- Supporting a `claude` version that writes no session file. Such a process
  binds nothing and the terminal shows plain terminal activity, which is the
  documented degradation for missing evidence.

## Decisions

### The context identifier is derived from the whole issued identity

The default becomes a function of `serverId`, `projectId`, `sessionId` and
`incarnation`, folded in as a nonce-keyed digest so it stays opaque and cannot
collide by construction. Done and verified; recorded here so it is not redone.

### Claude Code binds through the pid-keyed session file, and nothing else

The rule, in full:

1. Take every `claude` descendant of the registered PTY that has a pid.
2. For each, resolve `.claude/sessions/<pid>.json` beneath `.claude/sessions`
   and read it, bounded. Read only `pid`, `sessionId`, `cwd`, `startedAt` and
   `version`. Never read the `.key` file, `messagingSocketPath`, `name`,
   `status` or anything else in the object.
3. The file is valid for that process only when `pid` equals the process pid,
   `cwd` equals the observed process cwd, `sessionId` is a session UUID, and,
   where the environment supplies a process start time, `startedAt` lies within
   a few seconds of it. A start-time mismatch means the pid was reused after a
   crash left a stale file; the file is then evidence about a dead process.
4. The journal is `<encoded cwd>/<sessionId>.jsonl` beneath `.claude/projects`,
   and its first record must carry the same `sessionId`. The existing
   `claudeProjectJournalPath` helper already encodes this path.
5. Exactly one descendant with a valid file and a resolvable journal binds.
   Zero binds nothing. More than one binds nothing — a `claude` nested inside a
   `claude` is not a case worth guessing at.
6. While bound, watch the session file. When its `sessionId` changes, retire
   the current root and bind the new journal in the same terminal, under the
   existing renewable-root rules. This is how `/clear` and in-process `/resume`
   are followed.

Deleted: `projectJournalCandidate`, `ownJournal`, `writableJournalCandidate`,
`rootJournalCandidate` and `resumedJournalCandidate`, the `RootJournal` type,
and the `PROJECT_DIRECTORY` listing limits. The provider no longer lists the
project directory at all to find a root. The `subagents/` directory listing
stays, because it is keyed on the bound session id, not on time.

**Why not keep a fallback for when the file is missing.** Every fallback in
this history became the primary path in some case nobody tested. The session
file is written at process start, before the journal exists; if it is not
there, the discovery window already retries ten times at 100 ms and then keeps
discovery armed under topology polling until the incarnation binds or leaves
the shell. That is the whole retry story. A process with no session file after
that is a `claude` too old to write one, and it shows as terminal activity.

**Why the start-time check is not a timestamp heuristic.** The rule never
compares one file to another, and never orders anything. It checks that a file
which claims to describe a process was written by that process rather than by
an earlier holder of the same pid. Removing the check would let a stale file
bind a fresh terminal to a dead session; keeping it costs nothing.

**Boundary crossed:** the session file is a provider store and stays inside
the extension child under the journal privacy boundary. Only the fields above
are read; none is logged or emitted beyond the canonical binding.

Alternative considered: keep the creation-time rule and add the session file
as a cross-check. Rejected — the creation rule is wrong for `--resume` on its
own terms, and a cross-check on a wrong rule still needs the file to be the
authority, so the rule is pure cost.

Alternative considered: follow Grok's shape exactly by treating the whole
`sessions/` directory as a registry and joining on pid. Equivalent, but reads
every live session's file to find one. The file name already is the pid.

### The unit fixtures must model what production supplies

`shared-project.test.mjs` sets every journal's creation time after the process
start, so the resume case — journal older than process — was unreachable and
the fallback was never exercised. The same fixture supplied file times with a
precision production does not promise. From now on every Claude Code binding
fixture:

- places at least one journal in the project directory that is older than
  the process under test;
- supplies a `sessions/<pid>.json` for each live `claude` process, with the
  pid on the descendant snapshot, the way the observation broker does;
- covers each way the file can be invalid: absent, wrong `cwd`, `startedAt`
  disagreeing with the process, `sessionId` naming a journal that does not
  exist, journal header disagreeing with the file, two descendants both valid.

`fixtureTerminal` already accepts `pid` and `startedAt` on the foreground and
on each child, and arbitrary `files`; no fixture API change is expected.

### The unit tests must exercise the shipped context-id function

Every existing `extension-agent-runtime` test injects a readable `contextId`
double. The seam stays, but the two-terminal admission test passes no override
so the shipped default is what is exercised. Done.

### Concurrency is asserted once, in the shared harness, in a used directory

The conformance harness holds a second PTY and context, and the
concurrent-session assertions live in `runConformance`. Two additions, because
the step as written passed against the broken provider:

- **The working directory holds earlier sessions before `detect` runs.** The
  harness starts one session, drives one turn, quits it, and only then begins
  the matrix in that directory. Every process under test now sees a journal
  it did not write and is older than it. A provider that binds by file time
  fails `detect` or the concurrent step here; the current provider passed
  because the container directory was empty.
- **Resume while another session runs.** With the second session still bound,
  the first is resumed by id in a fresh PTY. The resumed process must bind the
  first session's id, and the second terminal's binding must not move. This
  is the exact user report: `--resume` in a directory with a live session.

### The application surface needs stub CLIs

Real authenticated CLIs cannot run on every end-to-end run. Grok already has a
compiled stub that writes its real journal format. Each remaining provider gets
the same. The Claude Code stub writes `sessions/<pid>.json` with its own pid,
cwd and start time, then the journal named by its `sessionId`, and accepts
`--resume <id>` so the spec can launch it against a pre-existing journal.
A stub that writes only the journal would pass a timestamp provider and prove
nothing about this change.

**Boundary crossed:** none — the stubs are test fixtures outside the shipped
application, and they write the provider's real on-disk format so the
production observation path is what is exercised.

### Verification is the application, not the fixture

A green fixture is a hypothesis. For every task below whose symptom is "the
pane shows the wrong row", the task is closed by the built application showing
the right row, with the screenshot and log tail recorded in `tasks.md`. This
is written down because the last session reported this defect fixed on the
strength of a fixture it wrote itself.

## Risks / Trade-offs

- **The session file is an undocumented CLI artifact.** It could change shape
  or move. Mitigated: the real-CLI conformance layer runs against `@latest`
  and fails `detect` the day it does, which is the right outcome — silent
  fallback to a guess is what this change removes. The fields read are
  minimal and each is checked, so an unexpected shape binds nothing rather
  than the wrong thing.
- **Start-time tolerance.** Process start from `ps` is second-resolution and
  `startedAt` is milliseconds; the tolerance must be wide enough for that and
  for the CLI's own startup, and narrow enough to reject a pid reused hours
  later. Five seconds is the proposal; a fixture pins it in both directions.
- **A stub can drift from its real CLI.** Mitigated by the real-CLI
  conformance layer above it, which uses no stubs.
- **Longer end-to-end runs.** Two terminals per provider spec, plus a seeded
  session per conformance run. Accepted: this is the class of defect that has
  cost the most time.
- **Changing the identifier shape** invalidates nothing persisted — contexts
  live only for the incarnation — so there is no migration.

## Open Questions

- Whether OpenCode has per-process evidence of its own. It was moved to select
  on the process's proven start time, which is the same shape of rule this
  change deletes for Claude Code. Checked as a task, not decided here.
