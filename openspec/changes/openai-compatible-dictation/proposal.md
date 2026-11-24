## Why

Users with self-hosted speech-to-text services cannot select them for Terminay dictation. They need to supply an OpenAI-compatible transcription URL, optional API key, and model, including services with self-signed TLS certificates.

## What Changes

- Add an OpenAI-compatible provider alongside OpenAI and on-device Parakeet.
- Configure a full HTTP(S) transcription endpoint URL and arbitrary model ID, including `profile:…` identifiers.
- Store an optional custom-provider API key separately in the selected server vault.
- Add an unchecked-by-default “Bypass TLS verification” checkbox limited to custom-provider requests.
- Run multipart transcription on the owning server in both embedded Desktop and standalone deployments, preserving cancellation, limits, disclosure, and immutable terminal targets.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `dictation`: Custom transcription provider settings, optional credentials, request-scoped TLS policy, and execution disclosure.

## Impact

Shared settings types, normalization and UI; server-core dictation configuration, adapter and credential plumbing; Desktop and standalone composition; client disclosure and recorder UI; existing dictation tests. No model-manager changes, global TLS changes, or realtime transcription protocol.
