# dictation Specification

## Purpose

Dictation records a bounded utterance from the connected client's microphone, transcribes it with the configured provider, and inserts the confirmed transcript into the exact terminal where dictation started. Microphone capture is client-local, while provider credentials, transcription policy, and terminal insertion are server-authorized.

## Requirements

### Requirement: Dictation availability and invocation

The Command Bar and the Desktop Terminal menu SHALL contain a **Start Dictation** action. The default shortcut SHALL be `CmdOrCtrl+Shift+D` and SHALL be changeable through the normal shortcut settings. Dictation SHALL be available only when a live terminal is active and the selected client has microphone capability. Dictation SHALL remain opt-in and disabled until a provider and credential are configured on the selected server.

#### Scenario: Starting dictation from the Command Bar

- **WHEN** a user invokes **Start Dictation** from the Command Bar, the Desktop Terminal menu, or the configured shortcut while a live terminal is active
- **THEN** Terminay begins a dictation request bound to that terminal

#### Scenario: No live terminal or no microphone capability

- **WHEN** no live terminal is active, or the selected client has no microphone capability
- **THEN** dictation is unavailable

#### Scenario: No provider configured

- **WHEN** no dictation provider and credential are configured on the selected server
- **THEN** dictation is disabled

#### Scenario: Rebinding the shortcut

- **WHEN** a user changes the dictation shortcut in shortcut settings
- **THEN** the new binding starts dictation and `CmdOrCtrl+Shift+D` no longer does

### Requirement: Microphone permission across hosts

Browsers and Desktop clients SHALL request microphone permission through their platform. A first-party hosted session page SHALL capture on the session origin after a user gesture. A PWA-framed session SHALL capture in the manager after a user gesture, and the manager SHALL deliver audio to that session over the closed host channel. A denied or unavailable microphone SHALL produce a clear local error without contacting the provider.

#### Scenario: Hosted session page capture

- **WHEN** dictation starts in a first-party hosted session page
- **THEN** audio is captured on the session origin after a user gesture

#### Scenario: PWA-framed capture

- **WHEN** dictation starts in a PWA-framed session
- **THEN** the manager captures after a user gesture and delivers the audio to the session over the closed host channel

#### Scenario: Microphone permission denied

- **WHEN** the user denies microphone permission or no microphone is available
- **THEN** a clear local error is reported
- **AND** no request is sent to the transcription provider

### Requirement: Client capture responsibilities

The connected client SHALL request microphone permission, capture audio with the browser media APIs, compute local level and silence information, display and control the recorder overlay, enforce the client-side duration and size limits, and send one bounded recording with its intended server, project, and terminal identities.

#### Scenario: Client sends one bounded recording

- **WHEN** capture completes on the client
- **THEN** the client sends exactly one bounded recording carrying its intended server, project, and terminal identities

#### Scenario: Client-side limits exceeded

- **WHEN** the captured audio exceeds the client-side duration or size limit
- **THEN** the client enforces the limit before any upload

### Requirement: Server transcription responsibilities

Terminay Server SHALL validate the device and exact target session, enforce independent audio size, duration, MIME, and timeout limits, resolve the selected provider, model, language, and server-held credential, transcribe the recording, normalize the returned text, revalidate the target terminal and request identity, and write the transcript through the normal PTY input path.

#### Scenario: Server independently enforces limits

- **WHEN** the server receives an uploaded recording
- **THEN** it enforces its own audio size, duration, MIME, and timeout limits regardless of the client's checks

#### Scenario: Server revalidates before writing

- **WHEN** transcription completes
- **THEN** the server revalidates the target terminal and request identity before writing the transcript through the normal PTY input path

### Requirement: Environment binding for transcript insertion

The PTY input path SHALL resolve the terminal's immutable project-environment binding. Dictation SHALL NOT connect to a project host itself, change environment selection, or fall back to a local PTY when a remote environment is unavailable.

#### Scenario: Remote-backed terminal

- **WHEN** the target terminal is bound to a remote project environment
- **THEN** the transcript is written through that environment's input path

