# Terminal Recording Specification

## Summary

Terminay should support optional per-terminal session recording and a local timeline for replaying previous terminal sessions.

Recording is off by default. Users can enable "Record new terminals" in Settings, and each terminal can still be manually started or stopped from its tab context menu. Recordings are saved under a user-configurable directory, defaulting to:

```text
~/Documents/TerminaySessions/YYYY-MM-DD/
```

The recording file format should be asciicast v3 (`.cast`) so Terminay can reuse an existing terminal-session format instead of inventing a new one. Terminay should also store local metadata next to each cast file so the timeline can show useful app-specific context such as project, tab title, cwd, start/end time, duration, exit code, and recording state.

## What We Are Trying To Do

The user should be able to decide, globally or per terminal, whether a terminal session is recorded. When recording is enabled for a terminal, Terminay captures the session into a local `.cast` file. Later, the user can open a timeline view, browse saved sessions, and replay one without needing to keep the original terminal tab alive.

This feature should feel native to Terminay:

- Settings controls the default behavior and storage location.
- The terminal tab right-click menu controls one terminal's recording state.
- Recordings are tied to terminal metadata already known by the workspace, such as tab title, project, cwd, color, and emoji.
- Replay uses the same xterm rendering stack where possible.
- The file format remains compatible with the asciinema ecosystem.

The first version should focus on reliable local recording and replay. It should not require cloud sync, asciinema.org upload, video export, or a database.

## Current Codebase Shape

Terminay is an Electron, React, Vite desktop app.

The main workspace lives in `src/App.tsx`. It owns project tabs, Dockview panel registration, terminal creation, terminal activity tracking, the Command bar, and workspace-level state. A new terminal is created by calling `window.terminay.createTerminal({ cwd })`, then adding a Dockview panel with `TerminalPanelParams`. The panel params already carry terminal identity and metadata such as `sessionId`, title-related callbacks, project color, project list, note state, macro state, and activity state.

Terminal rendering and user input live in `src/components/TerminalPanel.tsx`. This component creates an xterm instance, loads fit/search/unicode/web-links addons, writes incoming PTY data from `window.terminay.onTerminalData(...)`, forwards typed data through `window.terminay.writeTerminal(sessionId, data)`, and emits `terminay-terminal-user-input` events for terminal activity tracking.

Terminal tab context actions live in `src/components/TerminalTab.tsx`. The current right-click menu supports closing the terminal, opening tab settings, adding/removing notes, and moving the terminal to another project. This is the right place to add "Start Recording" and "Stop Recording" actions once recording state is available through panel params.

Terminal process management lives in Electron:

- `electron/preload.ts` exposes the `window.terminay.*` API to the renderer.
- `electron/main.ts` owns IPC handlers, terminal session maps, settings persistence, app menus, and the bridge to PTY host processes.
- `electron/ptyHost.ts` wraps `node-pty`, emits raw PTY output, receives input writes, handles resize, and reports exit.

The most useful recording hook is in `electron/main.ts`, inside `createPtySession(...)`. PTY output is centralized there before it is sent to the renderer and remote access service:

- renderer output: `sendToSessionRenderer(session, 'terminal:data', ...)`
- remote output: `remoteAccessService.appendSessionData(session.id, message.data)`

Recording should hook into that same flow so output capture is independent of xterm rendering and works even if the terminal is not focused.

Settings are modeled as `TerminalSettings` in `src/types/settings.ts`, defaulted and described in `src/terminalSettings.ts`, rendered by `src/components/SettingsWindow.tsx`, normalized by `normalizeTerminalSettings(...)`, persisted in Electron's `terminal-settings.json`, and broadcast with `settings:terminal-changed`.

Existing specs live in `specs/` and use Markdown implementation checklists. This spec follows that pattern.

## Product Decisions

### Defaults

- Recording is disabled by default.
- Add a Settings option named "Record new terminals".
- When enabled, newly created terminals start recording automatically.
- A per-terminal context menu override can start or stop recording regardless of the global default.
- Stopping a recording should finalize the current file. Starting again later for the same terminal should create a new recording file, not append to the old one.

