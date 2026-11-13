## 1. Implementation

- [x] 1.1 Make `recentFoldersSearchable` true for any non-empty list. Verify: the `projectStart` unit test asserts one folder is searchable and none is not.
- [x] 1.2 Update `scripts/project-start-chooser-ui.test.mjs` for few folders and assert the search box shows with a single recent folder in the start-chooser e2e suite. Verify: `npm run test:e2e` for `project-start-chooser.spec.ts` passes in Docker.
- [x] 1.3 Run the typecheck, unit tests, Biome, and `openspec validate always-show-recent-search`. Verify: all pass.
