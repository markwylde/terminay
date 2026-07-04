# Dictation Mode

## Status

Proposed. Researched against current OpenAI docs on 2026-07-04 and the current Terminay codebase.

## Summary

Add a Dictation Mode command that records microphone audio, shows an audio recorder overlay at the bottom of the active terminal, transcribes the finished utterance with OpenAI, then writes the transcript into the active terminal.

The recommended MVP is not realtime. Record locally in the renderer with `MediaRecorder`, stop on an explicit stop action or 5 seconds of silence, send the bounded audio blob to the Electron main process, call OpenAI `audio.transcriptions.create` with `gpt-4o-transcribe`, and write the returned text into the active PTY using the existing terminal write path.

Realtime transcription can be added later for live caption text while recording. OpenAI currently positions `gpt-realtime-whisper` as the low-latency streaming transcription model, but `gpt-4o-transcribe` is the better first default for final dictation quality when streaming deltas are not required.

## OpenAI API Findings

Sources:

- Speech to text guide: https://developers.openai.com/api/docs/guides/speech-to-text
- Realtime transcription guide: https://developers.openai.com/api/docs/guides/realtime-transcription
- Realtime and audio overview: https://developers.openai.com/api/docs/guides/realtime
- `gpt-4o-transcribe` model page: https://developers.openai.com/api/docs/models/gpt-4o-transcribe
- `gpt-realtime-whisper` model page: https://developers.openai.com/api/docs/models/gpt-realtime-whisper

Relevant facts:

- The Audio API transcription endpoint supports `gpt-4o-transcribe`, `gpt-4o-mini-transcribe`, and `gpt-4o-transcribe-diarize`, in addition to `whisper-1`.
- Audio transcription uploads are limited to 25 MB and support `mp3`, `mp4`, `mpeg`, `mpga`, `m4a`, `wav`, and `webm`.
- `gpt-4o-transcribe` and `gpt-4o-mini-transcribe` return `json` or plain `text`; `gpt-4o-transcribe-diarize` also supports `diarized_json`.
- OpenAI describes `gpt-4o-transcribe` as the higher-accuracy choice when streaming is not required.
- Realtime transcription sessions use `gpt-realtime-whisper` for live transcript deltas, with latency/accuracy delay options.
- For browser/mobile client audio, OpenAI recommends WebRTC over WebSocket for Realtime, but that adds session setup and ephemeral credential handling that is not needed for this MVP.

Recommended model defaults:

- MVP final transcript: `gpt-4o-transcribe`.
- Optional cheaper mode: `gpt-4o-mini-transcribe`.
- Optional realtime preview: `gpt-realtime-whisper`, with final insert still using either the final realtime transcript or a follow-up `gpt-4o-transcribe` pass depending on quality.

## Existing Integration Points

Command plumbing:

- `src/types/terminay.ts` defines the `AppCommand` union.
- `src/keyboardShortcuts.ts` defines command metadata and default shortcuts.
- `electron/main.ts` builds the native menu and forwards command clicks to the focused app window.
- `src/App.tsx` builds the Command Bar items and dispatches `AppCommand` values to the active project.

Terminal input:

- `TerminalPanel` already writes user input through `window.terminay.writeTerminal(sessionId, data)`.
- `electron/main.ts` handles `terminal:write` by appending input to recordings and sending `{ type: 'write', data }` to the PTY host.
- Dictation should reuse this path rather than adding a new PTY API.

Settings and secrets:

- `src/types/settings.ts` defines `TerminalSettings`.
- `src/terminalSettings.ts` defines defaults and Settings UI field metadata.
- `src/components/SettingsWindow.tsx` renders fields dynamically from that metadata.
- `electron/main.ts` already stores secrets in `secrets.json` encrypted with Electron `safeStorage`.
- `electron/preload.ts` exposes generic secret APIs, currently used by Macros.

Dependencies:

- `openai` is not currently in `package.json`.
- `ws` already exists for future server-side Realtime WebSocket work, but is not needed for the MVP.

## Product Behavior

Command:

- Add `start-dictation` to `AppCommand`.
- Add Command Bar item: `Start dictation`.
- Add native menu item under `Terminal`: `Start Dictation`.
- Suggested default shortcut: `CmdOrCtrl+Shift+D`. This avoids current defaults such as `CmdOrCtrl+L`, `CmdOrCtrl+K`, `CmdOrCtrl+T`, and `CmdOrCtrl+R`.

Recording lifecycle:

