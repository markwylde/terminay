## Why

The header activity dropdown shows the number of terminals that need attention, have finished unviewed work, or are working, but the count badge renders as a rounded rectangle rather than a circle, so it looks unfinished next to the rest of the chrome. More importantly, the count is global: with several projects open, a user cannot tell which project the finished or waiting terminals belong to without opening the dropdown. A per-project count on each project tab lets them see at a glance where the activity is.

## What Changes

- The header activity dropdown count badges become true circles of a fixed size, with the number centred both vertically and horizontally. The font shrinks as the digit count grows so the circle never changes size, and counts above 99 display as `99+`.
- Each project tab gains a single activity count badge, placed after the title and before the close control, showing how many of that project's terminals currently have an activity indicator. The badge is coloured by the highest-priority state present in that project: red for attention (bell, notification, agent waiting or blocked), amber for working, green for finished unviewed.
- The badge is hidden when the project count is zero, is shown on the active project tab as well as background tabs, and is derived from the same activity items the header dropdown already uses, so the existing **Show indicator for active tabs** and **Show indicator for finished tabs** settings govern it with no new setting.
- Project switcher menu rows show the same per-project badge so overflowed projects on narrow bars remain covered.
- Tab overflow layout re-evaluates when badge counts change, so a badge appearing or disappearing never leaves the strip mis-measured.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `workspace-and-project-tabs`: project tabs and switcher rows present a per-project activity count badge; the tab bar overflow layout accounts for the badge.
- `agent-status-and-sidebar`: the header activity dropdown's count badges are fixed-size circles with centred, digit-aware text and a `99+` cap.

## Impact

- `src/workspace/TerminalActivityOverview.tsx` and the `.terminal-activity-pill` rules in `src/App.css` for the circular header badge.
- `src/App.tsx` derives per-project counts from the existing `terminalActivityItemsByProject` state and passes them to the tab list.
- `src/workspace/ProjectTabList.tsx` and `src/workspace/ProjectSwitcherMenu.tsx` render the badge and re-run overflow layout on count changes.
- Existing end-to-end locators for `.terminal-activity-pill--*` remain unique because the tab badge uses its own class.
- No server, protocol, or persisted workspace state changes. The `ProjectTab` model is unchanged; counts are ephemeral client presentation.
