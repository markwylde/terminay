# ADR-0081: A registered command default may add flags to an agent started in a Terminay terminal, as an owner-approved exception to observing agents

Status: accepted, supersedes ADR-0073
Date: 2026-10-30
Supersedes: ADR-0073

## Context

ADR-0051 says Terminay observes agents and does not instrument them. Among other things, it does not add flags or environment variables in order to change how an agent behaves, and any exception needs the repository owner's approval in an ADR. ADR-0073 approved one exception: a user's click on a terminal launcher types the agent's executable path, with no arguments, into a new terminal. Its consequences say that any convenience needing a flag at launch needs a further owner-approved ADR.

Codex 0.166 runs every conversation in one shared background server by default. Each `codex` window becomes a client, and nothing Codex writes or serves maps a conversation to the window driving it (openai/codex#58431). Agent status binds sessions to terminals by process ancestry, so Codex sessions bind to the wrong terminal or to none. The only supported way to keep a conversation in its own terminal's process is `codex --no-daemon`. The repository owner asked directly for Terminay to apply that flag in its own terminals, with no setup, without editing the user's startup files or Codex's configuration, and without affecting Codex outside Terminay.

## Decision

1. **Owner-approved exception, scoped to command defaults.** An extension with the `terminal-command-defaults` permission may register a command default: a command name fixed in its manifest and a list of flags. In Terminay terminals with shell integration, typing that command runs it with those flags first. When a terminal launcher starts that command, Terminay types the flags after the executable path. This covers nothing else.
2. **Flags only, decided by data.** Every added argument starts with `-`. A default cannot add a subcommand, a prompt, a model, environment, input, or a working directory, and cannot supply shell code. Terminay generates the shell code and quoting.
3. **Only where the agent supports it.** An extension reports a default as applying only after checking the installed agent itself, for example by reading its `--help`, never by reading or writing the agent's configuration. A default that is unsupported or uncertain does not apply.
4. **The user's choices win.** A user alias or function of the same name stays in place. Switching the agent's harness off, disabling the extension, or turning shell integration off removes the default from new terminals. Running terminals keep what they started with.
5. **Terminay's terminals only.** Nothing is written into the user's home directory, shell startup files, or the agent's files. Codex run outside Terminay is unchanged.
6. **Launcher rules carried forward from ADR-0073.** A launcher still starts the user's own installed executable, never one Terminay bundles, downloads, or wraps. A client sends only a launcher id, and the server resolves, validates, quotes, and types the command. A launch happens only as the direct result of a user choosing a launcher, never on restore, reload, or reconnect. After the typed line, Terminay sends the agent nothing and only observes it. The only change from ADR-0073 is that the typed line may include a registered command default's flags.

The first and only approved default is `codex` → `--no-daemon`, contributed by the built-in agents extension.

## Consequences

- Codex sessions in Terminay terminals bind to the right terminal again, and the launcher and a typed `codex` behave the same.
- Codex loses shared-server conveniences inside Terminay terminals: several clients on one conversation, and a conversation outliving its window. The owner accepted this. A later ADR can drop the default if Codex exposes a client mapping.
- Any new default, for any agent or command, is a new exception and needs the owner's approval in an ADR before an extension ships it. Reviewers treat an unapproved default as a defect.
- ADR-0051 otherwise stands: Terminay still adds no hooks and no configuration writes, and adds no flags outside this mechanism.
