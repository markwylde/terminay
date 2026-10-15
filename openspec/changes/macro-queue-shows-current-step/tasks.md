## 1. Server publishes each step

- [x] 1.1 Add `onStep?: (snapshot: MacroRunSnapshot) => void` to `MacroRunOptions` and call it in `MacroRunner.execute` after setting `stepIndex`, before executing the step. Verify: a `macro-service.test.mjs` case records one callback per step with ascending `stepIndex`.
- [x] 1.2 In `macroService/protocol.ts` `run`, pass an `onStep` that appends `macros.run.changed` to the event journal. Verify: the existing failing test "a running macro publishes each step it reaches…" in `macro-protocol.test.mjs` passes.

## 2. Renderer never regresses a run's step

- [x] 2.1 In `useMacroRunController`, buffer snapshots for not-yet-registered runs while a launch is in flight, and on registration apply whichever of the buffered snapshot and the launch response is further along. Verify: a unit test feeding a step-3 snapshot before the launch response shows step 3 running.

## 3. End to end

- [ ] 3.1 Add an E2E case in `e2e/macros.spec.ts`: run a type/Enter/wait-for-idle ×3 macro, open the macro queue mid-run, and assert the running step advances past the first wait while the queue stays open. Verify: passes under `npm run test:e2e`.
- [x] 3.2 Run `openspec validate --all`, `npm run test -w @terminay/server-core`, and lint. Verify: all pass.
