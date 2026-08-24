# Terminay Claude Code agent extension

`terminay-agent-claude-code` is Terminay's official public extension for
showing Claude Code CLI sessions in the **Agents** sidebar. It is an ordinary
ESM Node.js package: it uses only `@terminay/extension-api` and Node.js, and
does not import Terminay Server Core, Electron, renderer code, or host-private
bridges.

## Compatibility

The package currently supports the Claude Code project-session JSONL schema
observed in Claude Code `2.1.x` through mapping version `0.1`, on macOS and
Linux. Unsupported platforms or project environments without process and
agent-journal observation remain ordinary terminal activity; they do not
produce a guessed agent binding.

## What it observes

When `claude` is the terminal foreground process, Terminay supplies a
terminal-scoped list of files held writable by that terminal's descendant
process tree. This extension accepts a candidate only when the host can
canonicalize it beneath `~/.claude/projects`, it is a JSONL file, and its first
record proves the root `sessionId`. Claude sidechain/subagent journals are
rejected as root candidates.

This is intentionally stronger than choosing the newest file, a matching cwd,
or a title. If the process tree holds more than one eligible root journal, the
extension declines to bind rather than guessing. Re-observation lets Terminay
rebind after Claude switches from a new session to a resumed session.

For `claude --resume <UUID>` (or `-r`), it also uses the exact UUID from the
foreground command and that Claude process's observed cwd to derive the one
provider-owned `~/.claude/projects/<project>/<UUID>.jsonl` path. The public
environment-scoped resolver returns an opaque handle only if the file exists
beneath that root; its first record must still prove the same non-sidechain
UUID. This works before Claude opens the resumed journal for writing and works
through an environment such as SSH without local filesystem scanning.

## Lifecycle mapping

Only these bounded provider fields are mapped:

| Claude record | Terminay lifecycle fact |
| --- | --- |
| `permission-mode` | session started (`Claude Code`) |
| `ai-title.aiTitle` | session title metadata |
| non-meta user text | turn started with a safe prompt preview |
| assistant `model` | model metadata |
| assistant tool use | tool started |
| `AskUserQuestion` | waiting for input |
| `Agent` tool use | child agent started |
| user `tool_result` | tool finished |
| assistant `end_turn` / `turn_duration` | agent done successfully |

Native Claude IDs are retained for tools, user turns, assistant turns, waits,
and child agents. The `Agent` child title comes from `description` or
`subagent_type`; its prompt preview is bounded. Claude's current root journal
does not contain stable child-completion evidence, so this package does not
invent child completion events.

## Privacy

The extension never publishes assistant text, tool input, tool output, command
arguments, local-command metadata, credentials, provider raw records, or
sidechain journals. A non-meta user text preview and the bounded `Agent`
prompt preview are the only prompt-bearing fields that cross the extension
boundary. Records such as `<command-name>…</command-name>` are ignored.

## Development

```sh
npm run build --workspace terminay-agent-claude-code
npm test --workspace terminay-agent-claude-code
npm run test:compat --workspace terminay-agent-claude-code
npm run test:packed --workspace terminay-agent-claude-code
```

The unit suite uses only the public extension testing harness. The packed test
inspects the actual npm tarball, not workspace source imports.

For an opt-in check of an already authenticated local CLI:

```sh
TERMINAY_TEST_REAL_CLAUDE_CODE=1 npm run test:real --workspace terminay-agent-claude-code
```

That command only invokes `claude --version`; it creates no session and makes
no project changes. A live smoke is to start `claude` in one Terminay terminal,
then resume the session in that same terminal and confirm the sidebar follows
the exact session.

## Installation and troubleshooting

Claude Code ships built in, installed offline and enabled by default. Disable
or re-enable it in **Extensions** settings without changing Claude journals.
Start `claude` or `claude --resume UUID` normally; a compatible npm release may
override the bundled floor. It requires Extension API 1.1, Node.js 22+, and the
Claude Code 2.1.x/0.1 mapping. If no row appears, verify foreground command,
resume UUID, and observation capabilities. Remote environments require
equivalent canonical file observation and otherwise fail closed.
