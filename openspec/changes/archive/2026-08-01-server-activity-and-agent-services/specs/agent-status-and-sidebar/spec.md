## ADDED Requirements

### Requirement: Server-composed agent runtime

The loopback hook receiver, hook authentication, environment injection,
provider drivers, trust evaluation, the state reducer, and acknowledgement
SHALL be composed inside the server. Both the embedded Desktop layout and the
standalone server layout SHALL use that one composition, and the hook receiver
SHALL be started before the server's default terminal is created. No client
host SHALL run a second agent authority.

#### Scenario: Standalone server composes the authority

- **WHEN** the standalone server starts
- **THEN** it composes the agent authority and starts its hook receiver before
  creating the default terminal

#### Scenario: Embedded host holds no second authority

- **WHEN** an embedded Desktop build is inspected for agent state ownership
- **THEN** the host delegates snapshot and acknowledgement to the composed
  server authority and retains no independent agent service

### Requirement: Agent protocol surface and reduced snapshots

The server SHALL expose authenticated `agent.snapshot` and `agent.acknowledge`
operations and SHALL publish only the reduced agent projection over them. Hook
tokens and raw provider payloads SHALL NOT reach any client or log.

#### Scenario: Only reduced state crosses the protocol

- **WHEN** a client requests the agent snapshot
- **THEN** it receives the reduced projection
- **AND** it receives no hook token and no raw provider payload

#### Scenario: Two clients see one canonical revision

- **WHEN** two clients are connected and agent state changes
- **THEN** both observe the same canonical reduced revision
- **AND** a client that reconnects receives the current snapshot

### Requirement: Hook resolution by exact terminal session

A provider hook event SHALL be resolved only by the exact immutable server
terminal session it names. The server SHALL reject stale, reordered,
cross-server, exited-session, malformed, and oversized hook events, and SHALL
NOT create state for an unknown session id.

#### Scenario: Unknown session id creates nothing

- **WHEN** a hook event names a session id the server does not own
- **THEN** the event is rejected and no agent entry is created

#### Scenario: Terminal exit is isolated

- **WHEN** one terminal exits
- **THEN** only that terminal's entries become inactive
- **AND** entries for other terminals are unchanged

#### Scenario: Stale lease after receiver restart

- **WHEN** a hook is delivered with a lease issued before the receiver restarted
- **THEN** it is rejected
- **AND** a hook delivered with a fresh lease is accepted

### Requirement: Provider hooks outrank fallback signals

Hook-backed agent state SHALL take precedence over raw and structured terminal
fallback signals and SHALL NOT be overwritten by them. A pending foreground
shell-return retirement SHALL be cancelled when a valid provider hook arrives.

#### Scenario: Fallback cannot overwrite hook state

- **WHEN** a terminal fallback signal contradicts hook-backed agent state
- **THEN** the hook-backed state is retained

#### Scenario: Unsupported provider leaves fallback intact

- **WHEN** a terminal runs a provider with no supported hook
- **THEN** the agent snapshot stays empty for it
- **AND** canonical raw terminal activity remains available

### Requirement: Agent integration policy is server-owned

`agentIntegration.enabled` SHALL be a server-owned authoritative policy. While
disabled, the server SHALL inject no hook variables, SHALL revoke existing
leases, SHALL clear the reduced snapshot, and SHALL reject hook delivery.
Fresh leases SHALL be issued only after the policy is re-enabled.

#### Scenario: Disabling revokes and clears

- **WHEN** agent integration is disabled
- **THEN** existing leases are revoked, the reduced snapshot is cleared, and
  subsequent hook delivery is rejected

#### Scenario: Re-enabling issues fresh leases

- **WHEN** agent integration is re-enabled
- **THEN** new terminals receive fresh hook leases

### Requirement: Managed provider hook reconciliation

The server SHALL reconcile managed Codex and Claude Code hooks in both embedded
and standalone layouts without assuming client-host filesystem layout. A
managed hook SHALL be treated as installed only when it is attached to its
exact native event matcher; a Terminay hook attached to a wrong matcher SHALL
be repaired. User-authored hooks SHALL be preserved, and hook endpoint or token
credentials SHALL NOT be persisted into provider configuration.

#### Scenario: Wrong matcher is repaired

- **WHEN** reconciliation finds a Terminay hook attached to a matcher other
  than its exact native event matcher
- **THEN** the hook is repaired to the correct matcher

#### Scenario: User hooks survive removal

- **WHEN** the managed hooks are removed
- **THEN** user-authored hooks in the same provider configuration remain

#### Scenario: No credentials persisted

- **WHEN** managed hooks are installed
- **THEN** the provider configuration contains no hook endpoint or token

### Requirement: Client projection of agent state

Clients SHALL drive tab indicators, the Agents pane, the header activity menu,
navigation, and acknowledgement from the server's scoped agent projection. The
client adapter SHALL apply ordered events, require a snapshot on a replay gap,
replace its state when the server restarts, and suppress identical snapshots.
Retained rows SHALL be filtered to exact, still-active server, project, and
session identities.

#### Scenario: Scope change publishes without inventing state

- **WHEN** the client changes its session scope
- **THEN** it publishes the changed visible projection
- **AND** it invents neither a revision nor a transition

#### Scenario: Replay gap forces a snapshot

- **WHEN** the client observes a replay gap
- **THEN** it requires a full snapshot before publishing again

#### Scenario: Exited sessions cannot leak

- **WHEN** a session has exited or been remapped
- **THEN** its retained agent rows are filtered out of the client projection

### Requirement: Agents pane lineage and reduced motion

The Agents pane SHALL present ordered root and subagent trees, SHALL filter by
project, and SHALL expose accessible expand and focus controls. When the viewer
prefers reduced motion, row and disclosure-chevron transitions SHALL be
disabled. Activating a row SHALL focus its terminal and then forward that
entry's id through the acknowledgement path.

#### Scenario: Reduced motion disables transitions

- **WHEN** the viewer prefers reduced motion
- **THEN** Agents sidebar row and disclosure-chevron transitions are disabled

#### Scenario: Row activation acknowledges after focus

- **WHEN** an unread Agents-pane row is activated
- **THEN** its terminal is focused
- **AND** that entry's id is forwarded through acknowledgement
