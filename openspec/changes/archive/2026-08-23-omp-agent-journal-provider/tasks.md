## 1. Provider identity and chrome

- [x] 1.1 Add `"omp"` to `AGENT_PROVIDERS` and every mirrored client and UI union, verified by the type and union tests
- [x] 1.2 Display the provider as `omp` and replace hardcoded Codex/Claude ternary labels with a provider map
- [x] 1.3 Keep MCP install clients unchanged

## 2. Foreground and journal bind

- [x] 2.1 Match foreground `omp`, and `oh-my-pi` where that argv appears, verified by the foreground matcher tests
- [x] 2.2 Reuse the existing leave-shell discovery window so a `bun` wrapper can still begin OMP discovery
- [x] 2.3 Resolve the sessions root from `~/.omp/agent/sessions` plus `PI_CODING_AGENT_DIR`, `OMP_PROFILE`, `PI_PROFILE`, and XDG, adding an `ompHome` test override beside `claudeHome` and `codexHome`
- [x] 2.4 Skip the 256-byte title slot before inspect and require `type === "session"` with a stable `id`, so a physical `type: "title"` line is never treated as Codex `session_meta`
- [x] 2.5 Derive OMP's terminal id from the exact PTY TTY and resolve the matching bounded terminal breadcrumb under the effective OMP root
- [x] 2.6 Validate breadcrumb cwd, path, and `fresh` fields and admit only a materialized root JSONL below an allowed sessions root, never using newest mtime or encoded cwd alone
- [x] 2.7 Admit only encoded-cwd root `*.jsonl` files as roots and treat nested `<parent-stem>/*.jsonl` files as children
- [x] 2.8 Recheck the breadcrumb while OMP remains foreground, rebind on session switch, and tail atomic JSONL replacements as well as shrink and reset

## 3. Driver `(omp, 0.1)`

- [x] 3.1 Read the logical session header rather than the title slot in `inspectSession`
- [x] 3.2 Map the session header to `session.started`
- [x] 3.3 Map the first user-facing `message.role === "user"` to `turn.started` and the stable bounded root label
- [x] 3.4 Map `customType: "tool_execution_start"` to `tool.started`
- [x] 3.5 Map assistant tool results and matching tool calls to `tool.finished`
- [x] 3.6 Map a completed assistant tail or terminal `stopReason` to `agent.done`
- [x] 3.7 Map `session_exit` to `session.stopped`, marking it interrupted when pending tools remain
- [x] 3.8 Map child JSONL to `subagent.started` and `subagent.stopped`
- [x] 3.9 Ignore unknown types and project no tool args, assistant text, or tool output

## 4. Fixtures and tests

- [x] 4.1 Add `packages/server-core/test/fixtures/omp/v0.1/basic.jsonl` with title slot, session header, user message, tool start, tool result, assistant completion, and session_exit
- [x] 4.2 Add a child-journal fixture and a title-slot-only reject fixture
- [x] 4.3 Add driver tests for the mapping above and for unknown-record ignore
- [x] 4.4 Add journal tests for same-cwd two-TTY breadcrumb isolation, title-slot skip, fresh/missing and malformed breadcrumb rejection, session switch, atomic replacement, and child files not being roots
- [x] 4.5 Keep the existing Codex and Claude Code tests green

## 5. Acceptance checks

- [x] 5.1 Verify ordinary `omp` in a Terminay terminal needs no extra flags, hooks, or MCP
- [x] 5.2 Verify that after the first assistant persist the sidebar shows an `omp` root bound to that exact terminal
- [x] 5.3 Verify a user message and an unmatched `tool_execution_start` yield working, a completed assistant with no pending tools yields done/idle, and `session_exit` with pending tools yields interrupted rather than still-live
- [x] 5.4 Verify two `omp` terminals in the same cwd do not share a row
- [x] 5.5 Verify a `bun`-named process is shown only when its exact PTY TTY has a valid OMP breadcrumb target
- [x] 5.6 Verify a fresh, pre-file `omp` does not steal another session and remains on terminal-activity fallback until its breadcrumb target materializes
- [x] 5.7 Verify disabling agent status does not touch `~/.omp`
- [x] 5.8 Verify no oh-my-pi source changes were made
