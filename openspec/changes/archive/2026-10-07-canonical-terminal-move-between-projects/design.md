## Context

A terminal lives in two places on the server, and they have never had to agree about a move.

**Workspace state** (`packages/server-core/src/workspace.ts`) holds `panels[id].projectId` and `terminalSessions[id].projectId`, and validates that a terminal panel and its session name the same project. Its `panel.move` reducer rewrites both to the target project. `WorkspaceClient.movePanel` in `client-core` sends it. Nothing in the product calls it for a live terminal.

**The terminal service** (`packages/server-core/src/terminalService/`) identifies a live PTY by a frozen `{serverId, projectId, sessionId}` fixed at launch. `assertIdentity` and `authorize` in `service.ts` refuse anything that names another project. Around the service, six maps are keyed by a string that embeds the project: presentation leases and their revisions, checkpoint sessions and pins, the three input-source maps, consumer subscriptions, and the adapter and protocol `byClientSession` maps. The activity service, the agent status service, an active recording's metadata, the Electron authority's session cache, and the MCP capability store each keep their own copy of the terminal's project.

The renderer works around the gap. `moveTerminalToProject` in `src/App.tsx` closes the Dockview panel in the source workspace and re-adds it in the target, carrying the original project forward as `serverProjectId` so the panel can keep attaching under the identity the server still holds. The reconciliation pass in the same file then looks the session up by its canonical project, finds the source workspace no longer presents it, and adopts it there again. That is the reported bug, and `e2e/terminal-move-between-projects.spec.ts` reproduces it.

The decision taken with the owner is that a move is permanent and server-owned: after a restart, or on another device, the terminal is in the project it was moved to.

In-force ADRs that constrain this: ADR-0011 (project and terminal-session boundaries are security boundaries; credentials resolve to immutable server/project/session state), ADR-0017 and ADR-0018 (a panel never crosses servers; ids are per-server), ADR-0035 (the detached session holder owns PTYs and the server reattaches after restart), ADR-0031 (MCP authority is scope times user policy), ADR-0028 (no polling).

## Goals / Non-Goals

**Goals:**

- One meaning for "moved": the server commits it, every client presents it, and it survives restart.
- The moved terminal keeps its PTY, session id, scrollback, and output position.
- No state anywhere on the server still names the source project for a moved terminal.
- The context menu and the project-tab drop share one move path.
- A failed move changes nothing.

**Non-Goals:**

- Moving a terminal to another server, into or out of the automation space, or between workspace views by any new route. `panel.move` policy already refuses the first two.
- Moving file or folder panels between projects from the UI. `panel.move` supports them; no gesture offers it, and this change adds none.
- Re-deriving a running shell's environment, working directory, or shell profile from the target project. The process is the one that was launched; only its ownership moves.
- Reissuing an MCP capability to a running shell.
- Changing how popped-out terminal windows present a session.

## Decisions

### 1. A move retires the old identity and binds a new one; nothing is re-keyed

`TerminalService.rehomeSession(sessionId, targetProjectId)` ends every subscription made under `{server, source, session}` and then replaces the session's identity with a freshly frozen `{server, target, session}`. The PTY, the output ring, the output position, and the session-holder connection are not touched.

Around the service, the protocol registry's `retireIdentity` ends what was bound to the old identity: protocol attachments (each client is told its stream closed) and any initial-presentation reservation, the presentation lease and its revision, checkpoint pins, resize ownership and input sequence state, and consumer subscriptions. Input still queued for the old identity is refused by the service's own identity check when its turn comes.

The checkpoint authority's emulator is the one thing that is carried rather than ended. It is the terminal's scrollback, not a credential, and closing it would leave a client that attaches after the move with a blank screen. `rehomeSession` on the authority moves the emulator to the new identity and clears its pins, which are the credentials.

This crosses the terminal-session boundary of ADR-0011, and is shaped to keep its invariant: an identity is never edited, so no attachment, pin, lease, or credential minted for the source project can come to resolve to state in the target project. Recorded as ADR-0043.

*Alternative considered — re-key each map in place and keep attachments alive.* Rejected. It turns one immutable identity into a mutable one across seven layers, each of which compares identity for authorization, and one missed key leaves a credential for project A resolving to a terminal in project B. Attached clients would also have to accept events whose identity changed mid-stream, which `client-core` deliberately drops.

*Alternative considered — keep the launch project as the terminal's identity and move only the panel.* Rejected with the owner: MCP reach, close protection, listings, and authorization would stay with a project the terminal is no longer shown in.

### 2. The re-home runs inside the workspace command, after commit and before publish

`workspaceProtocol.ts` gains an optional `rehomeTerminalSession({ sessionId, sourceProjectId, targetProjectId })` callback. The move is read from workspace state before the command is applied, so the source project is known even when the terminal service no longer holds the session, and a command replayed after it already committed carries no move. Both command paths — `applyCommand` for clients and `applyHostCommand` for the host — call it when a `panel.move` of a terminal panel has committed and before `publishWorkspaceChange`. A client therefore never sees a revision in which the panel is in the target project while the terminal still answers to the source.

The callback is synchronous and must not undo a committed move: it only releases in-memory state and swaps one object, and the composition runs each follower independently so one failing cannot stop the rest. If the terminal service does not hold the session, the service step is a no-op and workspace state alone carries the move. The workspace commit therefore stays the single point of failure, and there is no rollback path to get wrong.

