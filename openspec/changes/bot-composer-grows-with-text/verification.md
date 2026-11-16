# Verification: bot-composer-grows-with-text

Verified 2026-11-16 against the working tree.

| Dimension | Result |
| --- | --- |
| Completeness | 10/11 tasks. Open: 2.7 (Gitea statuses on the pull request). Both added requirements are implemented. |
| Correctness | Every delta scenario maps to code and a test (below). |
| Coherence | Implementation follows design.md, including the placeholder decision added during code review. |

## Requirement → implementation

- **Bot chat composer sizes to its text**: `src/workspace/bots/useFitTextarea.ts` (content height on every `draft` change and on width change; empty value keeps the CSS minimum), `src/workspace/bots/BotChat.tsx` (`ref={composer}`, `rows={1}`), `src/workspace/bots/botPanels.css` (three-line minimum, `max(3 lines, min(12 lines, 40vh))` maximum, `overflow-y: auto`, hidden overflow while the placeholder shows).
- **Sending from a grown bot chat composer**: unchanged `keyDown` and `send` in `BotChat.tsx`; sizing follows `draft`, so a cleared draft returns to three lines and a kept draft keeps its height.

## Scenario → test

| Scenario | Test |
| --- | --- |
| Empty composer | E2E `the composer grows with its text…`; browser `empty composer stays at three lines…` |
| Shift+Enter lines grow the box | E2E sizing case |
| A long line wraps and grows the box | E2E sizing case |
| Long paste stops at the maximum | E2E sizing case; browser `composer keeps the caret visible…` |
| A short window lowers the maximum | E2E sizing case (850 → 400px); browser tiny-viewport case (minimum wins) |
| Deleting text shrinks the box | E2E sizing case |
| Narrowing the tab re-fits the text | E2E sizing case |
| Restored draft keeps its size | E2E sizing case |
| Sending shrinks the box | E2E sizing case |
| A failed post keeps the text | browser `composer keeps a grown draft when posting fails` |

IME Enter and a post overtaken by new text are covered by the browser tests `composing Enter preserves…` and `a pending post preserves…`.

## Checks

- `timeout 300 node --test --test-force-exit --test-timeout=120000 --test-name-pattern='composer|pending post preserves' scripts/bots-ui.test.mjs`: 5/5 pass.
- `npx tsc --noEmit -p .` and `npm run typecheck:workspaces`: pass.
- `npx biome check` on the changed source and E2E files: clean.
- `openspec validate bot-composer-grows-with-text`: valid. `openspec validate --all` has the same seven failures as main, all in other changes.
- Docker E2E `npm run test:e2e -- e2e/bots.spec.ts`: 34/34 pass on the final code.
