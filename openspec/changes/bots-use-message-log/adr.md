# ADR review

Reviewed the repository ADR inventory and supersession links, including currently applicable ADR-0002, ADR-0011, ADR-0028, ADR-0037, ADR-0044, ADR-0045, ADR-0046, ADR-0051, ADR-0067, ADR-0089, ADR-0091 and ADR-0092. Window/terminal attachment and MCP rules remain scoped to those features; bot communication receives its own bounded container-only interface.

[ADR-0093](../../adr/0093-bots-communicate-through-a-durable-message-log.md) records the owner-authorized change to fresh executions, explicit communication and scoped runtime MCP. It supersedes only the single-session and no-bot-MCP portions of ADR-0089. No accepted ADR was edited.

Bot-owned trigger management reuses this scoped transport and the existing server-owned trigger service. Ownership stays bound to the execution capability, with no new workspace or engine authority. The extension requires no new architecture decision.
