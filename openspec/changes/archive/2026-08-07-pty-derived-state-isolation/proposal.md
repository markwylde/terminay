## Why

Resuming a busy Codex session reliably closed the Local renderer connection with
`connection outbound queue limit reached`: raw activity updates published `activity.changed`
through the reliable control queue, and once the 1,024-frame connection limit was reached
workspace and terminal creation lost their shared command channel, leaving new projects and
terminals inert.

## What Changes

- Publish semantic activity transitions instead of one activity event per PTY callback,
  while keeping raw-output inactivity deadlines current.
- Add a bounded keyed latest-value traffic class for reconstructible state, separate from
  reliable RPC control and terminal presentation lanes.
- Route **every** non-terminal subscription event through bounded projection delivery, with
  no event-name fallback to the fatal reliable control queue.
- Convert projection congestion into scoped snapshot resynchronization rather than a closed
  application connection.

## Capabilities

### New Capabilities
_None._

### Modified Capabilities
- `terminal-stream-congestion-and-recovery`: reconstructible PTY-derived and subscription
  state gets its own bounded lane and can no longer exhaust reliable control capacity.

## Impact

Server-core terminal and activity services, the event journal, server connection and
subscription delivery, the client subscription and agent-status consumers, and the
projection, activity, and congestion test suites.