#### Scenario: Remote environment unavailable

- **WHEN** the target terminal's project environment is unavailable
- **THEN** the write fails and dictation does not fall back to a local PTY

### Requirement: Provider credential isolation

The server-side provider adapter SHALL resolve its configured vault entry only through a scoped callback. The callback SHALL NOT be part of any client or status DTO, and no vault value SHALL be included in the selected-server/provider disclosure shown before capture.

#### Scenario: Credential never leaves the server

- **WHEN** a client requests dictation status or the pre-capture disclosure
- **THEN** the response contains no vault value and no credential callback

### Requirement: Execution-location disclosure

The captured audio SHALL be sent to the selected Terminay Server. When a remote provider is selected it SHALL then be sent to that provider; when the on-device Parakeet provider is selected it SHALL remain on the macOS server. The UI SHALL disclose the selected execution location before capture.

#### Scenario: Remote provider selected

- **WHEN** a remote provider is configured and the user starts dictation
- **THEN** the UI discloses before capture that audio is sent to the selected server and then to that provider

#### Scenario: On-device provider selected

- **WHEN** the Parakeet provider is configured
- **THEN** the UI discloses that audio remains on the macOS server
- **AND** the audio is not sent to any external inference service

### Requirement: Capture client boundary

Shared clients SHALL use a transport-neutral `DictationCaptureClient` boundary for local capture state. It SHALL snapshot one immutable server/project/panel/session target and the confirmed selected-server/provider disclosure, accept only supported bounded audio chunks, and return a single bounded request on Stop. Duration, byte, MIME, cancellation, and disconnect/target-change cleanup SHALL be enforced before a transport is allowed to upload audio. The boundary SHALL contain no provider credential and no microphone implementation.

#### Scenario: Stop returns one bounded request

- **WHEN** the user stops a recording
- **THEN** the capture boundary returns a single bounded request for the snapshotted target

#### Scenario: Target changes during capture

- **WHEN** the client disconnects or the snapshotted target changes during capture
- **THEN** the capture boundary cleans up and no audio is uploaded

#### Scenario: Unsupported chunk offered

- **WHEN** an unsupported or oversized audio chunk is offered to the boundary
- **THEN** the boundary rejects it before any transport upload

### Requirement: Recording flow

Dictation SHALL follow an ordered flow: the user starts dictation while a live terminal is active; Terminay binds a unique request id to the selected server, project, panel, and terminal session; the client asks for microphone permission and starts local recording; an overlay shows recording state, elapsed time, audio level, Stop, and Cancel; capture stops on explicit Stop, the configured silence interval, or the maximum duration; Cancel discards local audio and performs no transcription or terminal write; the client uploads the bounded audio through the application protocol; the server transcribes it and returns or publishes the normalized result; the server writes the result only if the original terminal remains live and the request is still valid; and the overlay reports success or a recoverable error and releases microphone resources.

#### Scenario: Successful dictation

- **WHEN** the user records an utterance and stops
- **THEN** the audio is uploaded, transcribed, normalized, and written to the originating terminal
- **AND** the overlay reports success and releases microphone resources

#### Scenario: Automatic stop

- **WHEN** the configured silence interval elapses after speech begins, or the maximum duration is reached
- **THEN** capture stops automatically

#### Scenario: Cancel before upload

- **WHEN** the user cancels the recording
- **THEN** local audio is discarded, no transcription runs, and nothing is written to the terminal

#### Scenario: Second dictation while one is active

- **WHEN** the user starts another dictation request while one is active
- **THEN** Terminay offers to cancel the first request
- **AND** never runs two microphone captures implicitly

### Requirement: Immutable insertion target

The terminal active at start SHALL be the only insertion target. Later focus changes, tab renames, panel movement, another window becoming active, or a second client connecting SHALL NOT retarget the transcript. If the terminal exits, the server connection changes, authorization is revoked, or the request is cancelled before insertion, Terminay SHALL discard the result and report that nothing was written.

#### Scenario: Focus changes during transcription

