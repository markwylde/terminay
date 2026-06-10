# Terminal Activity Signals Specification

## Summary

Terminay's tab activity indicators should stop guessing from raw output and instead consume the explicit signals that modern shells and AI agents already emit:

- **OSC 9;4 progress sequences** (ConEmu/Windows Terminal protocol) — emitted by Claude Code for the duration of an agent turn.
- **OSC 133 / OSC 633 shell integration markers** (FinalTerm/VS Code protocol) — emitted by shells with integration installed, marking exact command start/finish with exit codes.
- **Attention signals** — terminal bell (BEL), `OSC 9;<msg>` and `OSC 777;notify;...` desktop-notification sequences, emitted by Claude Code and Codex CLI when a turn completes or input/permission is needed.
- **Foreground process polling** as a zero-cooperation fallback (iTerm2's approach).

The existing raw-output timer becomes the lowest-priority fallback, used only when no explicit signal is available for a session.

## What We Are Trying To Do

Today a tab is considered "working" when any pty output arrived within the last `greenDelaySeconds` (default 1s). This is flaky:

- AI agent TUIs (Claude Code, Codex) repaint spinners and rotating "tips" bars even while **idle and waiting for user input**, so their tabs flicker between busy and finished forever.
- Conversely, a long-running silent command (a build with buffered output) looks idle while it is actually working.
- There is no way to show "this tab needs your attention" (agent waiting for permission), which is the state users care about most.

The terminals we benchmarked solve this with layered signals, most-reliable first:

1. **iTerm2** uses OSC 133 shell integration (busy = `C` seen without a following `D`), falls back to foreground-process detection on the tty, and only then uses an output-silence timer (2s).
2. **VS Code** consumes OSC 633/133 for command tracking and OSC 9;4 for tab progress indicators.
3. **Ghostty / Windows Terminal** render OSC 9;4 progress natively, with a staleness timeout (~15s in Ghostty) so a crashed program cannot leave a tab busy forever.
4. **Warp** classifies agent tabs into working / blocked / completed / errored from agent notification signals.

Crucially, **Claude Code emits OSC 9;4 progress held across the entire agent turn** (state 3 = working, state 0 = done), and both Claude Code and Codex emit OSC 9 / BEL notifications when finishing a turn or awaiting approval. Parsing these gives us deterministic busy/idle/attention state for agent tabs with zero configuration, and fixes the tips-bar false positives because cosmetic repaints carry no signal.

The product behavior we want per tab:

- **Working**: an explicit busy signal is active (progress running, or a shell command executing), or — fallback only — recent raw output.
- **Attention**: the session asked for the user (bell or notification sequence) and the tab has not been viewed since. Overrides working/finished display.
- **Finished (unviewed)**: work ended (progress cleared, command finished, or output went quiet) and the user has not looked at the tab since.
- **Viewed**: nothing to report.

When any explicit signal source is active for a session, the raw-output heuristic must be ignored entirely for that session. That is the single change that stops agent tabs from flickering.

## Current Codebase Shape

Terminay is an Electron, React, Vite desktop app using xterm.js (`@xterm/xterm` v6) in the renderer and node-pty in a pty host process.

Activity detection today:

- `electron/ptyHost.ts` forwards `ptyProcess.onData` chunks verbatim to the renderer (`{ type: 'data', data }`). No inspection happens in the main/pty process.
- `src/App.tsx` (~line 4420) listens via `window.terminay.onTerminalData(...)` and calls `terminalActivityStoreRef.current.recordTerminalActivity(sessionId)` for **every chunk of output**, regardless of content. User input is recorded through the `terminay-terminal-user-input` custom event (~line 4454).
- `src/terminalActivityStore.ts` is a pure state machine mapping `lastActivityAt` / `lastUserInputAt` / suppression windows to `TerminalActivityState` (`'viewed' | 'recent' | 'unviewed'`) with deadline-based re-evaluation. Timings come from settings.
- `src/components/TerminalTab.tsx` and `src/components/DockTabChrome.tsx` render the indicator dot from Dockview panel params (`terminalActivityState`, `activityIndicatorsEnabled`, `showActiveTabActivityIndicator`, `showFinishedTabActivityIndicator`).
- `src/App.css` styles the dot: amber `#f6c343` for `recent`, green `#4fd17a` for `unviewed`.
- Settings live in `TerminalSettings.activityIndicators` (`src/types/settings.ts`, defaults/normalization/field definitions in `src/terminalSettings.ts`), persisted via Electron IPC.

The xterm.js `Terminal` instance for display is created in `src/components/TerminalPanel.tsx` (~line 238); pty data is written into it in the same component (~line 439). All project workspaces stay mounted (hidden via CSS, `App.tsx` workspace stack), but display instances are still the wrong place for detection: terminals can pop out to separate windows, and the remote client has a parallel pipeline. Detection therefore lives in the pty host, where every session's bytes always flow.

There is **no escape-sequence parsing anywhere** today: no OSC handlers, no bell handling, no title handling.

Unit tests run with `node --test` from `scripts/*.test.mjs`; e2e tests are Playwright specs in `e2e/`.

## Signal Protocols

Notation: `OSC` = `ESC ]` (0x1B 0x5D), terminated by `BEL` (0x07) or `ST` (`ESC \`). Accept both terminators.

### OSC 9;4 — progress (highest priority)

```
ESC ] 9 ; 4 ; <state> [ ; <progress> ] BEL/ST
```

| state | meaning | tab effect |
|---|---|---|
| 0 | remove progress (done) | busy ends |
| 1 | normal, `<progress>` = 0–100 | busy |
| 2 | error | busy (optionally error accent later) |
| 3 | indeterminate (Claude Code uses this while working) | busy |
| 4 | paused/warning | busy |

Rules (copied from Ghostty):

- `OSC 9;4;...` always parses as progress, never as an OSC 9 notification.
- Apply a **staleness timeout (default 15s)**: if no further `9;4` arrives and no other busy evidence exists, drop the progress-busy state so a killed program cannot pin a tab busy. Claude Code refreshes the sequence across the turn, so legitimate sessions stay alive.
- Any `9;4` state is also cleared when the pty exits.

### OSC 133 / OSC 633 — shell integration command tracking

```
ESC ] 133 ; A ST          prompt start            → idle
ESC ] 133 ; B ST          command-line editing    → idle
ESC ] 133 ; C ST          command executing       → busy
ESC ] 133 ; D [; exit] ST command finished        → idle (exit code available)
```

`OSC 633 ; A|B|C|D ...` (VS Code's variant) is treated as an alias for the same four states; other 633 subcommands (`E`, `P`) are ignored for now. Busy = `C` seen without a following `D`/`A`. A `D` immediately after `B` (no `C`) means the command was aborted — treat as idle, ignore the exit code.

### Attention signals

- `BEL` while output is being processed → xterm's `terminal.onBell`.
- `OSC 9 ; <message>` (iTerm2-style notification; **not** `9;4`).
- `OSC 777 ; notify ; <title> ; <body>`.

Any of these marks the session as **attention** if the tab is not the focused, visible tab at that moment (mirroring `tui.notification_condition = unfocused` semantics). Attention is sticky until the user views the tab. Claude Code sends these per its `preferredNotifChannel`, Codex per `tui.notification_method`; both default to channels we will now consume.

### Foreground process fallback

node-pty exposes `ptyProcess.process` — the name of the tty's current foreground process. `electron/ptyHost.ts` can poll it cheaply (e.g. every 1–2s, only for sessions with no explicit signal source) and report "foreground process differs from the spawned shell" as a weak busy signal. This is iTerm2's fallback and makes plain `sleep 30`-style commands register as working even with no shell integration and no output.

### Priority and arbitration

These are the **default rules implemented by the generic interpreter** (see Architecture); app-specific profiles can override them per signal kind. Per session, evaluate in order; the first source with an opinion wins:

1. Progress (OSC 9;4) active → working.
2. Shell command running (133/633 `C` pending) → working; `D` → finished.
3. Foreground process ≠ shell → working (only when neither 1 nor 2 has **ever** fired for this session — once a session proves it emits explicit signals, trust only those plus attention).
4. Raw output timer (current behavior) → working/finished. Disabled entirely whenever 1 or 2 has ever fired for the session.

Attention is orthogonal: it can attach to any state and is displayed with priority over working/finished. User input to a session clears its attention flag and (as today) suppresses indicators briefly.

## Product Decisions

- Add a fourth activity state, `attention`, to `TerminalActivityState`. Display: the existing dot in a distinct accent (suggest red/orange `#ff6b5e`) — same shape, no new chrome in v1.
- `working` keeps the amber dot, `finished/unviewed` keeps the green dot, so the indicator language is unchanged for existing users.
- Signal-driven detection is **on by default** (it only makes detection more accurate); the existing timer settings remain and continue to govern the fallback path and the `recent → unviewed` transition for fallback-driven sessions.
- Add one new setting: `activityIndicators.signalDetection` (boolean, default `true`) as an escape hatch, plus `activityIndicators.progressStaleSeconds` (number, default `15`).
- Exit codes from `133 D` are recorded but not rendered in v1 (no red/failed badge yet) — captured so a later spec can use them.
- Sequences are consumed for state but **not stripped** from the data stream; xterm.js already ignores unknown OSC codes for rendering, so passthrough display is unaffected.
- App-specific behavior lives only in interpreter profiles. v1 ships `claude-code`, `codex`, and `generic`; the generic profile alone must be sufficient for any app emitting standard sequences, so profiles are refinements, never requirements.

