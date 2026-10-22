## 1. Extension API: the launcher contribution

- [ ] 1.1 Add `contributes.terminalLaunchers` and the `agent-launch` permission to manifest validation in `packages/extension-api/src/validation.ts`: namespaced id, display name, allowlisted icon id, platforms, optional `{ source, harness }` that must name a session source and harness the same package declares. Verify with unit tests for a valid declaration, a missing permission, an unknown icon, and a harness the package did not declare.
- [ ] 1.2 Add `agent-claude-code` and `agent-codex` to the Terminay icon allowlist, with Terminay-drawn marks. Verify with the allowlist unit test and by rendering both in the tree.
- [ ] 1.3 Add `context.terminals.registerLauncher(id, runtime)` and the `TerminalLauncherRuntime` type (`resolve(signal)` → available with absolute path, or `not_installed` / `unsupported_platform` with bounded detail) to `packages/extension-api/src/types.ts`; bump the API minor version. Verify with type tests and the registration-refusal unit tests (undeclared, duplicate, after deactivation).

## 2. Server: launcher registry, listing, and launch

- [ ] 2.1 Carry launcher registrations across the extension child boundary in `packages/server-core/src/extensions/` (`child.ts`, `host.ts`, `descriptor.ts`), with a deadline on `resolve`. Verify with a host test that a slow or throwing `resolve` makes the launcher unavailable.
- [ ] 2.2 Build a launcher registry that gates availability on extension state, platform, and harness switch, skips `resolve` while the harness is off, validates the path (absolute, bounded, no control characters), and orders built-ins first. Verify with registry unit tests for each gate and for a relative path.
- [ ] 2.3 Add the `terminal.launchers` read operation and its change event to `packages/protocol` and `terminalService/protocol.ts`; publish on extension enable/disable/update/restart and harness switch change. Verify with protocol conformance tests that the list holds no path and that a harness change publishes.
- [ ] 2.4 Accept an optional `launcherId` on `terminal.create`; reject unknown or unavailable ids; create through the existing `launchResolver` path; after the shell starts, write the path quoted for the profile's shell family plus Enter as a server input source; set the initial title to the launcher's display name; do not persist the id. Verify with service tests for each shell family's quoting, rejection, title, and that restore does not re-run.

## 3. Built-in agents extension

- [ ] 3.1 Declare the `agent-launch` permission and the two launchers in `extensions/builtin-agents/package.json`, Claude Code before Codex, each naming its harness. Verify with the extension's manifest test.
- [ ] 3.2 Register both launchers in `extensions/builtin-agents/src/index.ts`, resolving through `chat/locate.ts`. Verify with extension tests for installed, not installed, and the `TERMINAY_*_COMMAND` override.

## 4. Renderer: launcher list

- [ ] 4.1 Add a launcher store in `src/workspace/` that reads `terminal.launchers` for the selected server, follows its change event, and treats a failed read as an empty list. Verify with unit tests for initial load, a change, and an older server.
- [ ] 4.2 Thread a launcher id through `useTerminalCreationController.ts` to `terminal.create`, and add `onLaunch(folderId, launcherId)` from the project workspace through `FoldersColumn.tsx` to `FoldersTree`. Verify with a unit test that a launch creates in the right folder, selects it, and focuses the new terminal.

## 5. Folders tree: pane strip

- [ ] 5.1 Restyle blocks in `foldersTree.css`: full width, no margin or radius, 6px gutter in the column background, header band lighter than rows, selected header tinted with the project colour, no tint on other headers. Verify against board 1 of the mock-up and with an E2E screenshot assertion.
- [ ] 5.2 Restyle the title line in `FoldersTree.tsx`: chevron first with no grip, icon, uppercase 11px semibold label via CSS only, unmerged mark, count pill counting every panel, menu button; keep the press-travel carry and `Reorder` untouched. Verify with the existing carry, collapse, and keyboard-move tests passing unchanged, and a unit test for the count.
- [ ] 5.3 Remove the left indent from the branch and facts lines and set panel rows so the status indicator sits under the chevron. Verify with an E2E that measures the facts line's first chip and a terminal's indicator against the chevron's left edge.
- [ ] 5.4 Rebuild the New terminal row: label creates a default-shell terminal; on `:hover`, `:focus-within`, and `@media (hover: none)` show the default shell button then one button per listed launcher, each with icon, accessible name, and tooltip; none in a peek. Verify with unit tests for the button list and an E2E that hovers the row, sees the buttons, and launches a stub launcher.

## 6. End to end and docs

- [ ] 6.1 Add an Electron E2E with a test extension contributing a launcher whose executable is a stub script: choosing it creates a terminal in the folder, the stub runs with no arguments, the tab reads the launcher name, and quitting the stub leaves the shell. Verify by running `npm run test:e2e` for that spec.
- [ ] 6.2 Document the `terminalLaunchers` contribution and `agent-launch` permission in `packages/extension-api/README.md`. Verify the README example passes manifest validation in a unit test.
- [ ] 6.3 Run `openspec validate folders-pane-strip-and-agent-launchers`, `npm run typecheck`, `npm test`, and the full `npm run test:e2e`. Verify all pass.