- **WHEN** focus moves to another terminal, a tab is renamed, a panel is moved, another window becomes active, or a second client connects while transcription is in progress
- **THEN** the transcript is still written to the terminal that was active at start

#### Scenario: Target terminal exits

- **WHEN** the originating terminal exits, the server connection changes, authorization is revoked, or the request is cancelled before insertion
- **THEN** the result is discarded and Terminay reports that nothing was written

### Requirement: Disconnect handling

A transient client disconnect SHALL cancel local capture. A fully uploaded, server-accepted request SHALL follow its request status, but SHALL NOT write to a different or exited terminal.

#### Scenario: Disconnect during capture

- **WHEN** the client disconnects while audio is still being captured
- **THEN** local capture is cancelled

#### Scenario: Disconnect after upload

- **WHEN** the client disconnects after the server accepted a fully uploaded request
- **THEN** the request follows its server-side status
- **AND** the result is not written to a different or exited terminal

### Requirement: Audio limits

Supported input formats SHALL be the formats accepted by both the capture client and the configured provider, including WebM where available. Default maximum duration SHALL be 60 seconds. Silence auto-stop SHALL default to 5 seconds after speech begins. Provider and protocol upload limits SHALL be enforced before provider submission. Audio SHALL be transferred with bounded chunks, timeout, cancellation, and backpressure. Unsupported MIME types, empty recordings, inaudible recordings, and oversized payloads SHALL fail clearly.

#### Scenario: Default duration limit

- **WHEN** a recording reaches 60 seconds without an explicit stop and no other limit is configured
- **THEN** capture stops

#### Scenario: Default silence auto-stop

- **WHEN** 5 seconds of silence elapse after speech begins and no other interval is configured
- **THEN** capture stops

#### Scenario: Unsupported or empty audio

- **WHEN** the recording uses an unsupported MIME type, is empty, is inaudible, or exceeds the payload limit
- **THEN** the request fails with a clear, distinct error before provider submission

### Requirement: Transcription providers and models

The default final-transcript model SHALL be `gpt-4o-transcribe` when OpenAI is the configured provider. Apple Silicon macOS servers SHALL be able to select the on-device Parakeet provider with the pinned `mlx-community/parakeet-tdt-0.6b-v3` model. Provider selection SHALL be explicit and stable for the whole request, and failure of an on-device provider SHALL NOT fall back to a remote provider.

#### Scenario: OpenAI default model

- **WHEN** OpenAI is the configured provider and no model is chosen
- **THEN** `gpt-4o-transcribe` is used for the final transcript

#### Scenario: Parakeet availability

- **WHEN** the server runs on Apple Silicon macOS
- **THEN** the on-device Parakeet provider with model `mlx-community/parakeet-tdt-0.6b-v3` can be selected

#### Scenario: On-device provider fails

- **WHEN** the selected on-device provider fails during a request
- **THEN** the request fails and no remote provider is used

### Requirement: Parakeet on-device execution

The Parakeet provider SHALL run through a server-owned MLX worker and SHALL keep the loaded model warm between bounded requests. It SHALL NOT send dictation audio to OpenAI, Hugging Face, or another inference service. Every captured format accepted for Parakeet SHALL be converted in a private, request-scoped directory to signed 16-bit mono PCM WAV at 16 kHz before it reaches the worker. The converted file SHALL be removed after success or failure, and unavailable conversion support SHALL be reported separately from model and runtime readiness.

#### Scenario: Audio conversion before the worker

- **WHEN** a recording is submitted to the Parakeet provider
- **THEN** it is converted in a private, request-scoped directory to signed 16-bit mono PCM WAV at 16 kHz before reaching the worker
- **AND** the converted file is removed after success or failure

#### Scenario: Conversion support unavailable

- **WHEN** audio conversion support is unavailable
- **THEN** it is reported separately from model and runtime readiness

#### Scenario: Warm model between requests

- **WHEN** consecutive bounded Parakeet requests are made
- **THEN** the MLX worker keeps the loaded model warm between them

