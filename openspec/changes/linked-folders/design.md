## Context

The proposal adds a folder level between project and panel, links folders to Git worktrees, and moves the terminal that created a worktree into its folder. The layout was settled through five rounds of clickable prototypes; the last one is the reference for presentation: <https://claude.ai/artifact/Mpv8Js8dtN7kQjYxGzuN3U>.

What the code looks like today, which shapes most of the decisions below:

- **Workspace model** (`packages/server-core/src/workspace.ts`). A `WorkspaceProject` has one `root`, one `panelIds` list, one `activePanelId`, and one `layout: LayoutNode`. Panels and terminal sessions carry `projectId` only. Key lists are closed (`PROJECT_KEYS`, `assertOnlyKnownKeys`), and `migrateWorkspaceState` accepts only the current schema version (5) or version 0.
- **Persistence.** The wired backend is `FileWorkspaceStateBackend`, a whole-state temp-write and rename of one JSON file. ADR-0002 describes a SQLite repository; this change does not depend on which backend is in use and does not revisit that ADR.
- **Layout.** The server's `LayoutNode` is coarse: every panel command resets it to one stack and `panel.split` produces a single two-way split. The renderer never reads it. Each project mounts one `<DockviewReact>` built imperatively from panel lists (`reconcileServerPanels`), and split geometry is live renderer state that is not persisted anywhere.
- **Panel lifecycle.** `useDockviewPanelLifecycle` turns any Dockview panel removal into a server `panel.close`. "Closing the final panel closes the project" is client-side only (`api.panels.length === 1`).
- **Worktrees.** `GitService` lists worktrees and observes the repository common directory with `fs.watch`; a change under `<common-dir>/worktrees/` invalidates the listing and emits `git.status.changed`. There is no "worktree added" event. Worktree ids are derived from the canonical path, so they change when a worktree is renamed or moved. Pull-request and check facts arrive through `WorktreeInsightService` (ADR-0029).
- **One root per project.** File, Git, and agent-scope services are bound to `project.root`. Reaching another worktree's files means `project.root.update`, which is what "Switch project root" and cross-worktree file operations do.
- **Attribution.** Nothing records which terminal ran a command. The server knows each terminal's shell process and can walk a process's parents to it (`ProcessAncestry`, used to bind agent sessions under ADR-0025). The environment of a new terminal is assembled by the server, which is where the terminal capability variables are added.

