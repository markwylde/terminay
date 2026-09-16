## Why

A freshly started `claude` takes up to ~20 s to appear in the Agents sidebar. The provider needs the CLI's session journal, which only appears after the first prompt; by then the runtime's ten-retry fast window (~1 s) has expired and the fallback topology poll has backed off to 6–12 s between sweeps. ADR-0022 already records this poll as a defect: every fact the provider needs is a file in a watchable directory, so the appearance of that file is the discovery event and no timer should be waiting for it. This change implements ADR-0022 item 4 and its third open item.

## What Changes

- **Discovery is driven by watching, not sampling.** When a provider cannot bind yet, it names the directories whose change would alter its answer. The host watches exactly those directories through the existing terminal-scoped watch broker and re-runs observation on the first change. No timer re-runs observation.
- **`not-bound` carries what it is waiting for.** The provider observation result gains an `awaiting` list of directory handles. A `not-bound` result with nothing to await ends discovery for that foreground incarnation until the next foreground edge.
- **The runtime loses its poll machinery.** The not-bound retry counter, the 100 ms debounce, the exponential unbound backoff, the topology signature sampler and its `ps`/`lsof` spawns are removed from the extension agent runtime and the local observation adapter. The `topologySignature`, `topologyPollIntervalMs`, `maximumUnboundPollIntervalMs` and `reobserveDebounceMs` options go with them. **BREAKING** for the server-core registry constructor and for the `topologyChanged` entry point, both internal.
- **Re-observation is damped by the shared ramp from ADR-0022**, so a directory that churns cannot free-run observation, while the first change after a quiet period runs promptly.
- **Every built-in provider declares its wait set.** Claude waits on `~/.claude/sessions` and the cwd-derived project directory under `~/.claude/projects`; Codex on its sessions root; Grok on `~/.grok`; omp on its candidate session roots; OpenCode on its session store directory.
- **Nothing on the idle path spawns a process.** `ps` runs once per observation attempt, and observation attempts happen only on a foreground edge or a watched-directory change.

## Capabilities

### New Capabilities

_None._

### Modified Capabilities

- `agent-status-and-sidebar`: the "Discovery windows and retries" requirement is rewritten. Discovery is armed by a foreground edge and re-armed only by a change in a directory the provider named; the ten-retry window, topology polling and the widening interval no longer exist. "An unresolved journal binds nothing" no longer refers to ordinary retries. The observation environment requirement gains the rule that no process inspection runs while a terminal is idle.
- `extension-platform`: the agent provider observation contract is extended so a `not-bound` result may name terminal-scoped directory handles to await, and the host's obligation to watch them and re-observe on change is specified.
- `agent-provider-conformance`: the detect capability requires each provider to name a non-empty wait set when its session evidence is not yet present, and the shared harness proves that a session file or journal appearing after the process starts is bound without a process-table sweep.

## Impact

- `packages/extension-api/src/types.ts`: `AgentObservationResult` `not-bound` variant gains `awaiting?: readonly AgentDirectoryHandle[]`. Additive for providers.
- `packages/server-core/src/activity/extensionAgentRuntime.ts`: `TrackedTerminal` loses `notBoundRetries`, `topologyTimer`, `topologySignature`, `topologyPolling`, `unboundTopologyReobserve`, `unboundSweeps`, `pendingReobserve`, `reobserveTimer`; gains a single `discoveryWatch` disposable. `scheduleDiscoveryRetry`, `scheduleTopologyPoll`, `pollTopology`, `unboundPollDelay`, `topologyChanged` are deleted.
- `packages/server-core/src/extensions/localAgentObservation.ts`: `topologySignature` and its open-file enumeration are deleted.
- `packages/server-core/src/extensions/child.ts` and `host.ts`: the admit result carries the awaited handles back to the runtime; the runtime opens the watches through the same broker the provider used, in the same context.
- `electron/serverTerminalAuthority.ts`: stops wiring `topologySignature`.
- `extensions/agent-claude-code`, `agent-codex`, `agent-grok`, `agent-omp`, `agent-opencode`: each `observe` returns its wait set on `not-bound`.
- Tests: `packages/server-core/test/extension-agent-runtime.test.mjs` (retry-count and topology-poll cases replaced by watch-driven cases), `agent-observation-gating.test.mjs`, `tests/agent-conformance`, `e2e/extension-agent-runtime.spec.ts`, `e2e/real-claude-code-agent-runtime.spec.ts`.
- Settings: `agentIntegration` off still schedules nothing; the gate now closes watches instead of timers.
