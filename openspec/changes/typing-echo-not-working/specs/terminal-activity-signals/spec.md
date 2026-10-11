## ADDED Requirements

### Requirement: Output that follows user input is not raw-output activity

In the raw-output tier, PTY output that arrives within one second of user input to that session SHALL NOT count as raw-output activity: it SHALL neither begin `working` nor extend it. Output that arrives one second or more after the most recent user input SHALL count as raw output otherwise does. Output that does not count SHALL NOT publish an activity event. This requirement SHALL apply only to the raw-output tier: `working` derived from active progress, an executing shell command, foreground-process evidence, or a provider-backed agent SHALL be unaffected by how recently the user typed.

#### Scenario: Typing at a prompt

- **WHEN** a user types a character into an idle terminal in the raw-output tier and the shell echoes it
- **THEN** the terminal stays idle
- **AND** its tab shows no amber or yellow indicator

#### Scenario: Continuous typing

- **WHEN** a user types into an idle terminal in the raw-output tier for several seconds with less than one second between keystrokes
- **THEN** the terminal stays idle for the whole period
- **AND** no activity event is published for the echoed output

#### Scenario: Typing just after output

- **WHEN** a terminal in the raw-output tier is working because it has just printed output, and the user starts typing before that working period ends
- **THEN** the echoed output does not extend the working period
- **AND** the terminal becomes idle when the period that began with the earlier output ends

#### Scenario: Output continues after typing stops

- **WHEN** a terminal in the raw-output tier produces output continuously, the user types into it, and output is still arriving one second after the last keystroke
- **THEN** the terminal is working when that output arrives

#### Scenario: Command whose output outlasts the window

- **WHEN** a user presses Enter in a terminal in the raw-output tier and the command is still producing output one second after that keystroke
- **THEN** the terminal becomes working when that output arrives

#### Scenario: Command that finishes inside the window

- **WHEN** a user presses Enter in a terminal in the raw-output tier and all of the command's output arrives within one second of that keystroke
- **THEN** the terminal does not become working

#### Scenario: Session claimed by structured signals

- **WHEN** a user types a command and presses Enter in a terminal whose shell integration emits a command-executing marker
- **THEN** the terminal becomes working when the marker arrives, however recently the user typed
