## ADDED Requirements

### Requirement: Recording output preserves UTF-8 stream boundaries

A recording SHALL decode terminal output as one ordered UTF-8 stream rather than as independently encoded PTY callbacks. Decoder state SHALL belong to the active recording, SHALL be released when it ends, and SHALL NOT combine bytes across recording lifetimes. Starting mid-character or ending with an incomplete sequence SHALL use explicit replacement-character behavior rather than borrowing bytes from another recording.

#### Scenario: Character crosses callbacks

- **WHEN** the bytes of a valid UTF-8 character arrive across multiple PTY callbacks during a recording
- **THEN** replay contains that character once without replacement characters

#### Scenario: Recording ends mid-character

- **WHEN** recording stops with an incomplete UTF-8 character pending
- **THEN** that recording finalizes its incomplete sequence and a later recording starts with independent decoder state
