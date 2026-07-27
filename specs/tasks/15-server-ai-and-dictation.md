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

- [ ] Move Codex/Claude model discovery, environment setup, bounded terminal
  context, generation, normalization, timeout, and cancellation to server-core.
- [ ] Read context from the bounded server replay buffer rather than xterm.
- [ ] Bind title/note generation to exact panel/session and expected metadata
  revision.
- [ ] Preserve independent provider/model settings and clear data-exposure
  disclosure.
- [ ] Keep provider credentials, CLI configuration, environment, and raw output
  away from clients.

### Dictation client

- [ ] Keep permission, `MediaRecorder`, audio level, silence detection, overlay,
  Stop, and Cancel in shared client UI.
- [ ] Bind each capture to one immutable server/project/panel/session request.
- [ ] Enforce client-side duration, byte, MIME, cleanup, and cancellation
  limits.
- [ ] Present explicit selected-server and provider disclosure before capture.

### Dictation server

- [ ] Implement bounded audio upload with backpressure, timeout, cancellation,
  media validation, and server-side limits.
- [ ] Transcribe using server settings and vault credentials.
- [ ] Normalize and insert only into the original authorized live terminal
  after request/liveness validation.
- [ ] Never retarget after focus, view, window, or connection changes.
- [ ] Remove temporary audio and redact provider errors.

### Tests

- [ ] Run AI model/generation E2E through `TerminayClient`.
- [ ] Test stale metadata revision, target exit, provider timeout, cancellation,
  oversized context/output, and multi-client focus changes.
- [ ] Test dictation permission, size/type rejection, silence stop, Cancel,
  disconnect, target exit, revocation, and temporary-file cleanup.
- [ ] Verify provider keys and plaintext secrets never reach clients or logs.

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
