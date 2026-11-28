## 1. Implementation

- [x] 1.1 In `BotThreadPanel`, focus the panel (`tabIndex={-1}`, `preventScroll`) on open instead of the composer; verified by `npx tsc --noEmit` and the e2e in 2.1
- [x] 1.2 Inset the panel's `:focus-visible` outline in `bots.css`; verified in the keyboard-open screenshot

## 2. Verification

- [x] 2.1 Update the thread e2e in `e2e/bots.spec.ts`: opening by hover action, menu (keyboard) and reply bar, and switching threads (including from a focused composer), focuses the panel and not the composer; Tab from the panel reaches the composer; Escape dismisses a panel menu before it closes the panel; Escape closes and focuses the root; clicking the composer focuses it; capture a keyboard-open screenshot; verified by `npm run test:e2e` on `e2e/bots.spec.ts`
- [x] 2.2 `openspec validate --all` passes for this change and every main spec; failures in unrelated changes also present on `main` are recorded in `verification.md` for the pull request
