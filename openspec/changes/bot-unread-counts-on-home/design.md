## Context

The server holds one notification per bot with unacknowledged posts, carrying a `count` of those posts (`BotNotificationRecord`, ADR-0100). It publishes a record after the settle period and withdraws it when the bot is acknowledged on any client: Chat shown, a user post, or a dismissal. The window already receives the published set through `usePublishedNotifications` for the server it shows, and lists it in the header Notifications control. `HomeView` already draws a count on a sidebar section through `sectionBadges`, used for workflows that need you.

## Goals / Non-Goals

**Goals:** show the unread post count on the Home control, the Bots sidebar item, and each bot's sidebar row.

**Non-Goals:** no server, protocol, or MCP change; no change to the header Notifications count, which stays one per bot; no count on the compact chrome row's Home control, where the Notifications control beside it already lists bot posts; no count for bots of other attached servers.

## Decisions

- **Count the published set, not the message log.** `botUnreadCounts(snapshot, bots)` sums `count` per bot and in total over published bot records, skipping bots the window does not know, exactly as the Notifications list skips them. ADR-0100 keeps ADR-0061's rule that consumers show only the published set, so a post inside its settle period is not counted, and the counts never disagree with the list. Alternative considered: the per-device read mark behind Chat's unread divider. Rejected because it is device-local, is known only for bots whose Chat this device has loaded, and is not cleared by acknowledgement elsewhere.
- **Posts, not bots.** The count is the number of unread posts, so one bot with three posts reads `3`. The header Notifications control keeps counting one per bot.
- **The window's server only.** The window subscribes to notifications from the server it shows, so the counts cover that server's bots. The sidebar can list bots from other attached servers; their rows show no count. Bot ids are per server, so a row is matched on server id and bot id together. Alternative considered: subscribing to every attached server's notifications. Rejected as a larger change than this request; the header Notifications control has the same scope.
- **Presentation.** The Bots item reuses `sectionBadges`. A bot row reuses the `home-sidebar__badge` style after its running time. The Home control gets a small corner badge. Counts above 99 read `99+` through `formatActivityCount`; accessible names always state the exact count.
- **Boundary.** Presentation only. Bot records reach only clients with bot authority (ADR-0100 decision 3), and this change reads nothing else, so the bot authority boundary and the project/window boundary are untouched.

## Risks / Trade-offs

- [The Home control's count differs from the Notifications count] → they count different things: posts against notifications. The accessible name says "unread messages".
- [A bot on another attached server shows no count] → stated in the contract; the header Notifications control has the same scope.

## Migration Plan

None. Rollback is reverting the change.

## Open Questions

None.
