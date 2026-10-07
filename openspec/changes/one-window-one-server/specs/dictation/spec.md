## ADDED Requirements

### Requirement: Dictation uses the server that owns the target terminal

Dictation availability, provider and credential configuration, transcription, and
insertion SHALL all resolve against the window's server, which owns the target
terminal, and against no other server the device knows. Where that server has no
dictation provider or credential configured, dictation SHALL be unavailable for
that terminal even when another server the device connects to has one.

#### Scenario: Dictating into a remote server's terminal

- **WHEN** the user dictates while a terminal is active in a window showing a
  remote server
- **THEN** the audio is transcribed by that server and the transcript is inserted
  into that terminal

#### Scenario: Only another server is configured

- **WHEN** the window's server has no dictation provider or credential configured
  while a server shown in another window has one
- **THEN** dictation is unavailable for that terminal and no other server
  transcribes for it

## REMOVED Requirements

### Requirement: Dictation resolves its server from the target terminal

**Reason**: Its text and scenarios describe a window holding a primary connection and attached connections. A window shows one server.

**Migration**: Restated for one server per window as "Dictation uses the server that owns the target terminal".
