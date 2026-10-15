## 1. Stop inheriting a root (bug fix)

- [ ] 1.1 Remove the first-project root from `defaultProjectRoot`/`homePath` in `src/App.tsx` (`:6679-6682`, `:7219-7221`, `:7256`) so `createServerProject` sends no root. Verify: a renderer unit test creates a project with another rooted project open and asserts the `project.create` command carries no `root`.
- [ ] 1.2 Remove the active/first-project root fallback in `addProject` (`src/workspace/useProjectCollection.ts:457-462`). Verify: unit test asserting the disconnected path sends no inherited root.

## 2. Workspace model and protocol

- [x] 2.1 Add `start?: 'awaiting-choice'` to `WorkspaceProject`, `'none'` to `ProjectRootOrigin`, and `recentProjectFolders` to `WorkspaceState`, then update `PROJECT_KEYS` and the validator (`packages/server-core/src/workspace.ts`). Verify: workspace validator tests accept the new shapes and reject `start` combined with a non-`none` origin.
- [x] 2.2 Bump `WORKSPACE_SCHEMA_VERSION` to 7 with an additive migration. Verify: a migration test loads a v6 fixture and gets identical projects plus empty recents.
- [x] 2.3 Add the `projectStartChoice` feature capability and the `project.start`, `recent.forget`, `recent.list` (with availability) and `fs.browseRootFolders` message types and validators in `packages/protocol`. Verify: protocol validator tests for valid and malformed payloads.

## 3. Server behaviour

- [x] 3.1 Make `project.create` without a root, on a connection that negotiated `projectStartChoice`, commit `start: 'awaiting-choice'`, `rootOrigin: 'none'`, `root: ''`. Keep today's server-default path for other connections and for explicit roots. Verify: `workspaceProtocol` tests cover both connection kinds and MCP/terminal-created projects.
- [x] 3.2 Implement `project.start` in the reducer: first choice wins, later choices are refused with `start_conflict`, folders are canonicalized as explicit roots, and a validation failure leaves the state unchanged. Verify: reducer tests for home, folder, conflict, and missing folder.
- [x] 3.3 Record recents on an explicit root from `project.start` and `project.root.update`, capped at 50, deduplicated, most recent first. `project.root.update` on an awaiting project clears `start`. Implement `recent.forget`. Verify: unit tests for ordering, dedupe, 51st eviction, forget, and no recording of server-default or no-root starts.
- [x] 3.4 Launch the first terminal after `project.start` through the normal launch resolver, and resolve `rootOrigin: 'none'` to the verified account home unless an explicit cwd is given. Verify: composition tests assert the PTY cwd for a no-root project equals `homeDirectory`.
- [x] 3.5 On restore (server and `electron/` Desktop restore path), skip the fresh terminal for projects still awaiting a choice. Verify: a restore test with one started and one awaiting project asserts exactly one terminal is launched.
- [x] 3.6 Implement `fs.browseRootFolders` per ADR-0066: directories only, at most 1000 entries with `truncated`, home by default, per-request canonicalization, root-change authority checked before any fs access, not registered on MCP, and typed errors for missing, unreadable, or not-a-directory paths. Verify: server-core tests covering each case, including a refused unauthorised device and an absent MCP tool.
- [x] 3.7 Reject Explorer, Git, watch and Documentation feature queries for a no-root project with the typed `no_project_root` error. Verify: feature-query tests.
- [x] 3.8 Implement `recent.list` availability as a bounded stat-only check on demand, with no polling. Verify: test with one missing folder marked unavailable.

## 4. Renderer

- [ ] 4.1 Build `ProjectStartChooser`, rendered in place of the Dockview when `start === 'awaiting-choice'`, with Open a folder, Home directory, the recents list with Forget, unavailable rows, the server label when several connections are attached, and focus on the first action. The sidebar stays empty. Verify: component tests for contents, keyboard navigation, the unavailable row, and focus.
- [ ] 4.2 Build `RootFolderBrowser` in the in-page window frame (ADR-0053), backed by `fs.browseRootFolders`, with enter, parent, typed path, choose, cancel and error states. Verify: component tests with a mocked query, including truncation and the error state.
- [ ] 4.3 Wire chooser actions to `project.start` and show conflict and validation errors inline. On success, focus the new xterm. Verify: renderer test that a `start_conflict` shows the server's state.
- [ ] 4.4 Add the "No root folder" empty state with an Open a folder action to the Explorer (`useFileExplorerController`/`FileExplorerTree`), Git (`GitPanel`) and Documentation controllers, issuing no query when the root is `none`. Verify: unit tests assert no `listFolder`, Git, or watch call is made for a no-root project.
- [ ] 4.5 Make sure Set Project Root and Set Root From Working Directory (`App.tsx:3020-3060`, `ConnectedWebRendererWorkspace.tsx:763`) work on no-root projects and leave no-root mode. Verify: renderer test.
- [ ] 4.6 Fit the chooser and browser to the compact layout as a single scrolling column. Verify: compact-viewport component test asserts no horizontal overflow.

## 5. End-to-end and validation

- [ ] 5.1 E2E: create a project while another rooted project is open, assert the chooser shows and no terminal exists, choose Home, and assert the terminal cwd is home and the sidebars show "No root folder". Verify: passes under `npm run test:e2e`.
- [ ] 5.2 E2E: Open a folder through the browser, then create a second project and open the folder from recents, then forget it. Verify: passes under `npm run test:e2e`.
- [ ] 5.3 E2E: restart Desktop with an awaiting project and assert the chooser returns with no terminal. Verify: passes under `npm run test:e2e`.
- [ ] 5.4 Run `openspec validate --all`, `npm run lint`, `npm test`, and typecheck. Verify: all clean.
