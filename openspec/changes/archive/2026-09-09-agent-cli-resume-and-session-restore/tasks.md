## 1. Claude Code restore commands

- [x] 1.1 Bind `claude --resume` with no UUID once a root journal in the process CWD project directory is appended after process start, with `openFiles` empty. Verified by a unit test whose argv is `['--resume']` (no session id), that asserts a bind after the selected journal's mtime moves, and no bind while that journal is untouched.
- [x] 1.2 Bind `claude --continue` the same way. Verified by a unit test whose argv is `['--continue']` and `openFiles` returning `[]`.
- [x] 1.3 Keep explicit `claude --resume <uuid>` as the first rule. Verified by the existing UUID resume test still passing.
- [x] 1.4 Measure on a real `claude --resume` picker whether listed sessions are cwd-scoped. Record the measurement next to the binding rule. If a selected session is outside the CWD project directory, do not scan every project; leave it unbound unless argv carries the UUID. Verified by the written measurement and a test that a foreign project journal is not admitted from picker argv alone.

## 2. Codex restore commands

- [x] 2.1 Bind `codex resume --last` and `codex resume` (picker, after selection) without requiring an open writable rollout: admit an eligible CLI root under that process's sessions tree appended after process start. Verified by a unit test with argv `['resume', '--last']`, `openFiles` returning `[]`, and a rollout whose mtime is after `startedAt`.
- [x] 2.2 Bind `codex resume <id>` to that id's eligible rollout the same way. Verified by a unit test with that argv and empty `openFiles`.
- [x] 2.3 Leave a normal `codex` launch on the writer-held rollout rule. Verified by existing compound tests still passing.

## 3. Grok, OpenCode, Cursor, omp

- [x] 3.1 Grok: fixtures for `--continue` and `--resume` with no id, using the existing sessions / `active_sessions.json` association, `openFiles` matching what the real CLI holds. Verified by unit tests that bind those argv shapes.
- [x] 3.2 OpenCode: fixture for `--continue` and `--session <id>` against the writable store association. Verified by unit tests for both argv shapes.
- [x] 3.3 Cursor: fixtures for `--continue` and `--resume` with no chat id. Verified by unit tests that bind through the existing store.db association.
- [x] 3.4 omp: fixtures for `--continue` and `--resume` with no value (picker after selection) through the terminal breadcrumb. Verified by unit tests for both argv shapes.

## 4. Conformance gestures and matrix honesty

- [x] 4.1 Change each provider's conformance `resume()` to that CLI's documented restore command: Claude picker (`claude --resume` then select the just-quit session); Codex `codex resume --last`; Grok `grok --continue`; OpenCode `opencode --continue`. Verified by reading the descriptor files.
- [x] 4.2 Run each opt-in real-CLI conformance resume step. If it rebinds, leave Resume `Y`. If it does not, set that cell to `N` with the reason in the matrix and the descriptor. A skip SHALL NOT keep `Y`. Verified by the recorded run (pass or a written `N`) for Claude, Codex, Grok, and OpenCode.

## 5. Real-app coverage

- [x] 5.1 Extend `e2e/real-claude-code-agent-runtime.spec.ts` (still behind `TERMINAY_REAL_CLAUDE_CODE_E2E`) so after the first session is quit it types `claude --resume`, selects that session, and asserts the Agents row reappears as the same root, `done`, then working→done on further work. Verified by running that spec with the env var set.
- [x] 5.2 Add resume to the Codex real-app spec (`codex resume --last`) behind `TERMINAY_REAL_CODEX_E2E`. Verified by the spec existing and, when the env var is set, asserting the Agents row after resume — or by the matrix cell being `N` if 4.2 already proved it cannot bind.
- [x] 5.3 Do not treat the stub Grok e2e (`grok --resume <hardcoded uuid>` against a fake binary) as Resume proof. Either drive a real `grok --continue` behind an opt-in env var, or leave Grok Resume claimed only from the real-CLI harness in 4.2. Verified by the stub spec no longer being the only resume coverage, or by a comment in that spec stating it is not Resume proof.

## 6. Closeout

- [x] 6.1 `npx biome lint .` and the affected extension unit suites pass with the new fixtures and no env vars set (conformance still skips). Verified by those commands.
- [x] 6.2 Update `docs/agent-provider-capabilities.md` so Resume matches the matrix after 4.2. Verified by the table matching the spec matrix.
