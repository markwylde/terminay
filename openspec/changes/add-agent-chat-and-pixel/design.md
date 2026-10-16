## Context

Terminay has the pieces for this change, but each one assumes a terminal or a fixed contribution
list:

- **MCP authority** is a capability minted per terminal by `ControlCapabilityStore.mint(...)`
  (`apps/terminay-server/src/mcp/controlEndpoint.ts:486`), which travels in the PTY environment.
  Workspace reach (`workspaceReach.ts`) exists only for automation-space terminals.
- **Approvals** (`packages/server-core/src/mcpApprovals`, `apps/terminay-server/src/mcp/permissionGate.ts`)
  are keyed by the calling terminal and render inline in its pane.
- **Extensions** run each in a forked child with framed IPC (`packages/server-core/src/extensions/{host,child,protocol}.ts`).
  The API has a closed list of contribution kinds (`packages/extension-api`, currently 3.1.0).
  Language servers set the precedent for long-lived child processes owned by an extension
  (`languageSessionRuntime.ts`). Worktree insights (commit `a502c5c0`) show the full path a new
  kind takes: API types and validation, host and child frames, manager, catalog, both host
  compositions, client-core.
- **Built-in agents** (`extensions/builtin-agents`) only observes agents (ADR-0025, ADR-0051) and
  writes MCP install entries. It does not look up `claude` or `codex` binaries, and the extension
  child's PATH is the server's, which for a Desktop app launched from the Dock lacks per-user bins.
- **The agent CLIs have first-party machine protocols** (verified against `claude` 2.1.302 and
  `codex-cli` 0.160.0 on this machine):
  - `claude -p --input-format stream-json --output-format stream-json --verbose --include-partial-messages`
    streams `stream_event` text deltas, `assistant` messages with `tool_use` blocks, and a final
    `result`. `--tools ""`, `--strict-mcp-config --mcp-config <json>`,
    `--permission-prompts none`, `--no-session-persistence` and `--setting-sources ""` together
    gave a session with no built-in tools, no MCP servers, no user settings or hooks, and working
    auth.
  - `codex app-server` speaks JSON-RPC (`initialize`, `thread/start`, `turn/start`,
    `turn/interrupt`, notifications such as `item/agentMessage/delta`, `item/started`,
    `turn/completed`, and server requests such as `item/commandExecution/requestApproval`).
    `thread/start` takes `cwd`, `sandbox`, `approvalPolicy`, `ephemeral`, `developerInstructions`
    and a dotted `config` override map. `-c mcp_servers={}` does **not** clear the user's MCP
    servers, but `config: { "mcp_servers.<name>.enabled": false }` per server does.
    `--disable hooks` stops user hooks.
