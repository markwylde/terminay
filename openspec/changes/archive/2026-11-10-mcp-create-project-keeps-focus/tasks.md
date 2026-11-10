## 1. Server

- [x] 1.1 Remove the `showProject` request and the `shown`/`reason` result fields from `createProject` in `apps/terminay-server/src/mcp/appControlAdapter.ts`, keeping `terminal_reason` when the first terminal fails. Verified by 2.1.
- [x] 1.2 Update the `create_project` description in `apps/terminay-server/src/mcp/stdio.ts` to say the project is created in the background and `focus_project` shows it. Verified by 2.2.

## 2. Tests

- [x] 2.1 In `apps/terminay-server/test/mcp-app-control.test.mjs`, assert `create_project` sends no `showProject` or other view-changing request and returns neither `shown` nor `reason`, with and without an agent's client, and that a failed first terminal leaves the project with a `terminal_reason`. Verified by the bounded `node --test` run of that file passing.
- [x] 2.2 In `apps/terminay-server/test/stdio.test.mjs`, assert the `create_project` description mentions the background and `focus_project`. Verified by that file's bounded `node --test` run passing.
- [x] 2.3 Update the Pixel `create_project` e2e test (`e2e/mcp-app-control.spec.ts`, `e2e/fixtures/fake-claude-chat.mjs`): the user's project and its terminal stay in front, the new project's tab appears and is not active. Verified by `npm run test:e2e -- e2e/mcp-app-control.spec.ts` passing in Docker; the local podman VM ran out of memory building the e2e image, so this is verified by the pull request's sharded E2E CI jobs.
- [x] 2.4 Build `@terminay/server` and its dependencies (`npx turbo run build --filter=@terminay/server...`) and run its full bounded test script. Verified by a zero exit.

## 3. Specs

- [x] 3.1 `openspec validate mcp-create-project-keeps-focus --type change` passes, and `openspec validate --all` reports no failure in this change. Verified by their output; the failures in `add-terminay-bots`, `bot-chat-image-attachments` and `linked-folders` predate this change and are not touched.
