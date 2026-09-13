## Context

`git status --porcelain=v1 -z --untracked-files=all` returns a status letter
pair and a path. Nothing in that output says whether the path is a directory:
with `-uall` Git descends into untracked directories, and a symlink is a leaf it
reports by name. `.gitignore`'s `node_modules/` matches directories only, so a
worktree whose `node_modules` is a symlink at the main checkout is reported as
untracked `node_modules`, and `toChangeEntry` produces a `GitChangeEntry` with
no notion of type. `GitPanel` then renders every non-synthetic row as a file:
file icon, diff on click, and a context menu without the folder actions.

Explorer mutations are authorized against the project root. `FileCatalog` holds
one `CanonicalProjectPathResolver` per project, and the resolver realpaths the
requested path and requires canonical containment. A path in another worktree is
therefore unreachable until the project root is that worktree, which is why
`queueOwningWorktreeAction` switches the root first and replays the action once
the root is authoritative. It never switches back, so a delete in a worktree
leaves the project pointing at that worktree.

Even inside the right root, the delete fails. `FileCatalog.delete` called
`assertNotSymlink` and refused any symlink, and the resolver would in any case
realpath `worktree/node_modules` to the main checkout's `node_modules`, outside
the worktree root, producing `path_escape` → `forbidden` → the Explorer's
"access was denied" copy.

## Goals / Non-Goals

**Goals:**

- A directory in a Git change list presents and behaves as a directory.
- A cross-worktree mutation leaves the user on the project they started from.
- Deleting a link inside the project succeeds and leaves its target alone.

**Non-Goals:**

- Renaming or writing through a symlink. Only deletion is defined here; renaming
  a link stays refused.
- Changing what Git reports. The ignore semantics are Git's, and a linked
  `node_modules` is legitimately untracked.
- Reaching another worktree without switching the project root. Per-worktree
  file authorities are a larger change than this defect warrants.

## Decisions

**Resolve directory state on the server, from the filesystem.** `parseStatus`
takes the trailing separator Git prints for an untracked directory it did not
descend into; `GitService` then stats the remaining untracked entries against
the worktree root. `stat` follows symlinks, so a linked directory reads as the
folder on disk. The walk is restricted to untracked entries — a tracked Git path
is always a blob — and is bounded by `maxStatusEntries`, so a status refresh
costs at most one stat per untracked entry and usually none.

Alternative considered: infer type in the renderer from the path. Rejected — the
renderer has no filesystem authority (ADR 0011), and a name says nothing about
what it is.

**Hand the borrowed root back when the mutation settles, not before.** The
pending action records the root the user was on. The mutation still runs with
the worktree root authoritative; only when its promise settles — success or
failure — is the original root restored. Restoring earlier would rebind the
server's catalog under an in-flight request. `open-entry` deliberately does not
restore: opening a file from another worktree is navigation into it, and the
opened panel needs that root to stay.

Alternative considered: never switch the root and mutate through some
worktree-scoped authority. Rejected here — there is no such authority today, and
inventing one for a delete is out of proportion to the defect.

**Delete a link as a link, through its canonical parent.** Removing a symlink
unlinks the link; it cannot touch what the link points at. The only real risk is
lexical: an intermediate segment that is itself a link out of the project. So
the leaf's parent is resolved with the ordinary canonical containment check, the
leaf name is appended to that canonical parent, `lstat` confirms it is a link,
and the removal is non-recursive. A path whose parent chain leaves the project
still fails the containment check exactly as before. Renaming still refuses
symlinks, because a rename has a destination and no user need justified widening
it here.

**Report a symlink's resolved kind rather than collapsing it to a file.** The
listing already stats the canonicalized target, so `targetKind` costs nothing
new and keeps `kind: 'symlink'` intact for callers that care that it is a link.
An escaped symlink keeps its inaccessible metadata with no `targetKind`, so it
is still not presented as something to open.

## Risks / Trade-offs

- One stat per untracked entry on every status refresh → bounded by the existing
  status entry cap, skipped for tracked entries, and skipped entirely when a
  worktree has no untracked entries.
- Deleting a link that points outside the project is now possible from inside it
  → it removes only the link, which is the entry the user sees and asked to
  delete; the target is untouched.
- The project root visibly changes and changes back during a cross-worktree
  mutation → it is the existing mechanism, now ending where the user started.

## Migration Plan

None. Behaviour-only change, no persisted state or protocol migration;
`targetKind` and `isDirectory` are additive fields. Rollback is reverting the
commit.

## Open Questions

None. No in-force ADR needs revisiting.
