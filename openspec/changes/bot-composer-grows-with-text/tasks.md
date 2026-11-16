## 1. Renderer

- [x] 1.1 `BotChat` (via `useFitTextarea`): hold a ref to the composer textarea; in a `useLayoutEffect` on `draft`, set `height: auto` then `height` to `scrollHeight` for nonempty drafts (ignore wrapped placeholders); `rows={1}` — verified by the `bots` E2E sizing case
- [x] 1.2 `BotChat`: re-measure from a `ResizeObserver` on the textarea when its width changes, ignoring height-only changes; disconnect on unmount — verified by the `bots` E2E sizing case (narrowing the composer re-fits)
- [x] 1.3 `botPanels.css`: in the winning composer rule block give the textarea `line-height: 1.5`, `min-height` of three lines, `max-height: max(3 lines, min(12 lines, 40vh))`, `overflow-y: auto`, `box-sizing: border-box`; keep `resize: none` and hide empty placeholder overflow — verified by the `bots` E2E sizing case

## 2. Verification

- [x] 2.1 Add a `bots` E2E case in a tall window: empty composer is three lines and not scrollable; five Shift+Enter lines grow it with no scroll and send nothing; a long single line wraps and grows it; forty pasted lines stop at twelve lines with `scrollHeight > clientHeight`; deleting back to one line and clearing shrink it; Enter sends a grown message and the box returns to its empty height; a multi-line draft is restored at its grown height after switching Home tabs — verified by `npm run test:e2e -- e2e/bots.spec.ts`
- [x] 2.2 In the same case, narrowing the composer (its form's width, as a narrower tab does) re-wraps text and grows the box, and shortening the window so 40vh is under twelve lines caps the box at 40vh and makes it scroll without any text change — verified by `npm run test:e2e -- e2e/bots.spec.ts`
- [x] 2.3 A failed post keeps a grown draft at its height — verified directly by the `sendRefusal` scenario in `scripts/bots-ui.test.mjs`, run with bounded `node --test --test-force-exit --test-timeout=120000 --test-name-pattern="composer|pending post preserves" scripts/bots-ui.test.mjs`
- [x] 2.4 Existing `bots` E2E cases still pass — verified by `npm run test:e2e -- e2e/bots.spec.ts`
- [x] 2.5 Screenshots of the empty, grown and max-height composer attached to the pull request
- [x] 2.6 `npm run typecheck:workspaces`, `npx biome check` on the changed files, and `openspec validate bot-composer-grows-with-text` pass; `openspec validate --all` reports no new failures beyond those already on main
- [ ] 2.7 Every Gitea commit status on the pull request head SHA is `success` or `skipped`
- [x] 2.8 Browser component regressions: a wrapped placeholder never grows an empty composer; the three-line minimum wins in a tiny viewport; composing Enter sends nothing; the caret stays visible at the cap; a pending post preserves the height of new text — verified by the same bounded browser component command as 2.3