### Format

- Write asciicast v3 `.cast` files.
- The first line is the asciicast v3 header.
- Subsequent lines are newline-delimited JSON events.
- Output events use asciicast's `o` event code.
- Input events use asciicast's `i` event code when recording input is allowed.
- Resize events should be recorded so playback can match terminal geometry changes.
- The suggested extension is `.cast`.

The current official asciinema docs describe asciicast v3 as newline-delimited JSON, with a JSON header on the first line and 3-element JSON event arrays after it. They also state that v3 is supported by asciinema CLI 3.0, asciinema player 3.10.0, and asciinema server 20250509.

Reference: https://docs.asciinema.org/manual/asciicast/v3/

### Input Capture

- The user wants input captured, but with protection for sensitive entry.
- Terminay should record input events by default only when the terminal is not in a sensitive-input state.
- When input is considered sensitive, Terminay should either skip the input event or replace visible characters with a mask such as `*`.
- The first implementation should be conservative: prefer dropping sensitive input over leaking secrets.
- Add a future-facing setting for input capture policy if needed:
  - `none`
  - `record`
  - `record-with-sensitive-filter`

Important note: terminal applications do not provide a perfectly reliable universal "secure input mode" signal to external terminal emulators. Terminay can infer common cases, but it should not claim perfect password detection. Practical signals may include terminal echo behavior, bracketed paste/stateful terminal modes, application mode heuristics, shell prompts, and explicit local suppression windows. The spec should treat secret protection as best-effort unless a stronger signal is discovered during implementation.

### Storage

- Default root directory: `~/Documents/TerminaySessions`.
- Organize recordings by local date: `YYYY-MM-DD`.
- File names should be readable and collision-resistant.
- Suggested filename shape:

```text
HH-mm-ss__project-name__terminal-title__short-session-id.cast
HH-mm-ss__project-name__terminal-title__short-session-id.json
```

- Sanitize title/project/cwd fragments for file-system safety.
- Never overwrite an existing recording.
- If the configured directory is missing, create it.
- If the directory cannot be created or written, surface an error and leave the terminal running.

### Metadata

Store local JSON metadata next to each `.cast` file. The metadata is for Terminay's timeline, not for asciinema compatibility.

Suggested shape:

```ts
type TerminalRecordingMetadata = {
  version: 1
  castPath: string
  sessionId: string
  title: string
  projectId: string | null
  projectTitle: string | null
  projectEmoji: string | null
  projectColor: string | null
  cwd: string | null
  shell: string | null
  startedAt: string
  endedAt: string | null
  durationMs: number | null
  exitCode: number | null
  recordingState: 'recording' | 'stopped' | 'failed'
  cols: number
  rows: number
  capturedInput: boolean
  inputPolicy: 'none' | 'record' | 'record-with-sensitive-filter'
  sensitiveInputPolicy: 'drop' | 'mask'
  bytesWritten: number
  eventCount: number
}
```

The `.cast` header should also include useful portable fields where the asciicast v3 spec supports them:

- `version: 3`
- `term.cols`
- `term.rows`
- `term.type`
- `timestamp`
- `title`
- `env.SHELL`
- `env.TERM`

Terminay-specific metadata can be placed in the adjacent `.json` file rather than depending on non-standard header fields.

### Timeline

Add a local timeline view that scans the configured recordings directory. It should show recordings from `.json` metadata files and fall back to parsing `.cast` headers when metadata is missing.

Minimum timeline functionality:

- List recordings grouped by date.
- Search or filter by title, project, cwd, and date.
- Show recording status for incomplete or failed files.
- Open a recording in an in-app replay view.
- Reveal the recording file in the OS file manager.
- Delete a recording pair (`.cast` and metadata `.json`) with confirmation.

The timeline should not require an app database in the first version. A directory scan is enough, with caching if needed for responsiveness.

### Replay

Replay should render into an xterm instance using the recorded output stream. The first implementation can be an in-app replay panel or timeline detail view.

Expected controls:

