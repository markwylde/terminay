## Why

Moving a terminal tab into another project breaks it. The tab lands in the new project, then the next time anything in the workspace changes it reappears in the old project as well, the copy in the new project stops receiving output and shows `terminal presentation renewal failed: terminal attachment is closed`, and moving it back produces more errors. After a restart, or on another device, the terminal is back in the project it started in.

The cause is that the move never reaches the server. The renderer closes the Dockview panel in one project and re-adds it in the other, while the server still owns the panel and its session under the original project. The next reconciliation pass correctly re-adopts the terminal where the server says it lives, and two panels then contend for one session. `e2e/terminal-move-between-projects.spec.ts` reproduces this on every run.

## What Changes

- Moving a terminal to another project — from **Move to project** or by dropping its tab on a project tab — becomes a server-owned move. The renderer sends the existing `panel.move` workspace command and presents the result; it no longer rearranges panels on its own.
- The server re-homes the live terminal with the panel. The same PTY, session id, scrollback, and output position continue under the target project, and the terminal belongs to that project everywhere: on every connected client, after a restart, in terminal listings, close protection, activity and agent status, and recording ownership.
- Everything bound to the terminal's old project identity ends when the move commits: attachments, presentation leases, checkpoint pins, queued input, and the terminal's MCP capability. Clients attach again under the new identity. A request that still names the old project is refused.
- Every client converges on the move. A client presenting the terminal in the source project relocates it to the target project, keeping what is local to the panel (note, colour, emoji, running macro state); the client that asked for the move activates the target project and focuses the terminal.
- A refused or failed move leaves the terminal where it was, still attached and running, and says why.
- **BREAKING** for an agent running in the moved terminal: its Terminay MCP capability is revoked by the move, as the MCP contract already requires, and is not reissued to the running shell.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `workspace-and-project-tabs`: adds the requirement that moving a terminal to another project is committed by the server, is presented once, survives restart and other clients, and fails in place.
- `terminal-workspace`: the terminal authorization identity requirement gains the rule that a committed panel move retires the terminal's identity under the source project and binds one under the target project for the same PTY.
- `server-owned-workspace-state`: adds the requirements that a terminal panel move and its session re-home commit as one change, and that a client relocates a presented terminal whose canonical project changed.

## Impact

- `packages/server-core`: `workspace.ts` (`panel.move` reports the session among its changed ids), `workspaceProtocol.ts` (a post-commit re-home step on both the client and host command paths), `composition.ts` (wiring), `terminalService/` (`rehomeSession` and the release of identity-keyed state in the lease, checkpoint, input-source, consumer, adapter, and protocol layers), `activity/` (session project follows the move), `recordingService/` (an active recording follows the move).
- `electron/serverTerminalAuthority.ts` and `electron/main.ts`: the authority's cached session project and the MCP capability revocation on move.
- `apps/terminay-server/src/cli.ts`: the same wiring for the standalone host.
- Renderer: `src/App.tsx` (`moveTerminalToProject`, the reconciliation pass), `src/workspace/useTerminalAdoptionController.ts`, `src/workspace/terminalTransferOrchestration.ts`. The context menu and the project-tab drop keep calling the one move function.
- `packages/client-core/src/terminal.ts`: a new attach is no longer blocked by a prior attachment the server has already ended, which is what a terminal moved away and back leaves behind.
- No new protocol command, no wire-format change, and no persisted-state migration: `panel.move` already exists, already rewrites the persisted session project, and restart already rebuilds a terminal's identity from workspace state.
- Tests: `e2e/terminal-move-between-projects.spec.ts`, new `server-core` suites for the re-home, and the existing `panel.move`, terminal identity, activity, and authority bookkeeping suites.
- Bears on ADR-0011 (project and terminal-session boundaries) and ADR-0035 (the session holder owns PTYs); a new ADR records how a terminal changes project.
