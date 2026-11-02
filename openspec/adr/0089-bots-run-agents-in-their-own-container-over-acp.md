# ADR-0089: Bots run their agents inside their own container, over ACP, as an owner-approved exception

Status: accepted
Date: 2026-11-01

## Context

ADR-0051 says Terminay observes agents and does not instrument them. ADR-0067 makes one exception, for chat providers. It also says that any other feature which launches or prompts an agent needs its own ADR, approved by the owner.

The `add-terminay-bots` change adds bots. A bot is a named, long-lived agent with its own Docker container, home volume, memories, triggers, and sessions. Bots must:

- start their agent;
- choose its model;
- send it prompts, including on a schedule with no user present;
- answer its permission requests.

The owner asked for this design directly on 2026-11-01. The owner also asked that agents and models come only from extensions, since Terminay has no provider settings.

ADR-0067 rejected Agent Client Protocol (ACP) adapters for chat providers for two reasons. Terminay would have had to bundle them, at about 440 MB per platform. And one of them includes Claude Code, which Terminay may not redistribute. Neither reason applies to bots. Their image is built on the user's machine, which downloads the adapters. Each adapter brings its own agent runtime: `@agentclientprotocol/codex-acp` comes with a compatible Codex, and `@agentclientprotocol/claude-agent-acp` uses the Claude Agent SDK. Terminay ships nothing.

An independent review found that adapters change often. Zed's original Codex adapter is now archived, and model selection is offered as an ACP session configuration option rather than through a fixed API. So this decision depends on the feasibility gate in `add-terminay-bots`, which records its evidence in `openspec/adr/evidence/0089-bots/`.

## Decision

1. **The owner approves this exception, for bots only.** Terminay may start a bot's agent, send it prompts from the user or from the bot's own triggers, and answer its permission requests according to the bot's approval mode. A terminal agent is still only observed, and chat providers are still governed by ADR-0067.
2. **The agent runs only inside the bot's container.** The agent runs as the container's `bot` user in `/home/bot`. It is started through `docker exec`, under a launcher that gives each session its own process group, and never through a shell. A bot agent never runs on the server account, and it acts with its own tools inside the container.

   Terminay can always end a session's process group. It does so on every Stop, because agents leave cancelled tools running; when a timeout is not honoured; and on every server start.
3. **Terminay is the ACP client, and an extension only describes the agent.** A bot agent contribution declares:
   - its install step: pinned npm packages and Debian package names;
   - its ACP command;
   - its auth file and its credential secrets (sign-in tokens or API keys);
   - whether it can ask permission inside a container, its per-bot config files, and its launch environment.

   It answers `models`, `status`, and `launch`. It never starts, stops, or speaks to the agent process, and it never sees the transcript.

   Terminay selects models through ACP session configuration when the agent offers it, and uses `launch` only as a fallback. It passes each session's instructions as a context block in that session's first prompt. It writes no agent instruction files.
4. **The image is built locally.** Terminay ships a Dockerfile and builds `terminay-bot:local` on the server's machine, adding each bot agent's install step. Terminay never hosts, pulls, or redistributes a bot image or an agent.
5. **Terminay gives the bot no reach into the workspace.** A bot gets no Terminay MCP server, no access to projects or terminals, and no host path. The only exceptions are:
   - its agent's host auth file, when the bot uses Host login, as decided in ADR-0090;
   - the container engine's socket, when the user opts in.

   Each bot has its own Docker network. Its desktop requires a password, delivered through a root-only bootstrap that fails closed. No container port is published: the desktop listens on the container's loopback, and reaches clients only through the server's relay over an `exec` stream, which enforces view-only mode.

## Consequences

- Adding a bot agent needs no Terminay code: an extension names an ACP command. Models are selected through ACP session configuration where the adapter offers it, with `launch` as the fallback.
- An adapter or CLI update can break bots. Each built-in bot agent pins exact versions and carries a conformance test against the pinned adapter.
- The bot's container is its only boundary. A bot in Autonomous mode can do anything in its container. A bot that shares the engine socket can control that engine. Settings and the opt-in confirmation say so.
- A bot runs one session at a time. This keeps two agents from working in the same home at once.
- Bots run on a local Docker (rootful) or Podman (rootful, rootless, or the macOS Podman machine) engine, on macOS or Linux, each driven by its own CLI. The engine is pinned by its identity, so changing the Docker context cannot move bots to another engine. Resources are adopted only when both their server id and their bot id match.
- Any further feature that wants Terminay to launch or prompt an agent outside chat providers and bots still needs its own owner-approved ADR.
