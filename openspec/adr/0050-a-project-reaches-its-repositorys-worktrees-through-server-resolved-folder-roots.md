# ADR-0050: A project reaches its repository's worktrees through folder roots the server resolves

Status: accepted
Date: 2026-10-08

## Context

ADR-0011 fixes the boundary between the server's filesystem and Git services
and a project: operations are contained in the project's canonical root.
ADR-0020 says that root is canonicalized once per operation and never cached
across operations.

A project had exactly one root. Other worktrees of the same repository were
reachable for Git commands by opaque worktree id, but not for file operations.
To read or change a file in another worktree, the client first issued
`project.root.update` to make that worktree the project's root. The root is
shared server state, so that one act repointed the file explorer, Git status,
agent scoping, and the default directory of new terminals for every device
looking at the project.

The `linked-folders` change gives every worktree a folder (ADR-0049) and lets
the files and changes shown beside the panels follow the selected folder. Two
devices can select different folders of one project, and one device can keep
terminals running in several. A single shared root cannot serve that. The
options were:

- **Keep one root and switch it on every folder selection.** This is the
  existing mechanism. It makes a per-device choice a shared mutation, and it
  races when two devices select different folders.
- **Let the client send the root it wants.** A path chosen by the client would
  define what the project may read and write, which ADR-0011 exists to prevent.
- **Let the server derive an operation's root from a folder it owns.**

## Decision

1. **An operation in a project is contained in one root, chosen by the server:
   the project root, or the root of one of that project's folders.** A folder's
   root is the project root for a General or plain folder, and the worktree path
   for a linked folder.
2. **Only the server writes a folder's link.** A linked folder records a
   worktree that the server itself listed for the repository containing the
   project root. No command lets a client set or change the path a folder points
   at, and a request names a folder by id only.
3. **A folder root is resolved and confirmed per operation.** At the start of an
   operation that names a folder, the server confirms the folder belongs to the
   request's project, confirms from a fresh bounded worktree listing that its
   link is still a registered worktree of that repository, canonicalizes that
   path once, and threads the canonical value through the operation. Nothing is
   cached across operations. ADR-0020 applies to folder roots exactly as it
   applies to the project root.
4. **Containment is still checked per path.** Choosing a folder root changes
   which root a path is checked against. It never replaces the check, and
   symlink escape still fails closed.
5. **A folder that fails resolution fails closed.** A link to a worktree that is
   no longer registered, or whose path is missing, makes the operation fail with
   a typed error. It does not fall back to the project root for a file or Git
   operation.
6. **The project root is no longer changed as a side effect.**
   `project.root.update` remains a deliberate user action. No file, Git, or
   selection operation issues it.
7. **This widening is for the workspace's own filesystem and Git services.** It
   does not by itself widen any other scope. In particular, MCP reach stays
   governed by ADR-0031 and ADR-0045.

## Consequences

- A project scope now reaches every worktree of the repository that contains
  its root, without the user switching anything. That is a real widening and is
  the intended one: those worktrees were already listed, pulled, pushed, and
  removed under the same project scope.
- A repository outside the project's own, or a directory that is not a
  registered worktree of it, stays unreachable. A worktree of a different
  repository nested inside the project root is reached, as before, only as part
  of the project root.
- Two devices can show different worktrees of one project at once, and a
  selection on one device changes nothing on another.
- Every folder-scoped operation pays one bounded worktree listing to confirm the
  link. The listing is already maintained from the registry watch, so this is a
  read of server state and not a new Git spawn per operation; an implementation
  that makes it one must be treated as a regression under ADR-0021.
- Reviewers must confirm that any new caller obtains a folder root from the
  resolver within the same operation, as ADR-0020 requires for `canonicalRoot`.
- A worktree removed between two operations is detected by the next one, at the
  same granularity as a replaced project root.

## Open items

- Language intelligence and documentation indexing are bound to the project
  root. Whether they follow the selected folder is left to the changes that own
  them; until then they stay on the project root.
