## 1. Extension API 3.0

- [x] 1.1 In `packages/extension-api`, add the `agentSessionSources` and `mcpInstallTargets` manifest types, runtime schemas, and bounds.
  - Session sources declare harnesses and environment variables. Snapshots carry the fields in the spec.
  - Add `context.agents.registerSessionSource` and `context.mcp.registerInstallTarget`.
  - The `mcp-registration` permission is required for install targets.
  - Verified by new schema unit tests for valid, oversized, undeclared-harness, and missing-permission cases.
- [x] 1.2 Delete the provider/observation surface: `agentProviders`, `registerProvider`, `observe`, the terminal context, the broker, `jsonlSession`/`notBound`/`unavailable`, the lifecycle publisher, the driver toolkit, and the observation adapters, with their tests. Bump the SDK to `3.0.0`.
  - Verified by `npm run build -w @terminay/extension-api`, and by `git grep` finding no remaining export of the removed names.
- [x] 1.3 Replace the testing entry with a session-source and install-target harness. Replace `third-party-agent-fixture` with a third-party session-source fixture package that packs, activates, and publishes.
  - Verified by `npm test -w @terminay/extension-api`.
- [x] 1.4 Regenerate the API reference docs for sources and targets.
  - Verified by the docs build or check script passing.

## 2. Installer and staging accept native modules

- [x] 2.1 In `packageValidation.ts`, accept `.node` files while still rejecting `binding.gyp` and required install scripts. Keep `--ignore-scripts`.
  - Verified by updated `extension-installer` tests: a fixture with a prebuilt `.node` installs, and one with `binding.gyp` is refused.
- [x] 2.2 Make `scripts/stage-built-in-extensions.mjs` stage `optionalDependencies`, and set `expectedIds` to `com.terminay.builtin-agents` and `com.terminay.language.typescript`. Add the prebuild-per-target check to release assembly.
  - Verified by `node scripts/stage-built-in-extensions.mjs`: the inventory lists koffi, and `verify-built-in-extension-artifacts.mjs` passes.

## 3. The built-in agents extension

- [x] 3.1 Create `extensions/builtin-agents`: `package.json` (`terminay-builtin-agents`, exact-pinned `@markwylde/all-your-agents`), manifest, tsconfig, LICENSE, and `.gitignore`. Update `extensions/builtins.json`, `turbo.json`, and the root `package.json` workspaces and scripts.
  - Verified by `npm install` and `npm run build -w terminay-builtin-agents`.
- [x] 3.2 Implement `src/source.ts`:
  - Map harness ids to library providers.
  - Collect catch-up into one reset on `ready`.
  - Upsert on session/subagent events; remove on `session:close`.
  - Publish only sessions with a `pid`.
  - Bound every string.
  - Restart the instance on an enabled-set change.
  - Stop on the signal.
  - Emit a typed diagnostic on library `error` and once for degraded process watch.
  - Verified by unit tests driving `createMemoryHarness` and the library fixture drivers through the SDK harness.
- [x] 3.3 Move `electron/mcpInstall/*` writers (with `atomicConfigWrite` and `tomlEntry`) into `src/mcp/` as six install targets that take the host-supplied command.
  - Verified by porting `scripts/mcp-install-providers.test.mjs`, `mcp-install-opencode.test.mjs`, and `mcp-install-cursor-gemini.test.mjs` to the extension package; all pass.
- [x] 3.4 Write the README: harnesses, pinned library version and its capability matrix, harness switches, snapshot fields and privacy exclusions, MCP targets and files, platform notes, and test commands.
  - Verified by review against the "Agent extension package documentation" requirement.
- [x] 3.5 Add packed-tarball conformance for the new package.
  - Verified by `npm pack` plus the conformance test against the tarball.

## 4. Server Core: session sources, scope, and binding

- [x] 4.1 Extension host: register and route session sources and install targets over IPC.
  - Pass declared environment variables into the child.
  - Deliver enabled-harness changes.
  - Re-publish on restart.
  - Verified by `extension-host` tests.
- [x] 4.2 Add `activity/sessionSourceBridge.ts`: snapshot validation, per-source flow control, snapshot→entry mapping, the `done`-after-creation-and-ack rule, and subagent children. Make root `terminalSessionId` optional; add `external` and `projectIds` to `AgentStatusEntry`.
  - Verified by bridge unit tests, one per scenario in "Session snapshot mapping to canonical state".
- [x] 4.3 Add `activity/projectAgentScope.ts`:
  - Canonical root prefix match.
  - `git worktree list --porcelain` through the server Git client.
  - A watch on the common-dir `worktrees/`, damped by `rampSchedule`.
  - Verified by tests with a temp repo: subdirectory, linked worktree outside the root, a worktree added later, an unrelated directory, and a non-Git project.
- [x] 4.4 Add pid→PTY ancestry binding: `/proc` on Linux, bounded `ps -o ppid=` walk on darwin, a per-pid cache, invalidation on PTY exit and re-check on foreground edges.
  - Verified by tests spawning a child under a fake PTY shell pid, plus a spawn-count assertion that nothing runs while idle.
