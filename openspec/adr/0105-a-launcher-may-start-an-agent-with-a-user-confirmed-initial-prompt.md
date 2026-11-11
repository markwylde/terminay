# ADR-0105: A launcher may start an agent with a user-confirmed initial prompt, as an owner-approved exception to observing agents

Status: accepted, supersedes ADR-0081
Date: 2026-11-11
Supersedes: ADR-0081

## Context

ADR-0051 says Terminay observes agents and does not instrument them, and any
exception needs the repository owner's approval in an ADR. ADR-0073 approved
typing an installed agent's executable path into a new terminal at a user's
click. ADR-0081 superseded it to allow registered command-default flags, and
carried forward the rule that a client sends only a launcher id and Terminay
sends the agent nothing after the typed line.

Change `forge-pull-requests-and-issues` adds **Start work** on an issue and
**Review with agent** on a pull request. Each creates or reuses a worktree and
starts a chosen agent there on a task the user has just read in Terminay. With
ADR-0081's rules the agent starts with no task, and the user has to copy the
issue into it by hand, which is the friction the feature removes. Claude Code
and Codex both accept an initial prompt as their first positional argument.
On 2026-11-11 the repository owner approved the Start work and Review with
agent designs, in which the agent starts with a prompt the user can edit.

## Decision

1. **ADR-0081 stands, except where this record changes it.** A registered
   command default may add flags (`codex` → `--no-daemon` remains the only
   approved default). Defaults are flags only, decided by data. They apply only
   where the agent supports them, the user's own aliases win, and nothing is
   written outside Terminay's terminals. A launcher starts the user's own
   installed executable. Launches happen only as the direct result of a user
   choice, never on restore, reload, or reconnect.
2. **A launcher may declare `initialPrompt: "positional"`.** The declaration is
   data in the manifest. It says only that the program takes an initial prompt
   as its first positional argument. The extension never supplies, sees, or
   transforms the prompt.
3. **A prompt is passed only on a user's confirmation.** A client may send an
   initial prompt with a launcher id only from a surface where the user has
   seen and could edit the prompt, and has confirmed it: in this change, Start
   work and Review with agent. Terminay does not keep the prompt in terminal
   metadata or restore state, and never sends it again on restore. Because it
   is typed on the launch line, it is as visible as any command the user
   types: in shell history, the terminal's scrollback, session recordings
   (ADR-0057), and the agent's own transcript.
4. **Terminay quotes; the prompt is never shell code or a flag.** The server
   rejects an empty prompt, bounds it to 4,000 characters, rejects control
   characters other than newlines and a prompt that starts with `-` after
   leading whitespace, folds newlines to spaces, and passes it as one argument
   quoted for the profile's shell, after the executable path and any
   command-default flags. Prompts are supported in POSIX shells, fish, and
   PowerShell. `cmd.exe`, which cannot stop `%VAR%` expansion inside quotes,
   and unrecognised shells reject a prompt.
5. **After the typed line, Terminay still sends the agent nothing.** The prompt
   is an argument on the launch line, not input written to the agent's terminal
   later.

## Consequences

- Start work and Review with agent start an agent on the task in one click,
  through the same launch path as any launcher.
- A launcher that does not declare `initialPrompt` cannot be given one. The
  server rejects the create.
- Quoting must be tested per supported shell family with metacharacters (`$`,
  backticks, quotes, `;`, `&`, `|`, `%`), a leading dash, and Unicode, and by
  checking the argv the program actually receives. An injection is a security
  defect.
- A task given at launch can end up in shell history and recordings, like any
  command the user types.
- Any other way of giving an agent input (typing into it after start, a
  subcommand, environment) is still a new exception and needs a further owner
  approval in an ADR.
