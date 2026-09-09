## MODIFIED Requirements

### Requirement: Server-owned authorization and client subscription

Terminal and project authorization, canonical validation, ordering, snapshots, acknowledgement, and terminal/project mapping SHALL live in Terminay Server. Provider-specific discovery, process binding, incremental reading, version selection, and native-record normalization SHALL live in separately hosted extensions using only the public Extension API. Connected clients SHALL subscribe to the same ordered reduced snapshot and SHALL NOT read provider journals or create competing agent state. A client that holds several connections SHALL subscribe once per connection and SHALL keep each server's ordered reduced snapshot separate; it SHALL NEVER merge two servers' snapshots into one ordered stream or acknowledge an entry through a connection other than the one that published it.

#### Scenario: Client rendering agent state

- **WHEN** a client displays agent status
- **THEN** it renders the server's ordered reduced snapshot and reads no provider journal

#### Scenario: Extension observing a provider

- **WHEN** an extension observes a provider
- **THEN** it uses only the public Extension API and does not perform terminal or project authorization

#### Scenario: Subscriptions on several connections

- **WHEN** a client attaches two servers that each publish agent entries
- **THEN** it holds one subscription per connection, keeps each snapshot ordered by its own server, and acknowledges each entry on the connection that published it

### Requirement: Agents pane presentation

The **Agents** pane SHALL be the Agents sidebar group's collapsible pane. It SHALL show only roots whose exact activation terminal belongs to the current project on that project's own server, keyed by the pair of server and project, and SHALL nest children beneath them. Rows SHALL use stable ordering and the existing tree geometry. Missing metadata SHALL be omitted and prompts SHALL be bounded. A generic terminal tab name SHALL NOT be used as the agent title: an untitled bound root SHALL use the provider label until a provider title, custom terminal name, or prompt is available. The provider label SHALL be the extension contribution `displayName`, and the Agents UI SHALL NOT keep a hardcoded map of provider ids.

#### Scenario: Root in another project

- **WHEN** a bound root's activation terminal belongs to a different project
- **THEN** it is not shown in the current project's Agents pane

#### Scenario: Untitled root

- **WHEN** a bound root has no provider title, custom terminal name, or prompt
- **THEN** it displays the provider's extension contribution `displayName` rather than a generic terminal tab name

#### Scenario: Same project id on another attached server

- **WHEN** another attached server holds a project whose id equals the current project's id and has a bound root
- **THEN** that root is not shown in the current project's Agents pane

### Requirement: Terminal tab and header status surfaces

Bound roots SHALL render the canonical RAG glyph on terminal tabs for `working` always, and for `waiting`, `blocked`, and `done` only while those entries are unacknowledged. The header SHALL aggregate unacknowledged meaningful entries from every attached connection, giving waiting and blocked priority, keeping done until acknowledged, and optionally showing working for navigation. Every aggregated entry SHALL stay keyed by its server and project, and activating one SHALL act on that entry's own server.

#### Scenario: Bound root on a tab

- **WHEN** a terminal has a bound agent root that is working
- **THEN** its tab renders the canonical RAG glyph for working

#### Scenario: Unacknowledged done on a tab

- **WHEN** a background terminal has a bound agent root that is `done` and unacknowledged
- **THEN** its tab renders the green RAG glyph

#### Scenario: Acknowledged done on a tab

- **WHEN** a terminal has a bound agent root that is `done` and acknowledged
- **THEN** its tab does not render a done RAG glyph

#### Scenario: Aggregating in the header

- **WHEN** several unacknowledged entries exist
- **THEN** waiting and blocked entries take priority in the header aggregate and done entries remain until acknowledged

#### Scenario: Entries from two attached servers

- **WHEN** two attached servers each hold an unacknowledged waiting entry
- **THEN** the header aggregate includes both, each row keyed by its server and project, and activating one acts only on that server

### Requirement: Header activity dropdown count badges are fixed-size circles

The header activity dropdown button SHALL present up to three count badges, one each for attention, finished unviewed, and working terminals, each shown only when its count is above zero. Each count SHALL be the number of matching terminals across every attached connection, and the terminals behind it SHALL be listed as rows keyed by server and project. Every count badge SHALL be a circle of one fixed size regardless of the number it displays, with the number centred both vertically and horizontally. The font size SHALL step down as the digit count grows so the circle never widens, and counts above 99 SHALL display as `99+`. The project tab activity count badge SHALL share the same circle size and text treatment so the two surfaces look identical.

#### Scenario: Single digit

- **WHEN** one terminal has finished unviewed activity
- **THEN** the dropdown shows one green circular badge reading `1`, with the text centred and the badge width equal to its height

#### Scenario: Two digits keep the same circle

- **WHEN** twelve terminals are working
- **THEN** the amber badge reads `12` in a smaller font and its width still equals its height

#### Scenario: Count capped at 99+

- **WHEN** more than 99 terminals have finished unviewed activity
- **THEN** the green badge reads `99+` and its width still equals its height

#### Scenario: Counting across attached servers

- **WHEN** one attached server has two working terminals and another has one
- **THEN** the amber badge reads `3` and the dropdown lists three rows, each naming its own server and project
