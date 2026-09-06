## 1. Local activity store

- [ ] 1.1 Treat a focused working→idle transition as viewed, and treat focused attention as viewed rather than finished-unviewed, leaving focused working as recent. Verified by `npm run test:activity-store` passing, including the new focused-finish and focused-attention cases in `scripts/terminal-activity-store.test.mjs`.
- [ ] 1.2 Replace `attention is suppressed for the focused tab but the finished state is not` so it no longer asserts green on a focused tab. Verified by that file containing no expectation that focused completion is `unviewed`.

## 2. Server-backed fold-back

- [ ] 2.1 In `src/App.tsx`, acknowledge a focused session that is not working even when the snapshot is claimed, and keep applying working snapshots so amber remains. Verified by reading the fold-back: claimed idle or attention on the focused panel calls `markTerminalActivityViewed`, and a focused `status === 'working'` snapshot is not acknowledged away.
- [ ] 2.2 Keep tab-selection `markViewed` as the path that acknowledges both fallback activity and bound agents. Verified by `useDockviewPanelLifecycle` still calling `markTerminalActivityViewed` on `onDidActivePanelChange`.

## 3. Tab RAG presentation

- [ ] 3.1 In `src/components/TerminalTab.tsx`, render agent `done`, `waiting`, and `blocked` glyphs only while `agentUnread` is true; always render `working`. Verified by a unit or source test that an acknowledged `done` panel shows no done glyph and a working panel still shows working.

## 4. End-to-end coverage

- [ ] 4.1 Keep `e2e/terminal-signals.spec.ts` cases for focusing a finished tab (clears tab, project count, and header) and for structured completion on an already-focused tab (no finished indicator). Verified by those tests existing with those assertions.
- [ ] 4.2 Replace `active terminal tabs show only the finished activity status dot by default` in `e2e/terminal.spec.ts` so it no longer requires green on the focused tab after OSC 9;4 completion. Verified by that test file no longer asserting `data-terminal-activity` `unviewed` on the active tab after structured completion.
- [ ] 4.3 Confirm a focused working terminal still shows amber (and an amber project count when it is the only activity). Verified by an e2e or unit assertion that focused `recent` / working remains visible.

## 5. Verification

- [ ] 5.1 Run `openspec validate --all` and `npm run test:activity-store`. Verified by both green.
- [ ] 5.2 Run the Docker-isolated Electron suite (`npm run test:e2e`) covering `e2e/terminal-signals.spec.ts` and `e2e/terminal.spec.ts`. Verified by that runner; do not run Playwright's Electron suite on the host.
