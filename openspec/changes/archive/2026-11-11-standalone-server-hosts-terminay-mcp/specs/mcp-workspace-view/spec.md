## ADDED Requirements

### Requirement: Every server offers workspace view

Every Terminay Server that serves the MCP control endpoint, embedded in Desktop or standalone, SHALL offer the workspace view operations and SHALL advertise `workspace-view.v1` to every client that attaches.

#### Scenario: Arranging tabs on a standalone server

- **WHEN** an agent in a terminal on a standalone server calls `arrange_tabs`
- **THEN** the client presenting that terminal arranges its tabs, as it would on Desktop's own server

#### Scenario: No client attached to a standalone server

- **WHEN** no client is attached to a standalone server and an agent in one of its terminals calls `focus_tab`
- **THEN** the call fails with `renderer_unavailable`, nothing changes, and terminal tools such as `list_terminals` still work