1. User triggers `Start dictation`.
2. If no active terminal exists, show a non-blocking error.
3. If no OpenAI API key is configured, open Settings to the OpenAI Dictation section.
4. Request microphone permission with `navigator.mediaDevices.getUserMedia({ audio: true })`.
5. Show a bottom overlay in the active terminal with:
   - pulsing/glowing recorder shell,
   - waveform bars,
   - elapsed time,
   - stop button,
   - status text for recording, transcribing, failed, and inserted.
6. Stop when either:
   - user clicks stop,
   - silence lasts 5 seconds,
   - an implementation max duration is reached.
7. Send the recording to main process for transcription.
8. Insert returned transcript into the active terminal.
9. Refocus the terminal.

Insertion behavior:

- Insert the transcript as text, not submit it.
- Do not append `\r` by default.
- Preserve terminal safety by using the same `window.terminay.writeTerminal` route as typed input.
- If the transcript includes newlines, wrap it with the existing `formatBracketedPaste` helper before writing so shells do not prematurely execute partial lines.

Recommended first-pass transcript cleanup:

- Trim leading/trailing whitespace.
- Convert trailing sentence punctuation exactly as returned by OpenAI.
- Do not remove internal newlines unless the UI adds a setting.
- Optional later setting: "Append trailing space" for command composition.

## Architecture

### Renderer Recording

Add a dictation controller in the active project workspace, not inside every terminal instance:

- State lives near `executeAppCommand` in `src/App.tsx`, because commands are project-scoped and already know the active panel/session.
- UI can be a new component, `src/components/DictationOverlay.tsx`, rendered inside `TerminalPanel` via new panel params or a window event.
- Keep only one dictation session active per app window. Starting a second session stops or ignores the first.

Use browser APIs:

- `MediaRecorder` to collect `audio/webm` chunks.
- `AudioContext` + `AnalyserNode` to draw waveform and measure volume.
- `requestAnimationFrame` for visual wave updates.
- A silence detector using RMS below a calibrated threshold for 5000 ms.

Main state machine:

- `idle`
- `requesting-permission`
- `recording`
- `stopping`
- `transcribing`
- `inserting`
- `failed`

### Main Process Transcription

Add a dedicated IPC surface instead of exposing raw secrets:

- `dictation:get-openai-key-status`
- `dictation:save-openai-key`
- `dictation:clear-openai-key`
- `dictation:transcribe`

`dictation:transcribe` accepts:

```ts
type DictationTranscribeRequest = {
  audioBase64: string
  mimeType: string
  fileName: string
  prompt?: string
  model?: 'gpt-4o-transcribe' | 'gpt-4o-mini-transcribe'
}
```

`dictation:transcribe` returns:

```ts
type DictationTranscribeResult = {
  text: string
  model: string
}
```

Main process responsibilities:

- Read/decrypt the stored OpenAI API key.
- Construct `new OpenAI({ apiKey })`.
- Convert incoming bytes to an SDK file object or temp file stream.
- Call `openai.audio.transcriptions.create({ model: 'gpt-4o-transcribe', file, response_format: 'json', prompt })`.
- Return only text to the renderer.
- Never expose the API key to the renderer.

Install dependency:

```bash
npm install openai
```

Suggested service files:

- `electron/dictation/service.ts`
- `electron/dictation/ipc.ts`

This mirrors the shape of `electron/aiTabMetadata/*` and keeps OpenAI-specific logic out of `electron/main.ts`.

### Settings

Add a new AI section in `terminalSettingsSections`:

- Section id: `openai-dictation`
- Category: `ai`
- Fields:
  - API key status/control. This probably needs a custom renderer because the existing field types do not include password/secret controls.
  - Transcription model: `gpt-4o-transcribe` default, `gpt-4o-mini-transcribe` optional.
  - Language hint: optional text field, default blank.
  - Prompt/context: optional textarea for domain terms, default blank.
  - Stop after silence: number, default 5 seconds.
  - Max recording duration: number, default 60 seconds.

Settings should store non-secret config under `TerminalSettings`, but store the API key through the encrypted secret mechanism. A stable reserved secret name like `openai-api-key` is enough; a purpose-built dictation IPC should upsert that record rather than asking users to pick it from the generic macro secret list.

Type additions:

```ts
export type DictationSettings = {
  enabled: boolean
  model: 'gpt-4o-transcribe' | 'gpt-4o-mini-transcribe'
  language: string
  prompt: string
  silenceStopSeconds: number
  maxDurationSeconds: number
}
```

Add `dictation: DictationSettings` to `TerminalSettings`.

### Native Menu and Command Bar

Code changes:

