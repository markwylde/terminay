## Why

A Codex conversation lights up the wrong terminal. One tab shows a yellow "Agent working" dot for a conversation that finished, while the terminal that is visibly working shows nothing. Since Codex 0.166, every `codex` window connects to one shared background server (`codex app-server --managed-daemon`) that holds every conversation's writer lock and transcript. all-your-agents reports that server's pid for each session, and Terminay binds by process ancestry. The server is spawned as a child of whichever Codex window started it first, so every Codex session binds to that window's terminal until it exits, and then to none.

Codex records nothing on disk or over its protocol that maps a conversation to the client process driving it (checked against the Codex source and a live repro; upstream request openai/codex#58431). The one supported way to get a per-terminal process back is to start Codex with `--no-daemon`, which runs the conversation inside the terminal's own Codex process. The owner wants that to happen with no setup in Terminay terminals only, in any common shell, without editing the user's startup files or Codex's configuration.

## What Changes

- Add **shell integration** to Terminay Server for zsh, bash, fish, and PowerShell, modelled on VS Code's injection: Terminay adds server-managed arguments and environment at launch so its own script runs after the user's startup files have loaded, without writing any user file. Other shells, and profiles with arguments Terminay does not recognise, start exactly as today.
- Add **terminal command defaults**: a server-owned registry of `{ command, prependArgs }` entries. Shell integration defines each entry as a shell function in new terminals, so typing the command runs it with those arguments first. Entries are data; core does all quoting and generates all shell code.
- Add a `terminalCommandDefaults` contribution and a `terminal-command-defaults` permission to the extension platform, so an extension can register entries.
- In the built-in agents extension, register `codex` → `--no-daemon` while the Codex harness is enabled, Codex is installed, and the installed Codex's `--help` lists `--no-daemon`.
- The Codex terminal launcher types the registered default arguments after the executable path, so the launcher button and a typed `codex` behave the same.
- Agent binding also requires the session's owning process to have that terminal's PTY as its controlling terminal. A detached process such as the shared Codex server has none, so it never binds, even while it is still a child of a terminal's process. A wrong dot becomes no dot for any Codex launched without the default (unsupported shell, nested shell, tmux).
- Record an owner-approved exception to ADR-0051 and ADR-0073 for adding a flag to an agent that Terminay starts or the user types in a Terminay terminal.

## Capabilities

### New Capabilities

- `shell-integration`: server-managed shell integration for supported shells, the terminal command-defaults registry, how defaults reach new terminals and launchers, and the user setting that turns it off.

### Modified Capabilities

- `shell-profiles-and-terminal-launch`: the launch resolver may add server-managed shell-integration arguments and environment for supported shells; protected variables gain the integration namespace.
- `extension-platform`: new `terminalCommandDefaults` contribution array and `terminal-command-defaults` permission; the bounded API scope admits them.
- `builtin-agents-extension`: the extension contributes the Codex `--no-daemon` command default, gated on the harness toggle and a capability probe of the installed Codex.
- `agent-status-and-sidebar`: terminal binding by process ancestry also requires the owning process to be attached to that terminal's PTY.

## Impact

- `packages/server-core/src/shellProfiles/` and `terminalService/launchResolver.ts`: integration arguments and environment at launch.
- New shell-integration scripts shipped with the server (zsh `ZDOTDIR` files, bash init file, fish and PowerShell init scripts) and a per-user private runtime directory for them.
- `packages/extension-api` and the extension host: contribution schema, permission, runtime `defineTerminalCommandDefaults`, and change notifications.
- `extensions/builtin-agents/`: Codex command default and `--help` probe; launcher typing.
- `packages/server-core/src/activity/sessionSourceBridge.ts` and `processAncestry.ts`: controlling-terminal check at bind time.
- Settings: a server-scoped "Shell integration" switch, on by default.
- No change to Codex files, user startup files, or Codex outside Terminay terminals.
