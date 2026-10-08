# ADR-0049: A folder groups a project's panels and is not an identity boundary

Status: accepted
Date: 2026-10-08

## Context

A project held one flat list of panels in one layout. Work inside a project
needed a level between the two: a group of terminals with its own layout, which
can stand for a Git worktree. The `linked-folders` change adds that level as a
folder.

ADR-0011 makes the project and the terminal session security boundaries, and
ADR-0043 makes a terminal's `{serverId, projectId, sessionId}` identity
immutable: a terminal changes project only by retiring that identity, which ends
its attachments, leases, queued input, and MCP capability. Adding a level
between project and panel forces the question of which side of that line it sits
on. Three shapes were considered:

- **Make the folder part of the identity.** A folder would then be an
  authorization scope, and moving a terminal between folders would retire its
  identity. Folder moves are frequent and one of them is automatic, when a
  terminal is captured into the folder of a worktree it created. Each would drop
  the agent's MCP capability and detach every client, in the middle of the work
  the folder exists to organise.
- **Keep folders on the device.** Folders would be renderer presentation, as
  Home tabs are (ADR-0040). Two devices would disagree about where a terminal
  is, and the server could not move a terminal into a folder or create a folder
  for a worktree it observed.
- **Make the folder a server-owned workspace object that carries no authority.**

## Decision

1. **A folder is a canonical workspace object owned by the server.** It has a
   stable server-issued id, belongs to one project, and holds an ordered list of
   panels and a logical layout. Every panel of a project belongs to exactly one
   folder, and every project has one General folder that cannot be removed.
2. **A folder is not an identity or authorization boundary.** A terminal's
   identity stays `{serverId, projectId, sessionId}`. No credential, capability,
   attachment, lease, or subscription is scoped to a folder, and none is issued,
   revoked, or re-keyed when a panel changes folder.
3. **A folder move is its own command and never re-homes a terminal.** Moving a
   panel between folders of one project is `panel.moveToFolder`. It does not use
   `panel.move`, and ADR-0043's re-home runs only for a committed cross-project
   `panel.move`, as before.
4. **The server may move a panel between folders on its own.** Because a folder
   move changes no authority, the server may issue it as a host command, for
   example to capture a terminal into the folder of a worktree it created. It
   may not move a panel between projects on its own; ADR-0043 is unchanged.
5. **Which folder is selected is device presentation.** It is stored on the
   device with the active panel, and is never workspace state.
6. **Each folder has its own panel host.** A folder's panels are rendered in
   their own Dockview, using the project panel lifecycle. Home's Dockview stays
   separate (ADR-0040).

## Consequences

- "Which folder is this terminal in" has one answer on every device and after a
  restart, and the server can change it.
- A terminal keeps its attachments, scrollback, recording, and MCP capability
  across any number of folder moves.
- Nothing may use a folder to decide what a request is allowed to do. A reviewer
  who sees a folder id in an authorization check should treat it as a defect.
  Scope that should follow a folder, such as which directory a file listing
  shows, is derived by the server from the folder and bounded separately
  (ADR-0050).
- A component that keys state by project and needs a finer key may add the
  folder, but must tolerate a panel's folder changing under it without an
  identity change.
- Workspace commands must keep the invariant that every panel has exactly one
  folder, and the stored schema gains a version with a stepwise migration.
