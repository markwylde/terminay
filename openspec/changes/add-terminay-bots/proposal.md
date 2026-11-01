## Why

A Terminay user can watch agents in terminals and chat with Pixel, but cannot hand a long-running job to an agent and walk away. Today there is no agent that keeps its own machine, files, and memory between conversations, and none that wakes on a schedule or an event. Every agent runs on the user's own account, with the user's files and credentials, for as long as a terminal stays open.

Bots fill that gap. A bot is a named agent with its own Docker container, desktop, shell, home directory, memories, triggers, and session history. Bots live under Home and run wherever the Terminay server runs. The user-facing design is the interactive demo at https://claude.ai/artifact/EpeAfUbwuk36dewZXFa8Qt.

## What Changes

- **Home › Bots section.** Home gets a new sidebar section, **Bots**, between Tabs and Automations. It opens a Bots tab containing:
  - a fleet dashboard of bot cards, with filters, a Docker host summary, and a "Needs you" list;
  - opening a bot opens a Home tab named after it, for example Tabs, Bots, Bird, Sway;
  - creating a bot takes a name, an agent, and a model.
- **Bot tab.** Each bot tab switches between two modes:
  - **Chat**: a conversation, plus a context rail showing a live desktop thumbnail, recent sessions, upcoming triggers, and shortcuts.
  - **Configure**: five tabs, Profile, Environment, Memories, Triggers, and Sessions.
- **Profile.** Holds the name, avatar, colour, and instructions. It also holds the **agent and model**, which come only from installed extensions. Terminay has no provider settings of its own. Each agent shows its status: ready, not signed in, or not installed.
- **Environment.** Each bot runs in its own container, `terminay-bot-<id>`.
  - The image is `terminay-bot:local`. Terminay builds it on the server machine from a Dockerfile it ships with, and never pulls it from a registry.
  - A per-bot volume is mounted at `/home/bot`.
  - Sub-tabs:
    - Overview: state, resource use (refreshed on demand), CPU and memory limits, start, stop, restart, recreate, and idle stop.
    - Files: browse, upload, download, rename, and delete within the bot's home. This works through a short-lived helper container, so it also works while the bot is stopped.
    - Shell: an interactive terminal inside the container.
    - Desktop: a live VNC view, relayed through the server. The server holds the VNC password and enforces view-only mode.
    - Containers: the sibling containers the bot started through the engine's socket (Docker's `docker.sock`, or Podman's compatible socket). Sharing it is opt-in per bot, with a warning.
