## Context

See proposal.md for the gap. NVIDIA's official Parakeet checkpoint targets NVIDIA
runtimes. The selected Mac path is the community `parakeet-mlx` implementation and
the pinned `mlx-community/parakeet-tdt-0.6b-v3` conversion, executed with MLX and
Metal inside a server-owned worker. That makes this a new executable and model
supply-chain boundary, and it must not be treated as renderer code or as an
unbounded shell command.

## Goals / Non-Goals

Goals: a provider-shaped dictation setting; offline transcription on Apple Silicon
macOS after an explicit installation; unchanged OpenAI behaviour, key storage, and
models; and a privileged runtime that cannot be steered by renderer input.

Non-Goals: automatic fallback in either direction, Parakeet on non-Apple-Silicon
hosts, and language or prompt hints for Parakeet.

## Decisions

- Providers are `OpenAI` and `On-device (Parakeet)` on supported Desktop Macs.
  OpenAI remains available with both existing GPT-4o transcription models and the
  existing OS-keystore credential flow.
- Parakeet is offered only when the transcription authority is an Apple Silicon
  macOS host. An unsupported host retains OpenAI and shows an explanatory status
  if a migrated Parakeet preference is encountered.
- The first Parakeet model is pinned to `mlx-community/parakeet-tdt-0.6b-v3`.
  Arbitrary repository names, commands, Python modules, and model paths are not
  accepted from renderer input; renderer IPC selects only the normalized provider.
- Terminay owns the persistent worker, request framing, timeouts, cancellation,
  output bounds, model cache location, and shutdown cleanup. The runtime is
  discovered from explicit absolute locations, is not executed through a shell,
  and does not inherit provider credentials.
- Runtime and model installation is an explicit user-visible action reporting
  bounded phase-based progress, including a distinct model download and load phase
  for the potentially long first run. It does not occur merely by opening
  Settings. Worker diagnostics are drained so download output cannot block the
  worker when no terminal is attached.
- Model downloads use the worker's isolated application cache. Audio and
  transcript content are never written into that cache or retained after a
  request.
- Parakeet ignores language and prompt hints because v3 performs language
  detection and has no OpenAI-compatible prompting contract. Shared capture
  duration, microphone, and silence settings still apply.
- There is no automatic provider fallback in either direction: a Parakeet failure
  never sends audio to OpenAI.

## Risks / Trade-offs

The runtime package and model conversion are community artifacts, so their
versions and licences are pinned and documented, and release packaging and
diagnostics disclose versions and status but never audio, transcripts, environment
secrets, or arbitrary local paths.

A real model download cannot run in normal CI. Both providers are therefore tested
with injected adapters, and an opt-in real-Mac smoke test downloads the pinned
model, transcribes a checked-in speech fixture using Metal, and then proves the
same fixture works with networking disabled.

## Migration Plan

Existing dictation settings migrate to the `openai` provider, preserving the saved
key and the selected model. Switching providers does not delete the OpenAI key or
redownload an already valid pinned local model.
