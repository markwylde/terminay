## MODIFIED Requirements

### Requirement: Fallback interpreter profiles

Fallback interpretation SHALL remain provider-aware only to avoid known false positives and SHALL NOT be the canonical agent-driver layer. The generic interpreter SHALL prioritize active progress, then an executing shell command, then foreground-process evidence, then raw output. The legacy Claude Code interpreter SHALL treat `OSC 9;4` as a turn boundary and ignore cosmetic output after progress clears. The legacy Codex interpreter SHALL treat a notification as a turn boundary and ignore spinner output after the boundary. These profiles SHALL apply only when the session has no authoritative journal-backed agent entry.

A profile SHALL claim a session only while it is actually observing the kind of signal it interprets. A profile selected for a session that produces no signal of that kind within the configured progress-signal timeout SHALL release the claim, and the generic interpreter SHALL then describe that session. A profile SHALL NOT hold a claim on the strength of a matching foreground process name alone.

#### Scenario: Generic interpreter precedence

- **WHEN** the generic interpreter evaluates a session
- **THEN** it prioritizes active progress, then an executing shell command, then foreground-process evidence, then raw output

#### Scenario: Profile on a journal-backed session

- **WHEN** a session has an authoritative journal-backed agent entry
- **THEN** no interpreter profile applies to it

#### Scenario: Trailing cosmetic output

- **WHEN** progress clears and cosmetic output continues under the Claude Code interpreter
- **THEN** the turn boundary stands and working does not restart

#### Scenario: Profile observes no signal of its kind

- **WHEN** a selected profile receives no signal of the kind it interprets within the progress-signal timeout
- **THEN** it releases the claim and the generic interpreter describes the session

#### Scenario: Matching process name without signals

- **WHEN** a session's foreground process name matches a profile but the terminal emits no signal that profile interprets
- **THEN** the profile does not hold a claim on that session

### Requirement: Interpreter claim disables the raw-output timer

An interpreter that claims a session SHALL disable the raw-output timer for that session, preventing continuously repainting TUIs from oscillating between working and finished. The timer SHALL be restored when the claim is released, so a session with neither an authoritative agent entry nor a live interpreter claim is never left without any activity source.

#### Scenario: Repainting TUI

- **WHEN** an interpreter has claimed a session and the TUI repaints continuously
- **THEN** the raw-output timer is disabled and the session does not oscillate between working and finished

#### Scenario: Claim released

- **WHEN** an interpreter releases its claim on a session
- **THEN** the raw-output timer is restored for that session

## ADDED Requirements

### Requirement: No terminal is left without an activity source

A terminal SHALL always have exactly one live source describing it: an authoritative journal-backed agent entry, a claimed structured-signal interpreter, or the raw-output fallback. A terminal running a recognized agent CLI whose authoritative binding is unavailable SHALL show fallback terminal activity rather than no indicator at all.

#### Scenario: Recognized agent CLI without a binding

- **WHEN** a recognized agent CLI is the foreground process and no authoritative agent entry exists for its terminal
- **THEN** the terminal shows fallback terminal activity rather than no indicator

#### Scenario: Exactly one live source

- **WHEN** a terminal is producing output
- **THEN** exactly one of an authoritative agent entry, a claimed interpreter, or the raw-output fallback describes it
