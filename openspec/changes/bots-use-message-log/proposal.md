## Why

A bot needs one persistent communication log independent of its individual executions. Continuing a provider chat for every user message prevents independent work and timely corrections; stdout and tool traces currently appear as conversation even when the agent has not deliberately communicated.

## What Changes

- **BREAKING** Each user message starts a fresh execution; chat is a server-owned message log, not a session transcript.
- Explicit scoped MCP tools read/search/post messages, inspect/control executions, consume paginated events, and coordinate shared desktop access.
- Bounded execution briefings contain trigger metadata, recent communication and active execution summaries. Older bodies and diagnostics require explicit reads.
- Concurrent executions can coordinate corrections without waiting behind earlier work. Atomic replacement cancels old work and revokes late posts.
- Message attachments are durable, bounded server-owned assets. Editing, deleting and clearing operate on communication records independently of provider history.
- Triggers use the same execution lifecycle. Agent posts do not recursively trigger executions.
- Bots can manage their own triggers through scoped runtime tools, with bounded reads, revision-checked writes, schedule preview and Run now.
- Existing diagnostic transcripts remain in Sessions, and existing user/assistant communication is imported once without replaying actions.

## Capabilities

### New Capabilities
- `bot-message-log`: durable communication, fresh executions, scoped bounded MCP tools, incremental events, coordination and attachments.

### Modified Capabilities
None in canonical specs. Reconcile the pending `add-terminay-bots` contracts for conversation continuation, queueing, triggers and session UI, and the pending socket change's transcript mutations and volatile images.

## Impact

Server core bot persistence/lifecycle/ACP/MCP, protocol and client-core, container relay, bot chat and sessions UI, fixtures and Docker-isolated E2E. No hosted service or host filesystem authority is introduced. Proposal and implementation remain in the existing branch/PR as authorized.
