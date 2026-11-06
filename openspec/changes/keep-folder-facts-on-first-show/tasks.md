## 1. Listing memory

- [x] 1.1 Add `src/workspace/gitListingMemory.ts` exporting `createGitListingMemory()` with `recall(projectId, projectRoot)` and `remember(projectId, projectRoot, listing)`. It keeps one entry per project and stores the root alongside it. Verified by 1.2.
- [x] 1.2 Add `src/workspace/gitListingMemory.test.ts` covering:
  - recall after remember returns the listing;
  - another project recalls nothing;
  - another root of the same project recalls nothing;
  - root A → B → A recalls nothing for A until A is remembered again;
  - a later remember replaces an earlier one, including an empty listing.

  Add the file to `npm run test:linked-folders`. Verified by `npm run test:linked-folders` passing.

## 2. Seed folder workspaces from it

- [x] 2.1 Give `useFileExplorerController` `listingMemory` and `listingRoot` options. Initialize `worktreePanelStatus`, `gitStatuses`, `referencesRef` and `shownGitProjectionRef` from `recall(project.id, listingRoot)`, and call `remember` from `publish`. Leave failure handling as it is. Verified by `npx tsc -p tsconfig.json --noEmit` and the e2e test in 3.1.
- [x] 2.2 In `src/App.tsx`, create one memory per `App` with `useRef`. Pass it to every `ProjectWorkspace`, and pass it to the controller with `listingRoot` set to the project's own `project.rootFolder`, not `explorerProject.rootFolder`. Verified by the e2e test in 3.1 and by `npx biome check` on the changed files.

## 3. End-to-end coverage

- [x] 3.1 Keep `a worktree card keeps its facts on screen while another folder is created or first selected` in `e2e/linked-folders.spec.ts`. It watches `alpha`'s card by folder id for any committed DOM state in which the label is not `alpha` or the facts line lacks `+2` or `no PR`, while `beta` is first selected and while a terminal's `git worktree add` brings `gamma` to the front. Verified by it failing before 2.x and passing after, through `npm run test:e2e`.
- [x] 3.3 In the same test, after `beta` is first selected, commit another line in `alpha` and expect `+3`, so the folder's own listing replaces what it started from. Verified through `npm run test:e2e` with `--repeat-each=3`.
- [x] 3.4 In `scripts/git-pane-sync.test.mjs`, check that a failed first listing keeps the remembered listing and reports the failure, and that a successful empty listing replaces it. Verified by `node --test scripts/git-pane-sync.test.mjs` passing.
- [x] 3.2 Run all of `e2e/linked-folders.spec.ts` and `e2e/file-explorer-sidebar.spec.ts` through `npm run test:e2e` to confirm the Changes and Files panes did not regress. Verified by both suites passing.

## 4. Spec

- [x] 4.1 Run `openspec validate --all`. Verified by this change validating cleanly. Five other changes already fail on `main` and are out of scope: `add-terminay-bots`, `linked-folders`, `one-window-one-server`, `outbound-bot-triggers` and `server-notification-manager`.
