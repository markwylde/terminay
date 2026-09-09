## Context

Confirmed worktree deletion is server-owned (`GitService.removeWorktree`). The client sends opaque project, repository, and worktree IDs plus the reviewed HEAD. The server re-lists, revalidates, then runs `git worktree remove --force`.

Git's porcelain listing reports `locked` when a `locked` file exists under `.git/worktrees/<id>/`. That flag is a Git accidental-prune guard, often left behind by other tools. Terminay currently treats it as a protected kind: `assertRemovableWorktree` throws `worktree-locked` before Git runs. Git itself also refuses a locked worktree unless `--force` is passed twice.

This is still the server Git authority (ADR-0008, ADR-0011). The renderer does not gain path or Git-command authority. Pull and move keep rejecting locked worktrees.

In-force ADRs reviewed: 0001–0006, 0008–0014. ADR-0007 is superseded by 0008 and is history only.

## Goals / Non-Goals

**Goals:**

- Confirmed linked-worktree delete succeeds when Git reports the worktree locked, including dirty and untracked contents.
- Main and bare worktrees remain non-removable.
- Identity, HEAD, and serialization checks stay as they are.
- Desktop force-remove uses the same Git force semantics if it still shells out to `git worktree remove`.

**Non-Goals:**

- Unlocking worktrees as a user action, or clearing locks without deletion.
- Allowing pull or move of a locked worktree.
- Changing confirmation copy, protocol, or opaque identity rules.
- Teaching the renderer to interpret Git lock files.

## Decisions

### Treat Git lock as a force-removal detail, not a Terminay protection

A Git lock is not a project or session security boundary. Confirmed delete already authorizes destroying the folder. Keep rejecting main and bare because those identities are the repository itself.

Alternative considered: require an explicit unlock step in the UI. Rejected; the user already confirmed delete, and leftover locks are the common case.

### Use Git's double `--force` rather than unlock-then-remove

`git worktree remove --force --force -- <path>` is the documented way to delete a locked worktree. One command keeps the existing mutation queue and post-remove identity check. Unlock then remove is two commands and can leave the worktree unlocked if remove fails.

Always pass `--force` twice on confirmed removal. The confirmation already covers dirty trees; a second `--force` is required for locked ones and is a no-op extra for unlocked dirty trees on supported Git (2.17+, inside the distribution matrix).

Alternative considered: unlock only when porcelain reports `locked`. Rejected because listing and Git can race; double `--force` covers both.

### Keep listing `locked`; keep pull/move rejection

The sidebar still receives `locked`. Pull and move stay blocked: those operations are not the confirmed-delete path.

## Risks / Trade-offs

- [A lock meant to stop accidental deletion is overridden] → The confirmation dialog is the user-facing guard; Terminay never auto-deletes locked worktrees.
- [Older Git without double-force semantics] → Supported hosts ship Git 2.17 or newer; a failed command still returns `command-error` and the identity remains listed.
- [Locked and prunable at once] → Skip status in the missing path as today, then double-force remove or prune as Git requires; verify the identity is gone.

## Migration Plan

Ship in the same server-core release. No persisted state or protocol migration. Rollback is reverting the removal flags and the locked pre-check.

## Open Questions

None.
