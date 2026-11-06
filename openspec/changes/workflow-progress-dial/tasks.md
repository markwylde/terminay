## 1. Model

- [x] 1.1 Extend `tabSummary(view, now)` in `workflowPanelModel.ts` with `tone`, `fraction`, `completionKey` and the worded label. Verify: `npm run test:workflow-ui` cases pass for every tone (running, alert from needs_input, alert from failed beside running, finished, idle between steps, unrestorable as fraction 1 and red), every label form in design.md, time since `startedAt` across running → needs_input → running, and no workflow → undefined.
- [x] 1.2 Add `workflowSeen.ts` (completion keys, newest first, capped at 500, localStorage with try/catch and memory fallback, merge on write, `storage`-event re-read, subscribe) and the `useMarkWorkflowSeen(completionKey, isActive)` hook over a `WorkflowSeenTracker`. Verify: `npm run test:workflow-ui` cases pass for committing on deactivate, committing on unmount, dropping the pending key when the completion key changes, a reopened workflow showing again with a new key, eviction past 500, a storage event from another window, and a throwing localStorage.

## 2. Dial component

- [x] 2.1 Replace the `done/total` text in `WorkflowTabBadge.tsx` with an SVG `WorkflowDial` (track and arc, tone class, `role="img"`, `aria-label` and `title` from the label). Hide it when the completion key has been seen. Use a 30-second ticker only while a step is active, cleared on unmount. Verify: `npm run test:workflow-ui` renders the dial with the right aria-label and no `3/8` text, renders nothing once seen, and reports `ticking` only while a step is active.
- [x] 2.2 Style the dial in `WorkflowPanel.css` (12px, `flex-shrink: 0`, tone colours matching the rail) and remove the old text and alert-dot styles. Verify: checked in the e2e screenshots.

## 3. Placement

- [x] 3.1 In `TerminalTab.tsx`, render the workflow badge last in `afterTitle` (just before the close button) and drive `useMarkWorkflowSeen` from the panel's `isFocused` in `TerminalPanel`, which every layout mounts. Verify: e2e asserts the dial is the close button's previous sibling, its box doesn't move on hover, and it keeps its width on a narrow tab next to the other badges.
- [x] 3.2 Add an optional `serverId` to `FoldersTree` and `FoldersColumn`, pass it from `ProjectWorkspace` in `App.tsx`, and render the badge at the end of terminal rows in `PanelRow`, after the worktree tag, with the title truncating first. Verify: e2e asserts the sidebar row's dial has the same aria-label as the tab's.
- [x] 3.3 Render the badge in `CompactSwitcherPanel` after the title text, using the row's `serverId` and `sessionId`. Verify: e2e at phone width asserts the switcher row shows the dial.

## 4. End to end

- [x] 4.1 Extend the workflow e2e suite to cover: running (amber, 3/8, label), needs_input (red), failed beside running (red, label names both), finishing in the background (green), activating then leaving the terminal (hidden in the tab and the row), finishing while active (shown until leaving), and a reopened workflow (amber, then green again). Capture screenshots of the tab, sidebar and compact-switcher states. Verify: `npm run test:e2e` for the workflow suite passes in Docker.
- [x] 4.2 Run the typecheck, unit tests, Biome, and `openspec validate workflow-progress-dial`. Verify: all pass. `openspec validate --all` must report no failure in this change; its existing failures in other in-flight changes, such as `add-terminay-bots`, are outside this change.
