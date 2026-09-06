## Context

Grok observation already has two admission paths: a writer-held `events.jsonl`
under the issued PTY, and a pid join against `~/.grok/active_sessions.json` when
the CLI is not holding that journal open. The registry path required exactly one
matching descendant pid. Grok lists every live process in that file, including
helpers and a `grok --resume` that replaces the previous pid while the old row
is still present. A PTY whose tree matched two rows therefore returned
`not-bound`, even when one of those pids owned a primary journal.

That is an extension-local binding rule. It does not change Terminay Server
authorization, the public Extension API, or the canonical agent model. Two
concurrent Grok terminals already project independently once each is bound; the
host already claims per terminal session.

In-force ADRs that constrain this work: ADR-0008 (observation stays in the
server-owned extension child), ADR-0009 (environment-routed observation, unused
here because This-server is local), ADR-0011 (journals stay privileged; the
registry is still a pid-to-session join, never cwd identity), ADR-0014 (Grok
owns its binding proof and fixture coverage). Nothing here revisits those ADRs.

## Goals / Non-Goals

**Goals:**

- Bind a Grok root whenever a descendant pid in `active_sessions.json` proves an
  eligible primary journal, including when several descendant pids are listed.
- Keep two concurrent Grok PTYs independent.
- Cover the live failure: two projects, a later turn after `done`, and
  `grok --resume` while another Grok is still running.

**Non-Goals:**

- Changing writer-held journal admission, summary following, or subagent
  mapping.
- Treating CWD as identity.
- Binding a non-primary (`session_relationship` other than `primary`) journal as
  a root.
- Raising extension publication backpressure limits or awaiting mapper
  publishes. Those are separate if a large live journal still drops events.

## Decisions

**Select among matching registry pids; do not fail closed on count.** Filter
`active_sessions.json` to descendants of the issued PTY, resolve each row's
journal, drop non-primary roots, and if more than one eligible journal remains
pick the most recently modified. That reuses the writer-held selection rule
already specified for one process holding several journals. Failing closed on
`matches.length !== 1` was the observed empty-pane failure and is rejected.

**Pid remains identity; CWD is only a path to the journal.** The registry row's
cwd is used solely to resolve `sessions/<encoded-cwd>/<session_id>/events.jsonl`.
Two Grok processes with the same cwd in different PTYs still bind by pid.

**Resume is a new process on the same PTY.** `grok --resume <uuid>` replaces the
writer. The host already re-admits after an explicit shell return or a missed
shell edge once the previous root is inactive. This change only makes the
registry path succeed for the new pid when the file still lists more than one
row.

## Risks / Trade-offs

- [Two eligible primary journals in one PTY pick the newest, so an older live
  session in that same tree is not shown] → That tree already cannot show two
  roots; the previous behaviour showed none. Newest-primary is the existing
  writer-held rule.
- [A helper pid whose journal looks primary could win on mtime] → Non-primary
  `session_relationship` still excludes subagent journals. Remaining collisions
  are the same class as one writer holding two roots.
- [Electron e2e is the only proof two projects stay bound in the app] → The
  native Grok stub now mints a pid-keyed session id so two stubs do not share
  one journal. The suite still runs in Docker (`npm run test:e2e`).

## Migration Plan

Ship on the agent-status branch. No persisted schema change. Rollback is revert
of the Grok extension selection and its tests.

## Open Questions

None.
