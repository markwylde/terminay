## 1. Reproduce

- [x] 1.1 Add `creating a terminal from the switcher shows the new terminal` to `e2e/compact-chrome-switcher.spec.ts`. Verified by: the test exists and exercises the footer New terminal button at phone width.
- [x] 1.2 Run it against unfixed code with `npm run test:e2e -- e2e/compact-chrome-switcher.spec.ts -g "creating a terminal from the switcher"`. Verified by: the run fails on the visible-session assertion, proving the test catches the bug.

## 2. Fix

- [x] 2.1 In `src/App.tsx`, add a helper that dispatches `executeCommand('new-terminal')` on a project's workspace handle, retrying on animation frames for up to about one second while the handle is not mounted. Verified by: the typecheck script passes.
- [x] 2.2 Point `onNewTerminalHere`, `createCompactSwitcherTerminal`, and the `pendingCompactTerminalRef` effect at that helper, activating the project first when it is not in front. Verified by: a search finds no remaining switcher call to `createInitialTerminalForProject`, and its project-bootstrap caller is unchanged.
- [x] 2.3 Add an e2e case for a background project's group `+` control. Verified by: the case asserts the project becomes active and the created terminal is the visible one.

## 3. Verify

- [x] 3.1 Run `npm run test:e2e -- e2e/compact-chrome-switcher.spec.ts`. Verified by: every test in the file passes, including 1.1 and 2.3.
- [x] 3.2 Run lint, typecheck and unit tests. Verified by: all exit 0.
- [x] 3.3 Run `openspec validate --all`. Verified by: exit 0.
- [ ] 3.4 Open a pull request on the canonical remote with `tea` and read back the commit statuses. Verified by: every status is `success` or `skipped`.
