## Why

A long workflow fills the terminal's workflow panel with step notes, and the
user has to scroll past old notes to find the step that is running. Home's
Workflows section already lets the user show notes **Full**, cut to **2
lines**, or for **Current only** (issue #539). The terminal's own panel has
no such choice, so the same workflow is easy to scan on Home and hard to scan
beside the terminal driving it.

## What Changes

- The expanded workflow panel (and the narrow-pane overlay) gains a small
  **Notes** dropdown in its header, next to the collapse control, offering
  **Full**, **2 lines**, and **Current only** — the same choices and the same
  meaning as Home's Workflows density.
- **Full** is the default and is how the panel shows notes today.
- The choice is a device-local setting shared by every terminal on the
  device, kept like the panel's collapse and width settings. It is separate
  from Home's Workflows view, and is never stored on the server or in a
  template.
- The collapsed rail is unchanged; it shows no notes.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `terminal-workflows`: the expanded panel offers a step-note density choice,
  stored as a device-local setting.

## Impact

- Renderer only: `src/workspace/workflows/WorkflowPanel.tsx`,
  `WorkflowPanel.css`, `workflowPanelSetting.ts`, `workflowPanelModel.ts`.
- No server, protocol, MCP, or template change. No new IPC.
- Unit tests for the setting and note visibility; an E2E scenario with
  screenshots of the three choices.
