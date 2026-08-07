# Dictation mode

## Summary

Dictation records a bounded utterance from the connected client's microphone,
transcribes it with the configured provider, and inserts the confirmed
transcript into the exact terminal where dictation started.

Microphone capture is client-local. Provider credentials, transcription policy,
and terminal insertion are server-authorized.

## Availability

- The Command Bar and Desktop Terminal menu contain **Start Dictation**.
- The default shortcut is `CmdOrCtrl+Shift+D` and can be changed through the
  normal shortcut settings.
- Dictation is available only when a live terminal is active and the selected
  client has microphone capability.
- Browsers and Desktop clients request microphone permission through their
  platform.
- A denied or unavailable microphone produces a clear local error without
  contacting the provider.
- Dictation remains opt-in and disabled until a provider and credential are
  configured on the selected server.

## Server/client boundary

The connected client:

- requests microphone permission;
- captures audio with the browser media APIs;
- computes local level/silence information;
- displays and controls the recorder overlay;
- enforces the client-side duration and size limits; and
- sends one bounded recording with its intended server, project, and terminal
  identities.

Terminay Server:

- validates the device and exact target session;
- enforces independent audio size, duration, MIME, and timeout limits;
- resolves the selected provider, model, language, and server-held credential;
- transcribes the recording;
- normalizes the returned text;
- revalidates the target terminal and request identity; and
- writes the transcript through the normal PTY input path.

The server-side provider adapter can resolve its configured vault entry only
through a scoped callback. The callback is not part of any client or status
DTO, and no vault value is included in the selected-server/provider disclosure
shown before capture.

The captured audio is sent to the selected Terminay Server. When a remote
provider is selected it is then sent to that provider; when the on-device
Parakeet provider is selected it remains on the macOS server. The UI discloses
the selected execution location before capture.

Shared clients use a transport-neutral `DictationCaptureClient` boundary for
the local capture state. It snapshots one immutable server/project/panel/
session target and confirmed selected-server/provider disclosure, accepts only
supported bounded audio chunks, and returns a single bounded request on Stop.
Duration, byte, MIME, cancellation, and disconnect/target-change cleanup are
enforced before a transport is allowed to upload audio; the boundary contains
no provider credential or microphone implementation.

## Recording flow

1. The user starts dictation while a live terminal is active.
2. Terminay binds a unique request id to the selected server, project, panel,
   and terminal session.
3. The client asks for microphone permission and starts local recording.
4. An overlay shows recording state, elapsed time, audio level, Stop, and
   Cancel.
5. Capture stops on explicit Stop, the configured silence interval, or the
   maximum duration.
6. Cancel discards local audio and performs no transcription or terminal write.
7. The client uploads the bounded audio through the application protocol.
8. The server transcribes it and returns or publishes the normalized result.
9. The server writes the result only if the original terminal remains live and
   the request is still valid.
10. The overlay reports success or a recoverable error and releases microphone
    resources.

Starting another dictation request while one is active offers to cancel the
first request; it never runs two microphone captures implicitly.

## Target identity and focus

The terminal active at start is the only insertion target. Later focus changes,
tab renames, panel movement, another window becoming active, or a second client
connecting do not retarget the transcript.

If the terminal exits, the server connection changes, authorization is revoked,
or the request is cancelled before insertion, Terminay discards the result and
reports that nothing was written.

A transient client disconnect cancels local capture. A fully uploaded,
server-accepted request follows its request status, but still cannot write to a
different or exited terminal.

## Audio limits

- Supported input formats are the formats accepted by both the capture client
  and configured provider, including WebM where available.
- Default maximum duration is 60 seconds.
- Silence auto-stop defaults to 5 seconds after speech begins.
- Provider and protocol upload limits are enforced before provider submission.
- Audio is transferred with bounded chunks, timeout, cancellation, and
  backpressure.
