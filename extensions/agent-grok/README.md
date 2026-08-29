# Terminay Grok agent extension

`terminay-agent-grok` is Terminay's official Node.js extension for showing
Grok CLI activity in the Agents sidebar. It is an ordinary public extension:
it imports only `@terminay/extension-api` and runs with the selected Terminay
Server account's normal Node.js authority.

## Support

The initial mapping is `0.1`. It accepts Grok CLI event journals written under
`$GROK_HOME/sessions` (or `~/.grok/sessions` when `GROK_HOME` is unset). Later
Grok releases use mapping `0.1` optimistically until a fixture proves a
semantic divergence.

The package recognizes the `grok` executable (and `grok-*` launcher names) on
macOS and Linux. It does **not** match the `agent` executable: that name is
already used by Cursor Agent, even though Grok ships an `agent` symlink.
Unsupported platforms or environments that cannot provide process/file
observation leave normal terminal activity enabled.

## Exact session binding

Grok writes one session directory per conversation:

```
$GROK_HOME/sessions/<urlencoded-cwd>/<session-uuid>/events.jsonl
```

The extension does **not** scan that directory, select the latest file, or use
a terminal cwd as identity. Instead it asks Terminay's terminal-scoped
observation broker for writable files held by descendants of the exact terminal
process. It accepts an `events.jsonl` file only when the host canonicalizes that
writable handle and the path-derived UUID is well-formed. A missing `HOME` or
`GROK_HOME` process environment (common for macOS login shells) cannot prevent
that writer proof. If the process is not holding the journal, Grok's
`active_sessions.json` registry still binds when a descendant pid matches a
live `{session_id, pid}` row. CWD in that file is never identity. A journal
whose first `turn_started` record reports a `session_relationship` other than
`primary` is not an eligible root. When one
writer holds several eligible roots, the newest provider-reported modification
wins.

For a local server the helper `effectiveGrokHome()` exposes the normal
`GROK_HOME` rule. It is documentation/local-Node support only. Runtime
observation always uses the broker, so an SSH terminal never accidentally
reads the local server's home directory.

## Sidebar mapping

Only bounded, provider-neutral facts are published:

| Grok record | Sidebar result |
| --- | --- |
| first primary `turn_started` | `Grok` session title and model metadata, then a turn starts |
| later `turn_started` | corresponding turn |
| sibling `summary.json` `generated_title` / `session_summary` | root title, refreshed while bound |
| `tool_started` / `tool_completed` | tool start/finish using a session-local ordinal; Grok omits a native call id on start |
| `permission_requested` / `permission_resolved` | waiting, then resume working |
| `mcp_tool_call_started` / `mcp_tool_call_completed` | tool start/finish using native `call_id` |
| `turn_ended` | successful, cancelled, or error completion |

A resumed Grok TUI sitting at the prompt is `done` when the journal's latest
lifecycle record is `turn_ended`. MCP reconnect records after that turn are
ignored. The events journal is followed to its last complete JSONL line. The
sibling `summary.json` is followed for title/model; a hanging summary watcher
cannot stall replay of a long session.

`chat_history.jsonl`, `updates.jsonl`, signals, memtrace, assistant text,
reasoning, and tool payloads never cross the extension host. Mapping `0.1`
does not project `spawn_subagent` as child agents: Grok does not persist a
writer-held child journal with a native parent id.

## Development and verification

```sh
npm run compile --workspace terminay-agent-grok
npm test --workspace terminay-agent-grok
npm run test:compat --workspace terminay-agent-grok
npm run test:packed --workspace terminay-agent-grok
```

The package tests use only the public `@terminay/extension-api/testing`
harness. `fixtures/v0.1/basic.jsonl` is the versioned compatibility fixture.
To opt into a local CLI smoke test:

```sh
TERMINAY_RUN_REAL_GROK_CLI=1 npm run test:real-cli --workspace terminay-agent-grok
```

The smoke command only checks `grok --version`. It does not start a session or
consume account usage.

## Installation and troubleshooting

Grok ships built in, installed offline and enabled by default. Disable or
re-enable it in **Extensions** settings without changing Grok sessions. Start
or resume `grok` normally. Quitting the CLI removes the Agents row; a later
`grok --resume` in the same terminal binds again once the new process holds
`events.jsonl`. If no row appears, verify the foreground process is `grok`
(not `agent`) and that process/filesystem/journal capabilities are available.
SSH requires the target helper and otherwise fails closed.
