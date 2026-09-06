# Design: Performance Log window and startup phase visibility

## Context

Desktop startup runs as two chained async functions in `electron/main.ts`. `prepareEmbeddedRuntime()` (main.ts:1219-1511) awaits `app.whenReady()`, creates a hidden window, paints `desktopStartupLoadingDocument()`, then runs workspace restoration, `ServerTerminalAuthority` composition, `initializeWorkspace()`, the MCP control endpoint, the local and remote server-UI bundle hosts, and the WebRTC exposure. `completeDesktopStartup()` (main.ts:4623-4677) then unlocks the vault, records `main.ready`, fixes the node-pty helper, restores performance logging, builds the menu, applies the agent integration setting, and finally calls `launchDeferredCanonicalWindow()`, whose `loadURL` of the verified bundle is what replaces the splash. Every one of those boundaries is already a distinct `await` in one file. Nothing measures them.

The splash itself is a `data:` URL with `Content-Security-Policy: default-src 'none'; style-src 'unsafe-inline'` and no `<script>`. It is deliberately dependency-free so it can paint before any server-UI document binding exists. Crucially it already seeds `--terminay-loading-phase` from `-(Date.now() % 1600)`, a negative CSS animation delay that makes the five-dot animation resume at the correct point after any reload. That property was built for the splash-to-bundle handoff, and it is exactly what lets the phase line be updated by re-issuing `loadURL` rather than by adding script.

The existing opt-in collector, `DesktopPerformanceLogging` in `electron/diagnostics/performance.ts`, already computes almost every number the Performance Log window wants — `app.getAppMetrics()` process snapshots, a `monitorEventLoopDelay` histogram, heap and RSS totals — every five seconds. It is a pure sink: it hands each sample to the diagnostics writer and keeps nothing. There is no reader, and `local-desktop-diagnostics` forbids giving a renderer permission to read existing diagnostics. It also reports Electron processes only, so it can never show a terminal's shell.

Per-terminal usage needs a shell pid. `TerminalSessionSnapshot.pid` already carries it (`packages/server-core/src/terminalService/types.ts:201`), populated at spawn (`service.ts:518-526`) and also pushed through the optional `TerminalSessionLifecycle.terminalStarted(identity, shellPid)` hook. In embedded Desktop the `ServerTerminalAuthority` is constructed inside main, so main can read those snapshots directly without any protocol traffic. No CPU or memory sampling exists anywhere in server-core.

## Goals / Non-Goals

**Goals**

- Make the slow phase of a launch visible while it is happening, and reviewable afterwards.
- Give per-terminal CPU, memory, and disk for local terminals, so "which tab is cooking the fan" is answerable.
- Keep the new collection cheap enough to be always on for the timeline and on-demand for sampling, so the heavy opt-in collector remains the only thing that traces, profiles, or writes artifacts.
- Collapse the duplicated performance-logging control to the Settings switch that already exists.

**Non-Goals**

- Replacing, extending, or reading back the opt-in collector's JSON Lines artifacts. The Performance Log window is not a log viewer.
- Per-terminal usage for SSH or other remote project environments, and any resource-reporting surface on project-environment adapters.
- Historical comparison across launches. The timeline and samples live and die with the process.
- Changing the mark, the dot geometry, the colours, the animation, or the paint ordering of the startup document.

## Decisions

### 1. The phase line is painted by re-issuing the data-URL document, not by adding script

`desktopStartupLoadingDocument()` gains an optional phase label. Main calls `embeddedStartupWindow.loadURL(desktopStartupLoadingDocument(phase))` when a phase begins. The negative `--terminay-loading-phase` delay is recomputed from the same wall clock each time, so the dots resume mid-animation and never visibly restart — the identical mechanism that already carries the splash-to-bundle handoff.

**Boundary**: this keeps the loading document at `default-src 'none'` with no script and no network access. The alternative — relaxing CSP to allow an inline script plus an IPC channel into a pre-server document — would create a privileged surface that exists precisely during the window when nothing else is initialised yet, and it would need its own preload. The re-load approach adds no capability at all.

**Cost**: a `data:` navigation per phase, roughly ten over a launch. Each is a parse of a ~3 KB inline document with no subresources. The call is fire-and-forget (`void ... .catch()`), never awaited, so a phase is never delayed by the paint that names it — which the spec requires. `prepareEmbeddedRuntime()`'s existing first paint stays awaited, because the current comment there explains that overlapping `loadURL` with persistence recovery leaves Chromium pending; only the subsequent updates are unawaited, and they are dropped if one is already in flight.

