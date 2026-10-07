## 1. Specs first

- [x] 1.1 Archive each unarchived change whose deltas carry multi-server wording and whose work is merged. Eleven archived; `pairing-install-instructions-and-beta-image` and `terminals-survive-restart` left open with their multi-server wording corrected in place. Verified by `openspec validate --all` passing.
- [x] 1.2 Write the second pass of deltas against the main specs as they stand after 1.1. Verified by `openspec validate one-window-one-server` and by a search of the change's added and modified requirement text finding no attached connection, Attach, Detach, composition, primary connection, or server selector.
- [ ] 1.3 Owner review of the reworded requirements, in particular the ones flagged in the pull request. Verified by the pull request being approved.

## 2. Switching in the host

- [x] 2.1 Establish how a server treats two live connections under one device key. It held one per device and replaced the older; `one-connection-per-window` changed that to one per client window, so several windows may show one remote server. Verified by that change's real-WebRTC tests of two and three windows of one device.
- [ ] 2.2 Add `connections.select` and `connections.open-window` to the protocol as closed, capability-gated actions naming a profile id. Verified by `packages/protocol/test/host.test.mjs`.
- [ ] 2.3 Implement switching in Electron main: resolve the remembered profile, open its transport or the Local session, and remount the requesting window only once ready; a failure leaves the window as it was and rejects with a reason. Keep the ordering in a module apart from Electron. Verified by unit tests of that module for success, unreachable server, forgotten profile, and return to Local.
- [ ] 2.4 Implement opening a window on a remembered server. Verified by an Electron E2E through `npm run test:e2e` that ends with one window on Local and one on a standalone server.
- [ ] 2.5 Persist each window's server and workspace view beside its geometry, reopen it there, and fall back to Local for a forgotten profile. Verified by an Electron E2E that restarts Desktop on a remote server and by a unit test of the fallback.

## 3. The connection menu

- [ ] 3.1 Make the Desktop connection menu list Local and every saved server, mark the window's server, switch on choosing a row, and offer **Open in new window** on the others; show a switch in progress and a failed switch's reason. Verified by component tests and by the E2E in 3.4.
- [ ] 3.2 Keep the connection menu usable while the window's server is offline, reconnecting, unauthenticated, or incompatible. Verified by an Electron E2E that stops a standalone server and switches the window back to Local.
- [ ] 3.3 List the remembered servers in the compact switcher on Desktop and switch from it. Verified by a compact-width E2E.
- [ ] 3.4 Electron E2E for the journey: pair a standalone server, land on it, switch to Local, switch back, and find the remote server's terminal still running. Verified by the suite passing in pull-request CI.

## 4. Pairing

- [ ] 4.1 Target the workspace window that opened Remote Control when pairing succeeds, leave Remote Control as Remote Control, and leave the workspace window alone when the first connection fails or that window has closed. Verified by unit tests of the pairing attempt sequence and by the E2E in 3.4.
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
