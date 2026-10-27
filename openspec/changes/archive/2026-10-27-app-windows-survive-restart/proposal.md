## Why

A person quits or updates Terminay with an agent still working, opens it again, and finds the agent's terminal back exactly as it was but the window that agent showed over it gone. The terminal outlives the server because its shell is held by the session holder (ADR-0035) and its panel is durable workspace state; the window does not, because the server keeps window records only in memory and the spec says a window SHALL NOT outlive the server process.

## What Changes

- The server writes every app window record to its data directory as it changes, and on start brings back the windows of each terminal session that is running again after reattach. A window ends with its session as before: one whose terminal did not come back is discarded.
- A restored window keeps its id, title, source, open or minimised state, document, data, tool input, and tool result, so the agent that opened it can still address it and the view starts from the same record.
- MCP-app windows are restored too. A tool call that was still running when the server stopped is recorded as cancelled, and a view's own calls to its MCP server fail with the ordinary error until that server is connected again.
- What a person typed into a view, its scroll position, and its script state are not kept: a restored view starts fresh from its document.
- Quitting while keeping terminals no longer ends windows; quitting and ending terminals, closing a window, the session ending, and disabling MCP still end them and remove what was written.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `terminal-app-windows`: a window outlives a server restart while its terminal session does, and is restored from the server's saved record.
- `server-owned-workspace-state`: the server-persisted inventory includes app window records of running terminal sessions.

## Impact

- `packages/server-core/src/appWindows/index.ts`: a persistence backend for window records, a load-and-restore step, and a shutdown that releases windows without ending them.
- `packages/server-core/src/composition.ts`: restore after held sessions are reattached; shutdown with a session holder stops calling `endAll()`.
- `electron/serverTerminalAuthority.ts` and `apps/terminay-server`: give the service its directory under the data root.
- E2E: `e2e/app-windows-survive-restart.spec.ts` covers reload and relaunch.
