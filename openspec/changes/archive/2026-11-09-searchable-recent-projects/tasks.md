## 1. Unbound the list

- [x] 1.1 Remove `MAX_RECENT_PROJECT_FOLDERS` from `packages/server-core/src/workspace.ts`: no trim in `withRecentProjectFolder`, no length check in `validateRecentProjectFolders`. Verified by `packages/server-core/test/project-start-choice.test.mjs` accepting 51 folders and keeping all of them.
- [x] 1.2 Remove the bound from `parseRecentListResult` in `packages/protocol/src/projectStart.ts` and from the workspace change-record parser in `packages/protocol/src/workspace.ts`. Verified by `packages/protocol/test/project-start.test.mjs` accepting 51 entries.
- [x] 1.3 `recentFolderRows` returns every entry. Verified by `src/workspace/projectStart.test.ts`.

## 2. Collapse and search in the chooser

- [x] 2.1 Add `visibleRecentFolders(rows, query, expanded)` and `RECENT_FOLDERS_COLLAPSED` (5) to `src/workspace/projectStart.ts`. Verified by unit tests in `src/workspace/projectStart.test.ts` for collapsing, multi-term case-insensitive matching on name and path, recency order, and expansion.
- [x] 2.2 Render the search box (more than five folders), the filtered collapsed list, a Show more control, and a no-match note in `ProjectStartChooser.tsx`, with Enter opening the first available match and Escape clearing. Keep Left/Right/Home/End for text editing in the search box. Verified by `scripts/project-start-chooser-ui.test.mjs`.
- [x] 2.3 Style the search box and Show more in `projectStart.css`, fitting the compact layout. Verified by `npx biome check` and `scripts/project-start-chooser-ui.test.mjs`.

## 3. Verify

- [x] 3.1 `npx tsc -p tsconfig.json --noEmit`, workspace typecheck, and `openspec validate --all` pass.
- [x] 3.2 `e2e/project-start-chooser.spec.ts` still passes through `npm run test:e2e`.
