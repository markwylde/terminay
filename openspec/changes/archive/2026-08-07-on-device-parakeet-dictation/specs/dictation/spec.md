## ADDED Requirements

### Requirement: Parakeet on-device execution

Dictation SHALL offer an on-device provider using the pinned Parakeet model on Apple Silicon macOS transcription authorities. Parakeet SHALL execute inside a server-owned worker process discovered from explicit absolute runtime locations, SHALL NOT be executed through a shell, and SHALL NOT inherit provider credentials. Renderer input SHALL select only the normalized provider; it SHALL NOT supply an executable, arguments, environment, model repository, cache path, or output path. Captured audio SHALL be converted to the worker's required mono 16-kHz form without being retained, and missing conversion support SHALL be a distinct actionable error. Parakeet audio SHALL NOT reach OpenAI or any inference endpoint, and there SHALL be no automatic provider fallback in either direction.

#### Scenario: Offline transcription after installation

- **WHEN** a user dictates with Parakeet on an Apple Silicon Mac after the pinned model is installed
- **THEN** transcription succeeds with no external network access

#### Scenario: Renderer cannot steer the runtime

- **WHEN** a client requests Parakeet transcription
- **THEN** only the normalized provider is accepted and any supplied executable, arguments, environment, repository, cache path, or output path is rejected

#### Scenario: Provider failure does not fall back

- **WHEN** the Parakeet runtime fails
- **THEN** an actionable error is reported and no audio is sent to OpenAI

#### Scenario: Missing conversion support

- **WHEN** the captured format cannot be converted to mono 16-kHz audio
- **THEN** a distinct actionable error is reported and no audio is retained

### Requirement: Parakeet pinning and safe status disclosure

The Parakeet model SHALL be pinned to one exact conversion, and the runtime package and model versions and their licences SHALL be documented. Model downloads SHALL use the worker's isolated application cache; audio and transcript content SHALL NOT be written into that cache or retained after a request. Release packaging and diagnostics SHALL disclose runtime and model versions and status but SHALL NOT disclose audio, transcripts, environment secrets, or arbitrary local paths. Parakeet SHALL ignore language and prompt hints; shared capture duration, microphone, and silence settings SHALL still apply.

#### Scenario: Diagnostics stay metadata-only

- **WHEN** diagnostics report the local dictation runtime
- **THEN** they include versions and status and exclude audio, transcripts, secrets, and arbitrary local paths

#### Scenario: Hints are ignored

- **WHEN** a request carries a language or prompt hint and the provider is Parakeet
- **THEN** the hint is ignored while capture duration, microphone, and silence settings still apply

### Requirement: Parakeet installation and setup progress

Runtime and model installation SHALL be an explicit user-visible action and SHALL NOT occur merely by opening Settings. Status SHALL be bounded to `unavailable`, `not-installed`, `installing`, `ready`, and `error`. While installation is active, bounded phase-based progress SHALL be reported, including a distinct model download and load phase for a potentially long first run. Concurrent installers or workers SHALL be prevented, worker diagnostics SHALL be drained so download output cannot block the worker when no terminal is attached, and the worker SHALL be terminated on application exit or protocol failure. Switching providers SHALL NOT delete a stored OpenAI key or redownload an already valid pinned local model.

#### Scenario: Opening Settings installs nothing

- **WHEN** the user opens the Dictation settings section
- **THEN** no runtime or model installation begins

#### Scenario: First-run download reports progress

- **WHEN** the pinned model is downloaded for the first time
- **THEN** a distinct download and load phase is reported and the worker is not blocked by download output

#### Scenario: Concurrent installation is refused

- **WHEN** an installation is already active and another is requested
- **THEN** the second request is refused and the active installation's status is reported

### Requirement: Provider-appropriate settings surface

The settings section SHALL be named Dictation and SHALL render provider-specific credential, model, language, prompt, and local-runtime controls. Existing settings SHALL migrate to the `openai` provider, preserving the saved key and the selected model, and model values SHALL be validated and defaulted per provider. Capture preflight SHALL require an API key only for OpenAI and a ready local runtime only for Parakeet. Parakeet SHALL be offered only when the transcription authority is an Apple Silicon macOS host; an unsupported host SHALL retain OpenAI and SHALL show an explanatory status if a migrated Parakeet preference is encountered.

#### Scenario: Existing OpenAI configuration is preserved

- **WHEN** settings written before the provider setting existed are loaded
- **THEN** they migrate to the `openai` provider with the saved key and selected model intact

#### Scenario: Unsupported host

- **WHEN** the transcription authority is not an Apple Silicon macOS host
- **THEN** Parakeet is not offered, OpenAI is retained, and a migrated Parakeet preference produces an explanatory status

#### Scenario: Preflight gating per provider

- **WHEN** capture preflight runs
- **THEN** an API key is required only for OpenAI and a ready local runtime is required only for Parakeet

### Requirement: Execution-location disclosure

Request and disclosure snapshots SHALL identify whether captured audio stays on the selected server's Mac host or is forwarded to OpenAI.

#### Scenario: On-device request is disclosed as local

- **WHEN** a dictation request uses the Parakeet provider
- **THEN** the snapshot states that audio stays on the selected server's Mac host

#### Scenario: Remote request is disclosed as forwarded

- **WHEN** a dictation request uses the OpenAI provider
- **THEN** the snapshot states that audio is forwarded to OpenAI
