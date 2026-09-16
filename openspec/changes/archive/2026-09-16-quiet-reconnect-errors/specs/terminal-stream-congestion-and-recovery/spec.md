## MODIFIED Requirements

### Requirement: Renderer behaviour while the client is unusable

The renderer SHALL visibly mark mounted terminal panels and connection chrome as reconnecting and SHALL reject unsafe mutations promptly while the old client is unusable. Desktop SHALL supply a fresh server-scoped MessagePort; the browser session host SHALL replace its complete WebRTC transport generation and supply a fresh opaque endpoint. The client SHALL NOT reuse a half-closed connection and SHALL NOT obtain raw transport channels.

The reconnecting presentation SHALL be the only visible statement of the outage for that connection. While the connection that owns a project is reconnecting, a feature operation that fails because the transport is gone (a disconnected, unavailable, or deadline failure) SHALL NOT be reported in that project's error banner, and a transport-caused notice already visible SHALL be retired when the connection reports reconnecting. While the connection that owns a terminal is reconnecting, that terminal SHALL NOT show its own connection error or retry action; the rebind onto the recovered connection clears it. A failure the server answered with, such as a denied, not-found, or generic feature failure, SHALL stay visible whatever the connection's phase. Suppression SHALL key on the phase of the connection that owns the surface, so one server's reconnect never hides another server's failures.

#### Scenario: Client becomes unusable

- **WHEN** the mounted client becomes unusable
- **THEN** terminal panels and connection chrome are visibly marked reconnecting and unsafe mutations are rejected promptly

#### Scenario: Fresh endpoint supplied

- **WHEN** a transport generation is replaced
- **THEN** Desktop supplies a fresh server-scoped MessagePort and the browser session host supplies a fresh opaque endpoint, and no half-closed connection or raw transport channel is reused

#### Scenario: Feature refresh fails on the dying transport

- **WHEN** a Git or Explorer refresh fails with a disconnected, unavailable, or deadline error while the owning connection is reconnecting
- **THEN** the project's error banner shows nothing for it and the reconnecting presentation remains the only statement of the outage

#### Scenario: Outage notice raised before the phase flips

- **WHEN** a transport-caused feature notice is already visible and the owning connection then reports reconnecting
- **THEN** that notice is retired, and a notice the server answered with is left in place

#### Scenario: Terminal renewal fails on the dying transport

- **WHEN** a terminal's attachment or presentation renewal fails while the owning connection is reconnecting
- **THEN** the terminal shows no connection error or retry action, and the rebind onto the recovered connection leaves it hydrated with no error

#### Scenario: Another server's reconnect

- **WHEN** one server in the window is reconnecting and a project on another server reports a feature failure
- **THEN** that project's failure is shown as usual