- Extend `AppCommand` with `start-dictation`.
- Add metadata and default shortcut in `src/keyboardShortcuts.ts`.
- Add a Settings shortcut row automatically via existing keyboard settings generation.
- Add Terminal menu item in `createAppMenu`.
- Add Command Bar item in `filteredMacros`.
- Add `case 'start-dictation'` in `executeAppCommand`.

### UI Placement

The recorder should sit inside the active terminal panel:

- `TerminalPanel` already has a wrapping `.terminal-panel` and a `.terminal-panel-root`.
- Render overlay after `.terminal-panel-root` as an absolutely positioned bottom layer.
- Add bottom padding or pointer-event handling so the overlay does not block normal terminal interaction except its own controls.
- Use the terminal tab/project color as accent if available.

CSS:

- Extend `src/App.css` or create `src/components/dictationOverlay.css`.
- Keep overlay compact: roughly 320-520 px wide on desktop, max-width `calc(100% - 24px)`, bottom 12 px.
- Use actual waveform bars driven by analyser samples, not decorative static bars.

Accessibility:

- Stop button must be keyboard focusable.
- Overlay uses `role="status"` for state changes.
- Escape stops/cancels the active dictation session.

## Optional Realtime Path

Realtime transcription is not required for the initial feature, but the architecture should not block it.

If added:

- Main process creates ephemeral Realtime client secrets using the stored API key.
- Renderer connects via WebRTC to OpenAI using the ephemeral key.
- Session type is `transcription`.
- Transcription model is `gpt-realtime-whisper`.
- Renderer displays partial transcript deltas during recording.
- On stop, either commit the realtime final transcript or run a final Audio API pass with `gpt-4o-transcribe` for quality.

Do not put the standard OpenAI API key in renderer Realtime code.

## Security and Privacy

- Store the OpenAI key only with Electron `safeStorage`.
- Do not write audio files to disk for the MVP unless SDK constraints force a temp file; if a temp file is used, write under `app.getPath('temp')` and delete it in `finally`.
- Do not log transcripts, audio bytes, or API keys.
- Show users that audio is sent to OpenAI when dictation is enabled.
- Use a max duration and 25 MB guard before sending to OpenAI.
- Stop microphone tracks as soon as the session ends.

## Error Handling

Handle these explicitly:

- microphone permission denied,
- no audio input device,
- no API key,
- OpenAI auth failure,
- upload too large,
- network failure,
- empty transcript,
- active terminal closed before insertion,
- app window/project loses focus while recording.

UI behavior:

- Permission/API-key errors should leave the terminal untouched.
- Transcription errors keep the overlay visible with retry/cancel actions.
- If the target terminal disappeared, copy transcript to clipboard and show a message.

## Implementation Order

- [x] Add types and normalized default settings for `dictation`.
- [x] Add OpenAI key storage IPC using the existing encrypted secret store.
- [x] Add `electron/dictation/service.ts` and `electron/dictation/ipc.ts`.
- [x] Add preload and shared type definitions for dictation IPC.
- [x] Add `openai` dependency.
- [x] Add `start-dictation` command, menu item, shortcut, and Command Bar item.
- [x] Add renderer dictation controller/state machine.
- [x] Add `DictationOverlay` UI and CSS.
- [x] Add insertion handling through `writeTerminal`, using `formatBracketedPaste` for multiline text.
- [x] Add tests.
- [ ] Add optional realtime preview as a second phase.

## Test Plan

Unit tests:

- `normalizeTerminalSettings` fills dictation defaults.
- shortcut utilities discover `start-dictation`.
- dictation service maps OpenAI responses to text and handles empty/failing responses.
- multiline transcript insertion uses `formatBracketedPaste`.

E2E tests:

- Command Bar shows `Start dictation` and shortcut label.
- Settings can save and clear the OpenAI key status without exposing the value.
- Mocked microphone + mocked `dictation:transcribe` inserts text into the active terminal.
- Stop button stops a recording.
- Silence timeout stops a recording.
- Missing API key opens/focuses the dictation settings section.

Manual tests:

- macOS microphone permission prompt.
- Multiple terminals/projects: dictation inserts into the terminal that was active when recording started.
- Terminal closed mid-transcription.
- Long recording near configured max duration.
- Network/auth failures.

## Open Questions

- Should transcript insertion target the terminal active at start time or at insertion time? Recommendation: start time, with clipboard fallback if it closes.
- Should dictation append a trailing space for command-line composition? Recommendation: no by default.
- Should the feature live under AI settings or Recording settings? Recommendation: AI, because the key/model choices are the primary configuration.
- Should final text use realtime transcript if realtime preview is enabled? Recommendation: keep final `gpt-4o-transcribe` pass until realtime quality is proven in Terminay usage.
