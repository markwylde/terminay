## ADDED Requirements

### Requirement: A view request waits for a project on its way to the window

A client applying a view operation that locates a tab in a named project SHALL wait up to 5 seconds for that project to reach its window. All waits of one operation SHALL share a 9-second deadline, inside the relay's 10-second limit. A project that does not arrive SHALL be refused as `unavailable`. Waiting SHALL NOT widen the projects an operation can reach, and the server's scope checks still apply.

#### Scenario: A focus request overtakes its new project

- **WHEN** the server creates a project and terminal and asks a window to focus that terminal before the window has received the project
- **THEN** the window waits, shows the project when it arrives, and brings the terminal to the front

#### Scenario: A project that never arrives

- **WHEN** a view request names a project that does not reach the window within the render wait
- **THEN** the request is refused as `unavailable` and the window's shown project does not change

#### Scenario: Lookup uses most of the deadline

- **WHEN** a project arrives late in the wait and presenting its tab then does not complete
- **THEN** the client refuses the operation by the 9-second deadline rather than leaving the relay to time out
