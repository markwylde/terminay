## Why

Dictation was hard-wired to OpenAI across Desktop settings, preload IPC,
credential checks, model typing, and the Electron dictation service. Users had to
configure an API key and upload every utterance even on an Apple Silicon Mac that
can run a small, high-quality ASR model locally.

## What Changes

- Add Parakeet TDT 0.6B v3 as an explicit on-device dictation provider on Apple
  Silicon macOS, alongside the unchanged OpenAI providers.
- Add a normalized dictation provider setting, migrating existing settings to
  `openai`, with provider-specific model validation and defaults.
- Rename the settings section from OpenAI Dictation to Dictation and render
  provider-specific credential, model, language, prompt, and local-runtime
  controls.
- Make capture preflight require an API key only for OpenAI and a ready local
  runtime only for Parakeet, and disclose in request snapshots whether audio stays
  on the selected Mac server or is forwarded to OpenAI.
- Add a server-owned privileged Parakeet runtime: an approved macOS runtime
  discovered from explicit absolute locations, a private application-support cache,
  an explicitly requested installation with bounded status and progress, and one
  warm framed worker with time and byte limits.

## Capabilities

### New Capabilities
_None._

### Modified Capabilities
- `dictation`: adds a selectable on-device Parakeet provider with its own
  runtime, installation lifecycle, settings surface, and execution-location
  disclosure.

## Impact

Dictation settings and their migration, the capture preflight, the privileged
Parakeet adapter and worker, model and runtime pinning in release packaging and
diagnostics, and a new executable and model supply-chain boundary.
