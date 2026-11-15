# ADR-0124: A command default may set environment on the integrated shell, and Claude Code runs without agent view in Terminay terminals

Status: accepted, supersedes ADR-0105
Date: 2026-11-15
Supersedes: ADR-0105

## Context

ADR-0081 lets a registered command default add flags to an agent started in a Terminay terminal, as an owner-approved exception to ADR-0051, and ADR-0105 kept that rule while adding launcher initial prompts. ADR-0081 approved one default, `codex` → `--no-daemon`, because Codex's shared background server breaks binding sessions to terminals by process ancestry.

Claude Code 2.1 has the same problem. Its agent view (`claude agents`, `--bg`, `/background`, and the on-demand daemon) runs a conversation under a `claude daemon run` supervisor, with no controlling terminal, and gives each conversation a pseudo-terminal of its own. A conversation started from a Terminay terminal still descends from that terminal's shell, but it is on a different controlling terminal, so the binding rule treats it as external. The Agents pane shows it as working while its tab shows idle. This was seen on 15 November 2026: a session running under `bg-pty-host` on `pts/1`, spawned from a `claude` on the tab's `pts/0`.

Claude Code has no flag that turns agent view off. `--settings='{"disableAgentView":true}'` is a flag, but Claude Code 2.1.325 still starts a `--bg` session with it. The documented switch is the environment variable `CLAUDE_CODE_DISABLE_AGENT_VIEW=1`, which Claude Code describes as equivalent to the `disableAgentView` setting, and which refuses `--bg`, `claude agents`, and the daemon. ADR-0081 allows flags only. The repository owner asked for Terminay to apply the variable in its own terminals, without touching Claude Code's configuration.

## Decision

1. **ADR-0105 carries forward**, and through it ADR-0081, except where this ADR widens it. Launcher initial prompts are unchanged. Command defaults remain an owner-approved exception to ADR-0051, gated by the `terminal-command-defaults` permission, the agent's harness switch, the extension being enabled, and shell integration being on.
2. **A default may set environment as well as flags.** An applying resolution adds flags, environment variables, or both. A variable name is upper case, bounded, and never starts with `TERMINAY_`. A value is bounded and holds no control characters. Up to four variables per default.
3. **Environment goes on the integrated shell.** Terminay sets the variables in the environment of the shell it starts with integration, so the command sees them however it is started: typed, launched, through an alias, or through a script. Every program in that terminal inherits them. A default should name only variables that its command alone reads.
4. **The user's choices win.** A variable the shell already inherits, from the server's environment or the profile, is left as it is. The user's startup files run after Terminay sets it and may change or unset it. A variable two defaults both set is set by neither.
5. **Only where the agent supports it.** An extension reports an environment default as applying only after asking the installed agent itself, without reading or writing the agent's configuration. A default that is unsupported or uncertain does not apply.
6. **Nothing is written.** Terminay writes nothing into the user's home directory, shell startup files, or the agent's files. The agent run outside Terminay is unchanged.

The approved defaults are:

- `codex` → `--no-daemon` (from ADR-0081).
- `claude` → `CLAUDE_CODE_DISABLE_AGENT_VIEW=1`, contributed by the built-in agents extension under the Claude Code harness. It applies when `claude agents --json`, run with the variable set, refuses and names the variable.

## Consequences

- Claude Code conversations in Terminay terminals stay in the terminal's own process tree and controlling terminal, so their status shows on their tab.
- Inside Terminay terminals, Claude Code loses agent view: background sessions, `claude agents`, `/background`, and the daemon. The owner accepted this. A later ADR can drop the default if Claude Code exposes a mapping from a background conversation to the terminal driving it.
- The variable is visible to every program in the terminal, unlike a flag. Only Claude Code reads it.
- Any new default, for any agent, command, flag, or variable, is a new exception and needs the owner's approval in an ADR. Reviewers treat an unapproved default as a defect.
- ADR-0051 otherwise stands.
