## MODIFIED Requirements

### Requirement: Dictation availability and invocation

The Command Bar and the Desktop Terminal menu SHALL contain a **Start Dictation** action. The default shortcut SHALL be `CmdOrCtrl+Shift+D` and SHALL be changeable through the normal shortcut settings. Dictation SHALL be available only when a live terminal is active and the selected client has microphone capability. Dictation SHALL remain opt-in and disabled until a provider and its required configuration are configured on the selected server.

#### Scenario: Starting dictation from the Command Bar

- **WHEN** a user invokes **Start Dictation** from the Command Bar, the Desktop Terminal menu, or the configured shortcut while a live terminal is active
- **THEN** Terminay begins a dictation request bound to that terminal

#### Scenario: No live terminal or no microphone capability

- **WHEN** no live terminal is active, or the selected client has no microphone capability
- **THEN** dictation is unavailable

#### Scenario: No provider configured

- **WHEN** the dictation provider or its required configuration is missing on the selected server
- **THEN** dictation is disabled

#### Scenario: Rebinding the shortcut

- **WHEN** a user changes the dictation shortcut in shortcut settings
- **THEN** the new binding starts dictation and `CmdOrCtrl+Shift+D` no longer does

#### Scenario: Custom provider without authentication

- **WHEN** OpenAI-compatible dictation is enabled with a valid endpoint URL and model and no API key
- **THEN** dictation is available without requiring a credential

### Requirement: Transcription providers and models

The default final-transcript model SHALL be `gpt-4o-transcribe` when OpenAI is the configured provider. Apple Silicon macOS servers SHALL be able to select the on-device Parakeet provider with the pinned `mlx-community/parakeet-tdt-0.6b-v3` model. Servers SHALL support an OpenAI-compatible provider using a configured full HTTP(S) transcription URL and arbitrary nonempty model ID. Provider selection SHALL be explicit and stable for the whole request, and failure of an on-device provider SHALL NOT fall back to a remote provider.

#### Scenario: OpenAI default model

- **WHEN** OpenAI is the configured provider and no model is chosen
- **THEN** `gpt-4o-transcribe` is used for the final transcript

#### Scenario: Parakeet availability

- **WHEN** the server runs on Apple Silicon macOS
- **THEN** the on-device Parakeet provider with model `mlx-community/parakeet-tdt-0.6b-v3` can be selected

#### Scenario: On-device provider fails

- **WHEN** the selected on-device provider fails during a request
- **THEN** the request fails and no remote provider is used

#### Scenario: Custom model identifier

- **WHEN** a user configures `profile:hL9sOEcV4rY37MUWN7BZSDJ2` as the custom model
- **THEN** that identifier is sent unchanged in the multipart model field to the configured URL

### Requirement: Settings scope and vault storage

Provider, model, custom endpoint URL, TLS verification preference, and capture preferences SHALL be server settings. Microphone permission SHALL be client-local. Remote-provider API keys SHALL be stored in the server vault: embedded Desktop MAY back the vault with OS secure storage; standalone server deployment SHALL use its configured headless vault policy; clients SHALL be able to set, replace, or remove the key through dedicated secret commands but SHALL NOT read it back; and snapshots and settings responses SHALL expose only configured or not-configured status.

#### Scenario: Managing the provider key

- **WHEN** a client sets, replaces, or removes the remote-provider API key
- **THEN** the operation runs through dedicated secret commands and the key is never returned to the client

#### Scenario: Snapshot exposure

- **WHEN** a client reads a settings snapshot
- **THEN** the provider key appears only as configured or not-configured status

#### Scenario: Separate optional custom credential

- **WHEN** the user sets or removes the optional OpenAI-compatible key
- **THEN** dedicated secret commands affect only its selected-server vault entry, leaving the OpenAI key unchanged
- **AND** no key enters ordinary settings or snapshots

### Requirement: Execution-location disclosure

The captured audio SHALL be sent to the selected Terminay Server. When a remote provider is selected it SHALL then be sent to that provider; when the on-device Parakeet provider is selected it SHALL remain on the macOS server. The UI SHALL disclose the selected execution location before capture. Custom provider disclosure SHALL identify its configured endpoint and selected Terminay Server without implying that inference stays on that server.

#### Scenario: Remote provider selected

- **WHEN** a remote provider is configured and the user starts dictation
- **THEN** the UI discloses before capture that audio is sent to the selected server and then to that provider

#### Scenario: On-device provider selected

