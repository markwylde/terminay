## 1. List

- [x] 1.1 Render triggers as a table with status, last checked, last fired, next, enable, Run now, and delete, in `src/workspace/bots/BotTriggersPanel.tsx`. Verified by the Triggers harness test in `scripts/bots-ui.test.mjs`, which checks the row's plain-words condition, missed note, Run now, and full-width layout, and saves a `triggers-table` screenshot.
- [x] 1.2 Open the editor as a sheet that keeps its draft. Verified by the harness test that closes the editor and finds the draft on New trigger.

## 2. Editor

- [x] 2.1 Hide problems until the form is touched, drop preview refusals, and show save errors in the footer. Verified by the harness interval test, which sees the inline hint after editing, and by `e2e/bots.spec.ts`.
- [x] 2.2 Replace the repeat checkbox with the Fire picker. Verified by `npx tsc --noEmit -p tsconfig.json` and the e2e trigger tests.
- [x] 2.3 Run `npm run test:bots-ui` and `npm run test:e2e -- e2e/bots.spec.ts`. Verified: both pass.
