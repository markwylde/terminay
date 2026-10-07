## 1. Editing commands join the command model

- [x] 1.1 Add `edit-active-tab` and `edit-active-project` to `AppCommand` and to the command descriptor list in `src/keyboardShortcuts.ts`, each with a title, description, and keywords, and with no default accelerator in `defaultKeyboardShortcuts`. Verified by `node --test scripts/canonical-app-command-delivery.test.mjs` extended to assert both commands are declared, carry an empty default binding, and are rebindable like every other command.
- [x] 1.2 Handle both commands in `src/App.tsx`: `edit-active-tab` dispatches the existing `terminay-edit-terminal` path for the panel in front, and `edit-active-project` opens the active project's editor through the same route the switcher's long press uses. Verified by unit assertions in the same suite that each resolves to the existing editor route rather than a second definition, and by `npm run typecheck:workspaces`.
- [x] 1.3 Keep both commands scoped to what is in front: `edit-active-tab` opens no editor and reports that a tab must be open first, and the compact Command Bar control is disabled with no project in front. Reworded during apply — both editors were already Command Bar built-ins with this refusal behaviour, and adding a filtering mechanism to the Command Bar would have been new scope for no gain. Verified by `node --test scripts/compact-chrome-breakpoint.test.mjs` asserting the control's disabled binding and its styling, and by the e2e dashboard case.

## 2. Command Bar reach on every host

- [x] 2.1 Add **Open Command Bar**, **Edit Active Tab**, and **Edit Active Project** to the `view` menu in `ConnectedBrowserMenuBar` (`src/web/ConnectedWebRendererWorkspace.tsx`), dispatching through the same command vocabulary the existing View entries use. Verified by `node --test scripts/browser-app-capability-boundary.test.mjs` extended to assert the browser View menu lists every Desktop View command for which the browser has a capability, so a future Desktop-only addition fails the test rather than silently diverging.
- [x] 2.2 Add **Edit Active Tab** and **Edit Active Project** to the Desktop View menu in `electron/main.ts` beside the existing Open Command Bar item, each reading its accelerator from `getMenuShortcut`. Verified by the same parity assertion reading both menu definitions, and by `npm run lint`.

## 3. Compact chrome control

- [x] 3.1 Add an `onOpenCommandBar` callback and an `isCommandBarAvailable` flag to `CompactChromeRow`, rendering a Command Bar control between the dashboard control and the breadcrumb, disabled when unavailable, with an accessible name and title naming the Command Bar. Verified by `node --test scripts/compact-chrome-breakpoint.test.mjs` extended to assert control order is application menu, file-explorer toggle, dashboard, Command Bar, breadcrumb, connection, and that the control is disabled with no project in front.
- [x] 3.2 Wire the row in `src/App.tsx` to `executeCommandOnActiveProject('open-command-bar')` and to whether a project is in front. Verified by a unit case asserting the control dispatches the same command the accelerator does, with no second call into `setIsMacroLauncherOpen`.
- [x] 3.3 Style the control with the existing `compact-chrome__icon` rules plus a disabled state, keeping the row at 40px. Verified by an e2e case in `e2e/compact-chrome-switcher.spec.ts` at 320px asserting the chrome row still does not overflow horizontally, and by `npm run lint`.
- [x] 3.4 Add an e2e case opening the Command Bar by pressing the control at compact width and asserting the Command Bar dialog appears and no other menu opens. Verified by that case passing under `npm run test:e2e`.

## 4. The long press comes back

- [x] 4.1 Give the compact switcher's terminal rows the long-press gesture their project heading already carries, opening that terminal's editor, with a short press still activating the terminal. Verified by `node --test scripts/compact-switcher-ui.test.mjs` extended to assert the row is a long-press target, that a short press activates rather than edits, and that the move threshold matches the shared `useLongPress` contract so a scroll does not fire it.
- [x] 4.2 Add an e2e case at compact width long-pressing a terminal row and asserting the tab editor opens for that terminal. Verified by that case passing under `npm run test:e2e`.

## 5. Specs and checks

- [ ] 5.1 Run `openspec validate --all` and `npm run lint`, `npm run typecheck:workspaces`, and the touched `node --test` suites. Verified by all four reporting clean.
- [ ] 5.2 Open the pull request on Gitea with `tea`, then read back every commit status on the head SHA and confirm each is `success` or `skipped` before calling it green. Verified by the status listing itself.
