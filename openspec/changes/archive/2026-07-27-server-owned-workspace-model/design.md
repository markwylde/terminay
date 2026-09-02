## Context

See proposal.md. The renderer held the workspace model in `src/App.tsx`, Dockview
serialization defined layout, and Electron bound PTYs to `webContentsId`. Every
authorization and lifecycle decision therefore depended on a window that the user could
close at any moment.

## Goals / Non-Goals

Goals:
- One canonical, revisioned, persisted workspace model owned by server-core.
- Terminal-session identity that survives renderer reload, window close, and server restart.
- A compatibility path that keeps the current desktop UI working during the transition.

Non-Goals:
- Rewriting every renderer component onto the new client API in this change.
- Replacing the Electron IPC transport with the local server process transport; that is
  handled by the separate server-runtime work.

## Decisions

- **Model without host handles.** Terminal, file, and folder panel state is modelled in
  server-core without importing Dockview types. Normalized split, order, and active state
  is separate from native window ids and screen pixels, so the same model renders on any
  host.
- **Close semantics are four distinct operations.** Closing a client window, a logical
  workspace view, a panel, and a PTY are defined independently; a renderer detaching is
  never a panel close.
- **Interruption is represented, not hidden.** Sessions that were live before a server
  restart are recorded as interrupted tombstones. `reportWorkspaceRecovery` returns explicit
  metadata for missing roots and interrupted sessions while preserving canonical project and
  session ids rather than silently replacing them.
- **Multi-object moves are atomic.** A move that touches several objects commits as one
  revision, so concurrent conflicting moves produce one commit and one explicit conflict
  rather than duplicated panels or sessions.
- **Boundaries are identity-based.** Object, server, and project scopes are enforced from
  canonical ids, independently of client focus or user-facing labels.
- **Persistence is deliberately narrow.** Only documented canonical state is persisted;
  modal, hover, drag geometry, search text, and unbounded terminal content are excluded.
- **Compatibility is scoped, not open-ended.** The Desktop bridge wraps every framed
  MessagePort packet in a fixed versioned server scope and exposes only `TerminayClient`
  to the renderer. `ServerTerminalAuthority` uses bounded client consumer tokens and keeps
  numeric renderer ids only as a subscription alias. Cross-window adopted-project payloads
  are replaced by a write-scoped `project.move` command while the drag UX is unchanged.

## Risks / Trade-offs

- The compatibility adapter keeps a renderer-id alias alive for the duration of the
  transition; focused tests reject mismatched or malformed server scopes to bound the risk.
- Seeding the first canonical workspace from the existing renderer model discards
  renderer/window fields and does not resurrect interrupted sessions, which is a visible
  one-time behaviour change on first upgrade.
- Broad UI drag and adoption end-to-end coverage remained open at the time of this change;
  real Electron coverage verified tear-off/adoption, edit/rename/close, splits, popout, and
  close behaviour (`e2e/project-tabs.spec.ts` 2/2, `e2e/workspace.spec.ts` 7/7).

## Migration Plan

Seed the first canonical workspace from the current or default renderer model, then persist
forward through bounded `view.create`, `project.create`/`project.move`, `terminal.create`,
and panel commands with expected revisions. The Electron IPC transport adapter stays behind
the shared client contract until the local server process replaces it.
