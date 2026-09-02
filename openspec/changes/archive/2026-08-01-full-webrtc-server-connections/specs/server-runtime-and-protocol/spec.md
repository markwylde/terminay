## ADDED Requirements

### Requirement: Transport neutrality and conformance
The application protocol SHALL be transport-neutral. Every transport, including headless
WebRTC channels, SHALL satisfy one shared conformance suite covering the four-lane contract,
bounds, cleanup, and admission, and SHALL produce the same protocol behaviour as the Local
transport.

#### Scenario: Same suite over both transports
- **WHEN** the framed application suite runs over the Local transport and over isolated
  headless channels
- **THEN** workspace and project identity, terminal create/IO/resize/detach/reattach/reconnect
  ownership, files, Git, agents, binary bodies, cancellation, and composition cleanup behave
  identically

#### Scenario: Injected runtime label
- **WHEN** a headless runtime is injected under any runtime label
- **THEN** it must satisfy the same four-channel, limit, cleanup, and admission contract

### Requirement: Channel queue accounting is released on teardown
When a traffic channel closes or fails, queued application frames SHALL be discarded and
inbound-byte accounting reset, so a stalled consumer cannot retain its bounded queue or
replay stale frames after teardown. Transport diagnostics SHALL report zero outbound queued
bytes rather than a stale native buffered counter.

#### Scenario: Stalled consumer channel closes
- **WHEN** an application channel with queued frames closes
- **THEN** the queue is discarded, inbound-byte accounting resets, and no frame is replayed
  to a later transport

#### Scenario: Invalid buffered-byte counter
- **WHEN** a native buffered-byte counter throws, or is non-finite, negative, or out of the
  bounded transport range
- **THEN** flow control receives the concrete failure, the relay is not retained, and status
  inspection returns a safe value only after teardown

### Requirement: Bounded backpressure waits
Every channel SHALL bound its writable-wait budget and fail closed when it is exceeded,
including asset transfers.

#### Scenario: Slow asset channel
- **WHEN** an asset channel remains above its backpressure budget beyond the wait budget
- **THEN** the transport fails closed rather than waiting indefinitely

### Requirement: Server UI bundle distribution to remote clients
A server SHALL deliver its complete responsive workspace bundle manifest and assets to a
remote client with current hash, path, and size verification and versioned cache paths.
Compatible previously committed bundles SHALL be preserved until a new install commits, and a
partial update SHALL never launch.

#### Scenario: Stalled bundle transfer
- **WHEN** a bundle asset read stalls beyond its bound
- **THEN** the previously committed verified bundle and pointer are preserved and no partial
  bundle is launched

#### Scenario: Isolated session origin
- **WHEN** a direct or embedded server UI mode launches
- **THEN** it runs on the exact isolated session origin for that server

### Requirement: Bundle snapshot integrity and transfer
Bundle verification SHALL accept only regular files inside the content-addressed namespace.
A manifest or declared asset replaced by a symlink, an entry document that is not HTML or
whose bytes are malformed UTF-8, an entry that references cross-origin executable code, and a
substituted hash beneath another bundle identity SHALL each fail closed and preserve the
prior committed pointer.

#### Scenario: Symlinked asset
- **WHEN** a committed bundle's manifest or declared asset is replaced by a filesystem
  symlink
- **THEN** verification fails closed before serving the outside file and the prior committed
  pointer is retained

#### Scenario: Cross-origin executable reference
- **WHEN** a verified HTML entry references executable code from another origin
- **THEN** the bundle is rejected and the prior committed bundle remains in place

#### Scenario: Substituted hash
- **WHEN** an asset with a substituted hash is offered beneath another content-addressed
  bundle identity
- **THEN** installation is rejected
