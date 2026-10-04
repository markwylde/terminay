# Agent provider capabilities

Terminay does not detect coding agents itself. The built-in agents extension,
`terminay-builtin-agents`, delegates detection to
[`@markwylde/all-your-agents`](https://github.com/markwylde/all-your-agents),
pinned to one exact version, and publishes the sessions that library reports.

What Terminay can show for each agent is therefore the library's capability
matrix for the pinned version. It lives with the extension, in
[`extensions/builtin-agents/README.md`](../extensions/builtin-agents/README.md#capability-matrix-all-your-agents-140),
and changes only when the pinned library version changes.

## Supported agents

| Agent | Session status | MCP install target |
|---|---|---|
| Claude Code | Yes | Yes |
| Codex | Yes | Yes |
| Grok | Yes | Yes |
| oh-my-pi | Yes | No |
| OpenCode | No: the library has no OpenCode provider | Yes |
| Cursor CLI | No | Yes |
| Gemini CLI | No | Yes |

Each supported agent can be switched off on its own under the extension's card
in **Settings → Extensions**.

## App windows

Any agent with a Terminay MCP install target can show an app window, because
the window tools (`show_window`, `close_window`, `list_windows`) and the tools of
connected MCP servers are ordinary tools of the Terminay MCP server. Nothing is
agent-specific. What an agent must do is pass the terminal's environment to the
MCP server it starts, since the calling terminal is identified by
`TERMINAY_CONTROL_TOKEN`.

| Agent | `show_window` | Connected server tool with a view | Checked |
|---|---|---|---|
| Claude Code | Works | Works | 2.1.289, 2026-10-04 |
| Codex | Not checked | Not checked | The check could not run: the account was at its usage limit |

The other install targets have not been checked. Rerun the check with
`node scripts/app-windows-real-agents.mjs`.

## Where sessions appear

A live session appears in a project's Agents panel when its working directory
is the project root or below it, or inside a linked Git worktree of the
project's repository. A session whose process descends from a Terminay
terminal is bound to that terminal: it drives the tab's status dot, and
clicking its row focuses the terminal. A session running anywhere else on the
machine is marked **External** and its row takes no action.

## Tests

The library carries the conformance suites that prove its matrix against each
agent's on-disk formats. Terminay's own tests drive the library's fixture
drivers through the packed extension, the server's session-source bridge, and
the Electron end-to-end suite:

```sh
npm test -w terminay-builtin-agents
npm run test:e2e -- e2e/extension-agent-runtime.spec.ts
```
