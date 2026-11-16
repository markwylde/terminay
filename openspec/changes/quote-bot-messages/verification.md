# Review and verification — quote-bot-messages

Reviewed on 2026-11-16 against the working-tree changes and the change's proposal, design, ADR manifest, tasks, and bot-message-log delta.

## Findings fixed

- **Proposal review (7 findings, all folded in):** keyboard operation of the message menu; the draft is appended to and never rewritten; the selection travels as a separate quote payload so Edit message keeps the full text; the source and normalisation rules are normative in the spec; truncation counts code points and closes cut-open fences; the unit test runs in CI via `test:workspace-models`; the ADR manifest records ADR-0093's partial superseders.
- **Code review — P2, truncation could leave a broken fence.** A fence line with an info string (`` ```not-a-close ``) was treated as a close, and the added closing fence dropped list indentation. A fence now closes only on the same marker, at least as long, with nothing after it, and the closing fence keeps the opening's indentation. Two regression tests cover both cases.
- **Verification gap:** the e2e test now also drives Up, Down (wrapping), Home and End in the keyboard-opened message menu.

## Contract and boundary review

| Dimension | Assessment |
| --- | --- |
| Completeness | Three added requirements, 14 scenarios, all implemented and exercised. 6/6 tasks complete. |
| Correctness | Bot and user messages, multi-line and CRLF text, selection inside/outside the message, Edit unaffected by a selection quote, attachment-only messages, pending files kept, nothing sent, caret at end, keyboard open/navigate/Enter/Escape with focus return; truncation and fences covered by unit tests. |
| Coherence | Reuses the shared `ContextMenu` and its opt-in keyboard mode; Quote sits first above Edit and Delete without an icon, matching the existing items. |

Renderer-only change: no Node/Electron imports, IPC, filesystem, network, protocol or server change. A quote only edits the local draft; sending uses the existing post path. No project/window or terminal-session boundary is touched.

## Validation

- Unit: `node --test --test-force-exit --test-timeout=120000 --experimental-strip-types src/workspace/bots/quoteMessage.test.ts` — 15 passed.
- TypeScript: `npx tsc --noEmit -p .` — no errors in changed files (the only errors are in `DocumentationAutosaveController.test.ts`, which needs an unbuilt `server-core` dist).
- Biome: no errors; two `suppressions/unused` warnings in `BotTranscript.tsx` also occur on `main`.
- Docker: `npm run test:e2e -- e2e/bots.spec.ts` — 34 passed (3.9 min) before merging main; 35 passed (3.7 min) after merging #596, including the new Quote test.
- `openspec validate quote-bot-messages` passed. `openspec validate --all`: 120 passed, 7 failed, all in other changes that already fail on `main` (add-terminay-bots, linked-folders, one-window-one-server, outbound-bot-triggers, phone-review-fixes, server-notification-manager, unified-settings-window).
- `git diff --check` passed.

After merging #596 (composer auto-grow), the composer and `useFitTextarea` share one callback ref. `scripts/bots-ui.test.mjs` (`npm run test:bots-ui`, not in CI) asserted the message menu items as buttons; they are `menuitem`s in keyboard mode, so the test now uses that role and passes.
