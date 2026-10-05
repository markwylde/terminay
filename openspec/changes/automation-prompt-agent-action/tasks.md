## 1. Server-core

- [x] 1.1 Add the `promptAgent` action to `AutomationAction` and a
      `launchesRunTerminal(action)` predicate; replace the `runCommand` tests
      that mean "launches its own terminal" with it. Verified by typecheck.
- [x] 1.2 Normalize `promptAgent` (command and prompt required, prompt ≤ 32 KiB,
      no NUL, shared shell / cwd / duration rules). Verified by
      `automation-service` tests for accept, empty prompt, oversize prompt.
- [x] 1.3 Launch it through the run-command path with `PROMPT` in the run's
      environment (and `WSLENV` under WSL), replacing an inherited value.
      Verified by `automation-executor` tests: `PROMPT` equals a multi-line
      prompt with metacharacters; a `runCommand` launch sets none.
- [x] 1.4 Render the prompt in the MCP definition view and accept the kind in
      run-now. Verified by `automation-mcp` and `automation-protocol` tests.

## 2. Clients

- [x] 2.1 Add the kind to `@terminay/client-core` types and state validation.
      Verified by typecheck and the client-core tests.
- [x] 2.2 Add "Prompt an agent" to the editor model and form: Command, a
      multi-line Prompt, and the shared rows; show the prompt in the list
      detail. Verified by `scripts/automations-model.test.mjs` round-tripping
      form ↔ definition.
- [x] 2.3 Describe the kind in the MCP `create_automation` /
      `update_automation` tool text. Verified by the stdio tool-list test.

## 3. Verification

- [x] 3.1 `openspec validate automation-prompt-agent-action --strict`.
- [x] 3.2 `npm run lint`, `npm run typecheck`, and the touched unit suites exit
      zero.
- [ ] 3.3 An e2e case in `e2e/automations-ui.spec.ts` creates a prompt-agent
      automation that prints `"$PROMPT"`, runs it now, and reads the
      prompt back from the run output. Verified by `npm run test:e2e`.
- [ ] 3.4 Open the pull request on `origin` and read back green CI statuses.
