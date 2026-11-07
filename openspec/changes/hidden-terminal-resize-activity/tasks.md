## 1. Resize redraws are not activity (server)

- [x] 1.1 Add a `resize` activity signal; the reducer records `lastResizeAt` without settling, acknowledging, or changing source, and `applyRawOutput` ignores output within 1 s of it. Verified by new reducer unit tests: a prompt redraw after a resize leaves a settled idle session idle and acknowledged; output 1 s after the resize turns it working; a resize keeps a pending finished/attention indicator.
- [x] 1.2 `TerminalService` gains `onResize`, called for each changed size just before it reaches the PTY; composition binds it to the `resize` activity signal. Verified by a terminal-service unit test (changed size notifies, same size does not) and by `tsc --noEmit` and the server-core build.

## 2. Hidden terminals do not resize (client)

- [x] 2.1 `ProjectWorkspace` provides workspace visibility to its terminal panels; `TerminalPanel` defers fit and resize while hidden, keeps a forced fit owed, and fits once when shown. The settings refresh path follows the same rule. Verified by `e2e/compact-switcher-idle-activity.spec.ts`: resizing the window while the idle terminal's project is in the background prints nothing from it and leaves it idle.

## 3. Verification

- [x] 3.1 Rewrite `e2e/compact-switcher-idle-activity.spec.ts` to cover the background-resize repro and the switcher open/close. Verified by running it with `npm run test:e2e` and seeing it pass.
- [x] 3.2 Run unit tests, lint, typecheck, and `openspec validate hidden-terminal-resize-activity`. Verified by the server-core suite (2209 pass, 0 fail), root `tsc --noEmit`, `biome lint .` with no errors, and the change validating. `openspec validate --all` fails only on other in-progress changes.
- [ ] 3.3 Open a pull request on Gitea and read back every CI status. Verified when every status is `success` or `skipped`.
