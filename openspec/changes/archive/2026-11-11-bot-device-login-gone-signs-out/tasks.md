## 1. Extension contract

- [x] 1.1 Add optional `deviceSignIn.statusCommand` to `BotAgentDeviceSignIn` and its manifest validation in `packages/extension-api/src/bots.ts`. Verified by the extension-api test suite and typecheck.
- [x] 1.2 Declare `codex login status` and `claude auth status` in `extensions/builtin-agents/package.json`. Verified by running each in the bot image signed out (exit 1) and in a signed-in Codex bot (exit 0), and by the builtin-agents test suite.

## 2. Server check

- [x] 2.1 In `BotService.runNow`, after writing device config files, run the status command as `bot` with `HOME=/home/bot`. On a non-zero exit, set the bot Not signed in and refuse with the Sign-in guidance before the agent starts. Verified by the new `bot-composition` test for a missing device login.

## 3. Verification

- [x] 3.1 Run the server-core, extension-api and builtin-agents test suites. Verified by each suite's output.
- [x] 3.2 Run `openspec validate --all`, `npm run lint`, and `npm run typecheck`. Verified by each command's output.
- [ ] 3.3 Pull request checks green. Verified by reading back every commit status on the head SHA.
