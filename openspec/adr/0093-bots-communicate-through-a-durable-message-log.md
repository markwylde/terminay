# ADR-0093: Bots communicate through a durable message log and scoped runtime tools

Status: accepted, supersedes ADR-0089 in part
Date: 2026-11-02
Supersedes: ADR-0089 (single concurrent session and no bot MCP only; container/ACP isolation and remaining decisions continue, as modified by ADR-0091 and ADR-0092)

## Context

The owner explicitly requested one fresh execution per user message, independent of communication history, with concurrent session coordination and bounded MCP context retrieval. The previous bot design resumes conversations, shows provider output as chat, and queues all work behind one execution. Atlas provides evidence for explicit MCP posting and bounded contextual briefings. Bots still have no authority over Terminay projects, terminals or host paths.

## Decision

A bot owns a durable message/event log, and each triggering message/event creates a fresh execution. Provider output stays diagnostic; communication is posted explicitly through a bot-scoped MCP runtime. The runtime exposes bounded paginated summaries, detail slices, incremental event cursors and execution coordination. It is separate from the terminal/project MCP registry and grants no workspace reach. Container stdio adapters connect to execution-bound host handlers over authenticated engine exec relays, with no published port or host path.

Executions can overlap within bounded admission while shared work is leased. Server-owned replacement revokes old posting authority, confirms process-group cleanup and transfers ownership. Same-bot executions share a container/uid and are not hostile security domains. Messages and durable attachments outlive execution processes. Existing accepted ADR files remain unchanged.

## Consequences

- Corrections can coordinate with busy executions without inheriting their provider context or waiting behind them.
- Context use is explicit, bounded and demand-driven; cursors and retained events need persistence and expiry tests.
- MCP relay, concurrent lifecycle, idempotency and attachment retention increase server complexity and require real adapter verification.
- Prompt-only routing, stdout-to-chat mirroring, unbounded history dumps and a single per-bot queue are rejected because they violate the communication and correction model.
- General host/project/terminal MCP exposure remains prohibited for bots. Browser/desktop and filesystem work still occur only inside their owning bot container.

Implementation and adapter evidence: [verification record](./evidence/bot-message-log-verification.md).
