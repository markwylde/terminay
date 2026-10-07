## 1. Specs first

- [ ] 1.1 Archive each unarchived change whose deltas carry multi-server wording and whose work is merged: `compact-unified-switcher`, `compact-switcher-close`, `compact-command-bar-entry`, `home-dockview-tabs`, `dashboard-views-and-agent-detail`, `dashboard-board-group-by-project`, `dashboard-board-column-order`, `notifications-icon-and-project-dot`, `drag-terminal-tab-to-project`, `pairing-install-instructions-and-beta-image`, `survive-wake-connection-reap`, `terminals-survive-restart`, `builtin-agents-extension`. Leave any that is not merged, and list it in the pull request. Verified by `openspec validate --all --archived`.
- [ ] 1.2 Write the second pass of deltas for every requirement listed in design decision 12, against the main specs as they stand after 1.1. Verified by `openspec validate one-window-one-server` and by a grep of the change's resulting requirement text finding no "attached connection", "Attach", "Detach", "composition", or "server selector".
- [ ] 1.3 Confirm no main spec requirement outside this change's deltas still depends on a window holding more than one server. Verified by repeating the inventory grep over `openspec/specs` and recording the result in the pull request.

## 2. Switching in the host

- [ ] 2.1 Establish how a server treats two live connections under one device key, by opening two Desktop windows on one standalone server. Record the result in `openspec/adr/evidence/` and, if the older connection is replaced, make **Open in new window** and remote tear-off focus the existing window instead. Verified by the evidence file and an E2E for whichever behaviour results.
- [ ] 2.2 Add `connections.select` and `connections.open-window` to the protocol as closed, capability-gated actions naming a profile id. Verified by `packages/protocol/test/host.test.mjs`.
- [ ] 2.3 Implement switching in Electron main: resolve the remembered profile, open its transport or the Local session, and remount the requesting window only once ready; a failure leaves the window as it was and rejects with a reason. Keep the ordering in a module apart from Electron. Verified by unit tests of that module for success, unreachable server, forgotten profile, and return to Local.
- [ ] 2.4 Implement opening a window on a remembered server. Verified by an Electron E2E through `npm run test:e2e` that ends with one window on Local and one on a standalone server.
- [ ] 2.5 Persist each window's server and workspace view beside its geometry, reopen it there, and fall back to Local for a forgotten profile. Verified by an Electron E2E that restarts Desktop on a remote server and by a unit test of the fallback.

## 3. The connection menu

- [ ] 3.1 Make the Desktop connection menu list Local and every saved server, mark the window's server, switch on choosing a row, and offer **Open in new window** on the others; show a switch in progress and a failed switch's reason. Verified by component tests and by the E2E in 3.3.
- [ ] 3.2 Keep the connection menu usable while the window's server is offline, reconnecting, unauthenticated, or incompatible. Verified by an Electron E2E that stops a standalone server and switches the window back to Local.
- [ ] 3.3 Electron E2E for the journey: pair a standalone server, land on it, switch to Local, switch back, and find the remote server's terminal still running. Verified by the suite passing in pull-request CI.

## 4. Pairing

- [ ] 4.1 Target the workspace window that opened Remote Control when pairing succeeds, leave Remote Control as Remote Control, and leave the workspace window alone when the first connection fails or that window has closed. Verified by unit tests of the pairing attempt sequence and by the E2E in 3.3.
- [ ] 4.2 Update the forget refusal to name switching the window away. Verified by `scripts/desktop-window-connections.test.mjs` or its successor.

## 5. Removing the multi-server window

- [ ] 5.1 Remove `connections.attach`, `connections.detach`, `connections.composition.write`, attached byte endpoints, and the context's `composition` from the protocol, preload, and main; delete `electron/desktopWindowConnections.ts` attach logic and `electron/desktopWindowComposition.ts`. Verified by `npm run test:ci` and a grep finding none of those names in `electron/`, `packages/protocol/`, or `src/`.
- [ ] 5.2 Reduce `ConnectionRegistry` and `ConnectionsContext` to one connection, and delete `composition.ts`, `projectTabComposition.ts`, `useConnectionProjectTabs.ts`, `useConnectionAgentSnapshots.ts`, `crossServerAgentBadges.ts`, `crossServerRows.ts`, and `ConnectionsControl`'s attach rows. Verified by the typecheck, `npm run test:ci`, and the existing workspace E2E shards.
- [ ] 5.3 Remove the server dimension from the tab strip, overflow switcher, compact switcher, Command Bar, Home overview, dashboard List/Board/Projects, Notifications, and the Agents pane. Verified by their model tests with the two-server cases deleted, and by an E2E asserting no server label appears on any of them.
- [ ] 5.4 Remove `ServerSelector` and the server selects from Settings, Extensions, Macros, Recordings, Shell profiles, and Automations; auxiliary windows present the server of the window that opened them. Verified by component tests and by an E2E opening each from a window on a remote server.
- [ ] 5.5 Remove the server chooser from the new-project control. Verified by the project-bar component test and E2E.
- [ ] 5.6 Open torn-off windows on the source window's server and refuse a project drop on a window showing another server. Verified by Electron E2E for both.
- [ ] 5.7 Remove the attached-connection surface from `apps/terminay-web/src/framedConnectionHost.ts` and `src/web/sessionTransportHost.ts`. Verified by `apps/terminay-web` tests and `scripts/session-transport-host-contract.test.mjs`.
- [ ] 5.8 Delete or rewrite the tests that exist only for attach and composition (`multi-connection-workspace`, `project-tab-composition`, `cross-server-rows`, the attach cases of `connections-control`, `desktop-window-connections`, `connection-registry`, and `packages/client-core` connections and compatibility tests). Verified by `npm run test:ci` passing with no skipped test left behind.

## 6. Add connection providers

- [ ] 6.1 Move the install guide's options onto one ordered provider list in `serverInstallCommands.ts`, holding Docker and Linux host, and render the choice and steps from it. Verified by its unit tests and by `e2e/remote-control-management.spec.ts` passing unchanged.

## 7. Documentation

- [ ] 7.1 Update `docs/product-overview.md` and any operator runbook that describes attaching servers to a window. Verified by `npm run test:documentation`.

## 8. Close out

- [ ] 8.1 `openspec validate --all` passes. Verified by its output.
- [ ] 8.2 Open the pull request on `origin` and read back every commit status. Verified by each being `success` or `skipped`.
- [ ] 8.3 Note in the pull request whether the `terminay.com` manager still offers attach, as a follow-up there. Verified by the note.
