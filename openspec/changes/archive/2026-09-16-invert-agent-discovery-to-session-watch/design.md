## Context

Agent discovery today is a foreground edge followed by a poll. `ExtensionAgentRuntimeRegistry` (`packages/server-core/src/activity/extensionAgentRuntime.ts`) reacts to `foregroundProcessChanged`, admits the matching provider, and on `not-bound` retries ten times at a 100 ms debounce, then hands over to `pollTopology`, which asks Electron's local observation adapter for a `topologySignature` (`ps` descendants plus `lsof` writable files, hashed) on a doubling interval from 1.5 s to 60 s. Only that poll can notice the file the provider was missing.

For Claude the missing file is the session journal under `~/.claude/projects/<encoded cwd>/`, which the CLI creates on the first prompt. The fast window is over within a second of launch; by the time the user has typed a prompt the poll has widened to 6–12 s. The result is a ~20 s gap between "claude started" and the sidebar row.

ADR-0022 (in force) states the rule this design applies: polling is not permitted for state a watch can observe; a session file appearing is the discovery event; process identity is confirmed once at bind time; a switched-off feature schedules nothing; damping is a shared ramp on a floor. It lists "convert agent discovery to watching the sessions directory, removing `ps` and `lsof` from the idle path" as an open item.

Five built-in providers share the runtime. Only Claude keys its session file by pid. Codex keys rollouts by session id and time, Grok keeps a pid registry file, omp has several candidate roots and a breadcrumb directory, and OpenCode has a session store with no per-session file at all. The design has to work for all five without a per-provider host branch.

Boundaries in play: the terminal-session boundary (a provider may only observe the PTY tree of the terminal it was admitted for), the host-issued-context boundary (observation handles are minted by the host and scoped to one context), and the server/extension-child boundary (extensions are trusted Node programs, but every observation handle they use is host-issued).

## Goals / Non-Goals

**Goals:**

- A new agent session appears in the sidebar on the filesystem change that makes it bindable, not on a later poll tick.
- No process-listing or open-file binary runs while a terminal is idle, bound or unbound.
- Delete the retry counter, the debounce, the backoff, the topology signature and its wiring. Fewer timers, fewer `TrackedTerminal` states.
- One host mechanism that every provider drives declaratively, so no host code knows a provider's directory layout.
- Keep the terminal-scoped authority model: no new way for an extension to observe outside an admitted terminal context.

**Non-Goals:**

- Replacing the PTY foreground sampler (`tcgetpgrp`). ADR-0022 records it as the residual poll; it remains the leave-shell and return-to-shell edge.
- A global, extension-wide "sessions directory watch" opened at `activate()` that resolves pids to terminals itself. See Decision 1 for why not.
- Changing how binding evidence is proven, what a fingerprint is, or how the sidebar groups entries by project.
- Changing the journal follow path after binding. Renamed-session and subagent watches already exist and are untouched.

## Decisions

### 1. The provider names what it is waiting for; the host watches it for the incarnation

`AgentObservationResult`'s `not-bound` variant becomes `{ state: 'not-bound'; awaiting?: readonly AgentAwaitedDirectory[] }`, each entry a directory handle plus an optional `recursive` flag. The handles are ones the provider already obtained through `terminal.observation.files.resolveHomeDirectory` or `resolveDirectoryRelativeToEnvironment` during the attempt. The child translates each handle back to the canonical path the broker resolved for it (a new host-private `filesystem.directory-path` operation; a handle the context never minted yields nothing) and reports those paths in the `agent.terminal.admitted` payload. The runtime opens one non-persistent `fs.watch` per path, keyed to the foreground incarnation, and re-runs observation on the first change.

*Why the runtime watches paths itself rather than through the broker's watch operation (a correction to the first draft of this design):* the extension child runs the local observation adapter in-process, so the directory handles a provider holds live in the child's own adapter state and are not addressable from the server-side runtime. The broker's `watchDirectory` is also a listing-snapshot comparison driven by the caller, not a kernel watch. The path the child reports is still one the terminal-scoped broker resolved under the terminal's home or a declared environment variable; the provider cannot name an arbitrary directory.

