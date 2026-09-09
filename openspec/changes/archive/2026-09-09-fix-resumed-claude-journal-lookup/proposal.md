## Why

A terminal running `claude --resume <id>` in a directory other than the one the conversation started in never shows an agent. The Agents sidebar simply omits it, with no indication that anything is wrong, and it never recovers.

The diagnostics added by the extension-host change name the cause exactly. For that terminal the records read `matched` → `admitted (not-bound)` → `released`, once per bundled provider, until discovery gives up:

```
05:47:23 claude-code  admitted  not-bound
05:47:45 claude-code  admitted  not-bound
05:48:12 claude-code  admitted  not-bound   ← retries exhausted
```

The session file is entirely healthy: its pid, cwd, and start time all match the live process, and it names the conversation the process holds. What is missing is the journal. The provider derives `<encoded cwd>/<sessionId>.jsonl` below `.claude/projects`, but Claude Code keeps writing a resumed conversation's journal in the project directory where that conversation **originated**. A conversation started in one worktree and resumed in another is therefore live at a path the provider never looks at:

| | |
| --- | --- |
| Provider derives | `.claude/projects/<resumed cwd>/<id>.jsonl` — does not exist |
| CLI is writing | `.claude/projects/<origin cwd>/<id>.jsonl` — 17 MB, growing |

Resuming a conversation in a worktree is ordinary practice in this project, so this silently costs agent observation on exactly the terminals that are doing the most work.

## What Changes

- The Claude Code provider resolves a bound session's journal by session id rather than by cwd alone. The derived path stays the first and usual answer; when no journal exists there, the provider makes one bounded search for `<sessionId>.jsonl` below `.claude/projects` and accepts a match only when the journal's own first record names the same session.
- An ambiguous result binds nothing. If the bounded search cannot single out one journal for that session id, the terminal reports `not-bound` exactly as it does today.
- The search is bounded and fails closed. If host listing limits truncate the snapshot before the journal is found, the terminal stays unbound and ordinary discovery retries later; no partial or guessed binding is ever published.
- A conversation switch inside a live session resolves its new journal the same way, so a `/resume` onto a conversation from another directory relabels the row instead of stalling on the old one.

## Capabilities

### New Capabilities

_None. This change corrects existing behaviour._

### Modified Capabilities

- `agent-status-and-sidebar`: Claude Code's terminal identity evidence resolves a journal by the session id its process names, not only by the encoded working directory, so a conversation resumed in another directory still binds.

## Impact

- `extensions/agent-claude-code/src/provider.ts` — journal resolution for the initial binding and for an in-session conversation switch.
- `extensions/agent-claude-code/src/resume.ts` — the path derivation helpers this uses.
- `extensions/agent-claude-code/test/` — fixtures covering a resumed conversation, an ambiguous match, and a truncated listing.
- No change to the session-file binding rule, the extension API, the host, or any renderer surface. No new dependencies.
