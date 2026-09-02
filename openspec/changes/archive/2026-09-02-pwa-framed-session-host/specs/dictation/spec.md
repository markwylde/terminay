## MODIFIED Requirements

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
