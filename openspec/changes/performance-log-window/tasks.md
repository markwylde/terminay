## 1. Startup phase timeline in main

- [x] 1.1 Add `electron/diagnostics/startupTimeline.ts` with `begin`/`end`/`fail`/`snapshot`, a closed phase-id union, one product-authored display string per id, one level of sub-phase nesting, and `performance.now()` offsets. Verified by a new `scripts/local-desktop-diagnostics-startup-timeline.test.mjs` covering ordered phases, a phase left open, a failed phase, and the display-string table being total over the union.
- [x] 1.2 Instrument the existing `await` boundaries in `prepareEmbeddedRuntime()` and `completeDesktopStartup()` in `electron/main.ts` with `begin`/`end` calls for `electron-ready`, `startup-window`, `first-paint`, `workspace-restore`, `server-compose`, `workspace-init`, `mcp-endpoint`, `bundle-hosts`, `remote-exposure`, `vault-unlock`, `native-menu`, `agent-integration`, and `ui-handoff`. Verified by a test that drives a fake startup and asserts every phase id is opened and closed exactly once, in order.
- [x] 1.3 Mark the running phase as failed on the `recoverFailedDesktopBootstrap` path so a failed launch still yields a readable timeline. Verified by a unit test asserting the open phase carries the failure outcome and earlier durations survive.
- [x] 1.4 Assert the timeline never reaches the diagnostics writer. Verified by extending `scripts/local-desktop-diagnostics-boundaries.test.mjs` with a source check that `startupTimeline.ts` imports neither the diagnostics writer nor `node:fs`.

## 2. Splash phase line

- [x] 2.1 Give `desktopStartupLoadingDocument()` an optional phase-label parameter rendering a single subordinate line beneath the dots, keeping the mark, dot geometry, colours, keyframes, `prefers-reduced-motion` rule, and the `default-src 'none'` CSP unchanged, and keeping the `--terminay-loading-phase` negative delay recomputed per call. Verified by a unit test asserting the emitted document contains no `<script>`, the unchanged CSP string, and the label only when supplied.
- [x] 2.2 In `main.ts`, re-issue `embeddedStartupWindow.loadURL(desktopStartupLoadingDocument(label))` when a phase begins, unawaited, guarded by a single in-flight flag, and suppressed once `launchDeferredCanonicalWindow` has begun. Verified by a unit test asserting updates are dropped while one is in flight and after handoff starts, and that a rejected `loadURL` is caught.
- [x] 2.3 Update `scripts/local-desktop-diagnostics-boundaries.test.mjs`, whose regexes match the literal `loadURL(desktopStartupLoadingDocument())` call site, to the new shape while still asserting the first paint is awaited before workspace restoration. Verified by `npm run test:desktop-diagnostics` passing.
- [ ] 2.4 Add an e2e assertion that a launch with many phase updates still reaches the canonical workspace root and shows no blank window. Verified by `npm run test:e2e` passing.

## 3. Lightweight runtime metrics collector

- [x] 3.1 Factor the process-snapshot and event-loop-histogram helpers out of `electron/diagnostics/performance.ts` into a shared module without changing the opt-in collector's behaviour. Verified by the existing `scripts/local-desktop-diagnostics-performance.test.mjs` passing unmodified.
- [x] 3.2 Add `electron/diagnostics/runtimeMetrics.ts`: a 1 s bounded interval, a fixed 300-sample ring, process type/label/CPU/working-set, event-loop delay, heap and RSS totals, `start()`/`stop()` refcounted by subscriber, and no writer, no tracing, no stacks, no IPC counting. Verified by a new unit test covering ring overwrite at capacity, no sampling with zero subscribers, and stop-on-last-unsubscribe.
- [x] 3.3 Add a boundaries assertion that `runtimeMetrics.ts` imports neither `contentTracing`, the diagnostics writer, nor `node:fs`. Verified by `scripts/local-desktop-diagnostics-boundaries.test.mjs` passing.

## 4. Per-terminal local resource sampling

- [x] 4.1 **Simplified during implementation.** No lifecycle map is kept. `authority.service.listSessions()` already returns `pid` and `status` per session, so the sampler reads it each tick instead. Same behaviour, no `server-core` plumbing, and no stale-map risk. Verified by the sampler tests below driving session lists directly.
- [x] 4.2 Add platform process-table readers behind one injectable interface. Linux reads `/proc/<pid>/stat` (true instantaneous CPU from cumulative-tick deltas) and `/proc/<pid>/io` for disk; macOS uses one `ps -Ao pid=,ppid=,pcpu=,rss=` per tick. **Disk is Linux-only**: macOS has no per-process byte counter without native code, so `diskAvailable` is false there and the window says so once rather than showing an empty column per row. Verified by unit tests covering tree summation, disk rates, an unreadable table, a missing pid, and per-platform `diskAvailable`.
- [x] 4.3 Sample all local sessions under one per-tick deadline. A running session with **no local pid** is reported `remote-environment` — SSH sessions are a remote channel and never have one, so no environment lookup or adapter call is needed. Verified by unit tests for the deadline, the remote case, the not-running case, and that a failed read reports `unreadable` rather than the previous sample's numbers.
- [x] 4.4 Confirm no title, command line, argument, cwd, environment value, or PTY byte appears in a sampled record. Verified by a unit test asserting the emitted record's key set is exactly the permitted fields.