In-force ADRs that constrain this design: 0011 (trust boundaries), 0020 (per-operation canonical roots), 0021 (background cost is measured in spawns), 0025 (agent sessions bound by ancestry), 0028 (no polling without owner approval), 0029 (worktree facts are host-owned), 0031 (MCP authority is scope times policy), 0040 (Home's Dockview is separate), 0043 (a terminal changes project by retiring its identity), 0047 and 0048 (a window is one server; connections belong to windows), and 0051 (Terminay does not instrument agents), which this change prompted.

## Goals / Non-Goals

**Goals:**

- A folder is a canonical, server-owned object that every device agrees on.
- Every worktree of the project's repository has exactly one folder, with no user action.
- The terminal that created a worktree ends up in that worktree's folder without the user doing anything, and can be put back with one action. This works the same whichever agent, script, or person ran the command.
- Files, Changes, and new terminals follow the selected folder without changing the project's root.
- A project with no repository works the same way, minus everything Git-shaped.
- Project tabs, their reordering, and tear-off are untouched by tab peek.

**Non-Goals:**

- Persisting Dockview split geometry. It is not persisted today, per project, and stays that way per folder.
- Nested folders, or a folder that spans projects.
- Making a folder a security boundary. Authority stays server, project, and session.
- Linking a plain folder to a worktree by hand. Every worktree already has its folder, so a manual link would have nothing to point at.
- Changing the Home dashboard's grouping. Rows stay grouped by project; activating one selects its folder.
- Changing the shared Git route used by the compact web client beyond what the folder-scoped queries require.

## Decisions

### 1. A folder is a workspace object; the project's panel list becomes derived

`WorkspaceState` gains a `folders` map. A `WorkspaceFolder` holds `id`, `projectId`, `name`, `kind` (`general` | `plain` | `linked`), an optional `worktree` link, `panelIds`, `activePanelId`, `layout`, an optional `createdByPanelId`, and an optional `captureOffer`. `WorkspaceProject` gains `folderIds`. Panels gain `folderId`. Folder ids are issued by the server inside the command that creates the folder.

A folder's panels are the source of truth. The project's `panelIds`, `activePanelId`, and `layout` stay on the project for now, but no command sets them: one function, `syncProject`, recomputes them from the folders at the end of every command that changes a folder, and validation rejects a state where they disagree. Sixty-three files read a project's panel list directly, and this lets them keep working while they are moved over to folders one at a time. Task 2.9 removes the three fields once nothing reads them.

Removing the fields in the same step as adding folders was the first plan. It was set aside because it would have changed the model, the protocol, both hosts, and the renderer in one commit with no point at which the product still ran. Keeping two independently written orderings was rejected outright: every command would have to keep them consistent. A derived value recomputed in one place does not have that problem.

**Boundary:** none crossed. This is workspace state inside one project. `commandProjectIds` continues to derive the project scope of every command, so `claims.projectId` authorization is unchanged; a command that names a folder resolves the folder to its project on the server.

### 2. A folder move is its own command and retires nothing

`panel.moveToFolder { panelId, folderId, index? }` moves a panel between two folders of one project. It does not go through `panel.move`.

ADR-0043 makes a cross-project `panel.move` retire the terminal's `{serverId, projectId, sessionId}` identity, which ends attachments, leases, and capabilities. A folder move changes none of the three, so it must not trigger a re-home: `terminalSessionRehomedBy` already returns nothing when the project is unchanged, and the new command never reaches it. Reusing `panel.move` with an optional folder was rejected because it would put an identity-retiring path and a non-retiring path behind one name.

`panel.move` to another project places the panel in the target's General folder.

**Boundary:** the terminal-session identity boundary (ADR-0011, ADR-0043). The decision is that a folder is deliberately outside it. Recorded as ADR-0049.

### 3. Each folder mounts its own Dockview

The renderer mounts one `<DockviewReact>` per folder inside `ProjectWorkspace`, lazily on first selection and kept mounted afterwards, the way projects are kept mounted today. Only the selected folder's Dockview is visible.

Swapping one Dockview's contents on folder change was rejected: removing panels from Dockview is what sends `panel.close`, so a swap would need every removal guarded, and a missed guard closes a terminal. With one Dockview per folder, switching folders removes nothing. A move between folders removes a panel from one Dockview and adds it to another, and uses the existing `movingTerminalSessionIdsRef` guard that cross-project moves already rely on.

`workspaceRefs` becomes keyed by project and folder. Inventory, activity badges, and the status bar's layout miniature read the selected folder's handle. This keeps to ADR-0040: folder Dockviews are project panel hosts and share the project panel lifecycle; Home's Dockview stays separate.

Cost: memory grows with the number of folders a user has visited in a session. Terminal surfaces in hidden folders behave as terminals in background projects already do.

### 4. A folder's root is resolved by the server, per operation

A linked folder stores a link, not a path the client can set: `{ repositoryId, worktreePath }`, written only by the server from its own worktree listing. `folderRoot(projectId, folderId)` returns the project root for General and plain folders, and for a linked folder the worktree path after confirming, against a fresh bounded listing, that it is still a registered worktree of the repository that contains the project root.

File, Git, language-intelligence, and launch requests gain an optional `folderId`. The server turns it into a root at the start of the operation and threads that canonical value through the operation, as ADR-0020 requires. No root is cached across operations.

This widens what a project scope reaches: today file operations are contained in `project.root`; after this change they are contained in the project root or the root of one of the project's linked folders. The alternative that keeps the scope unchanged is what the product does today, `project.root.update` on every selection. It was rejected because the root is shared server state: one device selecting a folder would repoint Files, Git, agent scope, and the launch default for every other device, and for every terminal in every other folder.

**Boundary:** the filesystem and Git services to project root boundary (ADR-0011, ADR-0020). Recorded as ADR-0050.

### 5. One reconciler keeps folders in step with worktrees

A `FolderReconciler` in `packages/server-core` subscribes to the worktree listing that `GitService` already maintains. On each new listing for a bound project it issues host commands through `applyHostCommand`:

- a worktree with no folder gets `folder.create` with kind `linked`;
- a linked folder whose worktree is gone has its panels moved to General and is then removed;
- a worktree whose path changed through Terminay's own rename or move keeps its folder, because the rename operation rewrites the link in the same commit, using `worktreeIdBefore` and `worktreeId`.

It adds no watcher and no timer. It consumes the existing registry watch (ADR-0028), and it runs only for projects that are bound, so a closed project does no work. `ProjectAgentScope` keeps its own registry watch for now; folding the two together is out of scope.

The link is keyed on canonical path and repository id, not on `GitWorktreeId`, because the id is a digest of the path and gives nothing extra. A worktree renamed outside Terminay is seen as one removal and one addition: its terminals land in General and a new empty folder appears. That is accepted; see Risks.

**Boundary:** none new. The reconciler runs inside the server and issues the same validated commands a client would.

### 6. Attribution comes from the terminal, never from the agent

The registry watch says a worktree appeared and nothing about who made it. The first version of this design filled that gap from agent behaviour: an agent session's reported directory moving into the new worktree. A spike showed that works for one agent using one tool, and ADR-0051 now rules the whole approach out: a feature may not depend on which agent is in the terminal. The measurements for everything below are in [worktree capture signals](../../adr/evidence/worktree-capture-signals.md).

The rule in the spec is therefore about the command: the terminal that created a worktree is the one whose process tree ran the Git command that registered it. Two mechanisms can establish that.

**A. Git reports its own commands (primary; approved by the owner and recorded as ADR-0052).** Terminay sets Git's Trace2 variables in the environment of each terminal it launches: an event target that is a Unix socket owned by the server, the brief and shallow-nesting options, and a parent session id unique to the terminal session. Every Git process started anywhere under that terminal inherits them and sends a `start` event with its argument list and a session id that begins with the terminal's. The server reads the stream line by line, acts on `worktree add`, and discards everything else as it arrives; nothing is buffered beyond the line being parsed and nothing is stored, so memory does not grow with use. It was seen 20 times out of 20 on macOS and on Linux, always before Git exited, at about half a millisecond and 4.5 KB per Git command.

- The socket lives at a short path under the server's runtime directory, because Unix socket paths are capped near 104 bytes.
- A terminal that already has `GIT_TRACE2_EVENT` set, from the user's own profile or shell, keeps it; Terminay does not override it and that terminal falls back to B.
- The parent session id is a random per-session token that the server maps to a terminal session. A client never sees or supplies it, and an event carrying an unknown token is ignored.
- A reported `worktree add` is matched to the worktree that then appears by the directory name in its arguments. The server remembers at most 32 such commands, ignores one older than two minutes, and uses each once. Two terminals adding the same directory name at the same moment name nobody.
- The stream is input from processes the server does not trust. It is parsed with bounded line length, used only to decide which terminal to offer or move, and never as a path to act on: the worktree's path still comes from the server's own listing.

**B. Look up the creating process when the registry watch fires (fallback).** On the event that reveals a new worktree, the server reads the process table once, finds a running `git … worktree add` for that repository, and walks its parents to a terminal's shell with the existing `ProcessAncestry`. It needs nothing in the terminal. It is a race against Git finishing: it found the process 10 times out of 10 on a 3,644-file repository, 19 out of 20 on a tiny one on Linux, and 0 out of 20 on a tiny one on macOS, where the watch event and the `ps` together take about 65 ms. It costs one `ps` spawn per new worktree, triggered by an event.

When neither establishes a terminal, nothing moves and the folder appears empty.

With the setting on, capture is `panel.moveToFolder` issued as a host command, plus a `folder.terminalCaptured` journal event carrying the panel and the folder it came from, which clients turn into the Undo notice. The folder records `createdByPanelId`, so Undo, a declined offer, and the row tag all refer to the same fact. Undo is a client-issued `panel.moveToFolder` back, with a flag that stops a repeat. With the setting off, the server writes `captureOffer: { panelId }` on the folder; `folder.offer.accept` and `folder.offer.decline` resolve it.

Considered and rejected:

- **The agent's reported directory.** Agent-specific; ruled out by ADR-0051.
- **A working-directory check of every terminal when a worktree appears.** It answers "who is sitting in the worktree", not "who created it", spawns per terminal, and does not fire for a plain `cd` inside an agent.
- **An operating-system stream of file access per terminal.** Neither macOS nor Linux offers one without root or an entitlement; the unprivileged watches say what changed, never which process.
- **A shell hook or a Git hook.** A shell hook attributes the command to the shell that typed it and needs injecting into every supported shell. A Git hook lives in the user's repository.
- **Reading the terminal's output for Git's "Preparing worktree" line.** Agents run Git with its output captured, so the line usually never reaches the terminal.

**Boundary:** A adds variables to the environment of Terminay's own terminals that change what another tool, Git, does there. ADR-0051 leaves exactly that case to be decided where it comes up; the owner approved it and ADR-0052 records it. It also adds a new local input channel to the server, which is read as untrusted. B reads the process table of the server's own machine. ADR-0021 applies to B's spawn, and ADR-0028 is satisfied by both, since each acts on an event.

### 7. Closing the last panel is no longer special

The client-side rule that closes a project when `api.panels.length === 1` is removed. An empty folder renders a placeholder in place of its Dockview: the folder's name, a line saying no terminals are open, the worktree for a linked folder, and New terminal. The server already allows a project with no panels, so no server change is needed for the empty state itself.

### 8. Deleting a folder that holds panels is one confirmed flow

`folder.delete` is refused for a non-empty folder. The client asks Move to General, Close them, or Cancel, then issues the moves or the closes (each close through the normal path, so close protection and dirty confirmation still apply), and only when the folder is empty issues `folder.delete` or starts the existing worktree removal with its own confirmation. If a close is declined, the flow stops with nothing deleted.

Putting the choice inside a single server command was rejected because closing a terminal with a running process, and closing a dirty file, are both confirmations the user answers one at a time on the client.

### 9. The Folders tree is a third track of the project layout

`WorkspaceSplitLayout` gains a leading `folders` slot beside `navigation` and `content`, and `navigation` moves to the trailing side. Folders tree visibility and width join `SidebarSettings` as device-local values keyed `${serverId}:${projectId}`, classified `connection-host` like sidebar visibility. Below the narrow breakpoint the folders slot is not rendered; the compact switcher's model (`buildCompactSwitcherGroups`) gains a folder level under each project.

The tree reads the workspace snapshot and the worktree listing with insights that the Worktrees panel reads today. `WorktreesPanel` is removed; its menu handlers move to the folder menu. `GitPanel` becomes the Changes pane, scoped by `folderId`.

### 10. Tab peek is a portal that never sits in the drag path

`ProjectTabList` tabs are framer-motion `Reorder.Item`s with pointer-driven drag, a native tear-off session past a vertical offset, and HTML5 drop handling for terminal tabs. The peek is rendered in a portal anchored under the tab, opened by a dwell timer on `pointerenter`, and closed on `pointerleave` of both tab and peek, on Escape, on any `pointerdown` on a tab, and whenever `project-tabbar-reordering` is set or a terminal drag is in progress. It attaches no handler to the `Reorder.Item` that could swallow `pointerdown`, and it is not a child of the tab, so the existing `relatedTarget` check on `onDragLeave` is unaffected.

It reads folders from the workspace snapshot of the tab's own server, so tabs from several attached servers each peek at their own state. It is not shown where `(hover: hover)` does not match.

### 11. Schema version 6 and the first stepwise migration

`migrateWorkspaceState` gains a 5 to 6 step: for each project, create a General folder holding the project's `panelIds`, `activePanelId`, and `layout`, set `folderId` on each panel, and add `folderIds` to the project. The three derived project fields stay until task 2.9 (decision 1). The step is a pure function of the version 5 state, so an interrupted start reruns it from the unchanged file. Linked folders are not created by the migration; the reconciler creates them on first bind.

Device-local keys that are per project today (`rememberActiveSession`) stay per project and gain a per-project selected folder.

## Risks / Trade-offs

- **[Without the Git event stream, small repositories are missed]** → The process lookup loses the race when `git worktree add` finishes in under about 65 ms on macOS. The folder still appears and the terminal can be dragged in. This is the reason the event stream is the primary mechanism.
- **[The Git event stream is blocked or absent]** → A sandbox that denies Unix socket connections, or a user's own `GIT_TRACE2_EVENT`, silences it for that terminal. The process lookup still runs. Whether each agent's sandbox allows the socket is not tested yet; task 1.4 covers it.
- **[The Git event stream adds work to every Git command]** → About half a millisecond and 4.5 KB per command, measured. The server parses and drops each line as it arrives and keeps nothing, and a test asserts that its memory stays flat across many thousands of events.
- **[Events are forged]** → Any process on the machine that can reach the socket can write to it. An event can only cause a terminal of the named session's own project to be offered or moved into a folder that the server created from its own listing; it cannot name a path, a project, or a folder. An unknown session token is ignored.
- **[Wrong terminal captured]** → Attribution is by the process that ran the command, moves nothing destructive, and has a one-action Undo that also stops a repeat.
- **[A worktree renamed outside Terminay looks like delete plus add]** → Its terminals move to General and stay running; nothing is closed. Following an external rename would need a stable worktree identity that Git does not provide.
- **[A project scope now reaches sibling worktrees]** → The root is always chosen by the server from its own listing and confirmed per operation; a client can name only a folder id of its own project. Containment and symlink-escape checks are unchanged. MCP file reach (ADR-0045) is not widened by this change.
- **[One Dockview per folder uses more memory]** → Folders mount lazily. A project with many worktrees mounts only the folders the user has selected.
- **[Many worktrees make a long tree]** → `maxWorktrees` is 256. Folders are collapsible, and empty linked folders are one row plus a placeholder line.
- **[The right-hand sidebar is a habit change]** → It is the decided layout. No setting chooses the side, on purpose.
- **[Removing "close project on last panel" changes muscle memory]** → Decided by the owner; the placeholder offers the obvious next action.
- **[Schema migration is one-way]** → See the migration plan.

## Migration Plan

1. Ship the model and migration first, with the renderer still showing one folder (General). Stored workspaces upgrade on first start; the pre-upgrade file is copied aside once, as `<state file>.schema-5.backup`, before the first version 6 write, and the upgrade is not written if that copy fails.
2. Ship the reconciler, folder commands, and folder-scoped roots behind the renderer continuing to select General.
3. Ship the Folders tree, the right-hand sidebar, the Changes pane, the folder menu, and the placeholder together, since each is confusing without the others.
4. Ship capture and the setting.
5. Ship tab peek.

Rollback: steps 2 to 5 are renderer and service changes and roll back by release. Step 1 is not reversible by an older build, which refuses an unknown schema version; rolling back past it means restoring the backup file, losing folder assignments but no panels or sessions.

## Open Questions

- **Is the Unix socket reachable from inside each agent's sandbox?** Not tested. It decides how often the fallback is what actually runs.
- **Should `ProjectAgentScope` and `GitService` share one worktree-registry watch?** Out of scope here; worth its own change.
- **ADR-0002 and the wired JSON backend disagree.** Not caused by this change and not resolved by it; flagged so the migration work does not assume SQLite.