## Non-Goals

- Shipping our own shell-integration rc scripts (kitty/iTerm2 style). Users with VS Code/iTerm2 integration installed, and agent CLIs, already emit the sequences. A follow-up spec can add bundled scripts.
- Rendering progress percentages or progress rings in tabs (`9;4;1;<pct>` is mapped to plain busy in v1).
- Desktop/native notifications from OSC 9 / OSC 777 payloads (attention dot only in v1).
- Failed-command badges from `133 D` exit codes.
- The remote web client (`src/remote/App.tsx`) — parity is a follow-up, but because detection lives in the pty host, the follow-up is only syncing the computed activity state to remote clients (alongside the existing remote metadata sync), not re-implementing parsing.
- tmux passthrough handling.
- A user-facing plugin API for third-party interpreter profiles. v1's registry is internal, but the `SignalInterpreter` interface is the seam where external loading (or user-defined JSON rules) would attach without reshaping parsing, IPC, or the renderer.

## Architecture

### Design choice: where to parse

Two viable locations were considered:

- **Renderer-side**, registering OSC handlers on each visible xterm.js instance in `TerminalPanel.tsx`. Rejected: it ties signal detection to UI lifecycle. Popout windows, the remote client, and any future lazy panel rendering each become separate holes to patch, and activity state would exist only inside one renderer window.
- **Pty-host-side** (chosen), running a render-less terminal core per session where every byte always flows. This is how the reference terminals work: iTerm2 parses in its core, not the view layer, and VS Code attaches its shell-integration addon to `xterm-headless` in its pty host so state survives window reloads. It makes the host the single source of truth, gives the remote client parity for free later, and co-locates the foreground-process poll in the same pipeline.

