## Why

Local Desktop startup shows the Terminay mark and the five-dot indicator and nothing else. When a launch takes eight seconds instead of two, the user has no way to tell whether workspace restoration, the embedded server, node-pty, the vault, or the UI bundle is responsible — they can only watch dots. The same blindness continues once the workspace is up: a machine gets hot or a fan spins and there is no way to tell which terminal tab is doing it.

The heavy opt-in performance-logging collector does not answer either question. It is off by default, so it is never enabled during the slow launch a user actually wants explained, it writes to JSON Lines files that no UI reads back, and it reports Electron processes only — never a terminal's own shell. The information the user wants day to day is cheap to collect, but today it is either not collected at all or collected only into a file with no reader.

## What Changes

- Desktop main records a **startup phase timeline** for every launch: an ordered set of named phases from `app.whenReady()` through workspace restoration, embedded-server composition, vault unlock, menu construction, and the server-UI handoff, each with a start offset and duration. It is always on, costs one timestamp per phase, and is held in memory for the life of the process.
- The local startup loading document gains **a single line of phase text beneath the five-dot indicator**, naming the phase currently running. The mark, the dot geometry, the colours, the animation, and its cross-reload phase continuity are unchanged. **BREAKING** for the current spec text, which requires local startup to show no text; the remote loading state already shows a status message in this slot, so the chrome itself is unchanged.
- Desktop main runs a **lightweight always-on metrics collector**, separate from the opt-in heavy collector: a low-frequency sample of Electron process CPU and working-set memory, main-process event-loop delay, and — for terminals backed by the embedded Local server — per-session CPU, memory, and disk I/O sampled from the shell process tree. It keeps a bounded in-memory ring for the current session and writes nothing to the Diagnostics folder.
- The Help menu item **Performance Logging** is **REMOVED**. Enabling and disabling the heavy collector stays in Settings → Diagnostics, which already carries the switch, so the two controls collapse to one.
- The Help menu gains **Performance Log**, which opens or focuses a native auxiliary window rendering a new Performance Log view: the startup timeline as a proportional breakdown that expands phase by phase, live process and event-loop charts, and a per-terminal table of CPU, memory, and disk. The window reads a bounded, main-computed snapshot over the existing host bridge; it never receives a diagnostics file path, a log-reading capability, or a general-purpose logging channel.
- Terminals in SSH or other remote project environments report **not available** rather than a fabricated number. The Performance Log window is bound to the embedded Local profile; it describes this Desktop process and its local terminals, not a remote server.

## Capabilities

### New Capabilities

None. Both surfaces extend capabilities that already exist.

### Modified Capabilities

- `local-desktop-diagnostics`: adds an always-on lightweight metrics collector and startup phase timeline that are distinct from the opt-in heavy collector and never become disk artifacts; adds a bounded read-only snapshot the Performance Log window may request over the host bridge; replaces the Help menu **Performance Logging** checkbox with a **Performance Log** window item and removes the Help menu from the opt-in control's enable/disable contract.
- `connections-and-client-hosts`: the local embedded-server loading state shows a phase line beneath the dot indicator instead of no text.

## Impact

- `electron/startupLoadingDocument.ts` takes an optional phase label; `electron/main.ts` re-issues `loadURL` on the startup window as phases advance. The existing negative `--terminay-loading-phase` animation delay already keeps the dots in phase across a reload, so no script, network access, or CSP relaxation is introduced into that document.
- New `electron/diagnostics/startupTimeline.ts` and `electron/diagnostics/runtimeMetrics.ts` in Desktop main. `electron/diagnostics/performance.ts` is untouched except to share process-snapshot helpers.
- `electron/diagnostics/menu.ts` swaps the checkbox for an **Performance Log** item and widens its `reportFailure` operation union.
- `packages/protocol/src/host.ts` gains one action and one event in the existing `diagnostics.*` family, with their `exactKeys` validators and `nativeMenus` capability mapping. No new preload channel.
- `src/shared/auxiliaryRoutes.tsx`, `src/web/ConnectedWebRendererWorkspace.tsx`, and `AUXILIARY_TITLES` in `electron/main.ts` register a `performance-log` auxiliary kind alongside `settings`, `macros`, and `recordings`. New `src/components/PerformanceLogWindow.tsx`.
- Per-terminal sampling reads `TerminalSessionSnapshot.pid` from the `ServerTerminalAuthority` main already owns, so no server-core, protocol, or project-environment change is required.
- `src/components/SettingsWindow.tsx` copy is updated: the Diagnostics description no longer points at a Help menu checkbox that has been removed.
- `scripts/local-desktop-diagnostics-menu.test.mjs` and `scripts/local-desktop-diagnostics-boundaries.test.mjs` assert the current menu shape and the exact `loadURL(desktopStartupLoadingDocument())` call site, and both need updating.