A wait-set entry is shallow by default and recursive only when the provider asks (`awaitedTree`): Codex writes rollouts under a date tree and omp under a project tree, so those two name their sessions roots recursively; everything else names the directory whose own entries change. On Linux a recursive watch costs one inotify watch per directory, so a provider names the narrowest directory that will see the change, and the ramp bounds whatever churn a wide watch still sees.

*Why this over an extension-wide watch at `activate()`:* the user-facing description of this change ("each extension watches its sessions folder, then pairs the session with a terminal") is what happens, but the pairing direction matters. An extension-wide watcher would see a `<pid>.json` and need to ask the host "which terminal owns pid N". That is a new broker outside any admitted context, a new authority (pid→terminal) the host would have to prove on demand, and it only works for the one provider that keys files by pid. Three providers have no pid-keyed file, and OpenCode has no file-creation event. Naming the directory from inside the attempt keeps authority where it is today, needs no new IPC scope, and lets each provider name the cwd-derived project directory it actually needs, which a static manifest root cannot express.

*Why handles rather than paths at the extension API:* paths would let a provider name any directory on the host. Handles are already minted per context and are the only thing the provider can obtain, so the set of watchable directories is exactly the set the broker would resolve for that terminal.

*Alternative rejected:* the provider opening its own watch and returning an `AsyncIterable` that resolves when it thinks it can bind. That moves the timer/lifetime problem into five extensions and makes retirement a provider responsibility. The host already owns context lifetime; it should own the watch.

### 2. `not-bound` with no wait set ends discovery for the incarnation

There is no fallback timer. If a provider says it cannot bind and names nothing, the runtime drops the attempt and the next foreground edge is the only thing that can restart it. This is the hard line that makes ADR-0022 item 1 checkable: a `TrackedTerminal` has either open watches or nothing.

The conformance spec makes this a provider bug when the CLI is actually running: every provider must be able to name where its evidence will appear. The empty-process-snapshot case is covered the same way. Claude names `~/.claude/sessions` before it has seen a descendant, so a late-appearing process still gets picked up by its own session file being written.

### 3. Re-observation goes through the shared ramp from ADR-0022

A watch event does not call `observe` directly. It asks the ramp schedule for a run: promptly after a quiet period, then 1/2/3/5/10/20 s minimum spacing while events keep arriving, collapsing events inside an interval into one run. The repository does not yet have this helper as a shared module; this change introduces it in `packages/server-core/src/activity/` (name to be chosen at implementation, e.g. `rampSchedule.ts`) with the injectable `schedule`/`cancelSchedule` seams the registry already has, so tests can drive it with fake timers. It replaces `reobserveDebounceMs`. The git-status and explorer conversions named in ADR-0022 can adopt the same module later.

*Why not keep the 100 ms debounce:* ADR-0022 explains why a debounce is not a rate limit. A directory that is written every 150 ms would re-run `observe`, and therefore `ps`, every 150 ms.

### 4. What the runtime keeps and what it loses

`TrackedTerminal` keeps `identity`, `shellPid`, `incarnation`, `context`, `lastProcessName`. It gains one `discovery?: { dispose(): void }` holding the open watches and any pending ramp run. It loses `notBoundRetries`, `pendingReobserve`, `reobserveTimer`, `topologyTimer`, `topologySignature`, `topologyPolling`, `unboundTopologyReobserve`, `unboundSweeps`.

Methods deleted: `scheduleDiscoveryRetry`, `scheduleReobserve`, `scheduleTopologyPoll`, `unboundPollDelay`, `pollTopology`, `topologyChanged`. `MAX_NOT_BOUND_DISCOVERY_RETRIES` goes. Options deleted: `reobserveDebounceMs`, `topologySignature`, `topologyPollIntervalMs`, `maximumUnboundPollIntervalMs`.

`claimAndAdmit` becomes: claim, mint context, admit, then on `not-bound` add the named directories to the incarnation's wait set. For a generic wrapper (a `node` or `bun` foreground) every capable provider gets one attempt per foreground edge, each adding to the same wait set; a change in any watched directory walks the queue again from its head through the ramp. A matched provider is its own one-element queue. On a throw, the attempt is treated as `not-bound` naming nothing, so the wait set already gathered for the incarnation stands.

