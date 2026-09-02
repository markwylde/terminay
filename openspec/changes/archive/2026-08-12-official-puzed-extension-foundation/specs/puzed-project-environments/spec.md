## ADDED Requirements

### Requirement: Extension composition and boundaries
Puzed support SHALL be delivered as the separate official
`terminay-plugin-puzed` package, installed on a Terminay Server, that depends
on the SSH extension and produces a stable SSH dependency descriptor. It SHALL
NOT import internal Terminay modules or Puzed UI.

#### Scenario: Package dependency graph
- **WHEN** the published package's imports are inspected
- **THEN** it depends on the SSH extension and contains no internal Terminay or
  Puzed UI imports

### Requirement: Puzed API transport security
The Puzed API client SHALL use HTTPS against the profile's exact configured
origin, carry a bearer key held in the server vault, bound request size and
time, refuse to follow a redirect that changes the origin, and keep keys,
scopes, and organization identifiers out of client responses and logs.

#### Scenario: Redirect to another origin
- **WHEN** the Platform responds with a redirect to a different origin
- **THEN** the client refuses the redirect and reports a bounded error

#### Scenario: Error surfaced to a client
- **WHEN** an API error is projected to a client
- **THEN** it contains no API key, scope, or bearer material

### Requirement: Test connection and scope validation
A Platform profile SHALL be validated against `/me` for organization membership
and required scopes before its resources are used, and the validation result
SHALL be auditable.

#### Scenario: Insufficient scope
- **WHEN** the configured key lacks a required scope or organization membership
- **THEN** the profile reports an explicit failed validation state and its
  resources are not offered

### Requirement: Versioned Puzed API contract
The provider client SHALL be generated from the current Go-authored OpenAPI
contract rather than hand-written provider DTOs.

#### Scenario: Contract regenerated
- **WHEN** the Platform's OpenAPI contract changes
- **THEN** the client is regenerated from that contract and no parallel
  hand-written DTO is maintained

### Requirement: Tagged VM inventory
VM inventory SHALL be paginated and filtered to machines carrying the exact
`system:Terminay` tag, alongside image, worker, bridge, settings, and job
discovery with capability and disabled reasons and exact Open in Puzed routes.
An untagged machine SHALL NOT be selectable.

#### Scenario: Untagged machine present
- **WHEN** the organization contains machines without the `system:Terminay` tag
- **THEN** they do not appear in inventory and cannot be selected

### Requirement: Shared event stream per profile organization
The extension SHALL share one authenticated resumable event stream per profile
organization, carrying payload-free invalidations that cause the exact affected
resource to be refetched. Polling SHALL NOT be used for state refresh.

#### Scenario: Resource invalidated
- **WHEN** an invalidation for a machine or job arrives
- **THEN** the extension refetches that exact resource rather than receiving its
  content on the event channel

#### Scenario: Stream interrupted
- **WHEN** the stream is interrupted and resumes
- **THEN** state is resynchronised by refetch without polling

### Requirement: Lifecycle management surface
Start, stop, resume, reboot, and delete SHALL be idempotent, carry revisions,
report operation conflicts, disk disposition, and progress, and expose a
management status independent of project state.

#### Scenario: Repeated lifecycle request
- **WHEN** the same lifecycle operation is submitted twice with the same
  identity
- **THEN** it is applied once and the second request returns the same outcome

#### Scenario: Conflicting operation
- **WHEN** a lifecycle operation is requested while another is in progress
- **THEN** the conflict is reported rather than both being applied

### Requirement: Project close never changes VM lifecycle
Closing or removing a project SHALL NOT start, stop, delete, or otherwise change
the lifecycle of its Puzed VM, and opening SHALL NOT assume SSH readiness.

#### Scenario: Project closed
- **WHEN** a project bound to a Puzed VM is closed
- **THEN** the VM's state is unchanged

### Requirement: Reopening uses retained SSH binding only
Opening an existing Terminay-tagged VM SHALL require the matching retained SSH
key binding. A tagged VM without a retained private-key binding SHALL be shown
as non-openable, and arbitrary credential adoption SHALL NOT be offered.

#### Scenario: Tagged VM without retained key
- **WHEN** a `system:Terminay` VM has no retained private-key binding
- **THEN** it is rendered as non-openable and no alternative credential is
  offered

#### Scenario: Stopped VM opened
- **WHEN** a stopped tagged VM with a retained binding is opened
- **THEN** it is started and opened through that retained binding, resuming any
  in-progress provisioning
