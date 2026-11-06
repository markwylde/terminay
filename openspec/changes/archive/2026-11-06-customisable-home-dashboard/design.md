## Context

`HomeOverview.tsx` renders six fixed widgets from `buildHomeOverview()` in `homeOverviewModel.ts`. Data comes from `App.tsx`. The panel inventory and agent projection come through `dashboardSources`, automations through `useServerAutomations`, and remote access status through `remoteStatus`. `App.tsx` also holds data the overview never shows:

- `serverBots` (`useServerBots`): profiles, sessions, environments, and upcoming firings.
- `serverWorkflows` (`useServerWorkflows`): each terminal session's workflow.
- `terminalActivityItems.notifications`: the notifications list.
- Each inventory entry's `worktree` facts: pull request and checks.

Recordings are read on demand through `RecordingsClient.list`.

Server settings are read and written through the `SettingsClient` of the server the window is working in (`useTerminalSettings`), the same way the sidebar layout is persisted.

## Goals / Non-Goals

**Goals:** a customisable overview whose layout follows the user across devices; widgets for bots, workflows, notifications, recordings, pull requests, and quick actions; a distinct look for each widget.

**Non-Goals:** no free-form grid editor with arbitrary spans; no widgets contributed by extensions; no protocol change; no widget that writes to a bot or an automation. Activation only navigates, apart from dismissing a notification, which is the existing acknowledgement.

## Decisions

- **The layout is a server setting, `homeDashboard`.** The owner chose to share one dashboard across devices. The setting is classified `server` in `SETTING_AUTHORITY`. It is left out of the MCP allow-list because it is presentation, not behaviour. The working server's copy wins: a window attached to several servers reads and writes only the layout of the server it is working in. **Boundary:** this setting carries only widget ids and sizes, never data, so it widens nothing across the project, session, or server boundaries. Home *tab arrangement* stays per-device. See ADR-0101.
- **Shape.** `homeDashboard: { widgets: { id: string; size: 'small' | 'wide' | 'tall'; hidden: boolean }[] }`. An empty list means the default layout. Normalisation keeps the first entry for each id and drops anything malformed. It keeps unknown ids so that an older client does not erase a newer client's widgets. Resolution drops unknown ids and appends any catalogue widget missing from the list at its default size and visibility, so a widget added in a later release appears without wiping the user's arrangement.
- **One pure layout module.** `homeDashboardLayout.ts` exports the catalogue (id, title, default size, default visibility, allowed sizes), `resolveLayout`, `moveWidget(layout, id, toIndex)`, `setWidgetSize`, `setWidgetHidden`, and `resetLayout`. These are unit-tested with no React.
- **Default layout (from the approved mockup, `mockup.html` beside this file).** In order: Quick actions (wide), Needs you (wide), Agents, Workflows (wide), Bots, Run history (wide), Pull requests (wide), Notifications, Projects, Bot sessions, Automations, Recordings, then Tabs and Connections, which are hidden by default. Unless noted, a widget is small. Quick actions allows only small and wide. Every other widget allows small, wide, and tall.
- **Grid, strict order.** The grid is CSS `repeat(auto-fill, minmax(260px, 1fr))` with `grid-auto-rows: minmax(150px, auto)` and the default `grid-auto-flow: row`. It does not use `dense`, so visual order, stored order, and focus order stay the same, at the cost of the occasional gap. Wide spans two columns, and tall spans two rows. At one column (a container query on the grid), wide spans one column and tall keeps its two rows.
- **Edit mode is local UI state.** A **Customise** button in the header enters edit mode. Each widget then shows a drag handle, a size picker, and Hide, and stops navigating. Below the grid, a tray lists hidden widgets with Add. **Reset** restores the default layout, and **Done** leaves edit mode. Reordering works by HTML5 drag and drop, or by Move earlier / Move later buttons for keyboard users. Each change is written immediately, with an optimistic local update. Writes go through a serial queue. Each write carries the whole `homeDashboard` value as it stood after its edit, so the last edit wins. If a write fails, the overview drops the optimistic value, shows the layout the server last confirmed (the settings snapshot), and shows a one-line "Couldn't save the layout" notice until the next edit or the next settings update.
- **Model extensions stay derivations.** `buildHomeOverview` gains optional inputs: `bots` (`BotEntry[]`), `workflows` (per-session view joined to inventory panels for title and project), `notifications` (items), and `runHistoryLimit`. Workflows and pull requests are joined to the inventory of the server the window holds, since only that inventory names their panels. Every new count names the servers it could not see, using the existing `unavailable` mechanism.
- **Attention ordering.** Needs-you rows come in two groups. The first group is blocked or waiting agents (keyed by `stateStartedAt`), bot sessions in `needs-you` or holding a permission (keyed by `startedAt`), and workflows whose current step is `needs_input` (keyed by the step's `startedAt`), merged oldest first. The second group is workflows with a failed step and no step needing input, ordered by the failed step's `endedAt`, oldest first.
- **Workflow list.** Joined to the working server's inventory by `sessionId`, which gives the panel, title, and project. Workflows are ranked alert, then running, then other unfinished, then finished, with finished ones newest by last `endedAt` first. Rows use `tabSummary()`, so the dial and label match the tab. "Recently finished" means a finished workflow still attached to a running terminal; there is no archive.
- **Pull-request list.** One row per `folderId` among inventory panels whose worktree facts have a pull request in state `open` or `draft`. The row takes the first panel in inventory order. Rows are ranked failed checks, then pending checks, then the rest. A row activates its panel, because the dashboard row is a different surface from the Folders-row worktree controls, which keep opening the forge. The facts carry no URL, so the widget has no forge link.
- **Run history.** Built from the last 30 runs. The success rate is succeeded ÷ (succeeded + failed + timed-out). Running, skipped, and cancelled runs are counted separately.
- **Quick actions** call the same callbacks as the matching `viewCommands` entries: `createServerProject`, `openBots` with `requestNewBot`, `openAutomationsFromOverview({kind:'create'})`, `setIsViewCommandBarOpen(true)`, and `auxiliaryRouteController.openSettings()`. They need no project.
- **Stale targets.** Activation resolves through `activateDashboardRow` and `activateDashboardAgent`, which resolve at click time, so a target that has gone does nothing.
- **Multi-server partials.** Workflows and pull requests are counted only for the server whose panels the window holds. Every other attached server is listed as `not-held` through the existing unavailable mechanism. Item keys are always `serverId:id`.
- **Recordings: on-demand freshness, not live.** Recording lifecycle is not in the panel inventory, and the recordings service publishes no change event, so the widget cannot be live without polling (ADR-0028). Each time the overview is shown, it invalidates the client's list cache and reads `list({ limit: 5 })`. It shows loading, error, and unsupported states. The spec states this exception explicitly.
- **Visuals.** Each widget sets `--home-widget-accent`, which tints its icon chip, top border, and headline number. Status colours (needs you, working, done, failed) stay reserved and always come with a label. The agent ring is an SVG donut whose segment colours match the Tabs status vocabulary, with a legend beside it. The run strip uses one bar per run, coloured by outcome, with a tooltip naming the automation, outcome, and time.

## Risks / Trade-offs

- [A shared layout fits a phone poorly] → wide takes the single column at narrow widths, so one layout renders on both.
- [Two devices editing at once] → last write wins on the whole `homeDashboard` value. This is acceptable for a layout.
- [Strict order leaves gaps] → accepted, so that what you arrange is what you see. Edit mode lets you resize to close a gap.
- [Older servers do not classify `homeDashboard`] → unknown paths are transient there, so the write is dropped and the default layout shows. Nothing breaks.
