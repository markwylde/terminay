## 1. Provider-shaped settings and disclosure

- [x] 1.1 Add a normalized dictation provider setting with migration of existing
  settings to `openai` and provider-specific model validation and defaults,
  verified by the migration and model-combination unit tests
- [x] 1.2 Rename the settings section from OpenAI Dictation to Dictation and render
  provider-specific credential, model, language, prompt, and local-runtime controls
  without removing existing OpenAI behaviour, verified by the settings surface
- [x] 1.3 Make capture preflight require an API key only for OpenAI and a ready
  local runtime only for Parakeet, verified by the preflight gating tests
- [x] 1.4 Ensure request and disclosure snapshots identify whether audio stays on
  the selected Mac server or is forwarded to OpenAI, verified by the snapshot
  contents
- [x] 1.5 Poll and display bounded phase-based setup progress while installation is
  active, including an explicit model download and load phase, and drain bounded
  worker diagnostics so download output cannot block the worker when no terminal is
  attached

## 2. Privileged Parakeet runtime

- [x] 2.1 Add a main/server-owned adapter for the pinned Parakeet model where
  renderer IPC selects only the normalized provider and cannot supply an
  executable, arguments, environment, model repository, cache path, or output path
- [x] 2.2 Discover an approved macOS runtime from explicit absolute locations, use a
  private application-support and cache directory, and neither execute through a
  shell nor inherit provider credentials
- [x] 2.3 Provision the pinned package on explicit request, expose bounded
  `unavailable`, `not-installed`, `installing`, `ready`, and `error` status, and
  prevent concurrent installers or workers
- [x] 2.4 Keep one worker warm, frame requests and responses with opaque bounded
  identifiers, enforce time and byte limits, and terminate it on application exit
  or protocol failure
- [x] 2.5 Convert supported captured formats to the worker's required mono 16-kHz
  audio without retaining audio, and make missing conversion support a distinct
  actionable error
- [x] 2.6 Pin and document the runtime package and model versions and their
  licences, and ensure release packaging and diagnostics disclose versions and
  status but never audio, transcripts, environment secrets, or arbitrary local paths

## 3. Verification

- [x] 3.1 Unit-test setting migration, provider and model combinations, OpenAI key
  gating, unsupported platforms, and the absence of remote fallback
- [x] 3.2 Test both providers with injected adapters so normal CI requires neither a
  model download nor OpenAI network access
- [x] 3.3 Add an opt-in real-Mac smoke test that downloads the pinned model,
  transcribes a checked-in short speech fixture using Metal, verifies useful text,
  then proves the same fixture works with networking disabled
- [x] 3.4 Confirm Electron acceptance coverage passes through `npm run test:e2e`

## 4. Acceptance

- [x] 4.1 A user can retain OpenAI, its saved key, and either existing OpenAI model
- [x] 4.2 On an Apple Silicon Mac, a user can explicitly install and select Parakeet
  and dictate after installation without an OpenAI key
- [x] 4.3 After model installation, Parakeet transcription succeeds with no external
  network access and Metal-backed MLX work is attributable to the owned worker
- [x] 4.4 Parakeet audio never reaches OpenAI or an inference endpoint, and provider
  failure never changes that policy
- [x] 4.5 Switching providers does not delete the OpenAI key or redownload an
  already valid pinned local model
- [x] 4.6 Cancel, terminal exit, target change, size and duration limits, and normal
  PTY insertion semantics remain identical for both providers
- [x] 4.7 Unsupported platforms and missing `uv`, Python/runtime, conversion
  support, package installation, or model download produce distinct actionable states