- Play/pause.
- Restart.
- Scrub timeline.
- Speed control.
- Current time / total duration.
- Copy selected text from replay terminal.
- Open/reveal source file.

Replay should respect resize events when available. If replaying resize events creates a poor layout in Terminay's docked UI, the replay surface may keep a stable viewport and still feed the terminal resize to xterm internally.

### Per-Terminal UI

Each terminal tab context menu should show recording controls:

- "Start Recording" when the terminal is not recording.
- "Stop Recording" when the terminal is recording.
- Optional secondary action later: "Reveal Current Recording".

The tab should expose recording state visually without adding noisy text. A small icon in the tab header is enough, with a tooltip.

When a terminal exits:

- Active recording should be finalized.
- Metadata should record `endedAt`, `durationMs`, and `exitCode`.
- The file should remain available from the timeline.

When a terminal is closed before the process exits:

- The app already kills the PTY session.
- Active recording should finalize as part of session teardown.

### Settings UI

Add a Recording category or section in Settings.

Initial settings:

- `recording.recordNewTerminals`: boolean, default `false`.
- `recording.directory`: string, default `~/Documents/TerminaySessions`.
- `recording.captureInput`: boolean, default `true`.
- `recording.sensitiveInputPolicy`: select, default `drop`.
- `recording.openTimelineAfterSaving`: boolean, default `false` if added.

Directory picking should use an Electron dialog eventually. If the first pass only supports a path text input, it should still validate and normalize the path in Electron before writing.

### Command and Navigation

Add a way to open the timeline:

- App menu item.
- Command bar action.
- Optional toolbar/status action later.

The command should be searchable, for example "Open Recordings Timeline".

### Privacy and Safety

Recording terminal sessions can capture secrets, tokens, file paths, private repository names, and command output.

Required safeguards:

- Recording is off by default.
- Settings copy should make clear that recordings are local files.
- Input capture should avoid leaking likely sensitive input.
- Timeline delete should delete both metadata and cast files.
- Failed recordings should not silently disappear; show failed status in timeline if metadata exists.
- Do not upload recordings anywhere.
- Do not include recording files in remote access.

## Architecture

### 1. Settings Model

Extend `TerminalSettings` with a nested `recording` object. Update:

- `src/types/settings.ts`
- `src/terminalSettings.ts`
- `normalizeTerminalSettings(...)`
- `src/components/SettingsWindow.tsx` path setter allowlist if needed
- settings categories and sections

The existing `getValueAtPath(...)` can read nested values. `setValueAtPath(...)` already supports some known nested roots, so `recording` must be added to its allowed roots.

### 2. Electron Recording Service

Create a dedicated Electron-side service, likely under `electron/recording/`, rather than adding all recording code to `electron/main.ts`.

Responsibilities:

- Decide recording path from settings and session metadata.
- Open/write/finalize `.cast` files.
- Write/update `.json` metadata.
- Track active recordings by terminal session id.
- Append output/input/resize events with asciicast v3 relative timing.
- Handle failures and expose status.
- List recordings for the timeline.
- Delete/reveal recordings.

The service should be called by `electron/main.ts` at existing terminal lifecycle points.

### 3. PTY Output Hook

Hook output recording where `electron/main.ts` handles `PtyHostMessage` type `data`.

Current flow:

```ts
sendToSessionRenderer(session, 'terminal:data', { id: session.id, data: message.data })
remoteAccessService.appendSessionData(session.id, message.data)
```

Recording should append output near this flow:

```ts
recordingService.appendOutput(session.id, message.data)
```

This makes capture independent from renderer focus, xterm state, and remote clients.

### 4. Input Hook

Input writes currently arrive through IPC:

```ts
ipcMain.on('terminal:write', (_event, payload: { id: string; data: string }) => {
  const session = terminalSessions.get(payload.id)
  sendToPtyHost(session, { type: 'write', data: payload.data })
})
```

Recording input should hook here after sensitive-input filtering:

```ts
recordingService.appendInput(payload.id, filteredInput)
```

