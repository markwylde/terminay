## ADDED Requirements

### Requirement: One MCP socket per server and no cross-server addressing

Each Terminay Server SHALL expose its own MCP control socket and capability
tokens, and a client SHALL reach a server's MCP only over that server's own
connection. A server SHALL refuse a request naming a project, terminal, or
capability token issued by another server, and SHALL NEVER forward it. No socket,
token, or tool listing SHALL span attached servers.

#### Scenario: Two attached servers

- **WHEN** a window attaches two servers that both enable MCP
- **THEN** each server exposes its own socket and tokens, and neither lists the
  other's projects or terminals

#### Scenario: Token from another server

- **WHEN** a request presents a capability token issued by a different server
- **THEN** the request is refused and is not forwarded to the issuing server

#### Scenario: Colliding ids

- **WHEN** two attached servers hold a terminal with the same id and a request
  names that id
- **THEN** it resolves only on the server it was sent to
