## ADDED Requirements

### Requirement: Single recovery controller and input safety
One connection-scoped controller SHALL own initial activation, automatic
recovery, and manual retry for a mounted workspace. It SHALL expose one
monotonic attempt sequence and one explicit state union covering idle,
connecting, authenticating, resubscribing, hydrating, connected, retry-wait,
blocked, and stopped, and SHALL own the active client and context, confirmed
watermarks, abort signal, retry timer, candidate disposal, and atomic
activation. Retry SHALL be a stable controller action supplied by current
profile identity, never a closure captured from a client.

#### Scenario: Retry after client disposal
- **WHEN** the user activates Retry after the previous client has been disposed
  or several automatic attempts have failed
- **THEN** the retry targets the current profile and controller and starts a
  fresh current attempt immediately, cancelling any retry wait

#### Scenario: Uncertain input is discarded
- **WHEN** a terminal's connection becomes uncertain
- **THEN** its input queue is closed and discarded, no later key is accepted
  until the replacement attachment is current, and input whose delivery outcome
  is unknown is never replayed

#### Scenario: Bounded persistent retries
- **WHEN** a retryable failure recurs
- **THEN** attempts are bounded per attempt with backoff but continue across
  retryable failures

### Requirement: Renderer behaviour while the client is unusable
Connection banners, terminal overlay, button availability, accessibility
announcements, and input enablement SHALL be derived solely from controller
state plus terminal-attachment hydration state. Recovery presentation SHALL be
cleared only after the replacement attachment delivers a command and receives
its confirmed result. A mounted workspace presentation MAY be preserved during
recoverable failure but SHALL lose its command authority.

#### Scenario: No premature connected state
- **WHEN** a replacement transport exists but a post-recovery application
  command still cannot reach the server
- **THEN** the UI does not report connected and does not hide the recovery
  failure

#### Scenario: Deterministic unmount
- **WHEN** the user explicitly disconnects, forgets the profile, replaces its
  credential, or switches profile
- **THEN** the mounted workspace is unmounted deterministically

### Requirement: Post-reconnect restoration
A mounted terminal SHALL keep its prior emulator and confirmed render position
across recovery, and SHALL be resumed or checkpoint-hydrated against the
replacement client exactly once, without recreating its PTY or duplicating
output.

#### Scenario: Terminal resumes after recovery
- **WHEN** a mounted terminal's connection is replaced and hydration completes
- **THEN** it accepts ordered input immediately, retains its prior content, and
  neither recreates its PTY nor duplicates output
