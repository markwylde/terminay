## Why

A terminal's tab shows its workflow's progress as small faint text such as `3/8`, which is hard to read on a coloured tab and doesn't show whether the workflow is moving, stuck, or finished. The Tabs sidebar shows no workflow progress at all, so you can't see from the sidebar which agent is how far along.

## What Changes

- Replace the `done/total` text on a terminal's tab with a small progress dial: a ring filled to the share of steps that are done, coloured by the workflow's state (amber while a step runs, red while a step has failed or needs you, green when every step is done, grey otherwise).
- Place the dial at the right end of the tab, just before the close button, in a fixed slot. The close button always reserves its space, so the dial doesn't move when the close button shows on hover or focus.
- Keep the dial at its size on narrow tabs; the title truncates first.
- Show the same dial at the right end of the terminal's row in the Tabs sidebar, and in its row in the compact switcher, which is the only terminal list at phone width.
- A finished workflow's dial shows full green until you have looked at the terminal: it hides once the terminal has been active and then stops being active. If the workflow reopens and finishes again, the dial shows again. Which completions you have seen is stored on the device only and shared across that client's windows.
- Give the dial a tooltip and accessible name that say the state in words: the current step, how many steps are done, how long since that step started, and any failed step, e.g. "Implement · 3 of 8 · 14m".

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `terminal-workflows`: the requirement "Workflow progress on the terminal tab" changes from a done-over-total count with a red marker to a coloured progress dial in a fixed slot. It also gains the Tabs-sidebar row, hiding a finished workflow once seen, and an accessible name.

## Impact

- `src/workspace/workflows/WorkflowTabBadge.tsx`, `workflowPanelModel.ts`, `WorkflowPanel.css`: the dial component, the summary model (tone, fraction, label), and the device-local "seen" record.
- `src/components/TerminalTab.tsx`, `src/components/DockTabChrome.tsx`: the dial's placement before the close button.
- `src/components/folders/FoldersTree.tsx`, `FoldersColumn.tsx`, `src/App.tsx`: pass the project's server id so a sidebar row can read its terminal's workflow.
- `src/workspace/CompactSwitcher.tsx`, `src/components/TerminalPanel.tsx`: the dial in switcher rows, and marking a completion as seen where no tab strip is mounted.
- No server, protocol, or MCP change: the dial reads the workflow state clients already receive.
