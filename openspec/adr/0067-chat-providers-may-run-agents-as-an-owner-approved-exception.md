# ADR-0067: Chat providers may run the user's agents, as an owner-approved exception to observing agents

Status: accepted
Date: 2026-10-16

## Context

ADR-0051 says Terminay observes agents and does not instrument them. It does not
wrap an agent's executable, add flags or environment variables to change how an
agent behaves, or send an agent input on its own initiative. Its point 4 says an
exception needs the repository owner's explicit approval, recorded in an ADR.

The `add-agent-chat-and-pixel` change adds server-owned agent chats, whose turns
are run by chat providers contributed by extensions, starting with Claude Code
and Codex in the built-in agents extension. Pixel is the first feature on top.
A provider has to start the agent, choose its working directory, pass it flags
or session configuration, and send it the user's messages. The owner asked for
this design directly.

Agent Client Protocol adapters were tried first. They would have bundled about
440 MB per platform, including Anthropic's Claude Code binary, which Terminay may
not redistribute. Claude Code and Codex both ship first-party machine protocols,
`claude` streaming JSON and `codex app-server`, and their own VS Code extensions
use them.

## Decision

1. **Owner-approved exception, scoped to chat providers.** A registered chat
   provider may start the user's installed agent CLI for a session the host
   opened, and drive it over that agent's own machine protocol. This covers
   nothing else. A terminal agent is still only observed.
2. **The user's own installation.** Providers start the agent executable that is
   installed on the server account, found from the environment, the login
   shell's PATH, or documented per-user locations. They never bundle, download,
   or wrap an agent.
3. **Flags and session configuration only, never agent files.** Providers may
   pass launch flags, environment, and per-session configuration to confine the
   agent: no built-in tools, only the host's MCP server, no user hooks or
   settings where the agent allows it, no session history, and the host's
   instruction. They write nothing to the agent's configuration, settings, hooks,
   or credentials, and depend on nothing in them beyond the existing login.
4. **Input only from the user.** A provider sends the agent only what a user
   typed into a chat, plus the instruction the server feature that created the
   chat supplied. Terminay never prompts an agent on its own initiative.
5. **MCP is the only reach Terminay grants.** Providers decline every request to
   use a tool other than the host-supplied MCP server, which Terminay's own
   permission policy governs.

## Consequences

- An agent CLI update can break agent chat as well as agent status and the MCP
  entry. Each provider carries a real-CLI conformance test.
- Confinement is as strong as each agent allows. Codex's read-only sandbox still
  runs trusted read-only commands. Chat agents are not a sandbox, and Settings
  says so.
- Third-party chat providers are bound by the same rules through the extension
  platform's provider contract. A reviewer treats a provider that writes agent
  files, downloads an agent, or prompts on its own as a defect.
- Any other feature that wants Terminay to launch or prompt an agent outside a
  chat provider needs its own owner-approved ADR.
