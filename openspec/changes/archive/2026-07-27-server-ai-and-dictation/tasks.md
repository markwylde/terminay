## 1. AI metadata

- [x] 1.1 Move Codex/Claude model discovery, environment setup, bounded terminal context, generation, normalization, timeout, and cancellation to server-core, verified by `createServerAiProviderAdapters` owning provider catalogs, CLI commands, vault credential injection, bounded output, and typed child cancellation
- [x] 1.2 Read context from the bounded server replay buffer rather than xterm, verified by `AiMetadataService` supplying the replay context in focused tests
- [x] 1.3 Bind title/note generation to exact panel/session and expected metadata revision, verified by exact-target mutation checks in `ai-service.test.mjs`
- [x] 1.4 Preserve independent provider/model settings and clear data-exposure disclosure, verified by settings and disclosure coverage
- [x] 1.5 Keep provider credentials, CLI configuration, environment, and raw output away from clients, verified by `packages/server-core/test/provider-cli.test.mjs`

## 2. Dictation client

- [x] 2.1 Keep permission, `MediaRecorder`, audio level, silence detection, overlay, Stop, and Cancel in shared client UI, verified by `scripts/task15-renderer-ai-path.test.mjs` covering capture, silence, cancellation, cleanup, and the no-preload path
- [x] 2.2 Bind each capture to one immutable server/project/panel/session request in the transport-neutral `DictationCaptureClient` boundary, verified by target-immutability tests
- [x] 2.3 Enforce client-side duration, byte, MIME, cleanup, and cancellation limits in the bounded capture state machine and verify each limit rejects
- [x] 2.4 Present explicit selected-server and provider disclosure before capture and verify the client boundary accepts only a confirmed, credential-free disclosure

## 3. Dictation server

- [x] 3.1 Implement bounded audio upload with backpressure, timeout, cancellation, media validation, and server-side limits, verified by `packages/server-core/test/dictation-matrix.test.mjs`
- [x] 3.2 Transcribe using server settings and vault credentials through a scoped server-side credential callback and verify plaintext never appears in protocol or status data
- [x] 3.3 Normalize and insert only into the original authorized live terminal after request/liveness validation, verified by insertion tests
- [x] 3.4 Never retarget after focus, view, window, or connection changes, verified by the multi-client focus-change cases
- [x] 3.5 Remove temporary audio and redact provider errors, verified by `scripts/dictation-service.test.mjs` exercising cleanup after provider success and failure

## 4. Tests

- [x] 4.1 Run AI model/generation end to end through `TerminayClient`, verified by `packages/server-core/test/ai-protocol.test.mjs` driving discovery and exact-target generation over the framed contract
- [x] 4.2 Test stale metadata revision, target exit, provider timeout, cancellation, oversized context/output, and multi-client focus changes, verified by `ai-service.test.mjs`
- [x] 4.3 Cover the transport-neutral dictation capture/request boundary for target immutability, disclosure, MIME/byte/duration bounds, and cancellation cleanup, verified by `packages/client-core/test/dictation.test.mjs`
- [x] 4.4 Test dictation permission, size/type rejection, silence stop, Cancel, disconnect, target exit, revocation, and temporary-file cleanup, verified by `scripts/task15-renderer-ai-path.test.mjs`, `dictation-matrix.test.mjs`, and `scripts/dictation-service.test.mjs`
- [x] 4.5 Verify provider keys and plaintext secrets never reach clients or logs, by asserting snapshots, status logs, and provider errors omit the secret sentinels and that client disclosure rejects credential-shaped fields
