## 1. Protocol and store

- [x] 1.1 Add `BotActionTarget`, `BotMessageActivity`, `botActionTarget`/`botMessageActivity` validators and optional `activity` on `BotMessage` in `packages/protocol/src/botMessages.ts`. Verify: `npx turbo run build --filter=@terminay/protocol` passes.
- [x] 1.2 Add `BotMessageStore.recordActivity` (append; in-place fold on same execution/tool/text/outcome/reason/target; 2,000-entry cap removing oldest actions; actions outside the 10,000-post limit); refuse edit/delete of activity rows; ignore them in `unacknowledged`; validate stored `activity` in `parse`; `list({ actions: false })` bound into the cursor. Verify: new `packages/server-core/test/bot-message-actions.test.mjs` covers append, fold, no fold across different text/target/outcome/execution or an intervening message, edit/delete refused, clear removes, `unacknowledged` unchanged by actions (including with a pending post), `list` exclusion and cursor binding, the cap with messages kept, posting still allowed at the cap, 512/200-byte UTF-8 cuts, and reload from disk.
- [x] 1.3 Validate activity in `BotMessagesClient` list and detail responses, dropping a row whose activity is malformed. Verify: client-core unit test with a valid, a malformed and an absent activity.

## 2. Recording

- [x] 2.1 Add `actionWording.ts` (past tense / "Couldn't …", 60/80-character quoting). Verify: unit tests for create_project, run_command (80-char cut), write_terminal, update_settings (key names only), a trigger, an unknown op and a failed call.
- [x] 2.2 Add `sessions.botOf` and `BotService.recordAction(botId, executionId, action, epoch)` (owner check, epoch check, redaction, nothing on redaction failure). Record `triggers_create|update|delete|enable|run` around `callTriggerTool` in `runtime.ts`, linking a failed call only to an existing trigger of the bot. Verify: tests that a foreign execution records nothing, a changed epoch records nothing, a secret is redacted, `triggers_create` records a trigger target, `triggers_delete` none, a failed `triggers_update` with an unknown ID none, and `triggers_list`/`triggers_preview` nothing.
- [x] 2.3 Keep action entries out of briefing excerpts and counts in `BotRuntime.briefing`. Verify: briefing test with actions after the last post shows only posts.
- [x] 2.4 Add `apps/terminay-server/src/mcp/botActions.ts` (`BOT_ACTION_OPERATIONS`, pre-dispatch resolution, result normalization, post-dispatch target completion, recording after the response) and wrap the dispatcher in `host.ts`. Verify: `apps/terminay-server/test/bot-mcp-actions.test.mjs` unit-tests `withBotActions` with fake deps: bare and `{ok:true}` results, `{ok:false}` and thrown failures, a terminal capability records nothing, read ops record nothing, `create_project` resolves the result handle, a moved terminal links to its new project, an unknown handle gives no target, a throwing recorder leaves the result unchanged, and the result returns before the recorder runs. Plus an integration test through the real control endpoint with a bot capability: `open_terminal` records a terminal target and `list_terminals` records nothing.

## 3. Chat UI

- [x] 3.1 Add pure `src/workspace/bots/botActions.ts` (collapse to the latest three, hidden count, group key). Verify: `botActions.test.ts` added to `test:workspace-models` covers single row, a run of six, expand, and a group key that is stable when rows are appended.
- [x] 3.2 Add an `action` transcript item and `actions` block in `turnBlocks`, `BotActionRow.tsx`/`BotActionGroup` and styles. Route activity messages to it from `BotChat`, with no message menu, and exclude them from the unread divider and read-marking. Verify: e2e in 4.1.
- [x] 3.3 Wire `onRevealAction` from `App.tsx` through `BotTab` to `BotChat`, server-aware: project and terminal/workflow via `activateDashboardRow`, automation via `openAutomationsFromOverview`, template/settings via `openSettings` only on the current server, trigger via `onConfigure('triggers')`. Show "No longer exists" for `missing` and "Not available from this window" for `elsewhere`. Verify: e2e in 4.1 opens a terminal from a row and sees "No longer exists" for a closed project.

## 4. End to end and checks

- [x] 4.1 Extend `e2e/bots.spec.ts`. Have a bot execution's real Terminay MCP calls (or the server's recorder, if the e2e fake agent cannot call MCP) produce action entries: done, failed, folded ×N and a run of six. Assert row text, marks, collapse and expand, no unread divider, a live row appearing without reload, Open terminal revealing the terminal, and a gone target saying so. Capture screenshots of the grouped rows, the expanded group and a failed row. Verify: `npm run test:e2e` (Docker) passes for the bots suite.
- [x] 4.2 Run typecheck, Biome, the touched packages' tests, `openspec validate bot-chat-shows-terminay-actions` and `openspec validate --all`. Verify: all pass, or failures that already exist on `main` are listed as unrelated.

Verification notes: the e2e drives real Terminay MCP calls through the bot's
relay (create, open, a folded ×2 write, a refused close) and checks the
collapsed group, expansion, the failed row and Open terminal. The "gone"
notices are covered by `botActions.test.ts`; `openspec validate --all` fails
only in other changes (add-terminay-bots, linked-folders and others), which
fail the same way on `main`.

