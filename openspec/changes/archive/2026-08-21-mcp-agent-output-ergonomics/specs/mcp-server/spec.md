## ADDED Requirements

### Requirement: Two distinct output representations

The MCP surface SHALL expose raw terminal output and emulated presentation as
two distinct representations with distinct contracts. Raw output SHALL be a
lossless byte range addressed by a cursor. Text and ANSI output SHALL be a
snapshot of the terminal's current emulated presentation at a captured
geometry, and SHALL NOT be presented as a byte-range transcript.

#### Scenario: A snapshot read rejects a cursor

- **WHEN** a text or ANSI read supplies a cursor argument
- **THEN** the request is rejected
- **AND** no false visual delta is returned

### Requirement: Raw output range reads

A raw output read SHALL be served by one server-owned replay-range reader used
by every MCP host. It SHALL validate the supplied source cursor, capture a
terminal high-watermark, and return exact bounded bytes as Base64 together with
retention metadata and a next cursor. It SHALL NOT create an oversized replay
subscription, and no host SHALL read MCP output from a separate local buffer.

#### Scenario: Successive reads cover the stream

- **WHEN** an agent reads raw output and repeats the read using the returned
  next cursor
- **THEN** the decoded bytes cover the retained stream without overlap and
  without gaps

#### Scenario: Bytes decode exactly

- **WHEN** raw output is returned
- **THEN** the Base64 decodes byte-for-byte to the retained terminal output,
  including binary and invalid UTF-8 bytes

### Requirement: Raw cursor faults are distinguished

A raw read SHALL distinguish cursor faults. A cursor older than retained
history SHALL report history loss and the current earliest readable position. A
cursor beyond the captured high-watermark SHALL be rejected. A range bounded by
the response budget SHALL report tail truncation together with a usable next
cursor.

#### Scenario: Stale cursor reports history loss

- **WHEN** the supplied cursor precedes retained history
- **THEN** the response reports history loss and the current earliest readable
  position

#### Scenario: Future cursor is rejected

- **WHEN** the supplied cursor is beyond the captured high-watermark
- **THEN** the request is rejected

#### Scenario: Bounded range yields a next cursor

- **WHEN** more retained bytes exist than the budget allows
- **THEN** the response reports tail truncation and returns a usable next cursor

### Requirement: Current presentation snapshot reads

A text or ANSI read SHALL return the canonical emulator's current visual rows at
its captured geometry, using one shared definition of visual-row extraction,
wrapping, and safe ANSI serialization across every MCP host. Raw paste markers
and cursor-motion source SHALL be omitted. Presentation truncation SHALL be
signalled distinctly from history loss and pagination truncation.

#### Scenario: Rows match the emulator

- **WHEN** a text or ANSI snapshot is read
- **THEN** the rows match the canonical emulator at the captured geometry

#### Scenario: Paste markers are omitted

- **WHEN** bracketed paste markers or cursor-motion sequences are present in the
  source stream
- **THEN** they do not appear in the returned presentation

### Requirement: Output response budgets

Output reads SHALL apply a response-safe default size and a public maximum, and
SHALL measure the complete serialized response rather than the payload alone. A
valid read of retained data larger than the budget SHALL return a bounded result
with an explicit truncation signal rather than failing as exceeding a limit.

#### Scenario: Oversized retained data is bounded, not refused

- **WHEN** the retained data exceeds the response budget
- **THEN** a bounded result with a truncation signal is returned

#### Scenario: Serialized response stays under the endpoint limit

- **WHEN** any output read returns
- **THEN** its full serialized response is below the endpoint limit

### Requirement: Bounded literal presentation search

Presentation search SHALL be literal and scoped to the current emulated
snapshot. It SHALL return ordered results bounded by case handling, context
lines, match count, scan extent, and a byte budget, SHALL NOT allocate an
unbounded row or result array, and SHALL NOT expose a reusable visual-row
cursor.

#### Scenario: Search is bounded and ordered

- **WHEN** a search matches more occurrences than the configured limits allow
- **THEN** ordered results are returned within the context, match, scan, and
  byte bounds

#### Scenario: No reusable row cursor

- **WHEN** search results are returned
- **THEN** they contain no cursor that could be used to page a snapshot

### Requirement: run_command submission contract

`run_command` SHALL return a command identifier, the output position captured
before the write was accepted, the number of submitted bytes, and an explicit
submitted flag. The command identifier SHALL be a submission identifier only; it
SHALL NOT be presented as a completion, exit-status, or output-attribution
identifier.

#### Scenario: Position precedes the write

- **WHEN** a command is submitted
- **THEN** the returned position was captured before the write was accepted

#### Scenario: Submission id is not a completion id

- **WHEN** a client inspects the returned command identifier
- **THEN** it identifies the submission only, with no correlation to shell
  completion, exit status, or attributable output

### Requirement: Adapter capability reporting

An MCP host SHALL expose a capability query stating adapter-global availability
of optional operations, so an agent can determine which optional wait operations
exist before calling them. A registered but unavailable tool SHALL continue to
fail with its stable unsupported-operation error.

#### Scenario: Optional waits are discoverable

- **WHEN** an agent queries capabilities on a host whose structured waits are
  unavailable
- **THEN** those operations are reported as unavailable before they are called

#### Scenario: Unavailable tools fail stably

- **WHEN** an unavailable registered tool is called anyway
- **THEN** it returns the stable unsupported-operation failure

### Requirement: Cross-host response conformance

Every MCP host SHALL satisfy shared required-response schema fixtures for the
common fields of each tool, while documented host-specific extensions remain
permitted. Deterministic coverage SHALL include stdio framing and parser edge
cases, invalid UTF-8 and Unicode, cursor retention, loss, and pagination,
complete serialized control and MCP response bounds, invalid format and
parameter combinations, capability reporting, and required common-field
conformance for every adapter.

#### Scenario: Both hosts satisfy the fixtures

- **WHEN** the shared response fixtures are run against each MCP host
- **THEN** every required common field is present
- **AND** documented host extensions do not fail the fixtures
