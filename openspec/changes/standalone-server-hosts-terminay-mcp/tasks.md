Every build, test and Docker command below runs under `timeout <seconds>`. Node
tests always use `node --test --test-force-exit --test-timeout=120000`.

## 1. Server Core: no opt-outs

- [x] 1.1 Remove the `mcpApprovals` option from `ServerCoreCompositionOptions`; always construct `McpApprovalService`. Verify: server-core type-checks with no reference to `options.mcpApprovals`.
- [x] 1.2 Make app windows and the workspace view relay always composed, with `appWindows` options as optional configuration (attachment directory defaults to a server-owned temp directory). Verify: a composition built with no `appWindows` option exposes `composition.appWindows` and `composition.workspaceView`.
- [x] 1.3 Always advertise `mcp-approvals.v1`, `workspace-view.v1`, `app-windows.v1`, `app-window-mirror.v1`, `app-window-attachments.v1`. Verify: a server-core test asserts all five in the capabilities of a minimally composed server.
- [x] 1.4 Update server-core tests that composed without approvals or app windows. Verify: `timeout 600 npx turbo run build --filter=@terminay/server-core...` then the package's bounded test run passes.

## 2. Shared MCP host module

- [x] 2.1 Create `apps/terminay-server/src/mcp/host.ts` with `createMcpHost(options)` (`dataRoot`, placement inputs, `serverCommand`, `clientVersion`, `homeDirectory`, `initialSettings`, `onSettingsChange`, `openTerminal`, optional digest load/save; placement failure rejects `bind()`), the `McpHostServer` interface, and the pre-composition outputs (`terminalLaunchEnvironmentFor`, `agentChatMcp`, `botTerminayMcp`, terminal exit and move hooks). The constructor applies `initialSettings` before returning. Verify: it type-checks and is exported from `apps/terminay-server/src/index.ts`.
- [x] 2.2 Move capability persistence, restore and prune, placement resolution, `applyMcpSetting`, endpoint start and stop, approval revocation on capability revoke, and `bindMcpGateway` from `electron/main.ts` into the host. `stop()` unsubscribes persistence before revoking. Verify: no `createControlEndpoint`, `new ControlCapabilityStore` or `new ConnectedServerGateway` remains in `electron/main.ts`.
- [x] 2.3 Move every `createDesktopMcp*Adapter`, the permission gate, `describeMcpRequest`/`describeMcpOperation`, `desktopMcpToolAvailability` and the `mcp*` helpers into the host. Replace `createServerOwnedTerminalSession` with `options.openTerminal`, `embeddedServerId` with the bound server id, and the launch path authority's home directory with `options.homeDirectory`. Verify: `grep -n "createDesktopMcp\|requireMcpAuthority" electron/main.ts` returns nothing.
- [x] 2.4 Host unit tests against a fake `McpHostServer`: minting on launch, revocation on exit, setting off revokes and ends windows, `initialSettings` disabled means nothing is minted until re-enabled, placement failure rejects `bind()`, a bot execution gets MCP only when opted in and while MCP is on, and persistence restores a retained terminal, drops an ended one, restores nothing from a corrupt file, and is not emptied by `stop()`. Verify: the test file passes under the bounded flags.
- [x] 2.5 Electron-free import check: a test imports the built host module from `apps/terminay-server/dist` in plain Node. Verify: it passes, and `grep -rn "from 'electron'" apps/terminay-server/src` returns nothing.

## 3. Desktop composes the host

- [x] 3.1 Replace the removed code in `electron/main.ts` with one `createMcpHost` call (Desktop paths, Electron-run MCP entry command, `createServerOwnedTerminalSession` as `openTerminal`, launch-recovery placement reporting and diagnostics) and `bind`/`stop` at the existing lifecycle points. Verify: `timeout 900 npm run typecheck` passes.
- [x] 3.2 Remove `mcpApprovals` from `electron/serverTerminalAuthority.ts` and take the five capabilities from the composition instead of re-deriving them. Verify: typecheck passes and the authority's advertised capabilities include all five.
- [ ] 3.3 Keep Desktop behaviour unchanged. Verify: existing Desktop MCP unit tests pass, and `timeout 3600 npm run test:e2e` (Docker-isolated) passes the MCP, approvals and app-window specs.

## 4. Standalone server composes the host

- [x] 4.1 In `apps/terminay-server/src/cli.ts`, create the host with the data root, initial settings, and `process.execPath` plus `fileURLToPath(new URL('./mcpEntry.js', import.meta.url))` as the server command. Pass its outputs into `createServerComposition` and its `botTerminayMcp` into `createBotServerService`. Verify: a terminal launched by the CLI has `TERMINAY_CONTROL_SOCKET` and `TERMINAY_CONTROL_TOKEN` set.
- [x] 4.2 Compose connected servers (`<dataRoot>/mcp-connected-servers.v1.json`, standalone vault), the app-window store directory under the data root, the MCP install router with the server command, and `openTerminal` through the same Server Core launch path as `terminal.create`. Verify: the install router reports targets with the absolute entry path as the command.
- [x] 4.3 Resolve MCP placement before the Git command socket. Bind and start the host after composition; stop it on shutdown. On placement failure print the placement message to stderr and exit non-zero. Verify: a CLI test with an over-long data root and a usable runtime directory starts; one with an over-long data root and an over-long runtime directory exits non-zero with the MCP placement message and no token in output.
- [x] 4.4 Standalone integration test over the real socket, using the exact registered command (Node plus absolute `mcpEntry.js`) with the inherited env: `list_terminals` works; `open_terminal` adds a terminal with a panel; `create_project` from a project terminal is refused as out of scope; an Ask First tool waits for approval; a Never Allow tool is refused; a terminal outside the capability's reach is refused before any prompt; a token the server inherited is never passed to its terminals; `focus_tab` with no client fails with `renderer_unavailable`. What cannot be driven through MCP alone from a project terminal is covered by the host test (2.4) against the real approval service: disabling MCP cancels a pending request, and a project move follows without widening reach. The five capabilities being advertised is covered by the Server Core composition tests (1.4). Verify: both test files pass under the bounded flags.
- [x] 4.5 Standalone bot wiring: the CLI passes the host's `botTerminayMcp` to `createBotServerService`, and the host test shows an opted-in execution receives Terminay MCP, an opted-out one none, and none once MCP is off. Verify: the test passes under the bounded flags.

## 5. Docs, verification and completion

- [x] 5.1 Update the standalone runbook in `docs/operations/`: MCP is on by default, how to install agent registrations from Settings, the registered command, and the placement failure message. Verify: the runbook mentions the setting and the registered command.
- [ ] 5.2 Run `openspec validate standalone-server-hosts-terminay-mcp` and `openspec validate --all`. Verify: this change is valid, and `--all` shows no new failure beyond the 7 that already fail in other changes on `main`.
- [ ] 5.3 Run the full local typecheck and unit tests. Verify: all pass.
- [ ] 5.4 Build the Docker image locally, run it, connect Desktop, and confirm the connection menu shows no "Without …" line and an agent in a terminal on that server can call a Terminay tool. Verify: the tool result is captured in the PR description.
- [ ] 5.5 Run `/opsx:verify`, sync the delta specs into `openspec/specs/`, and archive the change in the same branch. Verify: `openspec validate --all --archived` shows no new failures.
- [ ] 5.6 Open the PR on Gitea and read back every commit status. Verify: all `success` or `skipped`.
