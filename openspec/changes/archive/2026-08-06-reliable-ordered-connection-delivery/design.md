## Context

See proposal.md. Beyond the specific crash, the underlying structural problem
was that command results, replay, and multiple live subscriptions all entered
the same transport from independent asynchronous call sites. There was no
connection-owned outbound admission or serialization boundary defining
ordering, backpressure, or the outcome of a send racing with close.

## Goals / Non-Goals

Goals:
- Every application connection fails atomically and recoverably when its
  outbound stream stops accepting frames.
- Ordered delivery is preserved, or the whole affected connection closes with
  an explicit reason. Silent partial delivery is not a valid outcome.
- A live event rejection can never crash Terminay Server or Desktop.

Non-Goals:
- Changing the application protocol's frame vocabulary or feature semantics.

## Decisions

### One bounded pump per ordered lane

All outbound traffic for a connection — command results, query results, errors,
replay frames, resync frames, and live events — passes through one bounded pump
per ordered lane. The pump preserves accepted frame order, observes
`waitForWritable`, enforces queued byte and frame limits, and does not hold
feature or journal locks while waiting.

### Admission and close are atomic

Send admission and connection close are one atomic decision. After the first
terminal failure, pending and later sends are rejected with one typed
connection reason, so no command can be accepted on a connection whose event
delivery cannot succeed.

### Writability is derived from the primitive, not just the wrapper

The root defect was a logical `open` state that outlived the underlying socket.
Adapters now derive writability from both their own lifecycle and the current
state of the underlying primitive, and the shared transport contract defines
send-versus-close, error-versus-close, and backpressure-versus-abort behaviour
deterministically.

### Failure is connection-scoped

One failed peer cleans up only its own requests and subscriptions. It must not
crash the host, stop a PTY, or affect Local Desktop or another browser.

### The client treats event loss as connection loss

Rather than a feature-specific frozen state, loss of outbound events is treated
as full connection loss: cached projections are marked stale, unsafe mutations
are disabled, a new transport is authenticated, and subscriptions resume from
confirmed revision and position watermarks. A half-closed transport is never
reused by reconnect.

### Diagnostics carry no content

First failure, close reason, queue occupancy, and reconnect outcome are
recorded as bounded metadata only — no terminal bytes, payloads, credentials,
paths, or project names.

## Risks / Trade-offs

- Bounded queues mean a slow consumer will eventually cause a connection to
  close rather than grow memory without limit. That is the intended trade: an
  explicit, recoverable close is preferable to silent partial delivery or an
  unbounded queue.
- Serializing all outbound traffic per lane adds a hop for every frame; the
  lane split keeps terminal presentation traffic from being blocked by other
  traffic.
