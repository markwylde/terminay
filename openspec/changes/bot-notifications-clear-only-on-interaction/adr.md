# ADR Review Manifest

## ADR Review Completed

- Date: 2026-11-11
- Reviewer: Claude
- Change: `bot-notifications-clear-only-on-interaction`

## In-Force ADR Context Reviewed

- openspec/adr/0061-a-notification-is-a-server-owned-record-published-after-a-settle-period.md - Its settle period and server ownership continue (decisions 3 to 7). Decisions 1, 2 and 8 are superseded by ADR-0100.
- openspec/adr/0100-a-notification-belongs-to-one-terminal-or-one-bot.md - Bot notifications and bot authority on acknowledgement are unchanged. Only the client's reason to acknowledge changes.
- openspec/adr/0093-bots-communicate-through-a-durable-message-log.md - The acknowledged sequence on the message log is unchanged.
- openspec/adr/0028-no-polling-without-owner-approval.md - Interaction is event-driven from DOM input and bot focus requests. No poll is added.
- openspec/adr/0011-security-trust-boundary-model.md - The change stays in the renderer and uses the existing acknowledge command.

## Repository-Level ADRs Created

- openspec/adr/0104-a-notification-is-acknowledged-only-by-what-the-user-does.md - A client acknowledges a notification only because the user acted on its owner. Being on screen or focused never acknowledges.

## Notes

`notifications-clear-only-on-interaction` applied this rule to terminals without recording an ADR. ADR-0104 states the rule for every notification owner, and this change applies it to bots.
