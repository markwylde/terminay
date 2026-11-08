## 1. Window parity

- [x] 1.1 Add `WorkspaceViewRelay.latest()`, and move a re-attaching connection to the end. Verify with a relay test that project-bound connections are skipped.
- [x] 1.2 Record the window behind each `bots.messages.post` in `BotService`, and forget it when the connection closes.
- [x] 1.3 Resolve a bot's target in the composition `targetFor`: the recorded viewer while connected, else `latest()`. Verify with a composition test.
- [x] 1.4 Remove the bot refusals in `requestAgentView` and `anchorFor`, and pass `botId` to `targetFor`. Verify that a bot reads and changes the targeted window, and fails with `renderer_unavailable` when there is none.

## 2. Recent folders

- [x] 2.1 Add `list_recent_folders` through stdio, the control endpoint, the dispatcher (permission group Projects and windows), the app-control adapter and the Electron binding. Verify that workspace reach lists folders newest first and project reach gets `out_of_scope`.
- [x] 2.2 Update the MCP permission test: only `list_recent_folders` reads recent folders, and nothing browses or starts.

## 3. Guidance

- [x] 3.1 Add the Terminay note to the context of a bot with access, and mention `list_recent_folders` in Pixel's instruction.

## 4. Verification

- [x] 4.1 Run server-core and terminay-server suites and the workspace typecheck.
- [x] 4.2 In the dev app, ask the Test bot to create a project with four terminals in a 2x2 grid. Verify that the window shows the grid and that the project root is beside the other projects.
