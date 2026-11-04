## Context

Each folder workspace in a project keeps its own worktree listing
(`useFileExplorerController` → `worktreePanelStatus`), and `folderChanges`
picks the one worktree the folder stands for. Its `properties` carry the pull
request and checks the forge extension published; the Folders sidebar renders
them with `worktreePropertyPresentation.ts`.

The dashboard reads only the published workspace inventory, one entry per
panel, merged per project across folders. It has no access to worktree
listings.

## Goals / Non-Goals

**Goals:**

- A card shows the same pull request and checks the Folders row shows for the
  panel's folder, worded the same way.
- No new fetch, poll, or server round trip.

**Non-Goals:**

- Opening the pull request or the check list from the dashboard.
- Facts for a folder whose workspace has not listed its worktree, such as a
  connection whose panels this window does not hold.

## Decisions

- **Carry the facts on the inventory entry.** The folder workspace that
  publishes a panel's entry already knows the folder's worktree, so it stamps
  `worktree` (pull request without its URL, check counts without items) on
  every entry it publishes. The alternative — the dashboard joining panels to
  a per-project worktree map — would need a second published structure and a
  folder→worktree resolution outside the folder workspace that owns it.
- **Republish on a value change.** The facts are keyed by value, so a periodic
  listing that reports the same pull request does not churn the inventory.
- **Reuse the Folders presentation helpers.** `pullRequestChip`, `checksChip`,
  and `checksTone` word the chips, so a card and a Folders row cannot disagree.
- **Read-only chips.** The dashboard contract gives a card exactly one action.

## Risks / Trade-offs

- A folder workspace that has not yet loaded its listing shows no chips until
  it does → acceptable; the Folders row is in the same state.
