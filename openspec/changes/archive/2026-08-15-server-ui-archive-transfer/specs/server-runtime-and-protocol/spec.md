## ADDED Requirements

### Requirement: Bundle snapshot integrity and transfer
A server's workspace UI bundle SHALL be transferred to an authenticated client
host as one versioned binary archive over a single request, never as a manifest
plus per-file requests. The archive SHALL be a gzip-compressed tar whose root
contains exactly one metadata file declaring the archive-format version, the
relative UI entry path, a bundle identifier, and the application-protocol
version. The metadata SHALL NOT enumerate or hash individual assets. The server
SHALL prepare the archive once per built bundle and reuse its immutable bytes
for every client. Archive creation and delivery SHALL belong to the server
bundle host, not to a client host.

#### Scenario: Bundle requested by an authenticated host
- **WHEN** an authenticated client host requests the server UI bundle
- **THEN** the server responds with one versioned archive stream

#### Scenario: Second client requests the same bundle
- **WHEN** another client requests the same built bundle
- **THEN** the server reuses the immutable archive bytes it already prepared

#### Scenario: Metadata inspected
- **WHEN** the archive metadata is read
- **THEN** it declares the archive-format version, the relative entry path, the
  bundle identifier, and the application-protocol version
- **AND** it contains no per-asset name or hash list

### Requirement: Bundle acquisition per connection kind
The archive transfer SHALL define framing, ordering, backpressure,
cancellation, timeout, a compressed-byte limit, and typed failures. Body
messages SHALL be binary and SHALL NOT be base64-wrapped in JSON. Each body
message SHALL carry a fixed archive-protocol prefix, a chunk-kind
discriminator, and a big-endian chunk index; over an ordered transport indexes
SHALL start at zero and increase without gaps. The host SHALL acknowledge each
body, the server SHALL keep at most a bounded number of unacknowledged chunks,
SHALL apply an acknowledgement timeout, and SHALL accept a cancellation
message. Completion SHALL be signalled explicitly, and failures SHALL be typed
as cancelled, timeout, unavailable, invalid-request, or internal. Ordinary
direct-HTTPS static bundle routes are normal browser resource delivery and are
outside this transfer contract.

#### Scenario: Backpressure
- **WHEN** the host stops acknowledging chunks
- **THEN** the server stops after its bounded number of unacknowledged chunks

#### Scenario: Acknowledgement timeout
- **WHEN** an acknowledgement does not arrive within the transfer's timeout
- **THEN** the server reports a typed timeout failure

#### Scenario: Host cancels
- **WHEN** the host sends a cancellation message for the transfer id
- **THEN** the server stops sending and reports a typed cancelled failure

#### Scenario: Chunk index gap
- **WHEN** a chunk index does not follow its predecessor over an ordered
  transport
- **THEN** the transfer fails rather than assembling an incomplete archive