- **WHEN** the Parakeet provider is configured
- **THEN** the UI discloses that audio remains on the macOS server
- **AND** the audio is not sent to any external inference service

#### Scenario: Custom endpoint selected

- **WHEN** OpenAI-compatible dictation starts
- **THEN** the recorder identifies the selected server and configured endpoint as the audio destination

### Requirement: Dictation resolves its server from the target terminal

Dictation availability, provider and its required configuration configuration, transcription, and
insertion SHALL all resolve against the server that owns the target terminal, not
against the window's primary connection or any other attached connection. Where
the owning server has no dictation provider or credential configured, dictation
SHALL be unavailable for that terminal even when another attached server has one.

#### Scenario: Dictating into an attached server's terminal

- **WHEN** the user dictates while a terminal of an attached server is active
- **THEN** the audio is transcribed by that terminal's own server and the
  transcript is inserted into that terminal

#### Scenario: Only another server is configured

- **WHEN** the target terminal's server has no dictation provider or credential
  configured while another attached server has one
- **THEN** dictation is unavailable for that terminal and no other server
  transcribes for it

## ADDED Requirements

### Requirement: OpenAI-compatible transcription transport

The owning server SHALL POST multipart audio `file`, `model`, and `response_format=json` to the configured full endpoint URL. It SHALL include language and prompt when supplied, accept a JSON string `text`, and omit Authorization when no custom key is configured. A configured custom key SHALL be sent as a Bearer credential only to that endpoint. Redirects SHALL fail without forwarding audio or credentials. Invalid URLs, URL userinfo, query strings or fragments, non-HTTP(S) schemes, malformed output, provider errors, cancellation, timeout and oversized responses SHALL fail safely without terminal insertion or provider fallback.

#### Scenario: Self-hosted transcription

- **WHEN** a user configures `https://pop-os:2345/sherpaonnx/v1/audio/transcriptions` and a model ID
- **THEN** the selected server submits the bounded recording directly to that full URL and inserts the returned normalized text only into the original authorized terminal

#### Scenario: Optional authentication

- **WHEN** no custom API key is configured
- **THEN** the provider receives no Authorization header

#### Scenario: Invalid endpoint or response

- **WHEN** the endpoint is invalid, redirects, fails, or returns malformed or oversized output
- **THEN** the request fails with a sanitized error and nothing is inserted

### Requirement: Custom-provider TLS verification

OpenAI-compatible dictation SHALL verify HTTPS certificates by default. An explicit “Bypass TLS verification” checkbox SHALL permit self-signed certificates only for that custom provider's request. The preference SHALL NOT change OpenAI, other services, global TLS configuration, or a subsequent verified request.

#### Scenario: Verification enabled

- **WHEN** a custom endpoint has a self-signed certificate and bypass is unchecked
- **THEN** the request fails certificate verification

#### Scenario: Explicit bypass

- **WHEN** bypass is checked for a custom HTTPS endpoint
- **THEN** that request accepts its self-signed certificate
- **AND** other requests retain their configured certificate verification

### Requirement: Stable disclosed configuration and credential target

A custom dictation submission SHALL carry the provider, endpoint, model and TLS policy disclosed at capture start. The server SHALL compare these with its current configuration and reject a mismatch before sending audio. Execution SHALL use only matched server settings. Key commands SHALL target an explicitly validated provider independently of current selection; omitted selectors SHALL target OpenAI.

#### Scenario: Configuration changes during capture

- **WHEN** provider, endpoint, model or TLS policy changes before a custom recording is submitted
- **THEN** the server rejects it without sending audio to any provider

#### Scenario: Configuration changes during inference

- **WHEN** server settings change after a matched request begins
- **THEN** the in-flight request retains its matched server-owned configuration

#### Scenario: Provider switches during key save

- **WHEN** an OpenAI-compatible key command is pending and the selected provider changes
- **THEN** only the explicitly targeted custom vault entry can be changed

#### Scenario: Bounded and cancellable transport

- **WHEN** a custom request is cancelled during upload or response, stalls until timeout, or exceeds the output byte limit
- **THEN** transport work terminates and no transcript is inserted

#### Scenario: Configured vault entry cannot be resolved

- **WHEN** the custom key entry exists but vault resolution fails
- **THEN** the request fails without unauthenticated fallback

#### Scenario: Custom model matches Parakeet

- **WHEN** the custom model ID equals the pinned local Parakeet model
- **THEN** execution still uses the custom endpoint
