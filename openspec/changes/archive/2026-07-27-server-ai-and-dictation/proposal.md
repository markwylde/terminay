## Why

AI title/note generation and dictation transcription ran as Electron services
while microphone capture is client hardware, so a remote client could use
neither. Making them work remotely must not hand provider secrets to a browser
or let a focus change redirect a generated title or a transcript into the wrong
terminal.

## What Changes

- Move Codex and Claude model discovery, environment setup, bounded terminal
  context, generation, normalization, timeout, and cancellation into
  server-core behind `createServerAiProviderAdapters`.
- Read generation context from the bounded server replay buffer instead of the
  client's xterm instance.
- Bind title and note generation to an exact panel and session plus an expected
  metadata revision.
- Keep microphone permission, `MediaRecorder`, audio level, silence detection,
  overlay, Stop, and Cancel in shared client UI, behind a transport-neutral
  `DictationCaptureClient` boundary that fixes one immutable target per
  capture.
- Add bounded server-side audio upload with backpressure, timeout,
  cancellation, media validation, transcription through vault credentials, and
  insertion only into the original authorized live terminal.
- Keep provider credentials, CLI configuration, environment, and raw provider
  output away from clients; remove temporary audio and redact provider errors.

## Capabilities

### New Capabilities
_None._

### Modified Capabilities
- `ai-tab-metadata`: provider execution moves to the server with bounded
  server-replay context, exact-target revision-checked mutation, and client
  isolation from provider internals.
- `dictation`: capture stays a client hardware capability behind an immutable
  target boundary while transcription, credentials, normalization, and
  insertion become server responsibilities.

## Impact

- `packages/server-core`: `AiMetadataService`, provider CLI adapters,
  dictation upload and transcription service, temporary audio hygiene.
- `packages/client-core`: `DictationCaptureClient`, `TerminayAiClient`.
- Renderer: `ServerDictationCapture` uses browser microphone APIs only, with no
  preload path.
- Vault: provider credentials resolved only inside scoped server-side
  callbacks.
