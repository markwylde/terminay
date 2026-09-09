## ADDED Requirements

### Requirement: Dictation resolves its server from the target terminal

Dictation availability, provider and credential configuration, transcription, and
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