## 5. Host bridge contract

- [x] 5.1 Add `diagnostics.performance-snapshot.read` to `TerminayHostAction` and `diagnostics.performance-snapshot.changed` to `TerminayHostEvent` in `packages/protocol/src/host.ts`, with `exactKeys` parsing for both and the `nativeMenus` capability mapping. Verified by extending `packages/protocol/test/host.test.mjs` with accept and reject cases including an extra key and a wrong-typed field.
- [x] 5.2 Handle the action in `main.ts`'s `bindServerUiWindow` switch, returning `{ timeline, samples, terminals }` and refusing when the requesting context's `profileId` is not `embeddedLocalProfileId`. Verified by a unit test asserting a remote-profile context is refused and a local one returns a bounded snapshot.
- [x] 5.3 Broadcast `diagnostics.performance-snapshot.changed` per sample to subscribed Performance Log windows only, and start/stop the collector on first subscribe and last window close. Verified by a unit test asserting sampling begins on subscribe and stops when the last window is destroyed.
- [x] 5.4 Add `readDesktopPerformanceSnapshot` to `src/host/nativeActions.ts` and `subscribeDesktopPerformanceSnapshot` to `src/host/nativeEvents.ts`, both returning inert no-ops in a browser host. Verified by unit tests with `window.terminayHost` absent and with `{ handled: false }`.

## 6. Performance Log window

- [x] 6.1 Register `performance-log` in `AUXILIARY_TITLES` in `main.ts`, in `AuxiliaryRouteRequest`/`AuxiliaryRouteController` in `src/shared/auxiliaryRoutes.tsx`, and in `initialAuxiliaryRoute`, `nativeAuxiliaryRoute`, and `auxiliaryContent` in `src/web/ConnectedWebRendererWorkspace.tsx`. Verified by a unit test asserting `canonicalAuxiliaryRequest` accepts `/?auxiliary=performance-log` with matching `logicalViewId` and rejects a mismatched one.
- [x] 6.2 Add the `open-performance-log` command to the protocol command union, `sendCommandToFocusedWindow`, the shortcut registry, and its handler in `src/App.tsx` alongside `open-remote-control`. Verified by typecheck across the closed command union and by the auxiliary-route registration test; the e2e reuse assertion is folded into 8.2.
- [x] 6.3 Build `src/components/PerformanceLogWindow.tsx`: the startup timeline as a proportional breakdown with expandable sub-phases and the dominant phase visually distinguished, live process and event-loop charts from the sample ring, and a per-terminal table of CPU, memory, and disk resolving session names from the workspace state the window already holds. Verified by an e2e test asserting the dominant phase is identifiable and by a screenshot attached to the pull request.
- [x] 6.4 Render unavailable terminals as an explicit "not available" with their reason, never a zero or a blank. Verified by an e2e or component test with a remote-environment session in the snapshot.

## 7. Remove the Help checkbox

- [x] 7.1 Replace the `performanceLogging` option in `electron/diagnostics/menu.ts` with `openPerformanceLog`, presented as disabled when no local workspace window exists, and widen `reportFailure`'s operation union to `'reveal' | 'clear' | 'performance-log'`. Verified by updating `scripts/local-desktop-diagnostics-menu.test.mjs` to assert the new item set, the disabled state with no window, and that reveal and clear still work in that state.
- [x] 7.2 Update the Help submenu construction in `main.ts` and drop the now-unused menu rebuild in `desktopPerformanceLogging`'s `onEnabledChange`, keeping `broadcastPerformanceLogging`. Verified by a unit test asserting toggling the setting still broadcasts to renderers.
- [x] 7.3 Update the Diagnostics copy in `src/components/SettingsWindow.tsx` so it no longer references a Help menu checkbox, and add its search keywords for the Performance Log window. Verified by a component test asserting the removed phrasing is absent.

## 8. Verification

- [ ] 8.1 Run `npm run lint`, `npm run test:desktop-diagnostics`, and `npm run typecheck:workspaces`. Verified by all three green.
- [ ] 8.2 Run `npm run test:e2e` in its Docker isolation. Verified by the suite green.
- [ ] 8.3 Measure a cold launch with the window open and confirm the added phase updates and sampling do not increase time-to-workspace beyond run-to-run noise. Verified by before/after timings from five launches each recorded in the pull request.
- [ ] 8.4 Capture screenshots of the splash phase line and the Performance Log window's three panels. Verified by images attached to the pull request.
