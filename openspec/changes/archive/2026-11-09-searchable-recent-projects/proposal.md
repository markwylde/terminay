## Why

The start chooser lists every recent project folder in one long column. With a few dozen folders the list pushes past the bottom of the window, so a person scrolls through paths to find the one they want. And once a server has recorded 50 folders it silently drops the oldest, so a project used a few months ago can no longer be reopened from the chooser at all.

The bound is technical: the server keeps at most 50 recent folders, the protocol refuses a longer list, and the renderer slices to 50 again.

## What Changes

- A server keeps every folder that became an explicit project root, most recent first, until it is forgotten. Nothing is dropped for age or count.
- The chooser shows the five most recent folders, with a **Show more** control under them that reveals the rest.
- When more than five folders are recorded, a search box sits above the list. Typing filters every recent folder, not just the five shown, by name and path. Enter opens the first available match, Escape clears the search.
- **BREAKING (wire):** the protocol no longer refuses a recent-folders list or workspace change record with more than 50 recent folders. A client built before this change refuses such a list from a newer server.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `project-start-chooser`: "Recent project folders" is replaced by "Recent project folders are kept until forgotten", which drops the 50 bound; a new requirement collapses the chooser's list to five and adds search.

## Impact

- `packages/protocol/src/projectStart.ts`, `packages/protocol/src/workspace.ts`: drop the 50-entry bound from parsing.
- `packages/server-core/src/workspace.ts`: stop trimming and stop refusing a longer list in validation.
- `src/workspace/projectStart.ts`: `recentFolderRows` returns every row; a new pure `visibleRecentFolders` filters and collapses them.
- `src/workspace/ProjectStartChooser.tsx`, `src/workspace/projectStart.css`: search box, Show more.
- MCP `list_recent_folders` returns every folder, as it already returns the whole list.