*Alternative considered*: a hidden `<div>` toggled by CSS `:target` and a fragment navigation. It avoids re-parsing but requires the full phase vocabulary to be baked into the first document, which makes the phase list a presentation constant rather than a timeline output.

### 2. The startup timeline is a plain in-memory list owned by main, with an explicit phase vocabulary

New `electron/diagnostics/startupTimeline.ts` exposes `begin(phaseId)`, `end(phaseId)`, `fail(phaseId, reason)`, and `snapshot()`, storing `{ id, startOffsetMs, durationMs, outcome }` against `performance.now()`. Phase ids are a closed union — `electron-ready`, `startup-window`, `first-paint`, `workspace-restore`, `server-compose`, `workspace-init`, `mcp-endpoint`, `bundle-hosts`, `remote-exposure`, `vault-unlock`, `native-menu`, `agent-integration`, `ui-handoff` — each mapping to one product-authored display string. Nesting is one level deep: a phase may declare sub-phases, which is what makes the window's breakdown expandable.

The closed union is what keeps the phase line safe. The string the splash shows is chosen from a table in main, never interpolated from a path, id, host, or error — so the spec's "no path, identifier, host, credential, or error detail" holds by construction rather than by sanitisation.

**Boundary**: the timeline is never handed to the diagnostics writer, so it does not enter the Diagnostics folder and does not consume the always-on collector's event and burst budget. This is deliberate: the user chose current-session-only, and it keeps `Bounded local diagnostic history`, `Rotation and retention`, and `Diagnostic artifacts are sensitive local data` entirely untouched.

### 3. Lightweight sampling is a second, separate collector that only runs while a window is watching

New `electron/diagnostics/runtimeMetrics.ts`. It reuses the process-snapshot and event-loop-histogram helpers factored out of `performance.ts` but shares no state, no preference, and no output path with it. It holds a fixed-size ring (300 samples at a 1 s interval, ~5 minutes) and starts only when a Performance Log window subscribes, stopping when the last one closes.

**Boundary**: `Performance logging cannot degrade the product` requires bounded cadence so the logger cannot become a CPU source. Gating on an open window means the steady-state cost of this feature for a user who never opens it is exactly the ten timestamps of the timeline. It also means the two collectors can both be live without their intervals compounding, since the lightweight one omits stacks, traces, and IPC counting entirely.

*Alternative considered*: teaching `DesktopPerformanceLogging` to keep a ring and serve it. Rejected — the spec's opt-in requirement says it performs no periodic sampling until enabled, so anything always-on inside that class immediately contradicts its own contract.

### 4. Per-terminal sampling reads the authority main already holds; adapters are never asked

Main keeps a `sessionId → shellPid` map fed by `TerminalSessionLifecycle.terminalStarted` / `terminalExited`, which `ServerTerminalAuthority` already routes. On each tick main walks each pid's descendant tree and reads CPU, RSS, and cumulative I/O — `/proc/<pid>/stat` and `/proc/<pid>/io` on Linux, `proc_pid_rusage` via `ps`/libproc on macOS — with a per-tick deadline. Anything unreadable yields `{ available: false, reason }` rather than a stale or substituted number.

**Boundary**: this crosses no boundary at all, which is the point. Terminal-session identity is a security boundary for remote access, MCP, recordings, and agent status; introducing a resource-reporting call into the project-environment adapter contract would extend that boundary to SSH and Puzed endpoints for a diagnostic nicety. Because embedded Desktop composes the authority in-process, main reads local session snapshots directly and reports `available: false, reason: 'remote-environment'` for anything routed elsewhere. `server-core`, `@terminay/protocol`'s application protocol, and every adapter stay unchanged.

Disk is reported as cumulative bytes read and written since the shell started, plus a derived rate between samples. Cumulative counters are what the OS actually exposes; presenting an instantaneous "disk usage" percentage would be invented.

### 5. The window is an auxiliary route on the server-bundled UI, fed by one new host action and one event

`performance-log` joins `AUXILIARY_TITLES` (main.ts:2739) and the `AuxiliaryRouteController` in `src/shared/auxiliaryRoutes.tsx`, so it opens through the same `route.present` / `disposition: 'native-window'` path as Settings and Recordings, reusing `canonicalAuxiliaryRequest` validation, the `auxiliaryWindowsByPresentation` singleton map, and `createWindow({ auxiliary })`. The Help menu triggers it the way the notification path already triggers Remote Control: `sendCommandToFocusedWindow('open-performance-log')`, which the workspace UI turns into the canonical route request. That is why the menu item is unavailable with no local workspace window — there is no renderer to originate the canonical request, and inventing a main-originated bypass would be a second window owner.