### Requirement: Parakeet pinning and safe status disclosure

The engine SHALL be pinned to `parakeet-mlx==0.5.2` (Apache-2.0) and the model to `mlx-community/parakeet-tdt-0.6b-v3` revision `ed2b7e8c15f9aaa0b5772e2efb986255eaef7e15` (CC-BY-4.0). Safe runtime status SHALL expose these identifiers, licenses, and audio format, and SHALL NOT expose cache or local paths, environment values, audio, or transcripts.

#### Scenario: Runtime status queried

- **WHEN** a client reads Parakeet runtime status
- **THEN** it receives the pinned engine and model identifiers, their licenses, and the audio format
- **AND** it receives no cache or local paths, environment values, audio, or transcripts

### Requirement: Parakeet installation and setup progress

The Parakeet runtime package and model weights SHALL be downloaded only on explicit user request or first setup. Settings SHALL disclose download size, status, and the network requirement, and transcription SHALL work offline after installation. While setup is running, Settings SHALL poll the privileged runtime and show its current phase — prerequisite checks, Python environment creation, engine installation, or model download and load. The phase indicator SHALL remain visibly active when an exact aggregate byte percentage is unavailable, and setup diagnostics SHALL be consumed without exposing local paths or unbounded output.

#### Scenario: Explicit installation

- **WHEN** the user requests Parakeet setup
- **THEN** Settings discloses the download size, status, and network requirement before downloading the runtime package and model weights

#### Scenario: Setup phase reporting

- **WHEN** setup is running
- **THEN** Settings shows the current phase and keeps the phase indicator visibly active even when an exact aggregate byte percentage is unavailable
- **AND** diagnostics are consumed without exposing local paths or unbounded output

#### Scenario: Offline transcription after installation

- **WHEN** Parakeet is installed and the server has no network access
- **THEN** transcription still works

### Requirement: Provider-appropriate settings surface

Parakeet SHALL automatically detect its supported languages and SHALL NOT consume OpenAI-style prompt hints. The UI SHALL hide or explain settings which do not apply to the selected provider. Users SHALL be able to configure provider, model, language hint, silence interval, maximum duration, and whether a trailing newline is appended.

#### Scenario: Parakeet selected

- **WHEN** the Parakeet provider is selected
- **THEN** language is detected automatically, prompt hints are not consumed, and inapplicable settings are hidden or explained

#### Scenario: Configurable capture preferences

- **WHEN** a user opens dictation settings
- **THEN** provider, model, language hint, silence interval, maximum duration, and append-newline are configurable

### Requirement: Transcript normalization and insertion rules

An empty or whitespace-only transcript SHALL NOT be written. The transcript SHALL be treated as terminal input, not a command to be evaluated by the client. Bracketed-paste and recording policies SHALL apply through the normal server input path. Dictation SHALL NOT press Enter unless the append-newline setting is enabled. The transcript SHALL NOT be persisted as a Terminay setting, log field, analytics event, or connection-manager value.

#### Scenario: Empty transcript

- **WHEN** the normalized transcript is empty or whitespace-only
- **THEN** nothing is written to the terminal

#### Scenario: Newline behaviour

- **WHEN** the append-newline setting is disabled
- **THEN** the transcript is inserted without pressing Enter

#### Scenario: Transcript not persisted

- **WHEN** a transcript is written
- **THEN** it does not appear in Terminay settings, log fields, analytics events, or connection-manager values

### Requirement: Settings scope and vault storage

Provider, model, and capture preferences SHALL be server settings. Microphone permission SHALL be client-local. Remote-provider API keys SHALL be stored in the server vault: embedded Desktop MAY back the vault with OS secure storage; standalone server deployment SHALL use its configured headless vault policy; clients SHALL be able to set, replace, test, or remove the key through dedicated secret commands but SHALL NOT read it back; and snapshots and settings responses SHALL expose only configured or not-configured status.

#### Scenario: Managing the provider key

- **WHEN** a client sets, replaces, tests, or removes the remote-provider API key
- **THEN** the operation runs through dedicated secret commands and the key is never returned to the client

