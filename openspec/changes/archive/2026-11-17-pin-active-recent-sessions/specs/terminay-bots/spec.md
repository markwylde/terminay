## ADDED Requirements

### Requirement: Active sessions pinned in recent sessions

The context rail's recent sessions SHALL list a bot's active sessions (queued, running, or needs you) before its inactive ones, each group newest first. The rail SHALL show at most six sessions, chosen after this ordering, so no newer inactive session displaces an active one; with more than six active, it shows the six newest active sessions.

#### Scenario: Older active session pinned above newer finished sessions

- **WHEN** a bot has a running session and, started after it, two sessions that have completed
- **THEN** the rail lists the running session first, followed by the two completed sessions newest first

#### Scenario: Active sessions keep recency order

- **WHEN** a bot has a session that needs you and a newer queued session
- **THEN** the rail lists the queued session first and the session that needs you second, both above any inactive session

#### Scenario: Active session not pushed out of the rail

- **WHEN** a bot has a running session and more than six newer sessions that have ended
- **THEN** the running session is the first row of the rail and the rail still shows six rows

#### Scenario: Session leaves the pinned group when it ends

- **WHEN** a pinned running session completes
- **THEN** the rail moves it into the inactive group at its newest-first position without the user reloading

#### Scenario: Suspended session is not pinned

- **WHEN** a bot has a suspended session and a newer completed session
- **THEN** the rail lists the completed session first

#### Scenario: More active sessions than rows

- **WHEN** a bot has eight active sessions and some ended sessions
- **THEN** the rail shows the six newest active sessions and no ended session

#### Scenario: Active session older than twenty newer sessions

- **WHEN** a bot has a session that needs you and more than twenty newer sessions that have ended
- **THEN** the rail's first row is the session that needs you

### Requirement: Active recent sessions marked as live

Each active row in the context rail's recent sessions SHALL show its state label, offer Stop, and show a pulsing state dot. Inactive rows SHALL NOT pulse, and no row SHALL pulse when the user prefers reduced motion.

#### Scenario: Active row marked as live

- **WHEN** the rail shows a queued, running, or needs-you session
- **THEN** its row shows a pulsing state dot, its state label, and a Stop button, an ended session's dot does not pulse, and no dot pulses when the user prefers reduced motion