- **`@markwylde/pet` 0.2.0** ([PR #3](https://github.com/markwylde/pet/pull/3)) adds
  host-driven chat (`onSend`, `setMessages`, `setStatus`) and message action buttons
  (`chat:action`).

Owner decisions: one combined change; chats are server-owned, shared by every client with
terminal-create authority, and ephemeral; each chat picks its MCP reach when created; chat
providers are a public Extension API 3.2 contribution; only Claude Code and Codex for now, in the
built-in agents extension; Pixel uses the existing MCP permission policy, has whole-server reach,
uses the pet's balloon, is off by default, and asks for its provider on first click.

## Goals / Non-Goals

**Goals:**

- A general, server-owned agent chat API that future features can build UI on.
- Chat providers as an extension contribution, with Claude Code and Codex built in, driving the
  user's installed CLIs over their first-party protocols.
- Chat agents that reach the machine only through Terminay MCP, under the existing permission
  policy, with approvals shown in the chat.
- Pixel as the first consumer, on every client.

**Non-Goals:**

- New MCP tools (opening project tabs, driving Home, editing settings). A chat gets the existing
  tool surface for its scope.
- App windows from chats. `show_window` renders in a calling terminal's pane.
- Persisting chats, resuming provider sessions, or importing history.
- Per-chat model, effort or system-prompt choices in the UI.
- A general chat panel in the workspace. Pixel is the only UI in this change.
- Providers other than Claude Code and Codex, or bundling any agent binary.

## Decisions

### 1. `agentChat` service in server-core owns chats; providers only run turns

`packages/server-core/src/agentChat/` holds, per chat:

- id, key, title, provider id and reach;
- the conversation (entries with ids, bounded);
- status, revision, the open provider session handle and the chat capability.

It exposes core operations through `createAgentChatOperationHandlers`: `agentChat.providers`,
`.list`, `.get`, `.create`, `.open`, `.send`, `.stop`, `.clear`, `.close` and `.decideApproval`.
It publishes a `agentChat.changed` journal event for list and entry changes, and a transient
`agentChat.delta` for streaming text. Both carry chat revisions, so a client resynchronises with
`.get`. Every operation requires terminal-create authority, matching the approval decision path
(ADR-0031/0068). The service is composed in `composition.ts` with three host-injected
functions:

- `mintChatCapability(chatId, reach)`;
- `mcpServerEntry(token)`;
- a provider registry backed by the extension host.

*Boundary:* the server owns agents, conversations and authority, and extensions are workers
(extension-platform "Host-owned behaviours"). Clients never see processes, tokens or adapter
commands. Every client of a window's server sees the same chats (ADR-0047).

*Alternative rejected:* putting the conversation in the extension. Then a provider extension would
own user data and approvals, and every provider would re-implement them.

### 2. Chat provider contribution, Extension API 3.2

- **Manifest and permission.** `contributes.agentChatProviders: [{ id, displayName, platforms }]`, with permission `agent-chat`.
- **Registration.** `context.agents.registerChatProvider(id, { availability, openSession })`. `openSession` returns `{ prompt, cancel, close }` and receives an `events` sink: `text`, `tool` (`{ callId, server?, name, state }`), `turnEnd`, `failure` (`{ reason, detail }`) and `exit`.
- **Host frames** (`protocol.ts`), following the language-server pattern of dedicated frame kinds:
  - host to child: `agent.chat.availability`, `agent.chat.open`, `agent.chat.prompt`, `agent.chat.cancel`, `agent.chat.close`;
  - child to host: `agent.chat.event`, with `result` and `failure` for the request frames.
- **Host side.** Sessions are tracked per extension. On child exit, quarantine, disable or update, every open session is ended unexpectedly.
- **SDK.** `packages/extension-api` gets types, validation, `EXTENSION_API_VERSION = '3.2.0'`, and a testing harness for chat providers.

*Boundary:* the extension API surface (extension-platform "Bounded API scope"). This is a new,
narrow contribution: providers get a working directory, an instruction and an MCP entry, and
return bounded events. They get no client authority and no conversation access.

### 3. Claude Code provider: `claude` stream-json, one process per session

Spawned directly (no shell) in the host's working directory:

```
claude -p --input-format stream-json --output-format stream-json --verbose
  --include-partial-messages --tools "" --setting-sources ""
  --strict-mcp-config --mcp-config '{"mcpServers":{"terminay_chat":{command,args,env}}}'
  --allowedTools mcp__terminay_chat --permission-prompts none
  --no-session-persistence --append-system-prompt <instruction>
```

With reach `none`, the MCP config is empty and `--allowedTools` is omitted.

- **Turns.** A turn writes one `{"type":"user","message":{...}}` line.
- **Event mapping.**
  - `stream_event` `content_block_delta`/`text_delta` → `text`;
  - `assistant` `tool_use` blocks → `tool` running;
  - `user` `tool_result` → `tool` completed or failed;
  - `result` → `turnEnd`, or `failure` when `is_error`. Auth errors map to `not_signed_in`.
- **Stop.** Uses the stream-json `control_request` interrupt. If that is not acknowledged within a short bound, the provider kills the process and the session ends.
- **MCP tools.** The Terminay tools are pre-allowed in Claude because Terminay's own permission gate decides on the server. A second prompt would double-ask.

### 4. Codex provider: `codex app-server`, one process and one ephemeral thread per session

- **Launch.** `codex app-server --disable hooks --disable browser_use --disable computer_use --disable apps`, then `initialize`.
- **Thread.** `config/read` gets the user's configured MCP server names. Then `thread/start` is sent with:
  - `cwd` = host working directory;
  - `sandbox: "read-only"`;
  - `approvalPolicy: "untrusted"`;
  - `ephemeral: true`;
  - `developerInstructions` = instruction;
  - `config` setting `mcp_servers.<each user server>.enabled = false` and `mcp_servers.terminay_chat.{command,args,env}`.
- **Turns.** A turn is `turn/start`, and Stop is `turn/interrupt`.
- **Event mapping.**
  - `item/agentMessage/delta` → `text`;
  - `item/started` and `item/completed` for `mcpToolCall` → `tool`;
  - `commandExecution` items → `tool` with kind `command`;
  - `turn/completed` → `turnEnd` (status `failed` → `failure`);
  - `error` notifications → `failure`, with auth errors as `not_signed_in` and usage limits as `failed` plus the detail.
- **Server requests.** Every `item/commandExecution/requestApproval`, `item/fileChange/requestApproval`, `item/permissions/requestApproval`, `applyPatchApproval` and `execCommandApproval` is answered with decline. `item/tool/requestUserInput` and MCP elicitations are answered with cancel.

*Boundary (3 and 4):* ADR-0051. Launching an agent with flags and session configuration is
instrumentation that ADR-0051 forbids without an owner-approved ADR. The owner asked for this, so
ADR-0067 records the exception, scoped to chat providers. Neither provider writes the agent's
files. Codex's read-only sandbox still lets trusted read-only commands run, so Codex is a
guardrail, not a sandbox, and Settings says so.

*Alternative rejected:* ACP adapters (`claude-agent-acp`, `codex-acp`). They would add about
440 MB per platform, and they bundle Anthropic's Claude Code binary, which Terminay may not
redistribute. VS Code's own Claude and Codex extensions use these same first-party protocols.

### 5. Locating the CLIs

`extensions/builtin-agents/src/chat/locate.ts` resolves each executable by checking:

1. `TERMINAY_CLAUDE_CODE_COMMAND` / `TERMINAY_CODEX_COMMAND`, which must be absolute;
2. the child's `PATH`;
3. the login shell's PATH (`$SHELL -lc 'printf %s "$PATH"'`), read once per activation with a 3 s timeout;
4. known per-user locations (`~/.local/bin`, `~/.claude/local`, `/opt/homebrew/bin`, `/usr/local/bin`, `~/.npm-global/bin`, `~/.bun/bin`, `~/.volta/bin`).

Results are cached per activation. There is no polling (ADR-0028). The env names are added to the
manifest's declared environment variables so the host passes them.

### 6. A chat principal in the capability store

`ControlCapabilityStore` gains `{ kind: 'chat', chatId }` beside terminal principals.
`mintChat(chatId, reach)` yields project or workspace scope from the server's own state: the chat
record, never a claim. `workspaceReach.ts` treats a workspace chat like an automation-space
terminal. App-window tools are flagged `requiresCallingTerminal` and report unavailable. Only
`agentChat` receives `mintChatCapability`, through host injection in both compositions.

*Boundary:* the MCP capability boundary (ADR-0011, ADR-0031). This widens who may hold workspace
scope, so ADR-0068 supersedes ADR-0031. Creating a workspace chat needs terminal-create
authority, which can already open a terminal and run anything.

### 7. Approvals keyed on the calling capability

`permissionGate` creates pending approvals with `caller: { kind: 'terminal', ... } | { kind: 'chat', chatId, title, providerName }`.
`agentChat` subscribes to the approval service and turns chat-caller approvals into approval
entries, with outcomes recorded on resolution. Decisions use the existing decision path and its
authority check. Session grants and the queue bound key on the capability. Stop cancels the turn,
and the provider's MCP request cancellation ends the pending approval as today.

### 8. The conversation as clients see it

Entries are:

- `user` `{ text }`;
- `assistant` `{ parts: (text | activity)[] }`;
- `approval` `{ approvalId, statement, details, state, outcome? }`;
- `notice` `{ tone, text }`.

Activity text is built by the server: for `server === 'terminay_chat'` it maps the tool name and
the terminal handle argument, which the server sees because it brokered the call, to a display
title. Otherwise it uses a generic kind. Bounds: 200 entries, 16 KiB per text, and 8 open chats
per server.

### 9. Pixel: a thin server feature plus a UI consumer

- **Server.** `packages/server-core/src/pixel/` reads settings `pixel.enabled` (default `false`) and `pixel.provider` (`unset` | provider id). It offers one operation, `pixel.open`, which returns the Pixel chat id, creating the chat with key `pixel`, title "Pixel", the configured provider and workspace reach. The operation is refused while Pixel is off or the provider is unset. On disable or provider change it closes the Pixel chat. `agentChat.create`/`.open` refuse the reserved key.
- **UI.** `src/pixel/`:
  - `PixelDock` sits in `WorkspaceStatusBar.tsx` before the remote button, with a bottom-right fallback when the bar is hidden;
  - `usePixel` creates one pet per window (`character: Pixel`, `hidden: true`, `dock`, `autoHide`, status-bar insets, device-local position under a `persist` key whose history stays empty because the chat is host-driven);
  - onboarding uses the empty-state `suggestions` filtered by `agentChat.providers` availability;
  - entries map to `ChatMessage`s, with approval entries as `actions` and `chat:action` → `agentChat.decideApproval`;
  - status maps to `setStatus`, and `--mwpet-*` map to Terminay theme tokens.
- **Settings > AI > Pixel.** An Enable Pixel switch, a provider select, and a note that chat agents are confined to Terminay MCP but are not a sandbox.

### 10. Pixel's instruction

A fixed instruction is sent per session: "You are Pixel, Terminay's assistant. You see and control
the user's terminals only through the `terminay_chat` tools. Read before you write. Keep replies
short." It is sent as `--append-system-prompt` for Claude and as `developerInstructions` for Codex.
The generic API takes the instruction from the creating feature on the server, never from a
client.

## Risks / Trade-offs

- [Two protocol clients to maintain, and both CLIs move fast] → each provider is a small mapper behind the platform's event contract, with a fake-CLI unit suite and a real-CLI conformance test (skipped without credentials), in the spirit of ADR-0025's real-CLI evidence.
- [`codex app-server` is marked experimental] → pinned to observed behaviour by the conformance test. A protocol mismatch reports `failed` with the detail rather than hanging.
- [Codex read-only commands still run in its sandbox] → read-only sandbox, `untrusted` policy, every approval declined, private empty working directory. Settings says chat agents are confined to Terminay MCP as far as each agent allows, not sandboxed.
- [The user's Codex MCP servers are discovered by `config/read` and disabled by name. A server added mid-session is not] → the session is created fresh each time. Servers from plugins are covered if `config/read` reports them. Otherwise the conformance test catches it.
- [Usage limits or auth failures (seen on this machine for Codex)] → surfaced as notices with the agent's own message.
- [Workspace reach from a chat] → it is the reach an automation run already has, under the same policy defaults, and approvals name the target and full text.
- [A Finder-launched Desktop can't see the CLIs] → the login-shell PATH and per-user locations, plus explicit override variables.

## Migration Plan

The change is additive. Pixel is off by default, no chat exists until one is created, and
Extension API 3.2 is a minor bump, so existing `^3.x` extensions keep activating. Rollback means
leaving Pixel off, or reverting. Nothing is persisted.

## Open Questions

- The exact stream-json interrupt `control_request` shape is to be confirmed against `claude`
  2.1.x during implementation. Killing the process is the fallback.
- ADR-0031 is superseded by ADR-0068, and ADR-0051 gains the owner-approved exception in ADR-0067.
