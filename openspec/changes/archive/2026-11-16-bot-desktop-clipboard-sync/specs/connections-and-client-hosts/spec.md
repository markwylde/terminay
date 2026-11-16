## ADDED Requirements

### Requirement: Desktop clipboard sharing session

Desktop SHALL offer an explicitly declared, text-only clipboard sharing capability to its bound top-level server UI document. Starting a session SHALL require a user-selected control desktop. The host SHALL maintain at most one owning session across its windows, bind that session to the exact document lifecycle, and expose no general clipboard object, raw IPC, file paths, or image data. Closing, reloading, navigating, or destroying that document SHALL retire its session. Any pending result SHALL be fenced by the session generation. Clipboard text SHALL be bounded to 1 MiB, remain transient, and never enter persisted state or diagnostic logs. Browser hosts SHALL NOT receive this privileged capability.

#### Scenario: Owner document starts sharing

- **WHEN** the bound Desktop document starts clipboard sharing for its selected control desktop
- **THEN** it receives current eligible text and subsequent changes through a narrow session-scoped route

#### Scenario: Document is replaced

- **WHEN** the owning document reloads, navigates, or is destroyed
- **THEN** the host stops observing for it and rejects updates and asynchronous results from its prior session

#### Scenario: Another frame requests sharing

- **WHEN** a subframe, foreign origin, or unbound renderer requests a sharing session or an update
- **THEN** the host rejects the request without revealing clipboard text

#### Scenario: Host arbitration

- **WHEN** another bound window claims clipboard sharing through selection of its control desktop
- **THEN** the prior window stops receiving or applying updates and only the new owning document can share
