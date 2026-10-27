## MODIFIED Requirements

### Requirement: Server-persisted state inventory

The server SHALL persist and publish ordered workspace views and their project
membership; projects, roots, start state, names, colours, icons, default
shell-profile references, and sidebar layout configuration; the server's recent
project folders; logical panel layout, splits, order, notes, and appearance;
terminal identity, lifecycle, metadata, bounded output position, activity, and
recording state; file and folder navigation and modes where they are part of the
shared workspace; settings affecting shells, project services, terminal
behaviour, recording, remote exposure, agents, AI providers, macros, and server
automation; macros and server-held secrets; authoritative agent and activity
state and acknowledgement; the app window records of terminal sessions that
are running; paired devices, public device keys, exposure state,
and audit records; and schema and revision metadata needed for safe migration
and resync.

#### Scenario: Fresh client rebuilds the workspace

- **WHEN** a project with terminal, file, and folder panels is reopened from a
  fresh client
- **THEN** it reconnects using only server state

#### Scenario: App windows of a running terminal are kept

- **WHEN** the server restarts while a terminal session that owns app windows
  keeps running
- **THEN** the server publishes that session's windows again from what it
  persisted

#### Scenario: Agent and activity state is authoritative on the server

- **WHEN** a client queries agent or activity state
- **THEN** the server's authoritative state and acknowledgement are returned

#### Scenario: A project awaiting a start choice survives a fresh client

- **WHEN** a project awaits a start choice and a fresh client connects
- **THEN** that client shows the project's start chooser and the server's recent project folders