Hand-rolling a streaming escape-sequence scanner in the host was rejected outright: correct VT parsing (sequences split across chunks, OSC embedded in DCS/APC string states, both terminators) is exactly where subtle bugs live, and xterm's parser has already solved it.

### 1. Signal parser (`electron/terminalSignalParser.ts`)

Each pty session in `electron/ptyHost.ts` gets a `@xterm/headless` `Terminal` (scrollback `0`, `allowProposedApi: true`) that every pty data chunk is written into before being forwarded to the renderer. A small module registers handlers on it and emits typed signal events:

- `terminal.parser.registerOscHandler(9, ...)` — distinguish `4;<state>[;<pct>]` (progress) from plain notification text.
- `terminal.parser.registerOscHandler(133, ...)` and `(633, ...)` — A/B/C/D command lifecycle.
- `terminal.parser.registerOscHandler(777, ...)` — `notify;title;body`.
- `terminal.onBell(...)` — bell.

Handlers return `false` so xterm's default handling is untouched; the headless instance exists purely for parsing. The parser knows nothing about tabs or stores; it just produces `{ kind: 'progress', state, progress } | { kind: 'command', phase, exitCode } | { kind: 'notification', title, body } | { kind: 'bell' }`.

Protocol signals are not sent to the renderer directly — they feed the interpreter layer below. Pty `resize` calls are mirrored onto the headless terminal so its state stays coherent; the headless instance is disposed when the session exits.

