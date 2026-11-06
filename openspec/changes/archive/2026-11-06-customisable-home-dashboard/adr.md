# ADR Review Manifest

## ADR Review Completed

- Date: 2026-11-06
- Reviewer: Claude (Opus 5.5)
- Change: customisable-home-dashboard

## In-Force ADR Context Reviewed

- openspec/adr/0028-no-polling-without-owner-approval.md - the recordings widget reads when Home is shown, never on a timer; the existing 30-second clock only phrases times.
- openspec/adr/0029-worktree-properties-are-host-owned-typed-facts.md - the pull-request widget renders the worktree facts the inventory already carries.
- openspec/adr/0072-mcp-reach-is-the-authority-line-and-workspace-reach-controls-the-app.md - `homeDashboard` is deliberately left off the MCP allow-list.
- openspec/adr/0097-workflows-are-checklists-an-agent-drives-and-terminay-never-runs-a-step.md - the workflows widget presents server-pushed workflow state only.
- openspec/adr/0099-a-bot-is-woken-by-its-own-failures-never-by-a-failures-failure.md - bot widgets only present sessions; they start nothing.

## Repository-Level ADRs Created

- openspec/adr/0100-the-home-overview-layout-is-a-server-setting.md - the overview layout is shared across devices as a server setting; Home tab arrangement stays per-device.

## Notes

Activation from every new widget navigates only; dismissing a notification reuses the existing acknowledgement path.
