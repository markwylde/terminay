## 1. Modifier latch

- [x] 1.1 Replace the boolean modifiers in `src/components/terminalMobileKeyboardInteraction.ts` with an `off` / `once` / `locked` latch, adding `advanceTerminalMobileModifier` and `consumeTerminalMobileModifiers`, and keep `applyTerminalMobileModifiers` encoding unchanged. Verified by `node --test scripts/terminal-mobile-keyboard-interaction.test.mjs` covering the three-tap cycle, a one-shot modifier spent by one key, and a locked one applied to two keys in a row.

## 2. Accessory row

- [x] 2.1 In `TerminalPanel`, advance a modifier on tap, spend modifiers after `onData`, an accessory key, and Paste, and keep dismissal as a full reset. Verified by `npx tsc --noEmit` reporting no new errors and by reading that `resetMobileTerminalModifiers` is called only from dismissal.
- [x] 2.2 Render the locked state with its own class in `src/App.css` and `aria-description="Locked"`. Verified by reading the rendered class for each latch in `mobileTerminalModifierKeyClassName`.

## 3. Checks

- [x] 3.1 Run `openspec validate --all`, Biome on the changed files, `npx tsc --noEmit`, and the mobile keyboard test. Verified by each reporting clean, apart from type errors already present on `main`.
- [ ] 3.2 Open the pull request on Gitea with `tea`, then read back every commit status on the head SHA and confirm each is `success` or `skipped`. Verified by the status listing itself.
