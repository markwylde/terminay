## Context

`ProjectStartChooser` renders the search box when `recentFoldersSearchable(recent)` is true, which was `rows.length > RECENT_FOLDERS_COLLAPSED` (5). The focus-on-show effect, keyboard order and matching already key off the same flag.

## Goals / Non-Goals

**Goals:** a consistent search box whenever recent folders exist.

**Non-Goals:** no change to matching, collapsing to five, Show more, or the compact-layout focus rule.

## Decisions

- **Threshold becomes "any recent folder".** `recentFoldersSearchable` returns `rows.length > 0`. Keeping one predicate means the focus and keyboard behaviour follow automatically. Alternative considered: always render the box, even with no recent folders. Rejected because searching an empty list only adds a dead control above "No recent projects yet."

## Risks / Trade-offs

- [Focus now lands in the search box for servers with one to five recent folders, where it used to stay on **Open a folder**] → Enter on an empty query still opens the first available folder, and ↑ reaches the starts, as with more than five.