The `panel.move` reducer also adds the session id to its changed ids, so subscribers that filter on session ids see the move.

*Alternative considered — a `workspace.subscribe` listener.* Rejected: it runs after publication, which is exactly the window this decision closes.

*Alternative considered — re-home first, then commit.* Rejected: a revision conflict would then need the terminal moved back.

### 3. Everything else that stores the terminal's project follows in the same step

`composition.ts` wires `rehomeTerminalSession` so that one call updates, in order: the terminal service (decision 1), the activity service's session record and reducer project, the agent status service's terminal identity, and the project of an active recording. A finished recording stays with the project it was made in.

The Electron authority updates its cached `AuthoritySession.projectId` from the same callback, and `electron/main.ts` revokes the terminal's MCP capability. The standalone host wires the same composition callback and has no authority cache or capability store.

The MCP capability is revoked rather than replaced. The token lives in the running shell's environment and cannot be changed from outside, and the MCP contract already says a token is "replaced or revoked atomically when its terminal changes project". Session grants end with it, as `mcp-permissions` already states.

The session holder's own `projectId` field is recorded at spawn and is not read on reattach — `reattach.ts` rebuilds identity from workspace state by session id — so a moved terminal comes back under the target project after restart with no holder change. This is asserted by a test rather than assumed.

### 4. The renderer sends the command and lets reconciliation place the panel

`moveTerminalToProject` stops rearranging panels. It records a pending move `{ sessionId → targetProjectId }` in the shell and calls `workspaceSnapshotStore.movePanel`. If the command is rejected, it clears the pending entry and reports the error through the existing error banner; nothing local has changed.

The reconciliation pass gains one rule. For each session, if a workspace other than the canonical project's presents it, that presentation is relocated: the presenting workspace exports the panel (the existing `exportTerminalForMove`, which marks the session as moving so removal neither closes the canonical panel nor cancels its macro runs), and the canonical workspace adopts it with the exported presentation and the canonical project as its attach identity. If the session has a pending move, the pass also activates the target project and focuses the terminal, then clears the entry. Without a pending entry — another client moved it — the terminal is adopted inactive and nothing steals focus.

A window that presents the source project but not the target has nowhere to relocate the panel to. Each workspace therefore also lets go of a terminal panel whose canonical project is no longer its own, again without closing the canonical panel.

One mechanism therefore covers this client's own move and another client's, and it is the only place a panel changes workspace. `MovedTerminalTab.serverProjectId` stops meaning "the project the PTY was launched in" and is always the canonical project.

This is command-first rather than optimistic, as `server-owned-workspace-state` requires for terminal-lifecycle actions. The visible cost is one command round-trip before the tab moves; on the embedded server that is not perceptible.

*Alternative considered — keep the optimistic local move and send the command behind it.* Rejected: until the commit arrives the reconciliation pass sees exactly the state that causes today's bug, so it would need a suppression list, and a refused move would need a visible rollback.

### 5. The drop gesture is unchanged above the move function

The project-tab drop from `drag-terminal-tab-to-project` still records a target and calls `moveTerminalToProject` at drag end. Its source-shape test in `scripts/terminal-tab-project-drop.test.mjs` pins the old export/adopt call counts and is updated to pin the new shape: one `movePanel` call in the move function, and export/adopt only inside reconciliation.

## Risks / Trade-offs

- [An identity-keyed map is missed, leaving state for the source project behind] → A `server-core` test builds a session with a live attachment, lease, checkpoint pin, queued input, resize owner, and consumer, re-homes it, and asserts each layer holds nothing under the old key and refuses the old identity.
- [Input typed in the instant of the move is dropped with the old input queue] → Accepted. The window is the length of one command, the user is mid-gesture, and delivering it would mean carrying a queue across identities.
- [An agent in the moved terminal loses Terminay MCP] → Accepted and already the contract. Called out in the proposal as the one breaking effect.
- [A client that was attached sees an attachment-closed error before it relocates the panel] → The relocating client destroys and recreates the panel in the same reconciliation pass, so the old panel never renders the error. Other clients are covered by the same pass on their next projection; an e2e case with two clients asserts no error surface remains.
- [The responsive web client presents terminals from the projection but does not share the desktop reconciliation code] → Checked during apply: the web host mounts the same `App` through `ConnectedRendererWorkspace`, so it runs the same reconciliation pass, and Home's own terminal views present only automation-space terminals, which cannot be moved.
- [A popped-out terminal window presents a session outside its project's workspace and could be mistaken for a stale presentation] → The relocation rule only acts between project workspaces of one window. The existing tolerance for panels that exist canonically elsewhere stays for popouts; an existing popout e2e case guards it.
- [Ended sessions kept readable] → Only an automation-space terminal is kept readable after exit, and `panel.move` policy refuses moves into or out of that space, so no readable ended session can be moved. A test moves an exited ordinary terminal's panel and asserts the server keeps one answer for its project.

## Migration Plan

None is needed for data: `panel.move` already persists the session's project, and restart already rebuilds identity from workspace state.

Server and UI ship together in both hosts (ADR-0018), so there is no supported pairing of a new renderer with an old server. Rollback is reverting the change; terminals moved while it was live stay in their target project, which the reverted renderer presents correctly from the projection.

## Open Questions

None. ADR-0011 is not revisited: its invariant that credentials resolve to immutable server/project/session state is kept by retiring identities rather than editing them, and the new ADR records that reading.
