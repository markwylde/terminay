## MODIFIED Requirements

### Requirement: Performance Log window

The Desktop Help menu SHALL provide **Performance Log**, which opens or focuses a native auxiliary window in the same presentation family as Settings, bound to the embedded Local profile. The window SHALL present the startup phase timeline as a proportional breakdown whose phases can be expanded to their recorded sub-phases, the live process and event-loop samples, and a per-terminal table of CPU, memory, and disk that names sessions from the workspace state the window already holds. The window SHALL make the phase that dominated startup identifiable without reading a log file. Opening it SHALL NOT enable the opt-in performance-logging collector, and its content SHALL remain available while that collector is off.

#### Scenario: Opening from the Help menu

- **WHEN** the user chooses **Performance Log**
- **THEN** a native auxiliary window opens, or the existing one is focused
- **AND** the opt-in performance-logging collector is not enabled

#### Scenario: Identifying a slow launch

- **WHEN** a launch was dominated by one startup phase
- **THEN** that phase is identifiable from the window's proportional breakdown without opening a log file

#### Scenario: Heavy collector disabled

- **WHEN** performance logging is off in Settings
- **THEN** the Performance Log window still shows the startup timeline, live samples, and per-terminal usage

