## 1. Shared hook

- [x] 1.1 Add `src/workspace/bots/useOlderHistory.ts` with inputs `{ scroller, sentinel, cursor, generation, enabled, pinned, fetchPage, apply }`, returning `{ loading, error, retry }`. The `IntersectionObserver` is rooted at the scroller, with a top `rootMargin` equal to the scroller's measured `clientHeight` in pixels, rebuilt from a `ResizeObserver` when that height changes. It re-observes when the cursor, `enabled` or the height changes. A ref holding the owning generation guards against a second in-flight request. Only a current-generation completion applies the page or clears the guard, loading or error, and a generation change resets them. A failure suspends observing until `retry()`. Unmounting disconnects both observers — verified by the browser component cases in 3.1
- [x] 1.2 In the same hook, after `fetchPage` resolves and the generation still matches, and only if the view is not pinned, record the first visible message element (`[data-terminay-message-key]`) and its offset. Then call `apply(page)`. In a layout effect after commit, move `scrollTop` by that element's drift and clear the anchor — verified by the "reading position is kept", "loads while following" and thread position cases in 3.1

## 2. Views

- [x] 2.1 `BotChat`: remove the "Load older messages" button and the unpin-on-load. Render the sentinel, the loading row (`role="status"`, "Loading earlier messages…"), the inline error with Retry, and a "Start of conversation" marker when `older` is `null` and messages exist. Enable the hook only once the first page has loaded and the entry jump is done. Failed older pages no longer use the main error banner — verified by 3.1 and 3.2
- [x] 2.2 `BotChat`/`threadModel`: record the oldest sequence of the initial page as a floor, and give `observedThrough` an optional floor below which thread summaries are ignored. Older pages then acknowledge nothing and leave the read position alone — verified by a `threadModel.test.ts` unit case and the older-root case in 3.1
- [x] 2.3 `BotThreadPanel`: remove "Load older replies" and the unpin-on-load. Render the sentinel, loading row ("Loading earlier replies…") and inline error with Retry under the reply-count divider, using the same hook with a `threadId` list — verified by the thread cases in 3.1
- [x] 2.4 `botPanels.css`: styles for the loading row (small spinner, muted text, no spin under `prefers-reduced-motion`), the inline error, and the start-of-conversation marker, in the unread divider's quiet style — verified by the screenshots in 3.3
- [x] 2.5 `bot-chat-threads` is archived, so its "Thread panel" requirement is now in the main `bot-message-log` spec. Modify that requirement in this change's delta so its "Reply deleted elsewhere" scenario says the older replies were loaded by scrolling up, not with "Load older replies", and leave the archive untouched — verified by `openspec validate bot-chat-loads-history-on-scroll`

## 3. Verification

- [x] 3.1 In `scripts/bots-ui.test.mjs`, give the fake server's message list (`scripts/bots-ui-harness.tsx`) a `threadId` filter and a controllable delay and failure. Rewrite the existing "shared history loads older messages on demand" case to scroll instead of click, keeping its check that provider output never enters shared history. Then add cases for:
  - no load button, and scrolling up requests the next page before the top
  - exactly one list request while a slow page is in flight, with the loading row showing
  - the message at the top keeps its on-screen position after a prepend
  - a tall viewport fills page by page and stays at the bottom
  - "Start of conversation" appears once history runs out, with no further list call
  - a failed page shows Retry and nothing else is requested until Retry, which then succeeds
  - a slow page that completes after Clear chat leaves no trace
  - a new message while scrolled up doesn't move the reader
  - an older root with a newer thread reply keeps its new marker and isn't acknowledged
  - a thread with 40 replies loads older replies by scrolling, keeps the reply being read in place, and still follows at the bottom

  Verified by `timeout 900 node --test --test-force-exit --test-timeout=120000 --test-concurrency=1 scripts/bots-ui.test.mjs`
- [x] 3.2 Add an `e2e/bots.spec.ts` case: seed a chat longer than one page, scroll up in the real app, and check that the older messages appear without a button, the start marker shows, and a new exchange is still followed at the bottom. The component harness can't cover the unread divider, because it runs on `about:blank`, where localStorage and so the per-device read position aren't available. Instead, the existing real-app unread-divider case ("chat times every message, marks unread replies until left…") must still pass, and the hook arms only once the first page has loaded and the entry jump has run. Capture screenshots — verified by `timeout 2400 npm run test:e2e -- e2e/bots.spec.ts`
- [x] 3.3 Capture screenshots of the loading row, the start-of-conversation marker and the inline error, and attach them to the pull request
- [x] 3.4 `timeout 900 npm run typecheck:workspaces`, `npx biome check` on the changed files, the `threadModel.test.ts` unit run (`node --test --test-force-exit --test-timeout=120000 --experimental-strip-types src/workspace/bots/threadModel.test.ts`), and `openspec validate bot-chat-loads-history-on-scroll` all pass. `openspec validate --all` reports no failures beyond those already on `main`
- [ ] 3.5 Every Gitea commit status on the pull request head SHA is `success` or `skipped`