### 2. Signal interpreters (`electron/signalInterpreters/`)

Parsing answers "what sequence arrived"; it deliberately does not answer "what does that mean for this app". Apps differ, and the differences are exactly what makes naive detection flaky:

- **Claude Code** emits OSC 9;4 progress held across the turn — progress is the turn boundary; a notification on top of progress-clear distinguishes "needs you" from "finished".
- **Codex CLI** emits **no progress at all** — only an OSC 9/BEL notification on `agent-turn-complete` or `approval-requested`. Its spinner repaints would still flicker the raw-output fallback, so a Codex session must be interpreted as "notification = turn boundary, distrust raw output", something no universal rule can know.
- A plain shell with OSC 133 integration, a build tool emitting progress percentages, or some future agent will each have their own dialect.

To isolate these differences, interpretation is a **registry of interpreter profiles** in the pty host. The runtime owns per-session state and timers; profiles are pure logic:

```ts
type ProtocolSignal =
  | { kind: 'progress'; state: 0 | 1 | 2 | 3 | 4; progress?: number }
  | { kind: 'command'; phase: 'prompt' | 'input' | 'executing' | 'finished' | 'aborted'; exitCode?: number }
  | { kind: 'notification'; title?: string; body?: string }
  | { kind: 'bell' }
  | { kind: 'foreground'; busy: boolean; processName: string }

type SemanticActivity = {
  status: 'working' | 'idle'
  attention: boolean
  claimed: boolean      // true = this session has a trusted interpreter; renderer must ignore the raw-output fallback
  exitCode?: number
  source: string        // interpreter id + signal kind, for debugging/devtools
}

interface SignalInterpreter {
  id: string
  // Does this profile apply? Evaluated against session context (foreground process
  // name from polling, signals seen so far). Re-evaluated when the foreground changes.
  matches(context: SessionContext): boolean
  // Reduce a protocol signal into a semantic claim, or return null to fall through
  // to the next interpreter in the chain (ending at the generic interpreter).
  interpret(signal: ProtocolSignal, session: InterpreterSessionState): SemanticActivity | null
  // Optional: fires when a deadline scheduled via session.scheduleDeadline(ms) elapses
  // (used for the progress staleness timeout).
  onDeadline?(session: InterpreterSessionState): SemanticActivity | null
}
```

Profiles form a chain, most-specific first; a profile handles only the signals it has an opinion about and falls through for everything else:

1. **`claude-code`** — matches foreground process `claude`; claims the session; progress drives working/idle; notification while idle ⇒ attention.
2. **`codex`** — matches foreground process `codex`; claims the session; notification ⇒ idle + attention (turn boundary); otherwise working while the process is foreground.
3. **`generic`** — always matches; implements the Priority and Arbitration rules from the protocol section, including the explicit-signal latch and the progress staleness timeout. This is the path every other app takes — any program emitting standard sequences (a shell with OSC 133 integration, a package manager emitting 9;4 progress) is handled here with no profile required.

New harnesses get supported by adding one profile file and registering it — nothing in parsing, IPC, or the renderer changes. v1 keeps the registry internal (no third-party loading), but the interface is the seam where a user-facing plugin system would attach later.

The runtime emits `SemanticActivity` to the renderer as `{ type: 'activity', activity }` session messages alongside the existing `data` messages, exposed through `electron/preload.ts` as `window.terminay.onTerminalActivity(...)`. Events are sent only on change, not per chunk.

### 3. Display state tracking (`src/terminalActivityStore.ts`)

With interpretation in the host, the renderer store's job shrinks to what is genuinely a UI concern:

