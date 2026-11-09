## Context

Recent project folders live in the server's workspace state (`recentProjectFolders`), are listed to a client through the `recent.list` query with one `stat` per entry, and travel in full in workspace change records whenever they change. The 50 bound appears in four places: `MAX_RECENT_PROJECT_FOLDERS` in server-core (trim and validation), the same constant in the protocol's `parseRecentListResult`, a literal `50` in the workspace change-record parser, and the renderer's `recentFolderRows(result, limit = 50)`.

## Goals / Non-Goals

**Goals:**
- No folder leaves the list except by Forget.
- The chooser stays short by default and any recorded folder is one search away.

**Non-Goals:**
- Server-side search or paging. The list is a few hundred short paths at most in practice; the client filters what it already has.
- Changing what gets recorded or how availability is checked.

## Decisions

### Remove the bound rather than raise it

A larger fixed bound only moves the cliff. Each entry is a path of at most 4096 characters and an integer, so even a list of thousands stays well within what the workspace file and a change record already carry. Per-entry validation (path length, no NUL, unique paths, safe-integer time) stays.

### Filter and collapse in a pure renderer model

`visibleRecentFolders(rows, query, expanded)` returns the rows to draw and how many are hidden. A query is split on whitespace and every term must appear, case-insensitively, in the folder's name or path. Matches keep recency order. Collapsed, at most five rows are drawn, whether or not a query is set; **Show more** reveals the rest. The search box appears only when more than five folders are recorded, since with five or fewer every folder is already visible.

### Keyboard

The search box joins the chooser's arrow-key order between the starts and the first recent row. While it has focus, Left, Right, Home and End edit text instead of moving focus; Up and Down still move. Enter opens the first available match; Escape clears the query.

## Boundaries

The change stays inside the server's own workspace state and the renderer's presentation of it. The recent list remains per server and is still refused to project-scoped MCP claims (`refuseProjectClaim`). No path from the list is used to read anything beyond the existing availability `stat`.

## Risks / Trade-offs

- A client built before this change refuses a recent-folders list, and a workspace change record, carrying more than 50 recent folders. Mixed versions only meet when a remote server is upgraded ahead of a client; such a client sees the error until it updates. Accepted: the in-app upgrade path brings clients forward, and the bound was the bug.
- An unbounded list costs one `stat` per entry when the chooser opens. These run in parallel and are cheap for local paths.
