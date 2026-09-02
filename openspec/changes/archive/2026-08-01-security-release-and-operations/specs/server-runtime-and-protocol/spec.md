## ADDED Requirements

### Requirement: Hardened unauthenticated probe and static-host responses

Every unauthenticated health-probe response, including 404, 405, and 503 error
paths, SHALL carry an inert content security policy, anti-framing,
MIME-sniffing, no-referrer, same-origin resource-policy, and a restrictive
permissions policy denying browser capability access. Every static web-host
response SHALL carry a local-content content security policy, anti-framing,
MIME-sniffing, referrer, and restricted-capability policy that still permits
user-selected HTTP(S) and WS(S) Terminay Server connections while restricting
executable and document content to the web image origin.

#### Scenario: Health-probe error response

- **WHEN** the unauthenticated health probe returns 404, 405, or 503
- **THEN** the response carries the same inert policy headers as a success
  response, including a restrictive permissions policy

#### Scenario: Static web-host response

- **WHEN** the static web host serves any response
- **THEN** executable and document content is restricted to the web image origin
  while user-selected Terminay Server connections remain possible

### Requirement: Bounded subscriber admission per terminal

The server SHALL bound the number of concurrent subscribers admitted per
terminal session. An authenticated subscriber beyond the configured capacity
SHALL be rejected with `subscriber_limit`. A detach or resume cycle SHALL
complete without retaining an excess subscriber.

#### Scenario: Capacity exceeded

- **WHEN** an authenticated client subscribes to a terminal that is already at
  its configured subscriber capacity
- **THEN** the subscription is rejected with `subscriber_limit`

#### Scenario: Detach and resume at capacity

- **WHEN** a subscriber detaches and resumes while the terminal is at capacity
- **THEN** the cycle completes and no excess subscriber is retained

### Requirement: All-or-nothing canonical state mutation under storage failure

A canonical state store that is read-only, permission-denied, or out of capacity
SHALL remain safely queryable. A workspace revision that cannot be committed
completely SHALL be rejected with no partial canonical mutation. Once capacity or
permissions return, the next complete revision SHALL be accepted.

#### Scenario: Revision during storage failure

- **WHEN** a complete workspace revision is attempted while the state store is
  read-only, permission-denied, or out of capacity
- **THEN** the revision is rejected and no partial canonical mutation occurs

#### Scenario: Recovery

- **WHEN** capacity or permissions are restored
- **THEN** one fresh complete revision is accepted

### Requirement: Monotonic lease expiry

Lease and credential expiry SHALL be evaluated from monotonic elapsed time. A
wall-clock rollback SHALL NOT extend a lease, a forward jump SHALL fail closed,
and a later rollback SHALL NOT revive an expired lease.

#### Scenario: Clock rollback

- **WHEN** the wall clock is moved backwards
- **THEN** no lease is extended and an already expired lease is not revived

#### Scenario: Clock jumps forward

- **WHEN** the wall clock jumps forward
- **THEN** evaluation fails closed rather than granting continued authority

### Requirement: Verified release artifacts and atomic activation

A release candidate SHALL be rejected unless its artifact, embedded server, and
embedded UI semantic versions match exactly. A staged artifact identifier SHALL
be immutable: an existing staged artifact directory SHALL be rejected before any
payload write. Verification SHALL use `lstat` on every security-relevant path so
that matching bytes outside the immutable artifact directory cannot satisfy a
manifest. Activation SHALL validate the staged artifact before changing the
active pointer, rollback SHALL validate the exact prior artifact before switching
back, and selected entrypoints SHALL match the verified manifest. An
incompatible candidate SHALL leave the active pointer unchanged.

#### Scenario: Version mismatch in a candidate

- **WHEN** a candidate's artifact, embedded server, and embedded UI versions do
  not match exactly
- **THEN** the candidate is rejected before installation or upgrade

#### Scenario: Reused artifact identifier

- **WHEN** a second candidate is staged under an existing artifact identifier
- **THEN** it is rejected before any payload is written

#### Scenario: Substituted symlink

- **WHEN** an artifact root, manifest, or payload is replaced by a symlink to
  matching bytes elsewhere
- **THEN** verification fails and the active pointer is unchanged

#### Scenario: Rollback

- **WHEN** a rollback is requested
- **THEN** the exact prior artifact is validated before the active pointer
  switches back

### Requirement: Independent Desktop and standalone update behaviour

Desktop-host updates and standalone-server updates SHALL be independent. An
update SHALL preserve the local server identity and data root across upgrade and
rollback, and SHALL NOT replace a remote server. A protocol, schema, migration,
or non-newer incompatibility SHALL recover the same active installation without
mutation.

#### Scenario: Remote server selected

- **WHEN** a Desktop host update runs while a remote server connection is
  selected
- **THEN** the remote server is not replaced

#### Scenario: Upgrade and rollback

- **WHEN** a local server is upgraded and later rolled back
- **THEN** its identity and data root are preserved across both

#### Scenario: Incompatible candidate

- **WHEN** a candidate is incompatible by protocol, schema, migration, or is not
  newer
- **THEN** the same active installation is recovered without mutation

### Requirement: Server-bundled UI during host-version mismatch

A server SHALL continue to serve its verified workspace bundle directly when a
connecting host's version is incompatible, while the compatibility matrix SHALL
reject that incompatible host.

#### Scenario: Incompatible Desktop host

- **WHEN** a Desktop host whose version the compatibility matrix rejects connects
- **THEN** the host connection is refused while the direct server-origin bundle
  remains usable
