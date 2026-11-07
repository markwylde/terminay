# ADR Review Manifest

## ADR Review Completed

- Date: 2026-11-07
- Reviewer: Claude (with Mark Wylde)
- Change: compact-rail-drawer-switcher

## In-Force ADR Context Reviewed

- openspec/adr/0028-no-polling-without-owner-approval.md - launcher list, workflow progress, and Home summaries use only pushed or already-held data; nothing polls.
- openspec/adr/0040-home-tabs-are-device-local-presentation-in-their-own-dockview.md - the drawer's Home panel opens sections through the existing device-local Home tab path.
- openspec/adr/0047-a-window-is-one-server-running-the-host-bundle.md - rows and default-shell creates on another connection still go through switching the window's server; rename, move, close, reorder, folder removal and launchers are offered only for the window's current server, so no mutation crosses a server boundary.
- openspec/adr/0049-a-folder-groups-panels-and-is-not-an-identity-boundary.md - folder tree, folder reorder, and Move to folder reuse the existing folder model and server-committed moves.
- openspec/adr/0050-a-project-reaches-its-repositorys-worktrees-through-server-resolved-folder-roots.md - Delete worktree and launcher creates in a linked folder use the server-resolved folder root unchanged.
- openspec/adr/0097-workflows-are-checklists-an-agent-drives-and-terminay-never-runs-a-step.md - the dial and step text are read-only presentation of the terminal's workflow.
- openspec/adr/0101-the-home-overview-layout-is-a-server-setting.md - untouched; the drawer links to Home sections and does not edit the overview.

## Repository-Level ADRs Created

- None: no major durable architectural decisions were introduced by this change. It reshapes client presentation at phone width over existing server commands, and its one new state, the last-used launcher, is an ordinary device-local preference.

## Notes

- The drawer layout, rail, and edit mode are presentation choices recorded in the change's design and specs rather than in an ADR.
