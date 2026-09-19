## 1. Link helpers

- [x] 1.1 In `src/components/terminalLinkInteraction.ts`, remove touch activation from `createTerminalLinkInteraction` and add `platformBrowserUrl` and `detectBrowserHandoffPlatform`. Verified by `node --test scripts/terminal-link-interaction.test.mjs scripts/terminal-touch-selection-and-links.test.mjs` covering iOS, Android, other platforms, credentialed and non-http URLs, and a plain activation that opens nothing.
- [x] 1.2 Make `activateTerminalLinkAtTouch` report whether a link was under the tap. Verified by the touch selection and links test.

## 2. Touch link menu

- [x] 2.1 In `TerminalPanel`, track the hovered link's visible text (OSC-8 buffer range, or the detected URL), show the link menu on a tap over a link instead of opening or focusing, and close it on the next terminal touch. Verified by `npx tsc --noEmit` reporting no new errors and by reading that the tap path no longer calls the open handler.

## 3. Checks

- [x] 3.1 Run `openspec validate --all`, Biome on the changed files, `npx tsc --noEmit`, and the link tests. Verified by each reporting clean, apart from errors already present on `main`.
- [ ] 3.2 Open the pull request on Gitea with `tea`, then read back every commit status on the head SHA and confirm each is `success` or `skipped`. Verified by the status listing itself.