- merge `SemanticActivity` claims with user-side facts the host cannot see: which tab is focused/viewed, recent user input, tab-switch suppression;
- keep today's raw-output timer behavior for **unclaimed** sessions only (`claimed: false` or no activity events yet);
- map to display states: `working` ⇒ amber, idle-with-unacknowledged-finish ⇒ green `unviewed`, `attention` sticky until `markViewed`/`recordUserInput`;
- return the existing `{ state, nextDeadline }` shape so the re-evaluation timer plumbing in `App.tsx` is unchanged.

### 4. Foreground process polling (`electron/ptyHost.ts`)

Poll `ptyProcess.process` on an interval per session and feed changes into the interpreter runtime as `{ kind: 'foreground', ... }` protocol signals — the same pipeline as everything else. The foreground process name also drives profile matching (`claude`, `codex`). Polling can slow or pause for sessions where a profile has claimed the session via explicit sequences.

### 5. Wiring and display

- `App.tsx`: subscribe to `window.terminay.onTerminalActivity(...)` (mirroring the existing global `onTerminalData` subscription at ~line 4420); route into the store; keep panel params updated as today.
- `TerminalTab.tsx` / `DockTabChrome.tsx`: accept the new `attention` state; respect existing show/hide settings (attention shows even on the active tab is **false** by default — viewing the tab is acknowledgement).
- `App.css`: accent for `data-terminal-activity='attention'`.

### 6. Settings

- Add `signalDetection: boolean` and `progressStaleSeconds: number` to `TerminalActivityIndicatorSettings` with defaults, normalization in `normalizeTerminalSettings(...)`, and field definitions/labels in `src/terminalSettings.ts` so they appear and are searchable in the Settings window.
- When `signalDetection` is `false`, the store ignores signal inputs — behavior is exactly today's. (The host keeps parsing; the toggle is a renderer-side decision so flipping it doesn't require restarting sessions.)

### 7. Tests

- Unit tests (`node --test`, `scripts/` pattern) at each layer:
  - parser: every sequence form, both terminators, malformed payloads;
  - interpreters: generic arbitration (progress beats output; staleness timeout; latch; 133 C→D lifecycle including abort), the Claude Code profile (tips-bar scenario — continued output after `9;4;0` must stay idle; notification-while-idle ⇒ attention), the Codex profile (spinner output with no progress stays idle after a turn-complete notification), and profile matching/re-matching when the foreground process changes;
  - display store: attention stickiness and clearing, output fallback only for unclaimed sessions.
- E2E (Playwright, `e2e/terminal.spec.ts` style): a fake "agent" script that prints spinner frames forever while emitting `9;4;3` then `9;4;0` — assert the tab goes working → finished and stays finished despite continued output; a `133` C/D scripted command; a bell-driven attention case on a background tab.

## Open Questions

- Should attention also fire a native desktop notification (Notification API) when the app window is unfocused? Recommended as a fast follow, not v1.
- Should `9;4;2` (error state) eventually render differently from plain busy?
- Do we want to bundle shell-integration snippets for zsh/bash/fish so non-agent commands get exact tracking without VS Code/iTerm2 scripts installed?
- Should interpreter profiles eventually be user-extensible — declarative JSON rules (match process name → interpretation tweaks), loadable JS modules, or both? Which other harnesses (Gemini CLI, Aider, opencode) deserve built-in profiles next?

## Implementation Checklist

### Signal Parser (pty host)

- [x] Add `@xterm/headless` and create a headless `Terminal` per pty session in `electron/ptyHost.ts` (scrollback 0, `allowProposedApi: true`), fed every data chunk and mirrored on resize.
- [x] Create `electron/terminalSignalParser.ts` with typed signal events and an `attach(terminal)` registration helper.
- [x] Parse `OSC 9;4;<state>[;<progress>]` progress sequences, accepting both `BEL` and `ST` terminators.
- [x] Treat `OSC 9;<text>` (non-`4;` payload) as a notification signal, never as progress, and vice versa.
- [x] Parse `OSC 133;A/B/C/D[;exit]` command lifecycle markers, including the aborted `B→D` case.
- [x] Parse `OSC 633;A/B/C/D` as aliases of OSC 133 and ignore other 633 subcommands.
- [x] Parse `OSC 777;notify;<title>;<body>` notification sequences.
- [x] Surface `terminal.onBell` as a bell signal.
- [x] Emit protocol signals into the interpreter runtime (not directly to the renderer).
- [x] Dispose the headless terminal and handlers when the session exits.

