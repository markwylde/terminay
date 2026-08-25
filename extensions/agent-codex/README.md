# Terminay Codex agent extension

`terminay-agent-codex` is Terminay's official Node.js extension for showing
Codex CLI activity in the Agents sidebar. It is an ordinary public extension:
it imports only `@terminay/extension-api` and runs with the selected Terminay
Server account's normal Node.js authority.

## Support

The initial mapping is `0.1`. It accepts Codex rollout journals written by the
CLI with a root `session_meta` record containing:

```json
{
  "originator": "codex-tui",
  "source": "cli"
}
```

Later Codex releases use mapping `0.1` optimistically until a fixture proves a
semantic divergence. The package recognizes the `codex` executable (and the
legacy `codex-cli` executable) on macOS and Linux. Unsupported platforms or
environments that cannot provide process/file observation simply leave normal
terminal activity enabled; they do not synthesize an agent session.

## Exact session binding

Codex journals are conventionally written beneath
`$CODEX_HOME/sessions` (or `~/.codex/sessions` when `CODEX_HOME` is unset).
The extension does **not** scan that directory, select the latest file, or use
a terminal cwd as identity. Instead it asks Terminay's terminal-scoped
observation broker for writable files held by descendants of the exact terminal
process. It accepts a `rollout-*.jsonl` file only when its first bounded record
is the eligible root metadata above, then binds that broker-issued file handle
as `writable-file-below-terminal-process`.

That makes new sessions, `codex resume`, and a foreground rebind work the same
way: the currently held root rollout is authoritative. If one Codex process
holds several eligible roots, the newest provider-reported modification wins;
the provider's modification order selects the active root. In-process Codex
subagent rollouts have a non-`cli` source and cannot replace the root.

For a local server the helper `effectiveCodexHome()` exposes the normal
`CODEX_HOME` rule. It is documentation/local-Node support only. Runtime
observation always uses the broker, so an SSH terminal never accidentally
reads the local server's home directory.

## Sidebar mapping

Only bounded, provider-neutral facts are published:

| Codex record | Sidebar result |
| --- | --- |
| root `session_meta` | `Codex` session title and model metadata |
| `task_started` / `turn_started` | root turn starts when a native turn id exists |
| completed `UserMessage` / legacy `user_message` | first user prompt becomes the root label |
| callable response item or `*_begin` / `*_end` | tool starts/finishes using native call ids |
| approval, permission, elicitation, or user-input request | waiting state |
| task/turn completion, error, abort, shutdown | root completion or session stop |
| collaboration spawn/wait/interaction/close/activity | named child start/completion lifecycle |

Older Codex user-message envelopes do not expose a stable native turn id. The
extension uses `agent.metadata` to set their root prompt rather than inventing
an identifier from text, time, or record order. The first prompt is retained
as the fallback session label. Codex's explicit session name is stored outside
the rollout in the selected terminal's `$CODEX_HOME/session_index.jsonl` (or
`~/.codex/session_index.jsonl`). While a rollout is bound, the extension
follows that index and uses only the matching `id` and bounded `thread_name`:
the initial value and every later rename update the existing sidebar root in
place. The title watcher follows replacement and truncation too, and cannot
create a second session or alter its lifecycle/child state. A subsequent
observable progress event finishes a previous wait. This is deliberately a
lifecycle projection, not a transcript.

Codex subagents use separate rollout journals. The extension uses the public
terminal-scoped, bounded sessions-directory API to admit an initial child and
to discover later children while the root remains live. A child is accepted
only when its native
`session_meta.source.subagent.thread_spawn.parent_thread_id` exactly equals the
bound root session id. Native child session ids de-duplicate directory
snapshots; nicknames, paths, timestamps, and display text never establish that
relationship. Child activity is projected beneath the existing root and never
rebinds or restarts it.

## Privacy

The extension reads only:

- the bounded root rollout metadata needed for session identity and CLI
  compatibility;
- the matching bounded `id` and `thread_name` from the terminal-scoped Codex
  session index; and
- the bounded native child header needed to prove an exact parent relationship;
- a bounded first user prompt; and
- allowlisted ids, tool names, model identifiers, effort labels, completion
  state, and collaboration labels.

It never publishes assistant responses, reasoning, image data, command
arguments, tool input/output, raw response items, or collaboration results.
Malformed, oversized, or future unknown records are ignored.

## Development and verification

```sh
npm run compile --workspace terminay-agent-codex
npm test --workspace terminay-agent-codex
npm run test:compat --workspace terminay-agent-codex
npm run test:packed --workspace terminay-agent-codex
```

The package tests use only the public `@terminay/extension-api/testing`
harness. `fixtures/v0.1/basic.jsonl` is the versioned compatibility fixture.
To opt into an authenticated local CLI smoke test, which may consume Codex
account usage, run:

```sh
TERMINAY_RUN_REAL_CODEX_CLI=1 npm run test:real-cli --workspace terminay-agent-codex
```

The smoke command invokes `codex exec` with a harmless exact-response prompt;
it does not alter this repository.

## Installation and troubleshooting

Codex ships built in, installed offline and enabled by default. Disable or
re-enable it in **Extensions** settings without changing Codex sessions. Start
or resume `codex` normally; a compatible npm release may override the bundled
floor. It requires Extension API 1.2, Node.js 22+, and the Codex 0.1 mapping.
If no row appears, verify foreground process and process/filesystem/journal
capabilities. SSH requires the target helper and otherwise fails closed.
