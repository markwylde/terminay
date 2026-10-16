## Why

Today, using an agent to look after your terminals means opening a terminal, starting Claude or
Codex in it, and pointing it at the others. Terminay has no way to talk to an agent from its own
interface. That rules out a quick "what's going on in my build?", and it rules out any feature that
wants an agent behind a proper UI rather than a terminal.

This change adds that once, as a general **agent chat** API, and ships its first consumer:
**Pixel**, the CRT-terminal character from [`@markwylde/pet`](https://github.com/markwylde/pet).
Pixel sits in the status bar. Click it and it jumps out onto the workspace and opens a chat. Pixel
can read terminals and summarise them, type into them, run commands, and manage tabs and
automations across the whole server, under the MCP permissions the user already set in Settings.

On the technical side, Terminay starts no agent process of its own, has no MCP principal other
than a terminal, and has no extension contribution that can run an agent. Claude Code and Codex
already ship first-party machine protocols for IDE chat: `claude` streaming JSON, and
`codex app-server`. That is how their VS Code extensions work. Using the user's installed CLIs
over those protocols means there is nothing to bundle.

## What Changes

- **Agent chat API (server).** The server owns chats. A chat has a provider, an MCP reach chosen
  when it is created (none, one project, or the whole server), a conversation, and at most one
  turn running at a time. Clients with terminal-create authority list, open, create, send to,
  stop, clear and close chats through core operations, and receive streamed events. Every client
  attached to the server sees the same chats. Chats live only in memory, so a restart starts
  with none.
- **Chat providers as an extension contribution (Extension API 3.2).** A new
  `contributes.agentChatProviders` kind, registered through `context.agents.registerChatProvider`,
  needs a new `agent-chat` permission. The host owns the chat, the conversation, MCP capability
  minting and approvals. The provider only runs turns. It receives the host-supplied MCP server
  entry, streams text, tool activity and failures back, and must confine the agent to that MCP
  server.
- **Claude Code and Codex providers in the built-in agents extension.** The `claude-code`
  provider drives the user's `claude` in `--print` streaming-JSON mode, with built-in tools off and
  only Terminay's MCP server loaded. The `codex` provider drives the user's `codex app-server`
  with an ephemeral, read-only thread, declining every command and file-change approval. Both
  find the user's installed CLI, report "not installed" or "not signed in" plainly, and write
  nothing to the agent's configuration.
- **A chat MCP principal.** Chats with MCP reach get their own capability, with project or
  workspace scope and no calling terminal. Their calls go through the existing permission policy.
  Approvals show in the chat itself, with the same wording and choices as a terminal approval.
- **Pixel.** Pixel is a server feature, off by default behind an **Enable Pixel** switch, plus a
  provider setting asked on first click. It is one well-known server-wide chat with whole-server
  reach. On every client (desktop, browser, phone) it docks in the status bar, or bottom-right
  when the bar is hidden. It flies out with the pet's chat balloon, shows approvals as message
  buttons, and goes back into the dock when done. Turning Pixel off removes it everywhere and
  closes its chat.
- **Upstream `@markwylde/pet` 0.2.0.** The chat balloon can now be driven by a host, with message
  action buttons. Done: [markwylde/pet#3](https://github.com/markwylde/pet/pull/3).

## Capabilities

### New Capabilities

- `agent-chat`: server-owned chats, their operations and events, the conversation model, MCP reach
  and the chat capability, tool activity, in-chat approvals, provider failures, the MCP-only
  boundary for chat agents, limits and secrecy.
- `pixel-pet`: Pixel's settings and onboarding, the Pixel chat, docking and presence on every
  client, approvals and state in the balloon, and turning Pixel off.

### Modified Capabilities

- `extension-platform`: adds the chat provider contribution kind and its `agent-chat` permission,
  the provider registration and turn contract, the provider session lifecycle in the extension
  host, and Extension API 3.2.
- `builtin-agents-extension`: contributes the Claude Code and Codex chat providers and locates the
  user's installed CLIs.
- `mcp-server`: a capability can belong to a chat as well as a terminal, with the chat's chosen
  scope. The stdio adapter reads connection details from its launch environment. App-window tools
  are unavailable to a chat.
- `mcp-permissions`: approvals, session grants and the pending-approval lifecycle are bound to the
  calling capability. A chat's approval renders in that chat.
- `workspace-status-bar`: the right side holds Pixel's dock, before the remote access indicator.

## Impact

- **Server** (`packages/server-core`): a new `agentChat` service (chats, conversation,
  operations, events, capability minting, approval routing) and a small `pixel` feature, plus
  extension host frames and registry for chat providers, and new server settings `pixel.enabled`
  and `pixel.provider`.
- **MCP** (`apps/terminay-server/src/mcp`): a chat principal in the capability store, workspace
  reach for chats, approvals keyed on the calling capability, and tools that require a calling
  terminal. Both host compositions (`electron/serverTerminalAuthority.ts`/`electron/main.ts` and
  `apps/terminay-server`) wire the chat mint path and the MCP adapter command.
- **Extension API** (`packages/extension-api`): version 3.2.0, with chat provider types,
  validation and a testing harness.
- **Built-in agents** (`extensions/builtin-agents`): `chat/claudeCode.ts`, `chat/codex.ts`, a CLI
  locator, and manifest `api: ^3.2.0`.
- **Client** (`packages/client-core`, `src/`): an agent chat client, the Pixel dock and pet wiring,
  and Settings > AI > Pixel.
- **Dependencies:** `@markwylde/pet@0.2.0` (UI) only. The agent CLIs are the user's own
  installations.
- **ADRs:** one new ADR records the owner-approved exception to ADR-0051 that lets chat providers
  run agents. A second supersedes ADR-0031 so that MCP authority admits a chat principal.