### Signal Interpreters (pty host)

- [x] Define the shared `ProtocolSignal` and `SemanticActivity` types used by the parser, interpreters, and IPC.
- [x] Build the interpreter runtime in `electron/signalInterpreters/`: per-session state, ordered profile chain with fall-through, deadline scheduling, emit-on-change.
- [x] Implement the `generic` interpreter: priority arbitration (progress > command > foreground), explicit-signal latch, progress staleness timeout (default 15s), exit-code capture from `133 D`.
- [x] Implement the `claude-code` profile: progress as turn boundary, notification-while-idle as attention, session claiming.
- [x] Implement the `codex` profile: notification as turn boundary (idle + attention), session claiming so raw output is distrusted despite no progress sequences.
- [x] Match profiles on session context and re-match when the foreground process changes.
- [x] Forward `SemanticActivity` to the renderer as `{ type: 'activity', activity }` session messages and expose `window.terminay.onTerminalActivity(...)` in `electron/preload.ts`.
- [x] Clear interpreter state and pending deadlines when the session exits.

### Display Store (renderer)

- [x] Consume `SemanticActivity` events in the activity store: per-session status, attention, and claimed flags.
- [x] Ignore raw-output activity for display while a session is claimed by an interpreter.
- [x] Keep today's raw-output timer behavior for unclaimed sessions.
- [x] Add the `attention` state with stickiness, cleared by `markViewed` and `recordUserInput`.
- [x] Clear all signal state when the pty session exits or is deleted.

### Foreground Process Fallback

- [x] Poll `ptyProcess.process` in `electron/ptyHost.ts` and feed changes into the interpreter runtime as `foreground` protocol signals.
- [x] Use the foreground process name to drive interpreter profile matching.
- [x] Slow or pause polling for sessions claimed via explicit sequences.

### Display And Wiring

- [x] Subscribe to `window.terminay.onTerminalActivity(...)` in `App.tsx` and route activity into the store.
- [x] Add `'attention'` to `TerminalActivityState` and handle it in `TerminalTab.tsx` visibility logic.
- [x] Render the attention accent in `DockTabChrome.tsx` / `App.css` with priority over working/finished.
- [x] Suppress the attention signal when it fires for the currently focused, visible tab.

### Settings

- [x] Add `signalDetection` (default `true`) and `progressStaleSeconds` (default `15`) to `TerminalActivityIndicatorSettings`.
- [x] Add defaults and sanitization in `normalizeTerminalSettings(...)`.
- [x] Add Settings window field definitions with searchable labels and descriptions.
- [x] Bypass signal inputs in the store when `signalDetection` is disabled.

### Tests

- [x] Unit tests for the signal parser covering all sequence forms, both terminators, and malformed payloads.
- [x] Unit tests for the generic interpreter: progress overrides output, staleness timeout, explicit-signal latch, 133 C→D and abort.
- [x] Unit tests for the `claude-code` profile: tips-bar repaint scenario stays idle after `9;4;0`, notification-while-idle becomes attention.
- [x] Unit tests for the `codex` profile: spinner output with no progress sequences stays idle after a turn-complete notification.
- [x] Unit tests for profile matching and re-matching when the foreground process changes mid-session.
- [x] Unit tests for the display store: attention stickiness/clearing, output fallback only for unclaimed sessions.
- [x] E2E test: scripted fake agent emitting spinner output plus `9;4;3` / `9;4;0` — tab shows working then finished despite continued repaints.
- [x] E2E test: OSC 133 C/D scripted command shows working for the command duration and finished with no trailing flicker.
- [x] E2E test: bell on a background tab shows the attention indicator until the tab is viewed.

### Documentation

- [x] Update settings documentation for the new activity indicator options.
- [x] Note supported escape sequences (9;4, 133, 633, 777, BEL) in the README or docs so agent users know Terminay consumes them.
