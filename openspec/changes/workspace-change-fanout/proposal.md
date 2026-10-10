## Why

Typing in Terminay lags, and a character sometimes appears a second after its key, whenever an agent is working in any terminal. An agent CLI animates its tab title about once a second, and each title change is a durable workspace commit that every layer answers with work sized by the whole workspace: the server copies and rewrites all of its state, every client fetches all of it again, and the renderer rebuilds every project, re-lists the file explorer, re-measures Git, and re-renders every terminal. Diagnostics show forced Git measurements rising from 15 to 45 an hour to 500 to 1,250 an hour from the first build that carried program-set titles.

The title is only the first thing to change this often. The cost belongs to how a workspace change travels, so every rename, move, and note pays it too, and the next output-driven fact would pay it again.

## What Changes

- A program-set title stops being workspace state. The server holds it in memory beside the terminal it belongs to and publishes each terminal's displayed title as a live fact. A title change writes nothing to disk and does not advance the workspace revision. **BREAKING**: a program title no longer survives a server restart; the program sets it again when it next writes one.
- The server still resolves the displayed title (named title, else program title, else `Terminal N`), still sanitises and bounds program titles, still refuses to let a client set one, and the `programSetTabTitles` setting still turns them off. MCP `list_terminals` reports the same display names as before.
- A workspace change reaches clients as the change. The ordered change event carries the objects that changed and the ids that were removed, a client applies it without fetching, and it asks for a delta or a snapshot only when it has missed a revision. **BREAKING** (protocol): negotiated as a new capability; a peer without it keeps the full-state delta envelope.
- A client's projection keeps the identity of every project, folder, panel, view, and session a change did not touch, whether the change arrived as a change record, a delta, or a fresh snapshot.
- Presentation work follows the change. A change to one terminal does not re-render another terminal, reset or re-list a file explorer, re-measure Git, re-open a file watch, or re-run a project's feature queries.
- A workspace commit costs one copy of the state. Reading workspace state on the server copies nothing, the outcome a command id is remembered by is bounded in bytes as well as in count, and the commit is still durable before it is published.
- The measurements this rests on are recorded as ADR evidence, and a regression gate holds an animating title to no workspace write, no revision, no Git measurement, and no render outside its own tab.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `program-set-tab-titles`: a program title is live server state rather than persisted workspace state; the displayed title is published as a live terminal fact; coalescing bounds publication rather than commits.
- `server-owned-workspace-state`: the change event and the delta carry change records rather than the resulting state; a client applies them and keeps the identity of what did not change; program titles are excluded from the persistence contract; terminal output never commits workspace state; a commit's work and its retained outcomes are bounded.
- `file-explorer-and-folder-tabs`: the explorer tree, its watches, and Git decoration are undisturbed by a workspace change that does not concern their folder.
- `terminal-workspace`: a terminal's tab and panel are undisturbed by a change to another terminal, and a tab takes its title from the live title fact.

## Impact

- **Server** (`packages/server-core`): `workspace.ts` (store reads, commit pipeline, change records, outcome cache, removal of `programTitle` and its commands), `workspaceProtocol.ts` (change event, delta handler, per-connection scoping of change records), `programTitles.ts` and `activity/` (live title store and its projection), `composition.ts`, `workspaceRepository.ts`, the automation-space visibility projector, and the MCP terminal listing.
- **Desktop main** (`electron/`): `serverFolders.ts`, `serverTerminalAuthority.ts`, and the MCP gateway project tracker in `main.ts` stop copying state to read one field. The persisted `workspace.v4.json` drops `programTitle`; a file that still has one loads and loses it.
- **Protocol** (`packages/protocol`, `packages/protocol-conformance`, `packages/client-core`): two new feature capabilities, a second delta version, the change-event payload, and the terminal-title projection.
- **Renderer** (`src/`): `WorkspaceSnapshotStore`, `serverWorkspaceReconciliation.ts`, `useProjectCollection`, `useConnectionProjectTabs`, the project workspace component and its effects in `App.tsx`, `useFileExplorerController`, the terminal tab and panel title path, and the sidebar and dashboard inventories that list terminals by title.
- **Decisions**: supersedes ADR-0056; adds an ADR on how a workspace change reaches a client.
- **Change in flight**: `program-set-tab-titles` is implemented but not archived. It is archived first so these deltas modify requirements the main specs hold.
- **No change** to remote-access trust, MCP authority, the session holder, or the data-root lock.
