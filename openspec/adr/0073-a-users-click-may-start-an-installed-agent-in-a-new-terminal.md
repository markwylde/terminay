# ADR-0073: A user's click may start an installed agent in a new terminal, as an owner-approved exception to observing agents

Status: accepted
Date: 2026-10-22

## Context

ADR-0051 says Terminay observes agents and does not instrument them, and does
not start or prompt one on its own initiative; an exception needs the
repository owner's approval in an ADR. ADR-0067 approved chat providers running
the user's agents and said any other feature that launches an agent outside a
chat provider needs its own ADR.

The `folders-pane-strip-and-agent-launchers` change adds launcher buttons to a
folder's New terminal row: one for the default shell and one for each agent an
extension offers, starting with Claude Code and Codex. Most terminals in a
worktree are agent terminals, and the user otherwise opens a shell and types the
agent's name. The repository owner asked for this directly and chose that an
agent start with no arguments.

## Decision

1. **Owner-approved exception, scoped to terminal launchers.** When a user
   chooses a launcher, Terminay may create a terminal with the default profile
   and type the absolute path of that launcher's agent executable into the
   shell, followed by Enter. This covers nothing else.
2. **Bare start only.** The typed line is the executable path and nothing more:
   no arguments, flags, prompt, model, or environment. Terminay sends nothing to
   the agent after it starts; from then on the terminal is an ordinary terminal
   and the agent in it is only observed.
3. **The user's own installation.** A launcher names an executable already
   installed on the server account. Terminay never bundles, downloads, wraps, or
   configures an agent for a launch.
4. **Server authority.** A client sends only a launcher id. The server resolves
   it from the extension's contribution, validates the path, quotes it for the
   shell, and types it. A client cannot supply the command, and an extension
   cannot supply arguments, environment, input, or a working directory.
5. **Only at a click.** A launch happens only as the direct result of a user
   choosing a launcher. Restoring, reloading, or reconnecting a terminal never
   starts its agent again.

## Consequences

- Starting an agent in a folder is one click, and works the same for any agent
  an extension contributes.
- A launched agent runs exactly as if the user had typed its name, with the
  user's own configuration, so an agent update cannot break the launch beyond
  the executable being moved or renamed.
- Agent conveniences that would need a prompt, a flag, or a resumed session at
  launch are not covered and need a further owner-approved ADR.
- Reviewers treat a launcher that passes arguments or environment, or any launch
  not triggered by a user's click, as a defect.