The input hook must not block sending data to the PTY.

### 5. Resize Hook

Terminal resize currently arrives through `terminal:resize`. The recording service should append a resize event whenever an active recording receives a new `cols`/`rows`.

The first header size should use the best known terminal size. Since terminal creation starts before the renderer fits xterm, the service may start with `80x24` and record the first real resize shortly after, or delay opening the recording until the first resize arrives.

Recommended approach:

- Create the recording immediately if auto-recording is enabled.
- Header starts with `80x24` unless a size is available.
- Record the first `resize` event as soon as the renderer sends it.

### 6. Session Metadata Flow

Electron currently knows the session id and PTY root pid, but richer UI metadata is already sent to remote access through `window.terminay.updateTerminalRemoteMetadata(...)`.

Recording can reuse that pathway or add a recording-specific IPC call. The cleanest first pass is:

- Extend the existing metadata payload handled by `terminal:update-remote-metadata`, or
- Add `terminal:update-recording-metadata` if coupling remote and recording metadata becomes confusing.

Needed fields:

- title
- project id/title/emoji/color
- tab color/emoji
- cwd if known

### 7. Renderer Recording State

Expose recording state through preload APIs:

- `getTerminalRecordingState(sessionId)`
- `startTerminalRecording(sessionId)`
- `stopTerminalRecording(sessionId)`
- `onTerminalRecordingChanged(listener)`
- `listTerminalRecordings(options)`
- `deleteTerminalRecording(recordingId)`
- `revealTerminalRecording(recordingId)`

`src/App.tsx` should subscribe to recording state changes and update the relevant terminal panel params. `src/components/TerminalTab.tsx` can then render context menu actions based on params instead of calling IPC blindly.

### 8. Timeline UI

Add a recordings timeline component under `src/components/recordings/` or a single `RecordingsWindow.tsx`, depending on whether it opens as a separate window.

Recommended first version:

- Separate Electron window, like Settings and Macros, to keep the main workspace uncluttered.
- Timeline fetches recordings through IPC.
- Replay opens inside the timeline window.

An in-workspace Dockview panel is also viable, but a separate window matches existing Settings/Macros patterns and avoids adding a new panel type before replay behavior is settled.

### 9. Replay Engine

Implement a small parser for asciicast v3:

- Read header line.
- Stream or parse event lines.
- Validate event tuple shape.
- Support `o`, `i`, and resize events.
- Ignore unknown event codes.
- Convert relative event intervals into a playable schedule.

Use xterm for rendering. Feed only output events into the replay terminal unless there is a deliberate visual treatment for input. Asciinema records input as events, but replay display is normally driven by output; input events are useful for analysis/search/export and can be shown later if desired.

### 10. Tests

Add coverage at both service and UI levels:

- Unit or node tests for filename sanitization, metadata normalization, asciicast event writing, and parser behavior.
- Electron IPC smoke coverage for start/stop/list/delete/reveal where practical.
- E2E coverage for enabling auto-record, opening a terminal, emitting output, stopping recording, seeing it in the timeline, and replaying it.

## Open Questions

- Which exact asciicast v3 event code should be used for resize in the first implementation, and how broadly is it supported by current players?
- Can `node-pty` or xterm provide a reliable echo/sensitive-input signal in the current setup, or do we need a conservative heuristic?
- Should recording start before or after the first renderer resize event?
- Should timeline open as a separate window or as a Dockview tab in the main workspace?
- Should input capture be configurable in the first release or hard-coded to "record with sensitive filter"?

## Implementation Checklist

### Research And Validation

- [x] Confirm asciicast v3 event codes needed for output, input, markers, and resize.
- [x] Verify current asciinema player support for v3 replay inside a browser/Electron app.
- [x] Investigate whether `node-pty`, xterm, or shell terminal modes expose a reliable sensitive-input/echo signal.
- [x] Decide first-release behavior for sensitive input when confidence is low.

### Settings

