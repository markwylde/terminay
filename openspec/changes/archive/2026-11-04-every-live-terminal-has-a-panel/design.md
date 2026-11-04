## Context

ADR-0071 decision 1 says every running terminal belongs to a project and has a panel. The server enforced that at creation (`onSessionCreated` in `composition.ts`) and on restart (`reattachHeldSessions` recovers held strays into "Recovered terminals"). Between those moments the terminal service (`sessionsById`) and the workspace (`panels`) can drift apart:

- `panel.close` from a client calls `terminal.kill`, which only signals the PTY, through `Promise.allSettled`, then removes the panel. A shell that does not exit, or a kill that fails, keeps running with no panel.
- `applyHostCommand` (`panel.close`, `project.close`) never ends a PTY.
- Desktop authority, the automation executor, and MCP `open_terminal` spawn first and commit the panel afterwards, across awaits. The standalone server's startup restore spawns and commits no panel.
- Reattach adopts every persisted `terminalSessions` record as live, and the workspace allows a record without a panel (`terminal.create`).

The close preflight counts live sessions in the terminal service, so the user is warned about a process that no surface shows.

## Goals / Non-Goals

**Goals:**
- No running terminal stays without a panel for longer than a short grace, whatever path left it there.
- A recovered terminal lands where a person looks first: its own project's General folder.

**Non-Goals:**
- Finding and fixing each path that can drop a panel. The invariant is enforced at one place, so a future path cannot reintroduce the bug.
- Changing what closing a tab does. A shell that survives its close is shown again, not killed harder.

## Decisions

### One server-side invariant, checked on change

`bindLiveTerminalPanels` compares running sessions in the terminal service with terminal panels in the workspace. It runs after every committed workspace change (the store's `subscribe`, deferred to a microtask so it never applies inside another commit) and once at the end of `start()`, after reattach and startup restore. Those privileged startup steps install state without notifying subscribers, which is why `start()` asks explicitly.

Alternative: patch each leaking path. Rejected: there are at least five, two in host code, and the next new creator would leak again.

Alternative: a periodic sweep. Rejected by ADR-0028 (no polling without owner approval). The only timer is a one-shot that exists while a panel-less terminal waits out its grace.

### A grace before giving a panel

Every creator spawns the PTY before it commits the panel, so a session is panel-less briefly by design. Giving it a panel inside that window would make the creator's own `terminal.createPanel` fail and the creator kill the session. The reconciler records when it first saw each panel-less terminal and acts only after 5 seconds without a panel. A terminal that gets its panel, exits, or is ended in that time is forgotten.

### Where the panel goes

- The project still exists, and the workspace has a session record for it in the same project: `panel.create` for that session. No folder is named, so the reducer places it in General, found by kind (wherever General sits in the order). No title is named, so the server assigns the next `Terminal N`.
- The project exists, but the workspace has no record: `terminal.createPanel`, which commits the record and the panel together.
- The record names another project than the live session: a move is committing and brings its own panel, so the reconciler does nothing.
- The project is gone: the terminal is ended. Closing a project already promised to end its terminals.

The panel id is `p:<sessionId>`, as creation uses, with a numbered prefix if that id is taken. Each attempt has its own command id, because the workspace caches a refused command id.

Boundaries: this runs inside Terminay Server, which owns terminal-session lifecycle and workspace state. It applies host commands, so no client authority is involved. The session keeps its identity and project, so the project/terminal-session security boundary is unchanged (ADR-0043, ADR-0068).

## Risks / Trade-offs

- [A creator takes longer than the grace to commit its panel] → It would race the reconciler, and the creator's `terminal.createPanel` would be refused. The creator then kills the session. Every current creator commits within one round trip, and 5 seconds leaves wide margin.
- [A shell that ignores its close signal comes back as a tab] → This is intended. A running process must be visible, and the user can close it again.
- [A standalone restart shows a restored terminal 5 seconds late] → It previously never showed it at all.

## Migration Plan

None. No persisted shape or protocol changes. Rollback is reverting the binding.

## Open Questions

None.
