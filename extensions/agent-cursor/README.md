# Terminay Cursor Agent extension

The official [Cursor Agent CLI](https://cursor.com) provider for the Terminay
Agents sidebar. It is an ordinary Node.js npm package: it imports only
`@terminay/extension-api` and public Node APIs, and can be installed, disabled,
updated, and tested like a third-party extension.

## What it observes

The extension supports Cursor Agent CLI on macOS and Linux. It recognizes the
foreground `agent` / `cursor-agent` executable and Cursor's versioned bundled
Node worker. Recognition starts a bounded observation attempt; it is not a
session match by itself.

Cursor stores each chat at:

```text
~/.cursor/chats/<workspace-hash>/<session-uuid>/
├── store.db
└── meta.json
```

Terminay binds the session only if a process below the exact terminal's PTY
holds that exact `store.db` open for writing. The extension validates the
canonical file below `~/.cursor/chats`, derives the UUID from its path, reads
the bounded `meta.json` sibling, canonicalizes its `cwd`, and follows only the
corresponding transcript:

```text
~/.cursor/projects/<canonical-cwd-key>/agent-transcripts/<session-uuid>/<session-uuid>.jsonl
```

The title, cwd, file name, or latest transcript are **not** treated as identity
evidence. The writable descriptor is required. The extension refreshes the
bounded session title and the read-only `lastUsedModel` field from the Cursor
store while the session is active.

## Sidebar mapping

| Cursor data | Terminay lifecycle projection |
| --- | --- |
| Session `meta.json.title` | session title; fallback is the user prompt |
| `meta.lastUsedModel` | model id and display label, for example `Grok 4.6` |
| User record | root session and user turn |
| Assistant record | root turn activity only |
| `turn_ended` | success, error, or cancelled completion |

Cursor wraps a CLI prompt with `<timestamp>` and `<user_query>`. The extension
uses only the bounded content inside `<user_query>`; a non-wrapped text record
is the fallback prompt.

## Privacy

Only session UUID, bounded title/model metadata, bounded user prompt text, and
completion status cross the extension host boundary. The extension never
publishes assistant text, reasoning, tool arguments, tool results, filesystem
paths, cwd, credentials, the SQLite store, or raw transcript records.

## Known limitation: subagents

Cursor can invoke subagents, but current transcript records do not expose both
a stable child identity and a reliable matching completion record. This
extension deliberately does not infer child rows: guessing from titles, order,
or timing would leave stale or incorrectly-completed sidebar agents. The root
session remains fully tracked.

## Local versus remote environments

The terminal observation API verifies the process-bound `store.db` descriptor.
Cursor's adjacent metadata and derived transcript are read via public Node APIs
on the selected Terminay Server account. Consequently this version supports
local Cursor files only. An SSH environment needs public sibling-file and
SQLite observation operations before its remote Cursor sessions can be made
equally authoritative; the provider returns no binding rather than matching a
local or newest session incorrectly.

## Development and verification

```sh
npm run compile --workspace terminay-agent-cursor
npm test --workspace terminay-agent-cursor
npm run test:compat --workspace terminay-agent-cursor
npm run test:packed --workspace terminay-agent-cursor
```

The real CLI command is intentionally opt-in because it sends one trusted
prompt through your authenticated Cursor account:

```sh
npm run test:real-cli --workspace terminay-agent-cursor
```

Fixtures live under `fixtures/cursor/v0.1`. The packed-package test ensures the
published package contains only its public runtime, fixtures, and documents.

## Installation and troubleshooting

Cursor ships built in, installed offline and enabled by default. Disable or
re-enable it in **Extensions** settings without changing sessions. Start
`agent`, use its picker, or run `agent --resume=UUID`; a compatible npm release
may override the bundled floor. It requires Extension API 1.1, Node.js 22+, and
the Cursor 0.1 mapping. For stale metadata, confirm the process still owns its
bound `store.db`. Remote Cursor remains unavailable until its adapter can prove
and follow the same files. Set `TERMINAY_CURSOR_AGENT_REAL=1` only for the
opt-in authenticated smoke, which may consume account usage.
