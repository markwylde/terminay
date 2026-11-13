## Why

A new project's start chooser only shows its recent-folder search box when the server holds more than five recent folders. With fewer, the search box is missing, so typing to find a folder works on some servers and not others, and focus lands on **Open a folder** instead.

## What Changes

- Show the search box whenever the server holds any recent folder, not only more than five.
- The search box therefore takes keyboard focus on show (outside the compact layout) for every server with recent folders.
- With no recent folders, the chooser still says "No recent projects yet." with no search box.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `project-start-chooser`: "The chooser searches every recent folder" applies to any number of recent folders; "The chooser collapses recent folders to five" no longer says few folders have no search box.

## Impact

- `src/workspace/projectStart.ts`: `recentFoldersSearchable` is true for any non-empty list.
- `src/workspace/projectStart.test.ts`, `e2e/project-start-chooser.spec.ts`: cover the search box with few folders.
- No server, protocol, or MCP change.
