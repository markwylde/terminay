## 1. Server-core

- [x] 1.1 Add `commandPasteInput`, `SUBMIT_INPUT`, `TERMINAL_KEYS`, and
      `writeSeparatedInput` to `commandSubmission.ts`, pausing between writes
      only. Verified by `terminal-command-submission.test.mjs`.
- [x] 1.2 Give `writeSeparatedInput` a terminal key that queues submissions per
      terminal, and an `AbortSignal` checked before each write; stop on the
      first failed write. Verified by `terminal-command-submission.test.mjs`:
      concurrent submissions do not interleave, cancellation during the pause
      writes nothing more, a failed write stops the rest and releases the
      queue.
- [x] 1.3 Write window messages and workflow launch and resume text with the
      helper. Verified by `app-windows-composition.test.mjs` and
      `workflow-composition.test.mjs`, launch and resume, expecting the paste
      and `\r` as separate writes.
- [x] 1.4 Key those composition writes by terminal session.

## 2. MCP

- [x] 2.1 Standalone `write_terminal` and `run_command` use the helper;
      `write_terminal` presses `keys` and accepts no text. Verified by
      `terminal-adapter.test.mjs`.
- [x] 2.2 Parse `keys`, refuse empty, unknown-key, and over-64 calls before any
      write.
- [x] 2.3 Pass the operation signal and the terminal key from both hosts.
      Standalone verified by `terminal-adapter.test.mjs` (ordering, byte
      counts, `keys: ["Enter"]`, 65 keys, cancellation); embedded Desktop
      verified by `npx tsc --noEmit -p tsconfig.json`, as it shares the helper.
- [x] 2.4 `write_terminal` tool schema and description.

## 3. Verification

- [x] 3.1 Record the Claude Code reproduction in
      `openspec/adr/evidence/agent-cli-enter-submission/`.
- [x] 3.2 `openspec validate agent-safe-terminal-submit --strict`.
- [x] 3.3 `npm run lint`, `npx tsc --noEmit -p tsconfig.json`,
      `npm run typecheck:workspaces`, and, after
      `npx turbo run build --filter=@terminay/server...`, the server-core and
      terminay-server suites with
      `node --test --test-force-exit --test-timeout=120000`, all exit zero.
- [ ] 3.4 Open the pull request and read back green CI statuses.
