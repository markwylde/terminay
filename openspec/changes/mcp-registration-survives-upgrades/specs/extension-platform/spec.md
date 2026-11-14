## MODIFIED Requirements

### Requirement: MCP install target contribution

A package SHALL declare each MCP install target under `contributes.mcpInstallTargets`. Each declaration SHALL carry a namespaced target id and a client display name. At activation the extension SHALL register each declared target through `context.mcp.registerInstallTarget(id, runtime)`, which SHALL return a disposable registration. The runtime SHALL implement `status`, `install`, and `uninstall`, and MAY implement `replace`. Each SHALL receive the host-supplied Terminay MCP server command — executable, arguments, and environment — and a cancellation signal. `install` SHALL refuse a changed entry; `replace` SHALL write the host-supplied command over the target's existing Terminay entry, changed or not. `status` SHALL return:

- one of not installed, installed, changed, unavailable, or error
- the provider-owned configuration path it inspects
- a bounded, redacted detail message

The host SHALL supply the MCP server command only when the server can run the MCP adapter. Otherwise it SHALL report every target unavailable without calling the extension. Registration SHALL be refused for undeclared or duplicate ids. A replace request to a target that does not implement `replace` SHALL fail with a bounded error and SHALL change nothing.

#### Scenario: Target status requested

- **WHEN** the host asks a registered target for its status
- **THEN** the extension returns a bounded state, configuration path, and redacted detail

#### Scenario: Server without an MCP adapter

- **WHEN** the server cannot run the Terminay MCP adapter
- **THEN** every install target is reported unavailable and no extension call is made

#### Scenario: Replace on a target without replace

- **WHEN** the host asks a target that does not implement `replace` to replace its entry
- **THEN** the request fails with a bounded error and the target's configuration is unchanged
