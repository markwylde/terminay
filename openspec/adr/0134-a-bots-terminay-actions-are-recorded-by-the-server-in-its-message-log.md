# ADR-0134: A bot's Terminay actions are recorded by the server in its message log

Status: accepted
Date: 2026-11-17

## Context

ADR-0093 keeps provider output and tool use out of a bot's Chat: the user sees only what the bot posts on purpose. ADR-0100 then let a bot hold workspace-reach Terminay MCP, so a bot can create projects, open terminals, run commands, attach workflows and create automations without saying so. Users asked to see these actions in Chat, with a link to what each one touched (issue #599).

Provider tool reports cannot carry this. They are untrusted, differ by provider, and do not know what a call created. Agent chats describe Terminay calls from the permission gate, before the handler runs, so they have no outcome and no created ID.

## Decision

1. **The server records a bot's acting Terminay calls after dispatch.** The host wraps the control dispatcher. For a call from a bot execution capability whose operation is on an explicit allow-list of acting operations, it records one action entry in that bot's message log once the handler has finished, whether it succeeded or failed, after the tool has already answered. Reads, lists, searches and waits are never recorded. The bot's runtime trigger mutations are recorded the same way. Descriptions and reasons are redacted like bot posts, and an action whose log was cleared during the call is dropped.
2. **Action entries live in the message log.** An action entry is a message row authored by the bot with an `activity` field: tool, outcome, bounded reason, count and link target. Repeats fold into one row. It is not a post: it raises no notification, is not unread, starts nothing, cannot be edited or deleted alone, and stays out of briefings.
3. **Words and targets come from the server, never from the agent.** The description is Terminay's wording of the validated request. The link target is the server ID resolved from the validated parameters and result. Agent text never decides what a link points at, and no output, setting value or secret is recorded.
4. **Links only navigate.** A client reveals a target through navigation the user already has, and checks that the target still exists. No capability is added to the renderer.

ADR-0093's rule that provider tool use stays in execution details stands. A Terminay action is server-observed, not provider-reported.

## Rejected alternatives

- **Parse provider tool reports.** They are untrusted, specific to each provider, and blind to results.
- **Note calls from the permission gate, as agent chats do.** This runs before the handler, so there is no outcome and no created ID.
- **A separate per-bot action log merged by time in the client.** It duplicates cursors, events, clearing and ordering that the message log already owns.

## Consequences

- Chat shows what a bot changed in Terminay, durably, even when the bot says nothing.
- Action entries are capped at 2,000 per bot, oldest dropped first, and never count against the 10,000-post limit; folding keeps repeated typing to one row.
- Every new acting MCP operation needs an allow-list entry and wording, or it is not shown.
- The dispatcher wrapper must never change a tool's result or fail a call. Recording errors are only logged.
