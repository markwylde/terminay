## ADDED Requirements

### Requirement: Every server enforces the permission policy

Every Terminay Server that serves the MCP control endpoint SHALL compose the approval service and enforce the permission policy, whether Desktop embeds it or it runs standalone. A server SHALL NOT serve MCP operations without it, and SHALL advertise `mcp-approvals.v1` to every client that attaches.

#### Scenario: Ask First on a standalone server

- **WHEN** an agent in a terminal on a standalone server calls a tool whose group is Ask First
- **THEN** the client presenting that terminal shows the inline approval prompt, and the tool runs only once the user approves
