## Context

ADR-0008 puts workspace state behind the server and makes Desktop and the browser presentation shells over an opaque transport. Terminal restart recovery was written before there was a second host, into the only bootstrap that existed: `ServerTerminalAuthority.initializeWorkspace()` in `electron/`. Its helper on the shared store is even named for that host — `discardStaleLocalTerminalState`, commented "Local Desktop owns these PTYs".

The daemon then grew a thinner bootstrap and inherited nothing. `apps/terminay-server/src/cli.ts` seeds one terminal `if (workspaceWasCreated)` and never reaps. Restart it and every terminal panel from the previous process returns as a tab whose process is gone.

The two hosts are not otherwise divergent: both build the same services through `createServerCoreComposition`, and its `start()` already runs startup recovery for project environments after extension activation. There is a place for this; it was not used.

## Goals / Non-Goals

**Goals**
- One implementation of workspace startup restore, owned by the server, running for every host.
- The daemon and Desktop restore the same repository the same way.
- Less code than before.

**Non-Goals**
- Moving the rest of `ServerTerminalAuthority`. The file-catalog, documentation, MDX, and file-content project contexts it holds are the same kind of misplacement and want the same treatment, but they are a larger change with a larger blast radius and do not need to move to fix this.
- Changing what a restored workspace looks like. Desktop's current behaviour is the specified behaviour; this makes it the server's and gives it to everyone.

## Decisions

### D1. The restore runs from `composition.start()`

That function is already the server's startup-recovery seam, it already has the workspace store, the terminal service, and the launch resolver, and both hosts already await it. Putting the restore anywhere else would mean two call sites again, which is the defect.

### D2. Session creation stays a seam

Desktop's `create()` does bookkeeping the daemon has no equivalent for — replay buffers, detachable consumers, renderer bindings. The restore therefore asks for a session through an optional `createTerminalSession` callback, defaulting to the resolver path the daemon already uses. The policy — what to discard, which projects to seed, in what order, with what retry — is shared; only the act of making a session is host-supplied.

### D3. `discardStaleLocalTerminalState` becomes `discardStaleTerminalState`

The name asserted the wrong precondition and is a fair part of why the daemon never called it. What makes those panels stale is that the process that owned the terminals is gone, which is as true of a daemon restart as of a Desktop one.

### D4. First run stops being a special case

Desktop seeds the first terminal through the same method that seeds replacements; the daemon has a separate `ensureDefaultTerminalSession` behind a `workspaceWasCreated` flag. One path covers both: an empty project needs a terminal, and it does not matter whether the workspace was empty because it is new or because its terminals were just reaped.

## Risks / Trade-offs

Desktop's restore currently runs before it publishes readiness, and it seeds the active project first so the first visible tab is ready early. That ordering is preserved in the shared implementation rather than left to the caller, because losing it would show an empty tab on every Desktop start.

The Desktop authority keeps its `registerProjectRoot` loop, which rebuilds process-local file and Git bindings. That is genuinely host-state today and stays until the larger move.

## Migration Plan

None. Restored workspaces are read as they are; the first daemon restart after this change reaps whatever the previous ones left behind.

## Open Questions

None.