- [x] Add `recording` settings types to `src/types/settings.ts`.
- [x] Add recording defaults to `defaultTerminalSettings` in `src/terminalSettings.ts`.
- [x] Normalize recording settings in `normalizeTerminalSettings(...)`.
- [x] Add `recording` to the Settings path setter allowlist in `SettingsWindow`.
- [x] Add Settings category/section/fields for recording defaults and directory.
- [x] Add directory validation and home-directory expansion rules.
- [ ] Add an Electron directory picker if implementing browse UI in the first pass.

### Electron Recording Service

- [x] Create an `electron/recording/` service module.
- [x] Implement safe date-based directory creation.
- [x] Implement safe filename generation and collision handling.
- [x] Implement asciicast v3 header writing.
- [x] Implement output event writing.
- [x] Implement input event writing with sensitive-input policy.
- [x] Implement resize event writing.
- [x] Implement metadata JSON create/update/finalize.
- [x] Track active recordings by terminal session id.
- [x] Handle write failures without crashing terminal sessions.
- [x] Finalize active recordings on terminal exit, terminal kill, app quit, and renderer teardown.

### IPC And Preload APIs

- [x] Add IPC handlers for start/stop/get recording state.
- [x] Add IPC handlers for list/delete/reveal recordings.
- [x] Add an event channel for recording state changes.
- [x] Expose recording APIs through `electron/preload.ts`.
- [x] Add TypeScript types for recording messages and metadata in `src/types/terminay.ts`.
- [x] Ensure IPC payloads are validated before file-system operations.

### Terminal Lifecycle Integration

- [x] Start recording automatically for new terminals when `recording.recordNewTerminals` is enabled.
- [x] Append PTY output from `createPtySession(...)` data handling.
- [x] Append input from the `terminal:write` handler.
- [x] Append resize events from the `terminal:resize` handler.
- [x] Update recording metadata when terminal title/project/color/cwd metadata changes.
- [x] Finalize recording when `finalizeTerminalSession(...)` runs.
- [x] Finalize recording when a session is killed manually.

### Per-Terminal UI

- [x] Add recording state to `TerminalPanelParams`.
- [x] Subscribe to recording state changes in `src/App.tsx`.
- [x] Add Start Recording and Stop Recording actions to `TerminalTab` context menu.
- [x] Add a subtle recording indicator to terminal tabs.
- [x] Show errors if start/stop fails.
- [ ] Optionally add "Reveal Current Recording" for active or completed recordings.

### Timeline UI

- [x] Add an app command/menu action to open the recordings timeline.
- [x] Create a timeline window or workspace panel.
- [x] List recordings grouped by date from the configured directory.
- [x] Support search/filter by title, project, cwd, and date.
- [x] Show recording status, duration, exit code, and file location.
- [x] Add reveal-in-file-manager action.
- [x] Add delete action with confirmation.
- [x] Handle missing metadata by parsing `.cast` headers.
- [x] Handle broken/incomplete recordings gracefully.

### Replay

- [x] Implement an asciicast v3 parser.
- [x] Render replay output into xterm.
- [x] Add play, pause, restart, and scrub controls.
- [x] Add speed control.
- [x] Show current time and total duration.
- [x] Apply resize events during playback or define a stable fallback.
- [x] Preserve copy-selection behavior in replay terminals.
- [ ] Avoid loading very large recordings into memory if streaming is practical.

### Testing

- [ ] Add tests for settings normalization.
- [ ] Add tests for safe filename/path generation.
- [ ] Add tests for asciicast v3 writer output.
- [ ] Add tests for metadata finalization.
- [ ] Add tests for asciicast parser behavior.
- [ ] Add E2E test for manual start/stop recording.
- [ ] Add E2E test for auto-recording new terminals.
- [ ] Add E2E test for timeline listing and replay.
- [ ] Add E2E or integration test for deleting a recording.

### Documentation And Polish

- [x] Update README or user docs with recording behavior.
- [x] Document privacy limitations and sensitive-input best-effort behavior.
- [x] Add empty states for no recordings and no matching search results.
- [x] Add clear error states for unwritable recording directories.
- [x] Confirm recordings are local-only and not exposed through remote access.
