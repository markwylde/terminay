## 1. Child reports its fatal error

- [x] 1.1 Add a `fatal` host frame to the extension child protocol carrying error name, message, stack, and the exit code the child is about to use. Verified by the frame type existing in the child/host protocol types and `npm run typecheck:workspaces` passing.
- [x] 1.2 Send that frame from the `uncaughtException` and `unhandledRejection` handlers in `packages/server-core/src/extensions/child.ts` before `process.exit(70)`/`(71)`, tolerating a failed or disconnected send. Verified by a new case in `packages/server-core/test/extension-host.test.mjs` where a child that throws asynchronously produces a host-observed error name, message, and stack.
- [x] 1.3 Receive the frame in `ExtensionHost`, merge it into the failure it records, and keep recording the observed exit code or signal when no frame arrives. Verified by a test where the child is killed without reporting and the host still records the exit code.

## 2. Extension host lifecycle diagnostics

- [x] 2.1 Add an optional extension-host diagnostic callback to the server composition options, following `onDeliveryDiagnostic`, carrying extension id, transition, exit code or signal, consecutive-failure count, scheduled restart time, and the reported error. Verified by typecheck plus a unit test asserting an undefined callback is a silent no-op.
- [x] 2.2 Emit that callback from `ExtensionHost` for spawn, ready, child exit, failure, backoff scheduled, restart attempt, quarantine, and quarantine cleared. Verified by a new `packages/server-core/test/extension-host-diagnostics.test.mjs` asserting one record per transition with the expected fields.
- [x] 2.3 Add `local-server.extension.*` names to `DIAGNOSTIC_EVENT_NAMES` in `electron/diagnostics/core.ts`. Verified by `node --test scripts/local-desktop-diagnostics-core.test.mjs`.
- [x] 2.4 Wire the callback in `electron/main.ts` to `desktopDiagnostics.record` on the `lifecycle` channel, with `error` severity for failure and quarantine. Verified by `npm run test:desktop-diagnostics`.
- [x] 2.5 Confirm the recorded error keeps its name, message, and stack unaltered while `sanitizeDiagnosticText` still prevents a multi-line stack from forging log lines. Verified by a core test writing a stack containing newlines and asserting one parseable JSON line that still contains the full stack text. Keeping the stack readable required removing path redaction from the sanitizer; that decision and its consequences are recorded in design.md and in the `local-desktop-diagnostics` delta.

## 3. Agent observation diagnostics

- [x] 3.1 Supply `onAdmissionFailure` from the production composition that builds `ExtensionAgentRuntimeRegistry`, routing to the same diagnostic callback path. Verified by `packages/server-core/test/extension-agent-runtime.test.mjs` asserting a failed admission produces exactly one record with provider id, terminal identity, failure class, and reported error.
- [x] 3.2 Record provider match, admission success, session binding, and observer release alongside the failure case. Verified by an added test asserting a terminal that binds and one that never binds are distinguishable from the records alone.
- [x] 3.3 Assert the exclusion list holds: no journal record, prompt, tool input, tool result, or observed-project path appears in any agent record. Verified behaviourally in `packages/server-core/test/extension-agent-runtime.test.mjs`, which drives a provider returning all four and asserts none reaches a record — a stronger check than the static scan originally planned for `scripts/agent-extension-boundaries.test.mjs`.
- [x] 3.4 Add `local-server.agent.*` names to `DIAGNOSTIC_EVENT_NAMES` and wire them in `electron/main.ts`. Verified by `npm run test:desktop-diagnostics`.

## 4. Supervised restart

- [x] 4.1 Add a state-change listener to `ExtensionHost` so a failure is observable without polling `statuses()`. Verified by a unit test that receives a failure notification with its `restartAt`.
- [x] 4.2 Add the restart supervisor beside `activate` in `packages/server-core/src/extensions/composition.ts`, using injected `schedule`/`cancel`, restarting through `activate(extensionId)` when the backoff expires, and stopping at quarantine. Verified by a new `packages/server-core/test/extension-restart-supervisor.test.mjs` with a fake clock covering one crash, escalating backoff, and the quarantine stop.
- [x] 4.3 Confirm a restart re-publishes contributions and that `reobserveExistingTerminals` runs, so an already-running CLI binds without a new terminal. Verified by extending `packages/server-core/test/extension-live-rebind.test.mjs`.
- [x] 4.4 Confirm the supervisor is cancelled on server shutdown and on deliberate `stop`/disable, so no restart fires after either. Verified by tests asserting no restart occurs after each.

## 5. Quarantine recovery

- [x] 5.1 Make the explicit restart path stop the host if running, call `clearQuarantine()`, reset the crash window, and start. Verified by a test restarting a quarantined host and asserting it reaches `running` with a zero failure count.
- [x] 5.2 Confirm the Settings restart action reaches that path for a quarantined extension and reports the resulting state. Verified by `packages/server-core/test/extension-operations.test.mjs`.

## 6. Verification

- [x] 6.1 Run `npm run test:agents`, `npm run test:desktop-diagnostics`, and the server-core workspace tests. Verified by all three passing.
- [x] 6.2 Run `npm run lint` and `npm run typecheck:workspaces`. Verified by both passing clean.
- [x] 6.3 Run `npm run test:boundaries` to confirm no Electron import entered server-core. Verified by it passing.
- [ ] 6.4 Build and run the desktop app, force an extension child to throw, and confirm the Diagnostics folder contains the failure record with its stack, followed by a restart record. Verified by reading the produced log segment.
