## Context

See proposal.md. Two features were moved together because they share one
problem: a provider execution boundary that must stay on the server, and an
exact terminal target that must not follow user focus.

## Goals / Non-Goals

Goals:
- Provider execution, credentials, and raw provider output live on the server.
- One immutable target per AI generation and per dictation capture.
- Remote clients get the same features while sending only bounded data.

Non-Goals:
- Moving microphone capture to the server. Capture is client hardware and
  stays in shared client UI.
- Streaming raw terminal output to a provider; only bounded replay context is
  sent.

## Decisions

**Context comes from the server replay buffer, not xterm.** The client no
longer decides what the model sees. `AiMetadataService` supplies bounded replay
context for the exact session, which makes the context identical for a local and
a remote client and keeps the bound enforceable on the server.

**Generation is bound to `{panel, session, expected metadata revision}`.** A
result is applied only if the target still exists and the revision still
matches. A focus change, a view change, a window change, or a connection change
between request and result cannot retarget the write; the result is discarded
instead.

**Provider internals never cross the protocol boundary.**
`createServerAiProviderAdapters` owns provider-specific model catalogs and CLI
commands, server-only environment and vault credential injection, bounded
output, and typed child cancellation. Clients see normalized results and
redacted errors. This is the security boundary the change exists to establish:
`packages/server-core/test/provider-cli.test.mjs` asserts it.

**Dictation splits at the hardware line.** `ServerDictationCapture` uses browser
microphone APIs in the renderer only; `DictationCaptureClient` is
transport-neutral and holds the immutable target, the client-side duration,
byte, MIME, cleanup, and cancellation limits, and the confirmed disclosure. The
audio itself is submitted through `TerminayAiClient.transcribe`.

**Disclosure precedes capture, and must be credential-free.** The client
presents the selected server and provider before recording starts, and the
client boundary accepts only a confirmed disclosure with no
credential-shaped fields.

**Insertion is validated twice.** The server normalizes the transcript and
inserts it only into the original authorized terminal after re-validating the
request and the session's liveness. Temporary audio is removed on both provider
success and provider failure; provider errors are redacted before they reach a
client or a log.

## Risks / Trade-offs

- Server-side replay context can diverge from what the user currently sees on
  screen if the session has scrolled far. Accepted: a bounded, server-owned
  context is the only version both local and remote clients can agree on and the
  only one whose size can be enforced.
- Moving transcription to the server means an offline or throttled server
  blocks dictation for every client. Accepted in exchange for keeping provider
  credentials out of browser and Electron UI state.
- Client-side limits duplicate server-side limits. Kept deliberately: the client
  limit gives immediate feedback and bounds upload cost, the server limit is the
  authority.

## Migration Plan

Provider execution moved out of the Electron services and into server-core in
one step, with the renderer's dictation path rewritten to have no preload
dependency. Independent provider and model settings, and the existing
data-exposure disclosure, were preserved rather than redesigned.