The protocol gains `diagnostics.performance-snapshot.read` (action) and `diagnostics.performance-snapshot.changed` (event) in `packages/protocol/src/host.ts`, with `exactKeys` validators alongside the existing `diagnostics.performance-logging.*` pair and the same `nativeMenus` capability mapping. No new preload channel: it rides `requestAction` and `server-ui-host:event`.

**Boundary**: `Diagnostic ownership stays in Desktop main` forbids giving a renderer a file path, file handle, or permission to read existing diagnostics, and ADR-0005 requires every host capability to be a deliberate addition to a closed schema. A structured snapshot of `{ timeline, samples, terminals }` computed in main satisfies both: the renderer receives values, never a way to ask for values. The handler refuses when the requesting window's `TerminayHostContext.profileId` is not `embeddedLocalProfileId`, which is also how browser hosts are excluded — they get `{ handled: false }` from the bridge, the same mechanism that already hides the performance-logging switch.

### 6. Removing the Help checkbox

`createDiagnosticsHelpMenuItems` drops the `performanceLogging` option and gains `openPerformanceLog`, and its `reportFailure` operation union becomes `'reveal' | 'clear' | 'performance-log'`. The Settings switch and the `diagnostics.performance-logging.changed` broadcast that keeps it in sync are unchanged; only the second control disappears. `onEnabledChange` in main.ts:252-262 still rebuilds the menu, which is now a no-op for this item — worth simplifying, but the broadcast must stay.

## Risks / Trade-offs

- **Re-issuing `loadURL` on the splash could race the deferred canonical launch and leave Chromium pending, the exact failure the existing comment at main.ts:1230-1233 warns about.** → Phase updates are guarded by a single in-flight flag and are skipped entirely once `launchDeferredCanonicalWindow` has begun; the window's own `loadURL` of the bundle is the last navigation. An e2e assertion that the workspace still reaches its canonical root after a launch with many phase updates is the gate.
- **A phase name that is wrong or stale is worse than no phase name, because the user will act on it.** → Phases are opened and closed by the same `await` boundaries they describe, and a phase that ends without its successor beginning is displayed as still running rather than blank.
- **Per-terminal process-tree walking is per-platform and can be slow on a machine with many sessions.** → One tick has a single deadline across all sessions; sessions not reached report unavailable. The walk only runs while the window is open. Windows is out of scope for the packaged matrix (ADR-0004), so macOS and Linux readers are the whole surface.
- **The lightweight collector could drift into a second heavy collector over time.** → The spec's `Lightweight always-on runtime metrics` requirement enumerates what it may collect and explicitly forbids stacks, traces, profiles, heap snapshots, and IPC channel strings; a boundaries test asserts `runtimeMetrics.ts` never imports `contentTracing` or the diagnostics writer.
- **Removing the Help checkbox is a visible regression for anyone who used it.** → The Settings switch already exists in the Diagnostics category and is reachable by search; the Settings copy is updated to stop pointing at a Help item that no longer exists.

## Migration Plan

No data, schema, or persisted-state migration. `diagnostics-preferences.v1.json` keeps its shape — the lightweight collector has no preference, and nothing is added to it. Rollback is reverting the change: the Help checkbox returns, the splash loses its phase line, and no artifact, preference, or protocol state written by this change needs undoing, because it writes none.

Two existing suites assert the surfaces being changed and must be updated in the same commit: `scripts/local-desktop-diagnostics-menu.test.mjs` (menu shape) and `scripts/local-desktop-diagnostics-boundaries.test.mjs`, which regex-matches the literal `await embeddedStartupWindow.loadURL(desktopStartupLoadingDocument())` call site.

## Open Questions

- The phase vocabulary above is derived from the current `await` boundaries in `main.ts`. Whether `server-compose` needs sub-phases (vault open, project-environment load, shell-profile load) should be decided from the first real measurements rather than guessed now; the timeline supports one level of nesting either way.
- No in-force ADR needs revisiting. ADR-0005 and ADR-0008 both constrain this design and both are satisfied by keeping the window on the server-bundled bundle and adding one closed-schema host action; ADR-0011's trust-boundary table is unchanged because no new boundary is introduced and the `server UI bundle → client host` row's existing invariant covers the new action.
