## ADDED Requirements

### Requirement: Terminal close protection
A terminal close SHALL derive its decision from an exact-session server-owned
close preflight result, never from a global activity refresh. Canonical
workspace panel removal, PTY termination, and confirmation behaviour SHALL
proceed unchanged once the target decision completes. A limited or timed-out
target observation SHALL present a visible limited-state confirmation that
defaults to keeping the terminal running.

#### Scenario: Close with a busy target
- **WHEN** the close preflight reports the target as busy
- **THEN** the confirmation is shown before the panel is removed and the PTY
  terminated

#### Scenario: Close with an idle target
- **WHEN** the close preflight reports the target as idle
- **THEN** the panel is removed and the PTY terminated under the existing
  behaviour

#### Scenario: Close with a limited target
- **WHEN** the close preflight reports limited or timed-out observation
- **THEN** a limited-state confirmation is shown defaulting to keeping the
  terminal running

### Requirement: Project close protection
Project close SHALL aggregate only that project's canonical sessions. Terminal
close checks SHALL NOT be widened to sibling projects, other workspace views, or
the whole server.

#### Scenario: Project with sessions in another project open
- **WHEN** a project is closed while another project has running sessions
- **THEN** only the closing project's canonical sessions are aggregated