#### Scenario: Snapshot exposure

- **WHEN** a client reads a settings snapshot
- **THEN** the provider key appears only as configured or not-configured status

### Requirement: Recorder overlay and accessibility

The recorder overlay SHALL be anchored to the intended terminal surface. Its states SHALL be `requesting permission`, `recording`, `transcribing`, `inserting`, `complete`, `cancelled`, and `error`. The overlay SHALL remain usable by keyboard and screen reader. Status SHALL NOT rely only on colour or waveform animation. Reduced-motion preferences SHALL be honoured. The overlay SHALL NOT obscure terminal input more than necessary on narrow screens. Closing the overlay while active SHALL ask for confirmation or act as Cancel.

#### Scenario: Overlay states

- **WHEN** a dictation request progresses
- **THEN** the overlay reports `requesting permission`, `recording`, `transcribing`, `inserting`, `complete`, `cancelled`, or `error` without relying only on colour or waveform animation

#### Scenario: Reduced motion

- **WHEN** the user prefers reduced motion
- **THEN** the overlay honours that preference

#### Scenario: Closing an active overlay

- **WHEN** the user closes the overlay while a request is active
- **THEN** Terminay asks for confirmation or treats the close as Cancel

### Requirement: Error handling

Permission denial, missing microphone, capture failure, timeout, provider failure, invalid credential, unsupported audio, offline server, revoked access, exited terminal, and cancelled request SHALL be distinct outcomes. Retry SHALL NOT reuse audio after the user has cancelled or left the selected server. Provider errors SHALL be sanitized and SHALL NOT expose credentials or full audio. Dictation failure SHALL NOT alter terminal, workspace, or connection state. Temporary audio files SHALL be removed after success, cancellation, or failure.

#### Scenario: Distinct failure reporting

- **WHEN** any dictation failure occurs
- **THEN** the reported outcome distinguishes permission denial, missing microphone, capture failure, timeout, provider failure, invalid credential, unsupported audio, offline server, revoked access, exited terminal, and cancelled request

#### Scenario: Retry after cancel

- **WHEN** the user cancels or leaves the selected server and then retries
- **THEN** the previous audio is not reused

#### Scenario: Failure leaves state intact

- **WHEN** a dictation request fails
- **THEN** terminal, workspace, and connection state are unchanged
- **AND** temporary audio files are removed

### Requirement: Dictation non-goals

Terminay SHALL NOT provide an always-listening mode, background capture after the user leaves the recorder, a direct provider credential in browser code, silent fallback to a different terminal, server, provider, or model, silent fallback from on-device transcription to cloud transcription, storage of dictation audio as a terminal recording, or a realtime partial transcript.

#### Scenario: No background capture

- **WHEN** the user leaves the recorder
- **THEN** capture stops and no background listening continues

#### Scenario: No audio retained as a recording

- **WHEN** a dictation request completes
- **THEN** its audio is not stored as a terminal recording

### Requirement: Dictation acceptance outcomes

Local and remote clients SHALL dictate into a live authorized terminal using the same server insertion command. Cancelling before upload SHALL send no audio and write no text. Focus or window changes during transcription SHALL NOT change the target. An exited, revoked, or mismatched terminal SHALL reject insertion. The provider key SHALL NOT appear in client snapshots, localStorage, logs, or application-protocol payloads sent back to the client. Duration, size, MIME, timeout, and cancellation limits SHALL be enforced on both the client and server boundaries.

#### Scenario: Local and remote parity

- **WHEN** a local client and a remote client each dictate into a live authorized terminal
- **THEN** both use the same server insertion command

#### Scenario: Mismatched terminal rejects insertion

- **WHEN** the insertion target has exited, had authorization revoked, or does not match the request identity
- **THEN** the server rejects the insertion

#### Scenario: Key absent from every client-visible surface

- **WHEN** client snapshots, localStorage, logs, and application-protocol payloads returned to the client are inspected
- **THEN** the provider key appears in none of them
