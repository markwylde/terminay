## 1. Extension API contract

- [x] 1.1 Extend `AgentObservationResult`'s `not-bound` variant in `packages/extension-api/src/types.ts` with `awaiting?: readonly AgentAwaitedDirectory[]` (a directory handle plus an optional `recursive` flag), document it on `AgentProviderDefinition.observe`, and regenerate `dist/types.d.ts`. Verified by `npm run typecheck` passing and the field appearing in the built declaration.
- [x] 1.2 Bound and validate the wait set on its way to the host: the child (`packages/server-core/src/extensions/child.ts`) keeps at most sixteen entries, translates only handles this context minted through the new `filesystem.directory-path` operation, and the runtime accepts only absolute, bounded paths. Verified by the runtime unit test that drops a relative path and dedupes a repeated one, and by the child's handle check (a foreign id yields no path).
- [x] 1.3 Add `notBound`, `awaitedTree`, `awaitedHomeDirectory` and `awaitedEnvironmentDirectory` helpers to `@terminay/extension-api`, and teach the fixture terminal that `'.'` names an environment root. Verified by the provider suites in 6.x asserting on `harness.observation().awaiting`.

## 2. Shared ramp schedule

- [x] 2.1 Add `packages/server-core/src/activity/rampSchedule.ts` implementing ADR-0022's 1/2/3/5/10/20 s minimum-interval ramp with a quiet-period reset, injectable `now`/`schedule`/`cancelSchedule` seams, and a `dispose()` that cancels the pending run. Verified by `packages/server-core/test/ramp-schedule.test.mjs`: first request runs promptly, requests inside an interval collapse to one run at its end, the interval widens to the ceiling and resets after quiet.
- [x] 2.2 Export it from server-core's index for later adoption by the git and explorer watches named in ADR-0022. Verified by the export existing and `npm run build` succeeding.

## 3. Child and host plumbing

- [x] 3.1 In `packages/server-core/src/extensions/child.ts` `admitAgentTerminal`, read `awaiting` from the observe result, resolve each handle to its canonical path through the context's own broker, and send `{ path, recursive }` entries on `agent.terminal.admitted`. Verified by the extension-host suite still passing and the Claude/Codex/Grok/omp/OpenCode suites naming the expected directories.
- [x] 3.2 Add the host-private `filesystem.directory-path` operation to `ExtensionAgentObservationOperation`, the host allowlist, and `LocalAgentObservationAdapter`; it answers only for a handle the context registered. Verified by typecheck and the existing adapter handle checks (`directoryFor` throws for an unknown id).
- [x] 3.3 The runtime never asks the broker to watch on the extension's behalf; it watches the resolved paths itself with a non-persistent `fs.watch`, keyed to the incarnation. Verified by the runtime unit tests driving the `watchDirectory` seam.

## 4. Extension agent runtime rewrite

- [x] 4.1 Delete `notBoundRetries`, `reobserveTimer`, `topologyTimer`, `topologySignature`, `topologyPolling`, `unboundTopologyReobserve`, `unboundSweeps` from `TrackedTerminal`; delete `MAX_NOT_BOUND_DISCOVERY_RETRIES`, `scheduleDiscoveryRetry`, `scheduleTopologyPoll`, `unboundPollDelay`, `pollTopology`, `topologyChanged`, `nextDiscoveryProvider`; delete the `reobserveDebounceMs`, `topologySignature`, `topologyPollIntervalMs`, `maximumUnboundPollIntervalMs` options. Verified by `grep` finding none of those names in `packages/server-core/src` and typecheck passing.
- [x] 4.2 Add `discovery?: Discovery` to `TrackedTerminal` holding the incarnation's watchers, its ramp and the providers tried since the last change; in `claimAndAdmit`, on `not-bound`, open one watch per named directory (recursive only when asked), walk the remaining capable providers once, and on any watch change re-walk the queue through the ramp; dispose on bind. Verified by the runtime unit tests: a change re-admits with no timer, churn collapses to one run per ramp interval, a wrapper's providers each add to one wait set, a bound terminal holds nothing.
- [x] 4.3 Treat a throwing observe as `not-bound` naming nothing, so the incarnation's existing wait set stands; wrapper rotation happens at once on the edge and again on each change. Verified by the rewritten "admission throw" and "throwing unmatched provider" tests.
- [x] 4.4 Dispose `discovery` on shell return, foreground replacement, terminal exit, context retirement, project removal, provider retirement, and `setObservationEnabled(false)`; admit nothing while integration is off. Verified by the "returning to the shell closes the wait set" test and by `agent-observation-gating.test.mjs` asserting watches close and none open while off.
- [x] 4.5 Rewrite `packages/server-core/test/extension-agent-runtime.test.mjs`: the ten-retry, topology-poll and widening-interval cases are replaced by watch-driven cases. Verified by `node --test` green with no reference to `topologySignature`.

