# On-device Parakeet dictation for macOS

## Goal

Add Parakeet TDT 0.6B v3 as an explicit on-device dictation provider on Apple
Silicon macOS while preserving the existing OpenAI transcription providers and
all terminal-target, authorization, capture, and insertion boundaries.

## Governing specifications

- [Dictation mode](../features/dictation.md)
- [Settings, shortcuts, and desktop integration](../features/settings-shortcuts-and-desktop-integration.md)
- [Server runtime and application protocol](../features/server-runtime-and-protocol.md)
- [Local desktop diagnostics](../features/local-desktop-diagnostics.md)

## Current gap

The feature specification and server contracts describe a selectable provider,
but Desktop settings, preload IPC, credential checks, model typing, and the
Electron dictation service are hard-wired to OpenAI. Users must configure an API
key and upload every utterance even when an Apple Silicon machine can run a
small, high-quality ASR model locally.

NVIDIA's official Parakeet checkpoint targets NVIDIA runtimes. The selected Mac
path is the community `parakeet-mlx` implementation and pinned
`mlx-community/parakeet-tdt-0.6b-v3` conversion, executed with MLX/Metal inside
a server-owned worker. This is a new executable/model supply-chain boundary and
must not be treated as renderer code or an unbounded shell command.

## Product decisions

- Providers are `OpenAI` and `On-device (Parakeet)` on supported Desktop Macs.
- OpenAI remains available with both existing GPT-4o transcription models and
  the existing OS-keystore credential flow.
- Parakeet is offered only when the transcription authority is an Apple Silicon
  macOS host. Unsupported hosts retain OpenAI and show an explanatory status if
  a migrated Parakeet preference is encountered.
- The first Parakeet model is pinned to
  `mlx-community/parakeet-tdt-0.6b-v3`; arbitrary repository names, commands,
  Python modules, and model paths are not accepted from renderer input.
- Terminay owns a persistent worker, request framing, timeouts, cancellation,
  output bounds, model cache location, and shutdown cleanup.
- Runtime/model installation is an explicit user-visible action. It reports
  progress and failures, and does not occur merely by opening Settings.
- [x] Poll and display bounded phase-based setup progress while installation is
  active, including an explicit model download/load phase for the potentially
  long first run. Drain bounded worker diagnostics so download output cannot
  block the worker when no terminal is attached.
- Model downloads use the worker's isolated application cache. Audio and
  transcript content are not written into that cache or retained after a
  request.
- Parakeet ignores language and prompt hints because v3 performs language
  detection and has no OpenAI-compatible prompting contract. Shared capture
  duration, microphone, and silence settings still apply.
- There is no automatic provider fallback in either direction.

## Implementation slices

### Provider-shaped settings and disclosure

- [x] Add a normalized dictation provider setting with migration of existing
  settings to `openai` and provider-specific model validation/defaults.
- [x] Rename the settings section from OpenAI Dictation to Dictation and render
  provider-specific credential, model, language, prompt, and local-runtime
  controls without removing existing OpenAI behavior.
- [x] Make capture preflight require an API key only for OpenAI and require a
  ready local runtime only for Parakeet.
- [ ] Ensure request/disclosure snapshots identify whether audio stays on the
  selected Mac server or is forwarded to OpenAI.

### Privileged Parakeet runtime

- [x] Add a main/server-owned adapter for the pinned Parakeet model. Renderer
  IPC selects only the normalized provider; it cannot provide an executable,
  arguments, environment, model repository, cache path, or output path.
- [x] Discover an approved macOS runtime from explicit absolute locations and
  use a private application support/cache directory. Do not execute through a
  shell or inherit provider credentials.
- [x] Provision the pinned package on explicit request, expose bounded
  `unavailable`, `not-installed`, `installing`, `ready`, and `error` status,
  and prevent concurrent installers or workers.
- [x] Keep one worker warm, frame requests and responses with opaque bounded
  identifiers, enforce time/byte limits, and terminate it on application exit
  or protocol failure.
- [ ] Convert supported captured formats to the worker's required mono 16-kHz
  audio form without retaining audio. Missing conversion support must be a
  distinct actionable error.
- [ ] Pin and document the runtime package/model versions and their licenses;
  ensure release packaging and diagnostics disclose versions/status but never
  audio, transcripts, environment secrets, or arbitrary local paths.

### Verification

- [x] Unit-test setting migration, provider/model combinations, OpenAI key
  gating, unsupported platforms, and absence of remote fallback.
- [ ] Unit-test worker discovery, fixed argv/environment, installation
  serialization, JSON framing, malformed/oversized output, timeout,
  cancellation, crash recovery, audio cleanup, and app shutdown.
- [x] Test both providers with injected adapters so normal CI requires neither
  a model download nor OpenAI network access.
- [x] Add an opt-in real-Mac smoke test that downloads the pinned model,
  transcribes a checked-in short speech fixture using Metal, verifies useful
  text, then proves the same fixture works with networking disabled.
- [ ] Add Docker-isolated Electron E2E for provider switching, conditional
  settings, setup/error states, and successful injected Parakeet dictation.
  Run Electron coverage only through `npm run test:e2e`.

## Acceptance checks

- A user can retain OpenAI, its saved key, and either existing OpenAI model.
- On an Apple Silicon Mac, a user can explicitly install/select Parakeet and
  dictate after installation without an OpenAI key.
- After model installation, Parakeet transcription succeeds with no external
  network access and Activity Monitor identifies Metal-backed MLX work in the
  owned worker.
- Parakeet audio never reaches OpenAI or an inference endpoint, and provider
  failure never changes that policy.
- Switching providers does not delete the OpenAI key or redownload an already
  valid pinned local model.
- Cancel, terminal exit, target change, size/duration limits, and normal PTY
  insertion semantics remain identical for both providers.
- Unsupported platforms and missing `uv`, Python/runtime, conversion support,
  package installation, or model download produce distinct actionable states.

## Definition of done

The feature and provider boundaries are documented; settings and migration are
provider-aware; the pinned Parakeet model can be installed, kept warm, and used
offline on Apple Silicon macOS; OpenAI remains unchanged; privileged runtime
and cleanup tests pass; an opt-in real-model Mac smoke test exists; and Electron
acceptance coverage passes through `npm run test:e2e`.
