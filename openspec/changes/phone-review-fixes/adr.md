# ADR Review Manifest

## ADR Review Completed

- Date: 2026-11-15
- Reviewer: Claude (for Mark Wylde)
- Change: phone-review-fixes

## In-Force ADR Context Reviewed

Depth of review:

- Every ADR file in `openspec/adr/` was read for its Status and `Supersedes`
  fields. There are 130 files numbered 0001–0124; 0095, 0096, 0098, 0100, 0111
  and 0120 are each used twice.
- The supersession graph was rebuilt from those fields: 28 ADRs are fully
  superseded, 1 is only proposed (`0096-bot-trigger-sources-…`), and 101 are in
  force.
- Every in-force ADR that bears on renderer presentation, compact layout, the
  switcher, windows and dialogs, Home, device view state, connections, or
  folders was read in full. Those are listed below. The other 84 in-force ADRs
  (server runtime, CI, security, MCP, bot internals, release) were screened and
  do not bear on this change.

In-force ADRs relevant to this change:

- openspec/adr/0053-in-page-windows-share-one-modal-frame.md: one `InPageWindow` frame for in-page windows. Its exemption list is extended in part by ADR-0125 for compact drawers and sheets.
- openspec/adr/0040-home-tabs-are-device-local-presentation-in-their-own-dockview.md: Home presentation is per device. A compact section page's selected tab, search, and View options are client-local section state; the sheet's open state is not remembered.
- openspec/adr/0101-the-home-overview-layout-is-a-server-setting.md: the overview's layout editing stays on its page. The overview is not a compact section page and keeps its own layout.
- openspec/adr/0075-management-lives-in-one-settings-surface.md and openspec/adr/0115-settings-are-organised-by-the-place-that-stores-them.md: the Servers panel switches servers and opens Add connection, but never renames, edits, or forgets saved servers.
- openspec/adr/0047-a-window-is-one-server-running-the-host-bundle.md: the Servers panel shows reachability and upgrade state only for the window's attached connections (decision 6), and switches only on an explicit choice.
- openspec/adr/0048-a-connection-belongs-to-a-window-and-authority-to-a-device.md: a switch from the Servers panel stays a per-window connection change.
- openspec/adr/0062-a-server-upgrades-itself-to-its-own-channels-newest-signed-release.md and openspec/adr/0117-installing-a-channels-latest-build-may-move-backwards-only-on-explicit-request.md: the upgrade rows move into the Servers panel unchanged.
- openspec/adr/0049-a-folder-groups-panels-and-is-not-an-identity-boundary.md and openspec/adr/0050-a-project-reaches-its-repositorys-worktrees-through-server-resolved-folder-roots.md: the launcher folder picker filters display names and chooses by folder id. It never builds paths.
- openspec/adr/0124-a-command-default-may-set-environment-on-the-integrated-shell.md: launcher behaviour is unchanged by the new folder picker.
- openspec/adr/0071-a-running-terminal-always-has-a-place-someone-can-see.md: Tabs still lists every terminal; its status tabs filter the view and never hide a terminal from every route.
- openspec/adr/0106-forge-pull-requests-and-issues-come-from-pull-based-on-demand-forge-sources.md: scope tabs reuse the scope queries the wide chips already make; a tab shows a count only once its scope has loaded, so no extra fetch is added.
- openspec/adr/0097-workflows-are-checklists-an-agent-drives-and-terminay-never-runs-a-step.md: the compact workflow detail page only shows steps and opens the terminal; it never runs or answers a step.
- openspec/adr/0092-bots-use-the-local-docker-compatible-socket.md: the container engine card and sheet are presentation only. Deciding a permission request from a Needs you card uses the same decide call as the bot's chat.
- openspec/adr/0070-an-agents-view-operations-are-applied-by-the-client-it-is-talking-from.md: new tab, sheet, and rail-selection state is client-local view state, never server layout.

The highest ADR sequence number in use before this change was 0124.

## Repository-Level ADRs Created

- openspec/adr/0125-compact-drawers-and-sheets-are-navigation-surfaces.md: compact drawers (the switcher) and sheets (each compact section page's View options sheet) share one shell and are not in-page windows. Supersedes ADR-0053 decision 1 in part.

## Notes

The `in-page-windows` spec's frame requirement is modified in this change to
match ADR-0125.
