## Context

See proposal.md for the user-visible failure. Investigation attributed it to
five distinct causes rather than one:

- `events.unsubscribe` and `files.watch.stop` are live commands. Cleanup running
  after the transport closed went through `requireConnected()` and rejected with
  `ClientDisconnectedError`, matching the console stacks through
  `unsubscribeEvents -> close` and `stopWatch`.
- `useProjectCollection` fell back to a local `Project` whenever a
  `WorkspaceSnapshotStore` existed but had no snapshot yet, and silently
  returned from `addProject()` when the snapshot was null or had no view id.
  That violated the server-owned model during every hydration and disconnect
  window and made the plus button look broken.
- The dynamic `terminal.create` path created a PTY session without consistently
  creating the corresponding server-owned panel record, while the CLI's initial
  workspace setup created both. The default path and the dynamic path therefore
  behaved differently, and `src/App.tsx` papered over the gap by synthesising
  renderer presentation, which split presentation authority.
- Browser HTTP/1 connection slots were saturated by multiple independent SSE
  streams, so later `workspace.command` calls could only be accepted after a
  reconnect. Local event subscriptions must multiplex over one SSE stream per
  transport.
- With the shared workspace navigation hidden, the layout used one grid column
  while the content was still pinned to column 2, producing a zero-width black
  workspace and pushing terminal controls out of the real hit target.

Final browser validation added a sixth: Dockview can focus
`.dv-content-container` after the terminal pointer handler runs, so a visible
terminal click must reassert xterm focus on the next frame for keyboard input to
reach the attached server-backed terminal.

## Goals / Non-Goals

Goals: restore the server as the only source of committed project, panel, and
terminal presentation state, and make expected transport close and reconnect
paths quiet.

Non-Goals (recorded as explicit non-goals by the change):
- Do not reintroduce renderer-authoritative durable workspace state.
- Do not hide failures behind optimistic UI that the server never confirms.
- Do not make a manual browser reload or reconnect part of the normal
  create-project or create-terminal workflow.

## Decisions

- **Cleanup is idempotent, not connection-dependent.** Unsubscribe removes the
  local handler and tolerates an already-closed transport. This crosses the
  client/transport boundary, where "expected failure" and "defect" had been
  conflated.
- **One connection generation model shared by web and Electron.** Old contexts
  are marked stale; ordering of disposal, creation, hydration, and reconnect UI
  is deterministic rather than incidental.
- **Server-owned panel identity.** Terminal Dockview panels keep the canonical
  server panel id instead of synthetic `terminal-N` / `pending:*` ids, so the
  close hook can address the real server panel and close cannot be resurrected
  by the next snapshot.
- **Absence of a snapshot is a state, not a licence to invent one.** A connected
  client with no snapshot shows loading or unavailable; it never fabricates a
  project.
- **Subscription over polling for the connected snapshot store.** The 1.5s full
  snapshot poll was itself a source of Git-status churn.

## Risks / Trade-offs

Removing the local-project fallback makes hydration latency visible where it was
previously masked, which is the intended trade: a visible loading state is
preferable to a fake project that later duplicates. Local Electron keeps a
native `terminayGitWorktreeHost` fallback when the server Git projection reports
an empty or non-repository state for an inspectable local folder — a deliberate
exception, scoped to Local mode and to inspection only.

## Migration Plan

No stored data changes. Clients that had accumulated fallback-created local
projects converge on the server snapshot on next connect.
