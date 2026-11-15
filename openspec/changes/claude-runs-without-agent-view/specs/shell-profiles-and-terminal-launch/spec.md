## ADDED Requirements

### Requirement: Integrated shells carry command default environment

When Terminay starts a shell with shell integration, it SHALL set in that shell's environment every variable that an applying terminal command default reports, except a variable the launch environment, built from the server's environment and the profile, already holds, and except a variable that two applying defaults both report. Terminay SHALL set these variables before the user's startup files run and SHALL NOT write them anywhere else. A shell started without shell integration SHALL NOT receive them. A default that reports only environment SHALL add no shell function and no arguments to a launcher line.

#### Scenario: Integrated shell receives a default's variable

- **WHEN** the `claude` command default applies with `CLAUDE_CODE_DISABLE_AGENT_VIEW=1` and a new terminal starts an integrated bash
- **THEN** the shell's environment has `CLAUDE_CODE_DISABLE_AGENT_VIEW=1`, and `claude --bg` run there is refused by Claude Code

#### Scenario: The inherited value wins

- **WHEN** the profile or the server's environment already sets `CLAUDE_CODE_DISABLE_AGENT_VIEW`
- **THEN** the integrated shell keeps that value

#### Scenario: Integration off

- **WHEN** shell integration is switched off, or the profile's shell is not one Terminay integrates
- **THEN** the shell does not receive command default environment

#### Scenario: Two defaults set one variable

- **WHEN** two applying command defaults both report the same variable name
- **THEN** neither value is set
