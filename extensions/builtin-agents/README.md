# Terminay built-in agents extension

`terminay-builtin-agents` (`com.terminay.builtin-agents`) is Terminay's official
extension for coding agents. It does two things:

- It reports every live Claude Code, Codex, Grok, and oh-my-pi session on the
  server's machine to Terminay's **Agents** panel.
- It registers the Terminay MCP server with Claude Code, Codex, Cursor CLI,
  Gemini CLI, Grok, and OpenCode from **Install Terminay MCP**.

It is an ordinary ESM Node.js package that uses only `@terminay/extension-api`
and Node.js. It does not import Terminay Server Core, Electron, or renderer code.

## Detection

All detection is done by [`@markwylde/all-your-agents`](https://github.com/markwylde/all-your-agents),
pinned to exactly **1.4.1**. The extension runs one library instance with the
providers of the switched-on harnesses. It has no journal parser, process
matcher, status inference, or timer of its own, and it never polls.

| Harness id | Name | Library provider |
| --- | --- | --- |
| `claude-code` | Claude Code | `claude-code` |
| `codex` | Codex | `codex-cli` |
| `grok` | Grok | `grok-build` |
| `oh-my-pi` | oh-my-pi | `oh-my-pi` |

OpenCode sessions are not reported until the library has an OpenCode provider.

### Capability matrix (all-your-agents 1.4.1)


| Agent | Live detection | Status | Waiting for | Titles | Model | Tools | Turn outcome | Subagents | Transcript | History | Print mode |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Claude Code | 🟢 | 🟢 | 🟢 | 🟢 | 🟢 | 🟢 | 🟢 | 🟢 | 🟢 | 🟢 | 🟠 ¹ |
| Grok Build | 🟢 | 🟢 | 🟢 | 🟢 | 🟢 | 🟠 ² | 🟠 ³ | 🟢 | 🟢 | 🟢 | 🟠 ⁴ |
| Codex CLI | 🟢 | 🟢 | 🔴 ⁵ | 🟢 | 🟢 | 🟢 | 🟢 | 🟢 | 🟢 | 🟢 | 🟢 |
| oh-my-pi | 🟢 | 🟢 ⁶ | 🟠 ⁷ | 🟢 | 🟢 | 🟢 | 🟢 | 🟢 | 🟢 | 🟢 | 🟠 ⁸ |

🟢 full · 🟠 partial · 🔴 none. Subagents covers start, end, background and nested.

1. `claude -p` writes no live index entry, so a print-mode run appears in history only.
2. Grok's `tool_started` carries no call id, so the current tool is identified by name. Two tools with the same name running at once show as one.
3. A failed turn is reported as `failed`, but Grok records no error message for it, so `activity.error` is usually empty.
4. `grok -p` registers as live only when `GROK_TRACK_HEADLESS` is set. Otherwise it appears in history only.
5. Codex does not persist approval requests, so a session blocked on an approval reads as `running`. A launched Codex with no prompt yet has no rollout. A `/resume` after watch started appears on its first append. A VS Code thread unloaded without touching another file stays listed until the next event for that pid.
6. omp writes no transcript until the first reply of a new session ends. That first turn is read from omp's prompt history, which needs SQLite: Node ≥ 22.13, or your own `sqlite` reader. Without it a new session reads `idle` until its transcript appears.
7. A pending `ask` tool reads `waiting`. Permission approvals never reach disk, so a session blocked on one reads `running` (omp's default approval mode asks for none).
8. omp names a run after the terminal on its stdin, in print mode too: `omp -p` typed in a terminal is live and reads `interactive`. Piped or detached, it has no terminal and appears in history only. Nothing on disk marks a run `headless`.

The library reports `waiting` both for a session blocked on the user and for one
whose turn has ended while a background shell or monitor it started will wake
it (`waitingFor` `shell` or `monitor`). Terminay's `waiting` means the user is
needed, so the extension reports the second kind as `running`.

Terminay shows what the library knows and nothing more. Gaps are fixed in the
library, not here.

## Harness switches

Settings → Extensions shows one switch per harness under this extension. When
the enabled set changes, the extension stops the library, restarts it with only
the enabled providers, and publishes a reset of the live sessions. Switching
agent status off, or disabling the extension, stops the library and releases
every file and process watch it held.

## What crosses to Terminay

Only live sessions (those with a process id and an absolute working directory)
are published. Each snapshot carries:

- the session id, the harness id, the process id, and the working directory
- the effective title and the model
- the status (`running`, `waiting`, or `idle`) and what a waiting session waits for
- the current tool's name, the last turn's outcome and end time, and a failed turn's error message
- subagents: id, parent id, type, title, and status

Every string is bounded to the SDK limits. Transcripts, prompts, assistant text,
tool input and output, event streams, and raw provider records never leave the
extension process. A library failure is reported as a typed diagnostic
(`provider-error` or `listener-error`) naming only the provider, never a path or
conversation content.

Terminay, not this extension, decides which project a session belongs to (its
working directory is inside the project or one of its Git worktrees) and which
terminal it runs in (its process descends from that terminal's shell). The
library reads only the server account's own provider homes, so the sessions
shown are that account's.

## MCP install targets

Each target writes the `terminay` entry with exactly the command, arguments,
and environment the host supplies, atomically, and refuses to overwrite a
Terminay entry the user changed. Targets work whether or not their harness is
switched on.

| Target id | Client | Configuration file |
| --- | --- | --- |
| `com.terminay.builtin-agents/claude-code` | Claude Code | `~/.claude.json` |
| `com.terminay.builtin-agents/codex` | Codex | `~/.codex/config.toml` |
| `com.terminay.builtin-agents/cursor` | Cursor CLI | `~/.cursor/mcp.json` |
| `com.terminay.builtin-agents/gemini` | Gemini CLI | `~/.gemini/settings.json` |
| `com.terminay.builtin-agents/grok` | Grok | `$GROK_HOME/config.toml`, else `~/.grok/config.toml` |
| `com.terminay.builtin-agents/opencode` | OpenCode | `~/.config/opencode/opencode.json` or `opencode.jsonc`, whichever exists |

## Platforms

macOS and Linux, as the library supports. The host passes these variables to
the extension when they are set on the server: `CLAUDE_CONFIG_DIR`,
`CODEX_HOME`, `GROK_HOME`, `PI_CONFIG_DIR`, `PI_CODING_AGENT_DIR`,
`XDG_DATA_HOME`, and `XDG_STATE_HOME`.

The library's optional native dependency, `koffi`, ships with the extension as
prebuilt binaries and gives kqueue/pidfd process-exit watches, so a session
closes as soon as its agent exits. Where it cannot load, the extension keeps
running on the library's file-change re-validation and reports one
`process-watch-degraded` diagnostic; a closed agent then disappears on its
next file change.

## Development

```sh
npm run compile --workspace terminay-builtin-agents
npm test --workspace terminay-builtin-agents
npm run test:packed --workspace terminay-builtin-agents
```

The session-source tests drive the library's own fixture drivers
(`@markwylde/all-your-agents/testing`) through the public extension testing
harness. The MCP tests write into temporary home directories. The packed test
inspects the real npm tarball and activates it against a real process.
