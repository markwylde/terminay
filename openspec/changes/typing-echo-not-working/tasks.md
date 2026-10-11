## 1. Reducer tests first

- [x] 1.1 Add cases to `packages/server-core/test/activity-reducer.test.mjs` for each scenario in the delta spec: typing at a prompt, continuous typing, typing just after output, output continuing after typing stops, a command whose output outlasts the window, a command that finishes inside it, and a session claimed by a command-executing marker. Verified by the new cases failing against the current reducer for the typing, continuous-typing, typing-just-after-output, and finishes-inside cases.
- [x] 1.2 Add a case asserting that echoed output inside the window returns no event and leaves `snapshot()` equal to the snapshot taken after the `userInput` signal. Verified by that case failing against the current reducer.

## 2. Reducer

- [x] 2.1 In `applyRawOutput` (`packages/server-core/src/activity/reducer.ts`), after `expire`, do not record the chunk (`rawActivityAt`, `authority`, `source`, `acknowledged`) when `recentInput(session, at)` is true, and still derive and commit. Verified by the cases from 1.1 and 1.2 passing.
- [x] 2.2 Review the existing raw-output cases in `activity-reducer.test.mjs` and change only those whose intent the new requirement alters. Verified by the server-core suite passing (1304 of 1304) with no existing assertion changed.
- [x] 2.3 Confirm no deadline was added: `nextDeadline()` returns the same value before and after an echoed chunk inside the window. Verified by an assertion in the case from 1.2.

## 3. End to end

- [x] 3.1 Add a service-level case that feeds a `userInput` signal and then PTY bytes through `TerminalActivityService` and asserts no working event is emitted, and that bytes fed one second later emit one. Verified by the case passing in the server-core suite.
- [x] 3.2 Extend the activity-indicator coverage in `e2e/terminal.spec.ts` with a terminal that has no shell integration: typing shows no working indicator on its tab, and a command that prints for three seconds does. Verified by the case passing through `npm run test:e2e` with the fix and failing with it disabled (the row read `working` while typing); the full suite runs in pull-request CI.

## 4. Validation

- [x] 4.1 Run `openspec validate --all`. Verified by it passing.
- [x] 4.2 Run the repository typecheck and lint for server-core. Verified by both passing.
- [ ] 4.3 Open a pull request on `origin` and read back every commit status. Verified by each status being `success` or `skipped`.
