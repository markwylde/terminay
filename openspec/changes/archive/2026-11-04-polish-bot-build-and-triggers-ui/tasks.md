## 1. Build notice and progress

- [x] 1.1 Give the completed build banner a dismiss control and retire it once seen and left, keyed by build id and state, in `src/workspace/bots/BotBuildProgress.tsx`. Verified by the dismiss, reload, and leave-and-return steps added to the image-build test in `e2e/bots.spec.ts`.
- [x] 1.2 Render build progress as a side sheet with a close control, a progress bar, and compact step rows with inline output. Verified by the same test's `Close` steps and its phone-width no-overflow check.

## 2. Grouped select

- [x] 2.1 Add `src/workspace/bots/GroupedSelect.tsx` and move the Profile agent picker and Model select onto it. Verified by `npx tsc --noEmit -p tsconfig.json` and `biome check` on `src/workspace/bots/` reporting nothing in the changed files.

## 3. Triggers

- [x] 3.1 Replace Source group and Source type with one grouped Source picker, and move the editor's other selects onto `GroupedSelect`. Verified by the trigger tests in `e2e/bots.spec.ts`, which drive the new picker through the `pick` helper.
- [x] 3.2 Add the quick-start empty state, and show the editor alone when a bot has no triggers. Verified by `newTrigger` in `e2e/bots.spec.ts` creating the first trigger from the empty state and finding it in the list.
- [x] 3.3 Run `npm run test:e2e -- e2e/bots.spec.ts`. Verified: 18 passed.
- [x] 3.4 Keep the unsaved draft when the editor is closed and reopened, and drive the new pickers in `scripts/bots-ui.test.mjs`. Verified: `npm run test:bots-ui` — 46 passed.