- **Sign-in for each bot.** Every bot signs in with its own credential, and a new bot is not signed in until the user chooses one:
  - **Token**: a sign-in token (Claude Code's `claude setup-token`) or an API key (Claude Code or Codex). It is kept in the vault for each bot, and is passed through the environment of the `docker` client, never through its arguments.
  - **Device sign-in**: for an agent that declares one, such as Codex's **Sign in with ChatGPT**, Terminay runs the agent's own `codex login --device-auth` inside that bot's container, as the bot user, in a terminal in the Sign-in section. The user approves the code in their browser, and the login stays in that bot's home volume.
  - Terminay never reads, detects, mounts, or copies a login of the server account.
  - There is no model proxy.
- **Memories.** Markdown notes the bot keeps in its home. The user can list, read, edit, pin, and delete them.
- **Triggers.**
  - Schedule triggers: once, interval, or cron.
  - Event triggers: the same terminal, agent, and Git events that automations use.
  - Each trigger carries a prompt, and has Run now, enable/disable, and a next-run preview.
  - The calendar is folded into the list of upcoming runs. There is no separate calendar view.
- **Sessions.** Every chat and every trigger run is a session. Each session shows:
  - its transcript and tool activity;
  - its origin (chat or trigger), its outcome, and its duration.

  The user can filter, stop, and continue a session, and can see its runner output. A bot runs one session at a time, and further work queues. Stop escalates from cancelling the turn to killing the agent's process tree. After a server restart, sessions that were running are marked interrupted.
- **Extension API: bot agents.** A new contribution, `contributes.botAgents`, with an `agent-bots` permission. A bot agent:
  - declares how to install its ACP adapter into the bot image;
  - lists its models, which the host selects through ACP session configuration when the agent offers it;
  - reports its sign-in status;
  - names the Agent Client Protocol (ACP) command that the host runs inside the container through `docker exec -i`.
- **Built-in agents.** The built-in agents extension contributes Claude Code and Codex as bot agents, through `@agentclientprotocol/claude-agent-acp` and `@agentclientprotocol/codex-acp`, each pinned to an exact version. The existing chat providers, and Pixel, are unchanged.
- **Feasibility gate first.** Before the main work, a spike on real Docker and the real adapters must prove the risky assumptions, and record its evidence under `openspec/adr/evidence/`:
  - argument-free token delivery;
  - model selection;
  - cancellation;
  - the stopped-volume helper;
  - the desktop relay;
  - supported Docker engines.
- Out of scope:
  - the Permissions, Notifications, Calendar, Passwords, and Secrets tabs;
  - Team roles and project mapping;
  - giving bots the Terminay MCP server;
  - a gateway or model proxy;
  - hosting the image in a registry;
  - sharing code with Atlas.

## Capabilities

### New Capabilities

- `terminay-bots`: the bot record, the Home Bots section and fleet dashboard, bot tabs and their Chat/Configure modes, Profile with agent and model from extensions, Memories, and Sessions.
- `bot-environment`: building the local image, the per-bot container and volume, the container lifecycle and idle stop, the Files, Shell, Desktop, and Containers views, opt-in engine-socket sharing, Docker and Podman support, and agent sign-in inside containers.
- `bot-triggers`: schedule and event triggers that start a bot session with a prompt, upcoming runs, Run now, and missed-run handling.

### Modified Capabilities

- `workspace-dashboard`: the Home sidebar lists five sections (Home, Tabs, Bots, Automations, Recordings). The Home empty state offers all five. Bot tabs belong to the Bots section.
- `extension-platform`: the bot agent contribution, the `agent-bots` permission, bot agent sessions over ACP, and model listing. Three existing requirements grow to include bot agents: Bounded API scope, Contribution arrays, and Host-owned behaviours.
- `builtin-agents-extension`: Claude Code and Codex are contributed as bot agents, each with an image install step, an ACP command, a model list, and sign-in status.

## Impact

- **Depends on** two changes being archived first:
  - `add-agent-chat-and-pixel`, whose deltas add chat providers and modify the extension-platform requirements this change modifies again;
  - `unified-settings-window`, whose delta adds Recordings to the Home sections.
- **Architecture.** ADR-0067 limits agent launching to chat providers, and its point 4 requires an owner-approved ADR for any other feature. This change records that ADR, covering:
  - running agents inside bot containers over ACP;
  - opt-in engine-socket sharing;
  - credential mounts.
- **Server (`packages/server-core`, with `packages/protocol` and `packages/client-core`):**
  - a bot store;
  - a container-engine driver for Docker and Podman, each driven through its own CLI, against a pinned local engine (including the Podman machine on macOS);
  - building the image, and container and volume lifecycle;
  - an ACP client;
  - a session store;
  - a schedule engine and event fan-out extracted from the automations service, then shared by automations and bot triggers;
  - a server-side RFB relay and a container exec PTY, exposed through the server protocol.
- **Renderer (`src/workspace/`):**
  - the Bots section;
  - bot tabs;
  - the Configure tabs;
  - preload API additions.
- **Extension API (`packages/extension-api`):** an API version bump for the `botAgents` contribution and its runtime types.
- **Built-in agents (`extensions/builtin-agents`):** bot agent declarations and conformance tests against the real adapters.
- **Assets:** a bundled `docker/terminay-bot/` Dockerfile, with desktop scripts (TigerVNC and a browser), the `terminay-run` session launcher, and the `terminay-files` helper.
- **Requirements:** Docker or Podman must be installed on the server machine. Without one, Bots shows a setup state and nothing else breaks.
- **Security:**
  - A bot that shares the engine socket controls that engine. That is root-equivalent with rootful Docker or rootful Podman on Linux, and user-equivalent with rootless Podman. That is why it is opt-in, warned, and labelled.
  - Each bot gets its own Docker network. Its desktop needs a password that the server delivers through a root-only bootstrap.
  - Supported engines: rootful Docker, and Podman (rootful or rootless, including the Podman machine on macOS). Supported platforms: macOS and Linux.
  - Every bot read, write, and subscription requires terminal-create authority, and streams end when that authority does.
  - Injected tokens are redacted from transcripts and logs, within the limits the design states.
  - A bot's agent, and the tools it runs, can read that bot's own credential. No bot can read another bot's credential or the server account's logins.
- **Tests:**
  - unit tests;
  - extension conformance tests;
  - E2E through `npm run test:e2e`, using a fake Docker engine and a fake ACP agent;
  - a manual smoke test on real Docker.