- Unsupported MIME types, empty recordings, inaudible recordings, and
  oversized payloads fail clearly.

## Transcription and insertion

- The default final-transcript model is `gpt-4o-transcribe` when OpenAI is the
  configured provider.
- Apple Silicon macOS servers can instead select the on-device Parakeet
  provider with the pinned `mlx-community/parakeet-tdt-0.6b-v3` model.
- The Parakeet provider runs through a server-owned MLX worker and keeps the
  loaded model warm between bounded requests. It never sends dictation audio
  to OpenAI, Hugging Face, or another inference service.
- The Parakeet runtime package and model weights may be downloaded on explicit
  user request or first setup. Settings disclose download size/status and the
  network requirement. After installation, transcription works offline.
- While setup is running, Settings polls the privileged runtime and shows its
  current phase: prerequisite checks, Python environment creation, engine
  installation, or model download/load. The phase indicator remains visibly
  active when an exact aggregate byte percentage is unavailable, and setup
  diagnostics are consumed without exposing local paths or unbounded output.
- Provider selection is explicit and stable for the whole request. Failure of
  an on-device provider never falls back to a remote provider.
- Parakeet automatically detects its supported languages and does not consume
  OpenAI-style prompt hints. The UI hides or explains settings which do not
  apply to the selected provider.
- Users can configure provider, model, language hint, silence interval, maximum
  duration, and whether a trailing newline is appended.
- An empty or whitespace-only transcript is not written.
- The transcript is treated as terminal input, not a command to be evaluated by
  the client.
- Bracketed-paste and recording policies apply through the normal server input
  path.
- Dictation does not press Enter unless the append-newline setting is enabled.
- The transcript is not persisted as a Terminay setting, log field, analytics
  event, or connection-manager value.

## Settings and secrets

Provider/model and capture preferences are server settings. Microphone
permission is client-local.

Remote-provider API keys are stored in the server vault:

- embedded Desktop can back the vault with OS secure storage;
- standalone server deployment uses its configured headless vault policy;
- clients can set, replace, test, or remove the key through dedicated secret
  commands but cannot read it back; and
- snapshots and settings responses expose only configured/not-configured
  status.

## UI and accessibility

- The recorder overlay is anchored to the intended terminal surface.
- States are `requesting permission`, `recording`, `transcribing`, `inserting`,
  `complete`, `cancelled`, and `error`.
- The overlay remains usable by keyboard and screen reader.
- Status does not rely only on colour or waveform animation.
- Reduced-motion preferences are honoured.
- The overlay does not obscure terminal input more than necessary on narrow
  screens.
- Closing the overlay while active asks for confirmation or acts as Cancel.

## Error handling

- Permission denial, missing microphone, capture failure, timeout, provider
  failure, invalid credential, unsupported audio, offline server, revoked
  access, exited terminal, and cancelled request are distinct outcomes.
- Retry never reuses audio after the user has cancelled or left the selected
  server.
- Provider errors are sanitized and do not expose credentials or full audio.
- Dictation failure does not alter terminal, workspace, or connection state.
- Temporary audio files are removed after success, cancellation, or failure.

## Non-goals

- No always-listening mode.
- No background capture after the user leaves the recorder.
- No direct provider credential in browser code.
- No silent fallback to a different terminal, server, provider, or model.
- No silent fallback from on-device transcription to cloud transcription.
- No storage of dictation audio as a terminal recording.
- No realtime partial transcript requirement.

## Acceptance outcomes

- Local and remote clients can dictate into a live authorized terminal using
  the same server insertion command.
- Cancelling before upload sends no audio and writes no text.
- Focus or window changes during transcription do not change the target.
- An exited/revoked/mismatched terminal rejects insertion.
- The provider key never appears in client snapshots, localStorage, logs, or
  application-protocol payloads sent back to the client.
- Duration, size, MIME, timeout, and cancellation limits are enforced on both
  client and server boundaries.
