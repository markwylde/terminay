## ADDED Requirements

### Requirement: Bundle manifest declarations govern launch

A server UI bundle manifest SHALL declare its bundle format version, its application-protocol version, the minimum execution-runtime it requires, the supported host-bridge version range, and its required and optional host capabilities. Those compatibility fields SHALL be bound into the manifest fingerprint and signature. A manifest with missing, contradictory, unknown, or unbounded requirements SHALL be rejected before any asset executes.

#### Scenario: Compatibility is part of the signature

- **WHEN** a manifest's compatibility fields are altered after signing
- **THEN** verification fails and no asset is executed

#### Scenario: Unbounded requirement is rejected

- **WHEN** a manifest declares an unbounded or contradictory requirement
- **THEN** the bundle is rejected before launch

### Requirement: Independent host contract validation

One shared evaluator SHALL decide compatibility and SHALL produce typed results distinguishing bootstrap, byte-transport, manifest, execution-runtime, host-bridge, and required-capability incompatibility. The decision SHALL be made before executable assets launch and before a new connection or window is committed. A missing optional capability SHALL NOT be an incompatibility: it SHALL be negotiated as presentation, with the shared route contract selecting an in-page fallback or a clear unavailable action.

#### Scenario: Decision precedes execution

- **WHEN** a host prepares to launch a bundle
- **THEN** compatibility is evaluated before any executable asset runs and before the connection or window is committed

#### Scenario: Typed incompatibility

- **WHEN** the execution runtime is older than the manifest's minimum
- **THEN** the evaluator returns an execution-runtime incompatibility distinct from a bridge or capability incompatibility

#### Scenario: Optional capability degrades

- **WHEN** an optional host capability is absent
- **THEN** the connection proceeds and the route contract selects an in-page fallback or a clear unavailable action

### Requirement: Host supplies transport and presentation bridge only

A client host SHALL supply an opaque byte endpoint and a versioned presentation bridge, and nothing else. It SHALL NOT decode or translate feature operation names, command results, workspace snapshots, or application events. Only stable envelope and size validation SHALL remain host-side, and that validation SHALL be application-version agnostic. `TerminayClient` and the feature facades SHALL live in the server bundle's module graph; host packages SHALL depend only on the bootstrap, bundle, transport, profile, and host-bridge contracts.

#### Scenario: Unknown operations are forwarded unchanged

- **WHEN** a bundle sends a valid application frame whose operation name the host does not recognise
- **THEN** the host forwards it unchanged

#### Scenario: Bundle constructs its own client

- **WHEN** a bundle starts over the host-provided byte endpoint
- **THEN** it constructs its own matching `TerminayClient` from its own module graph

#### Scenario: Hostile frames fail closed

- **WHEN** a cross-server frame, an oversized message, or a stale source is presented
- **THEN** the host rejects it without delivering it
