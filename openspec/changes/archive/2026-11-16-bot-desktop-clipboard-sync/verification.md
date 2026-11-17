# Verification

## Result

Implemented and accepted by Mark on macOS on 2026-11-16. Right-click Paste works without a preceding Command+V; Control+V and bot-to-Mac copying work. Mark also pasted the Unicode test text in Word inside the bot, supplied a screenshot showing the characters correctly, and explicitly said to consider this tested and working.

## Original diagnosis

- Worktree: `/Users/mark/Documents/Projects/terminay/clipboard-investigation`, branch `investigate-bot-clipboard`, based on `ed07ca39`.
- Native Electron and renderer diagnostics recorded Control+V (`control=true`, `meta=false`). The existing Mac predicate rejected it, so the host clipboard was not uploaded. Mark confirmed Command+V worked.
- Mark clarified the requirement: clipboard synchronization so the bot's own context-menu Paste and Linux shortcuts use current host text. The old accepted contract explicitly allowed only shortcut-triggered upload.
- Temporary diagnostics were removed. No clipboard content was added to product logs or persistence.

## macOS / Xvnc acceptance

The complete application was built and launched with `npm run dev` from the worktree. No host Playwright Electron suite was run.

Mark confirmed:

1. Open the control desktop, copy fresh text in another Mac application, right-click the bot Chromium address bar, and Paste without Command+V: passed.
2. Copy different text on the Mac and use Control+V in the bot browser: passed.
3. Copy inside the bot and paste into another Mac application: passed.
4. Unicode text pasted into Word in the bot displays correctly; Mark accepted the result as tested and working.

The first Unicode screenshot used Chromium's single-line address bar and displayed missing CJK glyphs. A direct X11 selection request through the actual Xvnc/noVNC clipboard confirmed `café`, `✓`, and `漢字` were present in UTF-8. Word then rendered them correctly. The copied question was a single line: visual wrapping is not independent proof of newline preservation. Multiline normalization is covered by the focused automated tests; the owner explicitly accepted the Mac verification.

An earlier CLI-seeded probe was inconclusive because the selected desktop's sharing state was not established at that time. It is not counted as passing acceptance evidence. The final read-only X11 probe and owner-driven checks above are the native evidence.

## Automated verification

- `node --test --test-force-exit --test-timeout=120000 --experimental-strip-types electron/desktopClipboardSync.test.ts src/workspace/bots/desktopClipboard.test.ts src/workspace/bots/desktopClipboardSharing.test.ts src/host/clipboardSharing.test.ts` under `timeout 150`: **29 passed**.
- `node --test --test-force-exit --test-timeout=120000 packages/protocol/test/host.test.mjs` under `timeout 120`: **25 passed**.
- `npm run test:e2e -- e2e/host-clipboard-sync.spec.ts e2e/server-ui-sandbox.spec.ts` under `timeout 900`: **7 passed** in the isolated Docker runner. Covers the actual bound preload/main service, Unicode native clipboard text, change delivery without paste, rejected stale/malformed requests, reload retirement, cross-window ownership, hide retirement, unavailable capability rejection, and sandbox/origin/subframe isolation.
- E2E artifacts: `.docker-cache/e2e/20261116T213446Z-15983/`.
- An initial extra E2E check attempted to minimize an auxiliary Settings window, which is not minimizable. The fixture was corrected to perform an actual hide transition; the product wires both hide and minimize to the same retirement handler. The corrected seven-test run passed.
- `npx tsc --noEmit`: passed.
- `npm run check:boundaries`: passed (16 workspace packages).
- Focused Biome lint on the new service, controller, and tests: passed.
- Development build graph: 16 tasks passed.
- `git diff --check`: passed.

## Observation and approval

The pinned Electron main-process clipboard API has no documented change event. Chromium's clipboardchange contract delivers to focused documents and defers changes while unfocused; it cannot provide continuous background observation here. Mark explicitly approved one 500 ms check in Electron, only while the selected desktop owns sharing, on 2026-11-16. The design and timer cite ADR-0028 and this approval. There is one owner and one serialized monitor; retirement cancels scheduling and fences pending results.

## Spec verification

The change's delta validation passes. Main specs are synchronized in this worktree; all unrelated requirements and Purpose text are preserved. `openspec validate --all` has seven pre-existing failures in untouched changes: add-terminay-bots, linked-folders, one-window-one-server, outbound-bot-triggers, phone-review-fixes, server-notification-manager, unified-settings-window. These are unrelated to this implementation. All 57 main capability specs pass validation. After archival, `openspec validate --all --archived` reports 299 passed and 8 failed in untouched historical changes; this archived change passes. All 13 tasks are complete.

## Scope

Text synchronization belongs to the selected open control desktop, including while the Mac user is in another application. Hiding the desktop behind another view, view-only, disconnect, document retirement, minimize/hide, or a newer owner's selection stops it. Files and images do not synchronize. Browser hosts without the declared native capability retain paste-only behavior and display that limitation.