## 5. Local observation adapter and Electron wiring

- [x] 5.1 Delete `topologySignature` and its writable-open-file hashing from `packages/server-core/src/extensions/localAgentObservation.ts`; keep `openFiles` for in-attempt binding evidence. Verified by grep and typecheck.
- [x] 5.2 Remove the `topologySignature` option from `electron/serverTerminalAuthority.ts`. Verified by the root `tsc --noEmit` passing after the application graph build.
- [x] 5.3 Update the `setObservationEnabled` and `observeIntegrationEnabled` doc comments that described topology sampling. Verified by grep for "topology" in `packages/server-core/src` and `electron` returning only the two comments about collaboration topology that describe process trees, not polling.

## 6. Providers name their wait sets

- [x] 6.1 Claude (`extensions/agent-claude-code/src/provider.ts`): with no accepted session file, name `~/.claude/sessions` (or `~/.claude` before it exists); with a session file but no journal, name the cwd-derived project directory, the projects root and the sessions directory. Verified by `extensions/agent-claude-code/test/binding.test.mjs` (four cases).
- [x] 6.2 Codex (`extensions/agent-codex/src/provider.ts`): name the sessions tree recursively, or the Codex home before the tree exists. Verified by `extensions/agent-codex/test/provider.test.mjs` (two cases, home and `CODEX_HOME`).
- [x] 6.3 Grok (`extensions/agent-grok/src/provider.ts`): name `~/.grok` or the `GROK_HOME` root, which holds the registry and session tree. Verified by `extensions/agent-grok/test/provider.test.mjs`.
- [x] 6.4 omp (`extensions/agent-omp/src/ompAgent.ts`): name every existing sessions root (recursively) and breadcrumb directory. Verified by `extensions/agent-omp/test/omp-agent.test.mjs`.
- [x] 6.5 OpenCode (`extensions/agent-opencode/src/provider.ts`): name the data root that holds the store, or its parent before it exists. Verified by `extensions/agent-opencode/test/opencode.test.mjs`.
- [x] 6.6 Conformance harness (`tests/agent-conformance`): record every `not-bound` with an empty wait set while the CLI is running and fail the Detect cell on any. Verified by `node --test tests/agent-conformance/harness.test.mjs` passing; the real-CLI matrix runs in its own gated lane.

## 7. End-to-end and specs

- [x] 7.1 Update `e2e/extension-agent-runtime.spec.ts` to describe the watch-driven bind (the wrapper already writes its rollout after launch). Verified by the spec passing in the Docker e2e container.
- [x] 7.2 Tighten `e2e/real-claude-code-agent-runtime.spec.ts` so the Agents row must appear within 15 s of the first prompt. Verified by review; the real-CLI lane (`test:e2e:ai-real-claude`) needs an authenticated `claude` and was not run here.
- [x] 7.3 Sync delta specs into `openspec/specs/` for `agent-status-and-sidebar`, `extension-platform`, and `agent-provider-conformance`. Done at archive time with `/opsx:archive`, as this repository's other changes are.
- [x] 7.4 Docs: `docs/` holds no description of agent discovery polling; the only "topology" references left in code are the two comments about collaboration process trees. Verified by grep.

## 8. Verification

- [ ] 8.1 Run the ADR-0021 idle-spawn measurement with a bound Claude terminal and an unbound `claude` waiting at its prompt; record the result under `openspec/adr/evidence/`. Not run: the measurement needs the rebuilt Desktop app running on the host, which this session cannot relaunch.
- [x] 8.2 `npm run lint`, root `tsc --noEmit`, every affected workspace's unit suite, and the three agent e2e specs in the Docker container. See the pull-request description for the run log; the Gitea pull request and its `.gitea/workflows/` statuses are opened after review.
