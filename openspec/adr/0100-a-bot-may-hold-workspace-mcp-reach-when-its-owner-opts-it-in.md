# ADR-0100: A bot may hold workspace Terminay MCP reach when its owner opts it in, and that opt-in is its standing approval

Status: accepted, supersedes ADR-0093 in part and ADR-0072 in part
Date: 2026-11-06
Supersedes: ADR-0093 (consequence "general host/project/terminal MCP exposure remains prohibited for bots" only; every other decision continues). ADR-0072 (decision 1 clauses "a capability belongs to exactly one terminal or chat" and "Ask means a server-owned approval", and decision 2's list of workspace-reach holders, each now extended to bot executions as stated below; every other decision continues)

## Context

ADR-0093 gave bots a scoped runtime MCP server and kept the workspace MCP registry away from them. ADR-0068, carried forward by ADR-0072, defines two MCP caller kinds, the terminal and the chat. Both route Ask Permission approvals to that caller's own surface, and workspace reach is held only by automation-space terminals and workspace-reach chats. ADR-0068 says a new caller kind needs its own surface and a new ADR.

On 2026-11-06 the owner asked for a way to give a bot the same Terminay MCP access Pixel has. It is configured per bot and off by default. The owner also decided that enabling it needs no approvals. Turning it on is the decision, and turning it off is the only way to take it back.

## Decision

1. **The bot execution is a third MCP caller kind, and it holds workspace reach.**
   - Only the server's bot service can obtain its capability, from the bot record's current **Terminay MCP access** setting.
   - The capability has no calling terminal and no agent's client. It has the tools a workspace-reach chat has, except that tools needing a terminal or a client fail.
   - One capability is minted per execution. It is revoked, with its in-flight requests, when the execution ends, the setting is turned off, the bot is deleted, MCP is disabled, or at shutdown.
   - A start that races a toggle-off never mints.
2. **Opting a bot in is standing approval.**
   - For a bot execution caller, Ask Permission runs without a prompt.
   - Never Allow still refuses with `permission_denied`, because it is a server-wide hard stop, not an approval.
   - A bot execution holds no pending approvals or session grants, so it needs no approval surface.
   - The bot's own approval mode governs only the agent's own permission requests.
3. **The capability token never enters the container.**
   - The agent reaches the tools through a separate authenticated engine exec relay. Its execution-bound secret is the only thing the container holds, and it is redacted like any injected token.
   - The host serves the standard Terminay MCP tool surface against the control socket, with one MCP session per relay connection.
4. **Bots stay unmanageable by MCP.** No capability of any kind, including a bot's own, can create, read, change or prompt a bot.

### Alternatives rejected

- **Ask Permission prompts in the bot's chat.** The owner rejected these, because opting in is the approval.
- **Ignoring Never Allow for bots.** Rejected, because it would void the user's hard stop.
- **Treating the bot as a chat with a synthetic id.** Rejected, because approvals and view routing would chase a chat that doesn't exist.
- **Bind-mounting the host control socket into the container.** Rejected, because it exposes the host socket and the raw token.
- **Adding the workspace tools to the bot runtime server.** Rejected, because it mixes bot-scoped and workspace authority in one registry.

## Consequences

- A bot with access, running on triggers, can act across the workspace unattended. The mitigations:
  - access is off by default;
  - the Profile copy states the reach plainly;
  - Never Allow still binds the bot.
- Content a bot reads, such as a trigger's fetched data, can steer workspace tools for bots that have opted in. This is the same trust Pixel and Home-terminal agents carry.
- The container relay reports adapter disconnects, so per-connection work ends with its connection.
- Approval presentation is keyed on three caller kinds. The bot kind has no approval surface, by design.
- The trust-boundary review (ADR-0011) gains an invariant for the bot relay row. A bot execution capability is minted only by the bot service, from the bot record, and its token never crosses into the container.
