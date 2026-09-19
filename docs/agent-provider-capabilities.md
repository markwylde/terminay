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
