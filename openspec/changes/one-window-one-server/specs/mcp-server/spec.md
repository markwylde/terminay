## ADDED Requirements

### Requirement: Each server has its own MCP socket and addresses no other server

Each Terminay Server SHALL expose its own MCP control socket and capability
tokens, and a client SHALL reach a server's MCP only over that server's own
connection. A server SHALL refuse a request naming a project, terminal, or
capability token issued by another server, and SHALL NEVER forward it. No socket,
token, or tool listing SHALL span servers.

#### Scenario: Two servers on one device

- **WHEN** two windows on one device show different servers that both enable MCP
- **THEN** each server exposes its own socket and tokens, and neither lists the
  other's projects or terminals

#### Scenario: Token from another server

- **WHEN** a request presents a capability token issued by a different server
- **THEN** the request is refused and is not forwarded to the issuing server

#### Scenario: Colliding ids

- **WHEN** two servers hold a terminal with the same id and a request names that
  id
- **THEN** it resolves only on the server it was sent to

## REMOVED Requirements

### Requirement: One MCP socket per server and no cross-server addressing

**Reason**: Its scenarios describe one window holding two attached servers. A window shows one server.

**Migration**: Restated for one server per window as "Each server has its own MCP socket and addresses no other server".
