## ADDED Requirements

### Requirement: Terminal line-feed semantics

The **Convert LF to CRLF** setting SHALL be off by default and SHALL turn on only through an explicit choice by a user or an authorised client. That choice SHALL persist across restarts and later settings changes. While the setting is off, a bare line feed (LF) SHALL move the cursor down one row and keep its column, scrolling at the bottom margin. While it is on, each bare LF SHALL also return the cursor to column 0.

#### Scenario: Raw-mode program positions text after a bare line feed

- **WHEN** Convert LF to CRLF is off and a program writes text, a bare LF, and more text without a carriage return, and the cursor is above the bottom margin
- **THEN** the second text starts on the next row, in the column where the first text ended

#### Scenario: Bare line feed at the bottom margin

- **WHEN** Convert LF to CRLF is off and a program writes a bare LF while the cursor is on the bottom row
- **THEN** the screen scrolls up one line and the cursor keeps its column

#### Scenario: Shell output keeps starting at column zero

- **WHEN** a program in cooked mode writes lines ending in LF and the PTY translates them to CR LF
- **THEN** each line starts at column 0

#### Scenario: Explicit opt-in

- **WHEN** a user turns Convert LF to CRLF on
- **THEN** each bare LF also returns the cursor to column 0

#### Scenario: Opt-in survives restarts and other settings changes

- **WHEN** a user has turned Convert LF to CRLF on and then changes an unrelated setting and restarts Terminay and its server
- **THEN** the setting is still on

#### Scenario: Default

- **WHEN** a server starts with no stored value for Convert LF to CRLF, or a user resets it
- **THEN** the setting is off
