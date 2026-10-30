## Context

Codex 0.166 runs every conversation in one shared background server. Each `codex` window is a client that talks to it over `~/.codex/app-server-control/app-server-control.sock` (JSON-RPC over a WebSocket on a Unix socket). The server holds every thread's `thread-writer-locks/<id>.lock` and rollout, so all-your-agents reports the server's pid for every Codex session. Terminay binds a session by walking that pid's parents to a PTY shell (`sessionSourceBridge.ts` `ownerOf`, `processAncestry.ts`). The TUI that first needs the server spawns it as a direct child, so for as long as that TUI lives, every Codex session binds to its terminal. Afterwards the server is reparented to `launchd` and no session binds.

The investigation established, from the Codex source at `22b33651` and from live repros:

- Nothing maps a thread to its client. `initialize` sends `ClientInfo { name, title, version }`, `thread/loaded/list` returns thread ids, and the server's per-thread subscriber list is internal (`thread_state_manager`) with connection counters, not pids. Upstream request: openai/codex#58431.
- `codex --no-daemon` (added in #46088) runs the thread in the TUI process, which then holds the writer lock. Verified: lock held by the TUI, parent is the terminal's zsh.
- No environment variable disables the shared server except a quirk (`CODEX_EXEC_SERVER_URL` set but empty), which the owner rejected as too fragile.
- Putting a wrapper first on `PATH` at spawn does not survive startup. On the owner's machine a test wrapper moved from position 1 to 23 after a zsh login start (`path_helper`, nvm, `~/.local/bin`).

Constraints in force: ADR-0051 (observe, never instrument; no added flags without an owner-approved ADR), ADR-0073 (launchers start agents bare), ADR-0025 (detection comes from all-your-agents), ADR-0011 (client input is untrusted), and the shell-profile contract (profiles carry no scripts; arguments are passed without shell parsing).

## Goals / Non-Goals

**Goals:**

- A `codex` typed in, or launched into, a Terminay terminal runs with `--no-daemon`, with no user setup, in zsh, bash, fish, and PowerShell.
- Codex outside Terminay, the user's startup files, and Codex's own files are untouched.
- A general core capability (shell integration plus command defaults) that extensions register into with data only, and that Codex is the first user of.
- No wrong agent dot: a session owned by a detached process never binds.

**Non-Goals:**

- Prompt marks, command tracking, cwd reporting, or any other shell-integration feature. Only the loader and command defaults are built now; the loader is designed so those can be added later.
- Integration for sh, dash, ksh, csh, tcsh, nushell, elvish, xonsh, WSL profiles, or shells started inside tmux or a nested shell.
- Mapping Codex daemon sessions to terminals. That waits on openai/codex#58431.
- Changing running terminals.

## Decisions

### 1. Inject at launch the way VS Code does, not with a `PATH` wrapper or user rc edits

VS Code's `getShellIntegrationInjection` (`src/vs/platform/terminal/node/terminalEnvironment.ts`, MIT) adds per-shell arguments and environment so its script runs after the user's own startup:

| Shell | Mechanism | Login start |
|---|---|---|
| zsh | `ZDOTDIR=<runtime dir>` holding `.zshenv`, `.zprofile`, `.zshrc`, `.zlogin`, each sourcing the user's file from `TERMINAY_USER_ZDOTDIR` first; `-i` / `-il` | `-il`; files chain in zsh order |
| bash | `--init-file <script>`; the script sources `~/.bashrc`, or imitates `-l` (`/etc/profile`, first of `~/.bash_profile`, `~/.bash_login`, `~/.profile`) when `TERMINAY_SHELL_LOGIN=1` | `--init-file` ignores `-l`, so the script imitates it |
| fish | `--init-command 'source <script>'` | `-l --init-command …` |
| PowerShell | `-NoExit -Command '. <script>'` | `-Login -NoExit -Command …` |

Only empty arguments or a recognised interactive or login form are integrated; anything else falls back unchanged (VS Code's `UnsupportedArgs`). This reuses `shellStartupModeFamily` to classify the shell, and the startup-mode translation stays the source of the login decision.

Alternatives: a wrapper prepended to `PATH` at spawn (measured to fail); editing user rc files (the owner rejected it, and it would affect terminals outside Terminay); `CODEX_EXEC_SERVER_URL=` (undocumented quirk, rejected); typing an alias into the PTY after spawn (visible, races startup, pollutes history); proxying Codex's socket (writes into `~/.codex`, sits in all Codex traffic, machine-wide).

Boundary: this crosses the shell-profile contract (profiles carry no scripts, arguments are unparsed). Integration is a server-managed launch layer added after profile resolution, never stored in a profile, and the integration scripts are fixed files shipped with the server. User input never becomes shell code.

### 2. Command defaults are data, core writes the shell code

A registry entry is `{ command, prependArgs }`. In each new integrated terminal, Terminay passes the snapshot through one environment variable, `TERMINAY_COMMAND_DEFAULTS`: one record per command, records separated by the ASCII record separator (0x1E), and the command and each flag within a record separated by the ASCII unit separator (0x1F). Names and flags can never contain control characters, so the encoding needs no escaping and holds no shell syntax. The integration script decodes it with shell builtins and defines functions:

- zsh, bash: `codex() { command codex --no-daemon "$@"; }`
- fish: `function codex --wraps codex; command codex --no-daemon $argv; end`
- PowerShell: `function codex { & (Get-Command codex -CommandType Application | Select-Object -First 1) '--no-daemon' @args }`

Each argument is emitted as a literal that the shell does not evaluate. The decoder in each script is the only place shell quoting happens, and it is covered by tests with hostile values. The function is skipped when `alias`/`functions`/`Get-Command` shows the user already defined the name.

Validation is tight on purpose: the command name is a plain word and not a builtin or reserved word of any supported shell, every argument starts with `-`, and both count and length are bounded. The `-` rule means a default can add options but can never turn `codex` into `codex exec` or another subcommand.

Alternatives: aliases (do not apply in all contexts and cannot be detected uniformly); letting extensions supply script snippets (a code-injection channel into every shell); a generic "shell init" contribution (too much authority for the first use).

Boundary: extension → every user shell. Only validated data crosses. The manifest fixes the command name, so a runtime cannot redirect a default to another command.

### 3. Extension contribution mirrors terminal launchers

`contributes.terminalCommandDefaults` entries declare `id`, `command`, and optional `harness`, plus the `terminal-command-defaults` permission. The runtime registers with `context.terminals.registerCommandDefault(id, { resolve(signal) })`. The host resolves on registration and on harness switch-on, bounds `resolve` time, and drops the entry on failure, harness switch-off, disable, or deactivation. The host never awaits resolution during a launch. This is the same lifecycle as `registerLauncher` (`folders-pane-strip-and-agent-launchers`), so the host can share the harness-gating and availability machinery.

### 4. Codex: probe `--help`, cache by file identity

The built-in agents extension finds Codex with its existing locator (`chat/locate.ts`), runs `<path> --help` with a timeout (5 s) and an output bound (256 KiB), and applies only if a line matches `^\s*--no-daemon\b`. The result is cached by `realpath`, size, and mtime, so an update re-probes and a stable install is probed once. A version comparison was rejected: `--help` is what Codex itself declares and works across install channels (npm, standalone, Homebrew) without a version table. The probe runs the user's own executable with a read-only flag, which ADR-0051 permits as observation. It does not start a conversation or touch `~/.codex` beyond what Codex itself does for `--help`.

### 5. Launchers append the matching default

ADR-0073 makes a launcher type only the executable path. With this change the host types the path followed by the arguments of a registry entry whose command equals the executable's file name. The extension still supplies no arguments: the host takes them from the registry. A launcher and a typed `codex` therefore behave the same. Launchers apply defaults even when shell integration is off, because typing does not depend on the shell.

### 6. Binding requires the PTY to be the controlling terminal

`ProcessAncestry` already reads parents with `ps -o ppid=` (macOS) or `/proc/<pid>/stat` (Linux). At bind time it also reads the controlling terminal of the owning process and of the shell: `ps -o tty=` on macOS (`??` means none), and `tty_nr` (field 7 of `/proc/<pid>/stat`) on Linux. A session binds only when they match. A detached server (setsid, no tty) can then never bind, whoever spawned it. This replaces a "shared pid" heuristic, which would wrongly unbind Codex sub-agent threads that share their parent's pid. Reads happen on the same edges as ancestry, never on a timer.

Boundary: terminal-session binding is a security boundary for agent status (spec: Live Agents projection). The rule only narrows what binds.

### 7. Runtime files

The scripts are fixed text embedded in the server bundle; Server Core builds with `tsc` alone, which carries no non-TypeScript assets into `dist`. zsh needs a `ZDOTDIR` directory, so on first use the server creates `<data root>/shell-integration` and its `zsh` subdirectory (never world-writable `/tmp`) with mode `0700` and writes every script there with mode `0600`. Before each use it checks that both directories are real directories owned by the server account and writable by no one else; if not, the terminal starts without integration and the directory is never repaired. Integration environment variables live in the `TERMINAY_` namespace, which profiles cannot override.

## Risks / Trade-offs

- [Integration subtly changes shell startup (ordering, `$0`, login detection)] → Follow VS Code's proven files; the e2e suite runs real zsh, bash, and fish login and non-login starts, and asserts that user rc side effects and `ZDOTDIR` match a non-integrated start. A setting turns integration off.
- [A user's rc rewrites `codex` after our function] → Our function is defined after the user's files run, and an existing user definition wins by design.
- [Unsupported shells, nested shells, and tmux still use the Codex server] → The controlling-terminal rule leaves those sessions unbound (no dot rather than a wrong dot). It is documented as a known limit.
- [`--no-daemon` loses shared-server features (several clients on one thread, a thread outliving its window)] → Owner-accepted trade. When #58431 lands, a later change can drop the default.
- [Codex renames or removes `--no-daemon`] → The `--help` probe stops matching and the default stops applying. Codex keeps working, and status falls back to unbound.
- [`codex --help` on every launch would be slow] → Probed once per executable identity and never on the launch path.
- [Delta overlap with unarchived `folders-pane-strip-and-agent-launchers` and `add-agent-chat-and-pixel`, which also modify `Contribution arrays` and `Bounded API scope`] → This change's MODIFIED text already includes their arrays. Whichever archives last keeps the full list; tasks include a check at archive time.

## Migration Plan

No data migration. Ships behind the new server-scoped setting, on by default; running terminals are unaffected. Rollback: turn the setting off, or switch the Codex harness off, and new terminals start exactly as before.

## Open Questions

- ADR-0051 and ADR-0073 forbid adding flags to an agent. The owner asked for this directly, so the adr step records an owner-approved exception that supersedes ADR-0073's bare-start rule for registered command defaults, and narrows ADR-0051 point 1 for flags registered through this mechanism only.
- Windows PowerShell 5.1 (`powershell.exe`) and `pwsh` are both integrated, matching VS Code. On Windows they are the only integrated shells: a `bash.exe` there may be WSL's launcher or Git Bash, whose paths differ from the server's. Revisit if native Windows support lands with different constraints.
