## Why

A notification in Terminay is not a thing anyone owns. The server holds each terminal's activity state, and every client separately works out from it which terminals count as notifications, what to call them, and how many there are. That has three costs a user can see. A notification flashes into the header and the Dock badge and vanishes again when an agent pauses for a moment or the user is already reaching for the terminal. An agent has no way to say "come and look at this" in its own words. And any new place a notification should appear, such as a phone, has to reimplement the rule and hope it agrees.

The fix is to make the notification a server-owned object with one owner of the logic. A terminal says what it wants shown and takes it back when it no longer applies; one notification manager on the server decides when that reaches a person.

## What Changes

- **A notification manager on Terminay Server.** It holds every notification on the server. Each belongs to one terminal. Terminal activity adds and removes them, and nothing else in the product decides what a notification is.
- **A five-second settle before anything is shown.** A notification is held as pending when it is added and is published to clients only if it is still there five seconds later. One removed in that time, because the user typed, viewed the terminal, or the agent carried on, is never shown anywhere. **BREAKING** for timing: the header Notifications count and list, and the Desktop icon badge, now show a notification five seconds after it arises instead of at once.
- **Status dots stay live.** A terminal's own tab dot and its project's dot keep showing working, waiting, and done immediately. They are the terminal's state; a notification is the server telling you it has been waiting.
- **Clients display, they do not derive.** Desktop, the web UI, and the installed PWA all show the manager's published list and count. The rule that builds the list stays in the workspace UI only as the fallback for a server too old to publish notifications.
- **Agents can send and dismiss a notification.** Two new Terminay MCP tools, `send_notification` and `dismiss_notification`, let an agent raise a notification with its own title and text on its own terminal and take it back. They are operations of the local control endpoint, as the app-window tools are, so any process in the terminal that holds its capability can call them, not only an MCP client.
- **Interaction dismisses, for every kind.** Viewing, clicking into, or typing in a terminal removes all of that terminal's notifications, including one an agent sent. Dismissing a row removes that notification.
- **A new MCP permission group, Notifications,** defaulting to Always Allow, governs the two tools.

Decisions taken with the owner: the logic is central to one notification manager and terminals carry none of it; the settle is five seconds and applies to every client including Desktop; a terminal can remove what it added; an agent can send and dismiss its own notifications over the same socket path `show_window` uses.

Not in this change: push delivery to the installed PWA, which the `pwa-push-notifications` change builds on this one; a Notifications list in the phone-width chrome; operating-system banners from Desktop; a `terminay` command-line subcommand for sending a notification.

## Capabilities

### New Capabilities

- `notification-manager`: the server-owned notification set, who may add and remove a notification, the settle period, publication to clients, removal by interaction, and bounds on agent-sent notifications.

### Modified Capabilities

- `agent-status-and-sidebar`: the header Notifications count, the Notifications list, and dismissal show and act on the manager's published notifications instead of a client-derived set, and gain rows for agent-sent notifications.
- `workspace-and-project-tabs`: the project tab activity dot reads terminal indicator state directly and does not wait for the notification settle period.
- `mcp-server`: adds the `send_notification` and `dismiss_notification` tools.
- `mcp-permissions`: adds the Notifications permission group and its default.

## Impact

- **`packages/server-core`**: a new notification manager fed by the activity reducer and by the control endpoint; a timer per pending notification; publication on the ordered event journal.
- **`packages/protocol`**: notification snapshot and delta, a dismiss operation, and two control-endpoint operations.
- **`apps/terminay-server` MCP adapter**: two tools and their descriptions.
- **`src/` workspace UI**: `TerminalActivityOverview` and `notificationText` stop deriving and render the published set; the Desktop badge report follows the same number. Tab and project dots are unchanged.
- **Settings**: one more row under Settings > AI > Terminay MCP.
- **Sequencing**: `one-window-one-server` restates the three `agent-status-and-sidebar` requirements this change modifies. Whichever is archived second rebases its delta onto the other's wording.
- **Tests**: e2e scenarios that assert a header count immediately after a terminal finishes need to wait for the settle or use the test clock.