- [x] 4.5 Delete `extensions/localAgentObservation.ts`, `activity/extensionAgentRuntime.ts`, the `child.ts` JSONL driver, and binding validation in `agentService.ts`, with their tests. Keep `rampSchedule.ts`.
  - Verified by `npm run build` and `npm test -w @terminay/server-core`.
- [x] 4.6 Add harness-switch settings (`agentIntegration.harnesses`) to server settings defaults and schema. Add D11 registry migration of the old disabled flags before `retireWithdrawnBuiltIns`. Update `catalog.ts` to the one agents package.
  - Verified by `extension-installer` tests: a registry with `com.terminay.agent.grok` disabled yields `grok` off and the old ids retired.
- [x] 4.7 Add `McpInstallRouter`, which routes `mcp-install.status|install|uninstall` to registered targets. Report `unavailable` when there is no MCP server command, and an empty/disabled state when there are no targets.
  - Verified by router unit tests and `scripts/canonical-application-feature-ipc.test.mjs`.

## 5. Desktop and standalone wiring

- [x] 5.1 In `electron/main.ts` / `serverTerminalAuthority.ts`, pass `getMcpServerCommand()` into the composition and route `mcp-install.*` to the router. Delete `electron/mcpInstall/`.
  - Verified by the Desktop build and `git grep mcpInstall/` finding only the extension.
- [x] 5.2 Wire session sources in `electron/serverTerminalAuthority.ts` and `apps/terminay-server/src/cli.ts` in place of the removed agent runtime.
  - Verified by `apps/terminay-server/test/agent-runtime.test.mjs`, rewritten to use a fixture session source.
- [x] 5.3 Point `Dockerfile.mcp-cli-compat` at the extension's install targets.
  - Verified by the MCP CLI compatibility job passing locally in Docker.

## 6. Renderer

- [x] 6.1 In `App.tsx`, filter Agents by entry `projectIds` instead of terminal-panel membership. `AgentsSidebar` shows an External badge and makes external rows inert. `agentPresentation` uses harness display names.
  - Verified by updated `agent-ui-components`, `agent-status-store`, and `task9-renderer-agent-client` tests.
- [x] 6.2 Exclude external entries from tab dots, project activity counts, and the header aggregate.
  - Verified by unit tests on `terminalTabAgentPresentation` and the header aggregate.
- [x] 6.3 Add per-harness switches under a session-source extension's card in `ExtensionManager.tsx`.
  - Verified by the component test, and by `e2e/settings.spec.ts` updated to expect `terminay-builtin-agents` with four switches.
- [x] 6.4 In `McpInstallModal`, key rows by target id and show a disabled-extension state when there are no targets.
  - Verified by the component test and an e2e check with the extension disabled.

## 7. Remove the old extensions, harness, and CI

- [x] 7.1 Delete `extensions/agent-{claude-code,codex,grok,omp,opencode}`, `tests/agent-conformance/`, `scripts/run-agent-conformance-container.sh`, and `.gitea/workflows/agent-conformance.yml`. Drop `test:agent-extension-compat` and `test:agent-extension-packages`.
  - Verified by `git grep -n "agent-claude-code\|agent-codex\|agent-grok\|agent-omp\|agent-opencode\|com.terminay.agent\."` returning only archived OpenSpec history.
- [x] 7.2 Update the scripts tests that hard-code the old ids: release-artifact contract, packaged startup smoke, packaged built-in runtime, local diagnostics, and canonical graph.
  - Verified by `npm test` at the root.

## 8. End-to-end

- [x] 8.1 Rewrite `e2e/extension-agent-runtime.spec.ts` around library fixture drivers with a test-only provider home, covering:
  - a session bound to a terminal, and two terminals of one harness
  - a resumed earlier session beside a live one
  - a subdirectory session, a linked worktree outside the root, an external session, and an unrelated directory
  - Verified by `npm run test:e2e -- extension-agent-runtime`.
- [x] 8.2 Delete `e2e/extension-grok-agent-runtime.spec.ts`, `real-claude-code-agent-runtime.spec.ts`, `real-codex-agent-runtime.spec.ts`, and `claude-code-multi-terminal.spec.ts`. Update `agent-status-sidebar.spec.ts` to the new source ids.
  - Verified by `npm run test:e2e`.
- [x] 8.3 Update the packaged built-in lifecycle matrix for the two built-ins.
  - Verified by `scripts/packaged-built-in-extension-runtime.test.mjs` passing in CI.

## 9. Specs, docs, and release gates

- [x] 9.1 Update `docs/agent-provider-capabilities.md` to point at the extension README matrix, and update `docs/product-overview.md` for the extension list.
  - Verified by review.
- [x] 9.2 Close or withdraw the open changes `claude-code-session-follows-cwd`, `omp-breadcrumb-cwd-identity`, and `omp-fresh-profile-wait-set`.
  - Verified by `openspec list` no longer showing them, and `openspec validate --all` passing.
- [x] 9.3 Resolve the library licence: Terminay is relicensed to AGPL-3.0-or-later, matching `@markwylde/all-your-agents`. The extension SDK stays MIT.
  - Verified by the root, CLI, and built-in extension `package.json` licence fields.
- [ ] 9.4 Open the pull request on Gitea with `tea`, and read back every commit status on the head SHA.
  - Verified by all statuses being `success` or `skipped`.
