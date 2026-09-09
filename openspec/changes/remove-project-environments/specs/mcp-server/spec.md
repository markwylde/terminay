## ADDED Requirements

### Requirement: MCP eligibility on the server

MCP SHALL be available to every project on the server, because the server provides a proven server-local control transport for the sessions it owns. MCP SHALL NOT fall back to another machine or to a similarly named project or terminal.

#### Scenario: Project on the server

- **WHEN** a project on the server enables MCP
- **THEN** it is served through the proven server-local control transport

#### Scenario: Similarly named project or terminal

- **WHEN** a request names a project or terminal that merely resembles the scoped one
- **THEN** it is not served and no fallback to that project, terminal, or another machine occurs

## MODIFIED Requirements

### Requirement: MCP verification coverage

Registrations SHALL install and uninstall independently while preserving unrelated provider configuration, and install, uninstall, enable, disable, and repair operations SHALL create no provider hooks and SHALL NOT mutate provider hook, trust, or agent-status configuration. An installed agent inside a Terminay terminal SHALL be able to list and control only sibling terminals in its exact canonical project, and a copied token, title, panel id, cwd, or terminal name SHALL NOT cross project or server boundaries. Reads SHALL work without an attached renderer and pending waits SHALL survive renderer reload. Writes SHALL use the canonical terminal input boundary including correct multiline command submission. Disablement, terminal exit, project transfer, and server shutdown SHALL revoke old capabilities and release pending waits. The local endpoint SHALL never listen on a network interface and SHALL reject malformed, oversized, unauthenticated, stale, and cross-scope requests. Packaged Desktop and standalone-server artifacts SHALL start the same bounded stdio MCP adapter using their supported runtime layout.

#### Scenario: Copied identifier

- **WHEN** a token, title, panel id, cwd, or terminal name is copied to another project or server
- **THEN** it does not grant access there

#### Scenario: Project transfer during a wait

- **WHEN** a terminal is transferred to another project while a wait is pending
- **THEN** the old capability is revoked and the pending wait is released

#### Scenario: Packaged artifacts

- **WHEN** the packaged Desktop or standalone-server artifact starts MCP
- **THEN** both start the same bounded stdio adapter using their supported runtime layout

#### Scenario: Hostile control request

- **WHEN** a malformed, oversized, unauthenticated, stale, or cross-scope control request arrives
- **THEN** it is rejected and the endpoint remains off any network interface

## REMOVED Requirements

### Requirement: Environment eligibility for MCP

**Reason:** Every project executes on the server that owns it, so the server-local control transport is always present and there is no eligibility test or bridge to describe.

**Migration:** None. The surviving fall-back prohibition is stated by "MCP eligibility on the server".
