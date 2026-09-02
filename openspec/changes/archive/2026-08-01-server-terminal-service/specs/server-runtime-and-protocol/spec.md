## ADDED Requirements

### Requirement: Server-owned session lifetime
A terminal session's lifetime SHALL be owned by the server process, not by any
client. Session termination SHALL occur only on an explicit authorized kill, on
process exit, or on server shutdown. Client disconnection, renderer
destruction, and native-window close SHALL detach subscriptions only.

#### Scenario: Native window closed
- **WHEN** the native window displaying a terminal closes
- **THEN** the session's subscriptions detach and the session stays alive

#### Scenario: Server shutdown
- **WHEN** the server shuts down
- **THEN** the interruption is represented exactly once per affected session

### Requirement: Window-independent PTY adapter
Concrete terminal-runtime loading SHALL sit behind a window-independent server
adapter with an injectable factory seam, so the runtime can be exercised
against a real shell in tests and so no host window concept reaches the PTY
layer.

#### Scenario: Subscription detach during a live process
- **WHEN** every subscription to a session detaches
- **THEN** the single PTY process continues and later resumes delivery from a
  known output position

#### Scenario: Real shell through the factory seam
- **WHEN** the adapter is driven with a real shell through its factory seam
- **THEN** spawn, input, resize, exit, and shutdown behave as specified without
  any host window dependency
