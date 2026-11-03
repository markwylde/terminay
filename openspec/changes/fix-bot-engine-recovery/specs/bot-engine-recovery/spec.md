## ADDED Requirements

### Requirement: Environment observation has bounded effects
The server SHALL publish environment changes only when the observable state changes. Engine events SHALL reconcile only the known bot whose main container the event identifies; helper, workload, unknown and foreign-server containers SHALL NOT invalidate bot state. Pending reconciliation SHALL be bounded per bot. Unchanged observations SHALL NOT postpone idle stop. Bot summaries SHALL use a cheap authorized state read with no stats, log or home-size work. Full measurements SHALL occur only on opening Overview or explicit Refresh.

#### Scenario: Overview helper emits events
- **WHEN** Overview measures one bot's home and its helper emits create, start, exit and removal events with two bots registered
- **THEN** those events cause no bot change notification, summary refetch or additional measurement

#### Scenario: Main container changes
- **WHEN** an owned bot main container stops and emits a burst of events
- **THEN** only that bot is reconciled with bounded pending work and a single notification for the resulting state transition

#### Scenario: Repeated unchanged state
- **WHEN** reconciliation observes the current state repeatedly
- **THEN** it emits no changes and leaves the idle deadline unchanged

### Requirement: Bot failures retain actionable causes
Bot queries, commands and executions SHALL report bounded sanitized bot, engine and image failure messages with machine-readable reasons where the protocol supports them. All execution origins SHALL check engine availability before agent launch and preserve specific startup failure reasons. Runner output SHALL contain a sanitized cause when startup fails before provider output. Credentials, runtime tokens and secret environment values SHALL NOT appear in diagnostics.

#### Scenario: Stopped engine
- **WHEN** chat, a trigger or Environment needs a stopped engine
- **THEN** the result identifies the unavailable engine and the next recovery action, and failed execution diagnostics identify the cause

#### Scenario: Image build fails
- **WHEN** environment preparation cannot build the required image
- **THEN** the execution reports the image build failure with sanitized diagnostic output

### Requirement: Individual bot views expose recovery
The bot header, Chat, Environment and Sessions SHALL expose shared engine status and relevant recovery actions. Unreachable engines SHALL offer Check again and instructions to start the engine. Changed identities SHALL offer Use this engine with confirmation. Missing images SHALL offer Build image; missing or outdated containers SHALL offer the relevant create or recreate action. No action SHALL implicitly accept a different engine identity. After explicit adoption, session preparation SHALL build a missing image and create missing owned environment resources with visible progress.

#### Scenario: Engine reset at the saved address
- **WHEN** the saved address answers with a missing or different identity marker
- **THEN** the bot shows the identity-change reason and confirmed reselection action without mutating engine resources before confirmation

#### Scenario: Fresh bot after adoption
- **WHEN** a user starts a bot on an explicitly adopted empty engine
- **THEN** image build and environment creation are visible and the session can start without navigating away from the bot

### Requirement: Local deletion does not depend on engine reachability
Confirmed deletion SHALL revoke bot runtime authority and remove its local profile, triggers, sessions and messages even when the engine is unavailable or changed. Failed resource removal SHALL produce an explicit warning and a durable pending record containing the original engine identity, ownership and requested home deletion. Deferred removal SHALL run only on a verified matching engine and matching server/bot-owned resources. Preserved homes SHALL remain preserved.

#### Scenario: Delete during outage
- **WHEN** a user confirms deletion with an unreachable engine
- **THEN** local records disappear and the response names pending resource removal

#### Scenario: Different engine appears
- **WHEN** pending removal exists and a different engine is selected
- **THEN** no pending removal runs against that engine even if container names match

#### Scenario: Original engine returns
- **WHEN** the original verified engine becomes available after a server restart
- **THEN** pending removal can complete for matching owned resources and respects the saved home deletion choice

### Requirement: Runtime bridge failures are diagnosable
Failures starting a Terminay-owned MCP relay or adapter SHALL produce bounded sanitized Runner output identifying the failing stage and available cause. Diagnostics SHALL preserve execution capability revocation and bot scope.

#### Scenario: Relay readiness deadline
- **WHEN** the relay fails to become ready before its deadline
- **THEN** Runner output identifies relay readiness failure and includes bounded sanitized stderr when available

#### Scenario: Adapter cannot connect
- **WHEN** the Terminay MCP adapter cannot connect with its execution environment
- **THEN** the session diagnostics identify that connection failure without revealing its socket capability token


#### Scenario: Relay is launched by root
- **WHEN** a privileged supervisor or root process launches a bot execution relay
- **THEN** the socket belongs to the image's unprivileged bot account with mode 0600, the bot-user adapter can connect and call runtime tools, and a root-only socket causes startup to fail with its sanitized diagnostic

#### Scenario: Required real-container CI coverage
- **WHEN** pull-request CI runs
- **THEN** a required job builds the production bot image and verifies socket ownership, distinct root/bot process identities, runtime tool calls, and permission-failure reporting without skipping the container tests

#### Scenario: Claude launches the MCP server through its shell prefix
- **WHEN** Claude starts Terminay's exact MCP stdio command before acquiring shared work
- **THEN** the adapter starts with its execution token and without provider credentials, connects and loads tools, while shell commands and command variants remain subject to work acquisition and lose the runtime token

#### Scenario: Provider silently tolerates MCP startup failure
- **WHEN** a provider completes a turn without authenticated initialization and tool catalog loading on its Terminay MCP connection
- **THEN** the execution is Failed and Runner output identifies missing MCP startup rather than showing a silent Completed chat
