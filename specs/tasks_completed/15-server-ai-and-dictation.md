# Server AI metadata and dictation

## Goal

Move AI provider execution and dictation transcription into Terminay Server
while keeping bounded context, microphone capture, consent, and exact terminal
targeting at their proper boundaries.

## Governing specifications

- [AI tab metadata](../features/ai-tab-metadata.md)
- [Dictation mode](../features/dictation.md)
- [Server-owned workspace state](../features/server-owned-workspace-state.md)

## Why this is active

AI/provider CLIs and transcription are Electron services, while microphone
capture is client hardware. Remote clients require the same features without
receiving provider secrets or allowing focus changes to retarget a result.

## Dependencies

- [Server settings, secrets, and macros](./14-server-settings-secrets-and-macros.md)
- [Server terminal service](./8-server-terminal-service.md)

## Work slices

### AI metadata

- [x] Move Codex/Claude model discovery, environment setup, bounded terminal
  context, generation, normalization, timeout, and cancellation to server-core.
  `createServerAiProviderAdapters` owns provider-specific model catalogs/CLI
  commands, server-only environment and vault credential injection, bounded
  output, and typed child cancellation; `AiMetadataService` supplies bounded
  replay context and exact-target mutation checks.
- [x] Read context from the bounded server replay buffer rather than xterm.
- [x] Bind title/note generation to exact panel/session and expected metadata
  revision.
- [x] Preserve independent provider/model settings and clear data-exposure
  disclosure.
- [x] Keep provider credentials, CLI configuration, environment, and raw output
  away from clients through the server-owned CLI adapter boundary
  (`packages/server-core/test/provider-cli.test.mjs`).

### Dictation client

- [x] Keep permission, `MediaRecorder`, audio level, silence detection, overlay,
  Stop, and Cancel in shared client UI.
  `ServerDictationCapture` uses browser microphone APIs only in the renderer,
  keeps the immutable target in `DictationCaptureClient`, and submits bounded
  audio through `TerminayAiClient.transcribe`; `scripts/task15-renderer-ai-path.test.mjs`
  covers the capture, silence, cancellation, cleanup, and no-preload path.
- [x] Bind each capture to one immutable server/project/panel/session request
  in the transport-neutral `DictationCaptureClient` boundary.
- [x] Enforce client-side duration, byte, MIME, cleanup, and cancellation
  limits in the bounded capture state machine.
- [x] Present explicit selected-server and provider disclosure before capture;
  the client boundary accepts only confirmed, credential-free disclosure.

### Dictation server

- [x] Implement bounded audio upload with backpressure, timeout, cancellation,
  media validation, and server-side limits.
- [x] Transcribe using server settings and vault credentials through a scoped
  server-side provider credential callback; plaintext is never returned in
  protocol or status data.
- [x] Normalize and insert only into the original authorized live terminal
  after request/liveness validation.
- [x] Never retarget after focus, view, window, or connection changes.
- [x] Remove temporary audio and redact provider errors.

### Tests

- [x] Run AI model/generation E2E through `TerminayClient`.
  `packages/server-core/test/ai-protocol.test.mjs` runs model discovery and
  exact-target metadata generation through the framed `TerminayClient` and
  `TerminayAiClient` contract.
- [x] Test stale metadata revision, target exit, provider timeout, cancellation,
  oversized context/output, and multi-client focus changes. `ai-service.test.mjs`
  covers bounded server replay context, provider output limits, timeout, stale
  revision/target exit, cancellation, and authorization changes while a request
  is in flight.
- [x] Cover the transport-neutral dictation capture/request boundary for target
  immutability, disclosure, MIME/byte/duration bounds, and cancellation cleanup
  in `packages/client-core/test/dictation.test.mjs`.
- [x] Test dictation permission, size/type rejection, silence stop, Cancel,
  disconnect, target exit, revocation, and temporary-file cleanup.
  `scripts/task15-renderer-ai-path.test.mjs` covers renderer permission,
  MediaRecorder silence-stop, Cancel, disconnect cleanup, and provider-output
  validation; `packages/server-core/test/dictation-matrix.test.mjs` covers
  bounded size/type, provider-output, cancellation, disconnect, target-exit,
  and revocation behavior; `scripts/dictation-service.test.mjs` exercises
  file-backed temporary cleanup after provider success and failure.
- [x] Verify provider keys and plaintext secrets never reach clients or logs.
  Server-core AI/dictation fixtures resolve credentials only inside vault
  callbacks and assert that snapshots, status logs, and provider errors omit
  the secret sentinels; client disclosure rejects credential-shaped fields.

## Acceptance checks

- AI provider execution occurs on the server and updates one exact panel
  revision.
- Remote AI generation sends only bounded context for its target terminal.
- Dictation captured on a client inserts only into its original authorized
  terminal.
- Focus/connection changes cannot retarget either feature.
- Provider credentials never enter browser/Electron UI state.

## Definition of done

AI and dictation use server-side provider authority with bounded disclosed data,
while hardware capture and presentation remain safe client capabilities.
