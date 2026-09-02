## ADDED Requirements

### Requirement: Canonical manager origin is served by the manager image

The canonical browser connection manager origin SHALL be served by the static
manager image and SHALL present the connections manager with an
add-connection action as its primary affordance. A more specific exact-host
route SHALL take precedence over a wildcard route for that name, and the
wildcard route SHALL continue to serve hosted signaling and session handshake
traffic for other subdomains. The manager image SHALL serve its document only
for the exact canonical Host and SHALL refuse unknown Hosts.

#### Scenario: Canonical origin serves the manager

- **WHEN** the canonical manager origin is opened
- **THEN** the connections manager is served with its primary add-connection
  action
- **AND** the obsolete saved-sessions root is not served

#### Scenario: Wildcard signaling is unaffected

- **WHEN** a session or signaling subdomain of the same parent domain is
  requested
- **THEN** it is still served by the hosted application

#### Scenario: Release marker identifies the revision

- **WHEN** the canonical origin's release marker is requested
- **THEN** it identifies the deployed source revision

### Requirement: Cutover preserves stored connection data

Changing which service serves the canonical manager origin SHALL NOT remove
existing non-secret manager profiles stored at that origin, and SHALL NOT move
or delete session-origin device keys, reconnect grants, or server-side device
state.

#### Scenario: Profiles survive the cutover

- **WHEN** the canonical manager origin begins being served by the manager image
- **THEN** non-secret profiles previously stored at that origin remain readable

#### Scenario: Session credentials are untouched

- **WHEN** the cutover completes
- **THEN** session-origin reconnect material and server device records are
  unchanged
