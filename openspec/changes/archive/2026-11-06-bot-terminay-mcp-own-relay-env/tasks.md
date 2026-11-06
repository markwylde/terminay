## 1. Adapter

- [x] 1.1 Add `--terminay-mcp` to `docker/terminay-bot/bin/terminay-bot-mcp`. It reads `TERMINAY_MCP_SOCKET` and `TERMINAY_MCP_TOKEN`, and works with or without a check flag. The adapter parses its arguments before connecting. Without the flag it reads the runtime pair. Verify that:
  - unknown arguments are refused before any connection;
  - a missing or invalid selected pair exits without connecting, even when the other pair is valid.

- [x] 1.2 Make `terminay-tool-shell` admit the exact `terminay-bot-mcp --terminay-mcp` launch, in its plain and quoted forms. It unsets the runtime pair before exec, and the bare runtime launch unsets the `terminay` pair. Remove `TERMINAY_MCP_TOKEN` from ordinary tool commands in `terminay-tool-shell`, `terminay-shell-env` and `terminay-source`. Verify that the exact forms launch and that other forms and extra arguments are still refused.

## 2. Bridge and launcher

- [x] 2.1 In `runtimeBridge.ts`, give the `terminay` server `args: ['--terminay-mcp']` and env `TERMINAY_MCP_SOCKET` and `TERMINAY_MCP_TOKEN`. Add that pair to the execution `environment` only while the relay is up. After the relay is ready, probe `terminay-bot-mcp --terminay-mcp --check-runtime`. If the probe fails, close the relay and write "rebuild the bot image" to Runner output. Verify that the runtime server entries are unchanged, and that a bot without access gets neither the server nor the pair.
- [x] 2.2 In `native.ts`, treat the `TERMINAY_RUNTIME_*` and `TERMINAY_MCP_*` names as forwarded secrets. Strip them from each server's literal env, and write Codex `env_vars` from each server's own forwarded names. Verify that neither the argv nor the Claude Code MCP JSON contains a secret value.

## 3. Tests

- [x] 3.1 Add `nativeArguments` tests for Codex and Claude Code with a runtime and a `terminay` server. Verify that:
  - each Codex server's `env_vars` names only its own pair;
  - no secret appears in argv;
  - the Claude config has no `TERMINAY_*` values.
- [x] 3.2 Add a joined regression in `packages/server-core/test/bot-terminay-relay.test.mjs`. It takes the real `openBotRuntimeBridge` output with access on, passes it through `nativeArguments` for each driver, and launches each declared server with the real adapter:
  - Codex gets only its `env_vars`;
  - Claude Code gets the whole agent environment.
  
  Verify that `tools/list` returns workspace tools from `terminay` and runtime tools from `terminay_bot`.
- [x] 3.3 Add adapter negative tests in the same file. Verify that:
  - each pair, missing or malformed while the other is valid, exits without connecting;
  - the pre-change adapter, kept as `test/fixtures/terminay-bot-mcp-before-selection.py`, gets nothing dispatched on the runtime relay.
- [x] 3.4 Add a `bot-image.test.mjs` case. Verify that the image fingerprint changes when a file under `docker/terminay-bot/bin` changes.
- [x] 3.5 Update `bot-terminay-relay.test.mjs`, `bot-runtime-bridge.test.mjs` and `bot-terminay-mcp-access.test.mjs` for the new server entry. Verify that the `terminay` entry has `--terminay-mcp` and the `TERMINAY_MCP_*` names, and that every suite passes.

## 4. Verification and finish

- [x] 4.1 Run `npm run typecheck`, `npm run lint`, and the server-core and terminay-server tests. Verify that all of them pass.
- [x] 4.2 Run `openspec validate --all` and `/openspec-verify-change`. Verify that both are clean for this change.
- [x] 4.3 Archive the change and run `openspec validate --all --archived`. Verify that the main spec contains the new delivery scenarios.
- [x] 4.4 Open the Gitea PR and read back every commit status on the head SHA. Verify that all of them are `success` or `skipped`.