Foreground-driven replacement (a different provider matched, or a repeated match with no live root) no longer waits on a debounce: it cancels and re-admits at once, serialised per terminal so two edges cannot replace the same context concurrently.

`setObservationEnabled(false)` disposes every terminal's `discovery`. This keeps the doc-comment promise, now stated in terms of watches rather than spawns.

### 5. Plumbing the wait set from child to runtime

`agent.terminal.admitted` gains `awaiting?: { path, recursive }[]`: the canonical paths behind the handles, at most sixteen per result, resolved by the child through `filesystem.directory-path` on the same context. `host.ts` passes the payload through as `admitAgentTerminal`'s return value; the runtime accepts only absolute, bounded paths and caps an incarnation at thirty-two watched directories across every provider it tries. The paths cross the child/host boundary in the same direction and under the same trust as the open-file paths the adapter already returns to the child; the host is the more trusted side.

### 6. Every provider's wait set

| Provider | Names on `not-bound` |
|---|---|
| Claude | `~/.claude/sessions` (or `~/.claude` before it exists); once the session file names a session id, the cwd-derived directory under `~/.claude/projects`, the projects root, and the sessions directory. All shallow. |
| Codex | the sessions tree (`~/.codex/sessions` or `$CODEX_HOME/sessions`) recursively; before it exists, the Codex home, shallow |
| Grok | `~/.grok` or the `GROK_HOME` root, shallow: the registry is rewritten there when a session starts |
| omp | each existing candidate sessions root recursively, plus its breadcrumb `terminal-sessions` directory, shallow |
| OpenCode | the data root that holds the store (`$XDG_DATA_HOME/opencode` or `~/.local/share/opencode`), shallow; before it exists, its parent |

Each provider already resolves these directories to handles inside `observe`; the change is to keep the handles and return them instead of discarding them.

### 7. Deleting `topologySignature` from the local observation adapter

`localAgentObservation.ts` loses `topologySignature` and the writable-open-file enumeration it drove. `openFiles` stays because omp and OpenCode use it inside an attempt for binding evidence, which ADR-0022 permits ("confirmed once, at bind time"). `electron/serverTerminalAuthority.ts` stops passing the option.

## Risks / Trade-offs

- [A provider's wait set misses the directory that actually changes] → the conformance harness scenario "evidence written after launch" runs against each real CLI and fails the Detect cell; the e2e real-Claude suite asserts the sidebar row appears within the ramp's first interval of the journal being written.
- [Watch events on a busy directory such as `~/.claude/projects/<cwd>` fire for every journal append of other sessions] → the ramp bounds `observe` to one run per interval and widens to 20 s under churn; the watch is closed the moment the terminal binds, so bound terminals never pay this.
- [fs.watch on macOS and Linux reports directory changes with different granularity] → the runtime only needs "something changed", not which entry; Node 24 supports recursive watches on both platforms, and a watch that errors closes itself, leaving the next foreground edge as the recovery.
- [A foreground edge that is not a leave-shell edge could leak a watch] → watches are keyed to the incarnation and disposed on every path that bumps the incarnation or retires the context; `exact-once observer retirement` gets a test for the awaiting state.
- [Removing the retry path changes behaviour for wrapper rotation timing] → rotation now happens on a watch event; the wrapper e2e (`e2e/extension-agent-runtime.spec.ts`) is rewritten to write the rollout after launch and assert binding without a tick.
- [Dropping `reobserveDebounceMs` removes a knob some tests set] → those tests drive the injected `schedule` seam instead.

## Migration Plan

No persisted state changes. The extension API change is additive (an optional field on an existing result variant), so third-party providers that return a bare `not-bound` keep working, with the new semantics that they are not retried until the next foreground edge. The server-core constructor options and `topologyChanged` are internal and removed in the same change; Electron is updated with it. Rollback is reverting the change.

## Open Questions

- Should a bare `{ state: 'not-bound' }` from a third-party provider log a one-line diagnostic so the silence is explainable? Leaning yes, through the existing `onAdmissionFailure` seam, rate-limited to once per incarnation.
- ADR-0022 says "one schedule implementation, used everywhere". This change introduces that implementation for agent discovery only. The ADR step should record that the module is the shared one going forward, but no in-force ADR needs superseding.
